import { describe, expect, test } from "bun:test";
import { fullDomainCatalogSummary, fullDomainOperationContracts } from "../src/domain-runtime.ts";

describe("runtime operation inventory", () => {
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
