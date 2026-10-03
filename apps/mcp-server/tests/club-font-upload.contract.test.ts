import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import type { ComvenioApiClient, ComvenioApiRequest } from "@comvenio/comvenio-client";
import { ASYNC_JOB_RESULT_SCHEMA, type JsonValue } from "@comvenio/connector-contracts";

import { CLUB_FONT_UPLOAD_EXECUTOR } from "../src/jobs/club-font-upload-executor.ts";
import type { JobExecutionContext } from "../src/jobs/executors.ts";
import { detectBinarySignature, extensionMatches } from "../src/files/object-inspection.ts";
import { K7_ACTION_DEFINITIONS } from "../src/tools/identity-club-member-team-role/definitions.ts";
import { K7_ACTION_SCHEMAS } from "../src/tools/identity-club-member-team-role/schemas.ts";

// homepage-generator 18 §11: club font upload as a connector job action (K18, CLI part).
const clubId = "11111111-1111-4111-8111-111111111111";
const sourceFileId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";
const newFontId = "44444444-4444-4444-8444-444444444444";
const oldFontId = "55555555-5555-4555-8555-555555555555";
const otherFontId = "66666666-6666-4666-8666-666666666666";
const thirdFontId = "77777777-7777-4777-8777-777777777777";
// Smallest consistent sfnt: version 0x00010000, one table "head" at offset 28 with length 4.
const ttf = new Uint8Array([
  0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00,
  0x68, 0x65, 0x61, 0x64, 0, 0, 0, 0, 0, 0, 0, 28, 0, 0, 0, 4,
  1, 2, 3, 4,
]);
const readerOf = (bytes: Uint8Array) => ({
  size: bytes.byteLength,
  async read(start: number, end: number) { return bytes.slice(start, Math.min(end, bytes.byteLength)); },
});
const ttfSha = createHash("sha256").update(ttf).digest("hex");

const input = (overrides: Record<string, unknown> = {}) => ({
  club_id: clubId,
  source_file_id: sourceFileId,
  filename: "JagaSerif.ttf",
  content_type: "font/ttf",
  expected_size: ttf.byteLength,
  family: "Jaga Serif",
  lizenz: "OFL 1.1",
  ...overrides,
});

function mergeDesign(current: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])
      ? mergeDesign(result[key], value)
      : value;
  }
  return result;
}

function harness(options: { settings?: JsonValue; jobClub?: string; mime?: string; revokeAtActor?: number; unconfirmed?: boolean } = {}) {
  const calls: Array<ComvenioApiRequest & { fields?: Record<string, string> }> = [];
  let consumed = 0;
  let actors = 0;
  let settings = structuredClone(options.settings ?? { design_settings: {} }) as Record<string, any>;
  const client: ComvenioApiClient = {
    timeout_ms: 15000,
    async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> {
      const fields = request.form
        ? Object.fromEntries([...request.form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : `file:${(value as Blob).type}`]))
        : undefined;
      calls.push({ ...request, ...(fields ? { fields } : {}) });
      if (request.method === "GET" && request.path === `/clubs/${clubId}/settings`) return structuredClone(settings) as T;
      if (request.method === "POST" && request.path === `/fonts/club/${clubId}/upload`) {
        return { font_id: newFontId, family: "Jaga Serif", format: "ttf", size_bytes: ttf.byteLength } as unknown as T;
      }
      if (request.method === "POST" && request.path === `/clubs/${clubId}/settings/fonts`) {
        // Plays the club-service route: one write, same family replaces; unconfirmed drops the entry.
        const entry = request.body as Record<string, any>;
        const fonts = ((settings.design_settings?.fonts ?? []) as Array<Record<string, any>>).filter((font) => font.family !== entry.family);
        settings = mergeDesign(settings, { design_settings: { fonts: [...fonts, entry] } });
        const reported = options.unconfirmed ? fonts : [...fonts, entry];
        return { fonts: reported, replaced_font_ids: [], moved_roles: [] } as unknown as T;
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    },
  };
  const job = {
    record: { handle: { club_id: options.jobClub ?? clubId } },
    envelope: { input: input(), context: { request_id: "req-1", club_id: clubId } },
    async freshActor() {
      actors += 1;
      if (options.revokeAtActor !== undefined && actors >= options.revokeAtActor) throw new Error("revoked");
      return client;
    },
    files: {
      async consumeCleanUpload() {
        consumed += 1;
        return { object_key: "mcp-clean/x", size_bytes: ttf.byteLength, sha256: ttfSha };
      },
    },
    file_metadata: {
      async getFile() {
        return { upload_id: uploadId, club_id: clubId, mime_type: options.mime ?? "font/ttf", size_bytes: ttf.byteLength };
      },
    },
    objects: { async createPresignedDownload() { return { url: "https://quarantine.test/get/x", expires_at: "2026-10-03T00:00:00Z" }; } },
    fetch: async () => new Response(ttf, { status: 200 }),
    async reportProgress() {},
  } as unknown as JobExecutionContext;
  return { job, calls, consumed: () => consumed, actors: () => actors };
}

