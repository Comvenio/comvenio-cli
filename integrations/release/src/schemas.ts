import { z } from "zod";

const evidenceRef = z.string().regex(/^(?:tests|apps|packages|integrations|reports)\/[a-z0-9._/-]+$/u);
const finding = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  area: z.enum(["security", "privacy"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "resolved"]),
  owner: z.string().trim().min(1).nullable(),
  mitigation: z.string().trim().min(1).nullable(),
}).strict();

export const CONNECTOR_EVAL_REPORT_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  suite: z.literal("ConnectorEvalSuite"),
  status: z.enum(["pass", "blocked"]),
  evaluated_candidate_tool_count: z.number().int().nonnegative(),
  tested_tool_count: z.number().int().nonnegative(),
  results: z.array(z.object({
    tool_name: z.string().regex(/^[a-z0-9_.:-]{1,64}$/u),
    tool_selection: z.boolean(),
    schema_validation: z.boolean(),
    grounded_response: z.boolean(),
    actionable_error: z.boolean(),
    safe_non_execution: z.boolean(),
    confirmation_contract: z.boolean(),
    provider_retry_idempotent: z.boolean(),
    synthetic_data_only: z.boolean(),
    evidence_ref: evidenceRef,
  }).strict()),
  blockers: z.array(z.string()),
}).strict();

export const TENANT_ISOLATION_REPORT_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  suite: z.literal("TenantIsolationSuite"),
  status: z.enum(["pass", "blocked"]),
  results: z.array(z.object({
    id: z.enum(["cross_club", "cross_user", "stale_capability", "token_replay", "file_isolation", "backend_denial", "cached_tool_recheck", "grant_revocation"]),
    passed: z.boolean(),
    synthetic_data_only: z.boolean(),
    evidence_ref: evidenceRef,
  }).strict()),
  blockers: z.array(z.string()),
}).strict();

export const PRIVACY_THREAT_MODEL_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  entity: z.literal("PrivacyThreatModel"),
  country: z.literal("DE"),
  privacy_priority: z.literal("highest"),
  data_flows: z.array(z.string().trim().min(1)).min(4),
  minimization_rules: z.array(z.string().trim().min(1)).min(6),
  retention_seconds: z.object({ capability_snapshot: z.literal(30), private_introspection_read: z.literal(5), preview: z.literal(300), confirmation: z.literal(300), idempotency: z.literal(86_400), upload_handle: z.literal(900), result_file: z.literal(86_400), job_metadata: z.literal(604_800) }).strict(),
  telemetry_allowlist: z.array(z.string().regex(/^[a-z_]+$/u)).min(6),
  data_subject_rights: z.array(z.string().trim().min(1)).min(4),
  log_service: z.object({ connected_to_mcp: z.literal(false), end_user_access: z.literal(false), audience: z.literal("master_admin_only") }).strict(),
  review_fixtures: z.object({ production_data_allowed: z.literal(false), synthetic_data_required: z.literal(true) }).strict(),
  findings: z.array(finding),
  status: z.enum(["approved", "blocked"]),
}).strict();

const pilotScenario = z.enum(["public-events-news-menu-sponsors", "oauth-revocation-club-switch", "five-widgets-mobile-desktop", "member-manager-views", "reversible-write", "confirm-publication", "confirm-deletion", "confirm-import-export", "idempotent-retry", "cross-tenant-denial", "permission-denial"]);

export const PILOT_PROTOCOL_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  entity: z.literal("PilotProtocol"),
  country: z.literal("DE"),
  club_reference: z.string().regex(/^pilot-club:[a-z0-9-]+$/u).nullable(),
  pilot_owner: z.string().trim().min(1).nullable(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  ended_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  minimum_calendar_days: z.literal(7),
  minimum_successful_interactions: z.literal(30),
  minimum_success_rate: z.literal(0.95),
  interactions: z.object({
    total: z.number().int().nonnegative(),
    successful: z.number().int().nonnegative(),
    scenario_counts: z.partialRecord(pilotScenario, z.number().int().nonnegative()),
    data_leaks: z.number().int().nonnegative(),
    confirmation_bypasses: z.number().int().nonnegative(),
  }).strict(),
  findings: z.array(finding),
  evidence_refs: z.array(evidenceRef),
  status: z.enum(["pending", "passed", "failed"]),
  blockers: z.array(z.string()),
}).strict();

