import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type {
  JsonSchemaDocument,
  OperationDefinition,
  ToolCatalogSnapshot,
  ToolDefinition,
} from "@comvenio/tool-catalog";
import {
  CHAT_GPT_APP_MANIFEST_SCHEMA,
  OPENAI_ADAPTER_RUNTIME_CONTRACT,
  OPENAI_TOOL_TEST_PLAN_SCHEMA,
  OpenAiConnectorAdapter,
  assertOpenAiSubmissionReady,
  buildChatGptAppManifest,
  buildMarketplaceSubmissionBundle,
  buildOpenAiReviewerRunbook,
  buildOpenAiToolTestPlan,
  runOpenAiSubmissionPreflight,
  type ChatGptAppManifest,
  type OpenAiSubmissionEvidence,
  type OpenAiToolTestPlan,
} from "../../../integrations/openai/src/index.ts";
import { publishedRuntimeToolNames } from "../src/runtime-tools.ts";

const artifactRoot = resolve(import.meta.dir, "../../../integrations/openai");
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
    permission_policy: {
      all_of: input.publicRead ? [] : [input.permission],
      any_of: [],
      owner_or_self_allowed: false,
      department_scope: "forbidden",
      backend_audit_refs: [input.publicRead ? "audit.public.news.list" : "audit.member.list"],
    },
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

function evidence(manifest: ChatGptAppManifest, plan: OpenAiToolTestPlan): OpenAiSubmissionEvidence {
  return {
    organization_verified: true,
    app_permissions: ["api.apps.read", "api.apps.write"],
    project_data_residency: "global",
    public_mcp_endpoint_verified: true,
    oauth_pkce_verified: true,
    widget_csp_verified: true,
    legal_links_verified: true,
    tool_results: plan.cases.map((item) => ({
      tool_name: item.tool_name,
      prompt: item.prompt,
      expected_response_fixture: item.expected_response_fixture,
      passed_web: true,
      passed_mobile: true,
    })),
    reviewer_accounts: [
      { role: "member", login_ready: true, mfa_required: false, secret_reference: "submission-secret:/openai/member" },
      { role: "manager", login_ready: true, mfa_required: false, secret_reference: "submission-secret:/openai/manager" },
    ],
    widget_evidence: manifest.screenshots.map((item) => ({
      resource_uri: item.resource_uri,
      surfaces: ["web", "mobile"],
      screenshot_path: item.path,
      synthetic_data_only: true,
    })),
    global_residency_acceptance: { product_owner_signed: true, privacy_reviewer_signed: true },
  };
}

