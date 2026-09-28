/** Usage: bun scripts/audit-capability-mapping.ts domain.json agent.json decisions.json */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { OAUTH_SCOPE_VALUES } from "@comvenio/connector-contracts";
import { auditOperationMapping } from "../apps/mcp-server/src/capability-operation-mapping.ts";

const text = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const source = { source_commit: z.string().regex(/^[a-f0-9]{40}$/u), source_dirty: z.boolean() };
const domainSchema = z.object({
  format: z.literal("domain-operation-contracts/v1"), ...source,
  operation_count: z.number().int().nonnegative(),
  operations: z.array(z.object({
    action_id: text, operation: text, source_action: text, source_path: text.nullable(),
    handler: text, handler_present: z.boolean(),
    dispatch_kind: z.enum(["direct_handler", "job_port", "missing"]), dispatch_source: text,
    publication_state: text, blocker: z.string().nullable(),
    required_scopes: z.array(z.enum(OAUTH_SCOPE_VALUES)), permission_policy: z.unknown(),
    execution_gate: text, risk_class: z.enum(["read", "reversible_write", "critical_write"]),
    external_effect: text, backend_routes: z.array(z.unknown()),
    input_schema: z.unknown(), output_schema: z.unknown(),
    input_schema_hash: hash.nullable(), output_schema_hash: hash.nullable(), schema_error: z.string().nullable(),
  })),
});
const agentSchema = z.object({
  format: z.literal("agent-capability-contracts/v1"), ...source,
  projection_count: z.number().int().nonnegative(),
  capabilities: z.array(z.object({
    capability_id: text, hub: text, agent_selectable: z.boolean(), handler_present: z.boolean(),
    permission: text.nullable(), actor_scope: text, approval_required: z.boolean(), risk_level: z.number().int().min(0).max(3),
    fingerprint: z.object({ input_schema_hash: hash, output_schema_hash: hash, policy_hash: hash }).nullable(),
  })),
});
const decisionSchema = z.object({
  format: z.literal("capability-operation-decisions/v1"),
  domain_source_commit: source.source_commit, agent_source_commit: source.source_commit,
  decisions: z.array(z.object({
    action_id: text, operation: text,
    status: z.enum(["mapped", "internal_only", "intentionally_unexposed", "adapter_missing", "blocked"]),
    capability_id: text.nullable(), reason: text, evidence: z.array(text).min(1),
    domain_input_hash: hash, domain_output_hash: hash,
    agent_input_hash: hash.optional(), agent_output_hash: hash.optional(), agent_policy_hash: hash.optional(),
    schema_adapter: text.optional(),
    follow_up: z.object({ handler: text, endpoints: z.array(z.unknown()).min(1), acceptance: z.array(text).min(1) }).optional(),
  }).strict()),
}).strict();

const paths = process.argv.slice(2);
if (paths.length !== 3) throw new Error("Expected domain export, agent export and reviewed decisions JSON paths.");
const load = (index: number) => JSON.parse(readFileSync(paths[index]!, "utf8"));
const domain = domainSchema.parse(load(0));
const agent = agentSchema.parse(load(1));
const manifest = decisionSchema.parse(load(2));
const report = auditOperationMapping({ operations: domain.operations, capabilities: agent.capabilities, decisions: manifest.decisions });
if (domain.source_dirty || agent.source_dirty) report.errors.push("uncommitted_source_snapshot");
if (domain.operation_count !== domain.operations.length || agent.projection_count !== agent.capabilities.length) report.errors.push("export_count_mismatch");
if (manifest.domain_source_commit !== domain.source_commit || manifest.agent_source_commit !== agent.source_commit) report.errors.push("source_revision_mismatch");
report.complete = report.errors.length === 0;
process.stdout.write(JSON.stringify({
  format: "capability-operation-mapping-audit/v1",
  domain_source_commit: domain.source_commit, agent_source_commit: agent.source_commit,
  semantic_review_required: true, ...report,
}, null, 2) + "\n");
process.exitCode = report.complete ? 0 : 1;
