// Tree of a homepage tab in the CLI (Lastenheft homepage-generator/17-designer-struktur,
// Sub-File 06 §4.1). The same derivation as the designer (web-page
// designer/designerModel.ts `baum`, 03 §4.2): Reiter → Bereich → Slot for
// skeletons in the new format, Sektion → Widget otherwise, legacy slots as
// "<kind> · Position n". TC-CC-17-01: for the same configuration both give the
// same tree (shared fixture tests/fixtures/baum/).
import { DOMParser } from "linkedom";
import {
  istNeuesFormat,
  pruefeGeruest,
  pruefeReiter,
  type GeruestBefund,
} from "./regeln.ts";

export * from "./regeln.ts";

// The part of the DOM the CLI uses, typed structurally: the CLI compiles
// without lib "dom" (Bun types own fetch & co.), linkedom provides the objects.
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

export interface TabRead {
  id: string;
  label?: string;
  slug?: string;
  visibility_scope?: string;
}

export interface SectionRead {
  id: string;
  sort_order?: number;
  layout?: string;
  title?: string | null;
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

export interface BaumKnoten {
  pfad: string;
  art: "reiter" | "sektion" | "widget" | "bereich" | "slot" | "alt";
  name: string;
  beschriftung: string;
  kuerzel?: string;
  /** Tab address of a slot: `<slug>/<name>` (CLI `slot get/set`). */
  adresse?: string;
  kind?: string;
  style?: string;
  altformat?: boolean;
  ohneEintrag?: boolean;
  befunde: GeruestBefund[];
  kinder: BaumKnoten[];
}

const ART: Record<string, { beschriftung: string; kuerzel: string }> = {
  heading: { beschriftung: "Überschrift", kuerzel: "H" },
  text: { beschriftung: "Text", kuerzel: "T" },
  link: { beschriftung: "Knopf", kuerzel: "K" },
  image: { beschriftung: "Bild", kuerzel: "B" },
  ticker: { beschriftung: "Lauftext", kuerzel: "L" },
};

export function artBeschriftung(kind: string): { beschriftung: string; kuerzel: string } {
  return ART[kind] ?? { beschriftung: kind, kuerzel: (kind[0] ?? "?").toUpperCase() };
}

export function slotsVon(config: unknown): Record<string, SlotEntry> {
  const s = (config as { slots?: unknown } | undefined)?.slots;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, SlotEntry>) : {};
}

export const htmlVon = (w: { config?: Record<string, unknown> }) => (typeof w.config?.html === "string" ? w.config.html : "");

export function dokument(html: string): DomDokument {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html") as unknown as DomDokument;
}

const bereicheVon = (body: DomElement) =>
  Array.from(body.querySelectorAll("[aria-label]")).filter((e) => (e.getAttribute("aria-label") ?? "").trim());

function geruestKnoten(tab: TabRead, w: WidgetRead, befunde: GeruestBefund[]): { knoten: BaumKnoten[]; altformat: boolean } {
  const html = htmlVon(w);
  const body = dokument(html).body;
  const slots = slotsVon(w.config);
  const altformat = !istNeuesFormat(html);
  const bereiche = bereicheVon(body);
  const alle = Array.from(body.querySelectorAll("[data-widget-slot]"));
  const slug = tab.slug ?? tab.id;

  const besuche = (el: DomElement): BaumKnoten[] => {
    const r: BaumKnoten[] = [];
    for (const kind of Array.from(el.children)) {
      const label = (kind.getAttribute("aria-label") ?? "").trim();
      if (kind.hasAttribute("data-slot")) {
        const name = kind.getAttribute("data-slot") ?? "";
        const eintrag = Object.prototype.hasOwnProperty.call(slots, name) ? slots[name] : undefined;
        const art = eintrag ? artBeschriftung(eintrag.kind) : { beschriftung: "ohne Inhalt", kuerzel: "?" };
        const ebene = /^H([1-6])$/i.exec(kind.tagName)?.[1];
        r.push({
          pfad: `${tab.id}/${w.id}/slot:${name}`,
          art: "slot",
          name,
          beschriftung: art.beschriftung,
          kuerzel: eintrag?.kind === "heading" && ebene ? `H${ebene}` : art.kuerzel,
          adresse: `${slug}/${name}`,
          kind: eintrag?.kind,
          style: eintrag?.style,
          ohneEintrag: !eintrag,
          altformat,
          befunde: befunde.filter((b) => b.slot === name),
          kinder: [],
        });
      } else if (kind.hasAttribute("data-widget-slot")) {
        const i = alle.indexOf(kind);
        const k = kind.getAttribute("data-widget-slot") ?? "";
        const art = artBeschriftung(k);
        r.push({ pfad: `${tab.id}/${w.id}/alt:${i}`, art: "alt", name: `${art.beschriftung} · Position ${i + 1}`, beschriftung: art.beschriftung, kuerzel: art.kuerzel, kind: k, altformat: true, befunde: [], kinder: [] });
      } else if (label) {
        r.push({ pfad: `${tab.id}/${w.id}/bereich:${bereiche.indexOf(kind)}`, art: "bereich", name: label, beschriftung: "Bereich", altformat, befunde: [], kinder: besuche(kind) });
      } else {
        r.push(...besuche(kind));
      }
    }
    return r;
  };
  return { knoten: besuche(body), altformat };
}

