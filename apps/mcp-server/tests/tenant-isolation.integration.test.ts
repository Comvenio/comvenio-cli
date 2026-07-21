import { describe, expect, test } from "bun:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
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
import { PublicToolSubset } from "../src/public/index.ts";
import { createK7ToolSets, createK8ToolSets, createK9ToolSets, createK10ToolSets, createK11ToolSets, createK12ToolSets, createK13ToolSet } from "../src/tools/index.ts";

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