const evalSchema = CONNECTOR_EVAL_REPORT_SCHEMA;
const tenantSchema = TENANT_ISOLATION_REPORT_SCHEMA;
const privacySchema = PRIVACY_THREAT_MODEL_SCHEMA;
const pilotSchema = PILOT_PROTOCOL_SCHEMA;
const providerGate = z.object({
  provider: z.enum(["openai", "anthropic"]),
  state: z.enum(["ready", "blocked"]),
  blockers: z.array(z.string().trim().min(1)),
}).strict().superRefine((gate, context) => {
  if (gate.state === "ready" && gate.blockers.length > 0) {
    context.addIssue({ code: "custom", path: ["blockers"], message: "Ein freigegebener Provider darf keine Blocker enthalten." });
  }
  if (gate.state === "blocked" && gate.blockers.length === 0) {
    context.addIssue({ code: "custom", path: ["blockers"], message: "Ein blockierter Provider benötigt mindestens einen Blocker." });
  }
});
const signature = z.object({ role: z.enum(["product_owner", "security_reviewer", "privacy_reviewer", "release_manager", "pilot_owner"]), signer: z.string().trim().min(1).nullable(), signed_at: z.string().datetime().nullable(), status: z.enum(["pending", "signed"]) }).strict();

export const RELEASE_GATE_REPORT_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  entity: z.literal("ReleaseGateReport"),
  release: z.literal("comvenio-ai-connector-v1"),
  country: z.literal("DE"),
  generated_at: z.string().datetime(),
  evidence: z.object({
    release_scope: z.literal("read_only_v1"),
    published_tool_count: z.number().int().nonnegative(),
    planned_action_count: z.number().int().nonnegative(),
    planned_route_callsite_count: z.number().int().nonnegative(),
    published_runtime_catalog_verified: z.boolean(),
    route_trace_tests_passed: z.boolean(),
    schema_tests_passed: z.boolean(),
    permission_tests_passed: z.boolean(),
    cimd_pins_verified: z.boolean(),
    revocation_latency_seconds: z.number().nonnegative().nullable(),
    malware_quarantine_verified: z.boolean(),
    confirmation_input_server_internal: z.boolean(),
    published_widget_contract_count: z.number().int().nonnegative(),
    planned_widget_contract_count: z.number().int().nonnegative(),
    widget_surfaces_verified: z.boolean(),
    accessibility_smokes_passed: z.boolean(),
    rate_limit_config_verified: z.boolean(),
    development_health_ready: z.boolean(),
    production_health_ready: z.boolean(),
    pricing_included_without_surcharge: z.boolean(),
    germany_first: z.boolean(),
  }).strict(),
  eval: evalSchema,
  tenant_isolation: tenantSchema,
  privacy: privacySchema,
  pilot: pilotSchema,
  findings: z.array(finding),
  signatures: z.array(signature),
  provider_gates: z.tuple([providerGate, providerGate]),
  common_gate: z.enum(["ready", "blocked"]),
  decision: z.enum(["BLOCKED", "REVIEW_READY"]),
  submittable_providers: z.array(z.enum(["openai", "anthropic"])),
  blockers: z.array(z.string()),
}).strict();

export const SUPPORT_RUNBOOK_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  entity: z.literal("SupportRunbook"),
  document_path: z.literal("./support-runbook.md"),
  support_email: z.literal("support@comvenio.de"),
  user_log_access: z.literal(false),
  revoke_paths: z.array(z.string().trim().min(1)).min(2),
  rollback_order: z.tuple([z.literal("disable_writes"), z.literal("widgets_read_only"), z.literal("pause_provider_listing"), z.literal("revoke_grants_on_token_risk"), z.literal("document_incident")]),
  rollback_triggers: z.array(z.string().trim().min(1)).min(6),
  user_help_topics: z.array(z.string().trim().min(1)).min(5),
}).strict();
