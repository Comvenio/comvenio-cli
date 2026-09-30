/**
 * Web-app guide (comvenio-cli-doku 08): "So geht's in der Web-App" per hub
 * article, built from the UI specifications in comvenio-tools and resolved
 * against the `data-ui-spec` anchors in web-page.
 *
 * Without an anchor there is no guide (08 §0): an anchor is the proof that a
 * description belongs to an element that was actually built. A surface whose
 * actions have no anchor is skipped and counted as a hint, never described
 * from the specification alone.
 *
 * Pure functions over two directories — the generator script
 * (gen-web-app-fuehrung.ts) resolves them through quellen.ts, the tests pass
 * throwaway fixture trees.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { kundentextVerstoss } from "./docs-lib.ts";

/** Hubs in the order of D-DOK-16. */
export const HUBS = ["homepage", "finance", "event", "tournament", "meeting"] as const;
export type Hub = (typeof HUBS)[number];

/**
 * Which surface belongs to which hub article. Homepage by the concept tree
 * (the designer lives in ClubHome components shared with the club pages),
 * the others by the web-page directory of the surface.
 */
const HUB_REGELN: ReadonlyArray<{ hub: Hub; konzept?: string; web?: string }> = [
  { hub: "homepage", konzept: "club/homepage-generator/" },
  { hub: "finance", web: "src/pages/main/FinanceHub/" },
  { hub: "event", web: "src/pages/main/EventHub/" },
  { hub: "tournament", web: "src/pages/main/TournamentHub/" },
  { hub: "meeting", web: "src/pages/main/MeetingHub/" },
];

const WEB_PREFIX = "Frontend/web-page/";
// 08 §4.2: only contracts a person navigates or acts on lead to a guide.
const FUEHRUNGS_MODI = new Set(["READ_NAVIGATE", "ACT"]);

export interface Aktion {
  element: string;
  ausloeser: string;
  wirkung: string;
  fuehrt_zu?: string;
}

export interface Flaeche {
  ui_spec_id: string;
  titel: string;
  menuepfad: string;
  /** true when no menu path could be derived — the text is a placeholder. */
  menuepfad_offen: boolean;
  zweck: string | null;
  aktionen: Aktion[];
}

export interface WebAppFuehrung {
  version: 1;
  hubs: Record<Hub, Flaeche[]>;
  /** Skipped specifications of a hub, with the reason (08 DC-3). */
  hinweise: string[];
}

function dateien(dir: string, passt: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "_archiv" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) dateien(path, passt, out);
    else if (passt(path)) out.push(path);
  }
  return out;
}

// ─── Anchors ────────────────────────────────────────────────────────────────

