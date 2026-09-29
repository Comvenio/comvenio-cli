import { describe, expect, test } from "bun:test";
import { fullDomainCatalogSummary, fullDomainOperationContracts } from "../src/domain-runtime.ts";

describe("runtime operation inventory", () => {
  test("available team writes share the canonical club.write scope and retain confirmation", () => {
    const rows = fullDomainOperationContracts();
    const ids = ["cai.team.03.create", "cai.team.04.update", ...[
      "03.create", "04.update", "05.archive", "07.season_create", "08.season_correct",
      "09.season_activate", "10.season_complete", "12.roster_add", "13.roster_update",
      "14.roster_remove", "16.roster_carry_over", "31.termin_create",
    ].map((suffix) => `cai.teams.${suffix}`)];
    for (const id of ids) {
      const row = rows.find((row) => row.action_id === id)!;
      expect(row.required_scopes).toEqual(["club.write"]);
      expect(row.risk_class).toBe("critical_write");
      // K7 confirmations wrap the tool set in domain-runtime.executeAction.
      expect(row.execution_gate).toBe("write_safety");
    }
  });

  test("duplicate team projections retain identical authorization and confirmation gates", () => {
    const rows = fullDomainOperationContracts();
    for (const suffix of ["03.create", "04.update"]) {
      const legacy = rows.find((row) => row.action_id === `cai.team.${suffix}`)!;
      const current = rows.find((row) => row.action_id === `cai.teams.${suffix}`)!;
      expect(legacy.required_scopes).toEqual(current.required_scopes);
      expect(legacy.permission_policy).toEqual(current.permission_policy);
      expect(legacy.execution_gate).toBe(current.execution_gate);
      expect(legacy.risk_class).toBe("critical_write");
      expect(legacy.risk_class).toBe(current.risk_class);
    }
  });
  test("covers every registered action and uniquely addresses its operations", () => {
    const rows = fullDomainOperationContracts();
    expect(new Set(rows.map((row) => row.action_id)).size).toBe(fullDomainCatalogSummary().discovered_actions);
    expect(new Set(rows.map((row) => JSON.stringify([row.action_id, row.operation]))).size).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.handler).toContain("/handlers.ts#");
      expect(row.source_action.length).toBeGreaterThan(0);
      expect(row.execution_gate.length).toBeGreaterThan(0);
      if (!row.schema_error) {
        expect(row.input_schema_hash).toMatch(/^[a-f0-9]{64}$/u);
        expect(row.output_schema_hash).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
  });

  test("is deterministic and returns independent values", () => {
    const first = fullDomainOperationContracts();
    const reference = JSON.stringify(first);
    first[0]!.required_scopes = [];
    const withRoutes = first.find((row) => row.backend_routes.length > 0)!;
    (withRoutes.backend_routes[0] as Record<string, unknown>).purpose = "mutated";
    expect(JSON.stringify(fullDomainOperationContracts())).toBe(reference);
  });

  test("distinguishes declared job dispatch from direct handlers", () => {
    const rows = fullDomainOperationContracts();
    const jobs = rows.filter((row) => ["job", "confirmed_job"].includes(row.execution_gate));
    expect(jobs.length).toBeGreaterThan(0);
    for (const row of jobs) {
      expect(row.dispatch_kind).toBe("job_port");
      expect(row.dispatch_source).toContain("#job_starter.start");
    }
    for (const row of rows.filter((row) => row.dispatch_kind === "direct_handler")) {
      expect(row.handler_present).toBe(true);
    }
  });
});


test("deadline inventory covers both reads performed by its real handler", async () => {
  const { executeK9Operation } = await import("../src/tools/meeting-tournament/handlers.ts");
  type Args = Parameters<typeof executeK9Operation>;
  const paths: string[] = [];
  const client = { request: async (request: { method: string; path: string }) => {
    expect(request.method).toBe("GET");
    paths.push(request.path);
    return request.path.endsWith("/matches") ? [] : { rules_config: { result_deadline: { policy: "manual" } } };
  } } as unknown as Args[4];
  const tournamentId = "11111111-1111-4111-8111-111111111111";
  await executeK9Operation("cai.tournament.32.deadline", "show", { tournament_id: tournamentId }, {} as Args[3], client);
  const row = fullDomainOperationContracts().find((r) => r.action_id === "cai.tournament.32.deadline" && r.operation === "show")!;
  const routes = row.backend_routes as { method: string; normalized_path_template: string; purpose: string }[];
  expect(routes.map((r) => r.normalized_path_template.replace("{tournament_id}", tournamentId)).sort()).toEqual(paths.sort());
  expect(routes.every((r) => r.method === "GET" && r.purpose === "read")).toBe(true);
  expect(row.risk_class).toBe("read");
  expect(row.required_scopes).toEqual(["event.read"]);
});
