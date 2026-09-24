// Skeleton rules R1–R6 in the CLI (Lastenheft homepage-generator/17-designer-struktur,
// Sub-File 06 §4.4). A mirror of club-service app/utils/geruest_regeln.py and
// web-page designer/geruestRegeln.ts: same classes, severities and line
// numbers. The fixtures in tests/fixtures/geruest_regeln are copies of the
// service's — change all three or none.
//
// The input is sanitized HTML, so a small tokenizer is enough — and unlike a
// DOM it knows the line of every tag and text.

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

const VOID = new Set(["br", "hr", "img", "wbr", "input", "meta", "link", "source", "area", "col", "embed", "param", "track"]);
const AUSZUG = 80;

interface Element {
  tag: string;
  attrs: Record<string, string>;
  zeile: number;
  parent: Element | null;
}

interface Text {
  text: string;
  zeile: number;
  parent: Element | null;
}

interface Baum {
  elements: Element[];
  texts: Text[];
}

const ENTITAETEN: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

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

function parse(html: string): Baum {
  const elements: Element[] = [];
  const texts: Text[] = [];
  const stack: Element[] = [];
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
        const el: Element = { tag: name, attrs, zeile: start, parent: stack[stack.length - 1] ?? null };
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

function vorfahren(el: Element | null): Element[] {
  const r: Element[] = [];
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

/** TD-14: at least one data-slot and no data-widget-slot. */
export function istNeuesFormat(html: string): boolean {
  const { elements } = parse(html);
  return elements.some((e) => "data-slot" in e.attrs) && !elements.some((e) => "data-widget-slot" in e.attrs);
}

/** R1, R2, R3 (without tab-wide uniqueness), R4, R5 for one skeleton. */
export function pruefeGeruest(
  html: string,
  slots: Eintraege,
  styles?: Katalog,
  optionen: { immerStreng?: boolean } = {},
): GeruestBefund[] {
  const { elements, texts } = parse(html ?? "");
  const eintraege = slots ?? {};
  const befunde: GeruestBefund[] = [];
  const imSlot = (e: Element | null) => vorfahren(e).some((a) => "data-slot" in a.attrs);

  for (const t of texts) {
    const ausgenommen = vorfahren(t.parent).some(
      (a) => "data-slot" in a.attrs || a.tag === "svg" || (a.attrs["aria-hidden"] ?? "").trim().toLowerCase() === "true",
    );
    if (!ausgenommen) befunde.push(befund({ klasse: "fixed_text_in_skeleton", regel: "R1", schwere: "fehler", zeile: t.zeile, text: auszug(t.text) }));
  }

  for (const e of elements) {
    if (((e.tag === "a" && "href" in e.attrs) || e.tag === "img") && !imSlot(e)) {
      befunde.push(befund({ klasse: "content_in_skeleton", regel: "R2", schwere: "fehler", zeile: e.zeile, text: `<${e.tag}>` }));
    }
  }

  const gesehen = new Map<string, Element>();
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
    if (falsch.length) {
      befunde.push(befund({ klasse: "catalog_class_in_skeleton", regel: "R5", schwere: "warnung", zeile: e.zeile, slot: e.attrs["data-slot"], text: falsch.join(" ") }));
    }
  }

  const legacy = elements.filter((e) => "data-widget-slot" in e.attrs);
  for (const e of legacy) {
    befunde.push(befund({ klasse: "legacy_inline_slot", regel: "ALT", schwere: "warnung", zeile: e.zeile, text: e.attrs["data-widget-slot"] }));
  }

  const streng = optionen.immerStreng || (elements.some((e) => "data-slot" in e.attrs) && legacy.length === 0);
  return streng ? befunde : befunde.map((b) => ({ ...b, schwere: "warnung" }));
}

/** R5 warning: a catalog class without a rule in the club CSS. */
export function pruefeKatalog(styles: Katalog, css: string | null | undefined): GeruestBefund[] {
  const befunde: GeruestBefund[] = [];
  for (const [id, klassen] of katalogKlassen(styles)) {
    for (const k of klassen) {
      const re = new RegExp("\\." + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9_-])");
      if (!re.test(css ?? "")) befunde.push({ klasse: "unused_catalog_style", regel: "R5", schwere: "warnung", text: `${id}: .${k}` });
    }
  }
  return befunde;
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
        befunde.push(befund({
          klasse: "duplicate_slot_name", regel: "R3", schwere: streng ? "fehler" : "warnung", zeile: e.zeile,
          slot: name, widget_id: widgetId ?? undefined, text: "Name kommt in einem anderen Gerüst dieses Reiters schon vor",
        }));
      } else {
        erste.set(name, widgetId);
      }
    }
  }
  if (gerueste.length && h1 !== 1) befunde.push({ klasse: "heading_outline", regel: "R6", schwere: "warnung", text: `${h1} × <h1> im Reiter` });
  return befunde;
}

export const fehler = (befunde: GeruestBefund[]) => befunde.filter((b) => b.schwere === "fehler");
export const warnungen = (befunde: GeruestBefund[]) => befunde.filter((b) => b.schwere === "warnung");
