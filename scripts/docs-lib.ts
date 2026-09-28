/**
 * Customer documentation of the CLI (02-inhalte-und-pruefung): one article per
 * topic and per public error code, German in docs/, English in docs/en/.
 *
 * Every article carries a small frontmatter (id, kategorie, domaenen,
 * stichwoerter). From it `gen:docs` builds docs/index.json and the section
 * "Befehle und Actions", which is generated from the coverage registry and
 * the schema files, never written by hand. `check:docs` fails on every gap.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

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

// Files in docs/ that are no customer articles: the template, the generated
// coverage report and the developer checklist for new connector actions.
export const NON_ARTICLES = new Set(["_vorlage.md", "coverage.md", "connector-aktion-hinzufuegen.md"]);

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

interface RegistryDomain {
  id: string;
  status: string;
  actions: string[];
  docs: string[];
}

/** Top-level commands the CLI registers (`.command("zone …")`) → source text of the registering file. */
export function topLevelCommands(root: string): Map<string, string> {
  const commands = new Map<string, string>();
  for (const dir of ["src/commands", "src"]) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).filter((file) => file.endsWith(".ts"))) {
      const text = readFileSync(join(base, name), "utf8");
      for (const match of text.matchAll(/\.command\(\s*["'`]([a-z][a-z0-9-]*)/gu)) commands.set(match[1]!, text);
    }
  }
  return commands;
}

/**
 * The full command of one registry entry. The registry lists subcommands
 * without their top-level command ("list" under "team"), but some entries are
 * top-level commands of their own ("task-zones" under "zone", "function"
 * under "agent"). A word is a subcommand when the domain's own source handles
 * it as a quoted verb ("plan" in finance); otherwise a registered top-level
 * command of that name stands for itself.
 */
export function registryCommand(domain: string, action: string, commands: ReadonlyMap<string, string>): string {
  const head = action.split(" ")[0]!;
  if (head === domain) return action;
  const ownSource = commands.get(domain) ?? "";
  if (commands.has(head) && !ownSource.includes(`"${head}"`)) return action;
  return `${domain} ${action}`;
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

function readRegistry(root: string): RegistryDomain[] {
  const registry = JSON.parse(readFileSync(join(root, "src/coverage/domains.json"), "utf8")) as {
    domains: RegistryDomain[];
  };
  return registry.domains;
}

function readCatalog(root: string): Record<string, CatalogEntry> {
  return JSON.parse(readFileSync(join(root, "docs/fehler/katalog.json"), "utf8")) as Record<string, CatalogEntry>;
}

/** docs/fehler/SCOPE_REQUIRED → scope-required, matching the catalog's help id. */
export function errorSlug(code: string): string {
  return code.toLowerCase().replaceAll("_", "-");
}

const STATUS_LABEL: Record<string, Record<Lang, string>> = {
  covered: { de: "vollständig", en: "complete" },
  "core-partial": { de: "Kern vorhanden, einzelne Abläufe fehlen", en: "core available, some workflows missing" },
  "intentional-exclusion": { de: "bewusst nicht im CLI", en: "intentionally not in the CLI" },
};

/** The generated block of "Befehle und Actions" for one article. */
export function commandsBlock(root: string, domains: readonly string[], lang: Lang): string {
  const registry = new Map(readRegistry(root).map((domain) => [domain.id, domain]));
  const commands = topLevelCommands(root);
  // The markers say it is generated; the customer text itself stays free of tooling.
  const lines: string[] = [GEN_START];
  for (const id of domains) {
    const domain = registry.get(id);
    if (!domain) continue;
    lines.push("", `**${id}** — ${STATUS_LABEL[domain.status]?.[lang] ?? domain.status}`, "");
    for (const action of domain.actions) {
      lines.push(`- \`comvenio ${registryCommand(id, action, commands)}\``);
    }
    if (existsSync(join(root, "src/schema", `${id}.json`))) {
      lines.push(lang === "de"
        ? `- Felder und Werte: \`comvenio schema ${id} --json\``
        : `- Fields and values: \`comvenio schema ${id} --json\``);
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
export const EMBEDDED_ARTICLES = "src/help/artikel.generated.ts";

function embeddedArticlesModule(index: readonly IndexEntry[]): string {
  const paths = index.flatMap((entry) => [entry.pfad.de, entry.pfad.en]).filter(Boolean).sort();
  const lines = [
    "// Generated by `bun run gen:docs` — do not edit. Every customer article is",
    "// imported as text, so `bun build --compile` embeds it and `comvenio help`",
    "// works offline in the version of the installed program.",
    ...paths.map((path, number) => `import a${number} from "../../${path}" with { type: "text" };`),
    "",
    "export const ARTIKEL: Readonly<Record<string, string>> = {",
    ...paths.map((path, number) => `  "${path}": a${number},`),
    "};",
    "",
  ];
  return lines.join("\n");
}

/** Builds docs/index.json and every generated block. Returns path → expected content. */
export function generateDocs(root: string): Map<string, string> {
  const articles = readArticles(root);
  const out = new Map<string, string>();
  for (const article of articles) {
    if (article.frontmatter?.kategorie !== "thema") continue;
    const block = commandsBlock(root, article.frontmatter.domaenen, article.lang);
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
export function checkDocs(root: string): Finding[] {
  const findings: Finding[] = [];
  const articles = readArticles(root);
  const byPath = new Map(articles.map((article) => [article.path, article]));
  const registry = readRegistry(root);
  const commands = topLevelCommands(root);

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

  // Each domain needs a German topic article that the registry points to and
  // that names the domain; an article may only claim domains that point to it.
  const topics = articles.filter((article) => article.lang === "de" && article.frontmatter?.kategorie === "thema");
  for (const domain of registry) {
    const documented = topics.some((article) =>
      domain.docs.includes(article.path) && article.frontmatter!.domaenen.includes(domain.id));
    if (!documented) {
      findings.push({ file: "src/coverage/domains.json", reason: `Domäne ohne Artikel: ${domain.id}` });
    }
    for (const action of domain.actions) {
      const head = registryCommand(domain.id, action, commands).split(" ")[0]!;
      if (!commands.has(head)) {
        findings.push({ file: "src/coverage/domains.json", reason: `Befehl nicht registriert: comvenio ${head} (${domain.id})` });
      }
    }
  }
  const byId = new Map(registry.map((domain) => [domain.id, domain]));
  for (const article of topics) {
    for (const id of article.frontmatter!.domaenen) {
      const domain = byId.get(id);
      if (!domain) findings.push({ file: article.path, reason: `Unbekannte Domäne: ${id}` });
      else if (!domain.docs.includes(article.path)) {
        findings.push({ file: article.path, reason: `Registry verweist für ${id} nicht auf diesen Artikel` });
      }
    }
  }

  for (const code of Object.keys(readCatalog(root))) {
    for (const [lang, dir] of [["de", "docs/fehler"], ["en", "docs/en/fehler"]] as const) {
      const path = `${dir}/${errorSlug(code)}.md`;
      const article = byPath.get(path);
      if (!article) findings.push({ file: path, reason: `Fehlercode ohne Artikel (${lang}): ${code}` });
      else if (article.frontmatter?.kategorie !== "fehler") {
        findings.push({ file: path, reason: "kategorie muss fehler sein" });
      }
    }
  }

  for (const [path, expected] of generateDocs(root)) {
    const current = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null;
    if (current !== expected) {
      findings.push({ file: path, reason: "Erzeugter Stand veraltet — bun run gen:docs" });
    }
  }
  return findings;
}
