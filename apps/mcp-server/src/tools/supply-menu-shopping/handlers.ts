import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import { createConnectorError, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";

import { scaleRecipeQuantities } from "./calculation.ts";
import { boundedList, minimizeShoppingList, minimizeTemplate, redactSupplyValue } from "./privacy.ts";
import type { K11ActionId } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
type Handler = (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => Promise<JsonValue>;
function record(value: JsonValue): JsonObject { if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error("Die validierte K11-Eingabe ist kein Objekt."); return value; }
function string(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string") throw new Error(`${key} fehlt.`); return value; }
function object(input: JsonObject, key: string): JsonObject { return record(input[key] ?? {}); }
function query(input: JsonObject, keys: readonly string[]): Record<string, string> { return Object.fromEntries(keys.flatMap((key) => { const value = input[key]; return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [[key, String(value)]] : []; })); }
function pick(input: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(keys.flatMap((key) => input[key] === undefined ? [] : [[key, input[key]!]]));
}
function assertClub(value: JsonValue, input: JsonObject, context: RequestContext): JsonValue {
  const clubId = string(input, "club_id");
  const list = Array.isArray(value) ? value : [value];
  if (list.some((entry) => { const item = entry !== null && typeof entry === "object" && !Array.isArray(entry) ? entry : {}; return typeof item.club_id === "string" && item.club_id !== clubId; })) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Supply-Service lieferte Daten eines anderen Vereins.", request_id: context.request_id, retryable: false });
  }
  return value;
}
const handlers = new Map<string, Handler>();
const key = (actionId: K11ActionId, operation: string) => `${actionId}:${operation}`;
const add = (actionId: K11ActionId, operation: string, handler: Handler) => handlers.set(key(actionId, operation), handler);
const fixed = (path: string) => () => path;
const by = (prefix: string, id: string, suffix = "") => (input: JsonObject) => `${prefix}${string(input, id)}${suffix}`;

function simple(actionId: K11ActionId, operation: string, method: ComvenioHttpMethod, path: (input: JsonObject) => string, options: {
  query?: (input: JsonObject) => Record<string, string>; body?: (input: JsonObject) => JsonValue;
  response?: (value: JsonValue, input: JsonObject, context: RequestContext) => JsonValue; deleted_id?: string; templates?: boolean;
} = {}): void {
  add(actionId, operation, async (input, context, client) => {
    const value = await client.request<JsonValue>({ method, service: "supply", path: path(input), context, ...(options.query ? { query: options.query(input) } : {}), ...(options.body ? { body: options.body(input) } : {}) });
    if (options.deleted_id) return { deleted: true, id: string(input, options.deleted_id) };
    if (options.templates) return Array.isArray(value) ? boundedList(value, Number(input.limit), minimizeTemplate) : minimizeTemplate(value);
    return options.response ? options.response(value, input, context) : redactSupplyValue(assertClub(value, input, context));
  });
}

simple("cai.recipe.01.create", "create", "POST", (i) => `/recipe/club/${string(i, "club_id")}/from-ai-dish`, { body: (i) => ({ name: i.name!, type_of_recipe: i.type_of_recipe!, category: i.category ?? null, selling_price: i.selling_price ?? null, ingredients: i.ingredients!, auto_create_missing_ingredients: true }) });
simple("cai.recipe.02.from_template", "create", "POST", fixed("/global-dish-templates/create-recipe"), { body: (i) => ({ template_id: i.template_id!, club_id: i.club_id!, custom_price: i.custom_price ?? null, custom_name: i.custom_name ?? null, auto_create_missing_ingredients: true }) });
simple("cai.recipe.03.list", "list", "GET", (i) => `/recipe/club/${string(i, "club_id")}/recipes`, { query: (i) => query(i, ["search"]), response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)) });
simple("cai.recipe.04.show", "show", "GET", (i) => `/recipe/club/${string(i, "club_id")}/recipes/${string(i, "recipe_id")}`, { response: (value, input, context) => scaleRecipeQuantities(redactSupplyValue(assertClub(value, input, context)), Number(input.portions), context) });
simple("cai.recipe.05.update", "update", "PUT", (i) => `/recipe/club/${string(i, "club_id")}/recipes/${string(i, "recipe_id")}`, { body: (i) => object(i, "changes") });
simple("cai.recipe.06.delete", "delete", "DELETE", (i) => `/recipe/club/${string(i, "club_id")}/recipes/${string(i, "recipe_id")}`, { deleted_id: "recipe_id" });

