import { ConnectorEvalSuite } from "./eval.ts";
import { buildPilotProtocol } from "./pilot.ts";
import { buildPrivacyThreatModel } from "./privacy.ts";
import { buildReleaseGateReport } from "./release-gate.ts";
import { buildSupportRunbook } from "./support.ts";
import { TenantIsolationSuite } from "./tenant-isolation.ts";
import type {
  ConnectorEvalReport,
  PilotProtocol,
  PrivacyThreatModel,
  ProviderGateResult,
  ReleaseEvidence,
  ReleaseGateReport,
  ReleaseSignature,
  SupportRunbook,
  TenantIsolationReport,
} from "./types.ts";

export const RELEASE_GENERATED_AT = "2026-07-23T00:00:00.000Z" as const;

export const EVALUATED_VIRTUAL_TOOL_NAMES = [
  "cv_my_task_reminder_write",
  "cv_my_tasks_read",
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

function buildPendingConnectorEvalReport(): ConnectorEvalReport {
  return new ConnectorEvalSuite().evaluate({
    candidate_tool_names: [...EVALUATED_VIRTUAL_TOOL_NAMES],
    results: [],
  });
}

function buildPendingTenantIsolationReport(): TenantIsolationReport {
  return new TenantIsolationSuite().evaluate([]);
}

export function buildPendingReleaseEvidence(): ReleaseEvidence {
  return {
    release_scope: "personal_productivity_v1",
    published_tool_count: 17,
    planned_action_count: 303,
    planned_route_callsite_count: 560,
    published_runtime_catalog_verified: false,
    route_trace_tests_passed: false,
    schema_tests_passed: false,
    permission_tests_passed: false,
    cimd_pins_verified: false,
    revocation_latency_seconds: null,
    malware_quarantine_verified: false,
    confirmation_input_server_internal: true,
    published_widget_contract_count: 2,
    planned_widget_contract_count: 5,
    widget_surfaces_verified: false,
    accessibility_smokes_passed: false,
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
  const evalReport = buildPendingConnectorEvalReport();
  const tenantIsolation = buildPendingTenantIsolationReport();
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
