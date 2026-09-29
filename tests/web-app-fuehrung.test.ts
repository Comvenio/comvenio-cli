// TC-01 … TC-07 (comvenio-cli-doku 08 §13): the web-app guide reads the UI
// specifications through the shared QUELL_UMLEITUNGEN access, describes only
// surfaces whose actions carry a data-ui-spec anchor in the code, and lands as
// the generated section "So geht's in der Web-App" of each hub article.
// Fixture style follows homepage-widgets-vorlagen-docs.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkDocs, generateDocs, webAppBlock } from "../scripts/docs-lib.ts";
import { readSource, resolveSource } from "../scripts/quellen.ts";
import { bauWebAppFuehrung, istMenuepfad, kundentext, sammleAnker } from "../scripts/web-app-fuehrung.ts";

const roots: string[] = [];
function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// ─── Fixtures: specifications and code ──────────────────────────────────────

/** Newer format (oberflaechenvertrag v1): page_contracts in the frontmatter. */
const FINANCE_SPEC = `---
type: ui-spec
ui_spec_id: comvenio/finance/kasse
source_paths:
  - Frontend/web-page/src/pages/main/FinanceHub/KasseSection.tsx
oberflaechenvertrag: v1
page_contracts:
  - page: "app-ref:Frontend/web-page/src/pages/main/FinanceHub/KasseSection.tsx"
    purpose: "Finance Hub → Kasse & Konten; eigener Reiter, weil der Kassier dort abrechnet."
    mode: ACT
    action_refs:
      - comvenio/finance/kasse#buchen
---

# Kasse

## 1. Zweck

Was liegt in der Kasse, und wie buche ich einen Beleg?

## 3. Elemente

### buchen (Aktion)
Auslöser     : Klick auf „Buchen“
Wirkung      : bucht den Beleg auf das gewählte Konto
               und zeigt ihn im Journal
Führt zu     : bleibt

### zum-journal (Aktion)
Auslöser     : Klick auf „Journal“
Wirkung      : öffnet das Journal
Führt zu     : comvenio/finance/journal

### intern (Aktion)
Auslöser     : Klick auf „Neu laden“
Wirkung      : ruft den finance-service erneut ab

### nicht-gebaut (Aktion)
Auslöser     : Klick auf „Exportieren“
Wirkung      : lädt eine Datei herunter

### summe (Anzeige)
Zeigt        : den Kassenstand
`;

const JOURNAL_SPEC = `---
type: ui-spec
ui_spec_id: comvenio/finance/journal
source_paths:
  - Frontend/web-page/src/pages/main/FinanceHub/Journal.tsx
---

# Journal

## 3. Elemente

### filtern (Aktion)
Auslöser  : Wahl im Filter
Wirkung   : zeigt nur passende Buchungen
`;

/** Older format: no page_contracts, the elements alone carry the guide. */
const EVENT_SPEC = `---
type: ui-spec
ui_spec_id: comvenio/event/planer-news
source_paths:
  - Frontend/web-page/src/pages/main/EventHub/PlannerNewsPage.tsx
status: implemented
---

# Planer — News

## 1. Zweck

Abschnitt \`13\`. Mitteilungen an die Teilnehmer schreiben und anpinnen.

## 3. Elemente

### anpinnen (Aktion)
Auslöser  : Nadelsymbol an einer Karte
Wirkung   : hebt die Mitteilung nach oben
Besonders : Bis zum 2026-08-30 schlug das immer fehl
`;

/** Homepage by concept tree, anchored through a module literal. */
const HOMEPAGE_SPEC = `---
type: ui-spec
ui_spec_id: club/homepage-generator/designer
source_paths:
- Frontend/web-page/src/components/ClubHome/designer/
oberflaechenvertrag: v1
page_contracts:
- purpose: Einstieg über „Bearbeiten“ der Homepage.
  mode: ACT
---

# Homepage-Designer

## 1. Zweck

Wo steht was auf meiner Homepage?

## 3. Elemente

### veroeffentlichen (Aktion)
Auslöser  : Klick auf „Veröffentlichen“
Wirkung   : Der Entwurf wird live geschaltet
`;

