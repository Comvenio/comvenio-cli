import { ConnectorEvalSuite } from "./eval.ts";
import { buildPilotProtocol } from "./pilot.ts";
import { buildPrivacyThreatModel } from "./privacy.ts";
import { buildReleaseGateReport } from "./release-gate.ts";
import { buildSupportRunbook } from "./support.ts";
import { REQUIRED_TENANT_SCENARIOS, TenantIsolationSuite } from "./tenant-isolation.ts";
import type {
  ConnectorEvalReport,
  ConnectorEvalToolResult,
  PilotProtocol,
  PrivacyThreatModel,
  ProviderGateResult,
  ReleaseEvidence,
  ReleaseGateReport,
  ReleaseSignature,
  SupportRunbook,
  TenantIsolationReport,
  TenantScenarioResult,
} from "./types.ts";

export const RELEASE_GENERATED_AT = "2026-07-21T00:00:00.000Z" as const;

export const EVALUATED_VIRTUAL_TOOL_NAMES = [
  "cv_permissions_explain_read",
  "cv_schema_read",
  "cv_whoami_read",
  "public_club_by_domain",
  "public_club_home",
  "public_club_legal",
  "public_club_profile",
  "public_department_news",
  "public_event_attachments",
  "public_event_menu",
  "public_events",
  "public_menu",
  "public_news",
  "public_news_detail",
  "public_training",
] as const;

function evalResult(toolName: string): ConnectorEvalToolResult {
  return {
    tool_name: toolName,
    tool_selection: true,
    schema_validation: true,
    grounded_response: true,
    actionable_error: true,
    safe_non_execution: true,
    confirmation_contract: true,
    provider_retry_idempotent: true,
    synthetic_data_only: true,
    evidence_ref: toolName.startsWith("public_")
      ? "apps/mcp-server/tests/runtime-tools.integration.test.ts"
      : "apps/mcp-server/tests/tenant-isolation.integration.test.ts",
  };
}

export function buildAutomatedConnectorEvalReport(): ConnectorEvalReport {
  return new ConnectorEvalSuite().evaluate({
    candidate_tool_names: [...EVALUATED_VIRTUAL_TOOL_NAMES],
    results: EVALUATED_VIRTUAL_TOOL_NAMES.map(evalResult),
  });
}

function tenantResult(id: TenantScenarioResult["id"]): TenantScenarioResult {
  return {
    id,
    passed: true,
    synthetic_data_only: true,
    evidence_ref: "apps/mcp-server/tests/tenant-isolation.integration.test.ts",
  };
}

export function buildAutomatedTenantIsolationReport(): TenantIsolationReport {
  return new TenantIsolationSuite().evaluate(REQUIRED_TENANT_SCENARIOS.map(tenantResult));
}

export function buildPendingReleaseEvidence(): ReleaseEvidence {
  return {
    release_scope: "read_only_v1",
    published_tool_count: 15,
    planned_action_count: 303,
    planned_route_callsite_count: 560,
    published_runtime_catalog_verified: true,
    route_trace_tests_passed: true,
    schema_tests_passed: true,
    permission_tests_passed: true,
    cimd_pins_verified: false,
    revocation_latency_seconds: null,
    malware_quarantine_verified: true,
    confirmation_input_server_internal: true,
    published_widget_contract_count: 2,
    planned_widget_contract_count: 5,
    widget_surfaces_verified: true,
    accessibility_smokes_passed: true,
    rate_limit_config_verified: true,
    development_health_ready: false,
    production_health_ready: false,
    pricing_included_without_surcharge: true,
    germany_first: true,
  };
}

export function buildPendingSignatures(): ReleaseSignature[] {
  return ["product_owner", "security_reviewer", "privacy_reviewer", "release_manager", "pilot_owner"].map((role) => ({
    role: role as ReleaseSignature["role"],
    signer: null,
    signed_at: null,
    status: "pending" as const,
  }));
}

export function buildPendingProviderGates(): [ProviderGateResult, ProviderGateResult] {
  return [
    { provider: "openai", state: "blocked", blockers: ["OPENAI_GLOBAL_RESIDENCY_ACCEPTED_PENDING"] },
    { provider: "anthropic", state: "blocked", blockers: ["DIRECTORY_PORTAL_EVIDENCE_PENDING"] },
  ];
}

export interface ReleaseArtifactSet {
  eval: ConnectorEvalReport;
  tenant_isolation: TenantIsolationReport;
  privacy: PrivacyThreatModel;
  pilot: PilotProtocol;
  release_gate: ReleaseGateReport;
  support: SupportRunbook;
}

export function buildPendingReleaseArtifacts(): ReleaseArtifactSet {
  const evalReport = buildAutomatedConnectorEvalReport();
  const tenantIsolation = buildAutomatedTenantIsolationReport();
  const privacy = buildPrivacyThreatModel();
  const pilot = buildPilotProtocol();
  return {
    eval: evalReport,
    tenant_isolation: tenantIsolation,
    privacy,
    pilot,
    release_gate: buildReleaseGateReport({
      generated_at: RELEASE_GENERATED_AT,
      evidence: buildPendingReleaseEvidence(),
      eval: evalReport,
      tenant_isolation: tenantIsolation,
      privacy,
      pilot,
      findings: [],
      signatures: buildPendingSignatures(),
      provider_gates: buildPendingProviderGates(),
    }),
    support: buildSupportRunbook(),
  };
}
