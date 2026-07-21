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

class SequenceRandom implements FileRandom {
  constructor(private readonly values = [uploadId, fileId]) {}
  uuid(): string {
    const value = this.values.shift();
    if (!value) throw new Error("Keine Test-UUID mehr verfügbar.");
    return value;
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
} = {}) {
  const clock = new MutableClock();
  const metadata = new MemoryFileMetadataStore();
  let inspection = options.inspection ?? safeInspection();
  let scan = options.scan ?? "clean";
  let deleted = 0;
  let authorizations = 0;
  const objects: QuarantineObjectPort = {
    async createPresignedUpload() { return { url: "https://upload.example.test/one-time" }; },
    async inspect() { return structuredClone(inspection); },
    async delete() { deleted++; },
    async promoteClean({ file_id }) { return { object_key: `mcp-clean/${file_id}` }; },
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
    { async scan() { return scan; } },
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
    deleted() { return deleted; },
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
      required_headers: { "Content-Type": "application/pdf" },
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
      expect(setup.deleted()).toBe(1);
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
    expect(infected.deleted()).toBe(1);

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
});
