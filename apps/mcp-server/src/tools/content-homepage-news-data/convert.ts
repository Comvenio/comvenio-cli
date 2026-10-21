// cai.homepage.05.convert (comvenio-cli-doku 06 §4.3) — turns a legacy
// skeleton into the new format, LOCALLY on the tabs read from the live
// structure. Applying stays cai.homepage.02.apply after the human approved.
//
// Leaf level only (TD-18): an element becomes a building block when it
// carries its own text and every child is an inline element without classes.
// Nothing is wrapped: loose text next to elements stays and is reported, so
// the DOM keeps its shape and the club CSS keeps working (D6: the page must
// look the same).
//
// Ported unchanged from the CLI's own `src/homepage/umwandeln.ts` (last
// readable at commit 8988b21, before K4 removed `src/homepage/`) — only the
// entry point changed: the old `homepage convert` command read `--from`/live
// through `src/homepage/befehle.ts`'s `liveAlsBulk`; here the handler reads
// the flat `GET …/home-config/{club_id}/tabs` plus sections and widgets per
// tab, and `verschachtelteLiveTabs` below nests them into the shape
// cai.homepage.01/02 accept as input (src/schema/homepage.json `structure`).
import type { JsonValue } from "@comvenio/connector-contracts";

import {
  angezeigteBefunde,
  befundeDesReiters,
  dokument,
  htmlVon,
  slotsVon,
  SLOT_NAME_MUSTER,
  type DomElement,
  type GeruestBefund,
  type SlotEntry,
  type WidgetRead,
} from "./convert-geruest.ts";
import { homepageConfigFields } from "./schemas.ts";

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
  return Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim()).map((n) => n.textContent ?? "");
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
  return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

const ART_KURZ: Record<string, string> = { heading: "titel", text: "text", link: "knopf", image: "bild" };

/** The element sits inside a link: the link stays outside every slot (R2), so the image is reported. */
function inLink(el: DomElement): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === "A" && p.hasAttribute("href")) return true;
  return false;
}

/**
 * The renderer's image source rule (web-page slotRenderer `bildquelle`,
 * K6-Bild Codex R2): https, a site path, blob:, a base64 raster image, or
 * http (lifted to https there). An address it would drop — relative paths,
 * other schemes, protocol-relative — is reported instead of converted,
 * otherwise the image would vanish silently.
 */
export function bildquelleZulaessig(url: string): boolean {
  const kompakt = url.trim().replace(/[\u0000- ]/g, "").replace(/\\/g, "/");
  if (!kompakt || kompakt.startsWith("//")) return false;
  if (kompakt.startsWith("/")) return true;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(kompakt)) return true;
  try {
    return ["https:", "http:", "blob:"].includes(new URL(kompakt).protocol);
  } catch {
    return false;
  }
}

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

  for (const el of Array.from(body.querySelectorAll("section, article"))) {
    if ((el.getAttribute("aria-label") ?? "").trim()) continue;
    const h = el.querySelector("h1, h2, h3, h4, h5, h6");
    const text = h ? headingText(h).replace(/\n/g, " ") : "";
    if (text) el.setAttribute("aria-label", text.slice(0, 80));
  }

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

  const kandidaten = Array.from(body.querySelectorAll("*")).filter((el) => !istAusgenommen(el));
  const erledigt = new Set<DomElement>();
  for (const el of kandidaten) {
    if (erledigt.has(el) || istAusgenommen(el)) continue;
    if (el.tagName === "IMG") {
      const src = (el.getAttribute("src") ?? "").trim();
      if (!src) {
        offene.push({ grund: "Bild ohne Adresse (img)", text: "" });
        continue;
      }
      if (!bildquelleZulaessig(src)) {
        offene.push({ grund: "Bild mit unzulässiger Adresse (img)", text: src });
        continue;
      }
      if (inLink(el)) {
        offene.push({ grund: "Bild in einem Link (img in a)", text: src });
        continue;
      }
      const name = naechsterFreierName(vorhanden, `${bereichKuerzel(el)}-${ART_KURZ.image}`);
      slots[name] = { kind: "image", config: { url: src, alt: el.getAttribute("alt") ?? "" } };
      el.removeAttribute("src");
      el.removeAttribute("alt");
      el.setAttribute("data-slot", name);
      umgewandelt++;
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
      offene.push({ grund: "Text neben Elementen (gemischter Inhalt)", text: auszug(text.join(" ")) });
      continue;
    }
    const tag = el.tagName;
    let eintrag: SlotEntry;
    if (/^H[1-6]$/.test(tag)) {
      eintrag = { kind: "heading", config: { text: headingText(el) } };
    } else if (tag === "A" && el.hasAttribute("href")) {
      eintrag = { kind: "link", config: { label: (el.textContent ?? "").replace(/\s+/g, " ").trim(), href: el.getAttribute("href") ?? "", new_tab: el.getAttribute("target") === "_blank" } };
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
    el.querySelectorAll("*").forEach((k) => erledigt.add(k));
    el.setAttribute("data-slot", name);
    while (el.firstChild) el.removeChild(el.firstChild);
    slots[name] = eintrag;
    umgewandelt++;
  }

  return { html: body.innerHTML, slots, umgewandelt, offene, verschoben, klassen };
}

