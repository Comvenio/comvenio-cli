/**
 * Customer documentation of the CLI (02-inhalte-und-pruefung): one article per
 * topic and per public error code, German in docs/, English in docs/en/.
 *
 * Every article carries a small frontmatter (id, kategorie, domaenen,
 * stichwoerter). From it `gen:docs` builds docs/index.json and the section
 * "Befehle und Actions", which is generated from the connector actions and
 * the domain schemas of cai.schema.02, never written by hand. `check:docs`
 * fails on every gap.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { K12_SCHEMA_DOMAINS } from "../apps/mcp-server/src/tools/content-homepage-news-data/schema-registry.ts";
import type { InventoryAction } from "./action-inventory.ts";
import type { Hub, WebAppFuehrung } from "./web-app-fuehrung.ts";

export type Lang = "de" | "en";

export const TOPIC_SECTIONS: Record<Lang, readonly string[]> = {
  de: ["Wozu", "Voraussetzungen und Rechte", "Abläufe", "Beispiele", "Befehle und Actions", "Fehler"],
  en: ["Purpose", "Requirements and permissions", "Workflows", "Examples", "Commands and actions", "Errors"],
};

// Begriffe/FAQ (comvenio-cli-doku 07 §4.1): extra required sections of the
// topic template, but only for the hub articles of these domains — the other
// topic articles (and homepage.md, which carries widgets/templates instead,
// 07 TC-04) stay valid without them. Placed after "Beispiele", before
// "Befehle und Actions".
export const FACHWISSEN_SECTIONS: Record<Lang, readonly string[]> = {
  de: ["Begriffe und Zusammenhänge", "Häufige Fragen"],
  en: ["Concepts and how they connect", "Frequently asked questions"],
};
export const FACHWISSEN_DOMAINS: ReadonlySet<string> = new Set(["finance", "event", "tournament", "meeting"]);
// 07 TC-06: at least this many question/answer pairs under "Häufige Fragen".
export const MIN_FAQ_PAIRS = 3;

export const ERROR_SECTIONS: Record<Lang, readonly string[]> = {
  de: ["Bedeutung", "Typische Ursachen", "Lösung"],
  en: ["Meaning", "Typical causes", "Solution"],
};

const GEN_START = "<!-- gen:docs befehle -->";
const KATEGORIEN = new Set(["thema", "fehler", "uebersicht"]);
const GEN_END = "<!-- /gen:docs -->";

// Widgets/Vorlagen (comvenio-cli-doku 06 §4.2/§4.5): own marker pairs, own end
// tag each, so several generated blocks can sit in the same article without
// one's end swallowing into the next.
const WIDGETS_START = "<!-- gen:docs widgets -->";
const WIDGETS_END = "<!-- /gen:docs widgets -->";
const VORLAGEN_START = "<!-- gen:docs vorlagen -->";
const VORLAGEN_END = "<!-- /gen:docs vorlagen -->";
// Web-app guide (comvenio-cli-doku 08 §4.4): one generated section per hub
// article, one sub-heading per surface (D-DOK-18), placed before "Befehle und Actions".
const WEBAPP_START = "<!-- gen:docs web-app -->";
const WEBAPP_END = "<!-- /gen:docs web-app -->";
export const WEBAPP_SECTION: Record<Lang, string> = { de: "So geht's in der Web-App", en: "How it works in the web app" };
// Article domain → hub of the guide; an article may carry more domains (veranstaltungen: event, plan).
const WEBAPP_HUB: Readonly<Record<string, Hub>> = { homepage: "homepage", finance: "finance", event: "event", tournament: "tournament", meeting: "meeting" };

// Files in docs/ that are no customer articles: the template and the
// developer checklist for new connector actions.
export const NON_ARTICLES = new Set(["_vorlage.md", "connector-aktion-hinzufuegen.md"]);

export interface Frontmatter {
  id: string;
  kategorie: string;
  domaenen: string[];
  stichwoerter: string[];
}

export interface Article {
  path: string;
  lang: Lang;
  frontmatter: Frontmatter | null;
  title: string | null;
  body: string;
  raw: string;
}

export interface Finding {
  file: string;
  reason: string;
}

interface CatalogEntry {
  de: { message: string };
  en: { message: string };
  help: string;
}

function parseList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return trimmed ? [trimmed] : [];
  return trimmed.slice(1, -1).split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function parseArticle(path: string, lang: Lang, raw: string): Article {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(raw);
  let frontmatter: Frontmatter | null = null;
  let body = raw;
  if (match) {
    body = raw.slice(match[0].length);
    const fields: Record<string, string> = {};
    for (const line of match[1]!.split("\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    if (fields.id && fields.kategorie) {
      frontmatter = {
        id: fields.id,
        kategorie: fields.kategorie,
        domaenen: parseList(fields.domaenen ?? ""),
        stichwoerter: parseList(fields.stichwoerter ?? ""),
      };
    }
  }
  const title = /^# (.+)$/mu.exec(body)?.[1]?.trim() ?? null;
  return { path, lang, frontmatter, title, body, raw };
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
}

/** All customer articles: topics in docs/ and docs/en/, errors in docs/fehler/ and docs/en/fehler/. */
export function readArticles(root: string): Article[] {
  const docs = join(root, "docs");
  const places: Array<[string, Lang]> = [
    [docs, "de"],
    [join(docs, "en"), "en"],
    [join(docs, "fehler"), "de"],
    [join(docs, "en", "fehler"), "en"],
  ];
  const articles: Article[] = [];
  for (const [dir, lang] of places) {
    for (const name of markdownFiles(dir)) {
      if (dir === docs && NON_ARTICLES.has(name)) continue;
      const path = relative(root, join(dir, name)).replaceAll("\\", "/");
      articles.push(parseArticle(path, lang, readFileSync(join(dir, name), "utf8")));
    }
  }
  return articles;
}

