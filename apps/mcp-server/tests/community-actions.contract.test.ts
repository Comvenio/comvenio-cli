// cai.community.* (community-hub 14, Test-Scenarios TC-01..TC-05, TC-07, TC-08).
// The page of a community through the club of the sign-in: every action first
// reads the community and its member clubs; the club must be one of them.
// Route shapes follow club-service (community_home.py, community_pages.py,
// community.py) on the state of 12.
import type { CapabilitySnapshot } from "@comvenio/auth";
import { createComvenioApiClient, type ComvenioApiClient, type ComvenioApiRequest } from "@comvenio/comvenio-client";
import { isConnectorError, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import { describe, expect, test } from "bun:test";

import homepageSchema from "../../../src/schema/homepage.json";
import { K12_ACTION_DEFINITIONS } from "../src/tools/content-homepage-news-data/definitions.ts";
import { assertOwnClubPage } from "../src/tools/content-homepage-news-data/handlers.ts";
import { K12_ACTION_SCHEMAS } from "../src/tools/content-homepage-news-data/schemas.ts";
import { createK12ToolSets } from "../src/tools/content-homepage-news-data/tool-sets.ts";
import type { K12ActionId } from "../src/tools/content-homepage-news-data/types.ts";

const clubId = "33333333-3333-4333-8333-333333333333";
const otherClubId = "44444444-4444-4444-8444-444444444444";
const communityId = "77777777-7777-4777-8777-777777777777";
const tabId = "88888888-8888-4888-8888-888888888888";
const previewId = "99999999-9999-4999-8999-999999999999";

const context: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "mcp",
  provider: "anthropic",
  subject_id: "22222222-2222-4222-8222-222222222222",
  oauth_grant_id: "55555555-5555-4555-8555-555555555555",
  club_id: clubId,
  department_id: null,
  scopes: ["club.read", "club.write", "public.read"],
  capability_version: "A".repeat(43),
  locale: "de-DE",
  timezone: "Europe/Berlin",
};
const capabilitySnapshot: CapabilitySnapshot = {
  subject_id: context.subject_id!,
  member_id: "66666666-6666-4666-8666-666666666666",
  club_id: clubId,
  department_ids: [],
  permissions: {},
  sources: [],
  capability_version: context.capability_version!,
  generated_at: new Date().toISOString(),
  observed_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

const page = {
  community_id: communityId,
  tabs: [{
    label: "Start",
    slug: "start",
    visibility_scope: "public",
    sections: [{ layout: "full", widgets: [{ kind: "community_calendar", config: { community_id: communityId, view: "list" } }] }],
  }],
  clear_existing: true,
};

type Responder = (request: ComvenioApiRequest) => JsonValue | Promise<JsonValue>;

/** Fake service: the binding reads answer with the given member clubs, everything else goes to `rest`. */
function service(members: string[], rest: Responder = () => ({})) {
  const calls: ComvenioApiRequest[] = [];
  const client: ComvenioApiClient = {
    timeout_ms: 15_000,
    async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> {
      calls.push(request);
      if (request.method === "GET" && request.path === `/communities/${communityId}`) return { id: communityId, name: "Vereinsmeisterschaft 180" } as unknown as T;
      if (request.method === "GET" && request.path === `/communities/${communityId}/clubs`) return members.map((club) => ({ community_id: communityId, club_id: club })) as unknown as T;
      return (await rest(request)) as T;
    },
  };
  const community = createK12ToolSets({ client, write_safety: { execute: async (_request, mutation) => mutation() } }).community;
  const run = (action_id: K12ActionId, input: Record<string, JsonValue>) => community.execute({ action_id, input: { club_id: clubId, ...input }, context, capability_snapshot: capabilitySnapshot });
  return { calls, run, writes: () => calls.filter((call) => call.method !== "GET" && !call.path.endsWith("/preview") && !call.path.endsWith("/screenshot")) };
}

async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { if (isConnectorError(error)) return error; throw error; }
  throw new Error("Expected a connector error");
}

const BINDING = [`GET /communities/${communityId}`, `GET /communities/${communityId}/clubs`];
const route = (call: ComvenioApiRequest) => `${call.method} ${call.path}`;

