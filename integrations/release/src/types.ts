export type GateState = "pass" | "block";
export type ProviderReleaseState = "ready" | "blocked";
export type PilotScenarioId =
  | "public-events-news-menu-sponsors"
  | "oauth-revocation-club-switch"
  | "five-widgets-mobile-desktop"
  | "member-manager-views"
  | "reversible-write"
  | "confirm-publication"
  | "confirm-deletion"
  | "confirm-import-export"
  | "idempotent-retry"
  | "cross-tenant-denial"
  | "permission-denial";

export interface ConnectorEvalToolResult {
  tool_name: string;
  tool_selection: boolean;
  schema_validation: boolean;
  grounded_response: boolean;
  actionable_error: boolean;
  safe_non_execution: boolean;
  confirmation_contract: boolean;
  provider_retry_idempotent: boolean;
  synthetic_data_only: boolean;
  evidence_ref: string;
}

export interface ConnectorEvalReport {
  schema_version: "1.0.0";
  suite: "ConnectorEvalSuite";
  status: "pass" | "blocked";
  evaluated_candidate_tool_count: number;
  tested_tool_count: number;
  results: ConnectorEvalToolResult[];
  blockers: string[];
}

export type TenantScenarioId = "cross_club" | "cross_user" | "stale_capability" | "token_replay" | "file_isolation" | "backend_denial" | "cached_tool_recheck" | "grant_revocation";

export interface TenantScenarioResult {
  id: TenantScenarioId;
  passed: boolean;
  synthetic_data_only: boolean;
  evidence_ref: string;
}

export interface TenantIsolationReport {
  schema_version: "1.0.0";
  suite: "TenantIsolationSuite";
  status: "pass" | "blocked";
  results: TenantScenarioResult[];
  blockers: string[];
}

export interface SecurityPrivacyFinding {
  id: string;
  area: "security" | "privacy";
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  owner: string | null;
  mitigation: string | null;
}

export interface PrivacyThreatModel {
  schema_version: "1.0.0";
  entity: "PrivacyThreatModel";
  country: "DE";
  privacy_priority: "highest";
  data_flows: string[];
  minimization_rules: string[];
  retention_seconds: {
    capability_snapshot: 30;
    private_introspection_read: 5;
    preview: 300;
    confirmation: 300;
    idempotency: 86400;
    upload_handle: 900;
    result_file: 86400;
    job_metadata: 604800;
  };
  telemetry_allowlist: string[];
  data_subject_rights: string[];
  log_service: { connected_to_mcp: false; end_user_access: false; audience: "master_admin_only" };
  review_fixtures: { production_data_allowed: false; synthetic_data_required: true };
  findings: SecurityPrivacyFinding[];
  status: "approved" | "blocked";
}

export interface PilotInteractionSummary {
  total: number;
  successful: number;
  scenario_counts: Partial<Record<PilotScenarioId, number>>;
  data_leaks: number;
  confirmation_bypasses: number;
}

export interface PilotProtocol {
  schema_version: "1.0.0";
  entity: "PilotProtocol";
  country: "DE";
  club_reference: string | null;
  pilot_owner: string | null;
  started_on: string | null;
  ended_on: string | null;
  minimum_calendar_days: 7;
  minimum_successful_interactions: 30;
  minimum_success_rate: 0.95;
  interactions: PilotInteractionSummary;
  findings: SecurityPrivacyFinding[];
  evidence_refs: string[];
  status: "pending" | "passed" | "failed";
  blockers: string[];
}

export interface ReleaseSignature {
  role: "product_owner" | "security_reviewer" | "privacy_reviewer" | "release_manager" | "pilot_owner";
  signer: string | null;
  signed_at: string | null;
  status: "pending" | "signed";
}

export interface ProviderGateResult {
  provider: "openai" | "anthropic";
  state: ProviderReleaseState;
  blockers: string[];
}

export interface ReleaseEvidence {
  action_classification_count: number;
  action_total: number;
  route_callsite_count: number;
  audited_operation_catalog_published: boolean;
  route_trace_tests_passed: boolean;
  schema_tests_passed: boolean;
  permission_tests_passed: boolean;
  cimd_pins_verified: boolean;
  revocation_latency_seconds: number | null;
  malware_quarantine_verified: boolean;
  confirmation_input_server_internal: boolean;
  widget_contract_count: number;
  widget_surfaces_verified: boolean;
  accessibility_smokes_passed: boolean;
  rate_limit_config_verified: boolean;
  development_health_ready: boolean;
  production_health_ready: boolean;
  pricing_included_without_surcharge: boolean;
  germany_first: boolean;
}

export interface ReleaseGateReport {
  schema_version: "1.0.0";
  entity: "ReleaseGateReport";
  release: "comvenio-ai-connector-v1";
  country: "DE";
  generated_at: string;
  evidence: ReleaseEvidence;
  eval: ConnectorEvalReport;
  tenant_isolation: TenantIsolationReport;
  privacy: PrivacyThreatModel;
  pilot: PilotProtocol;
  findings: SecurityPrivacyFinding[];
  signatures: ReleaseSignature[];
  provider_gates: [ProviderGateResult, ProviderGateResult];
  common_gate: ProviderReleaseState;
  decision: "BLOCKED" | "REVIEW_READY";
  submittable_providers: Array<"openai" | "anthropic">;
  blockers: string[];
}

export interface SupportRunbook {
  schema_version: "1.0.0";
  entity: "SupportRunbook";
  document_path: "./support-runbook.md";
  support_email: "support@comvenio.de";
  user_log_access: false;
  revoke_paths: string[];
  rollback_order: ["disable_writes", "widgets_read_only", "pause_provider_listing", "revoke_grants_on_token_risk", "document_incident"];
  rollback_triggers: string[];
  user_help_topics: string[];
}