function readCatalog(root: string): Record<string, CatalogEntry> {
  return JSON.parse(readFileSync(join(root, "docs/fehler/katalog.json"), "utf8")) as Record<string, CatalogEntry>;
}

/** docs/fehler/SCOPE_REQUIRED → scope-required, matching the catalog's help id. */
export function errorSlug(code: string): string {
  return code.toLowerCase().replaceAll("_", "-");
}

const RISK_LABEL: Record<string, Record<Lang, string>> = {
  read: { de: "lesen", en: "read" },
  reversible_write: { de: "ändern", en: "change" },
  critical_write: { de: "ändern mit Bestätigung", en: "change with confirmation" },
  agent_orchestration: { de: "Club-Agent", en: "club agent" },
};

/** The topic an action belongs to; the weekly preview actions sit in the club domain. */
export function actionTopic(action: InventoryAction): string {
  if (action.action_id.includes("weekly_preview")) return "weekly-preview";
  // Seasonal teams extend the team master data and are documented with it.
  return action.domain === "teams" ? "team" : action.domain;
}

// Domains whose field schema the connector serves through cai.schema.02.
const SCHEMA_DOMAINS: ReadonlySet<string> = new Set<string>(K12_SCHEMA_DOMAINS);

/** The generated block of "Befehle und Actions": the connector actions of the article's domains. */
export function commandsBlock(root: string, domains: readonly string[], lang: Lang, inventory: readonly InventoryAction[]): string {
  const lines: string[] = [GEN_START];
  for (const id of domains) {
    const actions = inventory.filter((action) => actionTopic(action) === id);
    lines.push("", `**${id}**`, "");
    if (actions.length === 0) {
      lines.push(lang === "de"
        ? "- Noch keine Action — dieser Bereich läuft über die Web-App."
        : "- No action yet — this area works through the web app.");
    }
    for (const action of actions) {
      const risks = [...new Set(action.operations.map((operation) => operation.risk))];
      const label = risks.map((risk) => RISK_LABEL[risk]?.[lang] ?? risk).join(", ");
      const operations = action.operations.map((operation) => operation.operation).join(", ");
      const scopes = [...new Set(action.operations.flatMap((operation) => operation.scopes))].map((scope) => `\`${scope}\``).join(", ");
      lines.push(`- \`${action.action_id}\` — ${operations} (${label})${scopes ? ` · Scopes: ${scopes}` : ""}`);
    }
    if (SCHEMA_DOMAINS.has(id)) {
      const call = `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"${id}"}'`;
      lines.push(lang === "de"
        ? `- Felder und Werte: \`${call}\` (\`club_id\` setzt die Anmeldung — nie in \`--input\`)`
        : `- Fields and values: \`${call}\` (the sign-in sets \`club_id\` — never in \`--input\`)`);
    }
  }
  lines.push(GEN_END);
  return lines.join("\n");
}

