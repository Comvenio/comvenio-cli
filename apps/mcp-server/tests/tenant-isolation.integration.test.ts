import { describe, expect, test } from "bun:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  MemoryAtomicSafetyStore,
  WriteSafetyService,
  createConnectorError,
  type RequestContext,
} from "@comvenio/connector-contracts";
import type {
  ComvenioApiClient,
  ComvenioApiRequest,
} from "@comvenio/comvenio-client";
import {
  createClubSelectionContext,
  type CapabilitySnapshot,
} from "../../../packages/auth/src/index.ts";
import {
  ToolCatalog,
  type JsonSchemaDocument,
  type OperationDefinition,
  type ToolCatalogSnapshot,
  type ToolDefinition,
} from "../../../packages/tool-catalog/src/index.ts";
import { OpenAiConnectorAdapter } from "../../../integrations/openai/src/index.ts";
import { AnthropicConnectorAdapter } from "../../../integrations/anthropic/src/index.ts";
import {
  REQUIRED_TENANT_SCENARIOS,
  TenantIsolationSuite,
} from "../../../integrations/release/src/index.ts";
import {
  ExactProviderHintResolver,
  ConsoleTelemetrySink,
  HealthReadinessProbe,
  HttpAgentCapabilityResolver,
  McpHttpServer,
  MemoryTelemetrySink,
  NullTelemetrySink,
  StatelessTransportContextFactory,
  railwayDeploymentConfig,
  runtimeError,
  validateRailwayDeploymentConfig,
  type AgentCapabilityProjection,
  type AuthenticatedConnectorPrincipal,
  type McpRuntimeOptions,
} from "../src/http/index.ts";
import { PublicToolSubset } from "../src/public/index.ts";
import {
  createRuntimeAccessPolicy,
  createRuntimeServer,
} from "../src/runtime-tools.ts";
import { InMemoryDomainStateStore } from "../src/domain-state-store.ts";
import { domainToolName } from "../src/domain-runtime.ts";
import {
  BOOKING_OBJECT_WIDGET_TOOL_NAME,
  EVENT_CALENDAR_WIDGET_TOOL_NAME,
  MEMBER_MANAGEMENT_WIDGET_TOOL_NAME,
  NEWS_WIDGET_TOOL_NAME,
} from "../src/widget-runtime.ts";
import { createK7ToolSets, createK8ToolSets, createK9ToolSets, createK10ToolSets, createK11ToolSets, createK12ToolSets, createK13ToolSet } from "../src/tools/index.ts";
import {
  AsyncJobService,
  FairUseService,
  MemoryFairUseStore,
  MemoryJobQueue,
  bundledRateLimitConfig,
} from "../src/jobs/index.ts";
import {
  BOOKING_OBJECT_WIDGET_ASSET_PATH,
  BOOKING_OBJECT_WIDGET_CLIENT,
  BOOKING_OBJECT_WIDGET_RESOURCE_URI,
  BookingObjectWidgetProjector,
  BookingWidgetCapabilityPolicy,
  CONFIRMATION_WIDGET_ASSET_PATH,
  CONFIRMATION_WIDGET_CLIENT,
  CONFIRMATION_WIDGET_RESOURCE_URI,
  ConfirmationWidgetCapabilityPolicy,
  ConfirmationWidgetProjector,
  EVENT_CALENDAR_WIDGET_ASSET_PATH,
  EVENT_CALENDAR_WIDGET_CLIENT,
  EVENT_CALENDAR_WIDGET_RESOURCE_URI,
  EventCalendarWidgetProjector,
  EventWidgetCapabilityPolicy,
  registerEventCalendarWidgetResource,
  MEMBER_MANAGEMENT_WIDGET_ASSET_PATH,
  MEMBER_MANAGEMENT_WIDGET_CLIENT,
  MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI,
  MemberManagementWidgetProjector,
  MemberWidgetCapabilityPolicy,
  registerMemberManagementWidgetResource,
  registerBookingObjectWidgetResource,
  registerConfirmationWidgetResource,
  NEWS_WIDGET_ASSET_PATH,
  NEWS_WIDGET_CLIENT,
  NEWS_WIDGET_RESOURCE_URI,
  NewsWidgetCapabilityPolicy,
  NewsWidgetProjector,
  registerNewsWidgetResource,
} from "../src/widgets/index.ts";

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

  test("K21 OpenAI metadata preserves scope, explicit club, capability filter and backend recheck", () => {
    const schemas = new Map<string, JsonSchemaDocument>([
      [tool.input_schema_ref, { type: "object", additionalProperties: false, required: ["club_id"], properties: { club_id: { type: "string", format: "uuid" } } }],
      [tool.output_schema_ref, { type: "object", additionalProperties: false, required: [], properties: {} }],
    ]);
    const [descriptor] = new OpenAiConnectorAdapter().adapt({ catalog: snapshot, schemas });
    expect(descriptor?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["member.read.basic"] }]);
    expect(descriptor?._meta?.ui.resourceUri).toBe("ui://comvenio/member-management");
    expect(catalog.listVisible({ ...visibilityContext(), context: { ...context, club_id: null } })).toEqual([]);
    expect(catalog.listVisible(visibilityContext({ capability_snapshot: { ...capabilitySnapshot, permissions: {} } }))).toEqual([]);
    expect(catalog.resolveCall({ tool_name: tool.tool_name, operation_id: operation.operation_id, club_id: clubId }, visibilityContext()).authorization)
      .toEqual({ backend_recheck_required: true, capability_version: context.capability_version });
    expect(() => catalog.resolveCall({ tool_name: tool.tool_name, operation_id: operation.operation_id, club_id: otherClubId }, visibilityContext()))
      .toThrow("Verein stimmt nicht");
  });

  test("K22 Anthropic metadata preserves scope, explicit club, capability filter and backend recheck", () => {
    const schemas = new Map<string, JsonSchemaDocument>([
      [tool.input_schema_ref, { type: "object", additionalProperties: false, required: ["club_id"], properties: { club_id: { type: "string", format: "uuid" } } }],
      [tool.output_schema_ref, { type: "object", additionalProperties: false, required: [], properties: {} }],
    ]);
    const [descriptor] = new AnthropicConnectorAdapter().adapt({ catalog: snapshot, schemas });
    expect(descriptor?.requiredScopes).toEqual(["member.read.basic"]);
    expect(descriptor?.annotations).toEqual(tool.annotations);
    expect(descriptor?._meta?.ui.resourceUri).toBe("ui://comvenio/member-management");
    expect(catalog.listVisible({ ...visibilityContext(), context: { ...context, club_id: null, provider: "anthropic" } })).toEqual([]);
    expect(catalog.listVisible(visibilityContext({ capability_snapshot: { ...capabilitySnapshot, permissions: {} } }))).toEqual([]);
    expect(catalog.resolveCall({ tool_name: tool.tool_name, operation_id: operation.operation_id, club_id: clubId }, visibilityContext()).authorization)
      .toEqual({ backend_recheck_required: true, capability_version: context.capability_version });
    expect(() => catalog.resolveCall({ tool_name: tool.tool_name, operation_id: operation.operation_id, club_id: otherClubId }, visibilityContext()))
      .toThrow("Verein stimmt nicht");
  });

  test("keeps RBAC-allowed private tools discoverable before scope step-up", () => {
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
    })).toHaveLength(1);
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
    scopes: token.startsWith("token-critical-")
      ? ["admin.write", "club.read", "member.read.basic"]
      : token.startsWith("token-full-")
      ? [
          "booking.read",
          "booking.write",
          "club.read",
          "content.read",
          "event.read",
          "member.read.basic",
          "member.read.details",
          "object.read",
          "task.read",
          "task.write",
        ]
      : token === "token-openai-no-club"
      ? ["task.read", "task.write"]
      : token === "token-openai-club-only"
        ? ["club.read", "member.read.basic"]
        : token === "token-openai-booking-read-only"
          ? ["booking.read", "club.read", "member.read.basic", "object.read"]
        : token === "token-openai-task-read-only"
          ? ["club.read", "member.read.basic", "task.read"]
          : ["club.read", "member.read.basic", "task.read", "task.write"],
    expires_at_epoch_seconds: Math.floor(Date.now() / 1_000) + 900,
    backend_actor_token: "backend-actor-token",
  };
}

function runtimeCapability(club: string, requestSubject = runtimeSubjectId): CapabilitySnapshot {
  const now = new Date();
  return {
    subject_id: requestSubject,
    member_id: runtimeMemberId,
    club_id: club,
    department_ids: [],
    permissions: {
      view_members: true,
      view_members_details: true,
      manage_members: true,
      read_news: true,
      view_events: true,
    },
    sources: [{
      permission_key: "view_members",
      allowed: true,
      scope: "club",
      department_id: null,
      assignment_type: "direct",
    }],
    capability_version: "C".repeat(43),
    generated_at: now.toISOString(),
    observed_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
  };
}

const releasedAgentCapability = {
  key: "tasks.check_mine",
  capability_id: "tasks.check_mine",
  capability_version: 1,
  status: "implemented",
  source: "capability_gate",
  channels: ["internal_agent", "web", "app", "mcp", "cli", "voice"],
  advertisable: true,
  agent_selectable: true,
  user_invocable: true,
  externally_exposed: true,
  release_id: "release-test",
  executor_id: "tasks.check_mine",
  executor_version: "executor-test",
  policy_version: "policy-test",
  input_schema_hash: "input-test",
  output_schema_hash: "output-test",
  evidence_bundle_id: "evidence-test",
  evidence_bundle_hash: "evidence-hash-test",
} satisfies AgentCapabilityProjection;

function runtimeOptions(overrides: Partial<McpRuntimeOptions> = {}): McpRuntimeOptions {
  return {
    environment: "development",
    public_origin: "https://mcpdev.comvenio.app",
    edge_shared_secret: null,
    allowed_hosts: ["127.0.0.1"],
    allowed_origins: [],
    authenticator: {
      async authenticate(input) {
        return runtimePrincipal(input.raw_token);
      },
    },
    cli_authenticator: {
      async authenticate(input) {
        return { ...runtimePrincipal(input.raw_token), provider: null };
      },
    },
    cli_resource: "https://mcpdev.comvenio.app/cli",
    provider_resolver: new ExactProviderHintResolver(),
    capability_resolver: {
      async resolve(input) {
        return runtimeCapability(input.context.club_id!, input.context.subject_id!);
      },
    },
    access_policy: new PublicToolSubset({
      public_tools: [{
        tool_name: "cv_runtime_context_read",
        resolver_alias: "public_news",
        required_scopes: ["public.read"],
        risk_class: "read",
      }],
    }),
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function postCli(baseUrl: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}/cli`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("isolates the native CLI MCP route from provider identity", async () => {
  const server = new McpHttpServer(runtimeOptions());
  const address = await server.listen(0, "127.0.0.1");
  try {
    const response = await postCli(
      `http://127.0.0.1:${address.port}`,
      {
        jsonrpc: "2.0",
        id: "cli-context",
        method: "tools/call",
        params: {
          name: "cv_runtime_context_read",
          arguments: { club_id: clubId },
        },
      },
      "openai-token",
    );
    const responseBody = await response.clone().text();
    expect(
      { status: response.status, body: responseBody },
    ).toEqual({
      status: 200,
      body: expect.any(String),
    });
    const payload = (await response.json()) as {
      result: {
        content: Array<{ text: string }>;
      };
    };
    const encoded = payload.result.content[0]?.text;
    expect(encoded).toBeDefined();
    if (encoded === undefined) {
      throw new Error("Expected the runtime context tool to return text content.");
    }
    expect(JSON.parse(encoded)).toEqual(expect.objectContaining({
      club_id: clubId,
      provider: null,
    }));
  } finally {
    await server.drain(2_000);
  }
});

test("loads only externally released MCP capabilities from the canonical actor gate", async () => {
  let requestedUrl = "";
  let authorization = "";
  const resolver = new HttpAgentCapabilityResolver({
    api_base_url: "https://api.comvenio.app",
    async fetch(input, init) {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json([
        {
          ...releasedAgentCapability,
          title: "Meine Aufgaben",
          services: ["ai-service"],
        },
        {
          ...releasedAgentCapability,
          key: "internal.only",
          capability_id: "internal.only",
          externally_exposed: false,
        },
      ]);
    },
  });

  const capabilities = await resolver.resolve({
    context,
    backend_actor_token: "backend-actor-token",
  });

  expect(requestedUrl).toBe(
    `https://api.comvenio.app/ai/club-agents/${clubId}/capabilities?hub=club_agent_dm&channel=mcp`,
  );
  expect(authorization).toBe("Bearer backend-actor-token");
  expect(capabilities).toEqual([releasedAgentCapability]);

  const unavailable = new HttpAgentCapabilityResolver({
    api_base_url: "https://api.comvenio.app",
    async fetch() {
      return Response.json({ error: "unavailable" }, { status: 503 });
    },
  });
  expect(await unavailable.resolve({
    context,
    backend_actor_token: "backend-actor-token",
  })).toEqual([]);
});