describe("cai.community.* — Vertrag (14 §4)", () => {
  test("Routen, Risiko und Scopes exakt wie im Dienst; die Bindung steht vor jeder Route", () => {
    const expected: Record<string, [string, string, string[], string]> = {
      "cai.community.01.show/private": ["GET", "/home-config/communities/{community_id}/tabs", ["club.read"], "read"],
      "cai.community.01.show/public": ["GET", "/public/communities/{community_id}/home", ["public.read"], "read"],
      "cai.community.02.preview/preview": ["POST", "/home-config/communities/{community_id}/preview", ["club.write"], "read"],
      "cai.community.03.apply/apply": ["POST", "/home-config/communities/{community_id}/bulk", ["club.write"], "critical_write"],
      "cai.community.04.screenshot/screenshot": ["POST", "/home-config/communities/{community_id}/preview/{preview_id}/screenshot", ["club.write"], "read"],
      "cai.community.05.design/show": ["GET", "/communities/{community_id}/design", ["club.read"], "read"],
      "cai.community.05.design/update": ["PUT", "/communities/{community_id}/design", ["club.write"], "critical_write"],
    };
    const seen: string[] = [];
    for (const [id, definition] of Object.entries(K12_ACTION_DEFINITIONS)) {
      // 06.club_page reads more than one route; its own test below.
      if (definition.domain !== "community" || id === "cai.community.06.club_page") continue;
      for (const operation of Object.values(definition.operations)) {
        const key = `${id}/${operation.operation}`; seen.push(key);
        const [method, path, scopes, risk] = expected[key]!;
        const routes = operation.backend_routes.map((entry) => `${entry.method} ${entry.normalized_path_template}`);
        expect(routes).toEqual([...BINDING.map((entry) => entry.replace(communityId, "{community_id}")), `${method} ${path}`]);
        expect(operation.required_scopes).toEqual(scopes as never);
        expect(operation.risk_class).toBe(risk as never);
        if (risk === "critical_write") expect(operation.execution_gate).toBe("confirmation");
      }
    }
    expect(seen.sort()).toEqual(Object.keys(expected).sort());
  });

  test("Eingabe streng: Abteilungs-Sichtbarkeit und fremde Felder werden abgelehnt", () => {
    const schema = K12_ACTION_SCHEMAS["cai.community.02.preview"].input;
    expect(schema.safeParse({ club_id: clubId, ...page }).success).toBe(true);
    const department = { ...page, tabs: [{ ...page.tabs[0]!, visibility_scope: "department", department_id: tabId }] };
    expect(schema.safeParse({ club_id: clubId, ...department }).success).toBe(false);
    expect(schema.safeParse({ club_id: clubId, ...page, fremd: true }).success).toBe(false);
  });
});

describe("cai.community.* — Vereinsbindung (TC-01)", () => {
  test("TC-01: Kontextverein ist kein Mitgliedsverein → COMMUNITY_NOT_IN_CLUB, kein weiterer Dienstaufruf", async () => {
    for (const [action, input] of [
      ["cai.community.01.show", { operation: "private", community_id: communityId }],
      ["cai.community.02.preview", page],
      ["cai.community.03.apply", page],
      ["cai.community.04.screenshot", { community_id: communityId, preview_id: previewId }],
      ["cai.community.05.design", { operation: "show", community_id: communityId }],
      ["cai.community.06.club_page", { operation: "show", community_id: communityId }],
      ["cai.community.06.club_page", { operation: "create", community_id: communityId, label: "SV Motzing" }],
      ["cai.community.06.club_page", { operation: "publish", community_id: communityId, tab_id: tabId, expected_tab_version: 1, base: {}, sections: [] }],
    ] as const) {
      const fake = service([otherClubId]);
      const error = await failure(fake.run(action, input as Record<string, JsonValue>));
      expect(error.code).toBe("COMMUNITY_NOT_IN_CLUB");
      expect(fake.calls.map(route)).toEqual(BINDING);
    }
  });

  test("TC-01: unbekannte Community → NOT_FOUND, nichts weiter gelesen", async () => {
    const calls: ComvenioApiRequest[] = [];
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://apidev.comvenio.app" },
      { fetch: async (url) => { calls.push({ method: "GET", service: "club", path: String(url), context }); return new Response(JSON.stringify({ detail: "Community not found" }), { status: 404 }); } },
    );
    const community = createK12ToolSets({ client }).community;
    const error = await failure(community.execute({ action_id: "cai.community.01.show", input: { club_id: clubId, operation: "public", community_id: communityId }, context, capability_snapshot: capabilitySnapshot }));
    expect(error.code).toBe("NOT_FOUND");
    expect(calls).toHaveLength(1);
  });

  test("Community ohne Mitgliedsvereine → COMMUNITY_NOT_IN_CLUB für jeden Verein (DC-8)", async () => {
    const error = await failure(service([]).run("cai.community.05.design", { operation: "show", community_id: communityId }));
    expect(error.code).toBe("COMMUNITY_NOT_IN_CLUB");
  });
});

