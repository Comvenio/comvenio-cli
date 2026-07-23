import type { ConnectorReleaseScope } from "@comvenio/connector-contracts";

import { publishedRuntimeCatalog } from "../../../apps/mcp-server/src/runtime-tools.ts";
import { ConnectorEvalSuite } from "./eval.ts";
import { buildPilotProtocol } from "./pilot.ts";
import { buildPrivacyThreatModel } from "./privacy.ts";
import { ResponseQualitySuite } from "./response-quality.ts";
import { buildReleaseGateReport } from "./release-gate.ts";
import { buildSupportRunbook } from "./support.ts";
import { TenantIsolationSuite } from "./tenant-isolation.ts";
import type {
  ConnectorEvalReport,
  PilotProtocol,
  PrivacyThreatModel,
  ProviderGateResult,
  ResponseQualityReport,
  ReleaseEvidence,
  ReleaseGateReport,
  ReleaseSignature,
  SupportRunbook,
  TenantIsolationReport,
} from "./types.ts";

export const RELEASE_GENERATED_AT = "2026-07-23T00:00:00.000Z" as const;

export function evaluatedRuntimeToolNames(
  releaseScope: ConnectorReleaseScope,
): string[] {
  return publishedRuntimeCatalog("production", releaseScope).tool_names;
}

function buildPendingConnectorEvalReport(
  releaseScope: ConnectorReleaseScope,
): ConnectorEvalReport {
  return new ConnectorEvalSuite().evaluate({
    candidate_tool_names: evaluatedRuntimeToolNames(releaseScope),
    results: [],
  });
}

function buildPendingTenantIsolationReport(): TenantIsolationReport {
  return new TenantIsolationSuite().evaluate([]);
}

function buildPendingResponseQualityReport(
  releaseScope: ConnectorReleaseScope,
): ResponseQualityReport {
  const catalog = publishedRuntimeCatalog("production", releaseScope);
  return new ResponseQualitySuite().evaluate({
    release_scope: releaseScope,
    runtime_tool_catalog_sha256: catalog.tool_catalog_sha256,
    runtime_tool_names: catalog.tool_names,
    results: [],
  });
}

export function buildPendingReleaseEvidence(
  releaseScope: ConnectorReleaseScope,
): ReleaseEvidence {
  const catalog = publishedRuntimeCatalog("production", releaseScope);
  return {
    release_scope: releaseScope,
    published_tool_count: catalog.tool_count,
    runtime_tool_catalog_sha256: catalog.tool_catalog_sha256,
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
    published_widget_contract_count: catalog.widget_contract_count,
    widget_resource_catalog_sha256: catalog.widget_catalog_sha256,
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
  response_quality: ResponseQualityReport;
  tenant_isolation: TenantIsolationReport;
  privacy: PrivacyThreatModel;
  pilot: PilotProtocol;
  release_gate: ReleaseGateReport;
  support: SupportRunbook;
}

export function buildPendingReleaseArtifacts(
  releaseScope: ConnectorReleaseScope,
): ReleaseArtifactSet {
  const evalReport = buildPendingConnectorEvalReport(releaseScope);
  const responseQuality = buildPendingResponseQualityReport(releaseScope);
  const tenantIsolation = buildPendingTenantIsolationReport();
  const privacy = buildPrivacyThreatModel();
  const pilot = buildPilotProtocol();
  return {
    eval: evalReport,
    response_quality: responseQuality,
    tenant_isolation: tenantIsolation,
    privacy,
    pilot,
    release_gate: buildReleaseGateReport({
      generated_at: RELEASE_GENERATED_AT,
      evidence: buildPendingReleaseEvidence(releaseScope),
      eval: evalReport,
      response_quality: responseQuality,
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