/** Convert every skeleton of a tab; the report carries R1-R6 on the result. */
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
  const befunde = [...angezeigteBefunde(widgets, befundeDesReiters(widgets, optionen.styles)).values()].flat();
  return { tab: neu, bericht: { tab: tab.slug, umgewandelt, offene_stellen: offene, katalogklassen_verschoben: verschoben, befunde }, klassen };
}

/** `--styles-out` equivalent: a catalog proposal from the classes of converted building blocks — computed but not part of the report (DC-7, „automatische Stilbenennung"): the agent names entries, the action only shows the material. */
export function katalogVorschlag(klassen: Map<string, Set<string>>): StyleEntry[] {
  const vorhanden = new Set<string>();
  return [...klassen.entries()].map(([klasse, arten]) => ({
    id: naechsterFreierName(vorhanden, slug(klasse) || "stil"),
    label: klasse,
    class: klasse.split(/\s+/).slice(0, 4).join(" "),
    fuer: [...arten].filter((a): a is StyleEntry["fuer"][number] => a === "heading" || a === "text" || a === "link"),
  })).filter((s) => s.fuer.length);
}

// ─── Reading the live structure and assembling the action result ─────────────

function jsonObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, JsonValue>) : {};
}
function jsonArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}
function jsonString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Live configs can carry keys the preview rejects for their kind — `show_title`
 * on ticker, image_gallery and event_hub_embed, which no renderer reads
 * (bug b72433d8, Jagabluat 2026-10-20). They are dropped and named in
 * `entfernt`, so the result passes cai.homepage.01.preview unchanged; the
 * closed field set itself stays (schemas.ts, Tom 2026-08-29). Unknown kinds are
 * left alone: the preview rejects them with their own message.
 */
function zulaessigeConfig(kind: string, config: Record<string, JsonValue>, ort: string, entfernt: string[]): Record<string, JsonValue> {
  const felder = homepageConfigFields(kind);
  if (!felder) return config;
  const behalten: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(config)) {
    if (felder.has(key)) behalten[key] = value;
    else entfernt.push(`${key} an ${kind}${ort}`);
  }
  if (kind === "custom_html" && behalten.slots !== undefined) {
    const slots = jsonObject(behalten.slots);
    behalten.slots = Object.fromEntries(Object.entries(slots).map(([name, raw]) => {
      const eintrag = jsonObject(raw);
      const slotArt = jsonString(eintrag.kind);
      if (!slotArt || slotArt === "custom_html" || eintrag.config === undefined) return [name, raw];
      return [name, { ...eintrag, config: zulaessigeConfig(slotArt, jsonObject(eintrag.config), ` (Slot ${name})`, entfernt) }];
    }));
  }
  return behalten;
}