simple("cai.ingredient.01.list", "list", "GET", (i) => `/ingredients/club/${string(i, "club_id")}/ingredients`, { query: (i) => ({ ...query(i, ["search", "category_id"]), skip: String(i.offset), limit: String(i.limit) }), response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)) });
simple("cai.ingredient.02.show", "show", "GET", by("/ingredients/", "ingredient_id"));
simple("cai.ingredient.03.create", "create", "POST", (i) => `/ingredients/club/${string(i, "club_id")}`, { body: (i) => object(i, "ingredient") });
simple("cai.ingredient.04.update", "update", "PUT", by("/ingredients/", "ingredient_id"), { body: (i) => object(i, "changes") });
simple("cai.ingredient.05.delete", "delete", "DELETE", by("/ingredients/", "ingredient_id"), { deleted_id: "ingredient_id" });

for (const [actionId, suffix, operation] of [
  ["cai.ingredient-category.01.list", "", "list"], ["cai.ingredient-category.02.roots", "/roots", "roots"], ["cai.ingredient-category.03.tree", "/tree", "tree"],
] as const) simple(actionId, operation, "GET", (i) => `/ingredient-categories/by-club/${string(i, "club_id")}${suffix}`, { query: (i) => query(i, ["category_type", "parent_id", "active_only"]) });
simple("cai.ingredient-category.04.by_ingredient", "list", "GET", by("/ingredient-categories/by-ingredient/", "ingredient_id"));
simple("cai.ingredient-category.05.show", "show", "GET", by("/ingredient-categories/", "category_id"));
simple("cai.ingredient-category.06.create", "create", "POST", fixed("/ingredient-categories/"), { body: (i) => ({ ...object(i, "category"), club_id: i.club_id! }) });
simple("cai.ingredient-category.07.update", "update", "PUT", by("/ingredient-categories/", "category_id"), { body: (i) => object(i, "changes") });
simple("cai.ingredient-category.08.delete", "delete", "DELETE", by("/ingredient-categories/", "category_id"), { query: (i) => ({ hard_delete: String(i.hard_delete) }), deleted_id: "category_id" });
for (const action of ["assign", "unassign"] as const) simple(`cai.ingredient-category.${action === "assign" ? "09.assign" : "10.unassign"}`, action, "POST", fixed(`/ingredient-categories/${action}`), { body: (i) => ({ ingredient_id: i.ingredient_id!, category_id: i.category_id! }) });
simple("cai.ingredient-category.11.init", "initialize", "POST", (i) => `/ingredient-categories/initialize/${string(i, "club_id")}`);

