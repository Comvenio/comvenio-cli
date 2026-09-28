import { describe, expect, test } from "bun:test";

import { K7_ACTION_DEFINITIONS, K7_ACTION_SCHEMAS } from "../src/tools/identity-club-member-team-role/index.ts";

const clubId = "11111111-1111-4111-8111-111111111111";
const departmentId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";

describe("Wochenvorschau over OAuth (cai.club.11/12)", () => {
  test("create starts a run in the ai-service and is a confirmed write", () => {
    const definition = K7_ACTION_DEFINITIONS["cai.club.11.weekly_preview_create"];
    expect(definition.backend_routes[0]).toMatchObject({ method: "POST", service: "ai", normalized_path_template: "/club-agents/{club_id}/weekly-previews/create" });
    expect(definition.risk_class).toBe("critical_write");
    expect(definition.confirmation).toBe("required");
    expect(definition.required_scopes).toEqual(["club.write"]);
    const input = K7_ACTION_SCHEMAS["cai.club.11.weekly_preview_create"].input.parse({ club_id: clubId, department_id: departmentId }) as Record<string, unknown>;
    expect(input.range).toBe("next_week");
    expect(input.telegram).toBe(false);
  });

  test("unknown fields and ranges are refused before the service is called", () => {
    const schema = K7_ACTION_SCHEMAS["cai.club.11.weekly_preview_create"].input;
    expect(() => schema.parse({ club_id: clubId, department_id: departmentId, range: "next_month" })).toThrow();
    expect(() => schema.parse({ club_id: clubId, department_id: departmentId, approve: true })).toThrow();
  });

  test("the run answer keeps its ids", () => {
    const output = K7_ACTION_SCHEMAS["cai.club.11.weekly_preview_create"].output.parse({
      run_id: runId, plan_id: planId, status: "awaiting_approval", error: null, function_run_id: runId,
    }) as Record<string, unknown>;
    expect(output.plan_id).toBe(planId);
  });

  test("the list reads a plan's snapshots and drops the share token", () => {
    const definition = K7_ACTION_DEFINITIONS["cai.club.12.weekly_preview_list"];
    expect(definition.backend_routes[0]).toMatchObject({ method: "GET", service: "ai", normalized_path_template: "/club-agents/{club_id}/weekly-previews" });
    expect(definition.risk_class).toBe("read");
    const rows = K7_ACTION_SCHEMAS["cai.club.12.weekly_preview_list"].output.parse([{
      id: runId, plan_id: planId, plan_run_id: runId, department_id: departmentId, club_id: clubId,
      range_start: "2026-09-27T22:00:00+00:00", range_end: "2026-10-04T22:00:00+00:00",
      events: [{ event_id: runId, title: "F-Jugend: ASV Elisabethszell - SV Motzing", start_time: "2026-10-03T07:30:00+00:00", end_time: "2026-10-03T09:00:00+00:00", location: "Am Sportpl., 94353 Haibach" }],
      hidden: [], share_expires_at: "2026-10-12T22:00:00+00:00", publish_at: null, published_at: null,
      created_at: "2026-09-28T16:30:00+00:00", share_token: "secret",
    }]) as Array<Record<string, unknown>>;
    expect(rows[0]).not.toHaveProperty("share_token");
    expect((rows[0]?.events as unknown[]).length).toBe(1);
  });
});
