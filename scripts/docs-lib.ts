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

export type Lang = "de" | "en";

export const TOPIC_SECTIONS: Record<Lang, readonly string[]> = {
  de: ["Wozu", "Voraussetzungen und Rechte", "Abläufe", "Beispiele", "Befehle und Actions", "Fehler"],
  en: ["Purpose", "Requirements and permissions", "Workflows", "Examples", "Commands and actions", "Errors"],
};

export const ERROR_SECTIONS: Record<Lang, readonly string[]> = {
  de: ["Bedeutung", "Typische Ursachen", "Lösung"],
  en: ["Meaning", "Typical causes", "Solution"],
};

const GEN_START = "<!-- gen:docs befehle -->";
const KATEGORIEN = new Set(["thema", "fehler", "uebersicht"]);
const GEN_END = "<!-- /gen:docs -->";

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

/** Replaces the generated block in an article; returns null when the markers are missing. */
export function withCommandsBlock(raw: string, block: string): string | null {
  const start = raw.indexOf(GEN_START);
  const end = raw.indexOf(GEN_END);
  if (start < 0 || end < start) return null;
  return raw.slice(0, start) + block + raw.slice(end + GEN_END.length);
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
    const block = commandsBlock(root, article.frontmatter.domaenen, article.lang, inventory);
    const next = withCommandsBlock(article.raw, block);
    if (next !== null && next !== article.raw) out.set(article.path, next);
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

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

/** A placeholder like 11111111-1111-4111-8111-111111111111 uses at most three distinct digits. */
function realUuid(line: string): boolean {
  return [...line.matchAll(UUID)].some((match) => new Set(match[0].replaceAll("-", "").toLowerCase()).size > 3);
}

function headings(body: string): string[] {
  return [...body.matchAll(/^## (.+)$/gmu)].map((match) => match[1]!.trim());
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
    if (kategorie === "thema" && withCommandsBlock(article.raw, "") === null) {
      findings.push({ file: article.path, reason: "Erzeugter Abschnitt fehlt oder ist unvollständig (Marker gen:docs befehle … /gen:docs)" });
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
  return findings;
}
