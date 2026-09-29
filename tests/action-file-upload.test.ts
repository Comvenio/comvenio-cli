import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cac } from "cac";

import { UPLOAD_EXTENSIONS as SERVER_UPLOAD_EXTENSIONS } from "../apps/mcp-server/src/files/object-inspection.ts";
import { registerActionCommands } from "../src/commands/action.ts";
import {
  EXTENSION_MIME,
  UPLOAD_EXTENSIONS,
  mimeForFilename,
  pollDelayMs,
  readUploadFile,
  runFileUpload,
  sha256Hex,
} from "../src/commands/action-file-upload.ts";
import { PublicCliError, toPublicError } from "../src/errors.ts";
import { ConnectorClientError, type ConnectorTool } from "../src/mcp/client.ts";

const UPLOAD_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";
const UPLOAD_URL = "https://uploads.example.test/quarantine/object?signature=abc";
const ALL_SCOPES = ["club.read", "files.import", "files.write"];

const directory = mkdtempSync(join(tmpdir(), "comvenio-action-file-upload-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function localFile(name: string, content: string | Uint8Array): string {
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}

type Call = { name: string; arguments_: Record<string, unknown> };

/** Connector double: answers per tool from queues, records every call in order. */
function fakeClient(input: {
  tools?: string[];
  complete?: Array<Record<string, unknown> | Error>;
  jobStart?: Record<string, unknown>;
  jobStatus?: Array<Record<string, unknown>>;
}) {
  const calls: Call[] = [];
  let listed = 0;
  const complete = [...(input.complete ?? [handle("clean")])];
  const jobStatus = [...(input.jobStatus ?? [job("succeeded")])];
  const client = {
    async listTools(): Promise<ConnectorTool[]> {
      listed += 1;
      return (input.tools ?? [
        "cv_file_upload_start_write",
        "cv_file_upload_complete_write",
        "cv_job_status_read",
        "cv_data_06_upload",
      ]).map((name) => ({ name }));
    },
    async callTool(name: string, arguments_: Record<string, unknown>): Promise<Record<string, unknown>> {
      calls.push({ name, arguments_ });
      if (name === "cv_file_upload_start_write") {
        return {
          ...handle("pending"),
          upload_url: UPLOAD_URL,
          required_headers: { "Content-Type": arguments_.mime_type },
        };
      }
      if (name === "cv_file_upload_complete_write") {
        const next = complete.shift();
        if (!next) throw new Error("unexpected complete call");
        if (next instanceof Error) throw next;
        return next;
      }
      if (name === "cv_job_status_read") {
        const next = jobStatus.shift();
        if (!next) throw new Error("unexpected status call");
        return next;
      }
      throw new Error(`unexpected tool ${name}`);
    },
    async callAction(request: {
      action_id: string;
      input: Record<string, unknown>;
      idempotency_key?: string;
    }): Promise<Record<string, unknown>> {
      calls.push({ name: `action:${request.action_id}`, arguments_: request as unknown as Record<string, unknown> });
      return input.jobStart ?? { action_id: request.action_id, operation: "upload", status: "queued", result: job("queued") };
    },
  };
  return { client, calls, listed: () => listed };
}

function handle(state: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    upload_id: UPLOAD_ID,
    club_id: "55555555-5555-4555-8555-555555555555",
    owner_subject_id: "66666666-6666-4666-8666-666666666666",
    upload_url: null,
    required_headers: null,
    state,
    expires_at: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
    file_id: state === "clean" ? FILE_ID : null,
    rejection_code: null,
    ...extra,
  };
}

function job(state: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { job_id: JOB_ID, state, error_code: null, progress_percent: null, result_file_id: null, ...extra };
}

/** PUT server double: records the request and answers with the given status. */
function fakePut(status = 200) {
  const requests: Array<{ url: string; method: string; headers: Record<string, string>; body: Uint8Array }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: new Uint8Array(init?.body as Uint8Array),
    });
    return new Response(null, { status });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function recordingSleep() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => { delays.push(ms); } };
}

