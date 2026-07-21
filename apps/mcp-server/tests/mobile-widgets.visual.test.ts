import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadReviewInventory } from "../../../packages/tool-catalog/src/index.ts";
import {
  CONNECTOR_EVAL_REPORT_SCHEMA,
  PILOT_PROTOCOL_SCHEMA,
  PRIVACY_THREAT_MODEL_SCHEMA,
  RELEASE_GATE_REPORT_SCHEMA,
  REQUIRED_PILOT_SCENARIOS,
  SUPPORT_RUNBOOK_SCHEMA,
  TENANT_ISOLATION_REPORT_SCHEMA,
  ConnectorEvalSuite,
  TenantIsolationSuite,
  assertProviderReleaseReady,
  buildAutomatedConnectorEvalReport,
  buildAutomatedTenantIsolationReport,
  buildPendingReleaseArtifacts,
  buildPilotProtocol,
  buildPrivacyThreatModel,
  buildReleaseGateReport,
  buildSupportRunbook,
  type ProviderGateResult,
  type ReleaseEvidence,
  type ReleaseSignature,
  type SecurityPrivacyFinding,
} from "../../../integrations/release/src/index.ts";
import { buildChatGptAppManifest } from "../../../integrations/openai/src/index.ts";
import { buildClaudeDirectoryManifest } from "../../../integrations/anthropic/src/index.ts";
import {
  BOOKING_OBJECT_WIDGET_CLIENT,
  BOOKING_OBJECT_WIDGET_CSS,
  CONFIRMATION_WIDGET_CLIENT,
  CONFIRMATION_WIDGET_CSS,
  EVENT_CALENDAR_WIDGET_CLIENT,
  EVENT_CALENDAR_WIDGET_CSS,
  MEMBER_MANAGEMENT_WIDGET_CLIENT,
  MEMBER_MANAGEMENT_WIDGET_CSS,
  NEWS_WIDGET_CLIENT,
  NEWS_WIDGET_CSS,
} from "../src/widgets/index.ts";

const workspaceRoot = resolve(import.meta.dir, "../../..");
const releaseRoot = resolve(workspaceRoot, "integrations/release");
const catalogHash = "5ea594f1cc0a059dabf58d4b99906823d9b02318220e95af8943e5f7417ba5a7";

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function passedPilot() {
  return buildPilotProtocol({
    club_reference: "pilot-club:auftraggeber-verein",
    pilot_owner: "Pilot Owner",
    started_on: "2026-07-01",
    ended_on: "2026-07-07",
    total: 31,
    successful: 30,
    scenario_counts: Object.fromEntries(REQUIRED_PILOT_SCENARIOS.map((scenario) => [scenario, 1])),
    evidence_refs: ["reports/pilot/comvenio-ai-connector-v1.json"],
  });
}

function readyEvidence(): ReleaseEvidence {
  return {
    action_classification_count: 303,
    action_total: 303,
    route_callsite_count: 560,
    audited_operation_catalog_published: true,
    route_trace_tests_passed: true,
    schema_tests_passed: true,
    permission_tests_passed: true,
    cimd_pins_verified: true,
    revocation_latency_seconds: 5,
    malware_quarantine_verified: true,
    confirmation_input_server_internal: true,
    widget_contract_count: 5,
    widget_surfaces_verified: true,
    accessibility_smokes_passed: true,
    rate_limit_config_verified: true,
    development_health_ready: true,
    production_health_ready: true,
    pricing_included_without_surcharge: true,
    germany_first: true,
  };
}

function signedRelease(): ReleaseSignature[] {
  const signers: Record<ReleaseSignature["role"], string> = {
    product_owner: "Product Owner",
    security_reviewer: "Security Reviewer",
    privacy_reviewer: "Privacy Reviewer",
    release_manager: "Release Manager",
    pilot_owner: "Pilot Owner",
  };
  return Object.entries(signers).map(([role, signer]) => ({
    role: role as ReleaseSignature["role"],
    signer,
    signed_at: "2026-07-08T10:00:00.000Z",
    status: "signed" as const,
  }));
}

function release(input: { pilot?: ReturnType<typeof passedPilot>; findings?: SecurityPrivacyFinding[]; provider_gates?: [ProviderGateResult, ProviderGateResult] } = {}) {
  const evalReport = buildAutomatedConnectorEvalReport();
  const tenant = buildAutomatedTenantIsolationReport();
  const privacy = buildPrivacyThreatModel();
  return buildReleaseGateReport({
    generated_at: "2026-07-08T11:00:00.000Z",
    evidence: readyEvidence(),
    eval: evalReport,
    tenant_isolation: tenant,
    privacy,
    pilot: input.pilot ?? passedPilot(),
    findings: input.findings ?? [],
    signatures: signedRelease(),
    provider_gates: input.provider_gates ?? [
      { provider: "openai", state: "blocked", blockers: ["OPENAI_GLOBAL_RESIDENCY_ACCEPTED_PENDING"] },
      { provider: "anthropic", state: "ready", blockers: [] },
    ],
  });
}