/** A spec whose only contract is read-only: no guide (08 §4.2). */
const READ_ONLY_SPEC = `---
type: ui-spec
ui_spec_id: comvenio/finance/nur-lesen
source_paths:
  - Frontend/web-page/src/pages/main/FinanceHub/NurLesen.tsx
page_contracts:
  - mode: READ_ONLY
---

# Nur lesen

## 3. Elemente

### blaettern (Aktion)
Auslöser  : Klick auf „Weiter“
Wirkung   : zeigt die nächste Seite
`;

/** Tournament and meeting today: app specifications only, no web anchors. */
const TOURNAMENT_SPEC = `---
type: ui-spec
ui_spec_id: comvenio/app/spielplan
source_paths:
  - Frontend/comvenio_mobile/lib/tournament/spielplan.dart
---

# Spielplan

## 3. Elemente

### spiel-oeffnen (Aktion)
Auslöser  : Tipp auf ein Spiel
Wirkung   : öffnet das Spiel
`;

/** A workspace with comvenio-tools and web-page, anchored like the real code. */
function workspace(): string {
  const ws = tempRoot("web-app-ws-");
  const konzepte = "comvenio-tools/AI-docs/concepts";
  write(ws, `${konzepte}/finance/kasse/ui/kasse.md`, FINANCE_SPEC);
  write(ws, `${konzepte}/finance/kasse/ui/journal.md`, JOURNAL_SPEC);
  write(ws, `${konzepte}/finance/kasse/ui/nur-lesen.md`, READ_ONLY_SPEC);
  write(ws, `${konzepte}/frontend/ui/event-planer-news.md`, EVENT_SPEC);
  write(ws, `${konzepte}/club/homepage-generator/17-designer-struktur/ui/designer.md`, HOMEPAGE_SPEC);
  write(ws, `${konzepte}/comvenio-app/app-qualitaet/ui/spielplan.md`, TOURNAMENT_SPEC);
  write(ws, `${konzepte}/finance/kasse/kasse-lastenheft.md`, "---\ntype: lastenheft\n---\n# kein ui-Ordner\n");
  const web = "Frontend/web-page/src";
  write(ws, `${web}/pages/main/FinanceHub/KasseSection.tsx`, [
    `<Button data-ui-spec="comvenio/finance/kasse#buchen">Buchen</Button>`,
    `<Button data-ui-spec="comvenio/finance/kasse#zum-journal">Journal</Button>`,
    `<Button data-ui-spec="comvenio/finance/kasse#intern">Neu laden</Button>`,
    // A comment writing ABOUT anchors is no anchor (uispec.py, 2026-08-26).
    `// data-ui-spec="…" gehört ins Tag`,
  ].join("\n"));
  write(ws, `${web}/pages/main/FinanceHub/Journal.tsx`, `{/* ui-spec: comvenio/finance/journal#filtern */}\n<Select />`);
  write(ws, `${web}/pages/main/FinanceHub/NurLesen.tsx`, `<Button data-ui-spec="comvenio/finance/nur-lesen#blaettern" />`);
  write(ws, `${web}/pages/main/EventHub/PlannerNewsPage.tsx`, `<IconButton data-ui-spec={"comvenio/event/planer-news#anpinnen"} />`);
  write(ws, `${web}/components/ClubHome/designer/Werkzeugleiste.tsx`, [
    `const UI = "club/homepage-generator/designer";`,
    "export function W() { return <Button data-ui-spec={`${UI}#veroeffentlichen`} />; }",
  ].join("\n"));
  // A test naming an anchor proves nothing about the built element.
  write(ws, `${web}/pages/main/FinanceHub/Kasse.test.tsx`, `screen.getByTestId('x'); '[data-ui-spec="comvenio/finance/kasse#nicht-gebaut"]'`);
  return ws;
}

function bau(ws: string) {
  return bauWebAppFuehrung(join(ws, "comvenio-tools/AI-docs/concepts"), join(ws, "Frontend/web-page/src"));
}

// ─── TC-01 … TC-03: access through QUELL_UMLEITUNGEN ────────────────────────

