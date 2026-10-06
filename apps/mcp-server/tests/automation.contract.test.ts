import { describe, expect, test } from "bun:test";

import { K7_ACTION_DEFINITIONS, K7_ACTION_SCHEMAS } from "../src/tools/identity-club-member-team-role/index.ts";

const clubId = "11111111-1111-4111-8111-111111111111";
const departmentId = "22222222-2222-4222-8222-222222222222";
const automationId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";

const routes = [
  ["cai.club.16.automation_list", "GET", "/automations/{club_id}", "read"],
  ["cai.club.17.automation_options", "GET", "/automations/{club_id}/options", "read"],
  ["cai.club.18.automation_show", "GET", "/automations/{club_id}/{automation_id}", "read"],
  ["cai.club.19.automation_runs", "GET", "/automations/{club_id}/{automation_id}/runs", "read"],
  ["cai.club.20.automation_create", "POST", "/automations/{club_id}", "critical_write"],
  ["cai.club.21.automation_update", "PATCH", "/automations/{club_id}/{automation_id}", "critical_write"],
  ["cai.club.22.automation_pause", "POST", "/automations/{club_id}/{automation_id}/pause", "reversible_write"],
  ["cai.club.23.automation_resume", "POST", "/automations/{club_id}/{automation_id}/resume", "reversible_write"],
  ["cai.club.24.automation_run", "POST", "/automations/{club_id}/{automation_id}/run", "critical_write"],
  ["cai.club.25.automation_delete", "DELETE", "/automations/{club_id}/{automation_id}", "critical_write"],
] as const;

const automation = {
  id: automationId, club_id: clubId, kind: "club", department_id: null, owner_user_id: null,
  name: "Wochenvorschau Verein", capability_id: "weekly_preview.create",
  args: { department_id: departmentId, team_ids: [], range: "next_week", telegram: false },
  trigger: { type: "schedule", rrule: "FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0", timezone: "Europe/Berlin" },
  output: { type: "channel", department_id: null }, approval_mode: "click", objection_hours: null,
  enabled: true, paused_reason: null, failure_streak: 0, next_run_at: "2026-10-09T15:00:00+00:00",
  last_run_at: null, runs_today: 0, last_run: null, version: 3,
  created_by: userId, updated_by: userId,
  created_at: "2026-10-01T10:00:00+00:00", updated_at: "2026-10-02T10:00:00+00:00",
};

describe("Automatisierungen over OAuth (automatisierungen-07, cai.club.16–25)", () => {
  test("TC-01: ten actions on the routes of 01 with scope and risk of §4", () => {
    for (const [id, method, path, risk] of routes) {
      const definition = K7_ACTION_DEFINITIONS[id as keyof typeof K7_ACTION_DEFINITIONS];
      expect(definition.domain).toBe("club");
      expect(definition.backend_routes).toEqual([
        { route_id: null, method, service: "ai", normalized_path_template: path, purpose: method === "GET" ? "read" : "mutation" },
      ]);
      expect(definition.risk_class).toBe(risk);
      expect(definition.required_scopes).toEqual([risk === "read" ? "club.read" : "club.write"]);
      expect(definition.confirmation).toBe(risk === "critical_write" ? "required" : "none");
      expect(definition.publication_state).toBe("implemented");
    }
  });

  test("create takes the fields of AutomationCreate and refuses unknown ones before the service", () => {
    const schema = K7_ACTION_SCHEMAS["cai.club.20.automation_create"].input;
    const input = { club_id: clubId, automation: { kind: "club", name: "Wochenvorschau", capability_id: "weekly_preview.create", trigger: { type: "manual" } } };
    expect(schema.parse(input)).toEqual(input);
    expect(() => schema.parse({ ...input, automation: { ...input.automation, approve: true } })).toThrow();
    expect(() => schema.parse({ ...input, automation: { ...input.automation, kind: "team" } })).toThrow();
    expect(() => schema.parse({ ...input, automation: { ...input.automation, trigger: { type: "cron" } } })).toThrow();
    expect(() => schema.parse({ ...input, automation: { ...input.automation, objection_hours: 49 } })).toThrow();
  });

  test("update needs expected_version and at least one change", () => {
    const schema = K7_ACTION_SCHEMAS["cai.club.21.automation_update"].input;
    expect(() => schema.parse({ club_id: clubId, automation_id: automationId, changes: { name: "Neu" } })).toThrow();
    expect(() => schema.parse({ club_id: clubId, automation_id: automationId, changes: { expected_version: 3 } })).toThrow();
    expect(schema.parse({ club_id: clubId, automation_id: automationId, changes: { expected_version: 3, enabled: false } }))
      .toEqual({ club_id: clubId, automation_id: automationId, changes: { expected_version: 3, enabled: false } });
  });

  test("delete needs expected_version; pause and resume take it optionally", () => {
    expect(() => K7_ACTION_SCHEMAS["cai.club.25.automation_delete"].input.parse({ club_id: clubId, automation_id: automationId })).toThrow();
    expect(K7_ACTION_SCHEMAS["cai.club.22.automation_pause"].input.parse({ club_id: clubId, automation_id: automationId }))
      .toEqual({ club_id: clubId, automation_id: automationId });
    expect(() => K7_ACTION_SCHEMAS["cai.club.23.automation_resume"].input.parse({ club_id: clubId, automation_id: automationId, approve: true })).toThrow();
  });

  test("the answers keep the automation and its runs and drop the authors", () => {
    const shown = K7_ACTION_SCHEMAS["cai.club.18.automation_show"].output.parse(automation) as Record<string, unknown>;
    expect(shown.version).toBe(3);
    expect(shown).not.toHaveProperty("created_by");
    const run = { id: runId, automation_id: automationId, trigger_type: "manual", state: "awaiting_approval", created_at: "2026-10-06T10:00:00+00:00" };
    const runs = K7_ACTION_SCHEMAS["cai.club.19.automation_runs"].output.parse({ items: [run] }) as { items: Array<Record<string, unknown>> };
    expect(runs.items[0]?.state).toBe("awaiting_approval");
    expect(K7_ACTION_SCHEMAS["cai.club.24.automation_run"].output.parse(run)).toEqual(run);
    const list = K7_ACTION_SCHEMAS["cai.club.16.automation_list"].output.parse({ items: [] }) as { items: unknown[] };
    expect(list.items).toEqual([]);
  });

  test("options require the kind", () => {
    const schema = K7_ACTION_SCHEMAS["cai.club.17.automation_options"].input;
    expect(() => schema.parse({ club_id: clubId })).toThrow();
    expect(schema.parse({ club_id: clubId, kind: "personal" })).toEqual({ club_id: clubId, kind: "personal" });
  });
});
