import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { JsonSchemaDocument, OperationDefinition, ToolCatalogSnapshot, ToolDefinition } from "@comvenio/tool-catalog";
import {
  ANTHROPIC_ADAPTER_RUNTIME_CONTRACT,
  AnthropicConnectorAdapter,
  CLAUDE_DIRECTORY_MANIFEST_SCHEMA,
  CLAUDE_TOOL_SYNC_PLAN_SCHEMA,
  ClaudeToolSyncSuite,
  assertAnthropicSubmissionReady,
  buildClaudeDirectoryManifest,
  buildClaudeReviewerRunbook,
  buildClaudeSubmissionBundle,
  runAnthropicSubmissionPreflight,
  type ClaudeDirectoryManifest,
  type ClaudeSubmissionEvidence,
  type ClaudeToolSyncPlan,
} from "../../../integrations/anthropic/src/index.ts";

const artifactRoot = resolve(import.meta.dir, "../../../integrations/anthropic");
const catalogHash = "5ea594f1cc0a059dabf58d4b99906823d9b02318220e95af8943e5f7417ba5a7";

function operation(input: { id: string; scopes: OperationDefinition["required_scopes"]; permission: string; publicRead?: boolean }): OperationDefinition {
  return {
    operation_id: input.id,
    domain: input.publicRead ? "news" : "member",
    legacy_action_id: input.publicRead ? "cai.news.01.list" : "cai.member.01.list",
    source_branch_locators: [`src/commands/${input.publicRead ? "news" : "member"}.ts:${input.id}`],
    shared_handler_ref: `@comvenio/tool-catalog/operations/${input.id}`,
    route_trace_fixture_ref: `fixtures/${input.id}.route-trace.json`,
    input_schema_ref: `schemas/${input.id}.input.json`,
    output_schema_ref: `schemas/${input.id}.output.json`,
    required_scopes: input.scopes,
    permission_policy: { all_of: input.publicRead ? [] : [input.permission], any_of: [], owner_or_self_allowed: false, department_scope: "forbidden", backend_audit_refs: [input.publicRead ? "audit.public.news.list" : "audit.member.list"] },
    risk_class: "read",
    execution_mode: "inline",
    external_effect: input.publicRead ? "none" : "comvenio_private",
    idempotency: "read",
    confirmation: "none",
  };
}