simple("cai.shopping.01.list", "list", "GET", (i) => `/shopping/club/${string(i, "club_id")}/lists`, { query: (i) => ({ ...query(i, ["search", "status"]), skip: String(i.offset), limit: String(i.limit) }), response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)) });
simple("cai.shopping.02.active", "list", "GET", (i) => `/shopping/club/${string(i, "club_id")}/lists/active`, { response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)) });
simple("cai.shopping.03.completed", "list", "GET", (i) => `/shopping/club/${string(i, "club_id")}/lists/completed`, { response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)) });
simple("cai.shopping.04.by_context", "list", "GET", (i) => `/shopping/club/${string(i, "club_id")}/shopping-lists/${string(i, "context_id")}`, { response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)) });
simple("cai.shopping.05.by_context_type", "list", "GET", (i) => `/shopping/club/${string(i, "club_id")}/shopping-lists/context-type/${string(i, "context_type")}`, { response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)) });
simple("cai.shopping.06.show", "show", "GET", by("/shopping/lists/", "shopping_list_id"), { response: (value, input, context) => minimizeShoppingList(assertClub(value, input, context), Number(input.item_limit)) });
simple("cai.shopping.07.create", "create", "POST", (i) => `/shopping/club/${string(i, "club_id")}/lists`, { body: (i) => object(i, "shopping_list") });
simple("cai.shopping.08.update", "update", "PUT", (i) => `/shopping/club/${string(i, "club_id")}/lists/${string(i, "shopping_list_id")}`, { body: (i) => object(i, "changes") });
simple("cai.shopping.09.delete", "delete", "DELETE", (i) => `/shopping/club/${string(i, "club_id")}/lists/${string(i, "shopping_list_id")}`, { deleted_id: "shopping_list_id" });
simple("cai.shopping.10.item_add", "add", "POST", (i) => `/shopping/club/${string(i, "club_id")}/lists/${string(i, "shopping_list_id")}/items`, { body: (i) => object(i, "item") });
simple("cai.shopping.11.item_update", "update", "PUT", (i) => `/shopping/club/${string(i, "club_id")}/items/${string(i, "item_id")}`, { body: (i) => object(i, "changes") });
simple("cai.shopping.12.item_delete", "delete", "DELETE", (i) => `/shopping/club/${string(i, "club_id")}/items/${string(i, "item_id")}`, { deleted_id: "item_id" });
simple("cai.shopping.13.purchased", "set", "PATCH", (i) => `/shopping/club/${string(i, "club_id")}/items/${string(i, "item_id")}/purchased`, { query: (i) => ({ purchased: String(i.purchased) }) });
simple("cai.shopping.procurement.list", "list", "GET", fixed("/procurement/ongoing"), {
  query: (i) => query(i, ["club_id", "building_id", "room_id"]),
  response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)),
});
simple("cai.shopping.procurement.templates", "list", "GET", fixed("/procurement/templates"), {
  query: (i) => query(i, ["club_id", "building_id", "room_id"]),
  response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)),
});
simple("cai.shopping.procurement.activate", "activate", "POST", (i) => `/procurement/templates/${string(i, "template_id")}/activate`, {
  query: (i) => query(i, ["club_id"]),
  body: (i) => pick(i, ["quantity", "notes"]),
});
simple("cai.shopping.procurement.add", "add", "POST", fixed("/procurement/items"), {
  query: (i) => query(i, ["club_id"]),
  body: (i) => pick(i, ["name", "ingredient_id", "quantity", "unit", "notes", "building_id", "room_id"]),
});
simple("cai.shopping.procurement.purchase", "purchase", "PATCH", (i) => `/procurement/items/${string(i, "item_id")}/purchase`, {
  query: (i) => query(i, ["club_id"]),
});
simple("cai.shopping.procurement.template_create", "create", "POST", fixed("/procurement/templates"), {
  query: (i) => query(i, ["club_id"]),
  body: (i) => pick(i, ["name", "ingredient_id", "default_quantity", "unit", "notes", "building_id", "room_id"]),
});
simple("cai.shopping.procurement.template_update", "update", "PATCH", (i) => `/procurement/templates/${string(i, "template_id")}`, {
  query: (i) => query(i, ["club_id"]),
  body: (i) => object(i, "changes"),
});
simple("cai.shopping.procurement.template_deactivate", "deactivate", "PATCH", (i) => `/procurement/templates/${string(i, "template_id")}`, {
  query: (i) => query(i, ["club_id"]),
  body: () => ({ is_active: false }),
});

for (const [actionId, prefix] of [["cai.template.01.dish", "/global-dish-templates/"], ["cai.template.02.ingredient", "/global-ingredient-templates/"]] as const) {
  simple(actionId, "list", "GET", fixed(prefix), { query: (i) => query(i, ["search", "category", "common_only", "limit"]), templates: true });
  simple(actionId, "show", "GET", by(prefix, "template_id"), { templates: true });
}

