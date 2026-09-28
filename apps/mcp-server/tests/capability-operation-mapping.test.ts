import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fullDomainOperationContracts } from "../src/domain-runtime.ts";
import { auditOperationMapping, type AgentContractProjection, type MappingDecision } from "../src/capability-operation-mapping.ts";

const operation = fullDomainOperationContracts().find((row) => row.action_id === "cai.teams.02.show")!;
const projection: AgentContractProjection = {
  capability_id: "synthetic.team.show", hub: "club_agent_dm", agent_selectable: true,
  handler_present: true, permission: "view_members", actor_scope: "permission",
  approval_required: false, risk_level: 0,
  fingerprint: { input_schema_hash: "synthetic-input", output_schema_hash: "synthetic-output", policy_hash: "synthetic-policy" },
};
const decision: MappingDecision = {
  action_id: operation.action_id, operation: operation.operation, status: "mapped",
  capability_id: projection.capability_id, reason: "Synthetic mapping fixture, not release evidence.",
  evidence: ["tests/capability-operation-mapping.test.ts#fixture"],
  domain_input_hash: operation.input_schema_hash!, domain_output_hash: operation.output_schema_hash!,
  agent_input_hash: "synthetic-input", agent_output_hash: "synthetic-output", agent_policy_hash: "synthetic-policy",
  schema_adapter: "synthetic test fixture: team_id to team_id",
};
const audit = (overrides: Partial<Parameters<typeof auditOperationMapping>[0]> = {}) => auditOperationMapping({
  operations: [structuredClone(operation)], capabilities: [structuredClone(projection)],
  decisions: [structuredClone(decision)], ...overrides,
});

describe("offline capability mapping gate", () => {
  test("accepts explicit parity without attesting a release", () => {
    expect(audit()).toMatchObject({ complete: true, mapped_count: 1, release_verified: false });
  });
  test("requires one decision for every actual operation", () => {
    expect(audit({ decisions: [] }).errors.some((s) => s.startsWith("unreviewed_operation:"))).toBe(true);
    expect(audit({ decisions: [decision, decision] }).errors.some((s) => s.startsWith("duplicate_mapping:"))).toBe(true);
    expect(audit({ decisions: [{ ...decision, operation: "invented" }] }).complete).toBe(false);
  });
  test("rejects schema or policy drift", () => {
    for (const key of ["domain_input_hash", "domain_output_hash", "agent_input_hash", "agent_output_hash", "agent_policy_hash"] as const) {
      expect(audit({ decisions: [{ ...decision, [key]: "changed" }] }).complete).toBe(false);
    }
  });
  test("scope, permission and approval differences each fail parity", () => {
    for (const patch of [
      { required_scopes: ["admin.write"] as const },
      { permission_policy: { all_of: ["manage_members"] } },
      { risk_class: "critical_write" as const },
    ]) expect(audit({ operations: [{ ...operation, ...patch }] }).complete).toBe(false);
  });
  test("checks all hub projections, including hidden or divergent ones", () => {
    expect(audit({ capabilities: [projection, { ...projection, hub: "event_hub", permission: "manage_events" }] }).complete).toBe(false);
    expect(audit({ capabilities: [{ ...projection, agent_selectable: false }] }).complete).toBe(false);
    expect(audit({ capabilities: [] }).complete).toBe(false);
  });
  test("missing adapters need concrete follow-up and never count as mapped", () => {
    const missing: MappingDecision = { ...decision, status: "adapter_missing", capability_id: null };
    expect(audit({ decisions: [missing] }).complete).toBe(false);
    const report = audit({ decisions: [{ ...missing, follow_up: {
      handler: operation.handler, endpoints: operation.backend_routes,
      acceptance: ["Verify backend contract, tenant/RBAC, confirmation, result and signed release before exposure."],
    } }] });
    expect(report).toMatchObject({ complete: true, mapped_count: 0, release_verified: false });
  });
  test("blocked and job-only runtime paths cannot claim executable mapping", () => {
    expect(audit({ operations: [{ ...operation, publication_state: "blocked" }] }).complete).toBe(false);
    expect(audit({ operations: [{ ...operation, dispatch_kind: "job_port" }] }).complete).toBe(false);
  });

  test("CLI reports uncovered operations and rejects stale source revisions", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "capability-mapping-test-"));
    try {
      const source = { source_commit: "a".repeat(40), source_dirty: false };
      const hash = "b".repeat(64);
      const domain = { format: "domain-operation-contracts/v1", ...source, operation_count: 1, operations: [operation] };
      const agent = { format: "agent-capability-contracts/v1", ...source, projection_count: 1,
        capabilities: [{ ...projection, fingerprint: { input_schema_hash: hash, output_schema_hash: hash, policy_hash: hash } }] };
      const paths = ["domain", "agent", "decisions"].map((name) => resolve(directory, `${name}.json`));
      writeFileSync(paths[0]!, JSON.stringify(domain));
      writeFileSync(paths[1]!, JSON.stringify(agent));
      const run = (decisions: unknown[], revision = source.source_commit) => {
        writeFileSync(paths[2]!, JSON.stringify({ format: "capability-operation-decisions/v1",
          domain_source_commit: revision, agent_source_commit: source.source_commit, decisions }));
        return Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../../../scripts/audit-capability-mapping.ts"), ...paths]);
      };
      const missing = run([]);
      expect(missing.exitCode).toBe(1);
      expect(JSON.parse(missing.stdout.toString()).errors[0]).toContain("unreviewed_operation");
      const mapped = { ...decision, agent_input_hash: hash, agent_output_hash: hash, agent_policy_hash: hash };
      const valid = run([mapped]);
      expect(valid.exitCode).toBe(0);
      expect(JSON.parse(valid.stdout.toString())).toMatchObject({ semantic_review_required: true, release_verified: false });
      const stale = run([mapped], "c".repeat(40));
      expect(stale.exitCode).toBe(1);
      expect(JSON.parse(stale.stdout.toString()).errors).toContain("source_revision_mismatch");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
