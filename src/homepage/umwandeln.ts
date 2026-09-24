// `homepage convert` (Lastenheft homepage-generator/17-designer-struktur, Sub-File 06 §4.3).
// Turns a legacy skeleton into the new format — locally, into a file. Applying
// stays `homepage apply` after the human approved (07).
//
// Leaf level only (TD-18): an element becomes a building block when it carries
// its own text and every child is an inline element without classes. Nothing is
// wrapped: loose text next to elements stays and is reported, so the DOM keeps
// its shape and the club CSS keeps working (D6: the page must look the same).
import {
  befundeDesReiters,
  dokument,
  htmlVon,
  slotsVon,
  SLOT_NAME_MUSTER,
  type DomElement,
  type GeruestBefund,
  type SlotEntry,
  type WidgetRead,
} from "./geruest.ts";

export interface StyleEntry {
  id: string;
  label: string;
  class: string;
  fuer: ("heading" | "text" | "link")[];
}

export interface BulkWidget {
  kind: string;
  title?: string | null;
  config: Record<string, unknown>;
  slot_index?: number;
}

export interface BulkSection {
  layout?: string;
  style_variant?: string;
  sort_order?: number;
  title?: string | null;
  is_visible?: boolean;
  bg_image_url?: string | null;
  widgets: BulkWidget[];
}

export interface BulkTab {
  label: string;
  slug: string;
  icon?: string | null;
  navigation_group?: string | null;
  position?: number;
  visibility_scope?: string;
  department_id?: string | null;
  sections: BulkSection[];
}

export interface OffeneStelle {
  grund: string;
  text: string;
}

export interface UmwandlungsBericht {
  tab: string;
  umgewandelt: number;
  offene_stellen: OffeneStelle[];
  katalogklassen_verschoben: number;
  befunde: GeruestBefund[];
}

const INLINE_OHNE_KLASSE = new Set(["STRONG", "EM", "B", "I", "BR", "A"]);
const AUSZUG = 60;

const auszug = (t: string) => {
  const k = t.split(/\s+/).filter(Boolean).join(" ");
  return k.length <= AUSZUG ? k : `${k.slice(0, AUSZUG - 1)}…`;
};

function eigenerText(el: DomElement): string[] {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim())
    .map((n) => n.textContent ?? "");
}

function istAusgenommen(el: DomElement): boolean {
  for (let e: DomElement | null = el; e; e = e.parentElement) {
    if (e.tagName === "SVG" || e.tagName === "svg") return true;
    if ((e.getAttribute("aria-hidden") ?? "").toLowerCase() === "true") return true;
    if (e.hasAttribute("data-slot") || e.hasAttribute("data-widget-slot")) return true;
  }
  return false;
}

function inTabelle(el: DomElement): boolean {
  for (let e: DomElement | null = el; e; e = e.parentElement) if (["TABLE", "TD", "TH"].includes(e.tagName)) return true;
  return false;
}

/** Area short name: first class of the nearest section/article without the club prefix, else its label. */
function bereichKuerzel(el: DomElement): string {
  for (let e: DomElement | null = el; e; e = e.parentElement) {
    if (e.tagName !== "SECTION" && e.tagName !== "ARTICLE") continue;
    const erste = (e.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
    if (erste) return slug(erste.includes("-") ? erste.slice(erste.indexOf("-") + 1) : erste) || "bereich";
    const label = (e.getAttribute("aria-label") ?? "").split(/\s+/).slice(0, 3).join(" ");
    if (label) return slug(label) || "bereich";
  }
  return "seite";
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const ART_KURZ: Record<string, string> = { heading: "titel", text: "text", link: "knopf" };

function naechsterFreierName(vorhanden: Set<string>, basis: string): string {
  const stamm = basis.slice(0, 60);
  let name = stamm;
  for (let n = 2; vorhanden.has(name) || !SLOT_NAME_MUSTER.test(name); n++) name = `${stamm}-${n}`;
  vorhanden.add(name);
  return name;
}

function headingText(el: DomElement): string {
  let text = "";
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) text += n.textContent ?? "";
    else if ((n as DomElement).tagName === "BR") text += "\n";
    else text += (n as DomElement).textContent ?? "";
  }
  return text.replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}

