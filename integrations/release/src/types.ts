import type { ConnectorReleaseScope } from "@comvenio/connector-contracts";

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
  provider_retry_safe: boolean;
  provider_retry_contract:
    | "safe_repeat"
    | "idempotent_by_key"
    | "non_idempotent_conversation_domain_effects_guarded";
  synthetic_data_only: boolean;
  evidence_ref: string;
}

export interface ConnectorEvalReport {
  schema_version: "1.1.0";
  suite: "ConnectorEvalSuite";
  status: "pass" | "blocked";
  evaluated_candidate_tool_count: number;
  tested_tool_count: number;
  results: ConnectorEvalToolResult[];
  blockers: string[];
}

export type ResponseQualityProvider = "openai" | "anthropic";
export type ResponseQualityActorState =
  | "anonymous"
  | "connected_member"
  | "connected_manager";
export type ResponseQualityIntentClass =
  | "direct_tool"
  | "club_agent_if_released";
export type ForbiddenAssistantBehavior =
  | "ask_for_club_id_when_connected"
  | "ask_for_domain_when_connected"
  | "claim_tool_missing_when_advertised"
  | "expose_internal_identifier"
  | "infer_or_override_rbac"
  | "use_master_admin_log_service"
  | "claim_success_without_tool_result"
  | "mutate_without_confirmation"
  | "target_other_user_reminder"
  | "hallucinate_non_empty_result"
  | "invoke_unreleased_club_agent";
export type ResponseContract =
  | "grounded_list_or_explicit_empty"
  | "self_only_reminder_result"
  | "actionable_scope_reconnect"
  | "actionable_permission_denial"
  | "confirmation_preview_then_result"
  | "governed_agent_turn_or_actionable_denial"
  | "public_minimized_list"
  | "connection_identity_summary";

export interface ResponseQualityScenario {
  id: string;
  release_scopes: ConnectorReleaseScope[];
  actor_state: ResponseQualityActorState;
  intent_class: ResponseQualityIntentClass;
  prompt: string;
  required_tool_sequence: string[];
  forbidden_behaviors: ForbiddenAssistantBehavior[];
  response_contract: ResponseContract;
}

export interface ResponseQualityResult {
  provider: ResponseQualityProvider;
  scenario_id: string;
  tool_selection: boolean;
  grounded_response: boolean;
  actionable_error: boolean;
  forbidden_behaviors_absent: boolean;
  privacy_preserved: boolean;
  synthetic_data_only: boolean;
  evidence_ref: string;
}

export interface ResponseQualityReport {
  schema_version: "1.0.0";
  suite: "ResponseQualitySuite";
  release_scope: ConnectorReleaseScope;
  runtime_tool_catalog_sha256: string;
  providers: [ResponseQualityProvider, ResponseQualityProvider];
  scenarios: ResponseQualityScenario[];
  expected_result_count: number;
  tested_result_count: number;
  results: ResponseQualityResult[];
  status: "pass" | "blocked";
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
  release_scope: ConnectorReleaseScope;
  published_tool_count: number;
  runtime_tool_catalog_sha256: string;
  planned_action_count: number;
  planned_route_callsite_count: number;
  published_runtime_catalog_verified: boolean;
  route_trace_tests_passed: boolean;
  schema_tests_passed: boolean;
  permission_tests_passed: boolean;
  cimd_pins_verified: boolean;
  revocation_latency_seconds: number | null;
  malware_quarantine_verified: boolean;
  confirmation_input_server_internal: boolean;
  published_widget_contract_count: number;
  widget_resource_catalog_sha256: string;
  planned_widget_contract_count: number;
  widget_surfaces_verified: boolean;
  accessibility_smokes_passed: boolean;
  rate_limit_config_verified: boolean;
  development_health_ready: boolean;
  production_health_ready: boolean;
  connector_legal_documents_reviewed: boolean;
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
  response_quality: ResponseQualityReport;
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