describe("Zugriff auf comvenio-tools (08 §4.1)", () => {
  const SPEC = "comvenio-tools/AI-docs/concepts/finance/kasse/ui/kasse.md";

  test("TC-01: liest eine UI-Spezifikation relativ zu COMVENIO_WORKSPACE", () => {
    const ws = workspace();
    expect(readSource(SPEC, { env: { COMVENIO_WORKSPACE: ws } })).toContain("ui_spec_id: comvenio/finance/kasse");
  });

  test("TC-02: COMVENIO_TOOLS_ROOT gewinnt gegen den Workspace-Standardpfad", () => {
    const ws = workspace();
    const eigenerBaum = tempRoot("comvenio-tools-");
    write(eigenerBaum, "AI-docs/concepts/finance/kasse/ui/kasse.md", "---\nui_spec_id: aus-dem-arbeitsbaum\n---\n");
    const text = readSource(SPEC, { env: { COMVENIO_WORKSPACE: ws, COMVENIO_TOOLS_ROOT: eigenerBaum } });
    expect(text).toContain("aus-dem-arbeitsbaum");
    // web-page is not redirected by the tools switch.
    expect(resolveSource("Frontend/web-page/src", { env: { COMVENIO_WORKSPACE: ws, COMVENIO_TOOLS_ROOT: eigenerBaum } }))
      .toBe(join(ws, "Frontend/web-page/src"));
  });

  test("TC-03: fehlt comvenio-tools, nennt der Fehler Pfad und Umgehungsvariable", () => {
    const leer = tempRoot("leerer-ws-");
    expect(() => resolveSource("comvenio-tools/AI-docs/concepts", { env: { COMVENIO_WORKSPACE: leer } }))
      .toThrow(new RegExp(`erwartet unter: ${join(leer, "comvenio-tools/AI-docs/concepts").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*COMVENIO_TOOLS_ROOT`));
  });

  test("der Generator bricht ohne comvenio-tools ab statt leer zu schreiben", async () => {
    const leer = tempRoot("leerer-ws-");
    write(leer, "Frontend/web-page/src/x.tsx", "");
    const lauf = Bun.spawnSync(["bun", "run", join(import.meta.dir, "..", "scripts", "gen-web-app-fuehrung.ts"), "--check"], {
      env: { ...process.env, COMVENIO_WORKSPACE: leer, COMVENIO_TOOLS_ROOT: "", COMVENIO_WEBPAGE_ROOT: "" },
    });
    expect(lauf.exitCode).not.toBe(0);
    expect(lauf.stderr.toString()).toContain("COMVENIO_TOOLS_ROOT");
  });
});

// ─── TC-04 … TC-06: only anchored surfaces ──────────────────────────────────

