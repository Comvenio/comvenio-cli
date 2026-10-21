// cai.homepage.05.convert (comvenio-cli-doku 06 §4.3, Test-Scenarios TC-03..TC-05).
// Der Algorithmus wandert unverändert aus dem gelöschten `src/homepage/umwandeln.ts`
// (Commit 8988b21) hierher — die Tests spiegeln TC-06/TC-09/TC-10 der Referenz
// designer-struktur-06 (§13), angewandt auf die Live-Struktur statt auf eine
// Datei.
import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";
import type { ComvenioApiRequest } from "@comvenio/comvenio-client";
import { describe, expect, test } from "bun:test";

import { convertLiveTabs, stilKatalog, type BulkTab } from "../src/tools/content-homepage-news-data/convert.ts";
import { K12_ACTION_DEFINITIONS } from "../src/tools/content-homepage-news-data/definitions.ts";
import { K12_ACTION_SCHEMAS } from "../src/tools/content-homepage-news-data/schemas.ts";
import { createK12ToolSets } from "../src/tools/content-homepage-news-data/tool-sets.ts";

function tab(slug: string, html: string, slots: Record<string, JsonValue> = {}): JsonValue {
  return {
    label: slug,
    slug,
    position: 0,
    visibility_scope: "public",
    sections: [
      {
        layout: "full",
        style_variant: "default",
        sort_order: 0,
        is_visible: true,
        widgets: [
          { kind: "custom_html", title: null, config: { html, slots }, slot_index: 0 },
        ],
      },
    ],
  };
}

