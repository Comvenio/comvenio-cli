// Skeleton parsing and rules R1-R6 for cai.homepage.05.convert (Lastenheft
// comvenio-cli-doku 06 §4.3, algorithm reference designer-struktur §4.3-4.4).
//
// Ported unchanged from the CLI's own `src/homepage/geruest.ts` and
// `src/homepage/regeln.ts` (last readable at commit 8988b21, before K4 removed
// `src/homepage/`): same classes, severities, line numbers as the mirrors in
// club-service `app/utils/geruest_regeln.py` and web-page
// `designer/geruestRegeln.ts`. Only the parts `wandleUm` actually needs moved
// here — `baum()`, `findeSlot()` and the plain-text tree renderer stayed
// behind because tree/slot get/set are out of scope for this action
// (designer-struktur-06 §4.1-4.2, D-DOK-13).
import { DOMParser } from "linkedom";

export interface GeruestBefund {
  klasse: string;
  regel: "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "ALT";
  schwere: "fehler" | "warnung";
  zeile?: number;
  slot?: string;
  text?: string;
  widget_id?: string;
}

export const SLOT_NAME_MUSTER = /^[a-z0-9][a-z0-9-]{0,62}$/;

// ─── DOM (linkedom), structural typing only — this workspace compiles without lib "dom" ──

export interface DomKnoten {
  nodeType: number;
  textContent: string | null;
}
export interface DomListe<T> extends ArrayLike<T> {
  forEach(cb: (e: T) => void): void;
}
export interface DomElement extends DomKnoten {
  tagName: string;
  innerHTML: string;
  children: ArrayLike<DomElement>;
  childNodes: ArrayLike<DomKnoten>;
  parentElement: DomElement | null;
  firstChild: DomKnoten | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): DomListe<DomElement>;
  removeChild(kind: DomKnoten): unknown;
}
export interface DomDokument {
  body: DomElement;
}
export interface SlotEntry {
  kind: string;
  config?: Record<string, unknown>;
  style?: string;
}
export interface WidgetRead {
  id: string;
  kind: string;
  title?: string | null;
  section_id?: string | null;
  slot_index?: number | null;
  position?: number;
  version?: number;
  config?: Record<string, unknown>;
}

export function slotsVon(config: unknown): Record<string, SlotEntry> {
  const s = (config as { slots?: unknown } | undefined)?.slots;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, SlotEntry>) : {};
}
export const htmlVon = (w: { config?: Record<string, unknown> }) => (typeof w.config?.html === "string" ? w.config.html : "");
export function dokument(html: string): DomDokument {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html") as unknown as DomDokument;
}

// ─── Row widths (17-designer-struktur 10 §4.2/§4.3, D19/D24) ──────────────────
// Only the piece R4 needs: whether `data-breiten` on a `[data-reihe]` container
// is a valid 2-4 column, 5%-grid, sum-100 width list.

function breitenFormOk(werte: unknown): werte is number[] {
  return Array.isArray(werte) && werte.length >= 2 && werte.length <= 4 && werte.every((w) => Number.isInteger(w) && w >= 20 && w % 5 === 0) && werte.reduce((a: number, b: number) => a + b, 0) === 100;
}
function breitenAusText(text: string): number[] | null {
  const teile = text.split(/[ \t\n\f\r]+/).filter(Boolean);
  if (!teile.length || !teile.every((t) => /^[0-9]{1,3}$/.test(t))) return null;
  const werte = teile.map(Number);
  return breitenFormOk(werte) ? werte : null;
}

// ─── Tokenizer-based rule engine (regeln.ts) ──────────────────────────────────
// The input is sanitized HTML, so a small line-tracking tokenizer is enough.

const VOID = new Set(["br", "hr", "img", "wbr", "input", "meta", "link", "source", "area", "col", "embed", "param", "track"]);
const AUSZUG = 80;

interface RegelElement {
  tag: string;
  attrs: Record<string, string>;
  zeile: number;
  parent: RegelElement | null;
}
interface RegelText {
  text: string;
  zeile: number;
  parent: RegelElement | null;
}
interface RegelBaum {
  elements: RegelElement[];
  texts: RegelText[];
}

