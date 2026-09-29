/** Offline K3 audit. This module never registers or enables a product tool. */
import type { DomainOperationContract } from "./domain-runtime.ts";
import { agentFunctionScope } from "./runtime-tools.ts";

export interface AgentContractProjection {
  capability_id: string;
  hub: string;
  agent_selectable: boolean;
  handler_present: boolean;
  permission: string | null;
  actor_scope: string;
  approval_required: boolean;
  risk_level: number;
  fingerprint: { input_schema_hash: string; output_schema_hash: string; policy_hash: string } | null;
}

export type MappingDecision = {
  action_id: string;
  operation: string;
  status: "mapped" | "internal_only" | "intentionally_unexposed" | "adapter_missing" | "blocked";
  capability_id: string | null;
  reason: string;
  /** Reviewed source anchors, not a claim generated from matching names. */
  evidence: string[];
  domain_input_hash: string;
  domain_output_hash: string;
  agent_input_hash?: string;
  agent_output_hash?: string;
  agent_policy_hash?: string;
  schema_adapter?: string;
  follow_up?: { handler: string; endpoints: readonly unknown[]; acceptance: string[] };
};

const identity = (item: { action_id: string; operation: string }) => JSON.stringify([item.action_id, item.operation]);
const sameStrings = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function auditOperationMapping(input: {
  operations: readonly DomainOperationContract[];
  capabilities: readonly AgentContractProjection[];
  decisions: readonly MappingDecision[];
}) {
  const errors: string[] = [];
  if (!input.operations.length) errors.push("empty_runtime_inventory");
  const operations = new Map<string, DomainOperationContract>();
  for (const operation of input.operations) {
    const key = identity(operation);
    if (operations.has(key)) errors.push(`duplicate_runtime_operation:${key}`);
    operations.set(key, operation);
  }
  const decisions = new Map<string, MappingDecision>();
  for (const decision of input.decisions) {
    const key = identity(decision);
    if (decisions.has(key)) errors.push(`duplicate_mapping:${key}`);
    if (!operations.has(key)) errors.push(`unknown_operation:${key}`);
    decisions.set(key, decision);
  }
  const rows = input.operations.map((operation) => {
    const key = identity(operation);
    const decision = decisions.get(key);
    const fail = (reason: string) => errors.push(`${reason}:${key}`);
    if (!decision) {
      fail("unreviewed_operation");
      return { ...operation, mapping: null };
    }
    if (!decision.reason.trim() || !decision.evidence.length || decision.evidence.some((s) => !s.trim())) fail("missing_reason_or_evidence");
    if (decision.domain_input_hash !== operation.input_schema_hash || decision.domain_output_hash !== operation.output_schema_hash) fail("domain_schema_drift");
    if (decision.status === "mapped") {
      if (!decision.capability_id) fail("missing_capability_id");
      if (!decision.schema_adapter?.trim()) fail("missing_schema_adapter_evidence");
      if (operation.publication_state !== "implemented" || operation.schema_error || operation.dispatch_kind !== "direct_handler") fail("domain_not_executable");
      const projections = input.capabilities.filter((p) => p.capability_id === decision.capability_id);
      if (!projections.length) fail("unknown_capability");
      if (new Set(projections.map((p) => p.hub)).size !== projections.length) fail("duplicate_hub_projection");
      for (const projection of projections) {
        if (!projection.agent_selectable || !projection.handler_present || !projection.fingerprint) {
          fail("capability_not_implemented");
          continue;
        }
        if (decision.agent_input_hash !== projection.fingerprint.input_schema_hash
          || decision.agent_output_hash !== projection.fingerprint.output_schema_hash
          || decision.agent_policy_hash !== projection.fingerprint.policy_hash) fail("agent_contract_drift");
        // Use the actual cv_fn registration rule, not an audit-only scope map.
        if (!sameStrings(operation.required_scopes, [agentFunctionScope(projection.risk_level)])) fail("oauth_scope_mismatch");
        const policy = operation.permission_policy as { all_of?: string[]; any_of?: string[]; owner_or_self_allowed?: boolean; department_scope?: string } | null;
        // Visibility's owner/self flag only applies with empty all_of/any_of,
        // which already pass both predicates. It does not bypass a named right.
        // Non-optional department policies need a separate, explicit adapter
        // proof; the agent export does not currently model that restriction.
        if (!policy || !Array.isArray(policy.all_of) || !Array.isArray(policy.any_of)
          || !sameStrings(policy.all_of, projection.permission ? [projection.permission] : [])
          || policy.any_of.length > 0 || policy.department_scope !== "optional"
          || !["permission", "club_member"].includes(projection.actor_scope)) fail("actor_permission_mismatch");
        if ((operation.risk_class === "critical_write") !== projection.approval_required) fail("approval_mismatch");
      }
    } else {
      if (decision.capability_id !== null) fail("unmapped_has_capability_id");
      if (decision.status === "adapter_missing") {
        const follow = decision.follow_up;
        if (!follow?.handler.trim() || !follow.endpoints.length || !follow.acceptance.length) fail("missing_adapter_follow_up");
      }
    }
    return { ...operation, mapping: decision };
  });
  return {
    complete: errors.length === 0,
    action_count: new Set(input.operations.map((op) => op.action_id)).size,
    operation_count: input.operations.length,
    mapped_count: rows.filter((row) => row.mapping?.status === "mapped").length,
    errors: [...new Set(errors)].sort(), rows,
    // Mapping parity alone is never evidence of a signed release or E2E run.
    release_verified: false,
  };
}
