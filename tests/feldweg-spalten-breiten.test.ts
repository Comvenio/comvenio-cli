// Inventory guard for spalten_breiten (Lastenheft homepage-generator/17-designer-struktur
// 10 §5.1, TC-25). Every source file that names section fields (style_variant)
// must also carry spalten_breiten, or be listed here with a reason. An
// inventory guard, not proof that every path transports the field — the export
// test in homepage-designer.test.ts does that.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

// path relative to src/ → reason
const AUSNAHMEN: Record<string, string> = {};

function dateien(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const pfad = join(dir, name);
    if (statSync(pfad).isDirectory()) return dateien(pfad);
    return /\.(ts|json)$/.test(name) && !/\.test\.ts$/.test(name) ? [pfad] : [];
  });
}

describe("Feldweg spalten_breiten (TC-25)", () => {
  test("every file with section fields carries spalten_breiten or is an exception", () => {
    const fehlend = dateien(SRC)
      .filter((pfad) => {
        const text = readFileSync(pfad, "utf8");
        return text.includes("style_variant") && !text.includes("spalten_breiten");
      })
      .map((pfad) => relative(SRC, pfad).split(sep).join("/"))
      .filter((rel) => !(rel in AUSNAHMEN));
    expect(fehlend).toEqual([]);
  });

  test("every exception still exists", () => {
    for (const rel of Object.keys(AUSNAHMEN)) expect(existsSync(join(SRC, rel))).toBe(true);
  });
});
