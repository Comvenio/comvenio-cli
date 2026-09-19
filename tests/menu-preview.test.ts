import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateMenuPreview, writeMenuPreviewBundle } from "../src/util/menu-preview.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("validateMenuPreview", () => {
  test("accepts a recipe-linked card before apply", () => {
    const result = validateMenuPreview({
      name: "Weinfest",
      items: [
        { recipe_id: "recipe-1", name: "Kaeseteller", selling_price: 6.5, display_order: 10 },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("reports missing recipe links and invalid prices", () => {
    const result = validateMenuPreview({
      name: "Weinfest",
      items: [{ name: "Unvollstaendig", selling_price: "gratis" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("recipe_id");
    expect(result.errors.join(" ")).toContain("selling_price");
  });

  test("accepts one menu item with multiple named price options", () => {
    const result = validateMenuPreview({
      name: "Weinfest",
      items: [{
        recipe_id: "recipe-riesling",
        name: "Riesling Nahe trocken",
        price_options: [
          { label: "0,2 l", price: 4.2 },
          { label: "Flasche", price: 15.6 },
        ],
      }],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("hides the print action in the A4 PNG source", () => {
    const outDir = mkdtempSync(join(tmpdir(), "comvenio-menu-preview-"));
    tempDirs.push(outDir);
    const bundle = writeMenuPreviewBundle({
      card: {
        name: "Weinfest",
        items: [{ recipe_id: "recipe-1", name: "Kaeseteller", selling_price: 6.5 }],
      },
      recipes: new Map([["recipe-1", { id: "recipe-1", category: "Vorspeisen" }]]),
      outDir,
      validation: { valid: true, errors: [], warnings: [] },
    });

    const printHtml = readFileSync(bundle.printHtmlPath, "utf-8");
    expect(printHtml).toContain(".menu-title-block .MuiButton-root{display:none!important}");
  });
});
