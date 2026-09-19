import { afterEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ComvenioClient } from "../src/http.ts";
import { MAX_LOGO_BYTES, sniffImageType, uploadClubFile, uploadClubLogo } from "../src/util/upload.ts";

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

  // Fremdprüfung Runde 1 (2026-09-19): extension alone proved nothing, size was unbounded.
  test("rejects a non-image renamed to .png before any request", async () => {
    const calls: string[] = [];
    const client = { post: async (_s: string, p: string) => (calls.push(p), {}) } as unknown as ComvenioClient;
    const fake = join(tmpdir(), `kein-bild-${Date.now()}.png`);
    await Bun.write(fake, "das ist kein Bild");
    try {
      await expect(uploadClubLogo({ client, clubId: "club-1", path: fake })).rejects.toThrow("Dateiinhalt passt zu keinem");
    } finally {
      await unlink(fake);
    }
    expect(calls).toEqual([]);
  });

  test("rejects a logo above the size limit before reading or sending it", async () => {
    const calls: string[] = [];
    const client = { post: async (_s: string, p: string) => (calls.push(p), {}) } as unknown as ComvenioClient;
    const big = join(tmpdir(), `gross-${Date.now()}.png`);
    await Bun.write(big, new Uint8Array(MAX_LOGO_BYTES + 1));
    try {
      await expect(uploadClubLogo({ client, clubId: "club-1", path: big })).rejects.toThrow("zu groß");
    } finally {
      await unlink(big);
    }
    expect(calls).toEqual([]);
  });

  test("recognises image types by their signature", () => {
    const bytes = (...b: number[]) => new Uint8Array(b);
    const text = (s: string) => new TextEncoder().encode(s);
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(text("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(sniffImageType(text("%PDF-1.7"))).toBeNull();
  });

  // Fremdprüfung Runde 2: signatures were checked only partly, and any text
  // starting with "<" that mentioned <svg counted as SVG.
  test("requires complete signatures and an <svg> root element", () => {
    const bytes = (...b: number[]) => new Uint8Array(b);
    const text = (s: string) => new TextEncoder().encode(s);
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00))).toBeNull();
    expect(sniffImageType(text("GIF8xa"))).toBeNull();
    expect(sniffImageType(text("GIF87a"))).toBe("image/gif");
    expect(sniffImageType(text("<html><body><svg></svg></body></html>"))).toBeNull();
    expect(sniffImageType(text(`<?xml version="1.0"?><!-- ${"x".repeat(5000)} --><!DOCTYPE svg><svg viewBox="0 0 1 1"/>`)))
      .toBe("image/svg+xml");
    expect(sniffImageType(text("﻿  <svg>"))).toBe("image/svg+xml");
    expect(sniffImageType(text("<svgx/>"))).toBeNull();
  });
});
