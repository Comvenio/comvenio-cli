import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { ComvenioClient } from "../src/http.ts";
import { uploadClubFile } from "../src/util/upload.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("DataShare upload contract", () => {
  test("forwards department and sub-context and uploads standalone-safe bytes", async () => {
    const fixturePath = join(import.meta.dir, "fixtures", "upload.txt");
    const fixtureSize = (await Bun.file(fixturePath).arrayBuffer()).byteLength;
    const calls: Array<{ path: string; body?: unknown }> = [];
    const client = {
      post: async (_service: string, path: string, body?: unknown) => {
        calls.push({ path, body });
        if (path === "/files/presign-upload") {
          return {
            file_id: "file-1",
            upload_url: "https://upload.example.test/file-1",
            headers: { "Content-Type": "text/plain" },
          };
        }
        return { ok: true, size_bytes: 33 };
      },
    } as ComvenioClient;

    let uploadedBody: BodyInit | null | undefined;
    globalThis.fetch = (async (_input, init) => {
      uploadedBody = init?.body;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const result = await uploadClubFile({
      client,
      clubId: "club-1",
      path: fixturePath,
      contextType: "event",
      contextId: "event-1",
      subContextId: "area-1",
      departmentId: "department-1",
      label: "flyer",
      isPublic: true,
    });

    expect(calls[0]).toEqual({
      path: "/files/presign-upload",
      body: {
        club_id: "club-1",
        club_department_id: "department-1",
        filename: "upload.txt",
        content_type: "text/plain;charset=utf-8",
        expected_size: fixtureSize,
        visibility: "public",
        context_type: "event",
        context_id: "event-1",
        sub_context_id: "area-1",
        context_label: "flyer",
      },
    });
    expect(uploadedBody).toBeInstanceOf(ArrayBuffer);
    expect(calls[1]).toEqual({ path: "/files/file-1/finalize", body: {} });
    expect(result).toEqual({
      file_id: "file-1",
      visibility: "public",
      size_bytes: 33,
      filename: "upload.txt",
    });
  });
});
