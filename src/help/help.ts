// `comvenio help` (03-programm-hilfe): the customer documentation of docs/,
// embedded at build time (@comvenio/kundendoku), readable offline in German and English.
import {
  article as docArticle,
  errorCodeOf,
  findError,
  findTopic,
  INDEX,
  type DocArticle,
  type DocLang,
  type IndexEntry,
  rawArticle,
  search,
} from "@comvenio/kundendoku";

import { renderArticle, wrap } from "./render.ts";

export { INDEX, search };
export type HelpLang = DocLang;
export type HelpArticle = DocArticle;

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





function article(entry: IndexEntry, lang: HelpLang, width: number): HelpResult {
  const json = docArticle(entry, lang);
  const links = json.related;
  const seeAlso = links.length > 0
    ? `\n\n${wrap(`${LABELS[lang].related}: ${links.map((id) => `comvenio help ${helpArgument(id)}`).join(", ")}`, Math.max(40, width)).join("\n")}`
    : "";
  return { text: renderArticle(rawArticle(entry, lang), width) + seeAlso, json, exitCode: 0 };
}

function helpArgument(id: string): string {
  return id.startsWith("fehler/") ? `fehler ${id.slice("fehler/".length).replaceAll("-", "_").toUpperCase()}` : id;
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
      const text = errors.map((entry) => wrap(`${errorCodeOf(entry)} — ${entry.title[lang].replace(/^[A-Z_]+ — /u, "")}`,
        Math.max(40, width), "    ", "  ").join("\n")).join("\n");
      return { text, json: errors.map((entry) => ({ code: errorCodeOf(entry), title: entry.title[lang] })), exitCode: 0 };
    }
    const entry = findError(argument);
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

  const entry = findTopic(key);
  if (entry) return article(entry, lang, width);
  return notFound(LABELS[lang].unknownTopic(topic), search(topic, lang), lang, width);
}
