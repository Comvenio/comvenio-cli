import { describe, expect, test } from "bun:test";

import { K7_ACTION_DEFINITIONS, K7_ACTION_SCHEMAS } from "../src/tools/identity-club-member-team-role/index.ts";

const clubId = "11111111-1111-4111-8111-111111111111";
const seasonId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";

describe("Mannschaftstermine over OAuth (cai.teams.30/31)", () => {
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
  expect(calls).toEqual([{ method: "GET", service: "event", path: `/team-seasons/${seasonId}/events?limit=500`, context }]);
});
