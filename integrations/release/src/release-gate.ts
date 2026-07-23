import { publishedRuntimeCatalog } from "../../../apps/mcp-server/src/runtime-tools.ts";
import { RELEASE_GATE_REPORT_SCHEMA } from "./schemas.ts";
import type {
  ConnectorEvalReport,
  PilotProtocol,
  PrivacyThreatModel,
  ProviderGateResult,
  ResponseQualityReport,
  ReleaseEvidence,
  ReleaseGateReport,
  ReleaseSignature,
  SecurityPrivacyFinding,
  TenantIsolationReport,
} from "./types.ts";

function signatureGate(signatures: ReleaseSignature[]): boolean {
  const required: ReleaseSignature["role"][] = ["product_owner", "security_reviewer", "privacy_reviewer", "release_manager", "pilot_owner"];
  const signed = required.every((role) => signatures.some((signature) => signature.role === role && signature.status === "signed" && signature.signer && signature.signed_at));
  const security = signatures.find((signature) => signature.role === "security_reviewer");
  const release = signatures.find((signature) => signature.role === "release_manager");
  return Boolean(signed && security?.signer && release?.signer && security.signer !== release.signer);
}

function findingsGate(findings: SecurityPrivacyFinding[]): boolean {
  return findings.every((finding) => {
    if (finding.status === "resolved") return true;
    if (["critical", "high"].includes(finding.severity)) return false;
    return finding.severity !== "medium" || Boolean(finding.owner && finding.mitigation);
  });
}

function evidenceBlockers(evidence: ReleaseEvidence): string[] {
  const blockers: string[] = [];
  const runtimeCatalog = publishedRuntimeCatalog(
    "production",
    evidence.release_scope,
  );
  if (evidence.planned_action_count !== 303 || evidence.planned_route_callsite_count !== 560
    || evidence.planned_widget_contract_count !== 5) blockers.push("PLANNED_SCOPE_DRIFT");
  if (evidence.published_tool_count !== runtimeCatalog.tool_count
    || evidence.runtime_tool_catalog_sha256 !== runtimeCatalog.tool_catalog_sha256
    || !evidence.published_runtime_catalog_verified) {
    blockers.push("PUBLISHED_RUNTIME_CATALOG");
  }
  if (!evidence.route_trace_tests_passed || !evidence.schema_tests_passed || !evidence.permission_tests_passed) blockers.push("OPERATION_CONTRACT_TESTS");
  if (!evidence.cimd_pins_verified) blockers.push("CIMD_PINS");
  if (evidence.revocation_latency_seconds === null || evidence.revocation_latency_seconds > 5) blockers.push("REVOCATION_LATENCY");
  if (!evidence.malware_quarantine_verified
    || !evidence.confirmation_input_server_internal) blockers.push("DATA_SAFETY");
  if (evidence.published_widget_contract_count !== runtimeCatalog.widget_contract_count
    || evidence.widget_resource_catalog_sha256 !== runtimeCatalog.widget_catalog_sha256
    || !evidence.widget_surfaces_verified || !evidence.accessibility_smokes_passed) {
    blockers.push("WIDGET_SURFACES_ACCESSIBILITY");
  }
  if (!evidence.rate_limit_config_verified) blockers.push("RATE_LIMIT_CONFIG");
  if (!evidence.production_health_ready) blockers.push("HEALTH_READINESS");
  if (!evidence.pricing_included_without_surcharge) blockers.push("PRICING_INCLUDED");
  if (!evidence.germany_first) blockers.push("GERMANY_FIRST");
  return blockers;
}

export function buildReleaseGateReport(input: {
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
}): ReleaseGateReport {
  const blockers = evidenceBlockers(input.evidence);
  if (input.eval.status !== "pass") blockers.push("CONNECTOR_EVAL");
  if (input.response_quality.status !== "pass") {
    blockers.push("RESPONSE_QUALITY");
  }
  if (input.tenant_isolation.status !== "pass") blockers.push("TENANT_ISOLATION");
  if (input.privacy.status !== "approved") blockers.push("PRIVACY_THREAT_MODEL");
  if (input.pilot.status !== "passed") blockers.push("PILOT_PROTOCOL");
  if (!findingsGate([...input.findings, ...input.privacy.findings, ...input.pilot.findings])) blockers.push("SECURITY_PRIVACY_FINDINGS");
  if (!signatureGate(input.signatures)) blockers.push("REQUIRED_SIGNATURES");
  const providerNames = input.provider_gates.map((gate) => gate.provider);
  if (new Set(providerNames).size !== 2 || !providerNames.includes("openai") || !providerNames.includes("anthropic")) {
    blockers.push("PROVIDER_GATE_PARITY");
  }
  const orderedProviderGates = [...input.provider_gates].sort((left, right) => left.provider === "openai" ? -1 : right.provider === "openai" ? 1 : 0) as [ProviderGateResult, ProviderGateResult];
  const commonReady = blockers.length === 0;
  const submittableProviders = commonReady ? orderedProviderGates.filter((provider) => provider.state === "ready").map((provider) => provider.provider) : [];
  if (commonReady && submittableProviders.length === 0) blockers.push("NO_PROVIDER_READY");
  const decision = blockers.length === 0 ? "REVIEW_READY" : "BLOCKED";
  return RELEASE_GATE_REPORT_SCHEMA.parse({
    schema_version: "1.0.0",
    entity: "ReleaseGateReport",
    release: "comvenio-ai-connector-v1",
    country: "DE",
    generated_at: input.generated_at,
    evidence: input.evidence,
    eval: input.eval,
    response_quality: input.response_quality,
    tenant_isolation: input.tenant_isolation,
    privacy: input.privacy,
    pilot: input.pilot,
    findings: input.findings,
    signatures: input.signatures,
    provider_gates: orderedProviderGates,
    common_gate: commonReady ? "ready" : "blocked",
    decision,
    submittable_providers: submittableProviders,
    blockers: [...new Set(blockers)],
  });
}

export function assertProviderReleaseReady(report: ReleaseGateReport, provider: "openai" | "anthropic"): void {
  if (report.decision !== "REVIEW_READY" || !report.submittable_providers.includes(provider)) {
    const providerGate = report.provider_gates.find((gate) => gate.provider === provider);
    throw new Error(`${provider}-Release blockiert: ${[...report.blockers, ...(providerGate?.blockers ?? [])].join(", ")}`);
  }
}
