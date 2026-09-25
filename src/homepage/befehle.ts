// `homepage tree | slot get | slot set | convert` (Lastenheft homepage-generator/
// 17-designer-struktur, Sub-File 06 §4.1–4.3). The logic takes the HTTP client
// as a parameter so the tests run without a network.
//
// Exit codes of this contract: 3 = tab or slot not found, 4 = the service
// refused (409 widget_changed, 422 with findings); network and other HTTP
// errors keep the CLI's general handling.
import { HttpError } from "../http.ts";
import {
  baum,
  dokument,
  findeSlot,
  htmlVon,
  pruefeGeruest,
  pruefeReiter,
  slotsVon,
  type BaumKnoten,
  type GeruestBefund,
  type SectionRead,
  type SlotEntry,
  type TabRead,
  type WidgetRead,
} from "./geruest.ts";
import { katalogVorschlag, wandleUm, type BulkTab, type StyleEntry, type UmwandlungsBericht } from "./umwandeln.ts";

export interface HomepageClient {
  get<T = unknown>(service: string, path: string): Promise<T>;
  patch<T = unknown>(service: string, path: string, body?: unknown): Promise<T>;
}

export class HomepageAbbruch extends Error {
  constructor(public exitCode: 3 | 4, public code: string, message: string, public daten?: unknown) {
    super(message);
    this.name = "HomepageAbbruch";
  }
}

type LiveTab = TabRead & {
  label?: string;
  icon?: string | null;
  navigation_group?: string | null;
  position?: number;
  department_id?: string | null;
};
type LiveSection = SectionRead & { style_variant?: string; is_visible?: boolean; bg_image_url?: string | null };

