// Club fonts (Lastenheft homepage-generator 18, K18): upload and registry.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComvenioClient } from "../src/http.ts";
import { describeClubFonts, MAX_FONT_BYTES, registerClubFont, sniffFontFormat, uploadClubFont } from "../src/util/upload.ts";

const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, ...new Array(60).fill(0)]);
const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00, ...new Array(60).fill(0)]);

function tempFile(name: string, bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "comvenio-font-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

describe("font format", () => {
  test("from magic bytes", () => {
    expect(sniffFontFormat(WOFF2)).toBe("woff2");
    expect(sniffFontFormat(TTF)).toBe("ttf");
    expect(sniffFontFormat(new TextEncoder().encode("OTTO...."))).toBeNull();
    expect(sniffFontFormat(new TextEncoder().encode("<svg"))).toBeNull();
  });
});

describe("font registry", () => {
  const a = { id: "a", family: "Jaga Serif", format: "woff2", lizenz: "OFL 1.1" };
  const b = { id: "b", family: "Jaga Sans", format: "ttf", lizenz: "OFL 1.1" };

  test("appends and replaces the same family", () => {
    expect(registerClubFont(undefined, a)).toEqual([a]);
    expect(registerClubFont([a], b)).toEqual([a, b]);
    const neu = { ...a, id: "a2" };
    expect(registerClubFont([a, b], neu)).toEqual([b, neu]);
  });

  test("refuses a third family", () => {
    expect(() => registerClubFont([a, b], { ...a, id: "c", family: "Dritte" })).toThrow("erlaubt sind 2");
  });
});

describe("font upload", () => {
  test("sends family, license and file to the content-service route", async () => {
    const calls: Array<{ service: string; path: string; form: FormData }> = [];
    const client = {
      postForm: async (service: string, path: string, form: FormData) => {
        calls.push({ service, path, form });
        return { font_id: "f-1", family: "Jaga Serif", format: "woff2", size_bytes: WOFF2.length };
      },
    } as unknown as ComvenioClient;
    const path = tempFile("jaga.woff2", WOFF2);

    const result = await uploadClubFont({ client, clubId: "club 1", path, family: "Jaga Serif", lizenz: "OFL 1.1" });

    expect(calls[0].service).toBe("content");
    expect(calls[0].path).toBe("/fonts/club/club%201/upload");
    expect(calls[0].form.get("family")).toBe("Jaga Serif");
    expect(calls[0].form.get("lizenz")).toBe("OFL 1.1");
    expect(calls[0].form.get("file")).toBeInstanceOf(Blob);
    expect(result.font_id).toBe("f-1");
  });

  test("rejects non-font and oversized files before any request", async () => {
    const calls: string[] = [];
    const client = {
      postForm: async (_s: string, path: string) => {
        calls.push(path);
        return {};
      },
    } as unknown as ComvenioClient;
    const png = tempFile("jaga.woff2", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    await expect(uploadClubFont({ client, clubId: "c", path: png, family: "X", lizenz: "OFL" })).rejects.toThrow("WOFF2 oder TrueType");
    const big = tempFile("big.woff2", new Uint8Array(MAX_FONT_BYTES + 1));
    await expect(uploadClubFont({ client, clubId: "c", path: big, family: "X", lizenz: "OFL" })).rejects.toThrow("zu groß");
    expect(calls).toEqual([]);
  });
});

describe("club info font report", () => {
  test("lists fonts and roles, flags font_id missing from the registry", () => {
    const report = describeClubFonts({
      fonts: [{ id: "a", family: "Jaga Serif", format: "woff2", lizenz: "OFL 1.1" }],
      tokens: {
        type: {
          heading: { family: "Jaga Serif", source: "verein", font_id: "a" },
          body: { family: "Jaga Sans", source: "verein", font_id: "geloescht" },
        },
      },
    });
    expect(report.fonts).toEqual([{ id: "a", family: "Jaga Serif", format: "woff2" }]);
    expect(report.roles.map((r) => r.role)).toEqual(["heading", "body"]);
    expect(report.missing).toEqual([{ role: "body", font_id: "geloescht" }]);
  });

  test("club without tokens or fonts reports nothing", () => {
    expect(describeClubFonts(undefined)).toEqual({ fonts: [], roles: [], missing: [] });
    expect(describeClubFonts({ tokens: { palette: {} } })).toEqual({ fonts: [], roles: [], missing: [] });
  });
});