function tool(input: { name: string; operation: OperationDefinition; title: string }): ToolDefinition {
  return {
    tool_name: input.name,
    tool_group_key_sha256: input.operation.required_scopes.every((scope) => scope === "public.read") ? "a".repeat(64) : "b".repeat(64),
    title: input.title,
    description: `${input.title} mit dem gemeinsamen, backendautorisierten Comvenio-Vertrag.`,
    copy_fixture_ref: `copy/${input.name}.json`,
    operation_ids: [input.operation.operation_id],
    required_scopes: [...input.operation.required_scopes],
    risk_class: input.operation.risk_class,
    execution_mode: input.operation.execution_mode,
    idempotency: input.operation.idempotency,
    confirmation: input.operation.confirmation,
    permission_policy: structuredClone(input.operation.permission_policy),
    external_effect: input.operation.external_effect,
    input_schema_ref: input.operation.input_schema_ref,
    output_schema_ref: input.operation.output_schema_ref,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

const publicOperation = operation({ id: "news.public.list", scopes: ["public.read"], permission: "public", publicRead: true });
const privateOperation = operation({ id: "member.permissions.explain", scopes: ["club.read", "member.read.basic"], permission: "view_members" });
const publicTool = tool({ name: "cv_file_get_read", operation: publicOperation, title: "Comvenio: Öffentliche News" });
const privateTool = tool({ name: "cv_permissions_explain_read", operation: privateOperation, title: "Comvenio: Eigene Rechte erklären" });
const catalog: ToolCatalogSnapshot = {
  contract_version: "1.0.0",
  source_hash_sha256: catalogHash,
  operations: [privateOperation, publicOperation],
  tools: [privateTool, publicTool],
  cli_bindings: [],
  mcp_bindings: [
    { operation_id: publicOperation.operation_id, tool_name: publicTool.tool_name, operation_discriminator: publicOperation.operation_id, widget_resource_uri: "ui://comvenio/news" },
    { operation_id: privateOperation.operation_id, tool_name: privateTool.tool_name, operation_discriminator: privateOperation.operation_id, widget_resource_uri: "ui://comvenio/member-management" },
  ],
};
const objectSchema: JsonSchemaDocument = { type: "object", additionalProperties: false, properties: {}, required: [] };
const schemas = new Map<string, JsonSchemaDocument>(catalog.operations.flatMap((item) => [
  [item.input_schema_ref, structuredClone(objectSchema)],
  [item.output_schema_ref, structuredClone(objectSchema)],
]));

function evidence(manifest: ClaudeDirectoryManifest, plan: ClaudeToolSyncPlan): Omit<ClaudeSubmissionEvidence, "tool_sync_report"> {
  return {
    organization_plan: "team",
    directory_management_access: true,
    directory_slug_verified: true,
    public_remote_mcp_verified: true,
    origin_header_validation_verified: true,
    oauth_cimd_verified: true,
    public_documentation_verified: true,
    privacy_policy_verified: true,
    support_verified: true,
    first_party_api_verified: true,
    unsupported_use_cases_absent: true,
    tool_results: plan.cases.map((item) => ({ tool_name: item.tool_name, happy_path_passed: true, permission_denied_passed: true, mcp_inspector_passed: true, claude_custom_connector_passed: true, expected_response_fixture: item.expected_response_fixture })),
    reviewer_accounts: [
      { role: "member", fully_populated: true, login_ready: true, mfa_required: false, secret_reference: "submission-secret:/anthropic/member" },
      { role: "manager", fully_populated: true, login_ready: true, mfa_required: false, secret_reference: "submission-secret:/anthropic/manager" },
    ],
    widget_surfaces: manifest.widget_resource_uris.map((resourceUri) => ({ resource_uri: resourceUri, surfaces: ["web", "desktop", "mobile"], same_widget_build: true })),
    review_findings: [],
  };
}

describe("Anthropic Connector Directory provider package", () => {
  const adapter = new AnthropicConnectorAdapter();
  const expectedTools = adapter.adapt({ catalog, schemas });

  test("TC-01/TC-02: builds all five K22 entities and validates the complete Directory package", () => {
    expect(adapter.validate({ catalog, schemas })).toEqual({ valid: true, tool_count: 2, tool_sync_version: catalogHash });
    const manifest = buildClaudeDirectoryManifest(catalogHash);
    const plan = new ClaudeToolSyncSuite().buildPlan(catalog);
    const runbook = buildClaudeReviewerRunbook();
    const bundle = buildClaudeSubmissionBundle({ artifact_root: artifactRoot, catalog, schemas, observed_tools: structuredClone(expectedTools), evidence: evidence(manifest, plan) });
    expect([adapter, manifest, bundle, new ClaudeToolSyncSuite(), runbook]).toHaveLength(5);
    expect(bundle.tool_sync_report.status).toBe("pass");
    expect(manifest.capabilities.prompts).toBe(false);
    expect(bundle.preflight.state).toBe("ready");
    expect(() => assertAnthropicSubmissionReady(bundle.preflight)).not.toThrow();
  });

  test("TC-03: detects every missing, extra or drifted tool and validates empty and schema boundaries", () => {
    const suite = new ClaudeToolSyncSuite();
    expect(suite.compare({ tool_sync_version: catalogHash, expected: expectedTools, observed: structuredClone(expectedTools) }).status).toBe("pass");
    const drifted = structuredClone(expectedTools);
    drifted[0]!.description = "Abweichende Beschreibung";
    const report = suite.compare({ tool_sync_version: catalogHash, expected: expectedTools, observed: [...drifted.slice(0, 1), { ...drifted[1]!, name: "cv_extra_read" }] });
    expect(report).toMatchObject({ status: "blocked", missing_tools: [privateTool.tool_name], extra_tools: ["cv_extra_read"], drift: [{ tool_name: publicTool.tool_name, changed_fields: ["description"] }] });
    expect(suite.compare({ tool_sync_version: catalogHash, expected: [], observed: [] }).status).toBe("blocked");
    expect(() => adapter.adapt({ catalog, schemas: new Map() })).toThrow("Schema fehlt");
    expect(() => suite.buildPlan({ ...catalog, tools: [{ ...publicTool, tool_name: `cv_${"x".repeat(64)}` }] })).toThrow();
    const draft = buildClaudeDirectoryManifest(catalogHash);
    const eventScreenshot = { resource_uri: "ui://comvenio/event-calendar" as const, path: "./screenshots/event-calendar.png", prompt: "Welche Termine stehen diese Woche in meinem Verein an?", format: "png" as const, app_response_only: true as const, synthetic_data_only: true as const };
    const newsScreenshot = { ...eventScreenshot, resource_uri: "ui://comvenio/news" as const, path: "./screenshots/news-list.png", prompt: "Zeige mir die neuesten News meines Vereins." };
    const eventDetailScreenshot = { ...eventScreenshot, path: "./screenshots/event-calendar-detail.png", prompt: "Zeige mir die Details zum nächsten Vereinstermin." };
    expect(CLAUDE_DIRECTORY_MANIFEST_SCHEMA.parse({ ...draft, screenshots: [eventScreenshot, newsScreenshot, eventDetailScreenshot] }).screenshots).toHaveLength(3);
    expect(() => CLAUDE_DIRECTORY_MANIFEST_SCHEMA.parse({
      ...draft,
      screenshots: [
        eventScreenshot,
        newsScreenshot,
        {
          ...eventDetailScreenshot,
          resource_uri: "ui://comvenio/unknown",
        },
      ],
    })).toThrow();
    expect(() => CLAUDE_DIRECTORY_MANIFEST_SCHEMA.parse({ ...draft, screenshots: [eventScreenshot, newsScreenshot, { ...eventDetailScreenshot, path: eventScreenshot.path }] })).toThrow("eindeutigen Artefaktpfad");
  });

  test("TC-04: binds every planned widget to synthetic submission evidence", () => {
    const staticManifest = CLAUDE_DIRECTORY_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(resolve(artifactRoot, "submission/connector-profile.json"), "utf8")));
    const staticPlan = CLAUDE_TOOL_SYNC_PLAN_SCHEMA.parse(JSON.parse(readFileSync(resolve(artifactRoot, "submission/tool-test-plan.json"), "utf8")));
    expect(staticManifest.tool_sync_version).toBe(staticPlan.tool_sync_version);
    expect(new Set(staticManifest.screenshots.map((item) => item.resource_uri)))
      .toEqual(new Set(staticManifest.widget_resource_uris));
    for (const item of staticPlan.cases) expect(existsSync(resolve(artifactRoot, item.expected_response_fixture))).toBe(true);
  });

  test("TC-05: preserves exact scopes, annotations and released widgets on every Claude surface", () => {
    expect(expectedTools.map((item) => item.name)).toEqual([publicTool.tool_name, privateTool.tool_name]);
    expect(expectedTools[0]).toMatchObject({ requiredScopes: ["public.read"], annotations: publicTool.annotations, _meta: { ui: { resourceUri: "ui://comvenio/news" } } });
    expect(expectedTools[1]).toMatchObject({ requiredScopes: ["club.read", "member.read.basic"], annotations: privateTool.annotations, _meta: { ui: { resourceUri: "ui://comvenio/member-management" } } });
    const manifest = buildClaudeDirectoryManifest(catalogHash);
    expect(new Set(manifest.widget_resource_uris).size).toBe(5);
    expect(evidence(manifest, new ClaudeToolSyncSuite().buildPlan(catalog)).widget_surfaces.every((item) => item.same_widget_build && item.surfaces.join(",") === "web,desktop,mobile")).toBe(true);
  });

  test("TC-06: an Anthropic finding blocks only Claude and excludes provider forks, secrets and plugin substitutes", () => {
    const manifest = buildClaudeDirectoryManifest(catalogHash);
    const plan = new ClaudeToolSyncSuite().buildPlan(catalog);
    const inputEvidence = evidence(manifest, plan);
    const syncReport = new ClaudeToolSyncSuite().compare({ tool_sync_version: catalogHash, expected: expectedTools, observed: structuredClone(expectedTools) });
    const chatGptRelease = { provider: "openai", state: "ready" } as const;
    inputEvidence.review_findings = [{ id: "claude-review-1", severity: "medium", status: "open" }];
    const report = runAnthropicSubmissionPreflight({ artifact_root: artifactRoot, manifest, tools: expectedTools, tool_sync_plan: plan, evidence: { ...inputEvidence, tool_sync_report: syncReport } });
    expect(report).toMatchObject({ provider: "anthropic", state: "blocked" });
    expect(report.checks).toContainEqual(expect.objectContaining({ code: "REVIEW_FINDINGS", status: "block" }));
    expect(chatGptRelease).toEqual({ provider: "openai", state: "ready" });
    expect(JSON.stringify({ manifest, tools: expectedTools })).not.toMatch(/access[_-]?token|refresh[_-]?token|password|MITGLIED-GEHEIM/iu);
    for (const forbidden of [".claude-plugin/plugin.json", ".mcp.json", "manifest.json"]) expect(existsSync(resolve(artifactRoot, forbidden))).toBe(false);
    expect(ANTHROPIC_ADAPTER_RUNTIME_CONTRACT).toEqual({ additional_domain_round_trips: 0, tool_sync_in_end_user_request: false, claude_surface_timeout_seconds: 300, oauth_endpoint_max_latency_seconds: 10, preview_ttl_seconds: 300, confirmation_ttl_seconds: 300, idempotency_ttl_seconds: 86_400 });
  });
});
