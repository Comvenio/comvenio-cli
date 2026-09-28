/**
 * The published connector actions (cai.*), read from the tool groups of the
 * MCP server: id, domain, operations with risk and scopes. The customer
 * documentation lists them per topic (02-inhalte-und-pruefung) — the way a
 * customer signed in with OAuth actually works.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

export interface ActionOperation {
  operation: string;
  risk: string;
  scopes: string[];
}

export interface InventoryAction {
  action_id: string;
  domain: string;
  operations: ActionOperation[];
}

type Definition = {
  action_id: string;
  domain: string;
  source_action: string;
  publication_state?: string;
  risk_class?: string;
  required_scopes?: string[];
  operations?: unknown;
};

export async function loadActionInventory(root: string): Promise<InventoryAction[]> {
  const tools = join(root, "apps/mcp-server/src/tools");
  const actions: InventoryAction[] = [];
  for (const group of readdirSync(tools).sort()) {
    let module: Record<string, unknown>;
    try {
      module = await import(join(tools, group, "index.ts"));
    } catch {
      continue;
    }
    const definitions = Object.entries(module)
      .filter(([name]) => name.endsWith("_ACTION_DEFINITIONS"))
      .flatMap(([, value]) => Object.values(value as Record<string, Definition>));
    for (const definition of definitions) {
      if (definition.publication_state && definition.publication_state !== "implemented") continue;
      const raw = definition.operations
        ?? [{ operation: definition.source_action, risk_class: definition.risk_class, required_scopes: definition.required_scopes }];
      const list = Array.isArray(raw)
        ? raw as Array<Record<string, unknown>>
        : Object.entries(raw as Record<string, Record<string, unknown>>).map(([operation, value]) => ({ operation, ...value }));
      actions.push({
        action_id: definition.action_id,
        domain: definition.domain,
        operations: list.map((operation) => ({
          operation: String(operation.operation),
          risk: String(operation.risk_class ?? "read"),
          scopes: [...((operation.required_scopes as string[] | undefined) ?? [])],
        })),
      });
    }
  }
  const unique = new Map(actions.map((action) => [action.action_id, action]));
  return [...unique.values()].sort((a, b) => a.action_id.localeCompare(b.action_id, "en", { numeric: true }));
}
