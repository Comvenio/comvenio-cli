// TC-02 und TC-07 (comvenio-cli-doku 06 §4.2/§4.5, §13): der generierte
// "Widgets"-Abschnitt meldet ein Widget ohne Erklärung als eigenen Befund,
// und der generierte "Vorlagen"-Abschnitt nennt immer alle acht Vorlagen —
// als benannte offene Stelle, wenn dem Schema die Kurzbeschreibung fehlt,
// nie als erfundener Text. Stil und Fixture-Aufbau folgen check-docs.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { InventoryAction } from "../scripts/action-inventory.ts";
import { checkDocs, generateDocs, vorlagenBlock, widgetsBlock } from "../scripts/docs-lib.ts";

const TEMPLATES = ["elegance", "sport", "community", "minimal", "festlich", "modern", "classic", "flex"];

const INVENTORY: InventoryAction[] = [
  { action_id: "cai.homepage.03.show", domain: "homepage", operations: [{ operation: "private", risk: "read", scopes: ["club.read"] }] },
  { action_id: "cai.homepage.05.convert", domain: "homepage", operations: [{ operation: "convert", risk: "read", scopes: ["club.write"] }] },
];

const roots: string[] = [];
function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A minimal homepage schema, shaped like `src/schema/homepage.json` but only the fields the doc generator reads. */
function schema(widgets: Record<string, { beschreibung?: unknown }>, templateBeschreibung?: Record<string, { de: string; en: string }>) {
  return JSON.stringify({
    widget_kinds: Object.keys(widgets),
    widgets,
    templates: TEMPLATES,
    ...(templateBeschreibung ? { template_beschreibung: templateBeschreibung } : {}),
  });
}

function homepageArticle(lang: "de" | "en"): string {
  const sections = lang === "de"
    ? ["Wozu", "Voraussetzungen und Rechte", "Abläufe", "Beispiele", "Befehle und Actions", "Fehler"]
    : ["Purpose", "Requirements and permissions", "Workflows", "Examples", "Commands and actions", "Errors"];
  const body = sections.map((section) => {
    if (section === "Befehle und Actions" || section === "Commands and actions") {
      return `## ${section}\n\n<!-- gen:docs befehle -->\n<!-- /gen:docs -->\n\n## Widgets\n\n<!-- gen:docs widgets -->\n<!-- /gen:docs widgets -->\n\n## Vorlagen\n\n<!-- gen:docs vorlagen -->\n<!-- /gen:docs vorlagen -->\n`;
    }
    return `## ${section}\n\nText.\n`;
  }).join("\n");
  return `---\nid: homepage\nkategorie: thema\ndomaenen: [homepage]\nstichwoerter: [homepage]\n---\n\n# Homepage\n\n${body}`;
}

function errorArticle(lang: "de" | "en"): string {
  const sections = lang === "de" ? ["Bedeutung", "Typische Ursachen", "Lösung"] : ["Meaning", "Typical causes", "Solution"];
  return `---\nid: fehler/not-found\nkategorie: fehler\nstichwoerter: [x]\n---\n\n# NOT_FOUND\n\n${sections.map((section) => `## ${section}\n\nText.\n`).join("\n")}`;
}