describe("cai.homepage.05.convert — Algorithmus (comvenio-cli-doku 06 §4.3)", () => {
  test("TC-03: ein Reiter im alten Format wird umgewandelt, der Bericht zeigt umgewandelt > 0", () => {
    const html = '<section aria-label="Start"><div data-widget-slot="news" data-widget-config=\'{"limit":3}\'></div></section>';
    const live: JsonValue = [tab("start", html)];
    const { tabs, bericht } = convertLiveTabs(live);

    expect(bericht.umgewandelt).toBeGreaterThan(0);
    const section = (tabs[0] as BulkTab).sections[0]!;
    const widget = section.widgets[0]!;
    // Direkt fuer cai.homepage.02.apply verwendbar: dieselbe kind/config-Form
    // wie dessen Eingabeschema (`homepageWidget` in schemas.ts).
    expect(widget.kind).toBe("custom_html");
    expect((widget.config as { html: string }).html).toContain("data-slot=");
    expect((widget.config as { html: string }).html).not.toContain("data-widget-slot");
    const slots = (widget.config as { slots: Record<string, { kind: string; config: { limit?: number } }> }).slots;
    const slotEntry = Object.values(slots).find((s) => s.kind === "news");
    expect(slotEntry?.config.limit).toBe(3);
  });

  test("TC-04: ein zweiter Lauf auf dem bereits umgewandelten Gerüst bleibt ohne Änderung (Idempotenz)", () => {
    const html = '<section aria-label="Start"><div data-widget-slot="news" data-widget-config=\'{"limit":3}\'></div></section>';
    const erster = convertLiveTabs([tab("start", html)]);
    expect(erster.bericht.umgewandelt).toBeGreaterThan(0);

    const zweiter = convertLiveTabs(erster.tabs as unknown as JsonValue);
    expect(zweiter.bericht.umgewandelt).toBe(0);
    expect(zweiter.bericht.offene_stellen).toEqual([]);
    expect(zweiter.bericht.katalogklassen_verschoben).toBe(0);
    // Das Gerüst bleibt bytegleich — kein zweiter Lauf schreibt etwas um.
    const widgetVorher = (erster.tabs[0] as BulkTab).sections[0]!.widgets[0]!.config.html;
    const widgetNachher = (zweiter.tabs[0] as BulkTab).sections[0]!.widgets[0]!.config.html;
    expect(widgetNachher).toBe(widgetVorher);
  });

  test("TC-05: gemischter Inhalt wird als offene Stelle berichtet, nicht automatisch umgewandelt", () => {
    // Wie designer-struktur-06 TC-09: der span wird ein eigener Text-Slot,
    // der lose Text „19:30 Uhr" bleibt stehen und steht im Bericht.
    const html = '<section aria-label="Start"><div class="jaga-date"><span>Jeden Freitag</span>19:30 Uhr</div></section>';
    const { tabs, bericht } = convertLiveTabs([tab("start", html)]);

    expect(bericht.offene_stellen.some((o) => o.grund === "Text neben Elementen (gemischter Inhalt)" && o.text.includes("19:30 Uhr"))).toBe(true);
    // Der span selbst (eigener Text, keine Kind-Klassen) wird trotzdem zum Slot.
    const resultHtml = (tabs[0] as BulkTab).sections[0]!.widgets[0]!.config.html as string;
    expect(resultHtml).toContain("data-slot=");
    expect(resultHtml).toContain("19:30 Uhr");
  });

  test("ein Reiter ohne custom_html-Gerüst bekommt einen Hinweis statt eines leeren Ergebnisses", () => {
    const live: JsonValue = [{ label: "Kontakt", slug: "kontakt", position: 1, visibility_scope: "public", sections: [] }];
    const { hinweise, bericht } = convertLiveTabs(live);
    expect(hinweise.some((h) => h.includes('"kontakt"') && h.includes("kein Gerüst"))).toBe(true);
    expect(bericht.umgewandelt).toBe(0);
  });

  test("Befund R1-1: das Ergebnis passt in das strikte Eingabeschema von cai.homepage.02.apply", () => {
    const html = '<section aria-label="Start"><div data-widget-slot="news" data-widget-config=\'{"limit":3}\'></div></section>';
    const live: JsonValue = [{ ...(tab("start", html) as Record<string, JsonValue>), sections: [{ layout: "full", style_variant: "default", sort_order: 0, is_visible: true, spalten_breiten: [1, 2], widgets: [{ kind: "custom_html", title: null, config: { html, slots: {} }, slot_index: 0 }] }] }];
    const { tabs, hinweise } = convertLiveTabs(live);
    expect("spalten_breiten" in (tabs[0] as BulkTab).sections[0]!).toBe(false);
    const parsed = K12_ACTION_SCHEMAS["cai.homepage.02.apply"].input.safeParse({ club_id: "33333333-3333-4333-8333-333333333333", tabs: JSON.parse(JSON.stringify(tabs)), clear_existing: true });
    expect(parsed.success).toBe(true);
    expect(hinweise.some((h) => h.includes("clear_existing: true"))).toBe(true);
  });

  test("Befund R1-1b: cai.homepage.02.apply nimmt benannte Slots an und lehnt aktive Inhalte darin ab", () => {
    const apply = K12_ACTION_SCHEMAS["cai.homepage.02.apply"].input;
    const mit = (slots: Record<string, JsonValue>) => ({ club_id: "33333333-3333-4333-8333-333333333333", clear_existing: true, tabs: [{ label: "Start", slug: "start", position: 0, visibility_scope: "public", sections: [{ widgets: [{ kind: "custom_html", config: { html: '<section aria-label="Start"><h2 data-slot="titel"></h2></section>', slots } }] }] }] });
    expect(apply.safeParse(mit({ titel: { kind: "heading", config: { text: "Willkommen" } } })).success).toBe(true);
    expect(apply.safeParse(mit({ titel: { kind: "text", config: { html: "<script>alert(1)</script>" } } })).success).toBe(false);
  });

  test("Befund R2-1: jeder Slot bekommt die geschlossene Feldliste seiner Art (wie sanitize_slot_entry im club-service)", () => {
    const apply = K12_ACTION_SCHEMAS["cai.homepage.02.apply"].input;
    const mit = (slots: JsonValue) => apply.safeParse({ club_id: "33333333-3333-4333-8333-333333333333", clear_existing: true, tabs: [{ label: "Start", slug: "start", position: 0, visibility_scope: "public", sections: [{ widgets: [{ kind: "custom_html", config: { html: '<section aria-label="Start"><h2 data-slot="titel"></h2></section>', slots } }] }] }] }).success;
    expect(mit({ titel: { kind: "heading", config: { text: "Hallo" }, style: "gross" }, bild: { kind: "image", config: { url: "https://example.org/a.jpg", alt: "A" } } })).toBe(true);
    expect(mit({ titel: { kind: "heading", config: { arbitrary_payload: "secret" } } })).toBe(false);
    expect(mit({ titel: { kind: "gibt_es_nicht", config: {} } })).toBe(false);
    expect(mit({ titel: { kind: "custom_html", config: { html: "<p></p>" } } })).toBe(false);
    expect(mit({ Titel: { kind: "heading", config: { text: "x" } } })).toBe(false);
    expect(mit({ titel: { kind: "heading", config: { text: "x" }, extra: 1 } })).toBe(false);
    expect(mit({ titel: { kind: "heading", config: { text: "x" }, style: "Fett Rot" } })).toBe(false);
    expect(mit([] as JsonValue)).toBe(false);
  });

  test("BUG b72433d8: Altfelder, die die Vorschau ablehnt, werden entfernt und genannt — das Ergebnis besteht cai.homepage.01.preview", () => {
    // The live form of Jagabluat (2026-10-20): show_title on a ticker slot, an
    // image_gallery slot and an event_hub_embed widget, none of them read by a renderer.
    const html = '<section aria-label="Start"><div data-slot="seite-ticker"></div><div data-slot="section-image-gallery"></div></section>';
    const slots: Record<string, JsonValue> = {
      "seite-ticker": { kind: "ticker", config: { show_title: false, show_news: true } },
      "section-image-gallery": { kind: "image_gallery", config: { show_title: false, layout: "grid" } },
    };
    const start = tab("start", html, slots) as Record<string, JsonValue>;
    const fest = { label: "Fest", slug: "fest", position: 1, visibility_scope: "public", sections: [{ layout: "full", style_variant: "default", sort_order: 0, is_visible: true, widgets: [{ kind: "event_hub_embed", title: null, config: { show_title: false, height: 800 }, slot_index: 0 }] }] };
    const preview = K12_ACTION_SCHEMAS["cai.homepage.01.preview"].input;
    const eingabe = (tabs: JsonValue) => ({ club_id: "33333333-3333-4333-8333-333333333333", tabs: JSON.parse(JSON.stringify(tabs)), clear_existing: true });
    // Without the normalization the live form itself fails the preview.
    expect(preview.safeParse(eingabe([start, fest])).success).toBe(false);

    const { tabs, hinweise } = convertLiveTabs([start, fest]);
    expect(preview.safeParse(eingabe(tabs as unknown as JsonValue)).success).toBe(true);
    const festWidget = (tabs[1] as BulkTab).sections[0]!.widgets[0]!;
    expect(festWidget.config).toEqual({ height: 800 });
    expect(hinweise.some((h) => h.includes('Reiter "fest"') && h.includes("show_title an event_hub_embed"))).toBe(true);
    const startHinweis = hinweise.find((h) => h.startsWith('Reiter "start": Felder entfernt'));
    expect(startHinweis).toContain("show_title an ticker (Slot seite-ticker)");
    expect(startHinweis).toContain("show_title an image_gallery (Slot section-image-gallery)");
    // Only the rejected keys go; the declared fields of the slots stay.
    const geruest = (tabs[0] as BulkTab).sections[0]!.widgets[0]!.config;
    expect(JSON.stringify(geruest)).toContain('"show_news":true');
    expect(JSON.stringify(geruest)).toContain('"layout":"grid"');
  });

  test("Befund R1-7: eine leere Live-Seite liefert einen Hinweis statt eines stummen leeren Ergebnisses", () => {
    const { tabs, hinweise } = convertLiveTabs([]);
    expect(tabs).toEqual([]);
    expect(hinweise.some((h) => h.includes("keine Reiter"))).toBe(true);
  });

  test("Befund R1-2: Katalogklassen aus design_settings.styles werden verschoben", () => {
    const styles = stilKatalog({ design_settings: { styles: [{ id: "gross", label: "Groß", class: "titel-gross", fuer: ["heading"] }, { id: "kaputt", fuer: [] }] } });
    expect(styles.map((s) => s.id)).toEqual(["gross"]);
    const html = '<section aria-label="Start"><h2 class="titel-gross">Willkommen</h2></section>';
    expect(convertLiveTabs([tab("start", html)], { styles }).bericht.katalogklassen_verschoben).toBeGreaterThan(0);
    expect(convertLiveTabs([tab("start", html)]).bericht.katalogklassen_verschoben).toBe(0);
  });
});

