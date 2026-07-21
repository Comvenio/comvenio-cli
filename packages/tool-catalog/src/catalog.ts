import { ToolVisibilityPolicy } from "@comvenio/auth";

import type {
  CatalogCallRequest,
  McpBinding,
  OperationDefinition,
  ToolCatalogSnapshot,
  ToolCatalogVisibilityContext,
  ToolDefinition,
} from "./types.ts";
import {
  assertCatalog,
  validateOperationDefinition,
  validateToolDefinition,
} from "./validation.ts";

function isPublicTool(tool: ToolDefinition): boolean {
  return tool.required_scopes.length > 0
    && tool.required_scopes.every((scope) => scope === "public.read")
    && tool.permission_policy.backend_audit_refs.some((ref) => /public/iu.test(ref));
}

const visibilityPolicy = new ToolVisibilityPolicy();

function visibility(tool: ToolDefinition, input: ToolCatalogVisibilityContext) {
  return visibilityPolicy.evaluate({
    tool: {
      tool_name: tool.tool_name,
      required_scopes: tool.required_scopes,
      permission_policy: tool.permission_policy,
      is_public: isPublicTool(tool),
    },
    context: input.context,
    snapshot: input.capability_snapshot,
    provider_tool_updates: input.provider_tool_updates,
    catalog_contains_tool: true,
  });
}

export class ToolCatalog {
  readonly #snapshot: ToolCatalogSnapshot;
  readonly #tools = new Map<string, ToolDefinition>();
  readonly #operations = new Map<string, OperationDefinition>();
  readonly #mcpBindings = new Map<string, McpBinding>();

  constructor(snapshot: ToolCatalogSnapshot) {
    assertCatalog(snapshot.contract_version === "1.0.0", "ToolCatalog-Version ist ungültig.");
    this.#snapshot = structuredClone(snapshot);
    assertCatalog(/^[a-f0-9]{64}$/u.test(this.#snapshot.source_hash_sha256),
      "ToolCatalog-Source-Hash ist ungültig.");
    for (const operation of this.#snapshot.operations) {
      assertCatalog(!this.#operations.has(operation.operation_id),
        `Doppelte Operation ${operation.operation_id}.`);
      this.#operations.set(operation.operation_id, operation);
    }
    for (const tool of this.#snapshot.tools) {
      validateToolDefinition(tool);
      assertCatalog(!this.#tools.has(tool.tool_name), `Doppeltes Tool ${tool.tool_name}.`);
      assertCatalog(tool.operation_ids.every((operationId) => this.#operations.has(operationId)),
        `${tool.tool_name}: Unbekannte Operation.`);
      this.#tools.set(tool.tool_name, tool);
    }
    for (const binding of this.#snapshot.mcp_bindings) {
      assertCatalog(!this.#mcpBindings.has(binding.operation_id),
        `Doppeltes MCP-Binding ${binding.operation_id}.`);
      const tool = this.#tools.get(binding.tool_name);
      assertCatalog(tool?.operation_ids.includes(binding.operation_id),
        `${binding.operation_id}: MCP-Binding verweist auf ein falsches Tool.`);
      assertCatalog(binding.operation_discriminator === binding.operation_id,
        `${binding.operation_id}: MCP-Discriminator muss der operation_id entsprechen.`);
      this.#mcpBindings.set(binding.operation_id, binding);
    }
    const cliOperationIds = this.#snapshot.cli_bindings.map((binding) => binding.operation_id);
    assertCatalog(new Set(cliOperationIds).size === cliOperationIds.length,
      "Jede publizierte Operation darf nur ein CLI-Binding besitzen.");
    assertCatalog(this.#snapshot.operations.every((operation) => this.#mcpBindings.has(operation.operation_id)),
      "Jede publizierte Operation benötigt genau ein MCP-Binding.");
    assertCatalog(this.#snapshot.operations.every((operation) =>
      this.#snapshot.cli_bindings.some((binding) => binding.operation_id === operation.operation_id)),
    "Jede publizierte Operation benötigt genau ein CLI-Binding.");
  }

  get snapshot(): ToolCatalogSnapshot {
    return structuredClone(this.#snapshot);
  }

  listVisible(input: ToolCatalogVisibilityContext): ToolDefinition[] {
    return [...this.#tools.values()]
      .filter((tool) => visibility(tool, input).visible)
      .sort((a, b) => a.tool_name.localeCompare(b.tool_name))
      .map((tool) => structuredClone(tool));
  }

  resolveCall(
    request: CatalogCallRequest,
    input: ToolCatalogVisibilityContext,
  ): {
    tool: ToolDefinition;
    operation: OperationDefinition;
    binding: McpBinding;
    authorization: {
      backend_recheck_required: true;
      capability_version: string | null;
    };
  } {
    const tool = this.#tools.get(request.tool_name);
    assertCatalog(tool, "Tool wurde nicht gefunden.", "TOOL_NOT_FOUND");
    assertCatalog(tool.operation_ids.includes(request.operation_id),
      "Operation gehört nicht zum angeforderten Tool.", "TOOL_NOT_FOUND");
    if (!isPublicTool(tool)) {
      assertCatalog(request.club_id !== null && input.context.club_id !== null,
        "Ein privater Tool-Aufruf benötigt einen expliziten Verein.", "TENANT_MISMATCH");
      assertCatalog(request.club_id === input.context.club_id,
        "Der angeforderte Verein stimmt nicht mit dem Rechtekontext überein.", "TENANT_MISMATCH");
    }
    const decision = visibility(tool, input);
    assertCatalog(decision.authorized, "Tool ist im aktuellen Rechtekontext nicht autorisiert.",
      decision.reason === "TENANT_MISMATCH" || decision.reason === "DEPARTMENT_MISMATCH"
        ? "TENANT_MISMATCH"
        : "TOOL_NOT_VISIBLE");
    const operation = this.#operations.get(request.operation_id);
    const binding = this.#mcpBindings.get(request.operation_id);
    assertCatalog(operation && binding, "Katalogbindung ist unvollständig.");
    return {
      tool: structuredClone(tool),
      operation: structuredClone(operation),
      binding: structuredClone(binding),
      authorization: {
        backend_recheck_required: true as const,
        capability_version: input.capability_snapshot?.capability_version ?? null,
      },
    };
  }
}

// This helper deliberately requires the caller to provide schemas. A snapshot cannot become
// executable merely because it was deserialized successfully.
export function validateCatalogOperations(
  snapshot: ToolCatalogSnapshot,
  schemas: Parameters<typeof validateOperationDefinition>[1],
  allowedPermissionKeys?: ReadonlySet<string>,
): void {
  snapshot.operations.forEach((operation) =>
    validateOperationDefinition(operation, schemas, allowedPermissionKeys));
}
