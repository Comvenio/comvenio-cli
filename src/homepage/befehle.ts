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
