import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadReviewInventory } from "../../../packages/tool-catalog/src/index.ts";
import {
  CONNECTOR_EVAL_REPORT_SCHEMA,
  PILOT_PROTOCOL_SCHEMA,
  PRIVACY_THREAT_MODEL_SCHEMA,
  RESPONSE_QUALITY_REPORT_SCHEMA,
  RELEASE_GATE_REPORT_SCHEMA,
  RESPONSE_QUALITY_SCENARIOS,
  REQUIRED_PILOT_SCENARIOS,
  REQUIRED_TENANT_SCENARIOS,
  SUPPORT_RUNBOOK_SCHEMA,
  TENANT_ISOLATION_REPORT_SCHEMA,
  ConnectorEvalSuite,
  ResponseQualitySuite,
  TenantIsolationSuite,
  assertProviderReleaseReady,
  buildPendingReleaseArtifacts,
  buildPilotProtocol,
  buildPrivacyThreatModel,
  buildReleaseGateReport,
  buildSupportRunbook,
  type ProviderGateResult,
  type ConnectorEvalToolResult,
  type ReleaseArtifactSet,
  type ReleaseEvidence,
  type ResponseQualityResult,
  type ReleaseSignature,
  type SecurityPrivacyFinding,
  type TenantScenarioResult,
} from "../../../integrations/release/src/index.ts";
import { buildChatGptAppManifest } from "../../../integrations/openai/src/index.ts";
import { buildClaudeDirectoryManifest } from "../../../integrations/anthropic/src/index.ts";
import {
  publishedRuntimeCatalog,
  publishedRuntimeToolNames,
} from "../src/runtime-tools.ts";
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
const releaseScope = "full_connector_v1" as const;
const runtimeCatalog = publishedRuntimeCatalog("production", releaseScope);

test("classifies the Club-Agent as governed orchestration instead of an idempotent write", () => {
  expect(runtimeCatalog.tools.find((tool) =>
    tool.name === "cv_club_agent_converse")).toMatchObject({
    risk_class: "agent_orchestration",
  });
});

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("binds every provider response fixture to the runtime retry contract", () => {
  const fixturePaths = [
    "integrations/openai/fixtures/provider/openai/full-connector-v1.response.json",
    "integrations/anthropic/fixtures/provider/anthropic/full-connector-v1.response.json",
  ];

  for (const fixturePath of fixturePaths) {
    const matrix = json(resolve(workspaceRoot, fixturePath)) as {
      cases: Array<{
        tool_name: string;
        risk_class: string;
        expected_outcome: string;
        response_contract: {
          delegated_capability_confirmation: boolean;
          provider_retry_contract: string;
        };
      }>;
    };
    expect(matrix.cases).toHaveLength(runtimeCatalog.tool_count);
    const casesByToolName = new Map(matrix.cases.map((item) => [item.tool_name, item]));

    for (const tool of runtimeCatalog.tools) {
      const expectedRetryContract = tool.risk_class === "agent_orchestration"
        ? "non_idempotent_conversation_domain_effects_guarded"
        : tool.risk_class === "read"
          ? "safe_repeat"
          : "idempotent_by_key";
      expect(casesByToolName.get(tool.name)).toMatchObject({
        risk_class: tool.risk_class,
        response_contract: {
          delegated_capability_confirmation:
            tool.risk_class === "agent_orchestration",
          provider_retry_contract: expectedRetryContract,
        },
      });
    }

    expect(casesByToolName.get("cv_club_agent_converse")).toMatchObject({
      expected_outcome: "governed_agent_turn_or_actionable_denial",
    });
  }
});

function testedConnectorEvalReport() {
  const tools = publishedRuntimeCatalog("production", releaseScope).tools;
  const toolNames = tools.map((tool) => tool.name);
  const results: ConnectorEvalToolResult[] = tools.map((tool) => ({
    tool_name: tool.name,
    tool_selection: true,
    schema_validation: true,
    grounded_response: true,
    actionable_error: true,
    safe_non_execution: true,
    confirmation_contract: true,
    provider_retry_safe: true,
    provider_retry_contract: tool.risk_class === "agent_orchestration"
      ? "non_idempotent_conversation_domain_effects_guarded"
      : tool.risk_class === "read"
        ? "safe_repeat"
        : "idempotent_by_key",
    synthetic_data_only: true,
    evidence_ref: "apps/mcp-server/tests/mobile-widgets.visual.test.ts",
  }));
  return new ConnectorEvalSuite().evaluate({
    candidate_tool_names: toolNames,
    results,
  });
}

function testedTenantIsolationReport() {
  const results: TenantScenarioResult[] = REQUIRED_TENANT_SCENARIOS.map(
    (id) => ({
      id,
      passed: true,
      synthetic_data_only: true,
      evidence_ref: "apps/mcp-server/tests/mobile-widgets.visual.test.ts",
    }),
  );
  return new TenantIsolationSuite().evaluate(results);
}

