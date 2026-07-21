import { describe, expect, test } from "bun:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { RequestContext } from "@comvenio/connector-contracts";
import {
  createClubSelectionContext,
  type CapabilitySnapshot,
} from "../../../packages/auth/src/index.ts";
import {
  ToolCatalog,
  type OperationDefinition,
  type ToolCatalogSnapshot,
  type ToolDefinition,
} from "../../../packages/tool-catalog/src/index.ts";
import {
  ExactProviderHintResolver,
  HealthReadinessProbe,
  McpHttpServer,
  MemoryTelemetrySink,
  NullTelemetrySink,
  StatelessTransportContextFactory,
  railwayDeploymentConfig,
  runtimeError,
  validateRailwayDeploymentConfig,
  type AuthenticatedConnectorPrincipal,
  type McpRuntimeOptions,
} from "../src/http/index.ts";

const clubId = "33333333-3333-4333-8333-333333333333";
const otherClubId = "44444444-4444-4444-8444-444444444444";
const operation: OperationDefinition = {
  operation_id: "member.list",
  domain: "member",
  legacy_action_id: "cai.member.01.list",
  source_branch_locators: ["src/commands/member.ts:member.list"],
  shared_handler_ref: "@comvenio/tool-catalog/operations/member/list",
  route_trace_fixture_ref: "fixtures/member/list.route-trace.json",
  input_schema_ref: "schemas/member/list.input.json",
  output_schema_ref: "schemas/member/list.output.json",
  required_scopes: ["member.read.basic"],
  permission_policy: {
    all_of: ["view_members"],
    any_of: [],
    owner_or_self_allowed: false,
    department_scope: "optional",
    backend_audit_refs: ["audit.member.list"],
  },
  risk_class: "read",
  execution_mode: "inline",
  external_effect: "comvenio_private",
  idempotency: "read",
  confirmation: "none",
};
const tool: ToolDefinition = {
  tool_name: "cv_member_read_view_members_12345678",
  tool_group_key_sha256: "a".repeat(64),
  title: "Comvenio: Mitglieder anzeigen",
  description: "Zeigt berechtigte Mitgliedsdaten im ausgewählten Verein.",
  copy_fixture_ref: "copy/member.read.json",
  operation_ids: [operation.operation_id],
  required_scopes: ["member.read.basic"],
  risk_class: "read",
  execution_mode: "inline",
  idempotency: "read",
  confirmation: "none",
  permission_policy: structuredClone(operation.permission_policy),
  external_effect: "comvenio_private",
  input_schema_ref: "generated/tools/member.input.json",
  output_schema_ref: "generated/tools/member.output.json",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
const snapshot: ToolCatalogSnapshot = {
  contract_version: "1.0.0",
  source_hash_sha256: "b".repeat(64),
  operations: [operation],
  tools: [tool],
  cli_bindings: [{
    operation_id: operation.operation_id,
    command_expression: "member list",
    argument_mapper_ref: "bindings/member/list.args",
    renderer_ref: "bindings/member/list.renderer",
    compatibility_fixture_ref: "fixtures/member/list.cli.json",
  }],
  mcp_bindings: [{
    operation_id: operation.operation_id,
    tool_name: tool.tool_name,
    operation_discriminator: operation.operation_id,
    widget_resource_uri: "ui://comvenio/member-management",
  }],
};
const context: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "mcp",
  provider: "anthropic",
  subject_id: "22222222-2222-4222-8222-222222222222",
  oauth_grant_id: "55555555-5555-4555-8555-555555555555",
  club_id: clubId,
  department_id: null,
  scopes: ["member.read.basic"],
  capability_version: "A".repeat(43),
  locale: "de-DE",
  timezone: "Europe/Berlin",
};
const capabilitySnapshot: CapabilitySnapshot = {
  subject_id: context.subject_id!,
  member_id: "66666666-6666-4666-8666-666666666666",
  club_id: clubId,
  department_ids: [],
  permissions: { view_members: true },
  sources: [{
    permission_key: "view_members",
    allowed: true,
    scope: "club",
    department_id: null,
    assignment_type: "direct",
  }],
  capability_version: context.capability_version!,
  generated_at: new Date().toISOString(),
  observed_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

function visibilityContext(overrides: Partial<Parameters<ToolCatalog["listVisible"]>[0]> = {}) {
  return {
    context,
    capability_snapshot: capabilitySnapshot,
    provider_tool_updates: "dynamic" as const,
    ...overrides,
  };
}

describe("MCP catalog tenant isolation", () => {
  const catalog = new ToolCatalog(snapshot);

  test("hides private tools until scope, club and capability are present", () => {
    expect(catalog.listVisible({
      ...visibilityContext(),
      context: { ...context, club_id: null },
    })).toEqual([]);
    expect(catalog.listVisible(visibilityContext({
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    }))).toEqual([]);
    expect(catalog.listVisible({
      ...visibilityContext(),
      context: { ...context, scopes: [] },
    })).toEqual([]);
    expect(catalog.listVisible(visibilityContext())).toHaveLength(1);
  });

  test("denies cross-tenant and unknown calls before any handler can be resolved", () => {
    expect(() => catalog.resolveCall({
      tool_name: tool.tool_name,
      operation_id: operation.operation_id,
      club_id: otherClubId,
    }, visibilityContext())).toThrow("Verein stimmt nicht");
    expect(() => catalog.resolveCall({
      tool_name: "cv_unknown_read",
      operation_id: "unknown.read",
      club_id: clubId,
    }, visibilityContext())).toThrow("Tool wurde nicht gefunden");
  });

  test("requires an explicit club before private tool discovery for multi-club subjects", () => {
    expect(() => createClubSelectionContext({
      eligible_club_ids: [clubId, otherClubId],
      request_id: context.request_id,
    })).toThrow("Bitte wähle den Verein");
    expect(catalog.listVisible({
      ...visibilityContext(),
      context: { ...context, club_id: null },
    })).toEqual([]);
  });

  test("hides actions for a stable cached provider and rechecks cached calls", () => {
    const stable = visibilityContext({ provider_tool_updates: "stable_cached" });
    expect(catalog.listVisible(stable)).toEqual([]);
    expect(catalog.resolveCall({
      tool_name: tool.tool_name,
      operation_id: operation.operation_id,
      club_id: clubId,
    }, stable).authorization).toEqual({
      backend_recheck_required: true,
      capability_version: context.capability_version,
    });
    expect(() => catalog.resolveCall({
      tool_name: tool.tool_name,
      operation_id: operation.operation_id,
      club_id: clubId,
    }, visibilityContext({
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    }))).toThrow("nicht autorisiert");
  });
});

const runtimeSubjectId = "77777777-7777-4777-8777-777777777777";
const runtimeGrantId = "88888888-8888-4888-8888-888888888888";
const runtimeMemberId = "99999999-9999-4999-8999-999999999999";

function runtimePrincipal(token: string): AuthenticatedConnectorPrincipal {
  if (token === "token-invalid") {
    throw runtimeError({
      code: "AUTH_REQUIRED",
      message: "Der Bearer-Token ist ungültig oder abgelaufen.",
      request_id: context.request_id,
      retryable: false,
    });
  }
  return {
    subject_id: runtimeSubjectId,
    oauth_grant_id: runtimeGrantId,
    client_id: "https://provider.example/client.json",
    provider: token.endsWith("anthropic") ? "anthropic" : "openai",
    club_id: token.startsWith("token-other") ? otherClubId : clubId,
    scopes: ["club.read", "member.read.basic"],
    expires_at_epoch_seconds: Math.floor(Date.now() / 1_000) + 900,
  };
}

function runtimeCapability(club: string, requestSubject = runtimeSubjectId): CapabilitySnapshot {
  return {
    subject_id: requestSubject,
    member_id: runtimeMemberId,
    club_id: club,
    department_ids: [],
    permissions: { view_members: true },
    sources: [{
      permission_key: "view_members",
      allowed: true,
      scope: "club",
      department_id: null,
      assignment_type: "direct",
    }],
    capability_version: "C".repeat(43),
    generated_at: "2026-07-21T10:00:00.000Z",
    observed_at: "2026-07-21T10:00:00.000Z",
    expires_at: "2026-07-21T10:00:30.000Z",
  };
}

function runtimeOptions(overrides: Partial<McpRuntimeOptions> = {}): McpRuntimeOptions {
  return {
    environment: "development",
    allowed_hosts: ["127.0.0.1"],
    allowed_origins: [],
    authenticator: {
      async authenticate(input) {
        return runtimePrincipal(input.raw_token);
      },
    },
    provider_resolver: new ExactProviderHintResolver(),
    capability_resolver: {
      async resolve(input) {
        return runtimeCapability(input.context.club_id!, input.context.subject_id!);
      },
    },
    server_factory(contextInput) {
      const server = new McpServer({ name: "comvenio-runtime-test", version: "1.0.0" });
      server.registerTool("cv_runtime_context_read", {
        title: "Comvenio Runtime-Kontext prüfen",
        description: "Gibt ausschließlich den isolierten Testkontext zurück.",
        inputSchema: z.object({
          club_id: z.string().uuid(),
          member_marker: z.string().optional(),
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      }, async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            request_id: contextInput.request.request_id,
            club_id: contextInput.request.club_id,
            provider: contextInput.request.provider,
          }),
        }],
      }));
      return server;
    },
    readiness_dependencies: [
      { name: "catalog", required: true, async check() { return true; } },
      { name: "auth", required: true, async check() { return true; } },
      { name: "optional_upstream", required: false, async check() { return false; } },
    ],
    telemetry: new NullTelemetrySink(),
    ...overrides,
  };
}

