import type { JsonValue, OAuthScope } from "@comvenio/connector-contracts";

import {
  resolveOperationPermissionAudit,
  validateRouteTraceFixture,
} from "./route-audit.ts";
import type {
  BackendRoutePermissionAudit,
  CliBinding,
  CopyFixture,
  FixtureStore,
  JsonSchemaDocument,
  McpBinding,
  OperationBindingMetadata,
  OperationDefinition,
  RouteTraceRegistry,
  SchemaRegistry,
  ToolCatalogSnapshot,
  ToolDefinition,
} from "./types.ts";
import {
  assertCatalog,
  canonicalJson,
  deriveAnnotations,
  normalizePermissionPolicy,
  sha256,
  validateBackendRoutePermissionAudit,
  validateOperationDefinition,
  validateToolDefinition,
} from "./validation.ts";

interface CanonicalGroupKey {
  domain: string;
  required_scopes: OAuthScope[];
  risk_class: OperationDefinition["risk_class"];
  execution_mode: OperationDefinition["execution_mode"];
  idempotency: OperationDefinition["idempotency"];
  confirmation: OperationDefinition["confirmation"];
  permission_policy: ReturnType<typeof normalizePermissionPolicy>;
  external_effect: OperationDefinition["external_effect"];
}

export interface ProviderCompilerInput {
  operations: OperationDefinition[];
  schemas: SchemaRegistry;
  route_traces: RouteTraceRegistry;
  fixtures: FixtureStore;
  permission_audit: BackendRoutePermissionAudit;
  allowed_permission_keys: ReadonlySet<string>;
  verified_route_trace_refs: ReadonlySet<string>;
  copy_fixtures: ReadonlyMap<string, CopyFixture>;
  binding_metadata: ReadonlyMap<string, OperationBindingMetadata>;
  action_inventory_version: string;
}

export interface ProviderCompilerOutput {
  catalog: ToolCatalogSnapshot;
  generated_schemas: ReadonlyMap<string, JsonSchemaDocument>;
  providers: {
    openai: ToolDefinition[];
    anthropic: ToolDefinition[];
  };
}

function canonicalGroupKey(operation: OperationDefinition): CanonicalGroupKey {
  return {
    domain: operation.domain,
    required_scopes: [...operation.required_scopes].sort(),
    risk_class: operation.risk_class,
    execution_mode: operation.execution_mode,
    idempotency: operation.idempotency,
    confirmation: operation.confirmation,
    permission_policy: normalizePermissionPolicy(operation.permission_policy),
    external_effect: operation.external_effect,
  };
}

export function createToolGroupKey(operation: OperationDefinition): {
  canonical: string;
  sha256: string;
} {
  const canonical = canonicalJson(canonicalGroupKey(operation) as unknown as JsonValue);
  return { canonical, sha256: sha256(canonical) };
}