describe("cai.club.15.font_upload contract", () => {
  const schema = K7_ACTION_SCHEMAS["cai.club.15.font_upload"].input;

  test("is a reversible job action with club settings rights and file scopes", () => {
    const definition = K7_ACTION_DEFINITIONS["cai.club.15.font_upload"];
    expect(definition.execution_gate).toBe("job");
    expect(definition.risk_class).toBe("reversible_write");
    expect([...definition.required_scopes].sort()).toEqual(["admin.write", "club.read", "files.import", "files.write"]);
    expect(definition.permission_policy.all_of).toContain("manage_club_settings");
    expect(definition.backend_routes.map((route) => `${route.method} ${route.service} ${route.normalized_path_template}`)).toContain(
      "POST content /fonts/club/{club_id}/upload",
    );
    expect(definition.backend_routes.map((route) => `${route.method} ${route.service} ${route.normalized_path_template}`)).toContain(
      "POST club /clubs/{club_id}/settings/fonts",
    );
    expect([...CLUB_FONT_UPLOAD_EXECUTOR.required_scopes].sort()).toEqual([...definition.required_scopes].sort());
  });

  test("accepts TTF and WOFF2 up to 2 MB with family and licence", () => {
    expect(schema.safeParse(input()).success).toBe(true);
    expect(schema.safeParse(input({ content_type: "font/woff2", filename: "Jaga.woff2" })).success).toBe(true);
  });

  test("refuses larger files, other types, platform families and a missing licence", () => {
    expect(schema.safeParse(input({ expected_size: 2_097_153 })).success).toBe(false);
    expect(schema.safeParse(input({ content_type: "application/pdf" })).success).toBe(false);
    expect(schema.safeParse(input({ family: "Merriweather" })).success).toBe(false);
    expect(schema.safeParse(input({ lizenz: "" })).success).toBe(false);
  });

  test("font files pass the upload checks by extension and signature", async () => {
    expect(extensionMatches("Jaga.ttf", "font/ttf")).toBe(true);
    expect(extensionMatches("Jaga.woff2", "font/woff2")).toBe(true);
    expect(extensionMatches("Jaga.ttf", "font/woff2")).toBe(false);
    expect((await detectBinarySignature(ttf, readerOf(ttf)))?.mimes).toEqual(["font/ttf"]);
    const woff2 = new Uint8Array(48);
    woff2.set(new TextEncoder().encode("wOF2"), 0);
    new DataView(woff2.buffer).setUint32(8, 48, false);
    new DataView(woff2.buffer).setUint16(12, 1, false);
    expect((await detectBinarySignature(woff2, readerOf(woff2)))?.mimes).toEqual(["font/woff2"]);
  });

  test("review R2: more than 64 tables are a valid font when the directory fits", async () => {
    const tables = 65;
    const dir = 12 + tables * 16;
    const bytes = new Uint8Array(dir + tables * 4);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x00010000, false);
    view.setUint16(4, tables, false);
    for (let index = 0; index < tables; index += 1) {
      const entry = 12 + index * 16;
      bytes.set(new TextEncoder().encode(`t${String(index).padStart(3, "0")}`), entry);
      view.setUint32(entry + 8, dir + index * 4, false);
      view.setUint32(entry + 12, 4, false);
    }
    expect((await detectBinarySignature(bytes, readerOf(bytes)))?.mimes).toEqual(["font/ttf"]);
  });

  test("review R1: magic bytes alone are no font; JSON, text and ISO media keep their reading", async () => {
    const cut = ttf.slice(0, 20);
    expect(await detectBinarySignature(cut, readerOf(cut))).toBeNull();
    const bare = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
    expect(await detectBinarySignature(bare, readerOf(bare))).toBeNull();
    const fakeWoff = new TextEncoder().encode("wOF2xxxx");
    expect(await detectBinarySignature(fakeWoff, readerOf(fakeWoff))).toBeNull();
    for (const text of ["true", "true story"]) {
      const bytes = new TextEncoder().encode(text);
      expect(await detectBinarySignature(bytes, readerOf(bytes))).toBeNull();
    }
    const iso = new Uint8Array([0x00, 0x01, 0x00, 0x00, ...new TextEncoder().encode("ftypisom"), 0, 0, 0, 0]);
    expect((await detectBinarySignature(iso, readerOf(iso)))?.mimes).toContain("video/mp4");
  });
});