export async function ladeReiter(client: HomepageClient, clubId: string): Promise<LiveTab[]> {
  const tabs = await client.get<LiveTab[]>("club", `/home-config/${clubId}/tabs`);
  return [...(tabs ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export async function ladeInhalt(client: HomepageClient, clubId: string, tabId: string): Promise<{ sections: LiveSection[]; widgets: WidgetRead[] }> {
  const [sections, widgets] = await Promise.all([
    client.get<LiveSection[]>("club", `/home-config/${clubId}/tabs/${tabId}/sections`),
    client.get<WidgetRead[]>("club", `/home-config/${clubId}/tabs/${tabId}/widgets`),
  ]);
  return { sections: sections ?? [], widgets: widgets ?? [] };
}

export async function ladeKatalog(client: HomepageClient, clubId: string): Promise<StyleEntry[]> {
  try {
    const s = await client.get<{ design_settings?: { styles?: StyleEntry[] } }>("club", `/clubs/${clubId}/settings`);
    return s?.design_settings?.styles ?? [];
  } catch {
    return [];
  }
}

function reiterZu(tabs: LiveTab[], slug: string): LiveTab {
  const tab = tabs.find((t) => t.slug === slug);
  if (!tab) throw new HomepageAbbruch(3, "tab_not_found", `Reiter "${slug}" gibt es nicht. Vorhanden: ${tabs.map((t) => t.slug).join(", ")}`);
  return tab;
}

export function zerlegeAdresse(adresse: string | undefined): { slug: string; name: string } {
  const [slug, name, ...rest] = (adresse ?? "").split("/");
  if (!slug || !name || rest.length) throw new Error(`Slot-Adresse "<reiter>/<slot>" erwartet, bekommen: "${adresse ?? ""}"`);
  return { slug, name };
}

// ── tree ─────────────────────────────────────────────────────────────────────

export async function tree(client: HomepageClient, clubId: string, tabSlug?: string): Promise<BaumKnoten[]> {
  const tabs = await ladeReiter(client, clubId);
  const auswahl = tabSlug ? [reiterZu(tabs, tabSlug)] : tabs;
  const styles = await ladeKatalog(client, clubId);
  const ergebnis: BaumKnoten[] = [];
  for (const t of auswahl) {
    const { sections, widgets } = await ladeInhalt(client, clubId, t.id);
    ergebnis.push(baum(t, sections, widgets, styles));
  }
  return ergebnis;
}

// ── slot get / set ───────────────────────────────────────────────────────────

export interface SlotStand {
  widget_id: string;
  version: number;
  name: string;
  adresse: string;
  entry: SlotEntry | null;
}

async function findeSlotStand(client: HomepageClient, clubId: string, adresse: string): Promise<{ stand: SlotStand; widget: WidgetRead; widgets: WidgetRead[] }> {
  const { slug, name } = zerlegeAdresse(adresse);
  const tab = reiterZu(await ladeReiter(client, clubId), slug);
  const { widgets } = await ladeInhalt(client, clubId, tab.id);
  const widget = findeSlot(widgets, name);
  if (!widget) throw new HomepageAbbruch(3, "slot_not_found", `Slot "${name}" steht in keinem Gerüst des Reiters "${slug}".`);
  const entry = slotsVon(widget.config)[name] ?? null;
  return { stand: { widget_id: widget.id, version: widget.version ?? 1, name, adresse, entry }, widget, widgets };
}

export async function slotGet(client: HomepageClient, clubId: string, adresse: string): Promise<SlotStand> {
  return (await findeSlotStand(client, clubId, adresse)).stand;
}

export interface SlotSetErgebnis {
  geschrieben: boolean;
  vorher: SlotEntry | null;
  nachher: SlotEntry;
  befunde: GeruestBefund[];
  version?: number;
  widget_id: string;
}

export async function slotSet(
  client: HomepageClient,
  clubId: string,
  adresse: string,
  eintrag: SlotEntry,
  optionen: { expectedVersion?: number; trockenlauf?: boolean } = {},
): Promise<SlotSetErgebnis> {
  const { stand, widget, widgets } = await findeSlotStand(client, clubId, adresse);
  const slots = { ...slotsVon(widget.config), [stand.name]: eintrag };
  const styles = await ladeKatalog(client, clubId);
  const html = htmlVon(widget);
  const nachbarn = widgets.filter((w) => w.kind === "custom_html" && w.id !== widget.id);
  const befunde = [
    ...pruefeGeruest(html, slots, styles),
    ...pruefeReiter([...nachbarn.map((w) => [w.id, htmlVon(w)] as [string, string]), [widget.id, html]]).filter((b) => b.widget_id === widget.id || !b.widget_id),
  ];
  if (optionen.trockenlauf) {
    return { geschrieben: false, vorher: stand.entry, nachher: eintrag, befunde, widget_id: widget.id };
  }
  // Without --expected-version the version just read is used on purpose: who
  // changes the slot between read and write gets a 409, never overwritten.
  const erwartet = optionen.expectedVersion ?? stand.version;
  try {
    const res = await client.patch<WidgetRead>("club", `/home-config/${clubId}/widgets/${widget.id}/slots/${stand.name}`, {
      expected_version: erwartet,
      entry: eintrag,
    });
    return { geschrieben: true, vorher: stand.entry, nachher: eintrag, befunde, version: res?.version, widget_id: widget.id };
  } catch (err) {
    if (err instanceof HttpError && (err.status === 409 || err.status === 422)) {
      let detail: Record<string, unknown> = {};
      try {
        detail = (JSON.parse(err.body) as { detail?: Record<string, unknown> }).detail ?? {};
      } catch {
        detail = { text: err.body };
      }
      if (err.status === 409) {
        throw new HomepageAbbruch(4, "widget_changed", `Der Slot wurde inzwischen geändert (Version live: ${String(detail.live_version ?? "?")}). Erneut lesen mit "homepage slot get ${adresse}".`, detail);
      }
      throw new HomepageAbbruch(4, String(detail.code ?? "abgelehnt"), `Der Dienst hat den Slot abgelehnt: ${JSON.stringify(detail.befunde ?? detail)}`, detail);
    }
    throw err;
  }
}

// ── geruest set ──────────────────────────────────────────────────────────────

export interface GeruestSetErgebnis {
  geschrieben: boolean;
  /** The new HTML equals the live one — nothing to write. */
  unveraendert: boolean;
  widget_id: string;
  /** Version read before writing; after a write the version the service returned. */
  version: number;
  vorher_zeichen: number;
  nachher_zeichen: number;
  befunde: GeruestBefund[];
}

function widgetGeaendert(widgetId: string, gelesen: number, live: unknown): HomepageAbbruch {
  return new HomepageAbbruch(4, "widget_changed", `Das Gerüst-Widget ${widgetId} wurde inzwischen geändert (erwartet Version ${gelesen}, live ${String(live ?? "?")}). Neu lesen und erneut setzen.`, { live_version: live ?? null });
}

/** Skeleton files come from editors: no BOM, LF line ends — otherwise equal HTML reads as a change. */
export function geruestAusDatei(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/**
 * Replaces the skeleton HTML of ONE custom_html widget and keeps its slots
 * (09 §4.6: a club's grids get data-spalten without rebuilding the homepage).
 * `apply --clear` would recreate every tab, section and widget with new ids.
 *
 * Written through `PATCH …/widgets/{id}/geruest`: the service checks the
 * version under the tab lock and takes the slots from the stored config, so a
 * slot changed meanwhile is a 409, never overwritten (Fremdprüfung K9 R4).
 */
export async function geruestSet(
  client: HomepageClient,
  clubId: string,
  slug: string,
  widgetId: string,
  html: string,
  optionen: { expectedVersion?: number; trockenlauf?: boolean } = {},
): Promise<GeruestSetErgebnis> {
  const tab = reiterZu(await ladeReiter(client, clubId), slug);
  const { widgets } = await ladeInhalt(client, clubId, tab.id);
  const gerueste = widgets.filter((w) => w.kind === "custom_html");
  const widget = gerueste.find((w) => w.id === widgetId);
  if (!widget) {
    throw new HomepageAbbruch(3, "widget_not_found", `Gerüst-Widget "${widgetId}" gibt es im Reiter "${slug}" nicht. Gerüste dort: ${gerueste.map((w) => w.id).join(", ") || "keine"}`);
  }
  const version = widget.version ?? 1;
  if (optionen.expectedVersion !== undefined && optionen.expectedVersion !== version) {
    throw widgetGeaendert(widget.id, optionen.expectedVersion, version);
  }
  const styles = await ladeKatalog(client, clubId);
  const nachbarn = gerueste.filter((w) => w.id !== widget.id);
  const befunde = [
    ...pruefeGeruest(html, slotsVon(widget.config), styles),
    ...pruefeReiter([...nachbarn.map((w) => [w.id, htmlVon(w)] as [string, string]), [widget.id, html]]).filter((b) => b.widget_id === widget.id || !b.widget_id),
  ];
  const vorher = htmlVon(widget);
  const ergebnis: GeruestSetErgebnis = {
    geschrieben: false,
    unveraendert: vorher === html,
    widget_id: widget.id,
    version,
    vorher_zeichen: vorher.length,
    nachher_zeichen: html.length,
    befunde,
  };
  if (optionen.trockenlauf || ergebnis.unveraendert) return ergebnis;
  const fehler = befunde.filter((b) => b.schwere === "fehler");
  if (fehler.length) {
    throw new HomepageAbbruch(4, "geruest_fehler", `Das neue Gerüst hat ${fehler.length} Fehler: ${fehler.map((b) => b.klasse + (b.slot ? ` (${b.slot})` : "")).join(", ")}. Mit --dry-run ansehen.`, fehler);
  }
  let res: WidgetRead;
  try {
    res = await client.patch<WidgetRead>("club", `/home-config/${clubId}/widgets/${widget.id}/geruest`, {
      expected_version: optionen.expectedVersion ?? version,
      html,
    });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 409 || err.status === 422)) {
      let detail: Record<string, unknown> = {};
      try {
        const roh = (JSON.parse(err.body) as { detail?: unknown }).detail;
        detail = roh && typeof roh === "object" ? (roh as Record<string, unknown>) : { text: roh };
      } catch {
        detail = { text: err.body };
      }
      if (err.status === 409) throw widgetGeaendert(widget.id, optionen.expectedVersion ?? version, detail.live_version);
      throw new HomepageAbbruch(4, String(detail.code ?? "abgelehnt"), `Der Dienst hat das Gerüst abgelehnt: ${JSON.stringify(detail.befunde ?? detail)}`, detail);
    }
    if (err instanceof HttpError) throw err;
    // No answer: the write may or may not have arrived.
    throw new Error(`Keine Antwort vom Dienst (${(err as Error).message}). Ob das Gerüst geschrieben wurde, ist offen — mit "homepage tree --tab ${slug} --json" oder --dry-run nachsehen.`);
  }
  return { ...ergebnis, geschrieben: true, version: res?.version ?? version };
}

// ── convert ──────────────────────────────────────────────────────────────────

export interface ConvertErgebnis {
  home: { tabs: BulkTab[] };
  berichte: (UmwandlungsBericht | { tab: string; uebersprungen: string })[];
  katalog: StyleEntry[];
  hinweise: string[];
}

export async function liveAlsBulk(client: HomepageClient, clubId: string): Promise<{ tabs: BulkTab[]; hinweise: string[] }> {
  const hinweise: string[] = [];
  const tabs: BulkTab[] = [];
  for (const t of await ladeReiter(client, clubId)) {
    const { sections, widgets } = await ladeInhalt(client, clubId, t.id);
    const ohneSektion = widgets.filter((w) => !w.section_id);
    if (ohneSektion.length) {
      hinweise.push(`Reiter "${t.slug}": ${ohneSektion.length} Widget(s) ohne Sektion stehen nicht in der Datei — apply --clear würde sie entfernen.`);
    }
    tabs.push({
      label: t.label ?? t.slug ?? "",
      slug: t.slug ?? "",
      icon: t.icon ?? null,
      navigation_group: t.navigation_group ?? null,
      position: t.position ?? 0,
      visibility_scope: t.visibility_scope ?? "public",
      department_id: t.department_id ?? null,
      sections: [...sections]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((s, i) => ({
          layout: s.layout ?? "full",
          style_variant: s.style_variant ?? "default",
          sort_order: i,
          title: s.title ?? null,
          is_visible: s.is_visible ?? true,
          bg_image_url: s.bg_image_url ?? null,
          // 10 §4.3/§4.7: stored widths travel with the section, also where they do not take effect (D24).
          spalten_breiten: s.spalten_breiten ?? null,
          widgets: widgets
            .filter((w) => w.section_id === s.id)
            .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0) || (a.position ?? 0) - (b.position ?? 0))
            .map((w, j) => ({ kind: w.kind, title: w.title ?? null, config: w.config ?? {}, slot_index: j })),
        })),
    });
  }
  return { tabs, hinweise };
}

