import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkDocs, generateDocs } from "../scripts/docs-lib.ts";

const roots: string[] = [];

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function topic(lang: "de" | "en", extra = "", omit?: string): string {
  const sections = lang === "de"
    ? ["Wozu", "Voraussetzungen und Rechte", "Abläufe", "Beispiele", "Befehle und Actions", "Fehler"]
    : ["Purpose", "Requirements and permissions", "Workflows", "Examples", "Commands and actions", "Errors"];
  const body = sections.filter((section) => section !== omit).map((section) =>
    section === "Befehle und Actions" || section === "Commands and actions"
      ? `## ${section}\n\n<!-- gen:docs befehle -->\n<!-- /gen:docs -->\n`
      : `## ${section}\n\nText.${extra}\n`).join("\n");
  return `---\nid: teams\nkategorie: thema\ndomaenen: [team]\nstichwoerter: [team]\n---\n\n# Teams\n\n${body}`;
}

function errorArticle(lang: "de" | "en"): string {
  const sections = lang === "de" ? ["Bedeutung", "Typische Ursachen", "Lösung"] : ["Meaning", "Typical causes", "Solution"];
  return `---\nid: fehler/not-found\nkategorie: fehler\nstichwoerter: [x]\n---\n\n# NOT_FOUND\n\n${
    sections.map((section) => `## ${section}\n\nText.\n`).join("\n")}`;
}

/** A complete, valid documentation tree; each test breaks exactly one thing. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "check-docs-"));
  roots.push(root);
  write(root, "src/coverage/domains.json", JSON.stringify({
    domains: [{ id: "team", status: "covered", actions: ["team list"], docs: ["docs/teams.md"] }],
  }));
  write(root, "src/schema/team.json", "{}");
  write(root, "docs/fehler/katalog.json", JSON.stringify({
    NOT_FOUND: { de: { message: "x" }, en: { message: "x" }, help: "fehler/not-found" },
  }));
  write(root, "docs/teams.md", topic("de"));
  write(root, "docs/en/teams.md", topic("en"));
  write(root, "docs/fehler/not-found.md", errorArticle("de"));
  write(root, "docs/en/fehler/not-found.md", errorArticle("en"));
  for (const [path, content] of generateDocs(root)) write(root, path, content);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("check:docs (02-inhalte-und-pruefung)", () => {
  test("a complete tree has no findings", () => {
    expect(checkDocs(fixture())).toEqual([]);
  });

  test("TC-01: a registry domain without article is named", () => {
    const root = fixture();
    write(root, "src/coverage/domains.json", JSON.stringify({ domains: [
      { id: "team", status: "covered", actions: ["team list"], docs: [] },
      { id: "zone", status: "covered", actions: ["zone list"], docs: [] },
    ] }));
    expect(checkDocs(root)).toContainEqual({ file: "src/coverage/domains.json", reason: "Domäne ohne Artikel: zone" });
  });

  test("TC-02: an error code without article fails", () => {
    const root = fixture();
    write(root, "docs/fehler/katalog.json", JSON.stringify({
      NOT_FOUND: { de: { message: "x" }, en: { message: "x" }, help: "fehler/not-found" },
      RATE_LIMITED: { de: { message: "x" }, en: { message: "x" }, help: "fehler/rate-limited" },
    }));
    const reasons = checkDocs(root).map((finding) => finding.reason);
    expect(reasons).toContain("Fehlercode ohne Artikel (de): RATE_LIMITED");
    expect(reasons).toContain("Fehlercode ohne Artikel (en): RATE_LIMITED");
  });

  test("TC-03: an article without English version fails", () => {
    const root = fixture();
    rmSync(join(root, "docs/en/teams.md"));
    expect(checkDocs(root)).toContainEqual({ file: "docs/teams.md", reason: "Sprachfassung fehlt: docs/en/teams.md" });
  });

  test("TC-04: a missing required section is named", () => {
    const root = fixture();
    write(root, "docs/teams.md", topic("de", "", "Beispiele"));
    expect(checkDocs(root)).toContainEqual({ file: "docs/teams.md", reason: "Pflichtabschnitt fehlt: Beispiele" });
  });

  test("TC-05: source paths, service names, internal tools and real IDs fail", () => {
    for (const bad of [
      " Siehe src/commands/team.ts.",
      " Der club-service antwortet.",
      " Läuft auf railway.",
      " Mit rts prüfen.",
      " Verein 0ec34e70-999a-47c4-a1b1-bdb293110fa5.",
    ]) {
      const root = fixture();
      write(root, "docs/teams.md", topic("de", bad));
      for (const [path, content] of generateDocs(root)) write(root, path, content);
      expect(checkDocs(root).some((finding) => finding.reason.startsWith("Verbotener Inhalt")), bad).toBe(true);
    }
  });

  test("TC-05: placeholder IDs are allowed", () => {
    const root = fixture();
    write(root, "docs/teams.md", topic("de", " Verein 11111111-1111-4111-8111-111111111111."));
    for (const [path, content] of generateDocs(root)) write(root, path, content);
    expect(checkDocs(root)).toEqual([]);
  });

  test("TC-06: a generated section that differs from the registry fails, gen:docs repairs it", () => {
    const root = fixture();
    write(root, "src/coverage/domains.json", JSON.stringify({
      domains: [{ id: "team", status: "covered", actions: ["team list", "team create"], docs: ["docs/teams.md"] }],
    }));
    expect(checkDocs(root)).toContainEqual({ file: "docs/teams.md", reason: "Erzeugter Stand veraltet — bun run gen:docs" });
    for (const [path, content] of generateDocs(root)) write(root, path, content);
    expect(checkDocs(root)).toEqual([]);
  });

  test("the index lists both languages and the error articles", () => {
    const root = fixture();
    const index = JSON.parse(generateDocs(root).get("docs/index.json")!) as {
      artikel: Array<{ id: string; kategorie: string; pfad: { de: string; en: string } }>;
    };
    expect(index.artikel.map((entry) => entry.id)).toEqual(["fehler/not-found", "teams"]);
    expect(index.artikel[1]!.pfad).toEqual({ de: "docs/teams.md", en: "docs/en/teams.md" });
  });
});