export interface LiveInhalt {
  sections: JsonValue;
  widgets: JsonValue;
}

function zahl(value: JsonValue | undefined): number {
  return typeof value === "number" ? value : 0;
}

/**
 * `GET …/home-config/{club_id}/tabs` returns the tabs FLAT (club-service
 * `List[ClubHomeTabRead]`, no sections, no widgets). Sections and widgets come
 * per tab from `…/tabs/{tab_id}/sections` and `…/tabs/{tab_id}/widgets`; this
 * nests them like the pre-K4 CLI's `liveAlsBulk` (commit 8988b21). Without it
 * every tab reads as empty, and applying the result with `clear_existing: true`
 * would wipe the whole homepage (bug ddc0a35a, Jagabluat 2026-10-20).
 * A tab without fetched content keeps the sections it already carries.
 */
export function verschachtelteLiveTabs(value: JsonValue, inhalt: Map<string, LiveInhalt>): { tabs: JsonValue; hinweise: string[] } {
  const hinweise: string[] = [];
  const tabs = [...jsonArray(value)]
    .map(jsonObject)
    .sort((a, b) => zahl(a.position) - zahl(b.position))
    .map((t) => {
      const id = jsonString(t.id);
      const geladen = id ? inhalt.get(id) : undefined;
      if (!geladen) return t;
      const slug = jsonString(t.slug) ?? "";
      const widgets = jsonArray(geladen.widgets).map(jsonObject);
      const ohneSektion = widgets.filter((w) => !jsonString(w.section_id));
      if (ohneSektion.length) {
        hinweise.push(`Reiter "${slug}": ${ohneSektion.length} Widget(s) ohne Sektion stehen nicht in tabs — clear_existing: true würde sie entfernen.`);
      }
      const sections = jsonArray(geladen.sections)
        .map(jsonObject)
        .sort((a, b) => zahl(a.sort_order) - zahl(b.sort_order))
        .map((s, i) => {
          if (Array.isArray(s.spalten_breiten) && s.spalten_breiten.length) {
            hinweise.push(`Reiter "${slug}": Sektion ${i + 1} hat gespeicherte Spaltenbreiten — cai.homepage.02.apply überträgt sie nicht, nach dem Anwenden sind die Spalten gleich breit.`);
          }
          const eigene = widgets
            .filter((w) => jsonString(w.section_id) === jsonString(s.id))
            .sort((a, b) => zahl(a.slot_index) - zahl(b.slot_index) || zahl(a.position) - zahl(b.position))
            .map((w, j) => ({ ...w, slot_index: j }));
          return { ...s, sort_order: i, widgets: eigene };
        });
      return { ...t, sections };
    });
  return { tabs: tabs as JsonValue, hinweise };
}

/**
 * Picks the fields cai.homepage.01.preview/02.apply accept as `tabs` input
 * (src/schema/homepage.json `structure`) from tabs that carry their sections
 * and widgets nested — see verschachtelteLiveTabs for the live route.
 */