const ENTITAETEN: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function dekodiere(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITAETEN[code.toLowerCase()] ?? m;
  });
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parse(html: string): RegelBaum {
  const elements: RegelElement[] = [];
  const texts: RegelText[] = [];
  const stack: RegelElement[] = [];
  let zeile = 1;
  let i = 0;
  const vorruecken = (bis: number) => {
    for (let k = i; k < bis; k++) if (html.charCodeAt(k) === 10) zeile++;
    i = bis;
  };
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const ende = html.indexOf("-->", i + 4);
      vorruecken(ende < 0 ? html.length : ende + 3);
      continue;
    }
    if (html[i] === "<" && /[a-zA-Z/!]/.test(html[i + 1] ?? "")) {
      const ende = html.indexOf(">", i);
      if (ende < 0) break;
      const roh = html.slice(i + 1, ende);
      const start = zeile;
      if (roh.startsWith("/")) {
        const tag = roh.slice(1).trim().toLowerCase();
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k]?.tag === tag) {
            stack.length = k;
            break;
          }
        }
      } else if (!roh.startsWith("!")) {
        const name = /^([a-zA-Z][^\s/>]*)/.exec(roh)?.[1]?.toLowerCase() ?? "";
        const attrs: Record<string, string> = {};
        const rest = roh.slice(name.length);
        let m: RegExpExecArray | null;
        ATTR.lastIndex = 0;
        while ((m = ATTR.exec(rest))) {
          attrs[(m[1] ?? "").toLowerCase()] = dekodiere(m[2] ?? m[3] ?? m[4] ?? "");
        }
        const el: RegelElement = { tag: name, attrs, zeile: start, parent: stack[stack.length - 1] ?? null };
        elements.push(el);
        if (!VOID.has(name) && !roh.trimEnd().endsWith("/")) stack.push(el);
      }
      vorruecken(ende + 1);
      continue;
    }
    const naechster = html.indexOf("<", i + 1);
    const ende = naechster < 0 ? html.length : naechster;
    const text = dekodiere(html.slice(i, ende));
    if (text.trim()) texts.push({ text, zeile, parent: stack[stack.length - 1] ?? null });
    vorruecken(ende);
  }
  return { elements, texts };
}

function vorfahren(el: RegelElement | null): RegelElement[] {
  const r: RegelElement[] = [];
  for (let e = el; e; e = e.parent) r.push(e);
  return r;
}
function auszug(t: string): string {
  const kompakt = t.split(/\s+/).filter(Boolean).join(" ");
  return kompakt.length <= AUSZUG ? kompakt : kompakt.slice(0, AUSZUG - 1) + "…";
}
const befund = (b: GeruestBefund): GeruestBefund => {
  const r: GeruestBefund = { klasse: b.klasse, regel: b.regel, schwere: b.schwere };
  if (b.zeile !== undefined) r.zeile = b.zeile;
  if (b.slot !== undefined) r.slot = b.slot;
  if (b.text !== undefined) r.text = b.text;
  if (b.widget_id !== undefined) r.widget_id = b.widget_id;
  return r;
};

type Katalog = readonly { id?: unknown; class?: unknown }[] | null | undefined;
type Eintraege = Record<string, { kind?: unknown; style?: unknown } | undefined> | null | undefined;

function katalogKlassen(styles: Katalog): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of styles ?? []) m.set(String(s?.id), String(s?.class ?? "").split(/\s+/).filter(Boolean));
  return m;
}

export function istNeuesFormat(html: string): boolean {
  const { elements } = parse(html);
  return elements.some((e) => "data-slot" in e.attrs) && !elements.some((e) => "data-widget-slot" in e.attrs);
}

/**
 * An old-format skeleton (TD-14) as ONE finding instead of every rule hit —
 * same rule as the designer (web-page geruestRegeln.ts, K11-Altformat): none
 * of the hits is fixable before conversion, and all of them disappear with it.
 */
export function altformatBefund(befunde: GeruestBefund[], widgetId?: string): GeruestBefund {
  const stellen = befunde.filter((b) => b.klasse === "fixed_text_in_skeleton" || b.klasse === "content_in_skeleton").length;
  const weitere = befunde.filter((b) => b.klasse !== "legacy_inline_slot" && b.klasse !== "fixed_text_in_skeleton" && b.klasse !== "content_in_skeleton").length;
  const zeilen = befunde.map((b) => b.zeile).filter((z): z is number => z !== undefined);
  const teile = [
    stellen ? `${stellen} ${stellen === 1 ? "Stelle" : "Stellen"} mit festem Text, Links oder Bildern` : "",
    weitere ? `${weitere} ${weitere === 1 ? "weiterer Regeltreffer" : "weitere Regeltreffer"}` : "",
  ].filter(Boolean);
  return { klasse: "legacy_format", regel: "ALT", schwere: "warnung", zeile: zeilen.length ? Math.min(...zeilen) : undefined, text: teile.length ? teile.join(", ") : "keine Einzelstellen", widget_id: widgetId };
}