export function convert(quelle: { tabs: BulkTab[] }, optionen: { tab?: string; styles?: StyleEntry[] } = {}): ConvertErgebnis {
  const berichte: ConvertErgebnis["berichte"] = [];
  const alleKlassen = new Map<string, Set<string>>();
  const hinweise: string[] = [];
  if (optionen.tab && !quelle.tabs.some((t) => t.slug === optionen.tab)) {
    throw new HomepageAbbruch(3, "tab_not_found", `Reiter "${optionen.tab}" gibt es nicht.`);
  }
  const tabs = quelle.tabs.map((t) => {
    if (optionen.tab && t.slug !== optionen.tab) return t;
    const hatGeruest = t.sections.some((s) => s.widgets.some((w) => w.kind === "custom_html"));
    if (!hatGeruest) {
      berichte.push({ tab: t.slug, uebersprungen: "kein custom_html-Gerüst" });
      return t;
    }
    const { tab, bericht, klassen } = wandleUm(t, { styles: optionen.styles });
    klassen.forEach((arten, k) => alleKlassen.set(k, new Set([...(alleKlassen.get(k) ?? []), ...arten])));
    berichte.push(bericht);
    return tab;
  });
  return { home: { tabs }, berichte, katalog: katalogVorschlag(alleKlassen), hinweise };
}

/** Plain-text report of a conversion. */
export function berichtAlsText(e: ConvertErgebnis): string {
  const zeilen: string[] = [];
  for (const b of e.berichte) {
    if ("uebersprungen" in b) {
      zeilen.push(`${b.tab}: übersprungen (${b.uebersprungen})`);
      continue;
    }
    const fehler = b.befunde.filter((x) => x.schwere === "fehler").length;
    zeilen.push(`${b.tab}: ${b.umgewandelt} umgewandelt, ${b.offene_stellen.length} offene Stellen, ${b.katalogklassen_verschoben} Katalogklassen verschoben, ${fehler} Fehler / ${b.befunde.length - fehler} Warnungen`);
    for (const o of b.offene_stellen) zeilen.push(`  offen: ${o.grund} — ${o.text}`);
  }
  for (const h of e.hinweise) zeilen.push(`Hinweis: ${h}`);
  return zeilen.join("\n");
}

export { dokument };