export function liveTabsAlsBulk(value: JsonValue): { tabs: BulkTab[]; hinweise: string[] } {
  const hinweise: string[] = [];
  const tabs = jsonArray(value).map((rawTab) => {
    const t = jsonObject(rawTab);
    const entfernt: string[] = [];
    const sections = jsonArray(t.sections).map((rawSection) => {
      const s = jsonObject(rawSection);
      const widgets = jsonArray(s.widgets).map((rawWidget) => {
        const w = jsonObject(rawWidget);
        const kind = jsonString(w.kind) ?? "";
        const widget: BulkWidget = { kind, title: jsonString(w.title), config: zulaessigeConfig(kind, jsonObject(w.config), "", entfernt) };
        if (typeof w.slot_index === "number") widget.slot_index = w.slot_index;
        return widget;
      });
      const section: BulkSection = {
        layout: jsonString(s.layout) ?? "full",
        style_variant: jsonString(s.style_variant) ?? "default",
        sort_order: typeof s.sort_order === "number" ? s.sort_order : 0,
        title: jsonString(s.title),
        is_visible: typeof s.is_visible === "boolean" ? s.is_visible : true,
        bg_image_url: jsonString(s.bg_image_url),
        widgets,
      };
      return section;
    });
    const label = jsonString(t.label) ?? jsonString(t.slug) ?? "";
    const slug = jsonString(t.slug) ?? "";
    const hatGeruest = sections.some((s) => s.widgets.some((w) => w.kind === "custom_html"));
    if (!hatGeruest) hinweise.push(`Reiter "${slug}": kein Gerüst (custom_html) — nichts umzustellen.`);
    if (entfernt.length) hinweise.push(`Reiter "${slug}": Felder entfernt, die cai.homepage.01.preview für die Art nicht annimmt — ${entfernt.join(", ")}.`);
    return { label, slug, icon: jsonString(t.icon), navigation_group: jsonString(t.navigation_group), position: typeof t.position === "number" ? t.position : 0, visibility_scope: jsonString(t.visibility_scope) ?? "public", department_id: jsonString(t.department_id), sections } satisfies BulkTab;
  });
  return { tabs, hinweise };
}

export interface ConvertBericht {
  umgewandelt: number;
  offene_stellen: (OffeneStelle & { tab: string })[];
  katalogklassen_verschoben: number;
  befunde: (GeruestBefund & { tab: string })[];
}
export interface ConvertErgebnis {
  tabs: BulkTab[];
  bericht: ConvertBericht;
  hinweise: string[];
}

/** Every skeleton of every tab of the live structure, aggregated into one report (comvenio-cli-doku 06 §4.3). */
export function convertLiveTabs(value: JsonValue, optionen: { styles?: StyleEntry[] } = {}): ConvertErgebnis {
  const { tabs: quelle, hinweise } = liveTabsAlsBulk(value);
  const bericht: ConvertBericht = { umgewandelt: 0, offene_stellen: [], katalogklassen_verschoben: 0, befunde: [] };
  const tabs = quelle.map((t) => {
    const hatGeruest = t.sections.some((s) => s.widgets.some((w) => w.kind === "custom_html"));
    if (!hatGeruest) return t;
    const { tab, bericht: b } = wandleUm(t, optionen);
    bericht.umgewandelt += b.umgewandelt;
    bericht.katalogklassen_verschoben += b.katalogklassen_verschoben;
    bericht.offene_stellen.push(...b.offene_stellen.map((o) => ({ ...o, tab: t.slug })));
    bericht.befunde.push(...b.befunde.map((f) => ({ ...f, tab: t.slug })));
    return tab;
  });
  if (tabs.length === 0) hinweise.push("Die Live-Seite hat keine Reiter — nichts umzustellen; cai.homepage.02.apply verlangt mindestens einen Reiter.");
  else hinweise.push("Übernehmen: tabs unverändert an cai.homepage.01.preview und danach an cai.homepage.02.apply mit clear_existing: true geben — ohne clear_existing entstehen die Reiter doppelt.");
  return { tabs, bericht, hinweise };
}

/** Style catalog from the club's design settings (`design_settings.styles`); malformed entries are skipped. */
export function stilKatalog(settings: JsonValue): StyleEntry[] {
  const design = jsonObject(jsonObject(settings).design_settings);
  return jsonArray(design.styles).flatMap((raw) => {
    const e = jsonObject(raw);
    const fuer = jsonArray(e.fuer).filter((f): f is StyleEntry["fuer"][number] => f === "heading" || f === "text" || f === "link");
    const id = jsonString(e.id), label = jsonString(e.label), klasse = jsonString(e.class);
    return id && klasse && fuer.length > 0 ? [{ id, label: label ?? id, class: klasse, fuer }] : [];
  });
}