describe("Auflösen gegen den Code (08 §4.2/§4.3)", () => {
  test("Anker: Literal, Kommentar und Modul-Literal zählen; Tests und Prosa nicht", () => {
    const anker = sammleAnker(join(workspace(), "Frontend/web-page/src"));
    expect(anker.has("comvenio/finance/kasse#buchen")).toBe(true);
    expect(anker.has("comvenio/finance/journal#filtern")).toBe(true);
    expect(anker.has("club/homepage-generator/designer#veroeffentlichen")).toBe(true);
    expect(anker.has("comvenio/event/planer-news#anpinnen")).toBe(true);
    expect(anker.has("comvenio/finance/kasse#nicht-gebaut")).toBe(false);
    expect([...anker].some((a) => a.includes("…"))).toBe(false);
  });

  test("TC-04: eine Spezifikation ohne aufgelösten Anker ist Hinweis, kein Eintrag", () => {
    const ws = workspace();
    write(ws, "comvenio-tools/AI-docs/concepts/finance/kasse/ui/ohne-anker.md", JOURNAL_SPEC
      .replace("comvenio/finance/journal", "comvenio/finance/ohne-anker")
      .replace("Journal.tsx", "OhneAnker.tsx"));
    const fuehrung = bau(ws);
    expect(fuehrung.hinweise).toContain("comvenio/finance/ohne-anker: kein Anker im Code");
    expect(fuehrung.hubs.finance.map((f) => f.ui_spec_id)).not.toContain("comvenio/finance/ohne-anker");
    // Only a READ_ONLY contract: skipped with its own reason.
    expect(fuehrung.hinweise).toContain("comvenio/finance/nur-lesen: kein Vertrag mit mode READ_NAVIGATE oder ACT");
  });

  test("TC-05: Homepage, Finance und Event mit Anker liefern Menüpfad, Zweck und Aktionen", () => {
    const { hubs, hinweise } = bau(workspace());
    const kasse = hubs.finance.find((f) => f.ui_spec_id === "comvenio/finance/kasse")!;
    expect(kasse).toMatchObject({
      titel: "Kasse",
      // A path from the purpose is only a placeholder (contract 08 DC-5).
      menuepfad: "Finance Hub → Kasse & Konten",
      menuepfad_offen: true,
      zweck: "Was liegt in der Kasse, und wie buche ich einen Beleg?",
    });
    expect(kasse.aktionen).toEqual([
      // Continuation lines joined; "bleibt" says nothing a guide needs.
      { element: "buchen", ausloeser: "Klick auf „Buchen“", wirkung: "bucht den Beleg auf das gewählte Konto und zeigt ihn im Journal" },
      // A reference to another surface reads as its title.
      { element: "zum-journal", ausloeser: "Klick auf „Journal“", wirkung: "öffnet das Journal", fuehrt_zu: "„Journal“" },
    ]);
    // Internal service name: the action is dropped and named, never published.
    expect(hinweise).toContain("comvenio/finance/kasse#intern: Auslöser oder Wirkung fehlt oder nennt Internes");

    const news = hubs.event.find((f) => f.ui_spec_id === "comvenio/event/planer-news")!;
    expect(news).toMatchObject({
      menuepfad: "Web-App → Planer — News",
      menuepfad_offen: true,
      zweck: "Mitteilungen an die Teilnehmer schreiben und anpinnen.",
      aktionen: [{ element: "anpinnen", ausloeser: "Nadelsymbol an einer Karte", wirkung: "hebt die Mitteilung nach oben" }],
    });
    expect(hubs.homepage.map((f) => f.titel)).toEqual(["Homepage-Designer"]);
  });

  test("TC-06: Tournament und Meeting liefern nur den Hinweis, keine erfundene Beschreibung", () => {
    const ws = workspace();
    const fuehrung = bau(ws);
    expect(fuehrung.hubs.tournament).toEqual([]);
    expect(fuehrung.hubs.meeting).toEqual([]);
    const root = tempRoot("web-app-docs-");
    write(root, "src/schema/web-app-fuehrung.json", JSON.stringify(fuehrung));
    for (const [domain, lang, satz] of [
      ["tournament", "de", "Web-App-Führung folgt, sobald UI-Spezifikationen mit Code-Ankern vorliegen."],
      ["meeting", "en", "The web app guide follows as soon as interface specifications with code anchors are available."],
    ] as const) {
      const block = webAppBlock(root, [domain], lang);
      expect(block).toContain(satz);
      expect(block).not.toContain("###");
    }
  });
});

describe("Menüpfad", () => {
  test("ein Satz mit Pfeilen ist noch kein Menüpfad", () => {
    expect(istMenuepfad("Finance Hub → Reiter Bereichsbudget direkt nach Buchhaltung")).toBe(true);
    expect(istMenuepfad("Der Kassier will die Buchhaltung lesen: Verein → Veranstaltungen → Buchungen")).toBe(false);
    expect(istMenuepfad("Wer die Buchhaltung pflegt und prüft, geht vom Verein → Veranstaltungen")).toBe(false);
  });
});

describe("kundentext", () => {
  test("lässt Internes weg statt es zu veröffentlichen", () => {
    expect(kundentext("öffnet den `fenster-posten-dialog`")).toBeNull();
    expect(kundentext("lädt über GET /clubs/{club_id}/finance")).toBeNull();
    expect(kundentext("siehe src/pages/main/x.tsx")).toBeNull();
    expect(kundentext("wählt **Monat** und/oder `Jahr`")).toBe("wählt Monat und/oder Jahr");
  });
});

// ─── TC-07: reachable through the existing index ────────────────────────────