function safeSlug(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function policySlug(operation: OperationDefinition): string {
  const policy = operation.permission_policy;
  const source = policy.all_of[0]
    ?? policy.any_of[0]
    ?? (policy.owner_or_self_allowed ? "owner_self" : "public");
  return safeSlug(source).slice(0, 18) || "policy";
}

function riskSlug(operation: OperationDefinition): string {
  if (operation.risk_class === "critical_write") return "critical";
  if (operation.risk_class === "reversible_write") return "write";
  return "read";
}

export function createToolName(operation: OperationDefinition, groupHash: string): string {
  const suffix = groupHash.slice(0, 8);
  const descriptive = `cv_${safeSlug(operation.domain)}_${riskSlug(operation)}_${policySlug(operation)}`;
  const maxPrefixLength = 64 - suffix.length - 1;
  return `${descriptive.slice(0, maxPrefixLength).replace(/_+$/u, "")}_${suffix}`;
}

function inputSchemaFor(toolName: string, operations: readonly OperationDefinition[]): JsonSchemaDocument {
  const isPublic = operations.every((operation) =>
    operation.required_scopes.every((scope) => scope === "public.read")
    && operation.permission_policy.backend_audit_refs.some((ref) => /public/iu.test(ref)));
  const required = isPublic ? ["operation_id", "input"] : ["club_id", "operation_id", "input"];
  const properties = {
    ...(isPublic ? {} : { club_id: { type: "string", format: "uuid" } }),
    operation_id: { type: "string" },
    input: {
      oneOf: operations.map((operation) => ({ $ref: operation.input_schema_ref })),
    },
  };
  return {
    $id: `generated/tools/${toolName}.input.schema.json`,
    type: "object",
    additionalProperties: false,
    required,
    properties,
    oneOf: operations.map((operation) => ({
      type: "object",
      additionalProperties: false,
      required,
      properties: {
        ...(isPublic ? {} : { club_id: { type: "string", format: "uuid" } }),
        operation_id: { const: operation.operation_id },
        input: { $ref: operation.input_schema_ref },
      },
    })),
  };
}

function outputSchemaFor(toolName: string, operations: readonly OperationDefinition[]): JsonSchemaDocument {
  return {
    $id: `generated/tools/${toolName}.output.schema.json`,
    oneOf: operations.map((operation) => ({
      type: "object",
      additionalProperties: false,
      required: ["operation_id", "result"],
      properties: {
        operation_id: { const: operation.operation_id },
        result: { $ref: operation.output_schema_ref },
      },
    })),
  };
}

function cloneTools(tools: readonly ToolDefinition[]): ToolDefinition[] {
  return structuredClone(tools) as ToolDefinition[];
}

export function compileProviderCatalog(input: ProviderCompilerInput): ProviderCompilerOutput {
  validateBackendRoutePermissionAudit(input.permission_audit, input.allowed_permission_keys);
  assertCatalog(input.operations.length > 0, "Ein publizierter Katalog benötigt auditierte Operationen.");

  const operationIds = new Set<string>();
  const groups = new Map<string, OperationDefinition[]>();
  for (const operation of input.operations) {
    assertCatalog(!operationIds.has(operation.operation_id),
      `Doppelte operation_id ${operation.operation_id}.`);
    operationIds.add(operation.operation_id);
    validateOperationDefinition(operation, input.schemas, input.allowed_permission_keys);
    const routeTrace = input.route_traces.get(operation.route_trace_fixture_ref);
    assertCatalog(routeTrace, `${operation.operation_id}: Route-Trace-Fixture fehlt.`,
      "ROUTE_TRACE_MISMATCH");
    validateRouteTraceFixture(operation, routeTrace, input.fixtures, input.schemas);
    resolveOperationPermissionAudit(operation, routeTrace, input.permission_audit);
    assertCatalog(input.verified_route_trace_refs.has(operation.route_trace_fixture_ref),
      `${operation.operation_id}: Semantischer Route-Trace wurde nicht verifiziert.`,
      "ROUTE_TRACE_MISMATCH");
    const groupHash = createToolGroupKey(operation).sha256;
    groups.set(groupHash, [...(groups.get(groupHash) ?? []), operation]);
  }

  const tools: ToolDefinition[] = [];
  const cliBindings: CliBinding[] = [];
  const mcpBindings: McpBinding[] = [];
  const generatedSchemas = new Map<string, JsonSchemaDocument>();
  const toolNames = new Set<string>();

  for (const [groupHash, unsortedOperations] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const operations = [...unsortedOperations].sort((a, b) => a.operation_id.localeCompare(b.operation_id));
    const first = operations[0];
    assertCatalog(first, "Leere Toolgruppe ist ungültig.");
    const toolName = createToolName(first, groupHash);
    assertCatalog(!toolNames.has(toolName), `Toolname-Kollision ${toolName}.`);
    toolNames.add(toolName);
    const copy = input.copy_fixtures.get(groupHash);
    assertCatalog(copy && copy.group_key_sha256 === groupHash,
      `${toolName}: Reviewte Copy-Fixture fehlt.`);
    assertCatalog(copy.title.trim().length > 0 && copy.description.trim().length > 0,
      `${toolName}: Copy-Fixture ist leer.`);
    const inputSchemaRef = `generated/tools/${toolName}.input.schema.json`;
    const outputSchemaRef = `generated/tools/${toolName}.output.schema.json`;
    generatedSchemas.set(inputSchemaRef, inputSchemaFor(toolName, operations));
    generatedSchemas.set(outputSchemaRef, outputSchemaFor(toolName, operations));

    const tool: ToolDefinition = {
      tool_name: toolName,
      tool_group_key_sha256: groupHash,
      title: copy.title,
      description: copy.description,
      copy_fixture_ref: copy.fixture_ref,
      operation_ids: operations.map((operation) => operation.operation_id),
      required_scopes: [...first.required_scopes],
      risk_class: first.risk_class,
      execution_mode: first.execution_mode,
      idempotency: first.idempotency,
      confirmation: first.confirmation,
      permission_policy: structuredClone(first.permission_policy),
      external_effect: first.external_effect,
      input_schema_ref: inputSchemaRef,
      output_schema_ref: outputSchemaRef,
      annotations: deriveAnnotations(first),
    };
    validateToolDefinition(tool);
    tools.push(tool);

    for (const operation of operations) {
      const metadata = input.binding_metadata.get(operation.operation_id);
      assertCatalog(metadata, `${operation.operation_id}: CLI-/MCP-Binding-Metadaten fehlen.`);
      assertCatalog(metadata.operation_id === operation.operation_id,
        `${operation.operation_id}: Binding-Metadaten gehören zu einer anderen Operation.`);
      cliBindings.push({
        operation_id: operation.operation_id,
        command_expression: metadata.command_expression,
        argument_mapper_ref: metadata.argument_mapper_ref,
        renderer_ref: metadata.renderer_ref,
        compatibility_fixture_ref: metadata.compatibility_fixture_ref,
      });
      mcpBindings.push({
        operation_id: operation.operation_id,
        tool_name: toolName,
        operation_discriminator: metadata.operation_discriminator,
        widget_resource_uri: metadata.widget_resource_uri,
      });
    }
  }

  cliBindings.sort((a, b) => a.operation_id.localeCompare(b.operation_id));
  mcpBindings.sort((a, b) => a.operation_id.localeCompare(b.operation_id));
  tools.sort((a, b) => a.tool_name.localeCompare(b.tool_name));
  assertCatalog(new Set(cliBindings.map((binding) => binding.command_expression)).size === cliBindings.length,
    "CLI-Command-Ausdrücke müssen eindeutig sein.");
  const sortedOperations = [...input.operations].sort((a, b) => a.operation_id.localeCompare(b.operation_id));
  const source = canonicalJson({
    action_inventory_version: input.action_inventory_version,
    operations: sortedOperations,
    tools,
    cli_bindings: cliBindings,
    mcp_bindings: mcpBindings,
  } as unknown as JsonValue);
  const catalog: ToolCatalogSnapshot = {
    contract_version: "1.0.0",
    source_hash_sha256: sha256(source),
    operations: sortedOperations,
    tools,
    cli_bindings: cliBindings,
    mcp_bindings: mcpBindings,
  };
  return {
    catalog,
    generated_schemas: generatedSchemas,
    providers: {
      openai: cloneTools(tools),
      anthropic: cloneTools(tools),
    },
  };
}