describe("cai.homepage.05.convert — Vertrag und Verdrahtung", () => {
  test("Scope und Risiko wie cai.homepage.01.preview (DC-4): club.write, risk read", () => {
    const definition = K12_ACTION_DEFINITIONS["cai.homepage.05.convert"];
    const op = definition.operations.convert!;
    expect(op.required_scopes).toEqual(["club.write"]);
    expect(op.risk_class).toBe("read");
    expect(op.execution_gate).toBe("inline");
  });

  function adapterClient(handler: (request: ComvenioApiRequest) => Promise<JsonValue>): ComvenioApiClient {
    return { timeout_ms: 15_000, async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> { return (await handler(request)) as T; } };
  }

  const clubId = "33333333-3333-4333-8333-333333333333";
  const context: RequestContext = {
    request_id: "11111111-1111-4111-8111-111111111111",
    surface: "mcp",
    provider: "anthropic",
    subject_id: "22222222-2222-4222-8222-222222222222",
    oauth_grant_id: "55555555-5555-4555-8555-555555555555",
    club_id: clubId,
    department_id: null,
    scopes: ["club.write"],
    capability_version: "A".repeat(43),
    locale: "de-DE",
    timezone: "Europe/Berlin",
  };
  const capabilitySnapshot: CapabilitySnapshot = {
    subject_id: context.subject_id!,
    member_id: "66666666-6666-4666-8666-666666666666",
    club_id: clubId,
    department_ids: [],
    permissions: { manage_club_settings: true },
    sources: [{ permission_key: "manage_club_settings", allowed: true, scope: "club", department_id: null, assignment_type: "direct" }],
    capability_version: context.capability_version!,
    generated_at: new Date().toISOString(),
    observed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };

  test("liest dieselbe Route wie cai.homepage.03.show private und liefert tabs/bericht/hinweise", async () => {
    const calls: ComvenioApiRequest[] = [];
    const html = '<section aria-label="Start"><div data-widget-slot="news" data-widget-config=\'{"limit":3}\'></div></section>';
    const homepage = createK12ToolSets({
      client: adapterClient(async (request) => {
        calls.push(request);
        if (request.path.endsWith("/settings")) return { club_id: clubId, design_settings: { styles: [{ id: "gross", label: "Groß", class: "titel-gross", fuer: ["heading"] }] } };
        return [tab("start", '<section aria-label="Start"><h2 class="titel-gross">Willkommen</h2></section>' + html)];
      }),
    }).homepage;

    const result = await homepage.execute({
      action_id: "cai.homepage.05.convert",
      input: { club_id: clubId },
      context,
      capability_snapshot: capabilitySnapshot,
    });

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /home-config/${clubId}/tabs`, `GET /clubs/${clubId}/settings`]);
    expect(result.status).toBe("completed");
    const value = result.result as { tabs: JsonValue[]; bericht: { umgewandelt: number; katalogklassen_verschoben: number }; hinweise: string[] };
    expect(value.bericht.umgewandelt).toBeGreaterThan(0);
    expect(value.bericht.katalogklassen_verschoben).toBeGreaterThan(0);
    expect(Array.isArray(value.tabs)).toBe(true);
    expect(Array.isArray(value.hinweise)).toBe(true);
  });

  test("Bug ddc0a35a: die Reiter-Route ist flach — Sektionen und Widgets werden je Reiter gelesen, nichts geht verloren", async () => {
    // Shapes as club-service returns them: List[ClubHomeTabRead] without
    // sections, then List[ClubHomeSectionRead] and List[ClubHomeWidgetRead] per tab.
    const tabId = "77777777-7777-4777-8777-777777777777";
    const sectionA = "88888888-8888-4888-8888-888888888881";
    const sectionB = "88888888-8888-4888-8888-888888888882";
    const html = '<section aria-label="Start"><div data-widget-slot="news" data-widget-config=\'{"limit":3}\'></div></section>';
    const calls: string[] = [];
    const homepage = createK12ToolSets({
      client: adapterClient(async (request): Promise<JsonValue> => {
        calls.push(`${request.method} ${request.path}`);
        if (request.path.endsWith("/settings")) return { club_id: clubId, design_settings: {} };
        if (request.path.endsWith(`/tabs/${tabId}/sections`)) {
          return [
            { id: sectionB, club_id: clubId, tab_id: tabId, sort_order: 5, layout: "two-col", style_variant: "default", title: "Zweite", is_visible: true, bg_image_url: null, spalten_breiten: [40, 60] },
            { id: sectionA, club_id: clubId, tab_id: tabId, sort_order: 1, layout: "full", style_variant: "default", title: null, is_visible: true, bg_image_url: null, spalten_breiten: null },
          ];
        }
        if (request.path.endsWith(`/tabs/${tabId}/widgets`)) {
          return [
            { id: "w-2", club_id: clubId, tab_id: tabId, section_id: sectionB, kind: "image", title: null, config: { url: "https://example.org/b.jpg" }, slot_index: 1, position: 0, is_active: true },
            { id: "w-1", club_id: clubId, tab_id: tabId, section_id: sectionA, kind: "custom_html", title: null, config: { html, slots: {} }, slot_index: 0, position: 0, is_active: true },
            { id: "w-3", club_id: clubId, tab_id: tabId, section_id: sectionB, kind: "news", title: null, config: {}, slot_index: 0, position: 0, is_active: true },
            { id: "w-4", club_id: clubId, tab_id: tabId, section_id: null, kind: "text", title: null, config: {}, slot_index: 0, position: 0, is_active: true },
          ];
        }
        return [{ id: tabId, club_id: clubId, label: "Start", slug: "start", position: 0, visibility_scope: "public", is_active: true }];
      }),
    }).homepage;

    const result = await homepage.execute({ action_id: "cai.homepage.05.convert", input: { club_id: clubId }, context, capability_snapshot: capabilitySnapshot });

    expect(calls).toEqual([
      `GET /home-config/${clubId}/tabs`,
      `GET /home-config/${clubId}/tabs/${tabId}/sections`,
      `GET /home-config/${clubId}/tabs/${tabId}/widgets`,
      `GET /clubs/${clubId}/settings`,
    ]);
    const value = result.result as unknown as { tabs: BulkTab[]; bericht: { umgewandelt: number }; hinweise: string[] };
    const sections = value.tabs[0]!.sections;
    expect(sections.map((s) => s.title)).toEqual([null, "Zweite"]);
    expect(sections[0]!.widgets.map((w) => w.kind)).toEqual(["custom_html"]);
    expect(sections[1]!.widgets.map((w) => w.kind)).toEqual(["news", "image"]);
    expect(value.bericht.umgewandelt).toBeGreaterThan(0);
    expect(value.hinweise.some((h) => h.includes("kein Gerüst"))).toBe(false);
    expect(value.hinweise.some((h) => h.includes("1 Widget(s) ohne Sektion"))).toBe(true);
    expect(value.hinweise.some((h) => h.includes("Spaltenbreiten"))).toBe(true);
    const parsed = K12_ACTION_SCHEMAS["cai.homepage.02.apply"].input.safeParse({ club_id: clubId, tabs: JSON.parse(JSON.stringify(value.tabs)), clear_existing: true });
    expect(parsed.success).toBe(true);
  });

  test("Bug ddc0a35a: Sektionen eines anderen Vereins brechen ab", async () => {
    const tabId = "77777777-7777-4777-8777-777777777777";
    const homepage = createK12ToolSets({
      client: adapterClient(async (request) => {
        if (request.path.endsWith("/sections")) return [{ id: "s", club_id: "44444444-4444-4444-8444-444444444444", tab_id: tabId, sort_order: 0 }];
        if (request.path.endsWith("/widgets")) return [];
        return [{ id: tabId, club_id: clubId, label: "Start", slug: "start", position: 0 }];
      }),
    }).homepage;
    await expect(homepage.execute({ action_id: "cai.homepage.05.convert", input: { club_id: clubId }, context, capability_snapshot: capabilitySnapshot })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  test("Befund R2-2: Settings eines anderen Vereins brechen ab statt fremde Stil-Kennungen zu übernehmen", async () => {
    const homepage = createK12ToolSets({
      client: adapterClient(async (request) => request.path.endsWith("/settings")
        ? { club_id: "44444444-4444-4444-8444-444444444444", design_settings: { styles: [] } }
        : [tab("start", '<section aria-label="Start"><h2>Hallo</h2></section>')]),
    }).homepage;
    await expect(homepage.execute({ action_id: "cai.homepage.05.convert", input: { club_id: clubId }, context, capability_snapshot: capabilitySnapshot })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  test("nichts wird geschrieben: der Fake-Client sieht nur GET-Aufrufe", async () => {
    let writes = 0;
    const homepage = createK12ToolSets({
      client: adapterClient(async (request) => {
        if (request.method !== "GET") writes++;
        return [];
      }),
    }).homepage;
    await homepage.execute({ action_id: "cai.homepage.05.convert", input: { club_id: clubId }, context, capability_snapshot: capabilitySnapshot });
    expect(writes).toBe(0);
  });
});