function hubArticle(lang: "de" | "en", withMarkers = true): string {
  const sections = lang === "de"
    ? ["Wozu", "Voraussetzungen und Rechte", "Abläufe", "Beispiele", "Begriffe und Zusammenhänge", "Häufige Fragen", "So geht's in der Web-App", "Befehle und Actions", "Fehler"]
    : ["Purpose", "Requirements and permissions", "Workflows", "Examples", "Concepts and how they connect", "Frequently asked questions", "How it works in the web app", "Commands and actions", "Errors"];
  const body = sections.map((section, index) => {
    if (index === 5) return `## ${section}\n\n**Eins?**\n\nJa.\n\n**Zwei?**\n\nJa.\n\n**Drei?**\n\nJa.\n`;
    if (index === 6) return withMarkers ? `## ${section}\n\n<!-- gen:docs web-app -->\n<!-- /gen:docs web-app -->\n` : "";
    if (index === 7) return `## ${section}\n\n<!-- gen:docs befehle -->\n<!-- /gen:docs -->\n`;
    return `## ${section}\n\nText.\n`;
  }).join("\n");
  return `---\nid: veranstaltungen\nkategorie: thema\ndomaenen: [event, plan]\nstichwoerter: [fest]\n---\n\n# Veranstaltungen\n\n${body}`;
}

function docsFixture(withMarkers: boolean): string {
  const root = tempRoot("web-app-docs-");
  write(root, "src/schema/web-app-fuehrung.json", JSON.stringify(bau(workspace())));
  write(root, "docs/fehler/katalog.json", "{}");
  write(root, "docs/veranstaltungen.md", hubArticle("de", withMarkers));
  write(root, "docs/en/veranstaltungen.md", hubArticle("en", withMarkers));
  for (const [path, content] of generateDocs(root, [])) write(root, path, content);
  return root;
}

describe("Ausgabe über den bestehenden Index (08 §4.4)", () => {
  test("TC-07: DE und EN tragen den Abschnitt und sind über docs/index.json erreichbar", () => {
    const root = docsFixture(true);
    expect(checkDocs(root, [])).toEqual([]);
    const index = JSON.parse(readFileSync(join(root, "docs/index.json"), "utf8"));
    const eintrag = index.artikel.find((artikel: { id: string }) => artikel.id === "veranstaltungen");
    expect(eintrag.pfad).toEqual({ de: "docs/veranstaltungen.md", en: "docs/en/veranstaltungen.md" });
    const de = readFileSync(join(root, eintrag.pfad.de), "utf8");
    const en = readFileSync(join(root, eintrag.pfad.en), "utf8");
    expect(de).toContain("### Planer — News\n\nMenüpfad: Web-App → Planer — News (offene Stelle — Menüpfad manuell ergänzen)");
    expect(de).toContain("- Nadelsymbol an einer Karte → hebt die Mitteilung nach oben");
    expect(en).toContain("Menu path: Web-App → Planer — News (open item — add the menu path manually)");
    expect(en).toContain("The descriptions below come from the German interface specifications");
    // Surfaces of other hubs stay out of the event article.
    expect(de).not.toContain("### Kasse");
  });

  test("check:docs meldet einen Hub-Artikel ohne den Abschnitt", () => {
    const reasons = checkDocs(docsFixture(false), []).map((finding) => `${finding.file} — ${finding.reason}`);
    expect(reasons).toContain("docs/veranstaltungen.md — Pflichtabschnitt fehlt: So geht's in der Web-App");
    expect(reasons).toContain("docs/en/veranstaltungen.md — Pflichtabschnitt fehlt: How it works in the web app");
  });

  test("der eingecheckte Stand hält den Abschnitt in allen fünf Hub-Artikeln", () => {
    const root = join(import.meta.dir, "..");
    for (const artikel of ["homepage", "finanzen", "veranstaltungen", "turniere", "meetings"]) {
      expect(readFileSync(join(root, "docs", `${artikel}.md`), "utf8")).toContain("## So geht's in der Web-App\n\n<!-- gen:docs web-app -->");
      expect(readFileSync(join(root, "docs/en", `${artikel}.md`), "utf8")).toContain("## How it works in the web app\n\n<!-- gen:docs web-app -->");
    }
  });
});
