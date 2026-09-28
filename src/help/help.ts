// `comvenio help` (03-programm-hilfe): the customer documentation of docs/,
// embedded at build time, readable offline in German and English.
import index from "../../docs/index.json" with { type: "json" };
import { ARTIKEL } from "./artikel.generated.ts";
import { articleBody, renderArticle, wrap } from "./render.ts";

export type HelpLang = "de" | "en";

export interface IndexEntry {
  id: string;
  kategorie: string;
  title: Record<HelpLang, string>;
  stichwoerter: Record<HelpLang, string[]>;
  domaenen: string[];
  pfad: Record<HelpLang, string>;
}

export const INDEX = (index as { artikel: IndexEntry[] }).artikel;

/** `--json` of one article (DC-5). */
export interface HelpArticle {
  id: string;
  title: string;
  lang: HelpLang;
  markdown: string;
  related: string[];
}

export interface HelpResult {
  /** Text for the terminal; `json` for --json. */
  text: string;
  json: unknown;
  /** 0 found, 1 unknown topic or code. */
  exitCode: 0 | 1;
}

const LABELS = {
  de: {
    topics: "Themen",
    overviews: "Übersichten",
    errors: "Fehlercodes",
    errorsHint: "Alle Codes: comvenio help fehler · einer: comvenio help fehler <CODE>",
    search: "Suche: comvenio help suche <text>",
    unknownTopic: (topic: string) => `Kein Hilfeartikel „${topic}“.`,
    unknownCode: (code: string) => `Kein Fehlercode „${code}“. Alle Codes: comvenio help fehler`,
    nearest: "Meinten Sie:",
    overview: "Übersicht: comvenio help",
    noMatch: (text: string) => `Keine Treffer für „${text}“. Übersicht: comvenio help`,
    related: "Siehe auch",
  },
  en: {
    topics: "Topics",
    overviews: "Overviews",
    errors: "Error codes",
    errorsHint: "All codes: comvenio help fehler · one: comvenio help fehler <CODE>",
    search: "Search: comvenio help suche <text>",
    unknownTopic: (topic: string) => `No help article "${topic}".`,
    unknownCode: (code: string) => `No error code "${code}". All codes: comvenio help fehler`,
    nearest: "Did you mean:",
    overview: "Overview: comvenio help",
    noMatch: (text: string) => `No matches for "${text}". Overview: comvenio help`,
    related: "See also",
  },
} as const;

function errorSlug(code: string): string {
  return code.toLowerCase().replaceAll("_", "-");
}

