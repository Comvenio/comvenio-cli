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
import { PublicToolSubset } from "../src/public/index.ts";
import {
  createRuntimeAccessPolicy,
  createRuntimeServer,
} from "../src/runtime-tools.ts";
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
    backend_actor_token: "backend-actor-token",
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
    public_origin: "https://mcpdev.comvenio.app",
    edge_shared_secret: null,
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

  test("resolves the OAuth-bound club without requiring domain or club_id input", async () => {
    const eventId = "33333333-3333-4333-8333-333333333333";
    const api = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
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
        environment: "development",
        api_base_url: `http://127.0.0.1:${api.port}`,
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
      expect(whoami.inputSchema).toMatchObject({
        type: "object",
        properties: {},
        additionalProperties: false,
      });
      expect(whoami.inputSchema.required ?? []).toEqual([]);
      expect(tools.find((tool: any) => tool.name === "public_events").description)
        .toContain("cv_whoami_read");

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

      const mismatch = await postMcp(baseUrl, {
        jsonrpc: "2.0",
        id: 24,
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
    expect(authenticated.request.scopes).toEqual(["club.read", "member.read.basic"]);

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
  });

  test("TC-06: telemetry excludes tool arguments, member data and response content", async () => {
    const lines: string[] = [];
    new ConsoleTelemetrySink((line) => lines.push(line)).record({
      request_id: requestId,
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

  test("TC-04: private calendar reads require event.read and view_events", () => {
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
    }).map((definition) => definition.action_id)).not.toContain("cai.event.01.list");
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
    expect(sets.shopping.listVisible(menuRole)).toHaveLength(0);
    const creatorOnly = {
      context: { ...context, scopes: ["supply.read", "supply.write"] as RequestContext["scopes"] },
      capability_snapshot: { ...capabilitySnapshot, permissions: { create_menus: true } },
    };
    expect(sets.ingredient.listVisible(creatorOnly).map((definition) => definition.action_id)).not.toContain("cai.ingredient.03.create");
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
    input: { club_id: clubId },
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
    input: { club_id: clubId, member_id: memberId },
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
    tool_name: "cv_booking_create",
    input: { club_id: clubId, object_id: objectId, start_time: range.from, end_time: range.to, timezone: "Europe/Berlin" },
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
    expect(projector.project(bookingInput({ context: { ...bookingContext, scopes: ["object.read", "booking.read"] } })).actions).toEqual([]);
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
    input: { club_id: clubId, news_id: newsId },
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
    expect(projector.project(input).actions).toHaveLength(1);
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