function testedResponseQualityReport() {
  const results: ResponseQualityResult[] = ["openai", "anthropic"]
    .flatMap((provider) => RESPONSE_QUALITY_SCENARIOS.map((scenario) => ({
      provider: provider as ResponseQualityResult["provider"],
      scenario_id: scenario.id,
      tool_selection: true,
      grounded_response: true,
      actionable_error: true,
      forbidden_behaviors_absent: true,
      privacy_preserved: true,
      synthetic_data_only: true,
      evidence_ref: "apps/mcp-server/tests/mobile-widgets.visual.test.ts",
    })));
  return new ResponseQualitySuite().evaluate({
    release_scope: releaseScope,
    runtime_tool_catalog_sha256: runtimeCatalog.tool_catalog_sha256,
    runtime_tool_names: runtimeCatalog.tool_names,
    results,
  });
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
    release_scope: releaseScope,
    published_tool_count: runtimeCatalog.tool_count,
    runtime_tool_catalog_sha256: runtimeCatalog.tool_catalog_sha256,
    planned_action_count: 303,
    planned_route_callsite_count: 572,
    published_runtime_catalog_verified: true,
    route_trace_tests_passed: true,
    schema_tests_passed: true,
    permission_tests_passed: true,
    cimd_pins_verified: true,
    revocation_latency_seconds: 5,
    malware_quarantine_verified: true,
    confirmation_input_server_internal: true,
    published_widget_contract_count: runtimeCatalog.widget_contract_count,
    widget_resource_catalog_sha256: runtimeCatalog.widget_catalog_sha256,
    planned_widget_contract_count: 5,
    widget_surfaces_verified: true,
    accessibility_smokes_passed: true,
    rate_limit_config_verified: true,
    development_health_ready: true,
    production_health_ready: true,
    connector_legal_documents_reviewed: true,
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
  const evalReport = testedConnectorEvalReport();
  const responseQuality = testedResponseQualityReport();
  const tenant = testedTenantIsolationReport();
  const privacy = buildPrivacyThreatModel();
  return buildReleaseGateReport({
    generated_at: "2026-07-08T11:00:00.000Z",
    evidence: readyEvidence(),
    eval: evalReport,
    response_quality: responseQuality,
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
  test("TC-01/TC-02: all seven versioned entities are built, statically stored and schema-valid", () => {
    const pending = buildPendingReleaseArtifacts(releaseScope);
    const stored: ReleaseArtifactSet = {
      eval: CONNECTOR_EVAL_REPORT_SCHEMA.parse(json(resolve(releaseRoot, "connector-eval-suite.json"))),
      response_quality: RESPONSE_QUALITY_REPORT_SCHEMA.parse(json(resolve(releaseRoot, "response-quality-suite.json"))),
      tenant_isolation: TENANT_ISOLATION_REPORT_SCHEMA.parse(json(resolve(releaseRoot, "tenant-isolation-suite.json"))),
      privacy: PRIVACY_THREAT_MODEL_SCHEMA.parse(json(resolve(releaseRoot, "privacy-threat-model.json"))),
      pilot: PILOT_PROTOCOL_SCHEMA.parse(json(resolve(releaseRoot, "pilot-protocol.json"))),
      release_gate: RELEASE_GATE_REPORT_SCHEMA.parse(json(resolve(releaseRoot, "release-gate-report.json"))),
      support: SUPPORT_RUNBOOK_SCHEMA.parse(json(resolve(releaseRoot, "support-runbook.json"))),
    };
    expect(stored).toEqual(pending);
    expect([pending.eval.suite, pending.response_quality.suite, pending.tenant_isolation.suite, pending.privacy.entity, pending.pilot.entity, pending.release_gate.entity, pending.support.entity]).toEqual([
      "ConnectorEvalSuite", "ResponseQualitySuite", "TenantIsolationSuite", "PrivacyThreatModel", "PilotProtocol", "ReleaseGateReport", "SupportRunbook",
    ]);
    expect(pending.release_gate).toMatchObject({ decision: "BLOCKED", common_gate: "blocked", submittable_providers: [] });
    const traceability = json(resolve(releaseRoot, "rts-task-commits.json")) as { tasks: Array<{ key: string; task_id: string; commit: string }> };
    expect(traceability.tasks).toHaveLength(23);
    expect(traceability.tasks.map((item) => item.key)).toEqual(Array.from({ length: 23 }, (_, index) => `K${index + 1}`));
    expect(new Set(traceability.tasks.map((item) => item.task_id)).size).toBe(23);
  });

  test("TC-03: future inventory and all published runtime tools have exact eval parity", () => {
    const inventory = loadReviewInventory();
    const report = testedConnectorEvalReport();
    expect(inventory.actions.entries).toHaveLength(303);
    expect(inventory.routes.routes).toHaveLength(572);
    expect(inventory.migration.discovered_candidates.length + inventory.migration.oauth_lifecycle_replacements.length).toBe(303);
    expect(inventory.migration.discovered_candidates.every((candidate) => candidate.published === false && candidate.blockers.length > 0)).toBe(true);
    expect(report).toMatchObject({
      status: "pass",
      evaluated_candidate_tool_count: runtimeCatalog.tool_count,
      tested_tool_count: runtimeCatalog.tool_count,
      blockers: [],
    });
    expect(report.results.map((result) => result.tool_name)).toEqual(
      publishedRuntimeToolNames("production", releaseScope),
    );

    const mismatched = new ConnectorEvalSuite().evaluate({ candidate_tool_names: ["cv_schema_read"], results: [] });
    expect(mismatched).toMatchObject({ status: "blocked", blockers: ["TOOL_EVAL_PARITY"] });
    expect(new TenantIsolationSuite().evaluate([])).toMatchObject({ status: "blocked", blockers: ["TENANT_SCENARIO_PARITY"] });
  });

  test("TC-03a: OpenAI and Anthropic must pass every connected-context response scenario", () => {
    const report = testedResponseQualityReport();
    expect(report).toMatchObject({
      status: "pass",
      expected_result_count: RESPONSE_QUALITY_SCENARIOS.length * 2,
      tested_result_count: RESPONSE_QUALITY_SCENARIOS.length * 2,
      blockers: [],
    });
    expect(report.scenarios.find((scenario) =>
      scenario.id === "connected-personal-tasks")).toMatchObject({
      required_tool_sequence: ["cv_my_tasks_read"],
      forbidden_behaviors: expect.arrayContaining([
        "ask_for_club_id_when_connected",
        "ask_for_domain_when_connected",
      ]),
    });
    expect(new ResponseQualitySuite().evaluate({
      release_scope: releaseScope,
      runtime_tool_catalog_sha256: runtimeCatalog.tool_catalog_sha256,
      runtime_tool_names: runtimeCatalog.tool_names,
      results: [],
    })).toMatchObject({
      status: "blocked",
      blockers: ["RESPONSE_EVAL_PARITY"],
    });
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

  test("TC-05: all five released widgets share provider surfaces", () => {
    const openAi = buildChatGptAppManifest(catalogHash);
    const anthropic = buildClaudeDirectoryManifest(catalogHash);
    expect(openAi.widget_resource_uris).toEqual(anthropic.widget_resource_uris);
    expect(new Set(openAi.widget_resource_uris).size).toBe(5);
    expect(new Set(openAi.screenshots.map((item) => item.resource_uri))).toEqual(new Set(openAi.widget_resource_uris));
    expect(new Set(anthropic.screenshots.map((item) => item.resource_uri)))
      .toEqual(new Set(anthropic.widget_resource_uris));

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
      expect(client).toContain('MCP_APPS_PROTOCOL_VERSION="2026-01-26"');
      expect(client).toContain('"ui/notifications/initialized"');
      expect(client).toContain("handleMcpAppsBridgeMessage");
    }
  });

  test("TC-06: provider states stay independent while pilot, findings and separation-of-duty block release", () => {
    const anthropicOnly = release();
    expect(anthropicOnly).toMatchObject({ common_gate: "ready", decision: "REVIEW_READY", submittable_providers: ["anthropic"] });
    expect(() => assertProviderReleaseReady(anthropicOnly, "anthropic")).not.toThrow();
    expect(() => assertProviderReleaseReady(anthropicOnly, "openai")).toThrow("OPENAI_GLOBAL_RESIDENCY_ACCEPTED_PENDING");

    const highFinding: SecurityPrivacyFinding = { id: "privacy-high", area: "privacy", severity: "high", status: "open", owner: null, mitigation: null };
    expect(release({ findings: [highFinding] })).toMatchObject({ decision: "BLOCKED", blockers: expect.arrayContaining(["SECURITY_PRIVACY_FINDINGS"]) });

    const missingPilot = buildPendingReleaseArtifacts(releaseScope).pilot;
    expect(release({ pilot: missingPilot })).toMatchObject({ decision: "BLOCKED", blockers: expect.arrayContaining(["PILOT_PROTOCOL"]) });

    const sameSigner = signedRelease();
    sameSigner.find((signature) => signature.role === "release_manager")!.signer = "Security Reviewer";
    const base = release();
    expect(buildReleaseGateReport({
      generated_at: base.generated_at,
      evidence: base.evidence,
      eval: base.eval,
      response_quality: base.response_quality,
      tenant_isolation: base.tenant_isolation,
      privacy: base.privacy,
      pilot: base.pilot,
      findings: [],
      signatures: sameSigner,
      provider_gates: base.provider_gates,
    })).toMatchObject({ decision: "BLOCKED", blockers: expect.arrayContaining(["REQUIRED_SIGNATURES"]) });
  });

  test("AK-N-01: minimization, TTLs, telemetry, fair use and log-service exclusion are release evidence", () => {
    const artifacts = buildPendingReleaseArtifacts(releaseScope);
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