/** Replaces one generated block (by its own start/end marker pair) in an article; null when the markers are missing. */
function withMarkedBlock(raw: string, startMarker: string, endMarker: string, block: string): string | null {
  const start = raw.indexOf(startMarker);
  const end = raw.indexOf(endMarker);
  if (start < 0 || end < start) return null;
  return raw.slice(0, start) + block + raw.slice(end + endMarker.length);
}

/** Replaces the generated "Befehle und Actions" block in an article; returns null when the markers are missing. */
export function withCommandsBlock(raw: string, block: string): string | null {
  return withMarkedBlock(raw, GEN_START, GEN_END, block);
}

interface HomepageWidgetEintrag {
  config?: unknown;
  beschreibung?: { kategorie: string; zweck: { de: string; en: string }; datenquelle: { de: string; en: string }; macht_oeffentlich: { de: string; en: string }; passt_zu: { de: string[]; en: string[] } };
}
interface HomepageSchema {
  widget_kinds: string[];
  widgets: Record<string, HomepageWidgetEintrag>;
  templates: string[];
  template_beschreibung?: Record<string, { de: string; en: string }>;
}

/**
 * Reads `src/schema/homepage.json` from `root` — NOT a static import of the
 * committed connector registry: `checkDocs`/`generateDocs` are exercised
 * against throwaway fixture trees in tests (check-docs.test.ts), and a
 * hard-wired import would leak the real 75-widget registry into every one of
 * them. `null` when the fixture carries no homepage schema at all — the
 * homepage-specific checks below then simply do nothing, same as a topic
 * article without the `homepage` domain today.
 */
function readHomepageSchema(root: string): HomepageSchema | null {
  const path = join(root, "src/schema/homepage.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as HomepageSchema;
  } catch {
    return null;
  }
}

const OFFENE_STELLE: Record<Lang, string> = { de: "offene Stelle — Erklärung fehlt", en: "open item — explanation missing" };

/**
 * The generated "Widgets" section (§4.2): one entry per widget of
 * `WIDGET_REGISTRY`, grouped by `beschreibung.kategorie` — in registry order
 * within a group, an widget without an explanation goes into its own group at
 * the end so it stays visible instead of silently vanishing from the list.
 */
export function widgetsBlock(root: string, lang: Lang): string {
  const schema = readHomepageSchema(root);
  const gruppen = new Map<string, string[]>();
  const ohneKategorie = lang === "de" ? "ohne Kategorie" : "uncategorized";
  for (const kind of schema?.widget_kinds ?? []) {
    const b = schema?.widgets[kind]?.beschreibung;
    const kategorie = b?.kategorie ?? ohneKategorie;
    const zeile = b
      ? `- \`${kind}\` — ${b.zweck[lang]} ${lang === "de" ? "Datenquelle" : "Data source"}: ${b.datenquelle[lang]} ${lang === "de" ? "Macht öffentlich" : "Makes public"}: ${b.macht_oeffentlich[lang]} ${lang === "de" ? "Passt zu" : "Fits"}: ${b.passt_zu[lang].join(", ")}`
      : `- \`${kind}\` — ${OFFENE_STELLE[lang]}`;
    gruppen.set(kategorie, [...(gruppen.get(kategorie) ?? []), zeile]);
  }
  const lines: string[] = [WIDGETS_START];
  for (const [kategorie, zeilen] of gruppen) {
    lines.push("", `**${kategorie}**`, "", ...zeilen);
  }
  lines.push(WIDGETS_END);
  return lines.join("\n");
}

/** The generated "Vorlagen" section (§4.5): all 8 templates, a short description each — an open item, not invented text, when the schema carries none. */
export function vorlagenBlock(root: string, lang: Lang): string {
  const schema = readHomepageSchema(root);
  const lines: string[] = [VORLAGEN_START, ""];
  for (const id of schema?.templates ?? []) {
    const zweck = schema?.template_beschreibung?.[id]?.[lang];
    lines.push(zweck ? `- \`${id}\` — ${zweck}` : `- \`${id}\` — ${OFFENE_STELLE[lang]}`);
  }
  lines.push(VORLAGEN_END);
  return lines.join("\n");
}

