import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PUBLIC_ERROR_CATALOG } from "@comvenio/connector-contracts";

import { help, INDEX, type HelpArticle } from "../src/help/help.ts";
import { renderArticle } from "../src/help/render.ts";
import { ARTIKEL } from "../src/help/artikel.generated.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const buildDir = mkdtempSync(join(tmpdir(), "comvenio-help-"));

afterAll(() => rmSync(buildDir, { recursive: true, force: true }));

describe("comvenio help (03-programm-hilfe)", () => {
  test("TC-01: an article is shown without any network access", () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("network used"); }) as unknown as typeof fetch;
    try {
      const result = help("homepage", undefined, "de", 80);
      expect(result.exitCode).toBe(0);
      expect(result.text).toContain("Wozu\n----");
      expect(result.text).not.toContain("gen:docs");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a topic is also found by one of its commands", () => {
    expect((help("zone", undefined, "de", 80).json as HelpArticle).id).toBe("zonen");
  });

  test("TC-02: help fehler SCOPE_REQUIRED --lang en --json returns the English object", () => {
    const result = help("fehler", "SCOPE_REQUIRED", "en", 80);
    const json = result.json as HelpArticle;
    expect(result.exitCode).toBe(0);
    expect(json.id).toBe("fehler/scope-required");
    expect(json.lang).toBe("en");
    expect(json.title).toStartWith("SCOPE_REQUIRED — Your sign-in");
    expect(json.markdown).toContain("## Solution");
    expect(Object.keys(json).sort()).toEqual(["id", "lang", "markdown", "related", "title"]);
  });

  test("help fehler without a code lists every public code", () => {
    const codes = (help("fehler", undefined, "de", 80).json as Array<{ code: string }>).map((entry) => entry.code).sort();
    expect(codes).toEqual(Object.keys(PUBLIC_ERROR_CATALOG).sort());
  });

  test("TC-03: an unknown topic lists the nearest hits and exits 1", () => {
    const result = help("zonne", undefined, "de", 80);
    expect(result.exitCode).toBe(1);
    expect((result.json as { matches: Array<{ id: string }> }).matches.map((hit) => hit.id)).toContain("zonen");
    expect(result.text).toContain("comvenio help");
    const code = help("fehler", "NOPE", "de", 80);
    expect(code.exitCode).toBe(1);
    expect(code.text).toContain("comvenio help fehler");
  });

  test("help suche finds articles by title and keywords", () => {
    const hits = help("suche", "buchung", "de", 80).json as Array<{ id: string }>;
    expect(hits.map((hit) => hit.id)).toContain("buchungen-objekte");
  });

  test("TC-05: at 60 columns no line is longer and no colour code appears, in every article", () => {
    for (const [path, raw] of Object.entries(ARTIKEL)) {
      const text = renderArticle(raw, 60);
      const long = text.split("\n").filter((line) => line.length > 60);
      expect(long, path).toEqual([]);
      expect(text, path).not.toContain("\u001b[");
    }
  });

  test("list items keep their continuation lines indented; only CLI commands get a backslash", () => {
    const raw = [
      "- Ein Listenpunkt, der im Quelltext über",
      "  zwei Zeilen läuft und umbrochen werden muss, weil er sehr lang ist und nicht passt.",
      "",
      "```bash",
      "comvenio homepage preview --file home.json --design-file design-settings.json --json",
      "```",
      "",
      "```json",
      '{ "title": "Eine lange Überschrift, die in einem JSON-Beispiel steht und umbricht" }',
      "",
      "```",
    ].join("\n");
    const lines = renderArticle(raw, 60).split("\n");
    expect(lines[0]).toStartWith("- Ein Listenpunkt");
    expect(lines[1]).toStartWith("  ");
    const command = lines.filter((line) => line.includes("comvenio") || line.startsWith("      --"));
    expect(command[0]).toEndWith(" \\");
    const json = lines.filter((line) => line.includes("Überschrift") || line.includes("umbricht"));
    for (const line of json) expect(line.endsWith("\\")).toBe(false);
    expect(lines.some((line) => /\s$/u.test(line))).toBe(false);
  });

  test("every error message's help pointer resolves", () => {
    for (const code of Object.keys(PUBLIC_ERROR_CATALOG)) {
      expect(help("fehler", code, "de", 80).exitCode, code).toBe(0);
    }
  });

  test("TC-04: every id of docs/index.json is available in the built program, in both languages", async () => {
    const binary = join(buildDir, "comvenio");
    const build = Bun.spawnSync(["bun", "build", "src/index.ts", "--compile", "--outfile", binary], {
      cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
    });
    expect(build.exitCode, build.stderr.toString()).toBe(0);
    // Run far away from the repository and without a home: nothing but the binary itself.
    const env = { PATH: process.env.PATH ?? "", HOME: buildDir, LANG: "C" };
    for (const entry of INDEX) {
      const args = entry.id.startsWith("fehler/")
        ? ["fehler", entry.id.slice("fehler/".length).replaceAll("-", "_").toUpperCase()]
        : [entry.id];
      for (const lang of ["de", "en"] as const) {
        const run = Bun.spawnSync([binary, "help", ...args, "--json", "--lang", lang], { cwd: buildDir, env, stdout: "pipe", stderr: "pipe" });
        expect(run.exitCode, `${entry.id} ${lang}: ${run.stderr.toString()}`).toBe(0);
        const json = JSON.parse(run.stdout.toString()) as HelpArticle;
        expect(json.id).toBe(entry.id);
        expect(json.lang).toBe(lang);
        expect(json.markdown.length).toBeGreaterThan(100);
      }
    }
  }, 180_000);
});
