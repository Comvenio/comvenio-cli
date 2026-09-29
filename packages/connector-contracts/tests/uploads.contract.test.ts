import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  CONNECTOR_FILE_REFERENCE_SCHEMA,
  MAX_CONNECTOR_FILE_SIZE_BYTES,
  MAX_ZIP_COMPRESSION_RATIO,
  MAX_ZIP_DIRECTORY_DEPTH,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_PATH_LENGTH,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  UPLOAD_CREATE_REQUEST_SCHEMA,
  UPLOAD_HANDLE_SCHEMA,
  UPLOAD_HANDLE_TTL_SECONDS,
  type RequestContext,
} from "@comvenio/connector-contracts";
import {
  ConnectorFileService,
  FileGetTool,
  FileUploadCompleteTool,
  FileUploadStartTool,
  MemoryFileMetadataStore,
  validateStoredObject,
  type FileAuthorizationPort,
  type FileClock,
  type FileRandom,
  type MalwareScannerPort,
  type QuarantineObjectPort,
  type StoredObjectInspection,
  type ZipInspection,
} from "../../../apps/mcp-server/src/files/index.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const clubId = "33333333-3333-4333-8333-333333333333";
const otherClubId = "34343434-3434-4434-8434-343434343434";
const grantId = "44444444-4444-4444-8444-444444444444";
const otherGrantId = "45454545-4545-4545-8545-454545454545";
const uploadId = "55555555-5555-4555-8555-555555555555";
const fileId = "66666666-6666-4666-8666-666666666666";
const sha = "a".repeat(64);

