import { TENANT_ISOLATION_REPORT_SCHEMA } from "./schemas.ts";
import type { TenantIsolationReport, TenantScenarioId, TenantScenarioResult } from "./types.ts";

export const REQUIRED_TENANT_SCENARIOS: readonly TenantScenarioId[] = [
  "cross_club",
  "cross_user",
  "stale_capability",
  "token_replay",
  "file_isolation",
  "backend_denial",
  "cached_tool_recheck",
  "grant_revocation",
];

export class TenantIsolationSuite {
  evaluate(results: TenantScenarioResult[]): TenantIsolationReport {
    const ids = results.map((result) => result.id).sort();
    const required = [...REQUIRED_TENANT_SCENARIOS].sort();
    const blockers: string[] = [];
    if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(required)) blockers.push("TENANT_SCENARIO_PARITY");
    if (results.some((result) => !result.passed || !result.synthetic_data_only)) blockers.push("TENANT_ISOLATION_FAILURE");
    return TENANT_ISOLATION_REPORT_SCHEMA.parse({ schema_version: "1.0.0", suite: "TenantIsolationSuite", status: blockers.length === 0 ? "pass" : "blocked", results: [...results].sort((left, right) => left.id.localeCompare(right.id)), blockers });
  }
}