function pngDimensions(path: string): { width: number; height: number } {
  const image = readFileSync(path);
  expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

describe("OpenAI Marketplace provider package", () => {
  test("TC-01/TC-02: builds and validates the four separate K21 entities and ready bundle", () => {
    const adapter = new OpenAiConnectorAdapter();
    expect(adapter.validate({ catalog, schemas })).toEqual({ valid: true, tool_count: 2, catalog_source_hash_sha256: catalogHash });
    const manifest = buildChatGptAppManifest(catalogHash);
    const plan = buildOpenAiToolTestPlan(catalog);
    const runbook = buildOpenAiReviewerRunbook();
    const bundle = buildMarketplaceSubmissionBundle({ artifact_root: artifactRoot, catalog, schemas, evidence: evidence(manifest, plan) });
    expect([adapter, manifest, bundle, runbook]).toHaveLength(4);
    expect(bundle.preflight.state).toBe("ready");
    expect(() => assertOpenAiSubmissionReady(bundle.preflight)).not.toThrow();
  });

  test("TC-03: validates schemas, HTTPS links, real assets, screenshots and boundary failures", () => {
    const staticManifest = CHAT_GPT_APP_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(resolve(artifactRoot, "submission/app-profile.json"), "utf8")));
    const staticPlan = OPENAI_TOOL_TEST_PLAN_SCHEMA.parse(JSON.parse(readFileSync(resolve(artifactRoot, "submission/tool-test-plan.json"), "utf8")));
    expect(staticManifest.tool_catalog_version).toBe(staticPlan.catalog_source_hash_sha256);
    expect(staticPlan.cases).toHaveLength(
      publishedRuntimeToolNames("production", "full_connector_v1").length,
    );
    for (const url of [staticManifest.website_url, staticManifest.privacy_url, staticManifest.terms_url, staticManifest.imprint_url, staticManifest.mcp_endpoint]) {
      expect(new URL(url).protocol).toBe("https:");
    }
    const files = [staticManifest.assets.icon, staticManifest.assets.logo, ...staticManifest.screenshots.map((item) => item.path), ...staticPlan.cases.map((item) => `./${item.expected_response_fixture}`)];
    for (const file of files) expect(statSync(resolve(artifactRoot, file)).size).toBeGreaterThan(0);
    for (const item of staticManifest.screenshots) {
      const dimensions = pngDimensions(resolve(artifactRoot, item.path));
      expect(dimensions.width).toBeGreaterThanOrEqual(360);
      expect(dimensions.height).toBeGreaterThanOrEqual(250);
    }
    expect(() => new OpenAiConnectorAdapter().adapt({ catalog, schemas: new Map() })).toThrow("Schema fehlt");
    expect(() => new OpenAiConnectorAdapter().adapt({
      catalog: { ...catalog, mcp_bindings: [...catalog.mcp_bindings, { ...catalog.mcp_bindings[0]!, widget_resource_uri: "ui://comvenio/event-calendar" }] },
      schemas,
    })).toThrow("nicht mehrere Widget-Ressourcen");
    const manifest = buildChatGptAppManifest(catalogHash);
    const emptyPlan = buildOpenAiToolTestPlan({ ...catalog, tools: [], mcp_bindings: [] });
    const emptyReport = runOpenAiSubmissionPreflight({ artifact_root: artifactRoot, manifest, tools: [], tool_test_plan: emptyPlan, evidence: evidence(manifest, emptyPlan) });
    expect(emptyReport.checks).toContainEqual(expect.objectContaining({ code: "PUBLISHED_TOOLS", status: "block" }));
  });

  test("TC-04: maps public read to noauth, private tools to exact OAuth scopes and fails closed", () => {
    const before = structuredClone(catalog);
    const descriptors = new OpenAiConnectorAdapter().adapt({ catalog, schemas });
    expect(descriptors.map((item) => item.name)).toEqual([publicTool.tool_name, privateTool.tool_name]);
    expect(descriptors[0]).toMatchObject({ securitySchemes: [{ type: "noauth" }], _meta: { ui: { resourceUri: "ui://comvenio/news" } } });
    expect(descriptors[1]).toMatchObject({ securitySchemes: [{ type: "oauth2", scopes: ["club.read", "member.read.basic"] }], _meta: { ui: { resourceUri: "ui://comvenio/member-management" } } });
    expect(catalog).toEqual(before);

    const manifest = buildChatGptAppManifest(catalogHash);
    const plan = buildOpenAiToolTestPlan(catalog);
    const blockedEvidence = evidence(manifest, plan);
    blockedEvidence.project_data_residency = "eu";
    blockedEvidence.global_residency_acceptance = { product_owner_signed: false, privacy_reviewer_signed: false };
    blockedEvidence.reviewer_accounts[0]!.mfa_required = true;
    const report = runOpenAiSubmissionPreflight({ artifact_root: artifactRoot, manifest, tools: descriptors, tool_test_plan: plan, evidence: blockedEvidence });
    expect(report.state).toBe("blocked");
    expect(() => assertOpenAiSubmissionReady(report)).toThrow(/GLOBAL_PROJECT.*REVIEWER_ACCOUNTS.*PRIVACY_ACCEPTANCE/u);
  });

  test("TC-05: binds all five released widgets and requires Web plus Mobile evidence", () => {
    const manifest = buildChatGptAppManifest(catalogHash);
    expect(new Set(manifest.widget_resource_uris).size).toBe(5);
    expect(new Set(manifest.screenshots.map((item) => item.resource_uri))).toEqual(new Set(manifest.widget_resource_uris));
    const plan = buildOpenAiToolTestPlan(catalog);
    const incomplete = evidence(manifest, plan);
    incomplete.widget_evidence[0]!.surfaces = ["mobile"];
    const report = runOpenAiSubmissionPreflight({ artifact_root: artifactRoot, manifest, tools: new OpenAiConnectorAdapter().adapt({ catalog, schemas }), tool_test_plan: plan, evidence: incomplete });
    expect(report.checks).toContainEqual(expect.objectContaining({ code: "WIDGET_EVIDENCE", status: "block" }));
  });

  test("TC-06: contains only real distribution assets, no Codex substitute, no secrets and shared TTLs", () => {
    const manifest = buildChatGptAppManifest(catalogHash);
    expect(manifest.starter_prompts).toHaveLength(3);
    expect(manifest.starter_prompts.every((prompt) => prompt.length <= 128)).toBe(true);
    for (const forbidden of [".codex-plugin/plugin.json", ".mcp.json", ".app.json"]) expect(existsSync(resolve(artifactRoot, forbidden))).toBe(false);
    const serialized = JSON.stringify({ manifest, tools: new OpenAiConnectorAdapter().adapt({ catalog, schemas }), runbook: buildOpenAiReviewerRunbook() });
    expect(serialized).not.toMatch(/bearer\s|access[_-]?token|refresh[_-]?token|password|MITGLIED-GEHEIM/iu);
    expect(OPENAI_ADAPTER_RUNTIME_CONTRACT).toEqual({
      additional_domain_round_trips: 0,
      preview_ttl_seconds: 300,
      confirmation_ttl_seconds: 300,
      idempotency_ttl_seconds: 86_400,
    });
  });
});