const EVENT_INPUT = { context_type: "event", context_id: EVENT_ID, visibility: "public" };

describe("action call cai.data.06.upload --file: extension table", () => {
  test("the CLI table equals the server's accepted extensions", () => {
    expect(UPLOAD_EXTENSIONS).toEqual(SERVER_UPLOAD_EXTENSIONS);
  });

  test("maps extensions case-insensitively; ambiguous ones take the first table entry", () => {
    expect(mimeForFilename("flyer.jpg")).toBe("image/jpeg");
    expect(mimeForFilename("FOTO.JPEG")).toBe("image/jpeg");
    expect(mimeForFilename("liste.csv")).toBe("text/plain");
    expect(mimeForFilename("archiv.zip")).toBe("application/zip");
    expect(mimeForFilename("clip.mp4")).toBe("video/mp4");
    expect(mimeForFilename("clip.webm")).toBe("video/webm");
    expect(mimeForFilename("song.ogg")).toBe("video/ogg");
    expect(mimeForFilename("song.mp3")).toBe("audio/mpeg");
    expect(mimeForFilename("setup.exe")).toBeNull();
    expect(mimeForFilename("README")).toBeNull();
    expect(mimeForFilename(".hidden")).toBeNull();
    expect(mimeForFilename("endet.")).toBeNull();
    // Every mapped MIME type lists the extension that maps to it.
    for (const [extension, mime] of EXTENSION_MIME) expect(UPLOAD_EXTENSIONS[mime]).toContain(extension);
  });

  test("SHA-256 is lower-case hex of the exact bytes", () => {
    expect(sha256Hex(new TextEncoder().encode("abc")))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const file = readUploadFile(localFile("hash.txt", "abc"));
    expect(file).toMatchObject({
      filename: "hash.txt",
      mime_type: "text/plain",
      size_bytes: 3,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });

  test("an unknown extension or an empty file fails before any network call", async () => {
    for (const path of [localFile("tool.exe", "MZ"), localFile("leer.pdf", "")]) {
      const { client, calls, listed } = fakeClient({});
      const put = fakePut();
      await expect(runFileUpload({ path, input: EVENT_INPUT }, {
        client, granted_scopes: ALL_SCOPES, fetch: put.fetchImpl,
      })).rejects.toThrow(/kann nicht hochgeladen werden|leer/u);
      expect(listed()).toBe(0);
      expect(calls).toEqual([]);
      expect(put.requests).toEqual([]);
    }
  });

  test("the poll sequence is 1, 2, 4, 8, then 15 seconds with at most 20 % jitter", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((attempt) => pollDelayMs(attempt, () => 0.5)))
      .toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
    expect(pollDelayMs(0, () => 0)).toBe(800);
    expect(pollDelayMs(4, () => 1)).toBe(18_000);
  });
});

