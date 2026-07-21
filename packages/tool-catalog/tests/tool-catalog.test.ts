import { describe, expect, test } from "bun:test";

import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";
import {
  FailClosedRecordingComvenioClient,
  ToolCatalog,
  compileProviderCatalog,
  createToolGroupKey,
  deriveAnnotations,
  resolveOperationPermissionAudit,
  validateOperationDefinition,
  type BackendRoutePermissionAudit,
  type CopyFixture,
  type FixtureStore,
  type JsonSchemaDocument,
  type OperationBindingMetadata,
  type OperationDefinition,
  type RouteTraceFixture,
  type RouteTraceRegistry,
  type SchemaRegistry,
  type SharedHandlerRegistry,
  type ToolCatalogSnapshot,
} from "../src/index.ts";

const clubId = "33333333-3333-4333-8333-333333333333";
const context: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "mcp",
  provider: "openai",
  subject_id: "22222222-2222-4222-8222-222222222222",
  oauth_grant_id: "44444444-4444-4444-8444-444444444444",
  club_id: clubId,
  department_id: null,
  scopes: ["event.read"],
  capability_version: "cap-v1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

const inputRef = "schemas/event.list.input.json";
const outputRef = "schemas/event.list.output.json";
const routeRef = "fixtures/event.list.route-trace.json";
const inputFixtureRef = "fixtures/event.list.input.json";
const responseFixtureRef = "fixtures/event.list.response.json";
const errorFixtureRef = "fixtures/event.list.error.403.json";
const idsFixtureRef = "fixtures/ids.json";

const inputSchema: JsonSchemaDocument = {
  $id: inputRef,
  type: "object",
  additionalProperties: false,
  required: ["club_id", "month"],
  properties: {
    club_id: { type: "string", format: "uuid" },
    month: { type: "string" },
  },
};
const outputSchema: JsonSchemaDocument = {
  $id: outputRef,
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: { type: "string" } },
  },
};

const operation: OperationDefinition = {
  operation_id: "event.list",
  domain: "event",
  legacy_action_id: "cai.event.01.list",
  source_branch_locators: ["src/commands/event.ts:event.list"],
  shared_handler_ref: "@comvenio/tool-catalog/operations/event/list",
  route_trace_fixture_ref: routeRef,
  input_schema_ref: inputRef,
  output_schema_ref: outputRef,
  required_scopes: ["event.read"],
  permission_policy: {
    all_of: ["view_events"],
    any_of: [],
    owner_or_self_allowed: false,
    department_scope: "optional",
    backend_audit_refs: ["audit.event.list"],
  },
  risk_class: "read",
  execution_mode: "inline",
  external_effect: "comvenio_private",
  idempotency: "read",
  confirmation: "none",
};

const routeTrace: RouteTraceFixture = {
  contract_version: "1.0.0",
  operation_id: operation.operation_id,
  source_branch_locators: [...operation.source_branch_locators],
  operation_input_fixture_ref: inputFixtureRef,
  fixture_clock: "2026-07-21T10:00:00.000Z",
  fixture_ids_ref: idsFixtureRef,
  execution_client: "FailClosedRecordingComvenioClient",
  steps: [{
    sequence: 1,
    http_method: "GET",
    service: "event",
    normalized_path_template: "/events/club/{club_id}",
    request_matcher: {
      path_parameters: { club_id: clubId },
      query_parameters: { month: "2026-07" },
      authorization: "fixture_bearer_required",
      content_type: null,
      idempotency_key: "absent",
      body_fixture_ref: null,
      body_match: "exact_rfc8785",
    },
    request_schema_ref: null,
    response_status: 200,
    response_fixture_ref: responseFixtureRef,
    error_response_fixture_refs: [errorFixtureRef],
    response_schema_ref: outputRef,
  }],
  terminal_output_schema_ref: outputRef,
};

