import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";

import type { K11ActionDefinition, K11OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function label(value: JsonValue, fallback: string): string { const data = record(value); return typeof data.name === "string" ? data.name : fallback; }

async function current(input: JsonObject, definition: K11ActionDefinition, context: RequestContext, client: ComvenioApiClient): Promise<{ subject: string; state: JsonValue | null }> {
  try {
    if (typeof input.recipe_id === "string") { const value = await client.request<JsonValue>({ method: "GET", service: "supply", path: `/recipe/club/${input.club_id}/recipes/${input.recipe_id}`, context }); return { subject: label(value, "Rezept"), state: { version: record(value).version ?? null } }; }
    if (typeof input.menu_id === "string") { const value = await client.request<JsonValue>({ method: "GET", service: "supply", path: `/menu/club/${input.club_id}/menus/${input.menu_id}`, context }); return { subject: label(value, "Speisekarte"), state: { version: record(value).version ?? null } }; }
    if (typeof input.shopping_list_id === "string") { const value = await client.request<JsonValue>({ method: "GET", service: "supply", path: `/shopping/lists/${input.shopping_list_id}`, context }); return { subject: label(value, "Einkaufsliste"), state: { version: record(value).version ?? null, status: record(value).status ?? null } }; }
  } catch { /* Preview remains actor/club/input bound even without the optional label read. */ }
  return { subject: definition.domain === "menu" ? "Speisekarte" : definition.domain === "shopping" ? "Einkaufsliste" : definition.domain === "recipe" ? "Rezept" : "Versorgungsobjekt", state: null };
}

export async function buildK11Preview(definition: K11ActionDefinition, operation: K11OperationDefinition, inputValue: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
  const input = record(inputValue);
  const value = await current(input, definition, context, client);
  const effects: JsonValue[] = [{ type: "risk", risk_class: operation.risk_class }, { type: "backend_rbac_recheck", enabled: true }];
  if (value.state) effects.push({ type: "current_state", value: value.state });
  if (/delete|unassign/u.test(operation.operation)) effects.push({ type: "destructive_change", recoverable: false });
  if (definition.action_id === "cai.recipe.01.create" || definition.action_id === "cai.recipe.02.from_template") effects.push({ type: "ingredient_materialization", enabled: true });
  if (definition.action_id === "cai.menu.09.apply") effects.push({ type: "mass_effect", item_count: Array.isArray(record(input.menu ?? {}).items) ? (record(input.menu ?? {}).items as JsonValue[]).length : 0 });
  return { subject: value.subject, summary: `${definition.source_action}: ${operation.operation} benötigt eine zweite, unveränderte Bestätigung.`, effects };
}