/** Catalog entry whose classes the element carries completely — most classes win (TD-16). */
function passenderStil(el: DomElement, kind: string, styles: StyleEntry[]): StyleEntry | null {
  const klassen = new Set((el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
  let bester: StyleEntry | null = null;
  for (const s of styles) {
    if (!s.fuer.includes(kind as StyleEntry["fuer"][number])) continue;
    const k = s.class.split(/\s+/).filter(Boolean);
    if (k.length && k.every((x) => klassen.has(x)) && (!bester || k.length > bester.class.split(/\s+/).length)) bester = s;
  }
  return bester;
}

/** Convert one skeleton; names are unique across the tab through `vorhanden`. */
export function wandleGeruestUm(
  html: string,
  slotsVorher: Record<string, SlotEntry>,
  vorhanden: Set<string>,
  optionen: { styles?: StyleEntry[] } = {},
): { html: string; slots: Record<string, SlotEntry>; umgewandelt: number; offene: OffeneStelle[]; verschoben: number; klassen: Map<string, Set<string>> } {
  const doc = dokument(html);
  const body = doc.body;
  const slots: Record<string, SlotEntry> = { ...slotsVorher };
  const offene: OffeneStelle[] = [];
  const klassen = new Map<string, Set<string>>();
  let umgewandelt = 0;
  let verschoben = 0;

  // 4. Name every section/article after its first heading (before headings become slots).
  for (const el of Array.from(body.querySelectorAll("section, article"))) {
    if ((el.getAttribute("aria-label") ?? "").trim()) continue;
    const h = el.querySelector("h1, h2, h3, h4, h5, h6");
    const text = h ? headingText(h).replace(/\n/g, " ") : "";
    if (text) el.setAttribute("aria-label", text.slice(0, 80));
  }

  // 1. Legacy inline slots → named slots.
  for (const el of Array.from(body.querySelectorAll("[data-widget-slot]"))) {
    const kind = el.getAttribute("data-widget-slot") ?? "";
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(el.getAttribute("data-widget-config") || "{}");
    } catch {
      offene.push({ grund: "data-widget-config ist kein gültiges JSON", text: kind });
    }
    const name = naechsterFreierName(vorhanden, `${bereichKuerzel(el)}-${kind.replace(/_/g, "-")}`);
    el.removeAttribute("data-widget-slot");
    el.removeAttribute("data-widget-config");
    el.setAttribute("data-slot", name);
    slots[name] = { kind, config };
    umgewandelt++;
  }

  // 2./3. Leaf elements → building blocks; mixed content and images are reported.
  const kandidaten = Array.from(body.querySelectorAll("*")).filter((el) => !istAusgenommen(el));
  const erledigt = new Set<DomElement>();
  for (const el of kandidaten) {
    if (erledigt.has(el) || istAusgenommen(el)) continue;
    if (el.tagName === "IMG") {
      offene.push({ grund: "Bild im Gerüst (img)", text: el.getAttribute("src") ?? "" });
      continue;
    }
    const text = eigenerText(el);
    if (!text.length) continue;
    if (inTabelle(el)) {
      offene.push({ grund: "Text in einer Tabelle", text: auszug(text.join(" ")) });
      continue;
    }
    const kinder = Array.from(el.children);
    const nurInline = kinder.every((k) => INLINE_OHNE_KLASSE.has(k.tagName) && !k.getAttribute("class"));
    if (!nurInline) {
      // Mixed content: the loose text stays skeleton; child elements are
      // visited on their own (TD-18).
      offene.push({ grund: "Text neben Elementen (gemischter Inhalt)", text: auszug(text.join(" ")) });
      continue;
    }
    const tag = el.tagName;
    let eintrag: SlotEntry;
    if (/^H[1-6]$/.test(tag)) {
      eintrag = { kind: "heading", config: { text: headingText(el) } };
    } else if (tag === "A" && el.hasAttribute("href")) {
      eintrag = {
        kind: "link",
        config: { label: (el.textContent ?? "").replace(/\s+/g, " ").trim(), href: el.getAttribute("href") ?? "", new_tab: el.getAttribute("target") === "_blank" },
      };
      el.removeAttribute("href");
      el.removeAttribute("target");
      el.removeAttribute("rel");
    } else {
      eintrag = { kind: "text", config: { content: el.innerHTML.trim() } };
    }
    if (optionen.styles?.length) {
      const stil = passenderStil(el, eintrag.kind, optionen.styles);
      if (stil) {
        const weg = new Set(stil.class.split(/\s+/));
        const rest = (el.getAttribute("class") ?? "").split(/\s+/).filter((k) => k && !weg.has(k));
        if (rest.length) el.setAttribute("class", rest.join(" "));
        else el.removeAttribute("class");
        eintrag.style = stil.id;
        verschoben++;
      }
    }
    const cls = (el.getAttribute("class") ?? "").trim();
    if (cls) klassen.set(cls, new Set([...(klassen.get(cls) ?? []), eintrag.kind]));
    const kurz = ART_KURZ[eintrag.kind] ?? eintrag.kind;
    const name = naechsterFreierName(vorhanden, `${bereichKuerzel(el)}-${kurz}`);
    // Mark the descendants BEFORE emptying the element: once detached they no
    // longer know they sat inside a slot and would be converted on their own.
    el.querySelectorAll("*").forEach((k) => erledigt.add(k));
    el.setAttribute("data-slot", name);
    while (el.firstChild) el.removeChild(el.firstChild);
    slots[name] = eintrag;
    umgewandelt++;
  }

  return { html: body.innerHTML, slots, umgewandelt, offene, verschoben, klassen };
}

/** Convert every skeleton of a tab; the report carries R1–R6 on the result. */
export function wandleUm(tab: BulkTab, optionen: { styles?: StyleEntry[] } = {}): { tab: BulkTab; bericht: UmwandlungsBericht; klassen: Map<string, Set<string>> } {
  const vorhanden = new Set<string>();
  for (const s of tab.sections) {
    for (const w of s.widgets) {
      if (w.kind !== "custom_html") continue;
      const body = dokument(htmlVon(w)).body;
      body.querySelectorAll("[data-slot]").forEach((e) => vorhanden.add(e.getAttribute("data-slot") ?? ""));
    }
  }
  let umgewandelt = 0;
  let verschoben = 0;
  const offene: OffeneStelle[] = [];
  const klassen = new Map<string, Set<string>>();
  const sections = tab.sections.map((s) => ({
    ...s,
    widgets: s.widgets.map((w) => {
      if (w.kind !== "custom_html") return w;
      const r = wandleGeruestUm(htmlVon(w), slotsVon(w.config), vorhanden, optionen);
      umgewandelt += r.umgewandelt;
      verschoben += r.verschoben;
      offene.push(...r.offene);
      r.klassen.forEach((arten, k) => klassen.set(k, new Set([...(klassen.get(k) ?? []), ...arten])));
      return { ...w, config: { ...w.config, html: r.html, slots: r.slots } };
    }),
  }));
  const neu = { ...tab, sections };
  const widgets: WidgetRead[] = sections.flatMap((s, i) => s.widgets.map((w, j) => ({ id: `w-${i}-${j}`, kind: w.kind, config: w.config })));
  const befunde = [...befundeDesReiters(widgets, optionen.styles).values()].flat();
  return {
    tab: neu,
    bericht: { tab: tab.slug, umgewandelt, offene_stellen: offene, katalogklassen_verschoben: verschoben, befunde },
    klassen,
  };
}

/** `--styles-out`: a catalog proposal from the classes of converted building blocks. */
export function katalogVorschlag(klassen: Map<string, Set<string>>): StyleEntry[] {
  const vorhanden = new Set<string>();
  return [...klassen.entries()].map(([klasse, arten]) => ({
    id: naechsterFreierName(vorhanden, slug(klasse) || "stil"),
    label: klasse,
    class: klasse.split(/\s+/).slice(0, 4).join(" "),
    fuer: [...arten].filter((a): a is StyleEntry["fuer"][number] => a === "heading" || a === "text" || a === "link"),
  })).filter((s) => s.fuer.length);
}