describe("K23 Connector quality, privacy, pilot and release gates", () => {
  test("TC-01/TC-02: all six versioned entities are built, statically stored and schema-valid", () => {
    const pending = buildPendingReleaseArtifacts();
    const stored = {
      eval: CONNECTOR_EVAL_REPORT_SCHEMA.parse(json(resolve(releaseRoot, "connector-eval-suite.json"))),
      tenant_isolation: TENANT_ISOLATION_REPORT_SCHEMA.parse(json(resolve(releaseRoot, "tenant-isolation-suite.json"))),
      privacy: PRIVACY_THREAT_MODEL_SCHEMA.parse(json(resolve(releaseRoot, "privacy-threat-model.json"))),
      pilot: PILOT_PROTOCOL_SCHEMA.parse(json(resolve(releaseRoot, "pilot-protocol.json"))),
      release_gate: RELEASE_GATE_REPORT_SCHEMA.parse(json(resolve(releaseRoot, "release-gate-report.json"))),
      support: SUPPORT_RUNBOOK_SCHEMA.parse(json(resolve(releaseRoot, "support-runbook.json"))),
    };
    expect(stored).toEqual(pending);
    expect([pending.eval.suite, pending.tenant_isolation.suite, pending.privacy.entity, pending.pilot.entity, pending.release_gate.entity, pending.support.entity]).toEqual([
      "ConnectorEvalSuite", "TenantIsolationSuite", "PrivacyThreatModel", "PilotProtocol", "ReleaseGateReport", "SupportRunbook",
    ]);
    expect(pending.release_gate).toMatchObject({ decision: "BLOCKED", common_gate: "blocked", submittable_providers: [] });
    const traceability = json(resolve(releaseRoot, "rts-task-commits.json")) as { tasks: Array<{ key: string; task_id: string; commit: string }> };
    expect(traceability.tasks).toHaveLength(23);
    expect(traceability.tasks.map((item) => item.key)).toEqual(Array.from({ length: 23 }, (_, index) => `K${index + 1}`));
    expect(new Set(traceability.tasks.map((item) => item.task_id)).size).toBe(23);
  });

  test("TC-03: 303 workflows, 560 routes and all eight published virtual tools have exact eval parity", () => {
    const inventory = loadReviewInventory();
    const report = buildAutomatedConnectorEvalReport();
    expect(inventory.actions.entries).toHaveLength(303);
    expect(inventory.routes.routes).toHaveLength(560);
    expect(inventory.migration.discovered_candidates.length + inventory.migration.oauth_lifecycle_replacements.length).toBe(303);
    expect(inventory.migration.discovered_candidates.every((candidate) => candidate.published === false && candidate.blockers.length > 0)).toBe(true);
    expect(report).toMatchObject({ status: "pass", published_tool_count: 8, tested_tool_count: 8, blockers: [] });
    expect(report.results.map((result) => result.tool_name)).toEqual(inventory.provider_contract.virtual_tools.map((tool) => tool.tool_name).sort());

    const mismatched = new ConnectorEvalSuite().evaluate({ published_tool_names: ["cv_schema_read"], results: [] });
    expect(mismatched).toMatchObject({ status: "blocked", blockers: ["TOOL_EVAL_PARITY"] });
    expect(new TenantIsolationSuite().evaluate([])).toMatchObject({ status: "blocked", blockers: ["TENANT_SCENARIO_PARITY"] });
  });

  test("TC-04: pilot boundaries enforce seven days, 30 successes, 95 percent and every denial scenario", () => {
    expect(passedPilot()).toMatchObject({ status: "passed", blockers: [] });
    expect(buildPilotProtocol({
      club_reference: "pilot-club:auftraggeber-verein",
      pilot_owner: "Pilot Owner",
      started_on: "2026-07-01",
      ended_on: "2026-07-06",
      total: 30,
      successful: 29,
      scenario_counts: Object.fromEntries(REQUIRED_PILOT_SCENARIOS.slice(1).map((scenario) => [scenario, 1])),
      evidence_refs: ["reports/pilot/failed.json"],
    })).toMatchObject({
      status: "failed",
      blockers: expect.arrayContaining(["PILOT_MINIMUM_DAYS", "PILOT_INTERACTION_THRESHOLD", "PILOT_SCENARIO_COVERAGE"]),
    });
  });

  test("TC-05: the same five responsive, accessible widget builds cover ChatGPT and Claude surfaces", () => {
    const openAi = buildChatGptAppManifest(catalogHash);
    const anthropic = buildClaudeDirectoryManifest(catalogHash);
    expect(openAi.widget_resource_uris).toEqual(anthropic.widget_resource_uris);
    expect(new Set(openAi.widget_resource_uris).size).toBe(5);
    expect(new Set(openAi.screenshots.map((item) => item.resource_uri))).toEqual(new Set(openAi.widget_resource_uris));
    expect(new Set(anthropic.screenshots.map((item) => item.resource_uri))).toEqual(new Set(anthropic.widget_resource_uris));

    const widgetBuilds = [
      [EVENT_CALENDAR_WIDGET_CSS, EVENT_CALENDAR_WIDGET_CLIENT],
      [MEMBER_MANAGEMENT_WIDGET_CSS, MEMBER_MANAGEMENT_WIDGET_CLIENT],
      [BOOKING_OBJECT_WIDGET_CSS, BOOKING_OBJECT_WIDGET_CLIENT],
      [NEWS_WIDGET_CSS, NEWS_WIDGET_CLIENT],
      [CONFIRMATION_WIDGET_CSS, CONFIRMATION_WIDGET_CLIENT],
    ];
    for (const [css, client] of widgetBuilds) {
      expect(css).toContain("@media");
      expect(css).toContain("prefers-reduced-motion");
      expect(client).toMatch(/aria-|role/u);
    }
  });

  test("TC-06: provider states stay independent while pilot, findings and separation-of-duty block release", () => {
    const anthropicOnly = release();
    expect(anthropicOnly).toMatchObject({ common_gate: "ready", decision: "REVIEW_READY", submittable_providers: ["anthropic"] });
    expect(() => assertProviderReleaseReady(anthropicOnly, "anthropic")).not.toThrow();
    expect(() => assertProviderReleaseReady(anthropicOnly, "openai")).toThrow("OPENAI_GLOBAL_RESIDENCY_ACCEPTED_PENDING");

    const highFinding: SecurityPrivacyFinding = { id: "privacy-high", area: "privacy", severity: "high", status: "open", owner: null, mitigation: null };
    expect(release({ findings: [highFinding] })).toMatchObject({ decision: "BLOCKED", blockers: expect.arrayContaining(["SECURITY_PRIVACY_FINDINGS"]) });

    const missingPilot = buildPendingReleaseArtifacts().pilot;
    expect(release({ pilot: missingPilot })).toMatchObject({ decision: "BLOCKED", blockers: expect.arrayContaining(["PILOT_PROTOCOL"]) });

    const sameSigner = signedRelease();
    sameSigner.find((signature) => signature.role === "release_manager")!.signer = "Security Reviewer";
    const base = release();
    expect(buildReleaseGateReport({
      generated_at: base.generated_at,
      evidence: base.evidence,
      eval: base.eval,
      tenant_isolation: base.tenant_isolation,
      privacy: base.privacy,
      pilot: base.pilot,
      findings: [],
      signatures: sameSigner,
      provider_gates: base.provider_gates,
    })).toMatchObject({ decision: "BLOCKED", blockers: expect.arrayContaining(["REQUIRED_SIGNATURES"]) });
  });

  test("AK-N-01: minimization, TTLs, telemetry, fair use and log-service exclusion are release evidence", () => {
    const artifacts = buildPendingReleaseArtifacts();
    expect(artifacts.privacy).toMatchObject({
      privacy_priority: "highest",
      log_service: { connected_to_mcp: false, end_user_access: false, audience: "master_admin_only" },
      review_fixtures: { production_data_allowed: false, synthetic_data_required: true },
      retention_seconds: { capability_snapshot: 30, private_introspection_read: 5, preview: 300, confirmation: 300, idempotency: 86_400, upload_handle: 900, result_file: 86_400, job_metadata: 604_800 },
    });
    expect(artifacts.support).toEqual(buildSupportRunbook());
    expect(artifacts.support.rollback_order).toEqual(["disable_writes", "widgets_read_only", "pause_provider_listing", "revoke_grants_on_token_risk", "document_incident"]);
    expect(artifacts.privacy.telemetry_allowlist).not.toEqual(expect.arrayContaining(["arguments", "token", "club_id", "member_id"]));
    expect(json(resolve(releaseRoot, "rate-limit-config.json"))).toEqual(json(resolve(workspaceRoot, "apps/mcp-server/config/fair-use.v1.json")));
  });
});
