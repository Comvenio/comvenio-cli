import { describe, expect, test } from "bun:test";

import { K7_ACTION_DEFINITIONS, K7_ACTION_SCHEMAS } from "../src/tools/identity-club-member-team-role/index.ts";

const clubId = "11111111-1111-4111-8111-111111111111";
const seasonId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";

describe("Mannschaftstermine over OAuth (cai.teams.30/31/32)", () => {
  test("create posts a hand-made termin to the season and is a confirmed write", () => {
    const definition = K7_ACTION_DEFINITIONS["cai.teams.31.termin_create"];
    expect(definition.backend_routes[0]).toMatchObject({ method: "POST", service: "event", normalized_path_template: "/team-seasons/{team_season_id}/termine" });
    expect(definition.risk_class).toBe("critical_write");
    expect(definition.confirmation).toBe("required");
    const input = K7_ACTION_SCHEMAS["cai.teams.31.termin_create"].input.parse({
      club_id: clubId,
      team_season_id: seasonId,
      termin: {
        kind: "MATCH", opponent: "ASV Elisabethszell", home_state: "AWAY",
        start_time: "2026-10-03T09:30:00+02:00", location: "Am Sportpl., 94353 Haibach", note: "Torfestival",
      },
    }) as Record<string, any>;
    expect(input.termin.opponent).toBe("ASV Elisabethszell");
  });

  test("a match without an opponent is refused before the service is called", () => {
    const schema = K7_ACTION_SCHEMAS["cai.teams.31.termin_create"].input;
    expect(() => schema.parse({ club_id: clubId, team_season_id: seasonId, termin: { kind: "MATCH", start_time: "2026-10-03T09:30:00+02:00" } })).toThrow();
    expect(() => schema.parse({ club_id: clubId, team_season_id: seasonId, termin: { kind: "TRAINING", start_time: "x", unknown: 1 } })).toThrow();
  });

  test("the list reads the season's termine including byes", () => {
    const rows = K7_ACTION_SCHEMAS["cai.teams.30.termin_list"].output.parse([
      { event_id: eventId, title: "F-Jugend: Spielfrei", status: "confirmed", kind: "BYE", all_day: true, source: "SYNC" },
      { event_id: eventId, title: "ASV Elisabethszell - SV Motzing", status: "confirmed", kind: "MATCH", source: "MANUAL", can_edit: true },
    ]) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.kind)).toEqual(["BYE", "MATCH"]);
  });

  test("update patches one termin of the season and is a confirmed write", () => {
    const definition = K7_ACTION_DEFINITIONS["cai.teams.32.termin_update"];
    expect(definition.backend_routes[0]).toMatchObject({ method: "PATCH", service: "event", normalized_path_template: "/team-seasons/{team_season_id}/termine/{event_id}" });
    expect(definition.risk_class).toBe("critical_write");
    expect(definition.confirmation).toBe("required");
    const schema = K7_ACTION_SCHEMAS["cai.teams.32.termin_update"].input;
    // An empty change is allowed: the service rebuilds a match title with the team prefix.
    const empty = schema.parse({ club_id: clubId, team_season_id: seasonId, event_id: eventId, termin: {} }) as Record<string, any>;
    expect(empty.termin).toEqual({});
    const titled = schema.parse({ club_id: clubId, team_season_id: seasonId, event_id: eventId, termin: { title: "Training", scope: "THIS" } }) as Record<string, any>;
    expect(titled.termin).toEqual({ title: "Training", scope: "THIS" });
    expect(() => schema.parse({ club_id: clubId, team_season_id: seasonId, termin: {} })).toThrow();
    expect(() => schema.parse({ club_id: clubId, team_season_id: seasonId, event_id: eventId, termin: { kind: "MATCH" } })).toThrow();
    expect(() => schema.parse({ club_id: clubId, team_season_id: seasonId, event_id: eventId, termin: { scope: "ALL" } })).toThrow();
  });
});

test("termin update sends the change to the termin's own path", async () => {
  const { K7_ACTION_HANDLERS } = await import("../src/tools/identity-club-member-team-role/handlers.ts");
  const handler = K7_ACTION_HANDLERS["cai.teams.32.termin_update"];
  if (!handler) throw new Error("Missing termin update handler");
  type Args = Parameters<typeof handler>;
  const context = { club_id: clubId } as unknown as Args[1];
  const calls: unknown[] = [];
  const client = { request: async (request: unknown) => { calls.push(request); return {}; } } as unknown as Args[2];
  const input = K7_ACTION_SCHEMAS["cai.teams.32.termin_update"].input.parse({ club_id: clubId, team_season_id: seasonId, event_id: eventId, termin: { title: "Training" } });
  await handler(input as Args[0], context, client);
  expect(calls).toEqual([{ method: "PATCH", service: "event", path: `/team-seasons/${seasonId}/termine/${eventId}`, body: { title: "Training" }, context }]);
});


test("termin list uses the same explicit 500-row window as the agent", async () => {
  const { K7_ACTION_HANDLERS } = await import("../src/tools/identity-club-member-team-role/handlers.ts");
  const handler = K7_ACTION_HANDLERS["cai.teams.30.termin_list"];
  if (!handler) throw new Error("Missing termin list handler");
  type Args = Parameters<typeof handler>;
  const context = { club_id: clubId } as unknown as Args[1];
  const calls: unknown[] = [];
  const client = { request: async (request: unknown) => { calls.push(request); return []; } } as unknown as Args[2];
  const input = K7_ACTION_SCHEMAS["cai.teams.30.termin_list"].input.parse({ club_id: clubId, team_season_id: seasonId });
  await handler(input as Args[0], context, client);
  // The API client rejects any "?" in the path (CONFIG_INVALID); the window travels as query.
  expect(calls).toEqual([{ method: "GET", service: "event", path: `/team-seasons/${seasonId}/events`, query: { limit: "500" }, context }]);
});

test("no K7 handler embeds a query string in its request path", async () => {
  const { K7_ACTION_HANDLERS } = await import("../src/tools/identity-club-member-team-role/handlers.ts");
  const source = await Bun.file(new URL("../src/tools/identity-club-member-team-role/handlers.ts", import.meta.url)).text();
  expect(Object.keys(K7_ACTION_HANDLERS).length).toBeGreaterThan(0);
  expect(source.match(/`\/[^`]*\?[^`]*`/g) ?? []).toEqual([]);
});