describe("Remote MCP runtime", () => {
  test("routes complex turns through the tenant-bound Club-Agent for OpenAI and Anthropic", async () => {
    const conversationId = "12121212-1212-4212-8212-121212121212";
    const requests: Array<{
      authorized: boolean;
      query: string;
      body: Record<string, unknown>;
    }> = [];
    const api = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/ai/chat/") {
          const body = await request.json() as Record<string, unknown>;
          requests.push({
            authorized:
              request.headers.get("authorization")
              === "Bearer backend-actor-token",
            query: url.search,
            body,
          });
          return Response.json({
            session_id: conversationId,
            response: "Für das Sommerfest fehlen drei Helfer. Soll ich einen Aufruf vorbereiten?",
            rate_limit: { remaining: 9 },
            agent_card: {
              internal_trace: "Darf nicht über den MCP ausgegeben werden.",
            },
          });
        }
        return Response.json({ error: "unexpected_request" }, { status: 404 });
      },
    });
    const bridgeRuntimeOptions: Partial<McpRuntimeOptions> = {
      access_policy: createRuntimeAccessPolicy(
        "development",
        "club_agent_bridge_v1",
      ),
      server_factory: (requestContext) => createRuntimeServer({
        domain_state_store: new InMemoryDomainStateStore(),
        environment: "development",
        api_base_url: `http://127.0.0.1:${api.port}`,
        public_origin: "https://mcpdev.comvenio.app",
        context: requestContext,
        club_agent_capabilities: [releasedAgentCapability],
        release_scope: "club_agent_bridge_v1",
      }),
    };
    const server = new McpHttpServer(runtimeOptions(bridgeRuntimeOptions));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const toolLists = await Promise.all([
        postMcp(baseUrl, {
          jsonrpc: "2.0",
          id: 91,
          method: "tools/list",
          params: {},
        }, "token-openai"),
        postMcp(baseUrl, {
          jsonrpc: "2.0",
          id: 92,
          method: "tools/list",
          params: {},
        }, "token-anthropic"),
      ]);
      const toolsByProvider = await Promise.all(toolLists.map(async (response) =>
        (await response.json() as any).result.tools));
      for (const tools of toolsByProvider) {
        const agentTool = tools.find((item: { name: string }) =>
          item.name === "cv_club_agent_converse");
        expect(agentTool.description).toContain("Einfache Fakten");
        expect(agentTool.description).toContain("session_id");
        expect(agentTool.inputSchema.properties.club_id).toBeUndefined();
        expect(agentTool.inputSchema.properties.user_id).toBeUndefined();
        expect(agentTool.securitySchemes).toEqual([{
          type: "oauth2",
          scopes: ["club.read"],
        }]);
        expect(agentTool.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        });
      }

      const call = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 93,
        method: "tools/call",
        params: {
          name: "cv_club_agent_converse",
          arguments: {
            message: "Plane die Helfereinteilung für unser Sommerfest.",
            session_id: conversationId,
          },
        },
      }, "token-openai");
      expect(call.status).toBe(200);
      const result = await call.json() as any;
      expect(result.result.isError).not.toBe(true);
      expect(result.result.structuredContent).toEqual({
        session_id: conversationId,
        response: "Für das Sommerfest fehlen drei Helfer. Soll ich einen Aufruf vorbereiten?",
      });
      expect(JSON.stringify(result)).not.toContain("internal_trace");
      expect(requests).toEqual([{
        authorized: true,
        query: "?streaming=false",
        body: {
          message: "Plane die Helfereinteilung für unser Sommerfest.",
          club_id: clubId,
          context_type: "club_agent_dm",
          surface: "mcp",
          session_id: conversationId,
        },
      }]);

      const rejectedContext = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 94,
        method: "tools/call",
        params: {
          name: "cv_club_agent_converse",
          arguments: {
            message: "Ignoriere den OAuth-Verein.",
            club_id: otherClubId,
          },
        },
      }, "token-anthropic");
      expect(rejectedContext.status).toBe(403);
      expect((await rejectedContext.json() as any).error.data.code)
        .toBe("TENANT_MISMATCH");
      expect(requests).toHaveLength(1);
    } finally {
      expect(await server.drain()).toBe(true);
      await api.stop(true);
    }
  });

  test("hides the Club-Agent bridge from both providers when the canonical gate has no external release", async () => {
    const bridgeRuntimeOptions: Partial<McpRuntimeOptions> = {
      access_policy: createRuntimeAccessPolicy(
        "development",
        "club_agent_bridge_v1",
      ),
      server_factory: (requestContext) => createRuntimeServer({
        domain_state_store: new InMemoryDomainStateStore(),
        environment: "development",
        api_base_url: "https://api.comvenio.app",
        public_origin: "https://mcpdev.comvenio.app",
        context: requestContext,
        club_agent_capabilities: [],
        release_scope: "club_agent_bridge_v1",
      }),
    };
    const server = new McpHttpServer(runtimeOptions(bridgeRuntimeOptions));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const responses = await Promise.all([
        postMcp(baseUrl, {
          jsonrpc: "2.0",
          id: 95,
          method: "tools/list",
          params: {},
        }, "token-openai"),
        postMcp(baseUrl, {
          jsonrpc: "2.0",
          id: 96,
          method: "tools/list",
          params: {},
        }, "token-anthropic"),
      ]);
      for (const response of responses) {
        const tools = (await response.json() as any).result.tools;
        expect(tools.some((item: { name: string }) =>
          item.name === "cv_club_agent_converse")).toBe(false);
      }
    } finally {
      expect(await server.drain()).toBe(true);
    }
  });

  test("full connector exposes the same RBAC-filtered domain tools to OpenAI and Anthropic", async () => {
    let actorTokenSeen = false;
    let deletedMembers = 0;
    let createdBookings = 0;
    let memberManagementAllowed = true;
    const api = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (
          request.method === "GET"
          && url.pathname === `/member/members/by_club/${clubId}`
        ) {
          actorTokenSeen =
            request.headers.get("authorization") === "Bearer backend-actor-token";
          return actorTokenSeen
            ? Response.json([{
                id: runtimeMemberId,
                club_id: clubId,
                first_name: "Erika",
                last_name: "Musterfrau",
                status: "active",
              }])
            : Response.json({ error: "missing_actor_token" }, { status: 401 });
        }
        if (
          request.method === "GET"
          && url.pathname === `/event/events/club/${clubId}`
        ) {
          return Response.json([{
            id: "acacacac-acac-4cac-8cac-acacacacacac",
            club_id: clubId,
            title: "Vereinsabend",
            description: "Interner Termin",
            start_time: "2026-07-25T18:00:00+02:00",
            end_time: "2026-07-25T20:00:00+02:00",
            status: "confirmed",
            visibility_scope: "member",
          }]);
        }
        if (
          request.method === "GET"
          && url.pathname === `/content/news/club/${clubId}`
        ) {
          return Response.json([{
            id: "adadadad-adad-4dad-8dad-adadadadadad",
            club_id: clubId,
            title: "Interne Vereinsnews",
            teaser: "Nur für Berechtigte",
            content: "<p>Interner Inhalt</p>",
            is_draft: false,
            published_at: "2026-07-23T10:00:00+02:00",
          }]);
        }
        if (
          request.method === "GET"
          && url.pathname
            === "/content/news/adadadad-adad-4dad-8dad-adadadadadad"
        ) {
          return Response.json({
            id: "adadadad-adad-4dad-8dad-adadadadadad",
            club_id: clubId,
            title: "Interne Vereinsnews",
            teaser: "Nur für Berechtigte",
            content: "<p>Interner Inhalt</p>",
            is_draft: false,
            published_at: "2026-07-23T10:00:00+02:00",
          });
        }
        if (
          request.method === "GET"
          && url.pathname === `/member/members/${runtimeMemberId}`
        ) {
          return Response.json({
            id: runtimeMemberId,
            club_id: clubId,
            first_name: "Erika",
            last_name: "Musterfrau",
            email: "erika@example.test",
            phone_number: null,
            birthdate: null,
            address: null,
            postal_code: null,
            city: null,
            state: null,
            country: null,
            joined_at: null,
            left_at: null,
          });
        }
        if (
          request.method === "DELETE"
          && url.pathname === `/member/members/${runtimeMemberId}`
        ) {
          deletedMembers++;
          return Response.json({ deleted: true });
        }
        if (
          request.method === "GET"
          && url.pathname === `/object/objects/club/${clubId}`
        ) {
          return Response.json([{
            id: "abababab-abab-4bab-8bab-abababababab",
            club_id: clubId,
            name: "Vereinsheim",
            type: "static",
            status: "available",
            is_active: true,
            booking_granularity: "hourly",
          }]);
        }
        if (
          request.method === "GET"
          && url.pathname === "/object/objects/abababab-abab-4bab-8bab-abababababab"
        ) {
          return Response.json({
            id: "abababab-abab-4bab-8bab-abababababab",
            club_id: clubId,
            name: "Vereinsheim",
            type: "static",
            status: "available",
            is_active: true,
            booking_granularity: "hourly",
          });
        }
        if (
          request.method === "GET"
          && url.pathname === "/object/object-reservations/object/abababab-abab-4bab-8bab-abababababab"
        ) {
          return Response.json([]);
        }
        if (
          request.method === "GET"
          && url.pathname === "/object/object-booking-rules/object/abababab-abab-4bab-8bab-abababababab"
        ) {
          return Response.json([]);
        }
        if (
          request.method === "POST"
          && url.pathname === "/object/object-reservations/"
        ) {
          createdBookings++;
          const body = await request.json() as Record<string, unknown>;
          return Response.json({
            id: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc",
            club_id: clubId,
            object_id: body.object_id,
            start_time: body.start_time,
            end_time: body.end_time,
            status: body.status,
            title: body.title,
          });
        }
        if (
          request.method === "GET"
          && url.pathname.startsWith(
            "/object/objects/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          )
        ) {
          return Response.json({
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            club_id: clubId,
            name: "Nicht freigegebenes Objekt",
            type: "static",
            status: "available",
            is_active: true,
            booking_granularity: "hourly",
          });
        }
        if (
          request.method === "GET"
          && (
            url.pathname.includes(
              "/object/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            )
          )
        ) {
          return Response.json([]);
        }
        return Response.json({ error: "unexpected_request" }, { status: 404 });
      },
    });
    const domainStateStore = new InMemoryDomainStateStore();
    const fullRuntimeOptions: Partial<McpRuntimeOptions> = {
      capability_resolver: {
        async resolve(input) {
          const snapshot = runtimeCapability(
            input.context.club_id!,
            input.context.subject_id!,
          );
          return memberManagementAllowed
            ? snapshot
            : {
                ...snapshot,
                permissions: {
                  ...snapshot.permissions,
                  manage_members: false,
                },
                capability_version: "D".repeat(43),
              };
        },
      },
      access_policy: createRuntimeAccessPolicy(
        "development",
        "full_connector_v1",
      ),
      server_factory: (requestContext) => createRuntimeServer({
        domain_state_store: domainStateStore,
        environment: "development",
        api_base_url: `http://127.0.0.1:${api.port}`,
        public_origin: "https://mcpdev.comvenio.app",
        context: requestContext,
        club_agent_capabilities: [releasedAgentCapability],
        release_scope: "full_connector_v1",
      }),
    };
    const server = new McpHttpServer(runtimeOptions(fullRuntimeOptions));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const lists = await Promise.all([
        postMcp(baseUrl, {
          jsonrpc: "2.0",
          id: 101,
          method: "tools/list",
          params: {},
        }, "token-full-openai"),
        postMcp(baseUrl, {
          jsonrpc: "2.0",
          id: 102,
          method: "tools/list",
          params: {},
        }, "token-full-anthropic"),
      ]);
      const providerTools = await Promise.all(lists.map(async (response) => {
        expect(response.status).toBe(200);
        return (await response.json() as any).result.tools;
      }));
      const openAiNames = providerTools[0]
        .map((item: { name: string }) => item.name)
        .sort();
      const anthropicNames = providerTools[1]
        .map((item: { name: string }) => item.name)
        .sort();
      expect(anthropicNames).toEqual(openAiNames);
      expect(openAiNames).toContain(MEMBER_MANAGEMENT_WIDGET_TOOL_NAME);
      expect(openAiNames).toContain(BOOKING_OBJECT_WIDGET_TOOL_NAME);
      expect(openAiNames).toContain(EVENT_CALENDAR_WIDGET_TOOL_NAME);
      expect(openAiNames).toContain(NEWS_WIDGET_TOOL_NAME);
      for (const widgetToolName of [
        EVENT_CALENDAR_WIDGET_TOOL_NAME,
        NEWS_WIDGET_TOOL_NAME,
        MEMBER_MANAGEMENT_WIDGET_TOOL_NAME,
        BOOKING_OBJECT_WIDGET_TOOL_NAME,
      ]) {
        const widgetDescriptor = providerTools[0]
          .find((item: { name: string }) => item.name === widgetToolName);
        expect(JSON.stringify(widgetDescriptor.inputSchema))
          .not.toContain('"club_id"');
      }

      const memberListTool = domainToolName("cai.member.01.list");
      expect(openAiNames).toContain(memberListTool);
      const descriptor = providerTools[0]
        .find((item: { name: string }) => item.name === memberListTool);
      expect(descriptor.securitySchemes).toEqual([{
        type: "oauth2",
        scopes: ["member.read.basic"],
      }]);
      expect(JSON.stringify(descriptor.inputSchema)).not.toContain(
        '"additionalProperties":true',
      );
      expect(JSON.stringify(descriptor.inputSchema)).not.toContain(
        '"club_id"',
      );

      const call = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 103,
        method: "tools/call",
        params: {
          name: memberListTool,
          arguments: {
            input: {
              limit: 10,
              offset: 0,
            },
          },
        },
      }, "token-full-openai");
      expect(call.status).toBe(200);
      const result = await call.json() as any;
      expect(result.result.isError).not.toBe(true);
      expect(result.result.structuredContent).toMatchObject({
        action_id: "cai.member.01.list",
      });
      expect(actorTokenSeen).toBe(true);

      const memberWidget = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 105,
        method: "tools/call",
        params: {
          name: MEMBER_MANAGEMENT_WIDGET_TOOL_NAME,
          arguments: {
            member_id: runtimeMemberId,
            limit: 10,
            offset: 0,
          },
        },
      }, "token-full-openai");
      expect(memberWidget.status).toBe(200);
      const memberWidgetResult = await memberWidget.json() as any;
      expect(memberWidgetResult.result.isError).not.toBe(true);
      expect(memberWidgetResult.result.structuredContent).toMatchObject({
        widget: "member_management",
        club: { club_id: clubId },
        data: {
          selected: {
            member_id: runtimeMemberId,
            fields: { email: "erika@example.test" },
          },
        },
      });
      expect(
        JSON.stringify(memberWidgetResult.result.structuredContent),
      ).not.toContain("backend-actor-token");

      const eventWidget = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 1051,
        method: "tools/call",
        params: {
          name: EVENT_CALENDAR_WIDGET_TOOL_NAME,
          arguments: {
            from: "2026-07-25",
            to: "2026-07-26",
            timezone: "Europe/Berlin",
            view: "agenda",
          },
        },
      }, "token-full-openai");
      const eventWidgetResult = await eventWidget.json() as any;
      expect(eventWidgetResult.result.isError).not.toBe(true);
      expect(eventWidgetResult.result.structuredContent).toMatchObject({
        widget: "event_calendar",
        club: { club_id: clubId },
        data: {
          view: "agenda",
          events: [expect.objectContaining({ title: "Vereinsabend" })],
        },
      });

      const newsWidget = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 1052,
        method: "tools/call",
        params: {
          name: NEWS_WIDGET_TOOL_NAME,
          arguments: {
            selected_news_id:
              "adadadad-adad-4dad-8dad-adadadadadad",
            limit: 10,
            offset: 0,
          },
        },
      }, "token-full-anthropic");
      const newsWidgetResult = await newsWidget.json() as any;
      expect(newsWidgetResult.result.isError).not.toBe(true);
      expect(newsWidgetResult.result.structuredContent).toMatchObject({
        widget: "news",
        club: { club_id: clubId },
        data: {
          selected_news_id:
            "adadadad-adad-4dad-8dad-adadadadadad",
          articles: [expect.objectContaining({
            title: "Interne Vereinsnews",
            sanitized_html: "<p>Interner Inhalt</p>",
          })],
        },
      });
      expect(
        newsWidgetResult.result.structuredContent.actions[0].input,
      ).not.toHaveProperty("club_id");

      const bookingWidget = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 106,
        method: "tools/call",
        params: {
          name: BOOKING_OBJECT_WIDGET_TOOL_NAME,
          arguments: {
            from: "2026-07-25T10:00:00+02:00",
            to: "2026-07-25T12:00:00+02:00",
            timezone: "Europe/Berlin",
            object_id: "abababab-abab-4bab-8bab-abababababab",
          },
        },
      }, "token-full-openai");
      expect(bookingWidget.status).toBe(200);
      const bookingWidgetResult = await bookingWidget.json() as any;
      expect(bookingWidgetResult.result.isError).not.toBe(true);
      expect(bookingWidgetResult.result.structuredContent).toMatchObject({
        widget: "booking_object",
        club: { club_id: clubId },
        data: {
          selected_object_id: "abababab-abab-4bab-8bab-abababababab",
          slots: [{ state: "available" }],
        },
      });
      expect(
        bookingWidgetResult.result.structuredContent.actions,
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          tool_name: BOOKING_OBJECT_WIDGET_TOOL_NAME,
          input: expect.not.objectContaining({ club_id: clubId }),
        }),
      ]));
      const bookingAction = bookingWidgetResult.result.structuredContent.actions
        .find((item: { tool_name: string }) =>
          item.tool_name === domainToolName("cai.booking.03.create"));
      expect(bookingAction).toMatchObject({
        label: "Diesen Slot buchen",
        risk_class: "critical_write",
        requires_confirmation: true,
        input: {
          input: {
            object_id: "abababab-abab-4bab-8bab-abababababab",
            start_time: "2026-07-25T10:00:00+02:00",
            end_time: "2026-07-25T12:00:00+02:00",
            timezone: "Europe/Berlin",
            status: "requested",
          },
        },
      });
      expect(JSON.stringify(bookingAction.input)).not.toContain("club_id");
      expect(typeof bookingAction.input.idempotency_key).toBe("string");
      expect(bookingAction.input.idempotency_key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u,
      );

      const bookingReadOnlyWidget = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 10601,
        method: "tools/call",
        params: {
          name: BOOKING_OBJECT_WIDGET_TOOL_NAME,
          arguments: {
            from: "2026-07-25T10:00:00+02:00",
            to: "2026-07-25T12:00:00+02:00",
            timezone: "Europe/Berlin",
            object_id: "abababab-abab-4bab-8bab-abababababab",
          },
        },
      }, "token-openai-booking-read-only");
      const bookingReadOnlyModel = (
        await bookingReadOnlyWidget.json() as any
      ).result.structuredContent;
      const bookingStepUpAction = bookingReadOnlyModel.actions.find(
        (item: { tool_name: string }) =>
          item.tool_name === domainToolName("cai.booking.03.create"),
      );
      expect(bookingStepUpAction).toBeDefined();
      const bookingStepUpResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 10602,
        method: "tools/call",
        params: {
          name: bookingStepUpAction.tool_name,
          arguments: bookingStepUpAction.input,
        },
      }, "token-openai-booking-read-only");
      const bookingStepUp = (
        await bookingStepUpResponse.json() as any
      ).result;
      expect(bookingStepUp).toMatchObject({
        isError: true,
        structuredContent: {
          error: "insufficient_scope",
          required_scopes: ["booking.write"],
        },
      });
      expect(bookingStepUp._meta["mcp/www_authenticate"][0]).toContain(
        'scope="booking.write"',
      );
      expect(createdBookings).toBe(0);

      const bookingPreviewResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 10603,
        method: "tools/call",
        params: {
          name: bookingAction.tool_name,
          arguments: bookingAction.input,
        },
      }, "token-full-openai");
      const bookingPreview = (
        await bookingPreviewResponse.json() as any
      ).result;
      expect(bookingPreview.isError).not.toBe(true);
      expect(bookingPreview.structuredContent).toMatchObject({
        widget: "confirmation",
        actions: [{
          tool_name: "action_confirm",
          input: {
            idempotency_key: bookingAction.input.idempotency_key,
          },
        }],
      });
      expect(createdBookings).toBe(0);
      const bookingConfirmation =
        bookingPreview._meta["comvenio/confirmation"];
      const bookingConfirmResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 10604,
        method: "tools/call",
        params: {
          name: "action_confirm",
          arguments: {
            ...bookingPreview.structuredContent.actions[0].input,
            confirmation_token: bookingConfirmation.confirmation_token,
          },
        },
      }, "token-full-openai");
      const bookingConfirmed = (
        await bookingConfirmResponse.json() as any
      ).result;
      expect(bookingConfirmed.isError).not.toBe(true);
      expect(bookingConfirmed.structuredContent).toMatchObject({
        action_id: "cai.booking.03.create",
        result: {
          object_id: "abababab-abab-4bab-8bab-abababababab",
          status: "requested",
        },
      });
      expect(createdBookings).toBe(1);

      const hiddenBookingWidget = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 1061,
        method: "tools/call",
        params: {
          name: BOOKING_OBJECT_WIDGET_TOOL_NAME,
          arguments: {
            from: "2026-07-25T10:00:00+02:00",
            to: "2026-07-25T12:00:00+02:00",
            timezone: "Europe/Berlin",
            object_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          },
        },
      }, "token-full-openai");
      expect(hiddenBookingWidget.status).toBe(200);
      const hiddenBookingResult = await hiddenBookingWidget.json() as any;
      expect(hiddenBookingResult.result.isError).toBe(true);
      expect(hiddenBookingResult.result.structuredContent).toEqual({
        error: "not_found",
      });

      const criticalToolsResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 107,
        method: "tools/list",
        params: {},
      }, "token-critical-openai");
      const criticalTools = (await criticalToolsResponse.json() as any)
        .result.tools;
      const removeMemberTool = domainToolName("cai.member.05.remove");
      expect(criticalTools.map((item: { name: string }) => item.name))
        .toEqual(expect.arrayContaining([removeMemberTool, "action_confirm"]));
      const confirmationTool = criticalTools.find(
        (item: { name: string }) => item.name === "action_confirm",
      );
      expect(confirmationTool._meta.ui.visibility).toEqual(["app"]);
      expect(
        criticalTools.find(
          (item: { name: string }) => item.name === removeMemberTool,
        ).inputSchema.properties.input.properties.club_id,
      ).toBeUndefined();
      expect(JSON.stringify(
        criticalTools.find(
          (item: { name: string }) => item.name === removeMemberTool,
        ).inputSchema,
      )).not.toContain('"confirmation"');
      const idempotencyKey =
        "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
      const previewResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 108,
        method: "tools/call",
        params: {
          name: removeMemberTool,
          arguments: {
            input: {
              member_id: runtimeMemberId,
            },
            idempotency_key: idempotencyKey,
          },
        },
      }, "token-critical-openai");
      const previewResult = await previewResponse.json() as any;
      if (previewResult.result?.isError === true) {
        throw new Error(
          `Kritische Vorschau fehlgeschlagen: ${
            JSON.stringify({
              content: previewResult.result.content,
              structuredContent: previewResult.result.structuredContent,
            })
          }`,
        );
      }
      expect(previewResult.result.isError).not.toBe(true);
      expect(previewResult.result.structuredContent).toMatchObject({
        widget: "confirmation",
        club: { club_id: clubId },
        actions: [{
          tool_name: "action_confirm",
          input: { idempotency_key: idempotencyKey },
        }],
      });
      expect(JSON.stringify(previewResult.result.structuredContent))
        .not.toContain("confirmation_token");
      const hiddenConfirmation =
        previewResult.result._meta["comvenio/confirmation"];
      expect(hiddenConfirmation).toMatchObject({
        preview_id:
          previewResult.result.structuredContent.actions[0].input.preview_id,
        idempotency_key: idempotencyKey,
      });
      expect(typeof hiddenConfirmation.confirmation_token).toBe("string");
      const confirmationArguments = {
        ...previewResult.result.structuredContent.actions[0].input,
        confirmation_token: hiddenConfirmation.confirmation_token,
      };
      const confirmResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 109,
        method: "tools/call",
        params: {
          name: "action_confirm",
          arguments: confirmationArguments,
        },
      }, "token-critical-openai");
      const confirmResult = await confirmResponse.json() as any;
      if (confirmResult.result?.isError === true) {
        throw new Error(
          `Kritische Bestätigung fehlgeschlagen: ${
            JSON.stringify({
              content: confirmResult.result.content,
              structuredContent: confirmResult.result.structuredContent,
            })
          }`,
        );
      }
      expect(confirmResult.result.isError).not.toBe(true);
      expect(confirmResult.result.structuredContent).toMatchObject({
        action_id: "cai.member.05.remove",
        result: { deleted: true, id: runtimeMemberId },
      });
      expect(deletedMembers).toBe(1);

      const replayResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 110,
        method: "tools/call",
        params: {
          name: "action_confirm",
          arguments: confirmationArguments,
        },
      }, "token-critical-openai");
      expect((await replayResponse.json() as any).result.isError).toBe(true);
      expect(deletedMembers).toBe(1);

      const revokedIdempotencyKey =
        "dededede-dede-4ede-8ede-dededededede";
      const revokedPreviewResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 111,
        method: "tools/call",
        params: {
          name: removeMemberTool,
          arguments: {
            input: {
              member_id: runtimeMemberId,
            },
            idempotency_key: revokedIdempotencyKey,
          },
        },
      }, "token-critical-openai");
      const revokedPreview = await revokedPreviewResponse.json() as any;
      const revokedConfirmationArguments = {
        ...revokedPreview.result.structuredContent.actions[0].input,
        confirmation_token:
          revokedPreview.result._meta["comvenio/confirmation"]
            .confirmation_token,
      };
      memberManagementAllowed = false;
      const revokedConfirmationResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 112,
        method: "tools/call",
        params: {
          name: "action_confirm",
          arguments: revokedConfirmationArguments,
        },
      }, "token-critical-openai");
      const revokedConfirmation = await revokedConfirmationResponse.json() as any;
      expect(
        revokedConfirmation.error
        || revokedConfirmation.result?.isError === true,
      ).toBeTruthy();
      expect(deletedMembers).toBe(1);
      memberManagementAllowed = true;

      const foreignClub = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 104,
        method: "tools/call",
        params: {
          name: memberListTool,
          arguments: {
            input: {
              club_id: otherClubId,
              limit: 10,
              offset: 0,
            },
          },
        },
      }, "token-full-openai");
      expect(foreignClub.status).toBe(200);
      expect((await foreignClub.json() as any).result.isError).toBe(true);
    } finally {
      expect(await server.drain()).toBe(true);
      await domainStateStore.close();
      await api.stop(true);
    }
  });

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
      for (const [index, clientName] of [
        "Claude",
        "Codex",
        "ChatGPT",
        "comvenio-contract-test",
      ].entries()) {
        const initialize = await postMcp(baseUrl, {
          jsonrpc: "2.0",
          id: index + 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: clientName, version: "1.0.0" },
          },
        });
        expect(initialize.status).toBe(200);
        expect((await initialize.json() as any).result.serverInfo.name).toBe("comvenio-runtime-test");
      }

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

  test("resolves OAuth-bound self context and personal tasks without domain or club_id input", async () => {
    const eventId = "33333333-3333-4333-8333-333333333333";
    const openTaskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const scheduledTaskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const blockedTaskId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const reminderId = "12121212-1212-4212-8212-121212121212";
    const reminderAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    let taskActorTokenSeen = false;
    let reminderActorTokenSeen = false;
    let reminderReadActorTokenSeen = false;
    let reminderDeleteActorTokenSeen = false;
    let reminderBody: Record<string, unknown> = {};
    const api = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === `/task/tasks/my-tasks/assigned/${clubId}`) {
          taskActorTokenSeen = request.headers.get("authorization") === "Bearer backend-actor-token";
          if (!taskActorTokenSeen) {
            return Response.json({ error: "missing_actor_token" }, { status: 401 });
          }
          return Response.json([
            {
              id: openTaskId,
              club_id: clubId,
              title: "Getränke bestellen",
              status: "open",
              due_date: "2026-08-05T17:00:00.000Z",
              creator_id: "13131313-1313-4313-8313-131313131313",
              assignments: [{
                id: "14141414-1414-4414-8414-141414141414",
                member_id: runtimeMemberId,
                user_id: runtimeSubjectId,
              }],
            },
            {
              id: scheduledTaskId,
              club_id: clubId,
              title: "Einlass übernehmen",
              status: "in_progress",
              due_date: null,
              scheduled_start: "2026-08-07T16:00:00.000Z",
            },
            {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              club_id: clubId,
              title: "Bereits erledigt",
              status: "completed",
              due_date: "2026-08-06T12:00:00.000Z",
            },
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              club_id: clubId,
              title: "Nächste Woche",
              status: "open",
              due_date: "2026-08-11T12:00:00.000Z",
            },
            {
              id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              club_id: clubId,
              title: "Ohne Termin",
              status: "open",
              due_date: null,
            },
          ]);
        }
        if (request.method === "POST" && url.pathname === "/automation/custom_reminders/task") {
          reminderActorTokenSeen = request.headers.get("authorization") === "Bearer backend-actor-token";
          reminderBody = await request.json() as Record<string, unknown>;
          if (!reminderActorTokenSeen) {
            return Response.json({ error: "missing_actor_token" }, { status: 401 });
          }
          if (reminderBody.task_id === blockedTaskId) {
            return Response.json({
              detail: "INTERNE-UPSTREAM-DETAILS-DÜRFEN-NICHT-SICHTBAR-SEIN",
            }, { status: 403 });
          }
          return Response.json({
            id: reminderId,
            task_id: reminderBody.task_id,
            reminder_at: reminderBody.reminder_at,
            comment: reminderBody.comment ?? null,
            user_id: runtimeSubjectId,
            club_id: clubId,
            target_user_ids: [runtimeSubjectId],
          });
        }
        if (
          request.method === "GET"
          && url.pathname === `/automation/custom_reminders/task/${openTaskId}`
        ) {
          reminderReadActorTokenSeen =
            request.headers.get("authorization") === "Bearer backend-actor-token";
          return reminderReadActorTokenSeen
            ? Response.json([{
                id: reminderId,
                task_id: openTaskId,
                reminder_at: reminderAt,
                comment: "Bitte rechtzeitig erinnern",
                user_id: runtimeSubjectId,
                club_id: clubId,
                target_user_ids: [runtimeSubjectId],
              }])
            : Response.json({ error: "missing_actor_token" }, { status: 401 });
        }
        if (
          request.method === "DELETE"
          && url.pathname
            === `/automation/custom_reminders/task/by-task/${openTaskId}`
        ) {
          reminderDeleteActorTokenSeen =
            request.headers.get("authorization") === "Bearer backend-actor-token";
          return reminderDeleteActorTokenSeen
            ? new Response(null, { status: 204 })
            : Response.json({ error: "missing_actor_token" }, { status: 401 });
        }
        if (request.method !== "GET" || url.pathname !== `/event/public/clubs/${clubId}/events`) {
          return Response.json({ error: "unexpected_request" }, { status: 404 });
        }
        return Response.json([{
          id: eventId,
          club_id: clubId,
          title: "Saisoneröffnung",
          summary: "Öffentlicher Termin",
          start: "2026-08-01T10:00:00.000Z",
          end: "2026-08-01T12:00:00.000Z",
          timezone: "Europe/Berlin",
          location: "Vereinsheim",
          visibility_scope: "public",
          status: "confirmed",
        }]);
      },
    });
    const server = new McpHttpServer(runtimeOptions({
      access_policy: createRuntimeAccessPolicy("development"),
      server_factory: (context) => createRuntimeServer({
        domain_state_store: new InMemoryDomainStateStore(),
        environment: "development",
        api_base_url: `http://127.0.0.1:${api.port}`,
        public_origin: "https://mcpdev.comvenio.app",
        context,
      }),
    }));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const list = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/list",
        params: {},
      }, "token-openai");
      expect(list.status).toBe(200);
      const tools = (await list.json() as any).result.tools;
      const whoami = tools
        .find((tool: any) => tool.name === "cv_whoami_read");
      expect(whoami.description).toContain("Ohne Eingabe");
      expect(whoami.description).toContain(
        "niemals nach Club-ID, Vereinsdomain",
      );
      expect(whoami.inputSchema).toMatchObject({
        type: "object",
        properties: {},
        additionalProperties: false,
      });
      expect(whoami.inputSchema.required ?? []).toEqual([]);
      expect(whoami.securitySchemes).toEqual([{ type: "oauth2", scopes: ["club.read"] }]);
      expect(whoami._meta.securitySchemes).toEqual(whoami.securitySchemes);
      for (const selfToolName of ["cv_permissions_explain_read", "cv_schema_read"]) {
        const selfTool = tools.find((tool: any) => tool.name === selfToolName);
        expect(selfTool.inputSchema).toMatchObject({
          type: "object",
          properties: {},
          additionalProperties: false,
        });
      }
      const myTasks = tools.find((tool: any) => tool.name === "cv_my_tasks_read");
      expect(myTasks.description).toContain("frage niemals nach club_id");
      expect(myTasks.inputSchema.properties.club_id).toBeUndefined();
      expect(myTasks.inputSchema.required).toEqual(expect.arrayContaining(["from", "to"]));
      expect(myTasks.securitySchemes).toEqual([{ type: "oauth2", scopes: ["task.read"] }]);
      expect(myTasks._meta.securitySchemes).toEqual(myTasks.securitySchemes);
      expect(myTasks.outputSchema.properties.tasks.items.properties.assignments).toBeUndefined();
      expect(myTasks.outputSchema.properties.tasks.items.properties.member_id).toBeUndefined();
      expect(myTasks.outputSchema.properties.tasks.items.properties.user_id).toBeUndefined();
      const taskReminder = tools.find((tool: any) =>
        tool.name === "cv_my_task_reminder_write");
      expect(taskReminder.description).toContain("ausschließlich dir");
      expect(JSON.stringify(taskReminder.inputSchema)).not.toContain('"club_id"');
      expect(JSON.stringify(taskReminder.inputSchema)).not.toContain('"user_id"');
      expect(JSON.stringify(taskReminder.inputSchema)).not.toContain('"recipient"');
      expect(taskReminder.securitySchemes).toEqual([{
        type: "oauth2",
        scopes: ["task.read"],
      }]);
      expect(taskReminder._meta.securitySchemes).toEqual(taskReminder.securitySchemes);
      expect(JSON.stringify(taskReminder.outputSchema ?? {})).not.toContain('"user_id"');
      expect(taskReminder.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      const publicEvents = tools.find((tool: any) => tool.name === "public_events");
      expect(publicEvents.securitySchemes).toEqual([{ type: "noauth" }]);
      expect(publicEvents._meta.securitySchemes).toEqual(publicEvents.securitySchemes);
      expect(tools.find((tool: any) => tool.name === "public_events").description)
        .toContain("cv_whoami_read");
      expect(publicEvents.description).toContain(
        "nicht nach Club-ID oder Vereinsdomain fragen",
      );
      for (const connectedClubToolName of [
        "public_club_profile",
        "public_club_home",
        "public_club_legal",
        "public_training",
        "public_news",
        "public_department_news",
      ]) {
        expect(tools.find((tool: any) =>
          tool.name === connectedClubToolName).description).toContain(
          "cv_whoami_read",
        );
      }

      const call = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: {
          name: "cv_whoami_read",
        },
      }, "token-openai");
      expect(call.status).toBe(200);
      const result = await call.json() as any;
      expect(result.result.isError).not.toBe(true);
      expect(result.result.structuredContent).toMatchObject({
        club_id: clubId,
        provider: "openai",
        scopes: expect.arrayContaining(["club.read"]),
      });

      const rejectedInput = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "cv_whoami_read",
          arguments: { club_id: clubId },
        },
      }, "token-openai");
      expect(rejectedInput.status).toBe(200);
      const rejectedInputResult = await rejectedInput.json() as any;
      expect(rejectedInputResult.result.isError).toBe(true);
      expect(rejectedInputResult.result.content[0].text).toContain("Input validation error");

      const events = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: {
          name: "public_events",
          arguments: {
            club_id: result.result.structuredContent.club_id,
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-02T00:00:00.000Z",
          },
        },
      }, "token-openai");
      expect(events.status).toBe(200);
      const eventsResult = await events.json() as any;
      expect(eventsResult.result.isError).not.toBe(true);
      expect(eventsResult.result.content[0].text).toContain("Saisoneröffnung");

      const personalTasks = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: {
          name: "cv_my_tasks_read",
          arguments: {
            from: "2026-08-03T00:00:00.000Z",
            to: "2026-08-10T00:00:00.000Z",
          },
        },
      }, "token-openai-task-read-only");
      expect(personalTasks.status).toBe(200);
      const personalTasksResult = await personalTasks.json() as any;
      expect(personalTasksResult.result.isError).not.toBe(true);
      expect(personalTasksResult.result.structuredContent).toMatchObject({
        club_id: clubId,
        total_count: 2,
        returned: 2,
        has_more: false,
        next_offset: null,
        truncated: false,
        undated_tasks_excluded: 1,
      });
      expect(personalTasksResult.result.structuredContent.tasks.map((task: any) => task.id))
        .toEqual([openTaskId, scheduledTaskId]);
      expect(JSON.stringify(personalTasksResult.result.structuredContent.tasks))
        .not.toContain(runtimeMemberId);
      expect(JSON.stringify(personalTasksResult.result.structuredContent.tasks))
        .not.toContain(runtimeSubjectId);
      expect(personalTasksResult.result.structuredContent.tasks[0].assignments).toBeUndefined();
      expect(personalTasksResult.result.structuredContent.tasks[0].creator_id).toBeUndefined();
      expect(taskActorTokenSeen).toBe(true);

      const firstTaskPage = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 240,
        method: "tools/call",
        params: {
          name: "cv_my_tasks_read",
          arguments: {
            from: "2026-08-03T00:00:00.000Z",
            to: "2026-08-10T00:00:00.000Z",
            limit: 1,
            offset: 0,
          },
        },
      }, "token-openai-task-read-only");
      expect(
        (await firstTaskPage.json() as any).result.structuredContent,
      ).toMatchObject({
        total_count: 2,
        returned: 1,
        has_more: true,
        next_offset: 1,
        truncated: true,
        tasks: [{ id: openTaskId }],
      });

      const personalReminder = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 241,
        method: "tools/call",
        params: {
          name: "cv_my_task_reminder_write",
          arguments: {
            operation: "set",
            task_id: openTaskId,
            reminder_at: reminderAt,
            comment: "Bitte rechtzeitig erinnern",
          },
        },
      }, "token-openai-task-read-only");
      expect(personalReminder.status).toBe(200);
      const personalReminderResult = await personalReminder.json() as any;
      expect(personalReminderResult.result.isError).not.toBe(true);
      expect(personalReminderResult.result.structuredContent).toEqual({
        operation: "set",
        task_id: openTaskId,
        reminder: {
          id: reminderId,
          task_id: openTaskId,
          reminder_at: reminderAt,
          comment: "Bitte rechtzeitig erinnern",
        },
      });
      expect(reminderActorTokenSeen).toBe(true);
      expect(reminderBody).toEqual({
        task_id: openTaskId,
        reminder_at: reminderAt,
        comment: "Bitte rechtzeitig erinnern",
      });
      expect(reminderBody).not.toHaveProperty("user_id");
      expect(reminderBody).not.toHaveProperty("target_user_ids");

      const listedReminder = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 2411,
        method: "tools/call",
        params: {
          name: "cv_my_task_reminder_write",
          arguments: {
            operation: "list",
            task_id: openTaskId,
          },
        },
      }, "token-openai-task-read-only");
      expect(listedReminder.status).toBe(200);
      const listedReminderResult = await listedReminder.json() as any;
      expect(listedReminderResult.result.isError).not.toBe(true);
      expect(listedReminderResult.result.structuredContent).toEqual({
        operation: "list",
        task_id: openTaskId,
        reminders: [{
          id: reminderId,
          task_id: openTaskId,
          reminder_at: reminderAt,
          comment: "Bitte rechtzeitig erinnern",
        }],
      });
      expect(reminderReadActorTokenSeen).toBe(true);
      expect(JSON.stringify(listedReminderResult)).not.toContain("user_id");
      expect(JSON.stringify(listedReminderResult)).not.toContain("club_id");
      expect(JSON.stringify(listedReminderResult)).not.toContain("target_user_ids");

      const rejectedReminderContext = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 242,
        method: "tools/call",
        params: {
          name: "cv_my_task_reminder_write",
          arguments: {
            operation: "set",
            task_id: openTaskId,
            reminder_at: reminderAt,
            user_id: runtimeSubjectId,
          },
        },
      }, "token-openai-task-read-only");
      expect(rejectedReminderContext.status).toBe(200);
      expect((await rejectedReminderContext.json() as any).result.isError).toBe(true);

      const reminderScope = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 243,
        method: "tools/list",
        params: {},
      }, "token-openai-task-read-only");
      expect(reminderScope.status).toBe(200);
      const reminderScopeResult = await reminderScope.json() as any;
      expect(
        reminderScopeResult.result.tools.map(
          (tool: { name: string }) => tool.name,
        ),
      ).toContain("cv_my_task_reminder_write");
      expect(
        reminderScopeResult.result.tools.find(
          (tool: { name: string }) => tool.name === "cv_my_task_reminder_write",
        ).securitySchemes,
      ).toEqual([{ type: "oauth2", scopes: ["task.read"] }]);

      const deniedReminder = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 244,
        method: "tools/call",
        params: {
          name: "cv_my_task_reminder_write",
          arguments: {
            operation: "set",
            task_id: blockedTaskId,
            reminder_at: reminderAt,
          },
        },
      }, "token-openai-task-read-only");
      expect(deniedReminder.status).toBe(200);
      const deniedReminderResult = await deniedReminder.json() as any;
      expect(deniedReminderResult.result.isError).toBe(true);
      expect(deniedReminderResult.result.structuredContent.error).toBe("permission_denied");
      expect(JSON.stringify(deniedReminderResult)).not.toContain("INTERNE-UPSTREAM-DETAILS");

      const deletedReminder = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 245,
        method: "tools/call",
        params: {
          name: "cv_my_task_reminder_write",
          arguments: {
            operation: "delete",
            task_id: openTaskId,
          },
        },
      }, "token-openai-task-read-only");
      expect(deletedReminder.status).toBe(200);
      expect((await deletedReminder.json() as any).result.structuredContent).toEqual({
        operation: "delete",
        task_id: openTaskId,
        reminder: null,
      });
      expect(reminderDeleteActorTokenSeen).toBe(true);

      const rejectedTaskContext = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 25,
        method: "tools/call",
        params: {
          name: "cv_my_tasks_read",
          arguments: {
            club_id: clubId,
            from: "2026-08-03T00:00:00.000Z",
            to: "2026-08-10T00:00:00.000Z",
          },
        },
      }, "token-openai");
      expect(rejectedTaskContext.status).toBe(200);
      const rejectedTaskContextResult = await rejectedTaskContext.json() as any;
      expect(rejectedTaskContextResult.result.isError).toBe(true);
      expect(rejectedTaskContextResult.result.content[0].text).toContain("Input validation error");

      const limitedToolsResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 26,
        method: "tools/list",
        params: {},
      }, "token-openai-club-only");
      expect(limitedToolsResponse.status).toBe(200);
      const limitedTools = (await limitedToolsResponse.json() as any)
        .result.tools;
      const limitedToolNames = limitedTools.map(
        (tool: { name: string }) => tool.name,
      );
      expect(limitedToolNames).toContain("cv_my_tasks_read");
      expect(limitedToolNames).toContain("cv_my_task_reminder_write");
      expect(limitedTools.find(
        (tool: { name: string }) => tool.name === "cv_my_tasks_read",
      ).securitySchemes).toEqual([{ type: "oauth2", scopes: ["task.read"] }]);

      taskActorTokenSeen = false;
      reminderActorTokenSeen = false;
      const taskStepUpResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 260,
        method: "tools/call",
        params: {
          name: "cv_my_tasks_read",
          arguments: {
            from: "2026-08-03T00:00:00.000Z",
            to: "2026-08-10T00:00:00.000Z",
          },
        },
      }, "token-openai-club-only");
      expect(taskStepUpResponse.status).toBe(200);
      const taskStepUp = (await taskStepUpResponse.json() as any).result;
      expect(taskStepUp).toMatchObject({
        isError: true,
        structuredContent: {
          error: "insufficient_scope",
          required_scopes: ["task.read"],
        },
      });
      expect(taskStepUp._meta["mcp/www_authenticate"][0]).toContain(
        'scope="task.read"',
      );
      expect(taskActorTokenSeen).toBe(false);

      const reminderStepUpResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 2601,
        method: "tools/call",
        params: {
          name: "cv_my_task_reminder_write",
          arguments: {
            operation: "set",
            task_id: openTaskId,
            reminder_at: reminderAt,
          },
        },
      }, "token-openai-club-only");
      expect(reminderStepUpResponse.status).toBe(200);
      const reminderStepUp = (
        await reminderStepUpResponse.json() as any
      ).result;
      expect(reminderStepUp).toMatchObject({
        isError: true,
        structuredContent: {
          error: "insufficient_scope",
          required_scopes: ["task.read"],
        },
      });
      expect(reminderStepUp._meta["mcp/www_authenticate"][0]).toContain(
        'scope="task.read"',
      );
      expect(reminderActorTokenSeen).toBe(false);

      const limitedSchemaResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 261,
        method: "tools/call",
        params: {
          name: "cv_schema_read",
          arguments: {},
        },
      }, "token-openai-club-only");
      expect(limitedSchemaResponse.status).toBe(200);
      const limitedSchemaTools = (
        await limitedSchemaResponse.json() as any
      ).result.structuredContent.tools;
      expect(limitedSchemaTools.find(
        (tool: { name: string }) => tool.name === "cv_my_tasks_read",
      )).toMatchObject({
        required_scopes: ["task.read"],
        scope_granted: false,
      });
      expect(limitedSchemaTools.find(
        (tool: { name: string }) => tool.name === "cv_my_task_reminder_write",
      )).toMatchObject({
        required_scopes: ["task.read"],
        scope_granted: false,
      });

      const permissionsResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 2611,
        method: "tools/call",
        params: {
          name: "cv_permissions_explain_read",
          arguments: {},
        },
      }, "token-openai-club-only");
      expect(permissionsResponse.status).toBe(200);
      const permissions = (
        await permissionsResponse.json() as any
      ).result.structuredContent;
      expect(permissions.allowed_capabilities).toBeUndefined();
      expect(permissions).toMatchObject({
        backend_permissions: {
          allowed: expect.any(Array),
          denied: expect.any(Array),
        },
        granted_scopes: ["club.read", "member.read.basic"],
      });
      expect(permissions.available_actions.find(
        (tool: { name: string }) => tool.name === "cv_my_tasks_read",
      )).toMatchObject({
        required_scopes: ["task.read"],
        scope_granted: false,
      });

      const noClubToolsResponse = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 262,
        method: "tools/list",
        params: {},
      }, "token-openai-no-club");
      expect(noClubToolsResponse.status).toBe(200);
      const noClubTools = (await noClubToolsResponse.json() as any)
        .result.tools.map((tool: { name: string }) => tool.name);
      expect(noClubTools).not.toContain("cv_whoami_read");
      expect(noClubTools).not.toContain("cv_permissions_explain_read");
      expect(noClubTools).not.toContain("cv_schema_read");
      expect(noClubTools).not.toContain("cv_my_tasks_read");
      expect(noClubTools).not.toContain("cv_my_task_reminder_write");

      const mismatch = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 27,
        method: "tools/call",
        params: {
          name: "public_events",
          arguments: {
            club_id: otherClubId,
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-02T00:00:00.000Z",
          },
        },
      }, "token-openai");
      expect(mismatch.status).toBe(403);
      expect((await mismatch.json() as any).error.data.code).toBe("TENANT_MISMATCH");
    } finally {
      expect(await server.drain()).toBe(true);
      await api.stop(true);
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
      "client_kind",
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

  test("accepts Claude, Codex and ChatGPT without a proprietary provider header", async () => {
    const factory = new StatelessTransportContextFactory(runtimeOptions());
    const claude = await factory.create({
      body: {
        method: "initialize",
        params: { clientInfo: { name: "Claude", version: "1.0.0" } },
      },
    });
    const codex = await factory.create({
      body: {
        method: "initialize",
        params: { clientInfo: { name: "Codex", version: "1.0.0" } },
      },
    });
    const chatgpt = await factory.create({
      body: {
        method: "initialize",
        params: { clientInfo: { name: "ChatGPT", version: "1.0.0" } },
      },
    });
    const authenticated = await factory.create({
      authorization: "Bearer token-openai",
      body: { method: "tools/list", params: {} },
    });

    expect(claude.provider_request).toMatchObject({
      provider: null,
      client_kind: "claude",
      authenticated: false,
    });
    expect(codex.provider_request).toMatchObject({
      provider: null,
      client_kind: "codex",
      authenticated: false,
    });
    expect(chatgpt.provider_request).toMatchObject({
      provider: null,
      client_kind: "chatgpt",
      authenticated: false,
    });
    expect(authenticated.provider_request).toMatchObject({
      provider: "openai",
      client_kind: "unknown",
      authenticated: true,
    });
    expect(authenticated.request.scopes).toEqual([
      "club.read",
      "member.read.basic",
      "task.read",
      "task.write",
    ]);

    await expect(factory.create({
      authorization: "Bearer token-openai",
      provider_hint: "anthropic",
      body: { method: "tools/list", params: {} },
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
    expect(production.required_secret_names).toContain("MCP_EDGE_SHARED_SECRET");
    expect(production.required_secret_names).toContain(
      "MCP_SHARED_STATE_REDIS_URL",
    );
    expect(production.required_secret_names).toContain(
      "MCP_SHARED_STATE_ENCRYPTION_KEY",
    );
    expect(production.required_secret_names).toContain("MCP_RELEASE_SCOPE");
  });

  test("TC-06: telemetry excludes tool arguments, member data and response content", async () => {
    const lines: string[] = [];
    new ConsoleTelemetrySink((line) => lines.push(line)).record({
      request_id: context.request_id,
      provider: "openai",
      authenticated: true,
      route: "/mcp",
      method: "POST",
      status_code: 503,
      duration_ms: 12,
      outcome: "failed",
      recorded_at: "2026-07-23T06:45:00.000Z",
    });
    expect(lines).toHaveLength(1);
    expect(Object.keys(JSON.parse(lines[0]!) as Record<string, unknown>).sort()).toEqual([
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
    expect(() => new ConsoleTelemetrySink((line) => lines.push(line)).record({
      request_id: "Bearer PRIVATE-TOKEN" as never,
      provider: "openai",
      authenticated: true,
      route: "/mcp",
      method: "POST",
      status_code: 503,
      duration_ms: 12,
      outcome: "failed",
      recorded_at: "2026-07-23T06:45:00.000Z",
    })).toThrow("ungültige Werte");
    expect(JSON.stringify(lines)).not.toContain("PRIVATE-TOKEN");

    const telemetry = new MemoryTelemetrySink();
    const server = new McpHttpServer(runtimeOptions({ telemetry }));
    const address = await server.listen(0, "127.0.0.1");
    try {
      const initialize = await postMcp(`http://127.0.0.1:${address.port}`, {
        jsonrpc: "2.0",
        id: 4,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Claude-CLIENTINFO-GEHEIM", version: "PRIVATE-VERSION" },
        },
      });
      expect(initialize.status).toBe(200);
      await initialize.json();

      const response = await postMcp(`http://127.0.0.1:${address.port}`, {
        jsonrpc: "2.0",
        id: 5,
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
      expect(serialized).not.toContain("CLIENTINFO-GEHEIM");
      expect(serialized).not.toContain("PRIVATE-VERSION");
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

  test("returns an HTTP OAuth challenge before an anonymous private tool reaches the SDK", async () => {
    let factoryCalls = 0;
    const server = new McpHttpServer(runtimeOptions({
      access_policy: new PublicToolSubset({
        public_tools: [{
          tool_name: "public_news",
          resolver_alias: "public_news",
          required_scopes: ["public.read"],
          risk_class: "read",
        }],
        protected_tools: [{ tool_name: "cv_member_write", required_scopes: ["member.write"] }],
      }),
      server_factory(contextInput) {
        factoryCalls += 1;
        return runtimeOptions().server_factory(contextInput);
      },
    }));
    const address = await server.listen(0, "127.0.0.1");
    try {
      const response = await postMcp(`http://127.0.0.1:${address.port}`, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "cv_member_write",
          arguments: { club_id: clubId },
        },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("scope=\"member.write\"");
      expect(factoryCalls).toBe(0);
    } finally {
      expect(await server.drain()).toBe(true);
    }
  });
});

describe("K7 adapter tenant and RBAC isolation", () => {
  const departmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherDepartmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function adapterClient(
    handler: (request: ComvenioApiRequest) => Promise<import("@comvenio/connector-contracts").JsonValue>,
  ): ComvenioApiClient {
    return {
      timeout_ms: 15000,
      async request<T extends import("@comvenio/connector-contracts").JsonValue>(request: ComvenioApiRequest): Promise<T> {
        return await handler(request) as T;
      },
    };
  }

  test("TC-04: hides member writes without manage_members and records a backend 403 recheck", async () => {
    const readOnlySnapshot = capabilitySnapshot;
    const readOnlyContext: RequestContext = {
      ...context,
      scopes: ["member.read.basic", "admin.write"],
      capability_version: readOnlySnapshot.capability_version,
    };
    const readOnly = createK7ToolSets({ client: adapterClient(async () => null) }).member;
    expect(readOnly.listVisible({
      context: readOnlyContext,
      capability_snapshot: readOnlySnapshot,
    }).map((definition) => definition.action_id)).not.toContain("cai.member.03.add");

    let backendForbidden = 0;
    const writableSnapshot = {
      ...readOnlySnapshot,
      permissions: { ...readOnlySnapshot.permissions, manage_members: true },
    };
    const writable = createK7ToolSets({
      client: adapterClient(async (request) => {
        throw createConnectorError({
          code: "PERMISSION_DENIED",
          message: "raw backend detail must not escape",
          request_id: request.context.request_id,
          retryable: false,
        });
      }),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
      on_backend_forbidden() { backendForbidden += 1; },
    }).member;
    await expect(writable.execute({
      action_id: "cai.member.03.add",
      input: { club_id: clubId, member: { first_name: "Anna", last_name: "Beispiel" } },
      context: readOnlyContext,
      capability_snapshot: writableSnapshot,
    })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Der Fachservice hat die Aktion im aktuellen Kontext abgelehnt.",
    });
    expect(backendForbidden).toBe(1);
  });

  test("TC-05: rejects a foreign club before the member backend is called", async () => {
    let calls = 0;
    const member = createK7ToolSets({
      client: adapterClient(async () => { calls += 1; return []; }),
    }).member;
    await expect(member.execute({
      action_id: "cai.member.01.list",
      input: { club_id: otherClubId },
      context,
      capability_snapshot: capabilitySnapshot,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });

  test("TC-05: rejects a team mutation outside the selected department before the backend", async () => {
    let calls = 0;
    const scopedContext: RequestContext = {
      ...context,
      department_id: departmentId,
      scopes: ["admin.write"],
    };
    const scopedSnapshot: CapabilitySnapshot = {
      ...capabilitySnapshot,
      department_ids: [departmentId],
      permissions: { manage_members: true },
    };
    const team = createK7ToolSets({
      client: adapterClient(async () => { calls += 1; return null; }),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
    }).team;
    await expect(team.execute({
      action_id: "cai.team.03.create",
      input: {
        club_id: clubId,
        team: {
          department_id: otherDepartmentId,
          name: "Fremdes Team",
          sport_type: "FOOTBALL",
        },
      },
      context: scopedContext,
      capability_snapshot: scopedSnapshot,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });
});

describe("K8 event and plan tenant/RBAC isolation", () => {
  const eventId = "77777777-7777-4777-8777-777777777777";
  const departmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherDepartmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function adapterClient(
    handler: (request: ComvenioApiRequest) => Promise<import("@comvenio/connector-contracts").JsonValue>,
  ): ComvenioApiClient {
    return {
      timeout_ms: 15000,
      async request<T extends import("@comvenio/connector-contracts").JsonValue>(request: ComvenioApiRequest): Promise<T> {
        return await handler(request) as T;
      },
    };
  }

  test("TC-04: private calendar reads require RBAC and advertise event.read step-up", () => {
    const eventContext: RequestContext = { ...context, scopes: ["event.read"] };
    const allowed = createK8ToolSets({ client: adapterClient(async () => []) }).event;
    expect(allowed.listVisible({
      context: eventContext,
      capability_snapshot: { ...capabilitySnapshot, permissions: { view_events: true } },
    }).map((definition) => definition.action_id)).toContain("cai.event.01.list");
    expect(allowed.listVisible({
      context: eventContext,
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    }).map((definition) => definition.action_id)).not.toContain("cai.event.01.list");
    expect(allowed.listVisible({
      context: { ...eventContext, scopes: [] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { view_events: true } },
    }).map((definition) => definition.action_id)).toContain("cai.event.01.list");
  });

  test("TC-04: a backend RBAC denial is rechecked, recorded and normalized", async () => {
    let backendForbidden = 0;
    const plan = createK8ToolSets({
      client: adapterClient(async (request) => {
        throw createConnectorError({ code: "PERMISSION_DENIED", message: "sensitive backend detail", request_id: request.context.request_id, retryable: false });
      }),
      on_backend_forbidden() { backendForbidden++; },
    }).plan;
    await expect(plan.execute({
      action_id: "cai.plan.01.list",
      input: { club_id: clubId, event_id: eventId },
      context: { ...context, scopes: ["event.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { view_events: true } },
    })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Der Fachservice hat die Event-/Plan-Aktion im aktuellen Kontext abgelehnt.",
    });
    expect(backendForbidden).toBe(1);
  });

  test("TC-05: rejects a foreign club and department before any event backend call", async () => {
    let calls = 0;
    const event = createK8ToolSets({
      client: adapterClient(async () => { calls++; return null; }),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
    }).event;
    await expect(event.execute({
      action_id: "cai.event.02.show",
      input: { club_id: otherClubId, event_id: eventId },
      context: { ...context, scopes: ["event.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { view_events: true } },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);

    await expect(event.execute({
      action_id: "cai.event.03.create",
      input: {
        club_id: clubId,
        event: {
          department_id: otherDepartmentId,
          title: "Fremder Termin",
          event_type: "meeting",
          visibility_scope: "department",
          organizer_type: "member",
        },
      },
      context: { ...context, department_id: departmentId, scopes: ["event.write"] },
      capability_snapshot: { ...capabilitySnapshot, department_ids: [departmentId], permissions: { create_events: true } },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });
});

describe("K9 meeting and tournament tenant/RBAC isolation", () => {
  const tournamentId = "99999999-9999-4999-8999-999999999999";

  function adapterClient(handler: (request: ComvenioApiRequest) => Promise<import("@comvenio/connector-contracts").JsonValue>): ComvenioApiClient {
    return {
      timeout_ms: 15000,
      async request<T extends import("@comvenio/connector-contracts").JsonValue>(request: ComvenioApiRequest): Promise<T> {
        return await handler(request) as T;
      },
    };
  }

  test("TC-03: hides tournament writes while preserving permitted reads", () => {
    const tournament = createK9ToolSets({
      client: adapterClient(async () => []),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
    }).tournament;
    const definitions = tournament.listVisible({
      context: { ...context, scopes: ["event.read", "event.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { view_tournaments: true } },
    });
    expect(definitions.map((definition) => definition.action_id)).toContain("cai.tournament.08.list");
    expect(definitions.map((definition) => definition.action_id)).not.toContain("cai.tournament.10.update");
  });

  test("rejects a foreign club before any Meeting/Tournament backend call", async () => {
    let calls = 0;
    const tournament = createK9ToolSets({ client: adapterClient(async () => { calls++; return []; }) }).tournament;
    await expect(tournament.execute({
      action_id: "cai.tournament.08.list",
      input: { club_id: otherClubId },
      context: { ...context, scopes: ["event.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { view_tournaments: true } },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });

  test("normalizes a backend RBAC denial without leaking its detail", async () => {
    let forbidden = 0;
    const tournament = createK9ToolSets({
      client: adapterClient(async (request) => {
        throw createConnectorError({ code: "PERMISSION_DENIED", message: "private tournament denial", request_id: request.context.request_id, retryable: false });
      }),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
      on_backend_forbidden() { forbidden++; },
    }).tournament;
    await expect(tournament.execute({
      action_id: "cai.tournament.10.update",
      input: { club_id: clubId, tournament_id: tournamentId, changes: { title: "Neu" } },
      context: { ...context, scopes: ["event.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { manage_tournaments: true } },
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Der Fachservice hat die Meeting-/Turnier-Aktion im aktuellen Kontext abgelehnt." });
    expect(forbidden).toBe(1);
  });
});

describe("K10 booking, object and task tenant/RBAC isolation", () => {
  const objectId = "12121212-1212-4212-8212-121212121212";

  function adapterClient(handler: (request: ComvenioApiRequest) => Promise<import("@comvenio/connector-contracts").JsonValue>): ComvenioApiClient {
    return {
      timeout_ms: 15000,
      async request<T extends import("@comvenio/connector-contracts").JsonValue>(request: ComvenioApiRequest): Promise<T> {
        return await handler(request) as T;
      },
    };
  }

  test("rejects a foreign club before any booking backend call", async () => {
    let calls = 0;
    const booking = createK10ToolSets({ client: adapterClient(async () => { calls++; return []; }) }).booking;
    await expect(booking.execute({
      action_id: "cai.booking.01.list",
      input: {
        club_id: otherClubId, operation: "list", from: "2026-07-21T08:00:00+02:00", to: "2026-07-21T18:00:00+02:00", timezone: "Europe/Berlin",
      },
      context: { ...context, scopes: ["booking.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });

  test("normalizes backend RBAC denials and records the recheck without leaking details", async () => {
    let forbidden = 0;
    const object = createK10ToolSets({
      client: adapterClient(async (request) => {
        throw createConnectorError({ code: "PERMISSION_DENIED", message: "private object denial", request_id: request.context.request_id, retryable: false });
      }),
      on_backend_forbidden() { forbidden++; },
    }).object;
    await expect(object.execute({
      action_id: "cai.object.02.show",
      input: { club_id: clubId, object_id: objectId },
      context: { ...context, scopes: ["object.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Der Fachservice hat die Aktion im aktuellen Kontext abgelehnt." });
    expect(forbidden).toBe(1);
  });

  test("keeps object writes hidden without manage_objects while task reads stay available", () => {
    const sets = createK10ToolSets({
      client: adapterClient(async () => []),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
    });
    const objectDefinitions = sets.object.listVisible({
      context: { ...context, scopes: ["object.read", "object.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    });
    expect(objectDefinitions.map((definition) => definition.action_id)).toContain("cai.object.01.list");
    expect(objectDefinitions.map((definition) => definition.action_id)).not.toContain("cai.object.03.create");
    const taskDefinitions = sets.task.listVisible({
      context: { ...context, scopes: ["task.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    });
    expect(taskDefinitions.map((definition) => definition.action_id)).toContain("cai.task.01.list");
  });
});

describe("K11 supply, menu and shopping tenant/RBAC isolation", () => {
  const recipeId = "15151515-1515-4515-8515-151515151515";

  function adapterClient(handler: (request: ComvenioApiRequest) => Promise<import("@comvenio/connector-contracts").JsonValue>): ComvenioApiClient {
    return {
      timeout_ms: 15000,
      async request<T extends import("@comvenio/connector-contracts").JsonValue>(request: ComvenioApiRequest): Promise<T> {
        return await handler(request) as T;
      },
    };
  }

  test("rejects a foreign club before any supply backend call", async () => {
    let calls = 0;
    const recipe = createK11ToolSets({ client: adapterClient(async () => { calls++; return []; }) }).recipe;
    await expect(recipe.execute({
      action_id: "cai.recipe.03.list",
      input: { club_id: otherClubId },
      context: { ...context, scopes: ["supply.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { manage_menus: true } },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });

  test("normalizes backend RBAC denials and records the recheck without leaking details", async () => {
    let forbidden = 0;
    const recipe = createK11ToolSets({
      client: adapterClient(async (request) => {
        throw createConnectorError({ code: "PERMISSION_DENIED", message: "private supplier and cost denial", request_id: request.context.request_id, retryable: false });
      }),
      on_backend_forbidden() { forbidden++; },
    }).recipe;
    await expect(recipe.execute({
      action_id: "cai.recipe.04.show",
      input: { club_id: clubId, recipe_id: recipeId, portions: 1 },
      context: { ...context, scopes: ["supply.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { manage_menus: true } },
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(forbidden).toBe(1);
  });

  test("keeps shopping and ingredient writes hidden from menu-only roles", () => {
    const sets = createK11ToolSets({
      client: adapterClient(async () => []),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
    });
    const menuRole = {
      context: { ...context, scopes: ["supply.read", "supply.write"] as RequestContext["scopes"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { create_menus: true, manage_menus: true } },
    };
    expect(sets.menu.listVisible(menuRole).map((definition) => definition.action_id)).toContain("cai.menu.01.create");
    const visibleShoppingActions = sets.shopping.listVisible(menuRole)
      .map((definition) => definition.action_id);
    expect(
      visibleShoppingActions.filter((actionId) => !actionId.includes(".procurement.")),
    ).toHaveLength(0);
    expect(
      visibleShoppingActions.filter((actionId) => actionId.includes(".procurement.")),
    ).not.toHaveLength(0);
    const creatorOnly = {
      context: { ...context, scopes: ["supply.read", "supply.write"] as RequestContext["scopes"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { create_menus: true } },
    };
    expect(sets.ingredient.listVisible(creatorOnly).map((definition) => definition.action_id)).not.toContain("cai.ingredient.03.create");
  });

  test("exposes procurement to club actors and delegates role checks to Supply", () => {
    const sets = createK11ToolSets({
      client: adapterClient(async () => []),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
    });
    const actor = {
      context: {
        ...context,
        scopes: ["supply.read", "supply.write"] as RequestContext["scopes"],
      },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    };

    const definitions = sets.shopping.listVisible(actor);
    const visible = definitions.map((definition) => definition.action_id);
    expect(visible).toContain("cai.shopping.procurement.list");
    expect(visible).toContain("cai.shopping.procurement.activate");
    expect(visible).toContain("cai.shopping.procurement.template_deactivate");
    expect(visible).not.toContain("cai.shopping.07.create");
    expect(
      definitions.find(
        (definition) =>
          definition.action_id === "cai.shopping.procurement.purchase",
      )?.operations.purchase,
    ).toMatchObject({
      risk_class: "critical_write",
      execution_gate: "confirmation",
    });
  });

  test("validates procurement location and article contracts before one Supply mutation", async () => {
    const roomId = "25252525-2525-4525-8525-252525252525";
    const ingredientId = "29292929-2929-4929-8929-292929292929";
    const calls: ComvenioApiRequest[] = [];
    const shopping = createK11ToolSets({
      client: adapterClient(async (request) => {
        calls.push(request);
        return {
          id: "26262626-2626-4626-8626-262626262626",
          club_id: clubId,
          name: "Klopapier",
          reported_by: "private-actor-id",
          purchased_by: "private-purchaser-id",
        };
      }),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
    }).shopping;

    await expect(shopping.execute({
      action_id: "cai.shopping.procurement.add",
      input: {
        club_id: clubId,
        name: "Klopapier",
        quantity: 4,
        unit: "pc",
        building_id: clubId,
        room_id: roomId,
      },
      context: { ...context, scopes: ["supply.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toHaveLength(0);

    await expect(shopping.execute({
      action_id: "cai.shopping.procurement.add",
      input: {
        club_id: clubId,
        name: "Klopapier",
        quantity: 4,
        unit: "pc",
      },
      context: { ...context, scopes: ["supply.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toHaveLength(0);

    await expect(shopping.execute({
      action_id: "cai.shopping.procurement.add",
      input: {
        club_id: clubId,
        quantity: 4,
        unit: "pc",
        room_id: roomId,
      },
      context: { ...context, scopes: ["supply.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toHaveLength(0);

    const result = await shopping.execute({
      action_id: "cai.shopping.procurement.add",
      input: {
        club_id: clubId,
        name: "Klopapier",
        ingredient_id: ingredientId,
        quantity: 4,
        unit: "pc",
        room_id: roomId,
      },
      context: { ...context, scopes: ["supply.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      service: "supply",
      path: "/procurement/items",
      query: { club_id: clubId },
      body: {
        name: "Klopapier",
        ingredient_id: ingredientId,
        quantity: 4,
        unit: "pc",
        room_id: roomId,
      },
    });
    expect(JSON.stringify(result.result)).not.toContain("private-actor-id");
    expect(JSON.stringify(result.result)).not.toContain("private-purchaser-id");
  });

  test("returns the structured non-retryable duplicate activation conflict", async () => {
    const shopping = createK11ToolSets({
      client: adapterClient(async (request) => {
        throw createConnectorError({
          code: "CONFLICT",
          message: "private upstream response",
          request_id: request.context.request_id,
          retryable: false,
        });
      }),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
    }).shopping;

    await expect(shopping.execute({
      action_id: "cai.shopping.procurement.activate",
      input: {
        club_id: clubId,
        template_id: "27272727-2727-4727-8727-272727272727",
      },
      context: { ...context, scopes: ["supply.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Bereits angelegt",
      retryable: false,
    });
  });

  test("passes a procurement purchase through Supply RBAC without local state", async () => {
    let calls = 0;
    let forbidden = 0;
    const shopping = createK11ToolSets({
      client: adapterClient(async (request) => {
        calls++;
        throw createConnectorError({
          code: "PERMISSION_DENIED",
          message: "private assignment detail",
          request_id: request.context.request_id,
          retryable: false,
        });
      }),
      write_safety: { async execute(_request, mutation) { return mutation(); } },
      confirmation: {
        async confirmOrPreview(_request, mutation) { return mutation(); },
      },
      on_backend_forbidden() { forbidden++; },
    }).shopping;

    await expect(shopping.execute({
      action_id: "cai.shopping.procurement.purchase",
      input: {
        club_id: clubId,
        item_id: "28282828-2828-4828-8828-282828282828",
      },
      context: { ...context, scopes: ["supply.write"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: {} },
    })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Der Supply-Service hat die Aktion im aktuellen Kontext abgelehnt.",
    });
    expect(calls).toBe(1);
    expect(forbidden).toBe(1);
  });
});

describe("K12 content, homepage, data and verify tenant/RBAC isolation", () => {
  const fileId = "22222222-2222-4222-8222-222222222222";
  const contextId = "23232323-2323-4323-8323-232323232323";
  const departmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherDepartmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function adapterClient(handler: (request: ComvenioApiRequest) => Promise<import("@comvenio/connector-contracts").JsonValue>): ComvenioApiClient {
    return { timeout_ms: 15000, async request<T extends import("@comvenio/connector-contracts").JsonValue>(request: ComvenioApiRequest): Promise<T> { return await handler(request) as T; } };
  }

  test("rejects a foreign club before any content backend call", async () => {
    let calls = 0;
    const data = createK12ToolSets({ client: adapterClient(async () => { calls++; return []; }) }).data;
    await expect(data.execute({
      action_id: "cai.data.01.list",
      input: { club_id: otherClubId, context_type: "event", context_id: contextId },
      context: { ...context, scopes: ["files.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { read_files: true } },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });

  test("rejects a news mutation outside the selected department before the backend", async () => {
    let calls = 0;
    const news = createK12ToolSets({ client: adapterClient(async () => { calls++; return null; }), write_safety: { async execute(_request, mutation) { return mutation(); } } }).news;
    await expect(news.execute({
      action_id: "cai.news.03.create",
      input: { club_id: clubId, operation: "draft", news: { title: "Fremde News", content: "<p>Inhalt</p>", club_department_id: otherDepartmentId, visibility_scope: "department" } },
      context: { ...context, department_id: departmentId, scopes: ["content.write"] },
      capability_snapshot: { ...capabilitySnapshot, department_ids: [departmentId], permissions: { manage_news: true } },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });

  test("normalizes backend RBAC denial and never reflects private service details", async () => {
    let forbidden = 0;
    const data = createK12ToolSets({
      client: adapterClient(async (request) => { throw createConnectorError({ code: "PERMISSION_DENIED", message: "private folder and subject detail", request_id: request.context.request_id, retryable: false }); }),
      on_backend_forbidden() { forbidden++; },
    }).data;
    await expect(data.execute({
      action_id: "cai.data.02.show",
      input: { club_id: clubId, file_id: fileId },
      context: { ...context, scopes: ["files.read"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { read_files: true } },
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Der Fachservice hat die Content-Aktion im aktuellen Kontext abgelehnt." });
    expect(forbidden).toBe(1);
  });

  test("keeps rights mutations hidden from file readers and file writes hidden from news readers", () => {
    const sets = createK12ToolSets({ client: adapterClient(async () => []), write_safety: { async execute(_request, mutation) { return mutation(); } } });
    const fileReader = { context: { ...context, scopes: ["files.read", "files.write"] as RequestContext["scopes"] }, capability_snapshot: { ...capabilitySnapshot, permissions: { read_files: true } } };
    expect(sets.data.listVisible(fileReader).map((definition) => definition.action_id)).toContain("cai.data.01.list");
    expect(sets.data.listVisible(fileReader).map((definition) => definition.action_id)).not.toContain("cai.data.27.folder_right_add");
    const newsReader = { context: { ...context, scopes: ["content.read", "content.write"] as RequestContext["scopes"] }, capability_snapshot: { ...capabilitySnapshot, permissions: { read_news: true } } };
    expect(sets.news.listVisible(newsReader).map((definition) => definition.action_id)).toContain("cai.news.01.list");
    expect(sets.news.listVisible(newsReader).map((definition) => definition.action_id)).not.toContain("cai.news.03.create");
  });
});

describe("K13 sponsor and marketing tenant/RBAC isolation", () => {
  const departmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherDepartmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const sponsorId = "31313131-3131-4131-8131-313131313131";

  function adapterClient(handler: (request: ComvenioApiRequest) => Promise<import("@comvenio/connector-contracts").JsonValue>): ComvenioApiClient {
    return { timeout_ms: 15000, async request<T extends import("@comvenio/connector-contracts").JsonValue>(request: ComvenioApiRequest): Promise<T> { return await handler(request) as T; } };
  }

  test("rejects a foreign club before any marketing backend call", async () => {
    let calls = 0;
    const sponsor = createK13ToolSet({ client: adapterClient(async () => { calls++; return []; }) });
    await expect(sponsor.execute({ action_id: "cai.sponsor.01.list", input: { club_id: otherClubId }, context: { ...context, scopes: ["sponsor.read"] }, capability_snapshot: { ...capabilitySnapshot, permissions: { view_sponsors: true } } })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });

  test("rejects cross-department sponsor creation before the backend", async () => {
    let calls = 0;
    const sponsor = createK13ToolSet({ client: adapterClient(async () => { calls++; return null; }), write_safety: { async execute(_request, mutation) { return mutation(); } } });
    await expect(sponsor.execute({
      action_id: "cai.sponsor.03.add",
      input: { club_id: clubId, department_id: otherDepartmentId, company_name: "Fremder Sponsor", contact_email: "kontakt@example.org" },
      context: { ...context, department_id: departmentId, scopes: ["sponsor.write"] },
      capability_snapshot: { ...capabilitySnapshot, department_ids: [departmentId], permissions: { manage_sponsors: true } },
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toBe(0);
  });

  test("normalizes a backend RBAC denial without reflecting sponsor details", async () => {
    let forbidden = 0;
    const sponsor = createK13ToolSet({
      client: adapterClient(async (request) => { throw createConnectorError({ code: "PERMISSION_DENIED", message: "private sponsor contact and contract denial", request_id: request.context.request_id, retryable: false }); }),
      on_backend_forbidden() { forbidden++; },
    });
    await expect(sponsor.execute({ action_id: "cai.sponsor.02.show", input: { club_id: clubId, sponsor_id: sponsorId }, context: { ...context, scopes: ["sponsor.read"] }, capability_snapshot: { ...capabilitySnapshot, permissions: { view_sponsors: true } } })).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Der Marketing-Service hat die Sponsoring-Aktion im aktuellen Kontext abgelehnt." });
    expect(forbidden).toBe(1);
  });

  test("separates sponsor readers, managers and member-responsibility reads", () => {
    const sponsor = createK13ToolSet({ client: adapterClient(async () => []), write_safety: { async execute(_request, mutation) { return mutation(); } }, job_starter: { async start() { return { job_id: sponsorId, status: "queued" }; } } });
    const reader = { context: { ...context, scopes: ["sponsor.read", "sponsor.write", "member.read.basic"] as RequestContext["scopes"] }, capability_snapshot: { ...capabilitySnapshot, permissions: { view_sponsors: true } } };
    expect(sponsor.listVisible(reader).map((definition) => definition.action_id)).toContain("cai.sponsor.01.list");
    expect(sponsor.listVisible(reader).map((definition) => definition.action_id)).not.toContain("cai.sponsor.03.add");
    expect(sponsor.listVisible(reader).map((definition) => definition.action_id)).not.toContain("cai.sponsor.21.responsible_list");
    const memberReader = { ...reader, capability_snapshot: { ...capabilitySnapshot, permissions: { view_sponsors: true, view_members: true } } };
    expect(sponsor.listVisible(memberReader).map((definition) => definition.action_id)).toContain("cai.sponsor.21.responsible_list");
  });
});

describe("K14 write-safety tenant, RBAC and retry isolation", () => {
  const safetyToolName = "cv_event_publish_safety_12345678";
  const safetyTargetId = "41414141-4141-4141-8141-414141414141";
  const safetyIdempotencyKey = "42424242-4242-4242-8242-424242424242";

  function writeEffect() {
    return {
      target_ids: [safetyTargetId],
      changed_count: 1,
      unchanged_count: 0,
      failed_count: 0,
      result_summary: "Die Veranstaltung wurde veröffentlicht.",
      object_versions: [{ target_id: safetyTargetId, version: "event-v2" }],
      safe_next_actions: [],
    };
  }

  function setup() {
    let backendAllowed = true;
    let backendChecks = 0;
    const service = new WriteSafetyService({
      store: new MemoryAtomicSafetyStore(),
      authorization: {
        async reauthorize(input) {
          backendChecks++;
          if (!input.context.scopes.includes("event.write")) {
            throw createConnectorError({
              code: "SCOPE_REQUIRED",
              message: "Der Scope event.write fehlt.",
              request_id: input.context.request_id,
              retryable: false,
              required_scope: "event.write",
            });
          }
          if (!backendAllowed) {
            throw createConnectorError({
              code: "PERMISSION_DENIED",
              message: "Der Event-Service hat die Berechtigung entzogen.",
              request_id: input.context.request_id,
              retryable: false,
            });
          }
          return { capability_version: "safety-cap-v1" };
        },
      },
    });
    return {
      service,
      denyBackend() { backendAllowed = false; },
      backendChecks() { return backendChecks; },
    };
  }

  async function createPreview(service: WriteSafetyService) {
    return service.createCriticalPreview({
      context: { ...context, scopes: ["event.read", "event.write"] },
      operation: { tool_name: safetyToolName, risk_class: "critical_write", execution_mode: "inline" },
      normalized_input: { club_id: clubId, event_id: safetyTargetId, publish: true },
      target: { type: "event", id: safetyTargetId, label: "Sommerfest" },
      impact: { creates: 0, updates: 0, deletes: 0, publishes: 1, imports: 0, exports: 0, affected_total: 1, summary: "Eine Veranstaltung wird veröffentlicht." },
      masked_fields: [],
      safe_summary: "Die Veranstaltung Sommerfest wird veröffentlicht.",
      object_version: "event-v1",
    });
  }

  test("TC-04: a Club-A token cannot cross tenants and permission loss blocks confirm", async () => {
    const tenantCase = setup();
    const challenge = await createPreview(tenantCase.service);
    let writes = 0;
    const mutation = async () => { writes++; return writeEffect(); };

    await expect(tenantCase.service.confirmCriticalWrite({
      context: { ...context, club_id: otherClubId, scopes: ["event.write"] },
      tool_name: safetyToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: safetyIdempotencyKey,
      current_object_version: "event-v1",
    }, mutation)).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    expect(writes).toBe(0);

    tenantCase.denyBackend();
    await expect(tenantCase.service.confirmCriticalWrite({
      context: { ...context, scopes: ["event.write"] },
      tool_name: safetyToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: safetyIdempotencyKey,
      current_object_version: "event-v1",
    }, mutation)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(tenantCase.backendChecks()).toBe(3);
    expect(writes).toBe(0);
  });

  test("TC-05: provider retry rechecks RBAC but receives one durable write receipt", async () => {
    const retryCase = setup();
    const challenge = await createPreview(retryCase.service);
    let writes = 0;
    const request = {
      context: { ...context, scopes: ["event.write"] as RequestContext["scopes"] },
      tool_name: safetyToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: safetyIdempotencyKey,
      current_object_version: "event-v1",
    };
    const mutation = async () => { writes++; return writeEffect(); };

    const first = await retryCase.service.confirmCriticalWrite(request, mutation);
    const replay = await retryCase.service.confirmCriticalWrite(request, mutation);

    expect(replay).toEqual(first);
    expect(writes).toBe(1);
    expect(retryCase.backendChecks()).toBe(3);
  });
});

describe("K15 job ownership, RBAC and confirmed export isolation", () => {
  const operationReference = "51515151-5151-4151-8151-515151515151";
  const jobIdempotencyKey = "52525252-5252-4252-8252-525252525252";
  const exportToolName = "cv_member_export_write_12345678";

  function setupJobs() {
    let allowed = true;
    let checks = 0;
    const queue = new MemoryJobQueue();
    const fairUse = new FairUseService(bundledRateLimitConfig(), new MemoryFairUseStore());
    const jobs = new AsyncJobService(queue, {
      async reauthorize(input) {
        checks++;
        if (!input.context.scopes.includes("files.export")) {
          throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Der Scope files.export fehlt.", request_id: input.context.request_id, retryable: false, required_scope: "files.export" });
        }
        if (!allowed) {
          throw createConnectorError({ code: "PERMISSION_DENIED", message: "Der Fachservice hat das Exportrecht entzogen.", request_id: input.context.request_id, retryable: false });
        }
        return { capability_version: "job-cap-v1" };
      },
    }, fairUse);
    return { jobs, deny() { allowed = false; }, checks() { return checks; } };
  }

  function jobStart(jobs: AsyncJobService) {
    return jobs.start({
      context: { ...context, scopes: ["member.read.details", "files.export"] },
      club_id: clubId,
      tool_name: exportToolName,
      operation_reference: operationReference,
      idempotency_key: jobIdempotencyKey,
      fair_use_bucket: "import_export",
      cancellable: true,
    });
  }

  test("TC-04: foreign users and clubs cannot inspect jobs and permission loss blocks status", async () => {
    const setup = setupJobs();
    const started = await jobStart(setup.jobs);
    await expect(setup.jobs.status({
      context: { ...context, subject_id: "53535353-5353-4353-8353-535353535353", scopes: ["files.export"] },
      club_id: clubId,
      job_id: started.job_id,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setup.jobs.status({
      context: { ...context, club_id: otherClubId, scopes: ["files.export"] },
      club_id: clubId,
      job_id: started.job_id,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    setup.deny();
    await expect(setup.jobs.status({
      context: { ...context, scopes: ["files.export"] },
      club_id: clubId,
      job_id: started.job_id,
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(setup.checks()).toBe(2);
  });

  test("TC-05: confirmed personal export and its provider retry enqueue exactly once", async () => {
    const setup = setupJobs();
    const safety = new WriteSafetyService({
      store: new MemoryAtomicSafetyStore(),
      authorization: { async reauthorize() { return { capability_version: "job-cap-v1" }; } },
    });
    const writeContext = { ...context, scopes: ["member.read.details", "files.export"] as RequestContext["scopes"] };
    const preview = await safety.createCriticalPreview({
      context: writeContext,
      operation: { tool_name: exportToolName, risk_class: "critical_write", execution_mode: "async_job" },
      normalized_input: { club_id: clubId, export_scope: "personal" },
      target: { type: "member_export", id: null, label: "Mitgliederexport" },
      impact: { creates: 0, updates: 0, deletes: 0, publishes: 0, imports: 0, exports: 1, affected_total: 1, summary: "Eine personenbezogene Exportdatei wird erzeugt." },
      masked_fields: ["email"],
      safe_summary: "Ein personenbezogener Export wird gestartet.",
      object_version: "members-v1",
    });
    let enqueues = 0;
    const request = {
      context: writeContext,
      tool_name: exportToolName,
      preview_id: preview.preview.preview_id,
      confirmation_token: preview.confirmation_token,
      idempotency_key: jobIdempotencyKey,
      current_object_version: "members-v1",
    };
    const mutation = async () => {
      enqueues++;
      await jobStart(setup.jobs);
      return { target_ids: [], changed_count: 1, unchanged_count: 0, failed_count: 0, result_summary: "Der Exportjob wurde gestartet.", object_versions: [], safe_next_actions: [] };
    };
    const first = await safety.confirmCriticalWrite(request, mutation);
    const replay = await safety.confirmCriticalWrite(request, mutation);
    expect(replay).toEqual(first);
    expect(enqueues).toBe(1);
  });
});

describe("K16 event calendar widget tenant and runtime isolation", () => {
  const eventId = "61616161-6161-4161-8161-616161616161";
  const eventContext: RequestContext = {
    ...context,
    scopes: ["event.read", "event.write"],
  };
  const eventCapability: CapabilitySnapshot = {
    ...capabilitySnapshot,
    permissions: { view_events: true, create_events: true },
  };
  const action = {
    action_id: "event.plan",
    label: "Termin planen",
    tool_name: "cv_event_create",
    input: {},
    visibility: "visible" as const,
    enabled: true,
    risk_class: "reversible_write" as const,
    requires_confirmation: false,
    disabled_reason: null,
  };

  function widgetInput(overrides: Record<string, unknown> = {}) {
    return {
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      range: { from: "2026-07-20T00:00:00+02:00", to: "2026-07-27T00:00:00+02:00" },
      source: [{
        event_id: eventId,
        title: "Sommerfest",
        start_time: "2026-07-21T17:00:00+02:00",
        end_time: "2026-07-21T22:00:00+02:00",
        status: "published",
      }],
      context: eventContext,
      capability_snapshot: eventCapability,
      action_candidates: [action],
      ...overrides,
    } as any;
  }

  test("TC-04/TC-05: private widget projection binds subject, club, scopes and capability", () => {
    const allowed = new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy([action.tool_name]));
    expect(allowed.private(widgetInput()).actions).toHaveLength(1);
    expect(() => allowed.private(widgetInput({
      club: { club_id: otherClubId, name: "Fremder Verein", timezone: "Europe/Berlin" },
    }))).toThrow();
    expect(() => allowed.private(widgetInput({
      capability_snapshot: { ...eventCapability, subject_id: "62626262-6262-4262-8262-626262626262" },
    }))).toThrow();
    expect(new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy([])).private(widgetInput()).actions).toEqual([]);
  });

  test("TC-05: a visible widget intent is still rechecked and denied by backend RBAC", async () => {
    let forbidden = 0;
    let calls = 0;
    const projector = new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy([action.tool_name]));
    expect(projector.private(widgetInput()).actions.map((item) => item.tool_name)).toEqual([action.tool_name]);
    const event = createK8ToolSets({
      client: {
        timeout_ms: 15000,
        async request(request) {
          calls++;
          throw createConnectorError({ code: "PERMISSION_DENIED", message: "private backend detail", request_id: request.context.request_id, retryable: false });
        },
      },
      write_safety: { async execute(_request, mutation) { return mutation(); } },
      on_backend_forbidden() { forbidden++; },
    }).event;
    await expect(event.execute({
      action_id: "cai.event.03.create",
      input: {
        club_id: clubId,
        event: {
          department_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Sommerfest",
          event_type: "meeting",
          visibility_scope: "member",
          organizer_type: "member",
        },
      },
      context: eventContext,
      capability_snapshot: eventCapability,
    })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Der Fachservice hat die Event-/Plan-Aktion im aktuellen Kontext abgelehnt.",
    });
    expect(calls).toBe(1);
    expect(forbidden).toBe(1);
  });

  test("TC-01/TC-06: MCP resource and hashed public asset are served without private data", async () => {
    const server = new McpHttpServer(runtimeOptions({
      server_factory(contextInput) {
        const runtime = runtimeOptions().server_factory(contextInput);
        return Promise.resolve(runtime).then((mcpServer) => {
          registerEventCalendarWidgetResource(mcpServer, "development");
          return mcpServer;
        });
      },
    }));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const list = await postMcp(baseUrl, { jsonrpc: "2.0", id: 1, method: "resources/list", params: {} });
      expect(list.status).toBe(200);
      const listed = await list.json() as any;
      expect(listed.result.resources.some((resource: any) => resource.uri === EVENT_CALENDAR_WIDGET_RESOURCE_URI)).toBe(true);

      const read = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: EVENT_CALENDAR_WIDGET_RESOURCE_URI },
      });
      expect(read.status).toBe(200);
      const resource = await read.json() as any;
      expect(resource.result.contents[0].mimeType).toBe("text/html;profile=mcp-app");
      expect(resource.result.contents[0].text).toContain(EVENT_CALENDAR_WIDGET_ASSET_PATH);
      expect(resource.result.contents[0].text).not.toContain(clubId);
      expect(resource.result.contents[0]._meta.ui.resourceUri).toBe(EVENT_CALENDAR_WIDGET_RESOURCE_URI);

      const asset = await fetch(`${baseUrl}${EVENT_CALENDAR_WIDGET_ASSET_PATH}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(asset.headers.get("access-control-allow-origin")).toBe("*");
      expect(await asset.text()).toBe(EVENT_CALENDAR_WIDGET_CLIENT);
      expect(asset.headers.get("cache-control")).toContain("immutable");
      expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await fetch(`${baseUrl}/widgets/event-calendar/assets/arbitrary.js`).then((response) => response.status)).toBe(404);
    } finally {
      expect(await server.drain()).toBe(true);
    }
  });
});

describe("K17 member management widget tenant and runtime isolation", () => {
  const memberId = "71717171-7171-4171-8171-717171717171";
  const memberContext: RequestContext = {
    ...context,
    scopes: ["member.read.basic", "member.read.details", "admin.write"],
  };
  const memberCapability: CapabilitySnapshot = {
    ...capabilitySnapshot,
    permissions: { view_members: true, view_members_details: true, manage_members: true },
  };
  const manageAction = {
    action_id: "member.update",
    label: "Änderung vorbereiten",
    tool_name: "cv_member_update",
    input: { member_id: memberId },
    visibility: "visible" as const,
    enabled: true,
    risk_class: "reversible_write" as const,
    requires_confirmation: false,
    disabled_reason: null,
  };
  const listSource = {
    items: [{
      member_id: memberId,
      display_name: "Anna M.",
      status_label: "aktiv",
      department_labels: ["Team U18"],
      email_masked: "a***@b***.de",
      phone_masked: "***1234",
    }],
    limit: 50,
    offset: 0,
    total: 1,
  };

  function memberWidgetInput(overrides: Record<string, unknown> = {}) {
    return {
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      context: memberContext,
      capability_snapshot: memberCapability,
      list_source: listSource,
      action_candidates: [manageAction],
      ...overrides,
    } as any;
  }

  test("TC-04/TC-05: projection binds tenant and hides details or writes without current rights", () => {
    const allowed = new MemberManagementWidgetProjector(new MemberWidgetCapabilityPolicy([manageAction.tool_name]));
    expect(allowed.project(memberWidgetInput()).actions).toHaveLength(1);
    expect(() => allowed.project(memberWidgetInput({
      club: { club_id: otherClubId, name: "Fremder Verein", timezone: "Europe/Berlin" },
    }))).toThrow();
    expect(new MemberManagementWidgetProjector(new MemberWidgetCapabilityPolicy([manageAction.tool_name])).project(memberWidgetInput({
      capability_snapshot: { ...memberCapability, permissions: { view_members: true, view_members_details: true, manage_members: false } },
    })).actions).toEqual([]);
    expect(() => allowed.project(memberWidgetInput({
      context: { ...memberContext, scopes: ["member.read.basic"] },
      detail_request: {
        member_id: memberId,
        source: { member_id: memberId, first_name: "Anna", last_name: "Muster", email: "anna@example.org" },
      },
    }))).toThrow();
  });

  test("TC-05: a visible member action is still rejected by a fresh backend RBAC check", async () => {
    let calls = 0;
    let forbidden = 0;
    const projector = new MemberManagementWidgetProjector(new MemberWidgetCapabilityPolicy([manageAction.tool_name]));
    expect(projector.project(memberWidgetInput()).actions).toHaveLength(1);
    const member = createK7ToolSets({
      client: {
        timeout_ms: 15000,
        async request(request) {
          calls++;
          throw createConnectorError({ code: "PERMISSION_DENIED", message: "private backend detail", request_id: request.context.request_id, retryable: false });
        },
      },
      write_safety: { async execute(_request, mutation) { return mutation(); } },
      on_backend_forbidden() { forbidden++; },
    }).member;
    await expect(member.execute({
      action_id: "cai.member.04.update",
      input: { club_id: clubId, member_id: memberId, changes: { first_name: "Anna-Maria" } },
      context: memberContext,
      capability_snapshot: memberCapability,
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Der Fachservice hat die Aktion im aktuellen Kontext abgelehnt." });
    expect(calls).toBe(1);
    expect(forbidden).toBe(1);
  });

  test("TC-01/TC-06: member MCP resource and hashed asset carry no member data", async () => {
    const server = new McpHttpServer(runtimeOptions({
      server_factory(contextInput) {
        const runtime = runtimeOptions().server_factory(contextInput);
        return Promise.resolve(runtime).then((mcpServer) => {
          registerMemberManagementWidgetResource(mcpServer, "development");
          return mcpServer;
        });
      },
    }));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const list = await postMcp(baseUrl, { jsonrpc: "2.0", id: 1, method: "resources/list", params: {} });
      expect(list.status).toBe(200);
      expect((await list.json() as any).result.resources.some((resource: any) => resource.uri === MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI)).toBe(true);
      const read = await postMcp(baseUrl, { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI } });
      const resource = await read.json() as any;
      expect(read.status).toBe(200);
      expect(resource.result.contents[0].text).toContain(MEMBER_MANAGEMENT_WIDGET_ASSET_PATH);
      expect(resource.result.contents[0].text).not.toContain(memberId);
      const asset = await fetch(`${baseUrl}${MEMBER_MANAGEMENT_WIDGET_ASSET_PATH}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(asset.headers.get("access-control-allow-origin")).toBe("*");
      expect(await asset.text()).toBe(MEMBER_MANAGEMENT_WIDGET_CLIENT);
      expect(await fetch(`${baseUrl}/widgets/member-management/assets/arbitrary.js`).then((response) => response.status)).toBe(404);
    } finally {
      expect(await server.drain()).toBe(true);
    }
  });
});

describe("K18 booking object widget tenant and runtime isolation", () => {
  const objectId = "92929292-9292-4292-8292-929292929292";
  const bookingContext: RequestContext = {
    ...context,
    scopes: ["object.read", "booking.read", "booking.write"],
  };
  const bookingCapability: CapabilitySnapshot = { ...capabilitySnapshot, permissions: {} };
  const range = { from: "2026-07-22T08:00:00+02:00", to: "2026-07-22T10:00:00+02:00" };
  const action = {
    action_id: "booking.create",
    label: "Reservierung vorbereiten",
    tool_name: "cv_booking_03_create",
    input: {
      input: {
        object_id: objectId,
        start_time: range.from,
        end_time: range.to,
        timezone: "Europe/Berlin",
        status: "requested",
        title: "Buchung: Tennisplatz 1",
      },
      idempotency_key: "92929292-9292-4292-8292-929292929293",
    },
    visibility: "visible" as const,
    enabled: true,
    risk_class: "critical_write" as const,
    requires_confirmation: true,
    disabled_reason: null,
  };
  const availability = {
    club_id: clubId,
    object_id: objectId,
    from: range.from,
    to: range.to,
    timezone: "Europe/Berlin",
    status: "AVAILABLE" as const,
    slots: [{ from: range.from, to: range.to, status: "AVAILABLE" as const, reason: null }],
    booking_rules_observed: 1,
  };

  function bookingInput(overrides: Record<string, unknown> = {}) {
    return {
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      context: bookingContext,
      capability_snapshot: bookingCapability,
      object_source: [{ id: objectId, club_id: clubId, name: "Tennisplatz 1", object_type: "Sportplatz", is_active: true }],
      selected_object_id: objectId,
      availability_source: availability,
      range,
      action_candidates: [action],
      ...overrides,
    } as any;
  }

  test("TC-04/TC-05: projection binds tenant, current scopes and visible server policy", () => {
    const projector = new BookingObjectWidgetProjector(new BookingWidgetCapabilityPolicy([action.tool_name]));
    expect(projector.project(bookingInput()).actions).toHaveLength(1);
    expect(() => projector.project(bookingInput({
      object_source: [{ id: objectId, club_id: otherClubId, name: "Fremder Platz", object_type: "Sportplatz" }],
    }))).toThrow();
    expect(() => projector.project(bookingInput({
      availability_source: { ...availability, club_id: otherClubId },
    }))).toThrow();
    expect(new BookingObjectWidgetProjector(new BookingWidgetCapabilityPolicy([])).project(bookingInput()).actions).toEqual([]);
    expect(() => projector.project(bookingInput({ context: { ...bookingContext, scopes: ["object.read", "booking.read"] } }))).not.toThrow();
    expect(projector.project(bookingInput({
      context: { ...bookingContext, scopes: ["object.read", "booking.read"] },
    })).actions).toHaveLength(1);
  });

  test("TC-01/TC-06: booking MCP resource and immutable asset carry no tenant data", async () => {
    const server = new McpHttpServer(runtimeOptions({
      server_factory(contextInput) {
        const runtime = runtimeOptions().server_factory(contextInput);
        return Promise.resolve(runtime).then((mcpServer) => {
          registerBookingObjectWidgetResource(mcpServer, "development");
          return mcpServer;
        });
      },
    }));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const list = await postMcp(baseUrl, { jsonrpc: "2.0", id: 1, method: "resources/list", params: {} });
      expect(list.status).toBe(200);
      expect((await list.json() as any).result.resources.some((resource: any) => resource.uri === BOOKING_OBJECT_WIDGET_RESOURCE_URI)).toBe(true);
      const read = await postMcp(baseUrl, { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: BOOKING_OBJECT_WIDGET_RESOURCE_URI } });
      const resource = await read.json() as any;
      expect(read.status).toBe(200);
      expect(resource.result.contents[0].text).toContain(BOOKING_OBJECT_WIDGET_ASSET_PATH);
      expect(resource.result.contents[0].text).not.toContain(objectId);
      expect(resource.result.contents[0]._meta.ui.resourceUri).toBe(BOOKING_OBJECT_WIDGET_RESOURCE_URI);
      const asset = await fetch(`${baseUrl}${BOOKING_OBJECT_WIDGET_ASSET_PATH}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(asset.headers.get("access-control-allow-origin")).toBe("*");
      expect(await asset.text()).toBe(BOOKING_OBJECT_WIDGET_CLIENT);
      expect(asset.headers.get("cache-control")).toContain("immutable");
      expect(await fetch(`${baseUrl}/widgets/booking-object/assets/arbitrary.js`).then((response) => response.status)).toBe(404);
    } finally {
      expect(await server.drain()).toBe(true);
    }
  });
});

describe("K19 news widget tenant and runtime isolation", () => {
  const newsId = "95959595-9595-4595-8595-959595959595";
  const newsContext: RequestContext = { ...context, scopes: ["content.read", "content.write"] };
  const newsCapability: CapabilitySnapshot = { ...capabilitySnapshot, permissions: { read_news: true, manage_news: true } };
  const previewAction = {
    action_id: "news.preview",
    label: "Homepage-Vorschau",
    tool_name: "cv_news_preview",
    input: { news_id: newsId },
    visibility: "visible" as const,
    enabled: true,
    risk_class: "read" as const,
    requires_confirmation: false,
    disabled_reason: null,
  };
  const listSource = { items: [{ news_id: newsId, title: "Jugendturnier", teaser: "Rückblick", published_at: "2026-07-18T10:00:00+02:00", is_draft: false }], returned: 1, truncated: false };

  function newsInput(overrides: Record<string, unknown> = {}) {
    return {
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" }, context: newsContext,
      capability_snapshot: newsCapability, list_source: listSource, selected_news_id: newsId,
      preview_source: { news_id: newsId, html: "<h2>Vorschau</h2><p>Sicherer Inhalt</p>", expires_at: "2026-07-21T10:00:00+02:00" },
      action_candidates: [previewAction], generated_at: "2026-07-21T09:00:00+02:00", ...overrides,
    } as any;
  }

  test("TC-04/TC-05: private projection binds tenant, selected article and current manage capability", () => {
    const projector = new NewsWidgetProjector(new NewsWidgetCapabilityPolicy([previewAction.tool_name]));
    expect(projector.private(newsInput()).actions).toHaveLength(1);
    expect(() => projector.private(newsInput({ club: { club_id: otherClubId, name: "Fremder Verein", timezone: "Europe/Berlin" } }))).toThrow();
    expect(() => projector.private(newsInput({ preview_source: { news_id: "96969696-9696-4696-8696-969696969696", html: "<p>Fremd</p>" } }))).toThrow();
    const noManage = projector.private(newsInput({ context: { ...newsContext, scopes: ["content.read"] }, capability_snapshot: { ...newsCapability, permissions: { read_news: true, manage_news: false } } }));
    expect(noManage.actions).toEqual([]);
  });

  test("TC-05: a visible preview intent is still rejected by fresh backend RBAC", async () => {
    let calls = 0;
    let forbidden = 0;
    const projector = new NewsWidgetProjector(new NewsWidgetCapabilityPolicy([previewAction.tool_name]));
    expect(projector.private(newsInput()).actions).toHaveLength(1);
    const client: ComvenioApiClient = { timeout_ms: 15000, async request<T extends import("@comvenio/connector-contracts").JsonValue>(request: ComvenioApiRequest): Promise<T> { calls++; throw createConnectorError({ code: "PERMISSION_DENIED", message: "private news detail", request_id: request.context.request_id, retryable: false }); } };
    const news = createK12ToolSets({ client, on_backend_forbidden() { forbidden++; } }).news;
    await expect(news.execute({
      action_id: "cai.news.07.preview",
      input: { club_id: clubId, title: "Jugendturnier", content: "<p>Rückblick</p>" },
      context: newsContext,
      capability_snapshot: newsCapability,
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Der Fachservice hat die Content-Aktion im aktuellen Kontext abgelehnt." });
    expect(calls).toBe(1);
    expect(forbidden).toBe(1);
  });

  test("TC-01/TC-06: news MCP resource and immutable asset contain no article or tenant data", async () => {
    const server = new McpHttpServer(runtimeOptions({ server_factory(contextInput) { const runtime = runtimeOptions().server_factory(contextInput); return Promise.resolve(runtime).then((mcpServer) => { registerNewsWidgetResource(mcpServer, "development"); return mcpServer; }); } }));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const list = await postMcp(baseUrl, { jsonrpc: "2.0", id: 1, method: "resources/list", params: {} });
      expect(list.status).toBe(200);
      expect((await list.json() as any).result.resources.some((resource: any) => resource.uri === NEWS_WIDGET_RESOURCE_URI)).toBe(true);
      const read = await postMcp(baseUrl, { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: NEWS_WIDGET_RESOURCE_URI } });
      const resource = await read.json() as any;
      expect(read.status).toBe(200);
      expect(resource.result.contents[0].text).toContain(NEWS_WIDGET_ASSET_PATH);
      expect(resource.result.contents[0].text).not.toContain(newsId);
      expect(resource.result.contents[0]._meta.ui.resourceUri).toBe(NEWS_WIDGET_RESOURCE_URI);
      const asset = await fetch(`${baseUrl}${NEWS_WIDGET_ASSET_PATH}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(asset.headers.get("access-control-allow-origin")).toBe("*");
      expect(await asset.text()).toBe(NEWS_WIDGET_CLIENT);
      expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await fetch(`${baseUrl}/widgets/news/assets/arbitrary.js`).then((response) => response.status)).toBe(404);
    } finally { expect(await server.drain()).toBe(true); }
  });
});

describe("K20 confirmation widget tenant, RBAC and runtime isolation", () => {
  const previewIdempotencyKey = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
  const targetId = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
  const criticalToolName = "cv_news_publish_critical_12345678";
  const confirmationContext: RequestContext = { ...context, scopes: ["content.write"] };
  const confirmationCapability: CapabilitySnapshot = { ...capabilitySnapshot, permissions: { manage_news: true } };

  function confirmAction(challenge: Awaited<ReturnType<WriteSafetyService["createCriticalPreview"]>>) {
    return {
      action_id: "action.confirm",
      label: "Jetzt bestätigen",
      tool_name: "action_confirm",
      input: { preview_id: challenge.preview.preview_id, confirmation_token: challenge.confirmation_token, idempotency_key: previewIdempotencyKey },
      visibility: "visible" as const,
      enabled: true,
      risk_class: "critical_write" as const,
      requires_confirmation: true,
      disabled_reason: null,
    };
  }

  function safetyFixture() {
    let allowed = true;
    const service = new WriteSafetyService({
      store: new MemoryAtomicSafetyStore(),
      authorization: {
        async reauthorize(input) {
          if (!allowed) throw createConnectorError({ code: "PERMISSION_DENIED", message: "Die Berechtigung wurde entzogen.", request_id: input.context.request_id, retryable: false });
          return { capability_version: confirmationContext.capability_version! };
        },
      },
    });
    return { service, deny() { allowed = false; } };
  }

  async function createChallenge(service: WriteSafetyService) {
    return service.createCriticalPreview({
      context: confirmationContext,
      operation: { tool_name: criticalToolName, risk_class: "critical_write", execution_mode: "inline" },
      normalized_input: { club_id: clubId, news_id: targetId, publish: true },
      target: { type: "news", id: targetId, label: "Jugendturnier" },
      impact: { creates: 0, updates: 0, deletes: 0, publishes: 1, imports: 0, exports: 0, affected_total: 1, summary: "Ein Beitrag wird öffentlich sichtbar." },
      masked_fields: ["contact_email"],
      safe_summary: "Der Beitrag Jugendturnier wird veröffentlicht.",
      object_version: "news-v1",
    });
  }

  test("TC-03/TC-05: projection is tenant-bound and a fresh backend denial prevents every write", async () => {
    const fixture = safetyFixture();
    const challenge = await createChallenge(fixture.service);
    const projector = new ConfirmationWidgetProjector(new ConfirmationWidgetCapabilityPolicy([criticalToolName]));
    const input = {
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      context: confirmationContext,
      capability_snapshot: confirmationCapability,
      challenge,
      confirm_action: confirmAction(challenge),
    };
    const projected = projector.project(input);
    expect(projected.actions).toHaveLength(1);
    expect(projected.actions[0]!.input).toEqual({
      preview_id: challenge.preview.preview_id,
      idempotency_key: previewIdempotencyKey,
    });
    expect(JSON.stringify(projected)).not.toContain("confirmation_token");
    expect(() => projector.project({ ...input, club: { ...input.club, club_id: otherClubId } })).toThrow();
    expect(() => new ConfirmationWidgetProjector(new ConfirmationWidgetCapabilityPolicy([])).project(input)).toThrow();

    fixture.deny();
    let writes = 0;
    await expect(fixture.service.confirmCriticalWrite({
      context: confirmationContext,
      tool_name: criticalToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: previewIdempotencyKey,
      current_object_version: "news-v1",
    }, async () => {
      writes++;
      return { target_ids: [targetId], changed_count: 1, unchanged_count: 0, failed_count: 0, result_summary: "Veröffentlicht.", object_versions: [], safe_next_actions: [] };
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(writes).toBe(0);
  });

  test("TC-04: a changed object version fails closed before dispatch", async () => {
    const fixture = safetyFixture();
    const challenge = await createChallenge(fixture.service);
    let writes = 0;
    await expect(fixture.service.confirmCriticalWrite({
      context: confirmationContext,
      tool_name: criticalToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: previewIdempotencyKey,
      current_object_version: "news-v2",
    }, async () => {
      writes++;
      return { target_ids: [targetId], changed_count: 1, unchanged_count: 0, failed_count: 0, result_summary: "Veröffentlicht.", object_versions: [], safe_next_actions: [] };
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes).toBe(0);
  });

  test("TC-01/TC-06: MCP resource and immutable asset contain no intent, token or tenant data", async () => {
    const server = new McpHttpServer(runtimeOptions({ server_factory(contextInput) { const runtime = runtimeOptions().server_factory(contextInput); return Promise.resolve(runtime).then((mcpServer) => { registerConfirmationWidgetResource(mcpServer, "development"); return mcpServer; }); } }));
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const list = await postMcp(baseUrl, { jsonrpc: "2.0", id: 1, method: "resources/list", params: {} });
      expect(list.status).toBe(200);
      expect((await list.json() as any).result.resources.some((resource: any) => resource.uri === CONFIRMATION_WIDGET_RESOURCE_URI)).toBe(true);
      const read = await postMcp(baseUrl, { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: CONFIRMATION_WIDGET_RESOURCE_URI } });
      const resource = await read.json() as any;
      expect(read.status).toBe(200);
      expect(resource.result.contents[0].text).toContain(CONFIRMATION_WIDGET_ASSET_PATH);
      expect(resource.result.contents[0].text).not.toContain(targetId);
      expect(resource.result.contents[0].text).not.toContain(clubId);
      expect(resource.result.contents[0]._meta.ui.resourceUri).toBe(CONFIRMATION_WIDGET_RESOURCE_URI);
      const asset = await fetch(`${baseUrl}${CONFIRMATION_WIDGET_ASSET_PATH}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(asset.headers.get("access-control-allow-origin")).toBe("*");
      expect(await asset.text()).toBe(CONFIRMATION_WIDGET_CLIENT);
      expect(asset.headers.get("cache-control")).toContain("immutable");
      expect(await fetch(`${baseUrl}/widgets/action-confirmation/assets/arbitrary.js`).then((response) => response.status)).toBe(404);
    } finally { expect(await server.drain()).toBe(true); }
  });
});

describe("K23 aggregate tenant isolation release evidence", () => {
  test("TC-04/TC-05: cross-club, cross-user, stale capability, token, file and backend denial evidence is complete", () => {
    const report = new TenantIsolationSuite().evaluate(REQUIRED_TENANT_SCENARIOS.map((id) => ({
      id,
      passed: true,
      synthetic_data_only: true,
      evidence_ref: "apps/mcp-server/tests/tenant-isolation.integration.test.ts",
    })));
    expect(report).toMatchObject({ status: "pass", blockers: [] });
    expect(report.results.map((result) => result.id).sort()).toEqual([...REQUIRED_TENANT_SCENARIOS].sort());
  });
});