describe("cai.club.15.font_upload executor", () => {
  test("uploads the clean file as multipart and registers it", async () => {
    const { job, calls, consumed } = harness();
    const output = await CLUB_FONT_UPLOAD_EXECUTOR.execute(job);
    expect(consumed()).toBe(1);
    const upload = calls.find((call) => call.method === "POST")!;
    expect(upload.service).toBe("content");
    expect(upload.body).toBeUndefined();
    expect(upload.fields).toEqual({ file: "file:font/ttf", family: "Jaga Serif", lizenz: "OFL 1.1" });
    const register = calls.find((call) => call.path === `/clubs/${clubId}/settings/fonts`)!;
    expect(register.method).toBe("POST");
    expect(register.body).toEqual({ id: newFontId, family: "Jaga Serif", format: "ttf", lizenz: "OFL 1.1" });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    const result = CLUB_FONT_UPLOAD_EXECUTOR.projectResult!(output);
    expect(ASYNC_JOB_RESULT_SCHEMA.parse(result)).toEqual({
      kind: "club_font", font_id: newFontId, family: "Jaga Serif", format: "ttf", size_bytes: ttf.byteLength,
    });
  });

  test("registration is one call to the club-service route; replacing and moving roles happen there", async () => {
    const { job, calls } = harness({
      settings: { design_settings: { fonts: [{ id: oldFontId, family: "Jaga Serif", format: "woff2", lizenz: "OFL 1.1" }] } },
    });
    await CLUB_FONT_UPLOAD_EXECUTOR.execute(job);
    expect(calls.filter((call) => call.path === `/clubs/${clubId}/settings/fonts`)).toHaveLength(1);
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  test("review R1: a revoked actor right before the registration stops it", async () => {
    // Actors: 1 capacity GET, 2 consumption, 3 font POST, 4 registration.
    const { job, calls } = harness({ revokeAtActor: 4 });
    await expect(CLUB_FONT_UPLOAD_EXECUTOR.execute(job)).rejects.toThrow("revoked");
    expect(calls.some((call) => call.path === `/clubs/${clubId}/settings/fonts`)).toBe(false);
  });

  test("a registration the club-service does not confirm is no success", async () => {
    const { job } = harness({ unconfirmed: true });
    await expect(CLUB_FONT_UPLOAD_EXECUTOR.execute(job)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  test("a third family is refused before the file is consumed or uploaded", async () => {
    const { job, calls, consumed } = harness({
      settings: {
        design_settings: {
          fonts: [
            { id: otherFontId, family: "Jaga Sans", format: "ttf", lizenz: "OFL 1.1" },
            { id: thirdFontId, family: "Jaga Display", format: "ttf", lizenz: "OFL 1.1" },
          ],
        },
      },
    });
    await expect(CLUB_FONT_UPLOAD_EXECUTOR.execute(job)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(consumed()).toBe(0);
    expect(calls.some((call) => call.method !== "GET")).toBe(false);
  });

  test("a job of another club and a file of another type stop before the consumption", async () => {
    const foreign = harness({ jobClub: "99999999-9999-4999-8999-999999999999" });
    await expect(CLUB_FONT_UPLOAD_EXECUTOR.execute(foreign.job)).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(foreign.consumed()).toBe(0);
    const wrongType = harness({ mime: "font/woff2" });
    await expect(CLUB_FONT_UPLOAD_EXECUTOR.execute(wrongType.job)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(wrongType.consumed()).toBe(0);
  });
});