async function postMcp(baseUrl: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      "X-Comvenio-Provider": token?.endsWith("anthropic") ? "anthropic" : "openai",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("Remote MCP runtime", () => {
  test("TC-01/TC-02: implements the five entities and handles initialize, list and call", async () => {
    const capabilityChecks: boolean[] = [];
    const server = new McpHttpServer(runtimeOptions({
      capability_resolver: {
        async resolve(input) {
          capabilityChecks.push(input.force_recheck);
          return runtimeCapability(input.context.club_id!, input.context.subject_id!);
        },
      },
    }));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const initialize = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "comvenio-contract-test", version: "1.0.0" },
        },
      });
      expect(initialize.status).toBe(200);
      expect((await initialize.json() as any).result.serverInfo.name).toBe("comvenio-runtime-test");

      const list = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }, "token-openai");
      expect(list.status).toBe(200);
      expect((await list.json() as any).result.tools.map((item: any) => item.name))
        .toEqual(["cv_runtime_context_read"]);

      const call = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "cv_runtime_context_read",
          arguments: { club_id: clubId },
        },
      }, "token-openai");
      expect(call.status).toBe(200);
      const result = await call.json() as any;
      expect(result.result.isError).not.toBe(true);
      expect(JSON.parse(result.result.content[0].text).club_id).toBe(clubId);
      expect(call.headers.get("mcp-session-id")).toBeNull();
      expect(capabilityChecks).toEqual([false, true]);
    } finally {
      expect(await server.drain()).toBe(true);
    }
  });

  test("TC-03: creates a fresh tenant context and denies a cross-tenant call", async () => {
    let sequence = 0;
    const factory = new StatelessTransportContextFactory({
      ...runtimeOptions(),
      request_id: () => sequence++ === 0
        ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    const first = await factory.create({
      authorization: "Bearer token-openai",
      provider_hint: "openai",
      body: { method: "tools/call", params: { arguments: { club_id: clubId } } },
    });
    const second = await factory.create({
      authorization: "Bearer token-other-openai",
      provider_hint: "openai",
      body: { method: "tools/call", params: { arguments: { club_id: otherClubId } } },
    });
    expect(first.request.club_id).toBe(clubId);
    expect(second.request.club_id).toBe(otherClubId);
    expect(first.request.request_id).not.toBe(second.request.request_id);
    expect(Object.keys(first.provider_request).sort()).toEqual([
      "authenticated",
      "protocol_version",
      "provider",
      "received_at",
      "request_id",
    ]);
    await expect(factory.create({
      authorization: "Bearer token-openai",
      provider_hint: "openai",
      body: { method: "tools/call", params: { arguments: { club_id: otherClubId } } },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  test("TC-04: liveness survives degradation while required readiness fails closed", async () => {
    const partiallyDegraded = new HealthReadinessProbe([
      { name: "catalog", required: true, async check() { return true; } },
      { name: "events", required: false, async check() { return false; } },
    ]);
    expect(partiallyDegraded.health()).toEqual({ status: "ok" });
    expect(await partiallyDegraded.readiness()).toEqual({ status: "ready" });

    const invalidCatalog = new HealthReadinessProbe([
      { name: "catalog", required: true, async check() { return false; } },
    ]);
    expect(invalidCatalog.health()).toEqual({ status: "ok" });
    expect(await invalidCatalog.readiness()).toEqual({ status: "not_ready" });
  });

  test("TC-05: keeps Railway domains, audiences and secret namespaces separated", () => {
    const development = railwayDeploymentConfig("development");
    const production = railwayDeploymentConfig("production");
    validateRailwayDeploymentConfig(development);
    validateRailwayDeploymentConfig(production);
    expect(development.domain).toBe("mcpdev.comvenio.app");
    expect(production.domain).toBe("mcp.comvenio.app");
    expect(development.audience).not.toBe(production.audience);
    expect(development.secret_namespace).not.toBe(production.secret_namespace);
    expect(development.required_secret_names.some((name) => name.startsWith("MCP_PROD_"))).toBe(false);
    expect(production.required_secret_names.some((name) => name.startsWith("MCP_DEV_"))).toBe(false);
  });

  test("TC-06: telemetry excludes tool arguments, member data and response content", async () => {
    const telemetry = new MemoryTelemetrySink();
    const server = new McpHttpServer(runtimeOptions({ telemetry }));
    const address = await server.listen(0, "127.0.0.1");
    try {
      const response = await postMcp(`http://127.0.0.1:${address.port}`, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "cv_runtime_context_read",
          arguments: {
            club_id: clubId,
            member_marker: "MITGLIED-GEHEIM",
          },
        },
      }, "token-openai");
      expect(response.status).toBe(200);
      await response.json();
      await Bun.sleep(10);
      const serialized = JSON.stringify(telemetry.list());
      expect(serialized).not.toContain("MITGLIED-GEHEIM");
      expect(serialized).not.toContain("token-openai");
      expect(serialized).not.toContain(clubId);
      expect(Object.keys(telemetry.list()[0] ?? {}).sort()).toEqual([
        "authenticated",
        "duration_ms",
        "method",
        "outcome",
        "provider",
        "recorded_at",
        "request_id",
        "route",
        "status_code",
      ]);
    } finally {
      expect(await server.drain()).toBe(true);
    }
  });

  test("rejects invalid bearer credentials without reflecting them", async () => {
    const server = new McpHttpServer(runtimeOptions());
    const address = await server.listen(0, "127.0.0.1");
    try {
      const response = await postMcp(`http://127.0.0.1:${address.port}`, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/list",
        params: {},
      }, "token-invalid");
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
      expect(await response.text()).not.toContain("token-invalid");
    } finally {
      expect(await server.drain()).toBe(true);
    }
  });
});
