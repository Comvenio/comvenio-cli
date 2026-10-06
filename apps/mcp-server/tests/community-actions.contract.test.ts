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
      if (definition.domain !== "community") continue;
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