const permissionAudit: BackendRoutePermissionAudit = {
  contract_version: "1.0.0",
  backend_source_hash_sha256: "a".repeat(64),
  entries: [{
    audit_id: "audit.event.list",
    service: "event",
    http_method: "GET",
    normalized_path_template: "/events/club/{club_id}",
    backend_function: "list_events",
    source_locator: "Backend/Microservice-Backend/event-service/app/routes/event.py:100",
    authentication: "jwt",
    permission_policy: structuredClone(operation.permission_policy),
    classification: "classified",
  }],
  unclassified_count: 0,
};

function mapRegistry<T>(entries: Record<string, T>): { get(ref: string): T | undefined } {
  const values = new Map(Object.entries(entries));
  return { get: (ref) => values.get(ref) };
}

function fixtures(): FixtureStore {
  return mapRegistry<JsonValue>({
    [inputFixtureRef]: { club_id: clubId, month: "2026-07" },
    [responseFixtureRef]: { items: ["Sommerfest"] },
    [errorFixtureRef]: { status: 403, body: { code: "PERMISSION_DENIED" } },
    [idsFixtureRef]: { idempotency_key: "55555555-5555-4555-8555-555555555555" },
  });
}

function schemas(): SchemaRegistry {
  return mapRegistry<JsonSchemaDocument>({
    [inputRef]: inputSchema,
    [outputRef]: outputSchema,
  });
}

function routeTraces(): RouteTraceRegistry {
  return mapRegistry<RouteTraceFixture>({ [routeRef]: routeTrace });
}

function handlers(options: { skipCall?: boolean; extraCall?: boolean } = {}): SharedHandlerRegistry {
  return mapRegistry({
    [operation.shared_handler_ref]: async (input: JsonValue, dependencies: Parameters<NonNullable<ReturnType<SharedHandlerRegistry["get"]>>>[1]) => {
      if (options.skipCall) return { items: [] };
      const request = {
        method: "GET" as const,
        service: "event",
        path: `/events/club/${clubId}`,
        context: dependencies.context,
        query: { month: (input as { month: string }).month },
      };
      const response = await dependencies.client.request<JsonValue>(request);
      if (options.extraCall) await dependencies.client.request(request);
      return response;
    },
  });
}

function compilerInput() {
  const groupHash = createToolGroupKey(operation).sha256;
  const copy: CopyFixture = {
    group_key_sha256: groupHash,
    fixture_ref: "copy/event.read.json",
    title: "Comvenio: Veranstaltungen anzeigen",
    description: "Zeigt berechtigte Veranstaltungen des gewählten Vereins.",
  };
  const binding: OperationBindingMetadata = {
    operation_id: operation.operation_id,
    command_expression: "event list",
    argument_mapper_ref: "bindings/event/list.args",
    renderer_ref: "bindings/event/list.renderer",
    compatibility_fixture_ref: "fixtures/event/list.cli.json",
    operation_discriminator: operation.operation_id,
    widget_resource_uri: "ui://comvenio/event-calendar",
  };
  return {
    operations: [operation],
    schemas: schemas(),
    route_traces: routeTraces(),
    fixtures: fixtures(),
    permission_audit: permissionAudit,
    allowed_permission_keys: new Set(["view_events"]),
    verified_route_trace_refs: new Set([routeRef]),
    copy_fixtures: new Map([[groupHash, copy]]),
    binding_metadata: new Map([[operation.operation_id, binding]]),
    action_inventory_version: "1.0.0",
  };
}