/** A complete, valid tree with one homepage widget missing its explanation. */
function fixture(widgets: Record<string, { beschreibung?: unknown }>, templateBeschreibung?: Record<string, { de: string; en: string }>): string {
  const root = mkdtempSync(join(tmpdir(), "homepage-docs-"));
  roots.push(root);
  write(root, "src/schema/homepage.json", schema(widgets, templateBeschreibung));
  write(root, "docs/fehler/katalog.json", JSON.stringify({ NOT_FOUND: { de: { message: "x" }, en: { message: "x" }, help: "fehler/not-found" } }));
  write(root, "docs/homepage.md", homepageArticle("de"));
  write(root, "docs/en/homepage.md", homepageArticle("en"));
  write(root, "docs/fehler/not-found.md", errorArticle("de"));
  write(root, "docs/en/fehler/not-found.md", errorArticle("en"));
  for (const [path, content] of generateDocs(root, INVENTORY)) write(root, path, content);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Widgets/Vorlagen-Abschnitt (comvenio-cli-doku 06 §4.2/§4.5)", () => {
  test("ein vollständig erklärtes Schema hat keine Befunde", () => {
    const beschreibung = { kategorie: "inhalt", zweck: { de: "x", en: "x" }, datenquelle: { de: "x", en: "x" }, macht_oeffentlich: { de: "x", en: "x" }, passt_zu: { de: [], en: [] } };
    const templateBeschreibung = Object.fromEntries(TEMPLATES.map((id) => [id, { de: "x", en: "x" }]));
    const root = fixture({ hero: { beschreibung }, news: { beschreibung } }, templateBeschreibung);
    expect(checkDocs(root, INVENTORY)).toEqual([]);
  });

  test("TC-02: ein Widget ohne Erklärung meldet sich mit Namen, nicht als Sammelbefund", () => {
    const beschreibung = { kategorie: "inhalt", zweck: { de: "x", en: "x" }, datenquelle: { de: "x", en: "x" }, macht_oeffentlich: { de: "x", en: "x" }, passt_zu: { de: [], en: [] } };
    const templateBeschreibung = Object.fromEntries(TEMPLATES.map((id) => [id, { de: "x", en: "x" }]));
    const root = fixture({ hero: { beschreibung }, news: {} }, templateBeschreibung);
    const reasons = checkDocs(root, INVENTORY).map((finding) => finding.reason);
    expect(reasons).toContain("Widget ohne Erklärung: news");
    expect(reasons).not.toContain("Widget ohne Erklärung: hero");
  });

  test("das generierte Widgets-JSON zeigt eine offene Stelle statt erfundenen Text", () => {
    const root = fixture({ hero: {} });
    const block = widgetsBlock(root, "de");
    expect(block).toContain("- `hero` — offene Stelle — Erklärung fehlt");
  });

  test("TC-07: der generierte Vorlagen-Abschnitt nennt alle acht Vorlagen", () => {
    const root = fixture({});
    const block = vorlagenBlock(root, "de");
    for (const id of TEMPLATES) expect(block).toContain(`\`${id}\``);
    expect((block.match(/^- /gmu) ?? []).length).toBe(8);
  });

  test("eine fehlende Vorlagen-Kurzbeschreibung ist eine offene Stelle, keine Erfindung", () => {
    const root = fixture({});
    expect(vorlagenBlock(root, "de")).toContain("- `modern` — offene Stelle — Erklärung fehlt");
  });

  test("mit Kurzbeschreibung zeigt der Vorlagen-Abschnitt den echten Text", () => {
    const root = fixture({}, { modern: { de: "Klare Flächen.", en: "Clean surfaces." } });
    expect(vorlagenBlock(root, "de")).toContain("- `modern` — Klare Flächen.");
    expect(vorlagenBlock(root, "en")).toContain("- `modern` — Clean surfaces.");
  });

  test("ohne Homepage-Domäne bleibt der Artikel unberührt (kein Marker-Zwang)", () => {
    // Gegenprobe zu check-docs.test.ts: eine team-Domäne ohne die Marker
    // erzeugt KEINEN Widgets/Vorlagen-Befund — die Pflicht gilt nur für
    // Artikel, die die homepage-Domäne tragen.
    const root = mkdtempSync(join(tmpdir(), "homepage-docs-"));
    roots.push(root);
    write(root, "docs/fehler/katalog.json", JSON.stringify({ NOT_FOUND: { de: { message: "x" }, en: { message: "x" }, help: "fehler/not-found" } }));
    const teamInventory: InventoryAction[] = [{ action_id: "cai.team.01.list", domain: "team", operations: [{ operation: "list", risk: "read", scopes: ["club.read"] }] }];
    const teamArticle = (lang: "de" | "en") => {
      const sections = lang === "de"
        ? ["Wozu", "Voraussetzungen und Rechte", "Abläufe", "Beispiele", "Befehle und Actions", "Fehler"]
        : ["Purpose", "Requirements and permissions", "Workflows", "Examples", "Commands and actions", "Errors"];
      const body = sections.map((section) => section === "Befehle und Actions" || section === "Commands and actions"
        ? `## ${section}\n\n<!-- gen:docs befehle -->\n<!-- /gen:docs -->\n`
        : `## ${section}\n\nText.\n`).join("\n");
      return `---\nid: teams\nkategorie: thema\ndomaenen: [team]\nstichwoerter: [team]\n---\n\n# Teams\n\n${body}`;
    };
    write(root, "docs/teams.md", teamArticle("de"));
    write(root, "docs/en/teams.md", teamArticle("en"));
    write(root, "docs/fehler/not-found.md", errorArticle("de"));
    write(root, "docs/en/fehler/not-found.md", errorArticle("en"));
    for (const [path, content] of generateDocs(root, teamInventory)) write(root, path, content);
    expect(checkDocs(root, teamInventory)).toEqual([]);
  });
});