describe("cai.community.* — Abläufe (TC-02..TC-05, TC-07)", () => {
  test("TC-02: show private liefert Tabs mit version; public liest die öffentliche Route", async () => {
    const fake = service([clubId], (request) => request.path.startsWith("/public/")
      ? { community: { id: communityId, name: "Vereinsmeisterschaft 180" }, tabs: [{ id: tabId, slug: "start", visibility_scope: "public" }] }
      : [{ id: tabId, slug: "start", version: 3, visibility_scope: "public", club_id: otherClubId }]);
    const privat = await fake.run("cai.community.01.show", { operation: "private", community_id: communityId });
    expect((privat.result as Array<{ version: number }>)[0]!.version).toBe(3);
    const oeffentlich = await fake.run("cai.community.01.show", { operation: "public", community_id: communityId });
    expect(oeffentlich.status).toBe("completed");
    expect(fake.calls.map(route)).toEqual([...BINDING, `GET /home-config/communities/${communityId}/tabs`, ...BINDING, `GET /public/communities/${communityId}/home`]);
  });

  test("TC-03: preview sendet tabs/clear_existing und liefert preview_id, preview_url und expected_versions", async () => {
    const fake = service([clubId], () => ({ preview_id: previewId, expires_at: "2026-10-06T12:00:00Z", preview_url: `https://dev.comvenio.app/community-preview/${communityId}/${previewId}`, expected_versions: { [tabId]: 3 } }));
    const result = await fake.run("cai.community.02.preview", page);
    const value = result.result as { preview_id: string; preview_url: string; expected_versions: Record<string, number> };
    expect(value.preview_url).toContain("/community-preview/");
    expect(value.expected_versions[tabId]).toBe(3);
    const call = fake.calls.at(-1)!;
    expect(route(call)).toBe(`POST /home-config/communities/${communityId}/preview`);
    expect(call.body).toEqual({ tabs: (K12_ACTION_SCHEMAS["cai.community.02.preview"].input.parse({ club_id: clubId, ...page }) as { tabs: JsonValue }).tabs, clear_existing: true });
  });

  test("TC-04: apply ohne Bestätigung schreibt nichts; mit Bestätigung sendet es die expected_versions der Vorschau", async () => {
    const fake = service([clubId], () => ({ tabs: [{ id: tabId }], sections_created: 1, widgets_created: 1 }));
    const input = { ...page, expected_versions: { [tabId]: 3 } };
    const vorschau = await fake.run("cai.community.03.apply", input);
    expect(vorschau.status).toBe("confirmation_required");
    expect(fake.writes()).toHaveLength(0);
    const preview = (vorschau.result as { preview: { preview_id: string; confirmation_token: string; effects: Array<{ type: string }> } }).preview;
    expect(preview.effects.map((effect) => effect.type)).toContain("community_page_publication");

    const bestaetigt = await fake.run("cai.community.03.apply", { ...input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } });
    expect(bestaetigt.status).toBe("completed");
    expect(bestaetigt.result).toEqual({ applied: true, cleared: true, tabs: 1, sections: 1, widgets: 1 });
    expect(fake.writes().map(route)).toEqual([`POST /home-config/communities/${communityId}/bulk`]);
    expect((fake.writes()[0]!.body as { expected_versions: JsonValue }).expected_versions).toEqual({ [tabId]: 3 });
  });

  test("TC-05: 409 TAB_VERSION_CONFLICT kommt mit Code und Tabs an und sagt, dass von der Seite nichts geschrieben wurde", async () => {
    let bodies = 0;
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://apidev.comvenio.app" },
      {
        fetch: async (url) => {
          const path = new URL(String(url)).pathname;
          if (path.endsWith(`/communities/${communityId}`)) return Response.json({ id: communityId });
          if (path.endsWith(`/communities/${communityId}/clubs`)) return Response.json([{ community_id: communityId, club_id: clubId }]);
          bodies++;
          return Response.json({ detail: { code: "TAB_VERSION_CONFLICT", message: "TAB_VERSION_CONFLICT: mindestens eine Seite wurde inzwischen geändert", tabs: [{ tab_id: tabId, expected_version: 2, live_version: 3 }] } }, { status: 409 });
        },
      },
    );
    const community = createK12ToolSets({ client, write_safety: { execute: async (_request, mutation) => mutation() } }).community;
    const run = (input: Record<string, JsonValue>) => community.execute({ action_id: "cai.community.03.apply", input: { club_id: clubId, ...input }, context, capability_snapshot: capabilitySnapshot });
    const input = { ...page, expected_versions: { [tabId]: 2 } };
    const preview = ((await run(input)).result as { preview: { preview_id: string; confirmation_token: string } }).preview;
    const error = await failure(run({ ...input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } }));
    expect(bodies).toBe(1);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toContain("TAB_VERSION_CONFLICT: mindestens eine Seite wurde inzwischen geändert");
    expect(error.message).toContain(`(Tabs: ${tabId})`);
    expect(error.message).toContain("Von der Seite wurde nichts geschrieben.");
    expect(error.message).toContain("cai.community.05.design update");
  });

  test("TC-05: ohne clear_existing hängt der Bulk an und sendet leere expected_versions", async () => {
    const fake = service([clubId], () => ({ tabs: [], sections_created: 0, widgets_created: 0 }));
    const input = { ...page, clear_existing: false };
    const preview = ((await fake.run("cai.community.03.apply", input)).result as { preview: { preview_id: string; confirmation_token: string } }).preview;
    await fake.run("cai.community.03.apply", { ...input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } });
    expect(fake.writes()[0]!.body).toMatchObject({ clear_existing: false, expected_versions: {} });
  });

  test("TC-07: design update ohne Bestätigung schreibt nichts; veraltete Version → DESIGN_VERSION_CONFLICT", async () => {
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://apidev.comvenio.app" },
      {
        fetch: async (url, init) => {
          const path = new URL(String(url)).pathname;
          if (path.endsWith(`/communities/${communityId}`)) return Response.json({ id: communityId });
          if (path.endsWith(`/communities/${communityId}/clubs`)) return Response.json([{ community_id: communityId, club_id: clubId }]);
          expect(init?.method).toBe("PUT");
          expect(JSON.parse(String(init?.body))).toEqual({ design_settings: { tokens: { primary: "#1b5e20" } }, expected_design_version: 1 });
          return Response.json({ detail: { code: "DESIGN_VERSION_CONFLICT", message: "DESIGN_VERSION_CONFLICT: das Design wurde inzwischen geändert, bitte neu laden", expected_version: 1, live_version: 2 } }, { status: 409 });
        },
      },
    );
    const community = createK12ToolSets({ client, write_safety: { execute: async (_request, mutation) => mutation() } }).community;
    const input = { club_id: clubId, operation: "update", community_id: communityId, design_settings: { tokens: { primary: "#1b5e20" } }, expected_design_version: 1 };
    const vorschau = await community.execute({ action_id: "cai.community.05.design", input, context, capability_snapshot: capabilitySnapshot });
    expect(vorschau.status).toBe("confirmation_required");
    const preview = (vorschau.result as { preview: { preview_id: string; confirmation_token: string } }).preview;
    const error = await failure(community.execute({ action_id: "cai.community.05.design", input: { ...input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } }, context, capability_snapshot: capabilitySnapshot }));
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toContain("DESIGN_VERSION_CONFLICT");
  });
});

