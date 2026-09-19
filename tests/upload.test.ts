import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { ComvenioClient } from "../src/http.ts";
import { uploadClubFile, uploadClubLogo } from "../src/util/upload.ts";

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

describe("club logo upload contract", () => {
  test("uses the logo route so the platform picks the file up as club logo", async () => {
    const fixturePath = join(import.meta.dir, "fixtures", "logo.png");
    const fixtureSize = (await Bun.file(fixturePath).arrayBuffer()).byteLength;
    const calls: Array<{ service: string; path: string; body?: unknown }> = [];
    const client = {
      post: async (service: string, path: string, body?: unknown) => {
        calls.push({ service, path, body });
        if (path.includes("/presign-upload")) {
          return {
            file_id: "logo-1",
            upload_url: "https://upload.example.test/logo-1",
            headers: { "Content-Type": "image/png" },
          };
        }
        return { ok: true, size_bytes: fixtureSize };
      },
    } as ComvenioClient;

    let putHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      putHeaders = init?.headers;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const result = await uploadClubLogo({ client, clubId: "club 1", path: fixturePath });

    expect(calls[0]).toEqual({
      service: "content",
      path: "/logos/club/club%201/presign-upload?filename=logo.png&content_type=image%2Fpng",
      body: {},
    });
    expect(putHeaders).toEqual({ "Content-Type": "image/png" });
    expect(calls[1]).toEqual({ service: "content", path: "/logos/logo-1/finalize", body: {} });
    expect(result).toEqual({ file_id: "logo-1", size_bytes: fixtureSize, filename: "logo.png" });
  });

  test("rejects non-image files before any request", async () => {
    const calls: string[] = [];
    const client = {
      post: async (_service: string, path: string) => {
        calls.push(path);
        return {};
      },
    } as ComvenioClient;

    await expect(
      uploadClubLogo({ client, clubId: "club-1", path: join(import.meta.dir, "fixtures", "upload.txt") }),
    ).rejects.toThrow("Vereinslogo muss ein Bild sein");
    expect(calls).toEqual([]);
  });
});