/**
 * Reads `src/schema/web-app-fuehrung.json` (written by gen:web-app-fuehrung)
 * from `root`. `null` when the tree carries none — the web-app checks then do
 * nothing, same as the homepage schema for fixtures in tests.
 */
function readWebAppFuehrung(root: string): WebAppFuehrung | null {
  const path = join(root, "src/schema/web-app-fuehrung.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as WebAppFuehrung;
  } catch {
    return null;
  }
}

function webAppHubs(domains: readonly string[]): Hub[] {
  return [...new Set(domains.map((domain) => WEBAPP_HUB[domain]).filter((hub): hub is Hub => hub !== undefined))];
}

const WEBAPP_TEXT = {
  de: {
    folgt: "Web-App-Führung folgt, sobald UI-Spezifikationen mit Code-Ankern vorliegen.",
    menue: "Menüpfad",
    offen: "offene Stelle — Menüpfad manuell ergänzen",
    zweck: "Zweck",
    fuehrtZu: "führt zu",
    hinweis: null,
  },
  en: {
    folgt: "The web app guide follows as soon as interface specifications with code anchors are available.",
    menue: "Menu path",
    offen: "open item — add the menu path manually",
    zweck: "Purpose",
    fuehrtZu: "leads to",
    // The specifications exist in German only; the web app itself is German.
    hinweis: "The descriptions below come from the German interface specifications and quote the labels as the web app shows them.",
  },
} as const;

/**
 * The generated "So geht's in der Web-App" section (08 §4.3/§4.4): per surface
 * menu path, purpose and the anchored actions (trigger → effect → leads to).
 * A hub without anchored surfaces carries only the "follows" note (DC-8) —
 * never an invented description.
 */
export function webAppBlock(root: string, domains: readonly string[], lang: Lang): string {
  const fuehrung = readWebAppFuehrung(root);
  const text = WEBAPP_TEXT[lang];
  const flaechen = webAppHubs(domains).flatMap((hub) => fuehrung?.hubs[hub] ?? []);
  const lines: string[] = [WEBAPP_START];
  if (flaechen.length === 0) {
    lines.push("", text.folgt);
  } else {
    if (text.hinweis) lines.push("", text.hinweis);
    for (const flaeche of flaechen) {
      lines.push("", `### ${flaeche.titel}`, "");
      lines.push(`${text.menue}: ${flaeche.menuepfad}${flaeche.menuepfad_offen ? ` (${text.offen})` : ""}`);
      if (flaeche.zweck) lines.push("", `${text.zweck}: ${flaeche.zweck}`);
      lines.push("");
      for (const aktion of flaeche.aktionen) {
        lines.push(`- ${aktion.ausloeser} → ${aktion.wirkung}${aktion.fuehrt_zu ? ` (${text.fuehrtZu}: ${aktion.fuehrt_zu})` : ""}`);
      }
    }
  }
  lines.push("", WEBAPP_END);
  return lines.join("\n");
}

export function withWebAppBlock(raw: string, block: string): string | null {
  return withMarkedBlock(raw, WEBAPP_START, WEBAPP_END, block);
}

export function withWidgetsBlock(raw: string, block: string): string | null {
  return withMarkedBlock(raw, WIDGETS_START, WIDGETS_END, block);
}
export function withVorlagenBlock(raw: string, block: string): string | null {
  return withMarkedBlock(raw, VORLAGEN_START, VORLAGEN_END, block);
}

export interface IndexEntry {
  id: string;
  kategorie: string;
  title: Record<Lang, string>;
  stichwoerter: Record<Lang, string[]>;
  domaenen: string[];
  pfad: Record<Lang, string>;
}

/** The module that embeds every article into the compiled CLI (03-programm-hilfe). */
export const EMBEDDED_ARTICLES = "packages/kundendoku/src/artikel.generated.ts";

function embeddedArticlesModule(index: readonly IndexEntry[]): string {
  const paths = index.flatMap((entry) => [entry.pfad.de, entry.pfad.en]).filter(Boolean).sort();
  const lines = [
    "// Generated by `bun run gen:docs` — do not edit. Every customer article is",
    "// imported as text, so every bundle embeds it: `comvenio help`",
    "// and the connector tool comvenio_hilfe work offline in the installed version.",
    ...paths.map((path, number) => `import a${number} from "../../../${path}" with { type: "text" };`),
    "",
    "export const ARTIKEL: Readonly<Record<string, string>> = {",
    ...paths.map((path, number) => `  "${path}": a${number},`),
    "};",
    "",
  ];
  return lines.join("\n");
}