describe("cai.community.03.apply — Ausgang nach einem Fehler (R3)", () => {
  async function applyFailing(status: number) {
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://apidev.comvenio.app" },
      {
        fetch: async (url) => {
          const path = new URL(String(url)).pathname;
          if (path.endsWith(`/communities/${communityId}`)) return Response.json({ id: communityId });
          if (path.endsWith(`/communities/${communityId}/clubs`)) return Response.json([{ community_id: communityId, club_id: clubId }]);
          return Response.json({ detail: "boom" }, { status });
        },
      },
    );
    const community = createK12ToolSets({ client, write_safety: { execute: async (_request, mutation) => mutation() } }).community;
    const run = (input: Record<string, JsonValue>) => community.execute({ action_id: "cai.community.03.apply", input: { club_id: clubId, ...input }, context, capability_snapshot: capabilitySnapshot });
    const preview = ((await run(page)).result as { preview: { preview_id: string; confirmation_token: string } }).preview;
    return failure(run({ ...page, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } }));
  }

  test("ein Serverfehler beim Bulk behauptet nicht, es sei nichts geschrieben", async () => {
    const error = await applyFailing(502);
    expect(error.message).not.toContain("nichts geschrieben");
    expect(error.message).toContain("cai.community.01.show prüfen");
  });

  test("eine Ablehnung (422) sagt, dass von der Seite nichts geschrieben wurde", async () => {
    const error = await applyFailing(422);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toContain("Von der Seite wurde nichts geschrieben.");
  });
});

