import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { InventoryAction } from "../scripts/action-inventory.ts";
import { checkDocs, generateDocs } from "../scripts/docs-lib.ts";

// A tiny connector catalog: the generated section lists these actions.
const INVENTORY: InventoryAction[] = [
  { action_id: "cai.team.01.list", domain: "team", operations: [{ operation: "list", risk: "read", scopes: ["club.read"] }] },
];

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
  write(root, "src/commands/team.ts", 'cli.command("team <verb>", "Teams");');
  write(root, "docs/fehler/katalog.json", JSON.stringify({
    NOT_FOUND: { de: { message: "x" }, en: { message: "x" }, help: "fehler/not-found" },
  }));
  write(root, "docs/teams.md", topic("de"));
  write(root, "docs/en/teams.md", topic("en"));
  write(root, "docs/fehler/not-found.md", errorArticle("de"));
  write(root, "docs/en/fehler/not-found.md", errorArticle("en"));
  for (const [path, content] of generateDocs(root, INVENTORY)) write(root, path, content);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("check:docs (02-inhalte-und-pruefung)", () => {
  test("a complete tree has no findings", () => {
    expect(checkDocs(fixture(), INVENTORY)).toEqual([]);
  });

  test("TC-02: an error code without article fails", () => {
    const root = fixture();
    write(root, "docs/fehler/katalog.json", JSON.stringify({
      NOT_FOUND: { de: { message: "x" }, en: { message: "x" }, help: "fehler/not-found" },
      RATE_LIMITED: { de: { message: "x" }, en: { message: "x" }, help: "fehler/rate-limited" },
    }));
    const reasons = checkDocs(root, INVENTORY).map((finding) => finding.reason);
    expect(reasons).toContain("Fehlercode ohne Artikel (de): RATE_LIMITED");
    expect(reasons).toContain("Fehlercode ohne Artikel (en): RATE_LIMITED");
  });

  test("TC-03: an article without English version fails", () => {
    const root = fixture();
    rmSync(join(root, "docs/en/teams.md"));
    expect(checkDocs(root, INVENTORY)).toContainEqual({ file: "docs/teams.md", reason: "Sprachfassung fehlt: docs/en/teams.md" });
  });

  test("TC-04: a missing required section is named", () => {
    const root = fixture();
    write(root, "docs/teams.md", topic("de", "", "Beispiele"));
    expect(checkDocs(root, INVENTORY)).toContainEqual({ file: "docs/teams.md", reason: "Pflichtabschnitt fehlt: Beispiele" });
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
      for (const [path, content] of generateDocs(root, INVENTORY)) write(root, path, content);
      expect(checkDocs(root, INVENTORY).some((finding) => finding.reason.startsWith("Verbotener Inhalt")), bad).toBe(true);
    }
  });

  test("TC-05: placeholder IDs are allowed", () => {
    const root = fixture();
    write(root, "docs/teams.md", topic("de", " Verein 11111111-1111-4111-8111-111111111111."));
    for (const [path, content] of generateDocs(root, INVENTORY)) write(root, path, content);
    expect(checkDocs(root, INVENTORY)).toEqual([]);
  });

  test("TC-06: a generated section that differs from the connector catalog fails, gen:docs repairs it", () => {
    const root = fixture();
    const changed: InventoryAction[] = [...INVENTORY,
      { action_id: "cai.team.02.create", domain: "team", operations: [{ operation: "create", risk: "critical_write", scopes: ["club.write"] }] }];
    expect(checkDocs(root, changed)).toContainEqual({ file: "docs/teams.md", reason: "Erzeugter Stand veraltet — bun run gen:docs" });
    for (const [path, content] of generateDocs(root, changed)) write(root, path, content);
    expect(checkDocs(root, changed)).toEqual([]);
    expect(generateDocs(root, changed).size).toBeGreaterThan(0);
  });

  test("the generated section lists the actions, and a domain without action says so", () => {
    const root = fixture();
    const written = readFileSync(join(root, "docs/teams.md"), "utf8");
    expect(written).toContain("`cai.team.01.list` — list (lesen)");
    expect(written).not.toContain("comvenio team list");
    expect(generateDocs(root, []).get("docs/teams.md")).toContain("Noch keine Action");
  });

  test("an action domain that no article claims fails; seasonal teams belong to team", () => {
    const root = fixture();
    const orphan: InventoryAction[] = [...INVENTORY,
      { action_id: "cai.ghost.01.list", domain: "ghost", operations: [{ operation: "list", risk: "read", scopes: ["club.read"] }] }];
    expect(checkDocs(root, orphan)).toContainEqual({ file: "scripts/docs-lib.ts", reason: "Actions ohne Artikel: ghost" });
    const seasonal: InventoryAction[] = [...INVENTORY,
      { action_id: "cai.teams.01.list", domain: "teams", operations: [{ operation: "list", risk: "read", scopes: ["club.read"] }] }];
    for (const [path, content] of generateDocs(root, seasonal)) write(root, path, content);
    expect(checkDocs(root, seasonal)).toEqual([]);
    expect(readFileSync(join(root, "docs/teams.md"), "utf8")).toContain("`cai.teams.01.list`");
  });

  test("device tokens are forbidden in customer texts (Tom 2026-09-28)", () => {
    const root = fixture();
    write(root, "docs/teams.md", topic("de", " Anmeldung mit Geräte-Token."));
    for (const [path, content] of generateDocs(root, INVENTORY)) write(root, path, content);
    expect(checkDocs(root, INVENTORY).some((finding) => finding.reason === "Verbotener Inhalt (Geräte-Token)")).toBe(true);
  });

  test("a start marker without end marker fails", () => {
    const root = fixture();
    write(root, "docs/teams.md", topic("de").replace("<!-- /gen:docs -->", ""));
    expect(checkDocs(root, INVENTORY).some((finding) => finding.reason.startsWith("Erzeugter Abschnitt fehlt"))).toBe(true);
  });

  test("an unknown kategorie or diverging language versions fail", () => {
    const root = fixture();
    write(root, "docs/en/teams.md", topic("en").replace("kategorie: thema", "kategorie: archiv"));
    const reasons = checkDocs(root, INVENTORY).map((finding) => finding.reason);
    expect(reasons).toContain("Unbekannte kategorie: archiv");
    expect(reasons).toContain("Sprachfassungen weichen ab (kategorie): docs/en/teams.md");
  });

  test("TC-05: forbidden content in the frontmatter and HTTP routes fail, self-service does not", () => {
    const root = fixture();
    write(root, "docs/teams.md", topic("de").replace("stichwoerter: [team]", "stichwoerter: [src/commands/team.ts]"));
    for (const [path, content] of generateDocs(root, INVENTORY)) write(root, path, content);
    expect(checkDocs(root, INVENTORY).some((finding) => finding.reason === "Verbotener Inhalt (Quellpfad)")).toBe(true);

    const route = fixture();
    write(route, "docs/teams.md", topic("de", " Intern GET /member/teams."));
    for (const [path, content] of generateDocs(route, INVENTORY)) write(route, path, content);
    expect(checkDocs(route, INVENTORY).some((finding) => finding.reason === "Verbotener Inhalt (HTTP-Route)")).toBe(true);

    const selfService = fixture();
    write(selfService, "docs/teams.md", topic("de", " Das Self-Service-Portal und self-service helfen."));
    for (const [path, content] of generateDocs(selfService, INVENTORY)) write(selfService, path, content);
    expect(checkDocs(selfService, INVENTORY)).toEqual([]);
  });

  test("TC-05: a real UUID with a repeated prefix is still found", () => {
    const root = fixture();
    write(root, "docs/teams.md", topic("de", " Verein 00000000-4c2a-4b1d-9e3f-7a6b5c4d3e2f."));
    for (const [path, content] of generateDocs(root, INVENTORY)) write(root, path, content);
    expect(checkDocs(root, INVENTORY).some((finding) => finding.reason === "Verbotener Inhalt (echte Kennung (UUID))")).toBe(true);
  });

  test("the index lists both languages and the error articles", () => {
    const root = fixture();
    const index = JSON.parse(generateDocs(root, INVENTORY).get("docs/index.json")!) as {
      artikel: Array<{ id: string; kategorie: string; pfad: { de: string; en: string } }>;
    };
    expect(index.artikel.map((entry) => entry.id)).toEqual(["fehler/not-found", "teams"]);
    expect(index.artikel[1]!.pfad).toEqual({ de: "docs/teams.md", en: "docs/en/teams.md" });
  });
});