/** R1, R2, R3 (without tab-wide uniqueness), R4, R5 for one skeleton. */
export function pruefeGeruest(html: string, slots: Eintraege, styles?: Katalog, optionen: { immerStreng?: boolean } = {}): GeruestBefund[] {
  const { elements, texts } = parse(html ?? "");
  const eintraege = slots ?? {};
  const befunde: GeruestBefund[] = [];
  const imSlot = (e: RegelElement | null) => vorfahren(e).some((a) => "data-slot" in a.attrs);

  for (const t of texts) {
    const ausgenommen = vorfahren(t.parent).some((a) => "data-slot" in a.attrs || a.tag === "svg" || (a.attrs["aria-hidden"] ?? "").trim().toLowerCase() === "true");
    if (!ausgenommen) befunde.push(befund({ klasse: "fixed_text_in_skeleton", regel: "R1", schwere: "fehler", zeile: t.zeile, text: auszug(t.text) }));
  }

  for (const e of elements) {
    if (((e.tag === "a" && "href" in e.attrs) || e.tag === "img") && !imSlot(e)) {
      befunde.push(befund({ klasse: "content_in_skeleton", regel: "R2", schwere: "fehler", zeile: e.zeile, text: `<${e.tag}>` }));
    }
  }

  const gesehen = new Map<string, RegelElement>();
  for (const e of elements) {
    if (!("data-slot" in e.attrs)) continue;
    const name = e.attrs["data-slot"] ?? "";
    if (!SLOT_NAME_MUSTER.test(name)) {
      befunde.push(befund({ klasse: "unnamed_slot", regel: "R3", schwere: "fehler", zeile: e.zeile, slot: name || undefined }));
      continue;
    }
    if (gesehen.has(name)) {
      befunde.push(befund({ klasse: "duplicate_slot_name", regel: "R3", schwere: "fehler", zeile: e.zeile, slot: name }));
      continue;
    }
    gesehen.set(name, e);
    const eintrag = Object.prototype.hasOwnProperty.call(eintraege, name) ? eintraege[name] : undefined;
    if (eintrag === undefined || eintrag === null) {
      befunde.push(befund({ klasse: "missing_slot_entry", regel: "R3", schwere: "fehler", zeile: e.zeile, slot: name }));
    } else if (eintrag.kind === "link" && e.tag !== "a") {
      befunde.push(befund({ klasse: "link_slot_not_anchor", regel: "R3", schwere: "fehler", zeile: e.zeile, slot: name, text: `<${e.tag}>` }));
    }
  }
  for (const name of Object.keys(eintraege)) {
    if (!gesehen.has(name)) befunde.push(befund({ klasse: "orphan_slot_entry", regel: "R3", schwere: "fehler", slot: name }));
  }

  for (const e of elements) {
    if ((e.tag === "section" || e.tag === "article") && !(e.attrs["aria-label"] ?? "").trim()) {
      befunde.push(befund({ klasse: "unlabeled_region", regel: "R4", schwere: "warnung", zeile: e.zeile, text: `<${e.tag}>` }));
    }
    if ("data-spalten" in e.attrs && !/^[1-4]$/.test((e.attrs["data-spalten"] ?? "").trim())) {
      befunde.push(befund({ klasse: "invalid_spalten", regel: "R4", schwere: "warnung", zeile: e.zeile, text: e.attrs["data-spalten"] ?? "" }));
    }
    if ("data-breiten" in e.attrs) {
      const werte = breitenAusText(e.attrs["data-breiten"] ?? "");
      const spalten = (e.attrs["data-spalten"] ?? "").trim();
      if (!werte || !/^[1-4]$/.test(spalten) || werte.length !== Number(spalten)) {
        befunde.push(befund({ klasse: "invalid_breiten", regel: "R4", schwere: "warnung", zeile: e.zeile, text: e.attrs["data-breiten"] ?? "" }));
      }
    }
  }

  const katalog = katalogKlassen(styles);
  for (const [name, eintrag] of Object.entries(eintraege)) {
    const stil = eintrag && typeof eintrag.style === "string" ? eintrag.style : undefined;
    if (stil && !katalog.has(stil)) {
      befunde.push(befund({ klasse: "unknown_style", regel: "R5", schwere: "fehler", zeile: gesehen.get(name)?.zeile, slot: name, text: stil }));
    }
  }
  const alle = new Set([...katalog.values()].flat());
  for (const e of gesehen.values()) {
    const falsch = (e.attrs.class ?? "").split(/\s+/).filter((k) => k && alle.has(k));
    if (falsch.length) befunde.push(befund({ klasse: "catalog_class_in_skeleton", regel: "R5", schwere: "warnung", zeile: e.zeile, slot: e.attrs["data-slot"], text: falsch.join(" ") }));
  }

  const legacy = elements.filter((e) => "data-widget-slot" in e.attrs);
  for (const e of legacy) befunde.push(befund({ klasse: "legacy_inline_slot", regel: "ALT", schwere: "warnung", zeile: e.zeile, text: e.attrs["data-widget-slot"] }));

  const streng = optionen.immerStreng || (elements.some((e) => "data-slot" in e.attrs) && legacy.length === 0);
  return streng ? befunde : befunde.map((b) => ({ ...b, schwere: "warnung" }));
}

