import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { normalizePdfToA4 } from "../src/util/render.ts";

describe("normalizePdfToA4", () => {
  test("keeps every source page and writes full-bleed A4 portrait dimensions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cvn-menu-pdf-"));
    const path = join(dir, "menu.pdf");
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    for (const label of ["Speisen", "Getraenke"]) {
      const page = source.addPage([612, 792]);
      page.drawText(label, { x: 42, y: 740, size: 20, font });
    }
    writeFileSync(path, await source.save());

    expect(await normalizePdfToA4(path)).toBe(2);

    const result = await PDFDocument.load(readFileSync(path));
    expect(result.getPageCount()).toBe(2);
    for (const page of result.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.2756, 3);
      expect(page.getHeight()).toBeCloseTo(841.8898, 3);
    }
  });
});