const context: RequestContext = {
  request_id: requestId,
  surface: "mcp",
  provider: "anthropic",
  subject_id: subjectId,
  oauth_grant_id: grantId,
  club_id: clubId,
  department_id: null,
  scopes: ["files.write", "files.import", "files.export"],
  capability_version: "cap-v1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

class MutableClock implements FileClock {
  constructor(private timestamp = Date.parse("2026-07-21T12:00:00.000Z")) {}
  now(): Date { return new Date(this.timestamp); }
  advance(seconds: number): void { this.timestamp += seconds * 1_000; }
}

/** Fixed ids for upload and file first; completion ids afterwards are random. */
class SequenceRandom implements FileRandom {
  constructor(private readonly values = [uploadId, fileId]) {}
  uuid(): string {
    return this.values.shift() ?? randomUUID();
  }
}

function safeZip(): ZipInspection {
  return {
    entry_count: 10,
    total_uncompressed_bytes: 1_000,
    largest_entry_bytes: 500,
    maximum_compression_ratio: 2,
    maximum_directory_depth: 2,
    maximum_normalized_path_length: 20,
    has_absolute_path: false,
    has_parent_traversal: false,
    has_symlink: false,
    has_hardlink: false,
    has_device_entry: false,
    is_encrypted: false,
    is_multi_disk: false,
    has_nested_archive: false,
  };
}

function safeInspection(overrides: Partial<StoredObjectInspection> = {}): StoredObjectInspection {
  return {
    size_bytes: 1_024,
    sha256: sha,
    detected_mime_type: "application/pdf",
    magic_bytes_match: true,
    extension_match: true,
    active_content_passivated: true,
    zip: null,
    ...overrides,
  };
}

function fixture(options: {
  inspection?: StoredObjectInspection;
  scan?: "clean" | "infected" | "unavailable";
  scanner?: MalwareScannerPort;
} = {}) {
  const clock = new MutableClock();
  const metadata = new MemoryFileMetadataStore();
  // `inspection` models the quarantine object as it is now; every inspect() takes its own copy.
  let inspection = options.inspection ?? safeInspection();
  let scan = options.scan ?? "clean";
  const deletedKeys: string[] = [];
  const releasedIds: string[] = [];
  const copies = new Map<string, StoredObjectInspection>();
  const inspectionIds: string[] = [];
  const promotedIds: string[] = [];
  let authorizations = 0;
  const objects: QuarantineObjectPort = {
    async createPresignedUpload(input) {
      return {
        url: "https://upload.example.test/one-time",
        required_headers: { "Content-Type": input.mime_type, "Content-Length": String(input.size_bytes), "If-None-Match": "*" },
      };
    },
    async inspect() {
      const inspectionId = randomUUID();
      copies.set(inspectionId, structuredClone(inspection));
      inspectionIds.push(inspectionId);
      return { ...structuredClone(inspection), inspection_id: inspectionId };
    },
    async release({ inspection_id }) {
      releasedIds.push(inspection_id);
      copies.delete(inspection_id);
    },
    async delete({ object_key }) { deletedKeys.push(object_key); },
    async promoteClean({ inspection_id, file_id }) {
      const copy = copies.get(inspection_id);
      if (!copy) throw new Error("The inspection has no current local copy.");
      promotedIds.push(inspection_id);
      return { object_key: `mcp-clean/${file_id}`, inspection_id, sha256: copy.sha256, size_bytes: copy.size_bytes };
    },
    async createPresignedDownload() {
      return { url: "https://download.example.test/short-lived", expires_at: new Date(clock.now().getTime() + 300_000).toISOString() };
    },
  };
  const authorization: FileAuthorizationPort = {
    async reauthorize() { authorizations++; return { capability_version: "cap-v1" }; },
  };
  const service = new ConnectorFileService(
    metadata,
    objects,
    options.scanner ?? { async scan() { return scan; } },
    authorization,
    clock,
    new SequenceRandom(),
  );
  return {
    service,
    metadata,
    clock,
    setInspection(value: StoredObjectInspection) { inspection = value; },
    setScan(value: "clean" | "infected" | "unavailable") { scan = value; },
    deleted() { return deletedKeys.length; },
    deletedKeys() { return [...deletedKeys]; },
    released() { return releasedIds.length; },
    releasedIds() { return [...releasedIds]; },
    inspectionIds() { return [...inspectionIds]; },
    promotedIds() { return [...promotedIds]; },
    liveCopies() { return [...copies.keys()]; },
    authorizations() { return authorizations; },
  };
}

function uploadRequest() {
  return {
    club_id: clubId,
    filename: "mitglieder.pdf",
    mime_type: "application/pdf" as const,
    size_bytes: 1_024,
    purpose: "domain_import" as const,
  };
}

async function startAndComplete(setup = fixture()) {
  const pending = await setup.service.startUpload({ context, request: uploadRequest() });
  const clean = await setup.service.completeUpload({
    context,
    club_id: clubId,
    upload_id: pending.upload_id,
    completion: { size_bytes: 1_024, sha256: sha },
  });
  return { setup, pending, clean };
}

describe("K15 upload, quarantine and file-reference contract", () => {
  test("a finalize whose own write already landed (replayed command) keeps the file", async () => {
    const setup = fixture();
    const original = setup.metadata.finalizeUpload.bind(setup.metadata);
    // Models ioredis resending the EVAL after a reconnect: the first run wrote, the answer got lost.
    setup.metadata.finalizeUpload = async (input) => { await original(input); return false; };
    const { clean } = await startAndComplete(setup);
    expect(clean.state).toBe("clean");
    expect(clean.file_id).not.toBeNull();
    expect(setup.deleted()).toBe(0);
    expect(await setup.metadata.getFile(clean.file_id!)).not.toBeNull();
  });

  test("TC-01/TC-02: validates all entities and completes the safe lifecycle", async () => {
    const setup = fixture();
    const startTool = new FileUploadStartTool(setup.service);
    const completeTool = new FileUploadCompleteTool(setup.service);
    const getTool = new FileGetTool(setup.service);
    expect(startTool.tool_name).toBe("cv_file_upload_start_write");
    expect(completeTool.tool_name).toBe("cv_file_upload_complete_write");
    expect(getTool.tool_name).toBe("cv_file_get_read");

    const pending = await startTool.execute({ context, request: uploadRequest() });
    expect(UPLOAD_HANDLE_SCHEMA.parse(pending)).toEqual(pending);
    expect(pending).toMatchObject({
      upload_id: uploadId,
      club_id: clubId,
      owner_subject_id: subjectId,
      state: "pending",
      upload_url: "https://upload.example.test/one-time",
      required_headers: { "Content-Type": "application/pdf", "Content-Length": "1024", "If-None-Match": "*" },
      file_id: null,
    });
    expect(JSON.stringify(pending)).not.toContain("mcp-quarantine");

    const clean = await completeTool.execute({
      context,
      club_id: clubId,
      upload_id: pending.upload_id,
      completion: { size_bytes: 1_024, sha256: sha },
    });
    expect(clean).toMatchObject({ state: "clean", file_id: fileId, upload_url: null, required_headers: null });
    // The local inspection copy is released after the completion, whatever its outcome.
    expect(setup.released()).toBe(1);
    const reference = await getTool.execute({ context, club_id: clubId, file_id: clean.file_id! });
    expect(CONNECTOR_FILE_REFERENCE_SCHEMA.parse(reference)).toEqual(reference);
    expect(reference).toMatchObject({
      file_id: fileId,
      club_id: clubId,
      name: "mitglieder.pdf",
      mime_type: "application/pdf",
      size_bytes: 1_024,
      sha256: sha,
      download_url: "https://download.example.test/short-lived",
    });
    expect(setup.authorizations()).toBe(3);
  });

  test("TC-03: rejects unbounded files, pseudo MIME and unsafe filenames before storage", () => {
    expect(() => UPLOAD_CREATE_REQUEST_SCHEMA.parse({
      ...uploadRequest(),
      size_bytes: MAX_CONNECTOR_FILE_SIZE_BYTES + 1,
    })).toThrow();
    expect(() => UPLOAD_CREATE_REQUEST_SCHEMA.parse({
      ...uploadRequest(),
      mime_type: "application/octet-stream",
    })).toThrow();
    expect(() => UPLOAD_CREATE_REQUEST_SCHEMA.parse({
      ...uploadRequest(),
      filename: "../mitglieder.pdf",
    })).toThrow();
    expect(() => UPLOAD_CREATE_REQUEST_SCHEMA.parse({
      ...uploadRequest(),
      unknown_payload: true,
    })).toThrow();
  });

  test("TC-04: foreign club, grant and missing scope reveal neither upload nor file", async () => {
    const { setup, pending, clean } = await startAndComplete();
    await expect(setup.service.completeUpload({
      context: { ...context, club_id: otherClubId },
      club_id: clubId,
      upload_id: pending.upload_id,
      completion: { size_bytes: 1_024, sha256: sha },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    await expect(setup.service.getFile({
      context: { ...context, oauth_grant_id: otherGrantId },
      club_id: clubId,
      file_id: clean.file_id!,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setup.service.getFile({
      context: { ...context, scopes: ["files.write"] },
      club_id: clubId,
      file_id: clean.file_id!,
    })).rejects.toMatchObject({ code: "SCOPE_REQUIRED" });
  });

  test("TC-06: hash, MIME, magic bytes, passivation and malware fail closed", async () => {
    for (const [inspection, completion, expected] of [
      [safeInspection({ sha256: "b".repeat(64) }), { size_bytes: 1_024, sha256: sha }, "HASH_MISMATCH"],
      [safeInspection({ detected_mime_type: "text/plain" }), { size_bytes: 1_024, sha256: sha }, "MIME_MISMATCH"],
      [safeInspection({ magic_bytes_match: false }), { size_bytes: 1_024, sha256: sha }, "MIME_MISMATCH"],
      [safeInspection({ size_bytes: 1_023 }), { size_bytes: 1_024, sha256: sha }, "SIZE_MISMATCH"],
    ] as const) {
      const setup = fixture({ inspection });
      const pending = await setup.service.startUpload({ context, request: uploadRequest() });
      const rejected = await setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion });
      expect(rejected).toMatchObject({ state: "rejected", rejection_code: expected, upload_url: null });
      // K15b: the quarantine object stays until the lifecycle rule removes it (URL stays one-time).
      expect(setup.deleted()).toBe(0);
      expect(await setup.metadata.getUpload(pending.upload_id)).toMatchObject({
        filename: null,
        mime_type: null,
        size_bytes: null,
        purpose: null,
        object_key: null,
        rejection_sha256: inspection.sha256,
      });
    }

    const infected = fixture({ scan: "infected" });
    const infectedPending = await infected.service.startUpload({ context, request: uploadRequest() });
    expect(await infected.service.completeUpload({ context, club_id: clubId, upload_id: infectedPending.upload_id, completion: { size_bytes: 1_024, sha256: sha } }))
      .toMatchObject({ state: "rejected", rejection_code: "MALWARE" });
    expect(infected.deleted()).toBe(0);

    const html = fixture({ inspection: safeInspection({ detected_mime_type: "text/html", active_content_passivated: false }) });
    const htmlPending = await html.service.startUpload({ context, request: { ...uploadRequest(), filename: "seite.html", mime_type: "text/html" } });
    expect(await html.service.completeUpload({ context, club_id: clubId, upload_id: htmlPending.upload_id, completion: { size_bytes: 1_024, sha256: sha } }))
      .toMatchObject({ state: "rejected", rejection_code: "MIME_MISMATCH" });
  });

  test("TC-06: enforces every numeric ZIP bound and every forbidden entry type", () => {
    const base = {
      inspection: safeInspection({ detected_mime_type: "application/zip", zip: safeZip() }),
      declared_mime_type: "application/zip" as const,
      declared_size_bytes: 1_024,
      completion_size_bytes: 1_024,
      completion_sha256: sha,
    };
    expect(validateStoredObject(base)).toBeNull();

    const numericCases: Array<Partial<ZipInspection>> = [
      { entry_count: MAX_ZIP_ENTRIES + 1 },
      { total_uncompressed_bytes: MAX_ZIP_UNCOMPRESSED_BYTES + 1 },
      { largest_entry_bytes: MAX_ZIP_ENTRY_BYTES + 1 },
      { maximum_compression_ratio: MAX_ZIP_COMPRESSION_RATIO + 0.01 },
      { maximum_directory_depth: MAX_ZIP_DIRECTORY_DEPTH + 1 },
      { maximum_normalized_path_length: MAX_ZIP_PATH_LENGTH + 1 },
    ];
    for (const update of numericCases) {
      expect(validateStoredObject({
        ...base,
        inspection: { ...base.inspection, zip: { ...safeZip(), ...update } },
      })).toBe("ARCHIVE_LIMIT_EXCEEDED");
    }

    const unsafeCases: Array<keyof ZipInspection> = [
      "has_absolute_path",
      "has_parent_traversal",
      "has_symlink",
      "has_hardlink",
      "has_device_entry",
      "is_encrypted",
      "is_multi_disk",
      "has_nested_archive",
    ];
    for (const key of unsafeCases) {
      expect(validateStoredObject({
        ...base,
        inspection: { ...base.inspection, zip: { ...safeZip(), [key]: true } },
      })).toBe("UNSAFE_ARCHIVE");
    }
  });

  test("TC-06: clean uploads are consumed once and expired references cannot be loaded", async () => {
    const { setup, pending, clean } = await startAndComplete();
    const consumed = await setup.service.consumeCleanUpload({ context, club_id: clubId, upload_id: pending.upload_id, file_id: clean.file_id! });
    expect(consumed.state).toBe("consumed");
    await expect(setup.service.consumeCleanUpload({ context, club_id: clubId, upload_id: pending.upload_id, file_id: clean.file_id! }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    setup.clock.advance(24 * 60 * 60 + 1);
    await expect(setup.service.getFile({ context, club_id: clubId, file_id: clean.file_id! }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("scanner unavailability remains retryable without exposing scanner signatures", async () => {
    const setup = fixture({ scan: "unavailable" });
    const pending = await setup.service.startUpload({ context, request: uploadRequest() });
    await expect(setup.service.completeUpload({
      context,
      club_id: clubId,
      upload_id: pending.upload_id,
      completion: { size_bytes: 1_024, sha256: sha },
    })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      retry_after_seconds: 15,
      message: "Die Sicherheitsprüfung ist vorübergehend nicht verfügbar.",
    });
    expect(setup.deleted()).toBe(0);
    setup.setScan("clean");
    await expect(setup.service.completeUpload({
      context,
      club_id: clubId,
      upload_id: pending.upload_id,
      completion: { size_bytes: 1_024, sha256: sha },
    })).resolves.toMatchObject({ state: "clean", file_id: fileId });
  });

  test("K15b: parallel completions run exactly one inspection and promote the inspected version", async () => {
    let releaseScan: (verdict: "clean" | "infected" | "unavailable") => void = () => undefined;
    let scanStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { scanStarted = resolve; });
    const scanned: string[] = [];
    const setup = fixture({
      scanner: {
        scan({ inspection_id }) {
          scanned.push(inspection_id);
          scanStarted();
          return new Promise((resolve) => { releaseScan = resolve; });
        },
      },
    });
    const pending = await setup.service.startUpload({ context, request: uploadRequest() });
    const first = setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: sha } });
    await started;

    // The object is replaced by another file of the same size and a second completion follows.
    const otherSha = "b".repeat(64);
    setup.setInspection(safeInspection({ sha256: otherSha }));
    const second = await setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: otherSha } });
    expect(second).toMatchObject({ state: "scanning", file_id: null, upload_url: null });
    const third = await setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: sha } });
    expect(third).toMatchObject({ state: "scanning" });
    expect(setup.inspectionIds()).toHaveLength(1);
    const [inspectionId] = setup.inspectionIds();
    // The parallel calls neither inspected nor released anything.
    expect(setup.liveCopies()).toEqual([inspectionId!]);
    expect(setup.released()).toBe(0);

    releaseScan("clean");
    expect(await first).toMatchObject({ state: "clean", file_id: fileId });
    expect(scanned).toEqual([inspectionId!]);
    expect(setup.promotedIds()).toEqual([inspectionId!]);
    expect(setup.releasedIds()).toEqual([inspectionId!]);
    expect(await setup.metadata.getFile(fileId)).toMatchObject({ sha256: sha, inspection_id: inspectionId });
  });

  test("K15b: an abandoned completion cannot finalize over, or delete, the work of the completion that took over", async () => {
    const verdicts: Array<(verdict: "clean" | "infected" | "unavailable") => void> = [];
    const waiters: Array<() => void> = [];
    const scanCalled = () => new Promise<void>((resolve) => { waiters.push(resolve); });
    const setup = fixture({
      scanner: {
        scan() {
          waiters.shift()?.();
          return new Promise((resolve) => { verdicts.push(resolve); });
        },
      },
    });
    const pending = await setup.service.startUpload({ context, request: uploadRequest() });
    const firstScan = scanCalled();
    const first = setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: sha } });
    await firstScan;

    // The first completion looks dead (lease over), a second one takes over.
    setup.clock.advance(5 * 60 + 1);
    const secondScan = scanCalled();
    const second = setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: sha } });
    await secondScan;
    const [firstId, secondId] = setup.inspectionIds();
    expect(setup.liveCopies()).toEqual([firstId!, secondId!]);

    verdicts[1]!("clean");
    const clean = await second;
    expect(clean.state).toBe("clean");
    // The takeover got a fresh file id, so both completions never share a clean object.
    expect(clean.file_id).not.toBe(fileId);
    expect(setup.liveCopies()).toEqual([firstId!]);

    verdicts[0]!("clean");
    expect(await first).toEqual(clean);
    // The loser removed only its own promoted object and its own copy.
    expect(setup.deletedKeys()).toEqual([`mcp-clean/${fileId}`]);
    expect(setup.releasedIds()).toEqual([secondId!, firstId!]);
    expect(await setup.metadata.getFile(clean.file_id!)).toMatchObject({ inspection_id: secondId });
    expect(await setup.metadata.getFile(fileId)).toBeNull();
  });

  test("K15b: an object replaced between two completions is judged and stored from the second inspection only", async () => {
    const setup = fixture({ scan: "unavailable" });
    const pending = await setup.service.startUpload({ context, request: uploadRequest() });
    await expect(setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: sha } }))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    // The failed completion handed the upload back unchanged.
    expect((await setup.metadata.getUpload(pending.upload_id))?.handle).toEqual(pending);

    const otherSha = "c".repeat(64);
    setup.setInspection(safeInspection({ sha256: otherSha }));
    setup.setScan("clean");
    const clean = await setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: otherSha } });
    expect(clean).toMatchObject({ state: "clean", file_id: fileId });
    const [firstId, secondId] = setup.inspectionIds();
    expect(setup.promotedIds()).toEqual([secondId!]);
    expect(setup.releasedIds()).toEqual([firstId!, secondId!]);
    expect(await setup.metadata.getFile(fileId)).toMatchObject({ sha256: otherSha, inspection_id: secondId });
  });

  test("K15b: a rejected or expired upload keeps its object until the URL expired and cannot be completed again", async () => {
    const setup = fixture({ inspection: safeInspection({ sha256: "d".repeat(64) }) });
    const pending = await setup.service.startUpload({ context, request: uploadRequest() });
    expect(await setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: sha } }))
      .toMatchObject({ state: "rejected", rejection_code: "HASH_MISMATCH" });
    expect(setup.deletedKeys()).toEqual([]);

    // Even with a matching object afterwards, the upload stays closed, before and after URL expiry.
    setup.setInspection(safeInspection());
    await expect(setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: sha } }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    setup.clock.advance(UPLOAD_HANDLE_TTL_SECONDS + 1);
    await expect(setup.service.completeUpload({ context, club_id: clubId, upload_id: pending.upload_id, completion: { size_bytes: 1_024, sha256: sha } }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(setup.inspectionIds()).toHaveLength(1);
    expect(setup.deleted()).toBe(0);

    const late = fixture();
    const latePending = await late.service.startUpload({ context, request: uploadRequest() });
    late.clock.advance(UPLOAD_HANDLE_TTL_SECONDS + 1);
    expect(await late.service.completeUpload({ context, club_id: clubId, upload_id: latePending.upload_id, completion: { size_bytes: 1_024, sha256: sha } }))
      .toMatchObject({ state: "expired", rejection_code: "EXPIRED" });
    await expect(late.service.completeUpload({ context, club_id: clubId, upload_id: latePending.upload_id, completion: { size_bytes: 1_024, sha256: sha } }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(late.inspectionIds()).toHaveLength(0);
    expect(late.deleted()).toBe(0);
  });

  test("K15b: the service refuses an upload URL that is not signed for one-time creation", async () => {
    const setup = fixture();
    const unconditional = new ConnectorFileService(
      setup.metadata,
      {
        async createPresignedUpload(input) {
          return { url: "https://upload.example.test/one-time", required_headers: { "Content-Type": input.mime_type, "Content-Length": String(input.size_bytes) } as never };
        },
        async inspect() { throw new Error("not used"); },
        async release() {},
        async delete() {},
        async promoteClean() { throw new Error("not used"); },
        async createPresignedDownload() { throw new Error("not used"); },
      },
      { async scan() { return "clean"; } },
      { async reauthorize() { return { capability_version: "cap-v1" }; } },
      setup.clock,
      new SequenceRandom(),
    );
    await expect(unconditional.startUpload({ context, request: uploadRequest() })).rejects.toThrow();
    expect(() => UPLOAD_HANDLE_SCHEMA.parse({
      upload_id: uploadId,
      club_id: clubId,
      owner_subject_id: subjectId,
      upload_url: "https://upload.example.test/one-time",
      required_headers: { "Content-Type": "application/pdf", "Content-Length": "1024" },
      state: "pending",
      expires_at: "2026-07-21T12:15:00.000Z",
      file_id: null,
      rejection_code: null,
    })).toThrow();
  });
});
