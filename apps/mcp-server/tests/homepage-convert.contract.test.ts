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