/** Tab-wide rules over all skeletons of one tab: R3 uniqueness (TD-17) and R6. */
export function pruefeReiter(gerueste: [string | null, string][]): GeruestBefund[] {
  const befunde: GeruestBefund[] = [];
  const erste = new Map<string, string | null>();
  let h1 = 0;
  for (const [widgetId, html] of gerueste) {
    const { elements } = parse(html ?? "");
    const streng = istNeuesFormat(html ?? "");
    const lokal = new Set<string>();
    for (const e of elements) {
      if (e.tag === "h1") h1++;
      const name = "data-slot" in e.attrs ? e.attrs["data-slot"] : null;
      if (!name || !SLOT_NAME_MUSTER.test(name) || lokal.has(name)) continue;
      lokal.add(name);
      if (erste.has(name)) {
        befunde.push(befund({ klasse: "duplicate_slot_name", regel: "R3", schwere: streng ? "fehler" : "warnung", zeile: e.zeile, slot: name, widget_id: widgetId ?? undefined, text: "Name kommt in einem anderen Gerüst dieses Reiters schon vor" }));
      } else {
        erste.set(name, widgetId);
      }
    }
  }
  if (gerueste.length && h1 !== 1) befunde.push({ klasse: "heading_outline", regel: "R6", schwere: "warnung", text: `${h1} × <h1> im Reiter` });
  return befunde;
}

/**
 * Findings as shown elsewhere (designer, tree, verify): an old-format
 * skeleton carries one `legacy_format` finding instead of every rule hit
 * (K11-Altformat, 04 §4.2).
 */
export function angezeigteBefunde(widgets: WidgetRead[], befunde: Map<string, GeruestBefund[]>): Map<string, GeruestBefund[]> {
  const alt = new Set(widgets.filter((w) => w.kind === "custom_html" && !istNeuesFormat(htmlVon(w))).map((w) => w.id));
  return new Map([...befunde.entries()].map(([k, bs]) => [k, alt.has(k) ? [altformatBefund(bs, k)] : bs]));
}

/** Findings of every skeleton of a tab (R1-R6), keyed by widget id. */
export function befundeDesReiters(widgets: WidgetRead[], styles?: readonly { id?: unknown; class?: unknown }[] | null): Map<string, GeruestBefund[]> {
  const gerueste = widgets.filter((w) => w.kind === "custom_html");
  const map = new Map<string, GeruestBefund[]>();
  for (const w of gerueste) map.set(w.id, pruefeGeruest(htmlVon(w), slotsVon(w.config), styles).map((b) => ({ ...b, widget_id: w.id })));
  for (const b of pruefeReiter(gerueste.map((w) => [w.id, htmlVon(w)]))) {
    const key = b.widget_id ?? "";
    map.set(key, [...(map.get(key) ?? []), b]);
  }
  return map;
}