describe("Homepage-Schema (TC-08)", () => {
  test("TC-08: community_calendar, community_news und club_directory tragen community_id", () => {
    const widgets = homepageSchema.widgets as Record<string, { config: Array<{ name: string }> }>;
    for (const kind of ["community_calendar", "community_news", "club_directory"]) {
      expect(widgets[kind]?.config.map((field) => field.name)).toContain("community_id");
      expect(homepageSchema.widget_kinds).toContain(kind);
    }
  });
});

// cai.community.06.club_page (community-hub 15, TC-02..TC-06): the own pages of
// the club of the sign-in in the community; routes as in club-service
// community_pages.py:355/383 and club_home_publish.py:144.
describe("cai.community.06.club_page — Vereinsseiten (15)", () => {
  const sectionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const widgetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const generalTabId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const ownPages = [
    { community_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", community_name: "Andere", tabs: [{ id: generalTabId, label: "Fremd", version: 1 }] },
    { community_id: communityId, community_name: "Dorfvereine", tabs: [{ id: tabId, label: "SV Motzing", slug: "sv-motzing-start", visibility_scope: "public", navigation_group: "SV Motzing", version: 2, hidden_by_community_at: null, hidden_reason: null }] },
  ];
  const tree = {
    community_id: communityId,
    membership: "member",
    tabs: [
      { id: generalTabId, managed_by_club_id: null, version: 4, sections: [] },
      { id: tabId, managed_by_club_id: clubId, version: 2, sections: [{ id: sectionId, version: 3, layout: "full", widgets: [{ id: widgetId, version: 5, kind: "text", config: {} }] }] },
    ],
  };
  const answers: Responder = (request) => {
    if (request.path === `/clubs/${clubId}/community-pages`) return ownPages as unknown as JsonValue;
    if (request.path === `/home-config/communities/${communityId}/tabs`) return tree as unknown as JsonValue;
    if (request.path === `/communities/${communityId}/club-pages`) return { id: tabId, label: "SV Motzing", version: 1 };
    return { sections: [{ id: sectionId }], widgets: [{ id: widgetId }, { id: widgetId }], warnungen: [] };
  };
  const draft = [{ id: sectionId, layout: "full", widgets: [{ id: widgetId, kind: "text", config: { content: "<p>Willkommen</p>" } }] }];

  test("Routen, Risiko und Scopes: Bindung vor jeder Route, show und publish lesen die Seiten des Vereins", () => {
    const operations = K12_ACTION_DEFINITIONS["cai.community.06.club_page"].operations;
    const routes = (name: string) => operations[name]!.backend_routes.map((entry) => `${entry.method} ${entry.normalized_path_template}`);
    const binding = BINDING.map((entry) => entry.replace(communityId, "{community_id}"));
    expect(routes("show")).toEqual([...binding, "GET /clubs/{club_id}/community-pages", "GET /home-config/communities/{community_id}/tabs"]);
    expect(routes("create")).toEqual([...binding, "POST /communities/{community_id}/club-pages"]);
    expect(routes("publish")).toEqual([...binding, "GET /clubs/{club_id}/community-pages", "POST /home-config/{community_id}/tabs/{tab_id}/publish"]);
    expect(operations.show!.risk_class).toBe("read");
    expect(operations.show!.required_scopes).toEqual(["club.read"] as never);
    for (const name of ["create", "publish"]) {
      expect(operations[name]!.risk_class).toBe("critical_write");
      expect(operations[name]!.execution_gate).toBe("confirmation");
      expect(operations[name]!.required_scopes).toEqual(["club.write"] as never);
    }
  });

  test("TC-02: show liefert nur Seiten des Vereins in dieser Community, mit version und fertiger base", async () => {
    const fake = service([clubId], answers);
    const result = (await fake.run("cai.community.06.club_page", { operation: "show", community_id: communityId })).result as { club_id: string; pages: Array<{ tab_id: string; version: number; base: { sections: Record<string, number>; widgets: Record<string, number> } }> };
    expect(result.club_id).toBe(clubId);
    expect(result.pages.map((entry) => entry.tab_id)).toEqual([tabId]);
    expect(result.pages[0]!.version).toBe(2);
    expect(result.pages[0]!.base).toEqual({ sections: { [sectionId]: 3 }, widgets: { [widgetId]: 5 } });
    expect(fake.calls.map(route)).toEqual([...BINDING, `GET /clubs/${clubId}/community-pages`, `GET /home-config/communities/${communityId}/tabs`]);
  });

  test("TC-02: fehlt die eigene Seite im Seitenbaum (Mitgliedschaft unbekannt), liefert show base null statt einer leeren Basis", async () => {
    const fake = service([clubId], (request) => request.path === `/home-config/communities/${communityId}/tabs` ? { community_id: communityId, membership: "unknown", tabs: [] } : answers(request));
    const result = (await fake.run("cai.community.06.club_page", { operation: "show", community_id: communityId })).result as { pages: Array<{ base: JsonValue; sections: JsonValue; version: number }> };
    expect(result.pages[0]!.base).toBeNull();
    expect(result.pages[0]!.sections).toBeNull();
    expect(result.pages[0]!.version).toBe(2);
  });

  test("TC-03: create ohne Bestätigung schreibt nichts; mit Bestätigung für den Verein der Anmeldung mit Vorlage", async () => {
    const fake = service([clubId], answers);
    const input = { operation: "create", community_id: communityId, label: "SV Motzing" };
    const vorschau = await fake.run("cai.community.06.club_page", input);
    expect(vorschau.status).toBe("confirmation_required");
    expect(fake.writes()).toHaveLength(0);
    const preview = (vorschau.result as { preview: { preview_id: string; confirmation_token: string; effects: Array<{ type: string }> } }).preview;
    expect(preview.effects.map((effect) => effect.type)).toContain("community_club_page_publication");
    await fake.run("cai.community.06.club_page", { ...input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } });
    expect(fake.writes().map(route)).toEqual([`POST /communities/${communityId}/club-pages`]);
    expect(fake.writes()[0]!.body).toEqual({ club_id: clubId, label: "SV Motzing", visibility_scope: "public", template: "vereinsseite" });
  });

  test("TC-03: ein anderer Verein in der Eingabe → TENANT_MISMATCH, nichts gesendet", async () => {
    const fake = service([clubId], answers);
    const error = await failure(fake.run("cai.community.06.club_page", { operation: "create", community_id: communityId, label: "Fremd", club_id: otherClubId }));
    expect(error.code).toBe("TENANT_MISMATCH");
    expect(fake.calls).toHaveLength(0);
  });

  test("TC-03: template none legt eine leere Seite an", async () => {
    const fake = service([clubId], answers);
    const input = { operation: "create", community_id: communityId, label: "Leer", visibility_scope: "member", template: "none" };
    const preview = ((await fake.run("cai.community.06.club_page", input)).result as { preview: { preview_id: string; confirmation_token: string } }).preview;
    await fake.run("cai.community.06.club_page", { ...input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } });
    expect(fake.writes()[0]!.body).toEqual({ club_id: clubId, label: "Leer", visibility_scope: "member", template: null });
  });

  test("TC-04: publish auf einen allgemeinen Reiter oder fremde Seite → TENANT_MISMATCH, kein POST", async () => {
    for (const target of [generalTabId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]) {
      const fake = service([clubId], answers);
      const error = await failure(fake.run("cai.community.06.club_page", { operation: "publish", community_id: communityId, tab_id: target, expected_tab_version: 1, base: {}, sections: [] }));
      expect(error.code).toBe("TENANT_MISMATCH");
      expect(fake.writes()).toHaveLength(0);
    }
  });

  test("TC-05: publish ohne Bestätigung schreibt nichts; mit Bestätigung Version als Query, base und sections im Rumpf", async () => {
    const fake = service([clubId], answers);
    const input = { operation: "publish", community_id: communityId, tab_id: tabId, expected_tab_version: 2, base: { sections: { [sectionId]: 3 }, widgets: { [widgetId]: 5 } }, sections: draft };
    const vorschau = await fake.run("cai.community.06.club_page", input as unknown as Record<string, JsonValue>);
    expect(vorschau.status).toBe("confirmation_required");
    expect(fake.writes()).toHaveLength(0);
    const preview = (vorschau.result as { preview: { preview_id: string; confirmation_token: string } }).preview;
    const bestaetigt = await fake.run("cai.community.06.club_page", { ...input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } } as unknown as Record<string, JsonValue>);
    expect(bestaetigt.result).toEqual({ published: true, tab_id: tabId, sections: 1, widgets: 2, warnungen: [] });
    const call = fake.writes()[0]!;
    expect(route(call)).toBe(`POST /home-config/${communityId}/tabs/${tabId}/publish`);
    expect(call.query).toEqual({ expected_tab_version: "2" });
    expect((call.body as { base: JsonValue }).base).toEqual({ sections: { [sectionId]: 3 }, widgets: { [widgetId]: 5 } });
    expect(((call.body as { sections: Array<{ id: string }> }).sections)[0]!.id).toBe(sectionId);
  });

  test("Eingabe streng: Label über 60 Zeichen, Abteilungs-Sichtbarkeit und fremde Felder werden abgelehnt", () => {
    const schema = K12_ACTION_SCHEMAS["cai.community.06.club_page"].input;
    expect(schema.safeParse({ club_id: clubId, operation: "create", community_id: communityId, label: "x".repeat(61) }).success).toBe(false);
    expect(schema.safeParse({ club_id: clubId, operation: "create", community_id: communityId, label: "A", visibility_scope: "department" }).success).toBe(false);
    expect(schema.safeParse({ club_id: clubId, operation: "publish", community_id: communityId, tab_id: tabId, expected_tab_version: 1, base: {}, sections: [], fremd: 1 }).success).toBe(false);
    expect(schema.safeParse({ club_id: clubId, operation: "publish", community_id: communityId, tab_id: tabId, expected_tab_version: 1, base: {}, sections: [{ widgets: [{ kind: "text", config: { content: "<script>x</script>" } }] }] }).success).toBe(false);
  });

  // The template "vereinsseite" binds description, events_list and news to the club
  // (club-service community_page.py _template_sections); publish must carry that binding.
  const bound = (kind: string, club: string) => ({ kind, config: { club_id: club } });
  const skeleton = (club: string) => [{ widgets: [
    bound("events_list", club),
    { kind: "custom_html", config: { html: "<div data-slot=\"profil\"></div><div data-slot=\"news\"></div>", slots: { profil: { kind: "description", config: { club_id: club, content: "<p>Verein</p>" } }, news: { kind: "news", config: { club_id: club, limit: 3 } } } } },
  ] }];

  test("Vereinsbindung: club_id der Vorlagenbausteine nur in club_page publish, nicht bei anderen Arten oder allgemeinen Seiten", () => {
    const publish = (sections: JsonValue) => K12_ACTION_SCHEMAS["cai.community.06.club_page"].input.safeParse({ club_id: clubId, operation: "publish", community_id: communityId, tab_id: tabId, expected_tab_version: 1, base: {}, sections });
    expect(publish(skeleton(clubId) as unknown as JsonValue).success).toBe(true);
    expect(publish([{ widgets: [bound("text", clubId)] }] as unknown as JsonValue).success).toBe(false);
    expect(publish([{ widgets: [bound("news", "kein-verein")] }] as unknown as JsonValue).success).toBe(false);
    const preview = (config: JsonValue) => K12_ACTION_SCHEMAS["cai.community.02.preview"].input.safeParse({ club_id: clubId, community_id: communityId, tabs: [{ label: "Start", slug: "start", sections: [{ widgets: [{ kind: "news", config }] }] }] });
    expect(preview({ limit: 3 }).success).toBe(true);
    expect(preview({ limit: 3, club_id: clubId }).success).toBe(false);
  });

  test("Vereinsbindung: Bausteine des eigenen Vereins werden veröffentlicht, ein fremder Verein → TENANT_MISMATCH, nichts gesendet", async () => {
    const own = service([clubId], answers);
    const input = { operation: "publish", community_id: communityId, tab_id: tabId, expected_tab_version: 2, base: { sections: { [sectionId]: 3 }, widgets: { [widgetId]: 5 } }, sections: skeleton(clubId) };
    const preview = ((await own.run("cai.community.06.club_page", input as unknown as Record<string, JsonValue>)).result as { preview: { preview_id: string; confirmation_token: string } }).preview;
    await own.run("cai.community.06.club_page", { ...input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } } as unknown as Record<string, JsonValue>);
    expect(own.writes().map(route)).toEqual([`POST /home-config/${communityId}/tabs/${tabId}/publish`]);
    const sent = JSON.stringify(own.writes()[0]!.body);
    expect(sent).toContain(`"club_id":"${clubId}"`);

    const foreign = service([clubId], answers);
    const error = await failure(foreign.run("cai.community.06.club_page", { ...input, sections: skeleton(otherClubId) } as unknown as Record<string, JsonValue>));
    expect(error.code).toBe("TENANT_MISMATCH");
    expect(foreign.writes()).toHaveLength(0);
  });

  // The runtime check (tool-sets.ts) already rejects a foreign club_id; this covers the
  // second guard in assertOwnClubPage on its own, which also runs right before the POST.
  test("Vereinsbindung: assertOwnClubPage allein lehnt einen einzigen fremden Baustein ab, direkt oder als Slot, ohne Anfrage", async () => {
    const CLUB_BOUND = ["description", "events_list", "news"];
    const own = (kind: string) => ({ kind, config: { club_id: clubId } });
    const cases: Array<[string, JsonValue]> = [];
    for (const kind of CLUB_BOUND) {
      cases.push([`${kind} direkt`, [{ widgets: [...CLUB_BOUND.map(own), bound(kind, otherClubId)] }] as unknown as JsonValue]);
      cases.push([`${kind} als Slot`, [{ widgets: [...CLUB_BOUND.map(own), { kind: "custom_html", config: { html: "<div data-slot=\"x\"></div>", slots: { x: bound(kind, otherClubId) } } }] }] as unknown as JsonValue]);
    }
    for (const [name, sections] of cases) {
      const calls: ComvenioApiRequest[] = [];
      const client = { timeout_ms: 15_000, async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> { calls.push(request); return answers(request) as T; } } as ComvenioApiClient;
      const error = await failure(assertOwnClubPage(client, { club_id: clubId, community_id: communityId, tab_id: tabId, sections }, context));
      expect([name, error.code]).toEqual([name, "TENANT_MISMATCH"]);
      expect([name, calls.length]).toEqual([name, 0]);
    }
    const calls: ComvenioApiRequest[] = [];
    const client = { timeout_ms: 15_000, async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> { calls.push(request); return answers(request) as T; } } as ComvenioApiClient;
    await assertOwnClubPage(client, { club_id: clubId, community_id: communityId, tab_id: tabId, sections: skeleton(clubId) as unknown as JsonValue }, context);
    expect(calls.map(route)).toEqual([`GET /clubs/${clubId}/community-pages`]);
  });
});