// The anchor forms follow the harness checker (workspace/scripts/uispec.py),
// which learned them from incidents: an id must LOOK like one (a comment that
// writes about `data-ui-spec="…"` is no anchor), and a module literal counts
// only when it is defined once, unindented, in the form of a spec id.
const ANKER_FORM = /^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+#[a-z0-9-]+$/u;
const LITERAL_ANKER = /data-ui-spec=(?:["']([^"'\n]+)["']|\{\s*["'`]([^"'`$\n]+)["'`]\s*\})/gu;
const KOMMENTAR_ANKER = /(?:\/\/|\{\/\*)\s*ui-spec:\s*([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+#[a-z0-9-]+)/gu;
const TEMPLATE_ANKER = /data-ui-spec=\{\s*`\$\{([A-Za-z_$][\w$]*)\}(#[a-z0-9-]+)`\s*\}/gu;
const MODUL_LITERAL = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*["']([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+)["']\s*;?\s*$/gmu;

function modulLiterale(src: string): Map<string, string> {
  const gefunden = new Map<string, string[]>();
  for (const m of src.matchAll(MODUL_LITERAL)) gefunden.set(m[1]!, [...(gefunden.get(m[1]!) ?? []), m[2]!]);
  // Defined twice is ambiguous — guessing would be worse than looking away.
  return new Map([...gefunden].filter(([, werte]) => werte.length === 1).map(([name, werte]) => [name, werte[0]!]));
}

/**
 * Every `<ui_spec_id>#<element>` anchor in the web-page sources: literal
 * attributes, `// ui-spec:` comments, and template strings over a module
 * literal (`const UI = "club/homepage-generator/designer"` … `${UI}#baustein-felder`).
 * Tests are no proof of a built element and stay out.
 */
export function sammleAnker(webSrc: string): Set<string> {
  const anker = new Set<string>();
  const quellen = dateien(webSrc, (path) => /\.(?:tsx?|jsx?)$/u.test(path) && !/\.(?:test|spec)\.[jt]sx?$/u.test(path) && !path.includes("__tests__"));
  for (const path of quellen) {
    const src = readFileSync(path, "utf8");
    if (!src.includes("ui-spec")) continue;
    const literale = modulLiterale(src);
    const werte = [
      ...[...src.matchAll(LITERAL_ANKER)].map((m) => m[1] ?? m[2]),
      ...[...src.matchAll(KOMMENTAR_ANKER)].map((m) => m[1]),
      ...[...src.matchAll(TEMPLATE_ANKER)].map((m) => (literale.has(m[1]!) ? `${literale.get(m[1]!)}${m[2]}` : undefined)),
    ];
    for (const wert of werte) if (wert && ANKER_FORM.test(wert)) anker.add(wert);
  }
  return anker;
}

// ─── Specifications ─────────────────────────────────────────────────────────

interface Spezifikation {
  pfad: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

function leseSpezifikation(konzepte: string, path: string): Spezifikation | string {
  const raw = readFileSync(path, "utf8").replace(/\r\n/gu, "\n");
  const pfad = relative(konzepte, path).replace(/\\/gu, "/");
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(raw);
  if (!match) return `${pfad}: kein Frontmatter`;
  try {
    const frontmatter = Bun.YAML.parse(match[1]!) as Record<string, unknown> | null;
    if (!frontmatter || typeof frontmatter !== "object") return `${pfad}: Frontmatter leer`;
    return { pfad, frontmatter, body: raw.slice(match[0].length) };
  } catch {
    return `${pfad}: Frontmatter nicht lesbar`;
  }
}

interface Vertrag {
  page?: string;
  purpose?: string;
  mode?: string;
}

function vertraege(spec: Spezifikation): Vertrag[] {
  const liste = spec.frontmatter.page_contracts;
  return Array.isArray(liste) ? (liste.filter((v) => v && typeof v === "object") as Vertrag[]) : [];
}

/** The web-page path a surface lives at: the first contract page, else the first web-page source path. */
function webPfad(spec: Spezifikation): string | null {
  const kandidaten = [
    ...vertraege(spec).map((v) => (typeof v.page === "string" ? v.page.replace(/^app-ref:/u, "") : "")),
    ...(Array.isArray(spec.frontmatter.source_paths) ? (spec.frontmatter.source_paths as unknown[]).map(String) : []),
  ];
  const treffer = kandidaten.find((pfad) => pfad.startsWith(WEB_PREFIX));
  return treffer ? treffer.slice(WEB_PREFIX.length) : null;
}

export function hubVon(spec: { pfad: string; frontmatter: Record<string, unknown> } & { body?: string }): Hub | null {
  const web = webPfad({ body: "", ...spec });
  for (const regel of HUB_REGELN) {
    if (regel.konzept && spec.pfad.startsWith(regel.konzept)) return regel.hub;
    if (regel.web && web?.startsWith(regel.web)) return regel.hub;
  }
  return null;
}

// Internal identifiers a customer cannot act on: element ids (`fenster-posten-dialog`)
// and spec or file paths (`comvenio/event/planer`, `mockups/belegerfassung`).
const INTERNE_KENNUNG = /(?<![\wÄÖÜäöüß-])[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?![\wÄÖÜäöüß-])|(?<![\wÄÖÜäöüß])[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+(?:[.#][\w.-]+)?/gu;
const KEINE_KENNUNG = new Set(["und/oder"]);
// Specifications quote decisions by person ("… will die Buchhaltung …"); the
// public documentation must not (tests/public-documentation.test.ts, same pattern).
const PERSONENNAME = new RegExp(`\\b(?:${"To" + "m"}|${"Tho" + "mas"})\\b`, "iu");
const SPEC_VERWEIS = /(?<![\wÄÖÜäöüß])([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+)(#[a-z0-9-]+)?/gu;

/**
 * Customer text from a specification field: emphasis and code spans unwrapped,
 * whitespace collapsed, a reference to another surface replaced by its title.
 * `null` when the text still names an internal identifier or something a
 * customer article must not contain (source path, internal service, route, …)
 * — the same rule check:docs enforces on every article.
 */
export function kundentext(text: string, titel: ReadonlyMap<string, string> = new Map()): string | null {
  const glatt = text
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(SPEC_VERWEIS, (treffer, id: string) => (titel.has(id) ? `„${titel.get(id)}“` : treffer))
    .replace(/\s+/gu, " ")
    .trim();
  if (!glatt) return null;
  if ([...glatt.matchAll(INTERNE_KENNUNG)].some((m) => !KEINE_KENNUNG.has(m[0]))) return null;
  if (PERSONENNAME.test(glatt)) return null;
  return kundentextVerstoss(glatt) === null ? glatt : null;
}

/** Text of `## <nummer>. <titel>` up to the next `## `. */
function abschnitt(body: string, titel: RegExp): string | null {
  const zeilen = body.split("\n");
  const start = zeilen.findIndex((zeile) => /^## /u.test(zeile) && titel.test(zeile));
  if (start === -1) return null;
  const rest = zeilen.slice(start + 1);
  const ende = rest.findIndex((zeile) => zeile.startsWith("## "));
  return (ende === -1 ? rest : rest.slice(0, ende)).join("\n");
}

function titelVon(spec: Spezifikation): string | null {
  const h1 = /^# (.+)$/mu.exec(spec.body)?.[1];
  return kundentext(h1 ?? String(spec.frontmatter.name ?? ""));
}

/** The first paragraph of "## 1. Zweck" — written for people, unlike `purpose`, which explains the placement. */
function zweckVon(spec: Spezifikation): string | null {
  const text = abschnitt(spec.body, /^## (?:1\. )?Zweck\b/u);
  if (text === null) return null;
  const absatz = text.split(/\n\s*\n/u).map((teil) => teil.trim()).find((teil) => teil && !teil.startsWith(">"));
  // Older specifications open with their planner section number ("Abschnitt `13`.").
  return absatz ? kundentext(absatz.replace(/^Abschnitt `?\d+`?\.\s*/u, "")) : null;
}

/**
 * A navigation path written into a contract purpose ("Finance Hub → Buchhaltung → …").
 * It must read like one: no colon, and a first step of at most four words — a
 * sentence that merely contains arrows ("X will die Buchhaltung lesen: Verein →
 * …") is prose, not a menu path.
 */
export function istMenuepfad(satz: string): boolean {
  const schritte = satz.split("→").map((schritt) => schritt.trim());
  return schritte.length >= 2 && !satz.includes(":") && schritte[0]!.split(/\s+/u).length <= 4;
}

/**
 * The arrow sentence of a purpose, used as the placeholder text. It is never a
 * closed menu path: contract 08 DC-5 derives those only from source_paths and
 * the surrounding navigation, and a purpose may name a tab the navigation calls
 * differently ("Bereichsbudget" vs. "Budgetplanung").
 */
function menuepfadHinweisVon(spec: Spezifikation): string | null {
  for (const vertrag of vertraege(spec)) {
    if (typeof vertrag.purpose !== "string") continue;
    const satz = vertrag.purpose.split(/;\s|\.\s/u).find((teil) => teil.includes("→") && istMenuepfad(teil));
    const text = satz ? kundentext(satz.replace(/\.$/u, "")) : null;
    if (text) return text;
  }
  return null;
}

interface Element {
  id: string;
  art: string;
  felder: Map<string, string>;
}

/** The `### <id> (<art>)` blocks of "## 3. Elemente" with their `Feld : Wert` lines. */
export function elemente(body: string): Element[] {
  const text = abschnitt(body, /^## (?:3\. )?Elemente\b/u) ?? "";
  const liste: Element[] = [];
  let aktuell: Element | null = null;
  let feld: string | null = null;
  for (const zeile of text.split("\n")) {
    const kopf = /^### ([a-z0-9][a-z0-9-]*) \(([^)]+)\)\s*$/u.exec(zeile);
    if (kopf) {
      aktuell = { id: kopf[1]!, art: kopf[2]!, felder: new Map() };
      liste.push(aktuell);
      feld = null;
      continue;
    }
    if (!aktuell) continue;
    const eintrag = /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß ]*?)\s*:\s(.*)$/u.exec(zeile);
    if (eintrag) {
      feld = eintrag[1]!;
      aktuell.felder.set(feld, eintrag[2]!.trim());
    } else if (feld && /^\s+\S/u.test(zeile)) {
      aktuell.felder.set(feld, `${aktuell.felder.get(feld)} ${zeile.trim()}`);
    } else if (!zeile.trim()) {
      feld = null;
    }
  }
  return liste;
}

function aktionenVon(spec: Spezifikation, id: string, anker: ReadonlySet<string>, titel: ReadonlyMap<string, string>, hinweise: string[]): Aktion[] {
  const aktionen: Aktion[] = [];
  for (const element of elemente(spec.body)) {
    if (element.art !== "Aktion" || !anker.has(`${id}#${element.id}`)) continue;
    const ausloeser = kundentext(element.felder.get("Auslöser") ?? "", titel);
    const wirkung = kundentext(element.felder.get("Wirkung") ?? "", titel);
    if (!ausloeser || !wirkung) {
      hinweise.push(`${id}#${element.id}: Auslöser oder Wirkung fehlt oder nennt Internes`);
      continue;
    }
    // "bleibt" (no change of surface) says nothing a guide needs; an internal
    // target drops only this field, not the action.
    const ziel = element.felder.get("Führt zu");
    const fuehrtZu = ziel && !/^bleibt\b/u.test(ziel.trim()) ? kundentext(ziel, titel) : null;
    aktionen.push({ element: element.id, ausloeser, wirkung, ...(fuehrtZu ? { fuehrt_zu: fuehrtZu } : {}) });
  }
  return aktionen;
}

/**
 * Builds the guide from the concept tree (`konzepte` = comvenio-tools/AI-docs/concepts)
 * and the web-page sources (`webSrc` = Frontend/web-page/src).
 */
export function bauWebAppFuehrung(konzepte: string, webSrc: string): WebAppFuehrung {
  const anker = sammleAnker(webSrc);
  const hubs = Object.fromEntries(HUBS.map((hub) => [hub, [] as Flaeche[]])) as Record<Hub, Flaeche[]>;
  const hinweise: string[] = [];
  const specs: Spezifikation[] = [];
  for (const path of dateien(konzepte, (p) => /[\\/]ui[\\/][^\\/]+\.md$/u.test(p))) {
    const spec = leseSpezifikation(konzepte, path);
    if (typeof spec === "string") hinweise.push(spec);
    else if (spec.frontmatter.type === "ui-spec") specs.push(spec);
  }
  // Titles of every surface, so "führt zu comvenio/event/planer" reads as its title.
  const titel = new Map<string, string>();
  for (const spec of specs) {
    const name = titelVon(spec);
    if (spec.frontmatter.ui_spec_id && name) titel.set(String(spec.frontmatter.ui_spec_id), name);
  }
  for (const spec of specs) {
    const hub = hubVon(spec);
    if (!hub) continue;
    const id = String(spec.frontmatter.ui_spec_id ?? "");
    if (!id) {
      hinweise.push(`${spec.pfad}: ohne ui_spec_id`);
      continue;
    }
    // A specification with contracts leads only through a navigate/act contract (08 §4.2).
    const liste = vertraege(spec);
    if (liste.length > 0 && !liste.some((v) => FUEHRUNGS_MODI.has(String(v.mode)))) {
      hinweise.push(`${id}: kein Vertrag mit mode READ_NAVIGATE oder ACT`);
      continue;
    }
    const aktionen = aktionenVon(spec, id, anker, titel, hinweise);
    if (aktionen.length === 0) {
      hinweise.push(`${id}: kein Anker im Code`);
      continue;
    }
    const name = titel.get(id) ?? id;
    hubs[hub].push({
      ui_spec_id: id,
      titel: name,
      menuepfad: menuepfadHinweisVon(spec) ?? `Web-App → ${name}`,
      menuepfad_offen: true,
      zweck: zweckVon(spec),
      aktionen,
    });
  }
  for (const hub of HUBS) hubs[hub].sort((a, b) => a.ui_spec_id.localeCompare(b.ui_spec_id));
  return { version: 1, hubs, hinweise: [...new Set(hinweise)].sort() };
}