/** Builds docs/index.json and every generated block. Returns path → expected content. */
export function generateDocs(root: string, inventory: readonly InventoryAction[]): Map<string, string> {
  const articles = readArticles(root);
  const out = new Map<string, string>();
  for (const article of articles) {
    if (article.frontmatter?.kategorie !== "thema") continue;
    let next: string = article.raw;
    const commands = withCommandsBlock(next, commandsBlock(root, article.frontmatter.domaenen, article.lang, inventory));
    if (commands !== null) next = commands;
    // Widgets/Vorlagen (§4.2/§4.5): only articles that actually carry the
    // markers change — today that is homepage.md/en, data-driven rather than
    // hard-coded to one article id.
    const widgets = withWidgetsBlock(next, widgetsBlock(root, article.lang));
    if (widgets !== null) next = widgets;
    const vorlagen = withVorlagenBlock(next, vorlagenBlock(root, article.lang));
    if (vorlagen !== null) next = vorlagen;
    const webApp = withWebAppBlock(next, webAppBlock(root, article.frontmatter.domaenen, article.lang));
    if (webApp !== null) next = webApp;
    if (next !== article.raw) out.set(article.path, next);
  }
  const byId = new Map<string, Partial<Record<Lang, Article>>>();
  for (const article of articles) {
    if (!article.frontmatter) continue;
    const entry = byId.get(article.frontmatter.id) ?? {};
    entry[article.lang] = article;
    byId.set(article.frontmatter.id, entry);
  }
  const index: IndexEntry[] = [];
  for (const [id, pair] of [...byId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const de = pair.de;
    const en = pair.en;
    if (!de?.frontmatter) continue;
    index.push({
      id,
      kategorie: de.frontmatter.kategorie,
      title: { de: de.title ?? id, en: en?.title ?? de.title ?? id },
      stichwoerter: { de: de.frontmatter.stichwoerter, en: en?.frontmatter?.stichwoerter ?? [] },
      domaenen: de.frontmatter.domaenen,
      pfad: { de: de.path, en: en?.path ?? "" },
    });
  }
  out.set("docs/index.json", `${JSON.stringify({ version: 1, artikel: index }, null, 2)}\n`);
  out.set(EMBEDDED_ARTICLES, embeddedArticlesModule(index));
  return out;
}

// What a customer text must not contain (TC-05): source paths, internal service
// and infrastructure names, internal tools, real club IDs.
const FORBIDDEN: Array<[RegExp, string]> = [
  // Any position not glued to a word: also "[src/…" in a frontmatter list.
  [/(?<![\w.-])(?:src|apps|packages|scripts)\/[\w.-]/u, "Quellpfad"],
  [/\b(?!self-service\b)[a-z][a-z0-9]*(?:-[a-z0-9]+)*-service\b/u, "interner Dienstname"],
  [/\b(?:GET|POST|PUT|PATCH|DELETE) \/[\w{]/u, "HTTP-Route"],
  [/\b(?:railway|localhost|127\.0\.0\.1|postgres(?:ql)?|redis|kubernetes)\b/iu, "Infrastruktur"],
  [/\b(?:rts|codex|harness)\b/iu, "internes Werkzeug"],
  // Tom 2026-09-28: there are no device tokens any more — only OAuth and actions.
  [/ger(?:ä|ae)te-?token|device[- ]token/iu, "Geräte-Token"],
];

/** The reason a customer text line is forbidden, or null — shared with the web-app guide, which drops such spec text. */
export function kundentextVerstoss(line: string): string | null {
  for (const [pattern, reason] of FORBIDDEN) if (pattern.test(line)) return reason;
  return realUuid(line) ? "echte Kennung (UUID)" : null;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

/** A placeholder like 11111111-1111-4111-8111-111111111111 uses at most three distinct digits. */
function realUuid(line: string): boolean {
  return [...line.matchAll(UUID)].some((match) => new Set(match[0].replaceAll("-", "").toLowerCase()).size > 3);
}

function headings(body: string): string[] {
  return [...body.matchAll(/^## (.+)$/gmu)].map((match) => match[1]!.trim());
}

/** Text of the `## <title>` section up to the next `## ` heading; null when absent. */
export function sectionBody(body: string, title: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Every finding with file and reason; an empty list means the documentation is complete. */
export function checkDocs(root: string, inventory: readonly InventoryAction[]): Finding[] {
  const findings: Finding[] = [];
  const articles = readArticles(root);
  const byPath = new Map(articles.map((article) => [article.path, article]));
  const catalog = readCatalog(root);

  for (const article of articles) {
    if (!article.frontmatter) {
      findings.push({ file: article.path, reason: "Frontmatter fehlt (id, kategorie)" });
      continue;
    }
    const { kategorie } = article.frontmatter;
    if (!KATEGORIEN.has(kategorie)) {
      findings.push({ file: article.path, reason: `Unbekannte kategorie: ${kategorie}` });
    }
    if (!article.title) findings.push({ file: article.path, reason: "Überschrift (# …) fehlt" });
    const required = kategorie === "fehler" ? ERROR_SECTIONS[article.lang] : TOPIC_SECTIONS[article.lang];
    if (kategorie !== "uebersicht") {
      const present = new Set(headings(article.body));
      for (const section of required) {
        if (!present.has(section)) findings.push({ file: article.path, reason: `Pflichtabschnitt fehlt: ${section}` });
      }
    }
    if (kategorie === "thema" && article.frontmatter.domaenen.some((domain) => FACHWISSEN_DOMAINS.has(domain))) {
      const present = new Set(headings(article.body));
      for (const section of FACHWISSEN_SECTIONS[article.lang]) {
        if (!present.has(section)) findings.push({ file: article.path, reason: `Pflichtabschnitt fehlt: ${section}` });
      }
      const faq = sectionBody(article.body, FACHWISSEN_SECTIONS[article.lang][1]!);
      const pairs = faq === null ? 0 : (faq.match(/^\*\*[^*\n]+\*\*\s*$/gmu) ?? []).length;
      if (faq !== null && pairs < MIN_FAQ_PAIRS) {
        findings.push({ file: article.path, reason: `Häufige Fragen nennen nur ${pairs} statt ${MIN_FAQ_PAIRS} Frage-Antwort-Paare` });
      }
    }
    if (kategorie === "thema" && withCommandsBlock(article.raw, "") === null) {
      findings.push({ file: article.path, reason: "Erzeugter Abschnitt fehlt oder ist unvollständig (Marker gen:docs befehle … /gen:docs)" });
    }
    // Widgets/Vorlagen (§4.2/§4.5): Pflicht fuer jeden Artikel, der die
    // homepage-Domaene traegt — heute nur homepage.md/en.
    if (kategorie === "thema" && article.frontmatter.domaenen.includes("homepage")) {
      if (withWidgetsBlock(article.raw, "") === null) {
        findings.push({ file: article.path, reason: "Erzeugter Abschnitt „Widgets“ fehlt oder ist unvollständig (Marker gen:docs widgets … /gen:docs widgets)" });
      }
      if (withVorlagenBlock(article.raw, "") === null) {
        findings.push({ file: article.path, reason: "Erzeugter Abschnitt „Vorlagen“ fehlt oder ist unvollständig (Marker gen:docs vorlagen … /gen:docs vorlagen)" });
      } else {
        const eintraege = (vorlagenBlock(root, article.lang).match(/^- /gmu) ?? []).length;
        if (eintraege < 8) findings.push({ file: article.path, reason: `Vorlagen-Abschnitt nennt nur ${eintraege} statt 8 Vorlagen` });
      }
    }
    // Web-app guide (08 §4.4): required in every hub article, as soon as the
    // tree carries a generated guide at all.
    if (kategorie === "thema" && webAppHubs(article.frontmatter.domaenen).length > 0 && readWebAppFuehrung(root) !== null) {
      if (!new Set(headings(article.body)).has(WEBAPP_SECTION[article.lang])) {
        findings.push({ file: article.path, reason: `Pflichtabschnitt fehlt: ${WEBAPP_SECTION[article.lang]}` });
      }
      if (withWebAppBlock(article.raw, "") === null) {
        findings.push({ file: article.path, reason: "Erzeugter Abschnitt „Web-App“ fehlt oder ist unvollständig (Marker gen:docs web-app … /gen:docs web-app)" });
      }
    }
    const other = article.lang === "de"
      ? article.path.replace(/^docs\//u, "docs/en/")
      : article.path.replace(/^docs\/en\//u, "docs/");
    const pair = byPath.get(other);
    if (!pair) {
      findings.push({ file: article.path, reason: `Sprachfassung fehlt: ${other}` });
    } else if (pair.frontmatter) {
      for (const field of ["id", "kategorie"] as const) {
        if (pair.frontmatter[field] !== article.frontmatter[field]) {
          findings.push({ file: article.path, reason: `Sprachfassungen weichen ab (${field}): ${other}` });
        }
      }
      if (pair.frontmatter.domaenen.join(",") !== article.frontmatter.domaenen.join(",")) {
        findings.push({ file: article.path, reason: `Sprachfassungen weichen ab (domaenen): ${other}` });
      }
    }
    // Frontmatter counts too: its keywords are published in docs/index.json.
    article.raw.split("\n").forEach((line, index) => {
      for (const [pattern, reason] of FORBIDDEN) {
        if (pattern.test(line)) findings.push({ file: `${article.path}:${index + 1}`, reason: `Verbotener Inhalt (${reason})` });
      }
      if (realUuid(line)) findings.push({ file: `${article.path}:${index + 1}`, reason: "Verbotener Inhalt (echte Kennung (UUID))" });
    });
  }

  const topics = articles.filter((article) => article.lang === "de" && article.frontmatter?.kategorie === "thema");
  // Every connector action must show up in some article's generated block.
  const claimed = new Set(topics.flatMap((article) => article.frontmatter!.domaenen));
  for (const topic of new Set(inventory.map(actionTopic))) {
    if (!claimed.has(topic)) {
      findings.push({ file: "scripts/docs-lib.ts", reason: `Actions ohne Artikel: ${topic}` });
    }
  }
  // A help pointer to an error code must name a code of the catalog: after a
  // code is removed (OAUTH_ONLY, geraetetoken-abbau-04) no article may still
  // send the reader there.
  for (const article of articles) {
    article.raw.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(/comvenio help fehler ([A-Z][A-Z0-9_]*)/gu)) {
        if (!Object.hasOwn(catalog, match[1]!)) {
          findings.push({ file: `${article.path}:${index + 1}`, reason: `Unbekannter Fehlercode: ${match[1]}` });
        }
      }
    });
  }

  for (const code of Object.keys(catalog)) {
    for (const [lang, dir] of [["de", "docs/fehler"], ["en", "docs/en/fehler"]] as const) {
      const path = `${dir}/${errorSlug(code)}.md`;
      const article = byPath.get(path);
      if (!article) findings.push({ file: path, reason: `Fehlercode ohne Artikel (${lang}): ${code}` });
      else if (article.frontmatter?.kategorie !== "fehler") {
        findings.push({ file: path, reason: "kategorie muss fehler sein" });
      }
    }
  }

  // An error page without its code in the catalog describes an error the CLI
  // can no longer raise (e.g. oauth-only after the device-token removal).
  const slugs = new Set(Object.keys(catalog).map(errorSlug));
  for (const article of articles) {
    if (article.frontmatter?.kategorie !== "fehler") continue;
    const slug = article.path.replace(/^docs\/(?:en\/)?fehler\//u, "").replace(/\.md$/u, "");
    if (!slugs.has(slug)) findings.push({ file: article.path, reason: `Fehlerseite ohne Fehlercode im Katalog: ${slug}` });
  }

  for (const [path, expected] of generateDocs(root, inventory)) {
    const current = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null;
    if (current !== expected) {
      findings.push({ file: path, reason: "Erzeugter Stand veraltet — bun run gen:docs" });
    }
  }

  // Widget ohne Erklärung (§4.2, DC-3): je fehlendem Widget ein eigener Befund,
  // damit der Ausfall benennbar bleibt statt in einer Sammelzeile zu
  // verschwinden. Nur wenn die Wurzel ueberhaupt ein Homepage-Schema traegt —
  // eine Fixture ohne `src/schema/homepage.json` hat dazu nichts zu sagen.
  const homepageSchema = readHomepageSchema(root);
  for (const kind of homepageSchema?.widget_kinds ?? []) {
    if (!homepageSchema?.widgets[kind]?.beschreibung) {
      findings.push({ file: "src/schema/homepage.json", reason: `Widget ohne Erklärung: ${kind}` });
    }
  }
  return findings;
}