describe("audited tool catalog compiler", () => {
  test("materializes identical OpenAI and Anthropic tools only from complete operations", () => {
    const output = compileProviderCatalog(compilerInput());
    expect(output.catalog.operations).toHaveLength(1);
    expect(output.catalog.cli_bindings).toEqual([expect.objectContaining({
      operation_id: "event.list",
      command_expression: "event list",
    })]);
    expect(output.catalog.mcp_bindings).toEqual([expect.objectContaining({
      operation_id: "event.list",
      widget_resource_uri: "ui://comvenio/event-calendar",
    })]);
    expect(output.providers.openai).toEqual(output.providers.anthropic);
    expect(output.providers.openai[0]).toMatchObject({
      title: "Comvenio: Veranstaltungen anzeigen",
      risk_class: "read",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(output.providers.openai[0]?.tool_name.length).toBeLessThanOrEqual(64);
    expect([...output.generated_schemas.keys()]).toHaveLength(2);
  });

  test("blocks missing semantic trace evidence, copy and unsafe dispatch refs", () => {
    expect(() => compileProviderCatalog({
      ...compilerInput(),
      verified_route_trace_refs: new Set(),
    })).toThrow("Semantischer Route-Trace wurde nicht verifiziert");
    expect(() => compileProviderCatalog({
      ...compilerInput(),
      copy_fixtures: new Map(),
    })).toThrow("Copy-Fixture fehlt");
    expect(() => validateOperationDefinition({
      ...operation,
      shared_handler_ref: "run_cli_command",
    }, schemas(), new Set(["view_events"]))).toThrow("shared_handler_ref ist unsicher");
  });

  test("derives critical and open-world annotations without provider overrides", () => {
    expect(deriveAnnotations({
      ...operation,
      risk_class: "critical_write",
      external_effect: "comvenio_public",
      idempotency: "key_required",
      confirmation: "required",
    })).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});

describe("FailClosedRecordingComvenioClient", () => {
  test("executes the exact route trace with fixed clock and fixtures", async () => {
    const client = new FailClosedRecordingComvenioClient({
      fixture: routeTrace,
      fixtures: fixtures(),
      schemas: schemas(),
      handlers: handlers(),
      context,
    });
    await expect(client.execute(operation.shared_handler_ref, {
      club_id: clubId,
      month: "2026-07",
    })).resolves.toEqual({ items: ["Sommerfest"] });
    expect(client.consumed_steps).toBe(1);
  });

  test("rejects missing, additional and out-of-order calls without a network fallback", async () => {
    const missing = new FailClosedRecordingComvenioClient({
      fixture: routeTrace,
      fixtures: fixtures(),
      schemas: schemas(),
      handlers: handlers({ skipCall: true }),
      context,
    });
    await expect(missing.execute(operation.shared_handler_ref, {
      club_id: clubId,
      month: "2026-07",
    })).rejects.toMatchObject({ code: "ROUTE_TRACE_MISMATCH" });

    const additional = new FailClosedRecordingComvenioClient({
      fixture: routeTrace,
      fixtures: fixtures(),
      schemas: schemas(),
      handlers: handlers({ extraCall: true }),
      context,
    });
    await expect(additional.execute(operation.shared_handler_ref, {
      club_id: clubId,
      month: "2026-07",
    })).rejects.toMatchObject({ code: "ROUTE_TRACE_MISMATCH" });

    const wrongMethodTrace = structuredClone(routeTrace);
    wrongMethodTrace.steps[0]!.http_method = "POST";
    const outOfOrder = new FailClosedRecordingComvenioClient({
      fixture: wrongMethodTrace,
      fixtures: fixtures(),
      schemas: schemas(),
      handlers: handlers(),
      context,
    });
    await expect(outOfOrder.execute(operation.shared_handler_ref, {
      club_id: clubId,
      month: "2026-07",
    })).rejects.toMatchObject({ code: "ROUTE_TRACE_MISMATCH" });
  });
});

describe("backend permission binding", () => {
  test("requires byte-equivalent policy and exact route audit refs", () => {
    expect(resolveOperationPermissionAudit(operation, routeTrace, permissionAudit)).toHaveLength(1);
    const changed = structuredClone(permissionAudit);
    changed.entries[0]!.permission_policy.all_of = ["manage_events"];
    expect(() => resolveOperationPermissionAudit(operation, routeTrace, changed))
      .toThrow("PermissionPolicy widerspricht");
  });

  test("keeps catalog visibility separate from backend enforcement", () => {
    const compiled = compileProviderCatalog(compilerInput());
    const catalog = new ToolCatalog(compiled.catalog as ToolCatalogSnapshot);
    expect(catalog.listVisible({ context, capabilities: new Set() })).toEqual([]);
    expect(catalog.listVisible({ context, capabilities: new Set(["view_events"]) })).toHaveLength(1);
  });
});