function codeOf(entry: IndexEntry): string {
  return entry.id.replace(/^fehler\//u, "").replaceAll("-", "_").toUpperCase();
}

function raw(entry: IndexEntry, lang: HelpLang): string {
  return ARTIKEL[entry.pfad[lang]] ?? ARTIKEL[entry.pfad.de] ?? "";
}

/** Topics sharing a domain, and the error codes an article mentions (or topics naming a code). */
export function related(entry: IndexEntry): string[] {
  const ids = new Set<string>();
  if (entry.kategorie === "fehler") {
    const code = codeOf(entry);
    for (const other of INDEX) {
      if (other.kategorie === "thema" && raw(other, "de").includes(`\`${code}\``)) ids.add(other.id);
    }
  } else {
    for (const other of INDEX) {
      if (other.id === entry.id) continue;
      if (other.kategorie === "thema" && other.domaenen.some((domain) => entry.domaenen.includes(domain))) ids.add(other.id);
      if (other.kategorie === "fehler" && raw(entry, "de").includes(`\`${codeOf(other)}\``)) ids.add(other.id);
    }
  }
  return [...ids].sort();
}

function article(entry: IndexEntry, lang: HelpLang, width: number): HelpResult {
  const markdown = articleBody(raw(entry, lang)).trim();
  const links = related(entry);
  const json: HelpArticle = { id: entry.id, title: entry.title[lang], lang, markdown, related: links };
  const seeAlso = links.length > 0
    ? `\n\n${wrap(`${LABELS[lang].related}: ${links.map((id) => `comvenio help ${helpArgument(id)}`).join(", ")}`, Math.max(40, width)).join("\n")}`
    : "";
  return { text: renderArticle(raw(entry, lang), width) + seeAlso, json, exitCode: 0 };
}

function helpArgument(id: string): string {
  return id.startsWith("fehler/") ? `fehler ${id.slice("fehler/".length).replaceAll("-", "_").toUpperCase()}` : id;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** Index hits for a text: id, title and keywords of both languages (DC-2). */
export function search(text: string, lang: HelpLang): IndexEntry[] {
  const words = text.toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const scored = INDEX.map((entry) => {
    const haystack = [
      entry.id,
      entry.title.de, entry.title.en,
      ...entry.stichwoerter.de, ...entry.stichwoerter.en,
      ...entry.domaenen,
    ].map((value) => value.toLowerCase());
    let score = 0;
    for (const word of words) {
      if (haystack.some((value) => value === word)) score += 3;
      else if (haystack.some((value) => value.includes(word))) score += 2;
      else if (haystack.some((value) => value.split(/[\s/-]+/u).some((part) => part.length > 3 && distance(part, word) <= 2))) score += 1;
    }
    return { entry, score };
  }).filter((hit) => hit.score > 0);
  scored.sort((a, b) => b.score - a.score || a.entry.title[lang].localeCompare(b.entry.title[lang]));
  return scored.map((hit) => hit.entry);
}

function listing(entries: IndexEntry[], lang: HelpLang, width: number): string[] {
  return entries.flatMap((entry) =>
    wrap(`${helpArgument(entry.id)} — ${entry.title[lang]}`, Math.max(40, width), "    ", "  "));
}

function overview(lang: HelpLang, width: number): HelpResult {
  const labels = LABELS[lang];
  const topics = INDEX.filter((entry) => entry.kategorie === "thema");
  const overviews = INDEX.filter((entry) => entry.kategorie === "uebersicht");
  const errors = INDEX.filter((entry) => entry.kategorie === "fehler");
  const text = [
    labels.topics,
    ...listing(topics, lang, width),
    "",
    labels.overviews,
    ...listing(overviews, lang, width),
    "",
    `${labels.errors} (${errors.length})`,
    ...wrap(labels.errorsHint, Math.max(40, width), "  ", "  "),
    "",
    labels.search,
  ].join("\n");
  const json = INDEX.map((entry) => ({ id: entry.id, kategorie: entry.kategorie, title: entry.title[lang] }));
  return { text, json, exitCode: 0 };
}

function notFound(message: string, hits: IndexEntry[], lang: HelpLang, width: number): HelpResult {
  const labels = LABELS[lang];
  const text = [
    ...wrap(message, Math.max(40, width)),
    ...(hits.length > 0 ? [labels.nearest, ...listing(hits.slice(0, 5), lang, width)] : []),
    labels.overview,
  ].join("\n");
  return {
    text,
    json: { error: message, matches: hits.slice(0, 5).map((entry) => ({ id: entry.id, title: entry.title[lang] })) },
    exitCode: 1,
  };
}

/** Answers `comvenio help [topic] [argument]` without any network access. */
export function help(topic: string | undefined, argument: string | undefined, lang: HelpLang, width: number): HelpResult {
  if (!topic) return overview(lang, width);
  const key = topic.toLowerCase();

  if (key === "fehler" || key === "errors") {
    const errors = INDEX.filter((entry) => entry.kategorie === "fehler");
    if (!argument) {
      const text = errors.map((entry) => wrap(`${codeOf(entry)} — ${entry.title[lang].replace(/^[A-Z_]+ — /u, "")}`,
        Math.max(40, width), "    ", "  ").join("\n")).join("\n");
      return { text, json: errors.map((entry) => ({ code: codeOf(entry), title: entry.title[lang] })), exitCode: 0 };
    }
    const entry = errors.find((candidate) => candidate.id === `fehler/${errorSlug(argument)}`);
    if (entry) return article(entry, lang, width);
    return notFound(LABELS[lang].unknownCode(argument), [], lang, width);
  }

  if (key === "suche" || key === "search") {
    const text = argument ?? "";
    const hits = search(text, lang);
    if (hits.length === 0) return notFound(LABELS[lang].noMatch(text), [], lang, width);
    return {
      text: listing(hits.slice(0, 10), lang, width).join("\n"),
      json: hits.slice(0, 10).map((entry) => ({ id: entry.id, title: entry.title[lang] })),
      exitCode: 0,
    };
  }

  // A topic by its id, or by a command it documents ("zone" → zonen).
  const entry = INDEX.find((candidate) => candidate.id === key && candidate.kategorie !== "fehler")
    ?? INDEX.find((candidate) => candidate.kategorie === "thema" && candidate.domaenen.includes(key));
  if (entry) return article(entry, lang, width);
  return notFound(LABELS[lang].unknownTopic(topic), search(topic, lang), lang, width);
}
