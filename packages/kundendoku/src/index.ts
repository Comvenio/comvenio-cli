// The customer documentation (02-inhalte-und-pruefung), embedded at build time.
// One source for `comvenio help` (03) and the connector tool comvenio_hilfe (05):
// index, articles, search and related articles — no rendering, no network.
import index from "../../../docs/index.json" with { type: "json" };
import { ARTIKEL } from "./artikel.generated.ts";

export type DocLang = "de" | "en";

export interface IndexEntry {
  id: string;
  kategorie: string;
  title: Record<DocLang, string>;
  stichwoerter: Record<DocLang, string[]>;
  domaenen: string[];
  pfad: Record<DocLang, string>;
}

/** One article as the contract returns it (03 DC-5, 05 DC-5). */
export interface DocArticle {
  id: string;
  title: string;
  lang: DocLang;
  markdown: string;
  related: string[];
}

export const INDEX: readonly IndexEntry[] = (index as { artikel: IndexEntry[] }).artikel;

/** Removes the frontmatter and the generator markers. */
export function articleBody(raw: string): string {
  return raw
    .replace(/^---\n[\s\S]*?\n---\n?/u, "")
    .replace(/^<!-- \/?gen:docs[^>]*-->\n?/gmu, "");
}

export function rawArticle(entry: IndexEntry, lang: DocLang): string {
  return ARTIKEL[entry.pfad[lang]] ?? ARTIKEL[entry.pfad.de] ?? "";
}

export function errorCodeOf(entry: IndexEntry): string {
  return entry.id.replace(/^fehler\//u, "").replaceAll("-", "_").toUpperCase();
}

/** Topics sharing a domain and the error codes an article mentions; for an error, the topics naming it. */
export function relatedIds(entry: IndexEntry): string[] {
  const ids = new Set<string>();
  const mentions = (text: string, code: string) => text.includes(`\`${code}\``);
  if (entry.kategorie === "fehler") {
    const code = errorCodeOf(entry);
    for (const other of INDEX) {
      if (other.kategorie === "thema" && mentions(rawArticle(other, "de"), code)) ids.add(other.id);
    }
  } else {
    for (const other of INDEX) {
      if (other.id === entry.id) continue;
      if (other.kategorie === "thema" && other.domaenen.some((domain) => entry.domaenen.includes(domain))) ids.add(other.id);
      if (other.kategorie === "fehler" && mentions(rawArticle(entry, "de"), errorCodeOf(other))) ids.add(other.id);
    }
  }
  return [...ids].sort();
}

export function article(entry: IndexEntry, lang: DocLang): DocArticle {
  return {
    id: entry.id,
    title: entry.title[lang],
    lang,
    markdown: articleBody(rawArticle(entry, lang)).trim(),
    related: relatedIds(entry),
  };
}

/** A topic or overview by its id, or a topic by a command it documents ("zone" → zonen). */
export function findTopic(key: string): IndexEntry | null {
  const id = key.toLowerCase();
  return INDEX.find((entry) => entry.id === id && entry.kategorie !== "fehler")
    ?? INDEX.find((entry) => entry.kategorie === "thema" && entry.domaenen.includes(id))
    ?? null;
}

/** An error article by its public code ("SCOPE_REQUIRED" or "scope-required"). */
export function findError(code: string): IndexEntry | null {
  const slug = code.toLowerCase().replaceAll("_", "-");
  return INDEX.find((entry) => entry.id === `fehler/${slug}`) ?? null;
}

/** An article by its index id ("zonen", "fehler/scope-required"). */
export function findById(id: string): IndexEntry | null {
  return INDEX.find((entry) => entry.id === id) ?? null;
}

// Search is public and anonymous (05-ki-zugang), so its cost per call is bounded:
// at most MAX_WORDS words of MAX_WORD_LENGTH characters, the index prepared once,
// and a banded edit distance that stops as soon as it exceeds 2.
const MAX_WORDS = 8;
const MAX_WORD_LENGTH = 40;
const MAX_DISTANCE = 2;

interface Prepared {
  entry: IndexEntry;
  values: string[];
  parts: string[];
}

const PREPARED: readonly Prepared[] = INDEX.map((entry) => {
  const values = [
    entry.id,
    entry.title.de, entry.title.en,
    ...entry.stichwoerter.de, ...entry.stichwoerter.en,
    ...entry.domaenen,
  ].map((value) => value.toLowerCase());
  const parts = [...new Set(values.flatMap((value) => value.split(/[\s/-]+/u)))].filter((part) => part.length > 3);
  return { entry, values, parts };
});

/** True when the edit distance of a and b is at most 2 — O(length), not O(length²). */
export function withinTwoEdits(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > MAX_DISTANCE) return false;
  const width = MAX_DISTANCE;
  let previous = new Map<number, number>();
  for (let j = 0; j <= Math.min(b.length, width); j += 1) previous.set(j, j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Map<number, number>();
    let best = Infinity;
    for (let j = Math.max(0, i - width); j <= Math.min(b.length, i + width); j += 1) {
      const value = j === 0
        ? i
        : Math.min(
          (previous.get(j) ?? Infinity) + 1,
          (current.get(j - 1) ?? Infinity) + 1,
          (previous.get(j - 1) ?? Infinity) + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      current.set(j, value);
      best = Math.min(best, value);
    }
    if (best > MAX_DISTANCE) return false;
    previous = current;
  }
  return (previous.get(b.length) ?? Infinity) <= MAX_DISTANCE;
}

/** Index hits for a text: id, titles, keywords and domains of both languages, best first. */
export function search(text: string, lang: DocLang): IndexEntry[] {
  const words = text.toLowerCase().split(/\s+/u).filter(Boolean)
    .slice(0, MAX_WORDS).map((word) => word.slice(0, MAX_WORD_LENGTH));
  if (words.length === 0) return [];
  const scored = PREPARED.map(({ entry, values, parts }) => {
    let score = 0;
    for (const word of words) {
      if (values.some((value) => value === word)) score += 3;
      else if (values.some((value) => value.includes(word))) score += 2;
      else if (word.length > 3 && parts.some((part) => withinTwoEdits(part, word))) score += 1;
    }
    return { entry, score };
  }).filter((hit) => hit.score > 0);
  scored.sort((a, b) => b.score - a.score || a.entry.title[lang].localeCompare(b.entry.title[lang]));
  return scored.map((hit) => hit.entry);
}