simple("cai.menu.01.create", "create", "POST", (i) => `/menu/club/${string(i, "club_id")}/menus`, { body: (i) => object(i, "menu") });
simple("cai.menu.02.list", "list", "GET", (i) => `/menu/club/${string(i, "club_id")}/menus`, { response: (value, input, context) => boundedList(assertClub(value, input, context), Number(input.limit)) });
simple("cai.menu.03.show", "show", "GET", (i) => `/menu/club/${string(i, "club_id")}/menus/${string(i, "menu_id")}`, { response: (value, input, context) => {
  const menu = record(redactSupplyValue(assertClub(value, input, context))); const items = Array.isArray(menu.menu_items) ? menu.menu_items : [];
  return { ...menu, menu_items: items.slice(0, Number(input.item_limit)), items_truncated: items.length > Number(input.item_limit) };
} });
simple("cai.menu.04.add_item", "add", "POST", (i) => `/menu/club/${string(i, "club_id")}/items`, { body: (i) => ({ ...object(i, "item"), menu_id: i.menu_id! }) });
simple("cai.menu.05.update_item", "update", "PUT", by("/menu/items/", "item_id"), { body: (i) => object(i, "changes") });
simple("cai.menu.06.delete_item", "delete", "DELETE", by("/menu/items/", "item_id"), { deleted_id: "item_id" });
simple("cai.menu.07.delete", "delete", "DELETE", (i) => `/menu/club/${string(i, "club_id")}/menus/${string(i, "menu_id")}`, { deleted_id: "menu_id" });
add("cai.menu.08.style", "style", async (input, context, client) => {
  const current = record(assertClub(await client.request<JsonValue>({ method: "GET", service: "supply", path: `/menu/club/${string(input, "club_id")}/menus/${string(input, "menu_id")}`, context }), input, context));
  const design = { ...record(current.design_config ?? {}), ...object(input, "design") };
  return redactSupplyValue(assertClub(await client.request<JsonValue>({ method: "PUT", service: "supply", path: `/menu/club/${string(input, "club_id")}/menus/${string(input, "menu_id")}`, context, body: { design_config: design } }), input, context));
});
add("cai.menu.09.apply", "apply", async (input, context, client) => {
  const card = object(input, "menu");
  const items = card.items as JsonValue[];
  const created = record(assertClub(await client.request<JsonValue>({ method: "POST", service: "supply", path: `/menu/club/${string(input, "club_id")}/menus`, context, body: Object.fromEntries(Object.entries(card).filter(([key]) => !["items", "design_config"].includes(key))) }), input, context));
  const menuId = typeof created.id === "string" ? created.id : null;
  if (!menuId) throw new Error("Der Supply-Service hat keine Menu-ID geliefert.");
  const payload = items.map((entry) => ({ ...record(entry), menu_id: menuId }));
  const bulk = await client.request<JsonValue>({ method: "POST", service: "supply", path: `/menu/club/${string(input, "club_id")}/items/bulk`, context, body: payload });
  let styled: JsonValue = created;
  if (card.design_config !== undefined) styled = await client.request<JsonValue>({ method: "PUT", service: "supply", path: `/menu/club/${string(input, "club_id")}/menus/${menuId}`, context, body: { design_config: card.design_config } });
  return { menu: redactSupplyValue(assertClub(styled, input, context)), items: redactSupplyValue(bulk) };
});

export function hasK11OperationHandler(actionId: K11ActionId, operation: string): boolean { return handlers.has(key(actionId, operation)); }
export async function executeK11Operation(actionId: K11ActionId, operation: string, inputValue: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<JsonValue> {
  const handler = handlers.get(key(actionId, operation)); if (!handler) throw new Error(`${actionId}:${operation}: Der typisierte Handler fehlt.`); return handler(record(inputValue), context, client);
}