/** Findings of every skeleton of a tab (R1–R6), keyed by widget id. */
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

export function baum(
  tab: TabRead,
  sections: SectionRead[],
  widgets: WidgetRead[],
  styles?: readonly { id?: unknown; class?: unknown }[] | null,
): BaumKnoten {
  const befunde = befundeDesReiters(widgets, styles);
  const kinder: BaumKnoten[] = [];
  const reihe = (a: WidgetRead, b: WidgetRead) => (a.slot_index ?? 0) - (b.slot_index ?? 0) || (a.position ?? 0) - (b.position ?? 0);
  for (const s of [...sections].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const unter: BaumKnoten[] = [];
    const ws = widgets.filter((w) => w.section_id === s.id).sort(reihe);
    let durchsichtig = ws.length > 0;
    for (const w of ws) {
      if (w.kind === "custom_html") {
        const { knoten, altformat } = geruestKnoten(tab, w, befunde.get(w.id) ?? []);
        if (altformat) {
          durchsichtig = false;
          unter.push({ pfad: `${tab.id}/${w.id}`, art: "widget", name: w.title || "HTML-Gerüst", beschriftung: "Altformat", kuerzel: "</>", kind: w.kind, altformat: true, befunde: befunde.get(w.id) ?? [], kinder: knoten });
        } else {
          unter.push(...knoten);
        }
      } else {
        durchsichtig = false;
        const art = artBeschriftung(w.kind);
        unter.push({ pfad: `${tab.id}/${w.id}`, art: "widget", name: w.title || art.beschriftung, beschriftung: art.beschriftung, kuerzel: art.kuerzel, kind: w.kind, befunde: [], kinder: [] });
      }
    }
    if (durchsichtig) kinder.push(...unter);
    else kinder.push({ pfad: `${tab.id}/${s.id}`, art: "sektion", name: s.title || "Sektion", beschriftung: s.layout ?? "", befunde: [], kinder: unter });
  }
  return {
    pfad: tab.id,
    art: "reiter",
    name: tab.label ?? tab.slug ?? tab.id,
    beschriftung: tab.visibility_scope ?? "",
    befunde: [...befunde.values()].flat(),
    kinder,
  };
}

/** Plain-text tree, one node per line. */
export function baumAlsText(k: BaumKnoten, tiefe = 0): string {
  const zeile = [
    "  ".repeat(tiefe),
    k.kuerzel ? `[${k.kuerzel}] ` : "",
    k.art === "slot" ? k.adresse ?? k.name : k.name,
    k.art === "slot" ? ` · ${k.beschriftung}${k.style ? ` · Stil ${k.style}` : ""}` : k.art === "bereich" ? " (Bereich)" : "",
    k.altformat && k.art !== "reiter" && k.art !== "bereich" ? " · Altformat" : "",
    k.ohneEintrag ? " · OHNE INHALT" : "",
    k.befunde.length && k.art !== "reiter" ? `  ⚠ ${k.befunde.map((b) => b.klasse).join(", ")}` : "",
  ].join("");
  return [zeile, ...k.kinder.map((c) => baumAlsText(c, tiefe + 1))].join("\n");
}

/** Slot address `<slug>/<name>` → the skeleton that holds it (names are unique per tab, TD-17). */
export function findeSlot(widgets: WidgetRead[], name: string): WidgetRead | null {
  for (const w of widgets) {
    if (w.kind !== "custom_html") continue;
    const body = dokument(htmlVon(w)).body;
    if (Array.from(body.querySelectorAll("[data-slot]")).some((e) => e.getAttribute("data-slot") === name)) return w;
  }
  return null;
}