describe("action call cai.data.06.upload --file: flow", () => {
  test("clean path: start, PUT with exactly the required headers, complete, action, job", async () => {
    const path = localFile("flyer.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    const { client, calls } = fakeClient({ jobStatus: [job("running"), job("succeeded")] });
    const put = fakePut();
    const pause = recordingSleep();
    const result = await runFileUpload({ path, input: EVENT_INPUT, idempotency_key: "77777777-7777-4777-8777-777777777777" }, {
      client, granted_scopes: ALL_SCOPES, fetch: put.fetchImpl, sleep: pause.sleep, random: () => 0.5,
    });

    expect(calls.map((call) => call.name)).toEqual([
      "cv_file_upload_start_write",
      "cv_file_upload_complete_write",
      "action:cai.data.06.upload",
      "cv_job_status_read",
      "cv_job_status_read",
    ]);
    const sha256 = sha256Hex(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    // club_id comes from the OAuth grant, never from the CLI.
    expect(calls[0]!.arguments_).toEqual({
      filename: "flyer.jpg", mime_type: "image/jpeg", size_bytes: 7, purpose: "event_asset",
    });
    expect(put.requests).toHaveLength(1);
    expect(put.requests[0]).toMatchObject({ url: UPLOAD_URL, method: "PUT", headers: { "content-type": "image/jpeg" } });
    expect([...put.requests[0]!.body]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(calls[1]!.arguments_).toEqual({ upload_id: UPLOAD_ID, completion: { size_bytes: 7, sha256 } });
    expect(calls[2]!.arguments_).toEqual({
      action_id: "cai.data.06.upload",
      input: {
        ...EVENT_INPUT,
        source_file_id: FILE_ID,
        filename: "flyer.jpg",
        content_type: "image/jpeg",
        expected_size: 7,
      },
      idempotency_key: "77777777-7777-4777-8777-777777777777",
    });
    expect(calls[3]!.arguments_).toEqual({ job_id: JOB_ID });
    expect(pause.delays).toEqual([1_000, 2_000]);
    expect(result).toMatchObject({
      action_id: "cai.data.06.upload",
      status: "succeeded",
      job: { job_id: JOB_ID, state: "succeeded" },
      file: { source_file_id: FILE_ID, filename: "flyer.jpg", content_type: "image/jpeg", size_bytes: 7, sha256 },
      idempotency_key: "77777777-7777-4777-8777-777777777777",
    });
  });

  test("the scan takes a while: complete is repeated with the poll sequence until clean", async () => {
    const path = localFile("plan.pdf", "%PDF-1.7 minimal");
    const retry = new ConnectorClientError("nicht erreichbar", { error: "upstream_unavailable", code: "OUTCOME_UNKNOWN" });
    const { client, calls } = fakeClient({ complete: [handle("scanning"), retry, handle("clean")] });
    const pause = recordingSleep();
    await runFileUpload({ path, input: { context_type: "club" } }, {
      client, granted_scopes: ALL_SCOPES, fetch: fakePut().fetchImpl, sleep: pause.sleep, random: () => 0.5,
    });
    expect(calls.filter((call) => call.name === "cv_file_upload_complete_write")).toHaveLength(3);
    expect(calls[0]!.arguments_.purpose).toBe("club_file");
    expect(pause.delays.slice(0, 2)).toEqual([1_000, 2_000]);
  });

  test("rejected: the rejection code is named, the action is never called", async () => {
    const path = localFile("verdaechtig.docx", "PK");
    const { client, calls } = fakeClient({ complete: [handle("rejected", { rejection_code: "MALWARE" })] });
    const error = await runFileUpload({ path, input: EVENT_INPUT }, {
      client, granted_scopes: ALL_SCOPES, fetch: fakePut().fetchImpl, sleep: recordingSleep().sleep,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PublicCliError);
    const rendered = toPublicError(error, { lang: "de" });
    expect(rendered.code).toBe("UPLOAD_REJECTED");
    expect(rendered.detail).toContain("MALWARE");
    expect(rendered.detail).toContain("Virenscan");
    expect(calls.some((call) => call.name.startsWith("action:"))).toBe(false);
  });

  test("a scan that outlives the upload's 15 minutes ends with the expiry hint", async () => {
    const path = localFile("gross.mp4", "....ftypisom");
    let clock = 0;
    const { client } = fakeClient({ complete: Array.from({ length: 200 }, () => handle("scanning")) });
    const error = await runFileUpload({ path, input: EVENT_INPUT }, {
      client,
      granted_scopes: ALL_SCOPES,
      fetch: fakePut().fetchImpl,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      random: () => 0.5,
    }).catch((caught: unknown) => caught);
    const rendered = toPublicError(error, { lang: "de" });
    expect(rendered.code).toBe("UPLOAD_TIMEOUT");
    expect(rendered.detail).toContain("15 Minuten");
  });

  test("a failed PUT ends with the expiry hint and never completes", async () => {
    const path = localFile("bild.png", "\x89PNG");
    const { client, calls } = fakeClient({});
    const error = await runFileUpload({ path, input: EVENT_INPUT }, {
      client, granted_scopes: ALL_SCOPES, fetch: fakePut(403).fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(toPublicError(error, { lang: "de" }).code).toBe("UPLOAD_TIMEOUT");
    expect(calls.map((call) => call.name)).toEqual(["cv_file_upload_start_write"]);
  });

  test("job failed: the job's public error code is reported", async () => {
    const path = localFile("tabelle.xlsx", "PK");
    const { client } = fakeClient({ jobStatus: [job("failed", { error_code: "VALIDATION_FAILED" })] });
    const error = await runFileUpload({ path, input: EVENT_INPUT }, {
      client, granted_scopes: ALL_SCOPES, fetch: fakePut().fetchImpl, sleep: recordingSleep().sleep,
    }).catch((caught: unknown) => caught);
    const rendered = toPublicError(error, { lang: "de" });
    expect(rendered.code).toBe("VALIDATION_FAILED");
    expect(rendered.detail).toContain(JOB_ID);
  });

  test("an interrupted job wait says to check instead of uploading again", async () => {
    const path = localFile("notiz.txt", "hallo");
    const controller = new AbortController();
    const { client } = fakeClient({ jobStatus: [] });
    const error = await runFileUpload({ path, input: EVENT_INPUT }, {
      client,
      granted_scopes: ALL_SCOPES,
      fetch: fakePut().fetchImpl,
      signal: controller.signal,
      sleep: async () => {
        controller.abort(new Error("interrupted"));
        throw new Error("interrupted");
      },
    }).catch((caught: unknown) => caught);
    const rendered = toPublicError(error, { lang: "de" });
    expect(rendered.code).toBe("OUTCOME_UNKNOWN");
    expect(rendered.detail).toContain("cai.data.01.list");
  });

  test("a server without the upload tools reports UPLOAD_NOT_ENABLED before uploading", async () => {
    const path = localFile("flyer2.jpg", "jpg");
    const { client, calls } = fakeClient({ tools: ["cv_data_06_upload"] });
    const put = fakePut();
    const error = await runFileUpload({ path, input: EVENT_INPUT }, {
      client, granted_scopes: ALL_SCOPES, fetch: put.fetchImpl,
    }).catch((caught: unknown) => caught);
    const rendered = toPublicError(error, { lang: "de" });
    expect(rendered.code).toBe("UPLOAD_NOT_ENABLED");
    expect(rendered.message).toContain("noch nicht eingeschaltet");
    expect(calls).toEqual([]);
    expect(put.requests).toEqual([]);
  });

  test("a missing file scope is SCOPE_REQUIRED with the login command, before any network call", async () => {
    const path = localFile("flyer3.jpg", "jpg");
    const { client, listed } = fakeClient({});
    const error = await runFileUpload({ path, input: EVENT_INPUT }, {
      client, granted_scopes: ["club.read", "files.write"], fetch: fakePut().fetchImpl,
    }).catch((caught: unknown) => caught);
    const rendered = toPublicError(error, { lang: "de", granted_scopes: ["club.read", "files.write"] });
    expect(rendered.code).toBe("SCOPE_REQUIRED");
    expect(rendered.cause).toContain("files.import");
    expect(rendered.next_command).toBe("comvenio login --scopes club.read,files.import,files.write");
    expect(listed()).toBe(0);
  });
});

describe("action --file: usage", () => {
  async function run(argv: string[]): Promise<unknown> {
    const cli = cac("comvenio");
    registerActionCommands(cli);
    cli.parse(["bun", "comvenio", ...argv], { run: false });
    return cli.runMatchedCommand();
  }

  test("--file is refused for every other action and verb", async () => {
    await expect(run(["action", "call", "cai.data.01.list", "--file", "./x.json"]))
      .rejects.toThrow("--file ist nur für");
    await expect(run(["action", "list", "--file", "./x.jpg"])).rejects.toThrow("--file ist nur für");
  });

  test("--input fields that --file sets itself are refused", async () => {
    for (const field of ["source_file_id", "filename", "content_type", "expected_size"]) {
      await expect(run([
        "action", "call", "cai.data.06.upload",
        "--file", "./flyer.jpg",
        "--input", JSON.stringify({ ...EVENT_INPUT, [field]: field === "expected_size" ? 1 : "x" }),
      ])).rejects.toThrow(field);
    }
  });
});
