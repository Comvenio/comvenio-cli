import type { ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { OAuthScope } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";

import { K11_ACTION_IDS, type K11ActionDefinition, type K11ActionId, type K11BackendRoute, type K11Domain, type K11ExecutionGate, type K11OperationDefinition } from "./types.ts";

type PermissionProfile = "authenticated" | "supply_read" | "supply_create" | "supply_manage" | "shopping_manage";
const profiles: Record<PermissionProfile, string[]> = {
  authenticated: [],
  supply_read: ["manage_club_settings", "manage_menus", "create_menus", "manage_shopping_lists", "manage_events"],
  supply_create: ["manage_club_settings", "manage_menus", "create_menus"],
  supply_manage: ["manage_club_settings", "manage_menus"],
  shopping_manage: ["manage_club_settings", "manage_shopping_lists", "manage_events"],
};

function policy(profile: PermissionProfile): PermissionPolicy {
  return { all_of: [], any_of: [...profiles[profile]], owner_or_self_allowed: false, department_scope: "optional", backend_audit_refs: [`k11:${profile}`] };
}
function route(method: ComvenioHttpMethod, path: string, purpose?: K11BackendRoute["purpose"]): K11BackendRoute {
  return { method, service: "supply", normalized_path_template: path, purpose: purpose ?? (method === "GET" ? "read" : "mutation") };
}
function operation(input: {
  name: string; permission: PermissionProfile; method?: ComvenioHttpMethod; path?: string; routes?: K11BackendRoute[];
  risk?: ActionRisk; gate?: K11ExecutionGate; scopes?: OAuthScope[]; external?: K11OperationDefinition["external_effect"];
}): K11OperationDefinition {
  const risk = input.risk ?? (input.method === "GET" ? "read" : "reversible_write");
  return {
    operation: input.name,
    required_scopes: input.scopes ?? [risk === "read" ? "supply.read" : "supply.write"],
    permission_policy: policy(input.permission),
    risk_class: risk,
    execution_gate: input.gate ?? (risk === "read" ? "inline" : risk === "critical_write" ? "confirmation" : "write_safety"),
    backend_routes: input.routes ?? [route(input.method!, input.path!)],
    external_effect: input.external ?? (risk === "read" ? "none" : "comvenio_private"),
  };
}
const read = (name: string, path: string, permission: PermissionProfile = "supply_read") => operation({ name, permission, method: "GET", path });
const write = (name: string, method: ComvenioHttpMethod, path: string, permission: PermissionProfile, critical = false) => operation({ name, permission, method, path, ...(critical ? { risk: "critical_write" as const } : {}) });
const job = (name: string, scopes: OAuthScope[], permission: PermissionProfile, routes: K11BackendRoute[]) => operation({ name, permission, scopes, risk: "reversible_write", gate: "job", routes });
function action(action_id: K11ActionId, domain: K11Domain, source_action: string, operations: K11OperationDefinition[]): K11ActionDefinition {
  return { action_id, domain, source_action, source_path: `src/commands/${domain}.ts`, operations: Object.freeze(Object.fromEntries(operations.map((item) => [item.operation, item]))), publication_state: "implemented", blocker: null };
}

export const K11_ACTION_DEFINITIONS: Readonly<Record<K11ActionId, K11ActionDefinition>> = Object.freeze({
  "cai.recipe.01.create": action("cai.recipe.01.create", "recipe", "create", [operation({ name: "create", permission: "supply_create", risk: "critical_write", routes: [route("POST", "/recipe/club/{club_id}/from-ai-dish")] })]),
  "cai.recipe.02.from_template": action("cai.recipe.02.from_template", "recipe", "from-template", [operation({ name: "create", permission: "supply_create", risk: "critical_write", routes: [route("POST", "/global-dish-templates/create-recipe")] })]),
  "cai.recipe.03.list": action("cai.recipe.03.list", "recipe", "list", [read("list", "/recipe/club/{club_id}/recipes")]),
  "cai.recipe.04.show": action("cai.recipe.04.show", "recipe", "show", [read("show", "/recipe/club/{club_id}/recipes/{recipe_id}")]),
  "cai.recipe.05.update": action("cai.recipe.05.update", "recipe", "update", [write("update", "PUT", "/recipe/club/{club_id}/recipes/{recipe_id}", "supply_manage")]),
  "cai.recipe.06.delete": action("cai.recipe.06.delete", "recipe", "delete", [write("delete", "DELETE", "/recipe/club/{club_id}/recipes/{recipe_id}", "supply_manage", true)]),

  "cai.ingredient.01.list": action("cai.ingredient.01.list", "ingredient", "list", [read("list", "/ingredients/club/{club_id}/ingredients")]),
  "cai.ingredient.02.show": action("cai.ingredient.02.show", "ingredient", "show", [read("show", "/ingredients/{ingredient_id}")]),
  "cai.ingredient.03.create": action("cai.ingredient.03.create", "ingredient", "create", [write("create", "POST", "/ingredients/club/{club_id}", "supply_manage")]),
  "cai.ingredient.04.update": action("cai.ingredient.04.update", "ingredient", "update", [write("update", "PUT", "/ingredients/{ingredient_id}", "supply_manage")]),
  "cai.ingredient.05.delete": action("cai.ingredient.05.delete", "ingredient", "delete", [write("delete", "DELETE", "/ingredients/{ingredient_id}", "supply_manage", true)]),

  "cai.ingredient-category.01.list": action("cai.ingredient-category.01.list", "ingredient-category", "list", [read("list", "/ingredient-categories/by-club/{club_id}")]),
  "cai.ingredient-category.02.roots": action("cai.ingredient-category.02.roots", "ingredient-category", "roots", [read("roots", "/ingredient-categories/by-club/{club_id}/roots")]),
  "cai.ingredient-category.03.tree": action("cai.ingredient-category.03.tree", "ingredient-category", "tree", [read("tree", "/ingredient-categories/by-club/{club_id}/tree")]),
  "cai.ingredient-category.04.by_ingredient": action("cai.ingredient-category.04.by_ingredient", "ingredient-category", "by-ingredient", [read("list", "/ingredient-categories/by-ingredient/{ingredient_id}")]),
  "cai.ingredient-category.05.show": action("cai.ingredient-category.05.show", "ingredient-category", "show", [read("show", "/ingredient-categories/{category_id}")]),
  "cai.ingredient-category.06.create": action("cai.ingredient-category.06.create", "ingredient-category", "create", [write("create", "POST", "/ingredient-categories/", "supply_manage")]),
  "cai.ingredient-category.07.update": action("cai.ingredient-category.07.update", "ingredient-category", "update", [write("update", "PUT", "/ingredient-categories/{category_id}", "supply_manage")]),
  "cai.ingredient-category.08.delete": action("cai.ingredient-category.08.delete", "ingredient-category", "delete", [write("delete", "DELETE", "/ingredient-categories/{category_id}", "supply_manage", true)]),
  "cai.ingredient-category.09.assign": action("cai.ingredient-category.09.assign", "ingredient-category", "assign", [write("assign", "POST", "/ingredient-categories/assign", "supply_manage")]),
  "cai.ingredient-category.10.unassign": action("cai.ingredient-category.10.unassign", "ingredient-category", "unassign", [write("unassign", "POST", "/ingredient-categories/unassign", "supply_manage", true)]),
  "cai.ingredient-category.11.init": action("cai.ingredient-category.11.init", "ingredient-category", "init", [operation({ name: "initialize", permission: "supply_manage", risk: "critical_write", routes: [route("POST", "/ingredient-categories/initialize/{club_id}")] })]),

  "cai.shopping.01.list": action("cai.shopping.01.list", "shopping", "list", [read("list", "/shopping/club/{club_id}/lists", "shopping_manage")]),
  "cai.shopping.02.active": action("cai.shopping.02.active", "shopping", "active", [read("list", "/shopping/club/{club_id}/lists/active", "shopping_manage")]),
  "cai.shopping.03.completed": action("cai.shopping.03.completed", "shopping", "completed", [read("list", "/shopping/club/{club_id}/lists/completed", "shopping_manage")]),
  "cai.shopping.04.by_context": action("cai.shopping.04.by_context", "shopping", "by-context", [read("list", "/shopping/club/{club_id}/shopping-lists/{context_id}", "shopping_manage")]),
  "cai.shopping.05.by_context_type": action("cai.shopping.05.by_context_type", "shopping", "by-context-type", [read("list", "/shopping/club/{club_id}/shopping-lists/context-type/{context_type}", "shopping_manage")]),
  "cai.shopping.06.show": action("cai.shopping.06.show", "shopping", "show", [
    read("show", "/shopping/lists/{shopping_list_id}", "shopping_manage"),
    job("export", ["supply.read", "files.export"], "shopping_manage", [route("GET", "/shopping/lists/{shopping_list_id}", "preflight")]),
  ]),
  "cai.shopping.07.create": action("cai.shopping.07.create", "shopping", "create", [write("create", "POST", "/shopping/club/{club_id}/lists", "shopping_manage")]),
  "cai.shopping.08.update": action("cai.shopping.08.update", "shopping", "update", [write("update", "PUT", "/shopping/club/{club_id}/lists/{shopping_list_id}", "shopping_manage")]),
  "cai.shopping.09.delete": action("cai.shopping.09.delete", "shopping", "delete", [write("delete", "DELETE", "/shopping/club/{club_id}/lists/{shopping_list_id}", "shopping_manage", true)]),
  "cai.shopping.10.item_add": action("cai.shopping.10.item_add", "shopping", "item-add", [write("add", "POST", "/shopping/club/{club_id}/lists/{shopping_list_id}/items", "shopping_manage")]),
  "cai.shopping.11.item_update": action("cai.shopping.11.item_update", "shopping", "item-update", [write("update", "PUT", "/shopping/club/{club_id}/items/{item_id}", "shopping_manage")]),
  "cai.shopping.12.item_delete": action("cai.shopping.12.item_delete", "shopping", "item-delete", [write("delete", "DELETE", "/shopping/club/{club_id}/items/{item_id}", "shopping_manage", true)]),
  "cai.shopping.13.purchased": action("cai.shopping.13.purchased", "shopping", "purchased", [write("set", "PATCH", "/shopping/club/{club_id}/items/{item_id}/purchased", "shopping_manage")]),
  "cai.shopping.14.generate_from_recipe": action("cai.shopping.14.generate_from_recipe", "shopping", "generate-from-recipe", [job("generate", ["supply.write", "files.export"], "shopping_manage", [route("POST", "/shopping/club/{club_id}/generate-from-recipe/{recipe_id}")])]),
  "cai.shopping.15.generate_from_menu": action("cai.shopping.15.generate_from_menu", "shopping", "generate-from-menu", [job("generate", ["supply.write", "files.export"], "shopping_manage", [route("POST", "/shopping/club/{club_id}/generate-from-menu/{menu_id}")])]),
  // Supply remains the sole authorization gate for facility procurement:
  // active task assignees may mutate without a cached Shopping permission.
  "cai.shopping.procurement.list": action("cai.shopping.procurement.list", "shopping", "procurement-list", [read("list", "/procurement/ongoing", "authenticated")]),
  "cai.shopping.procurement.templates": action("cai.shopping.procurement.templates", "shopping", "procurement-templates", [read("list", "/procurement/templates", "authenticated")]),
  "cai.shopping.procurement.activate": action("cai.shopping.procurement.activate", "shopping", "procurement-activate", [write("activate", "POST", "/procurement/templates/{template_id}/activate", "authenticated")]),
  "cai.shopping.procurement.add": action("cai.shopping.procurement.add", "shopping", "procurement-add", [write("add", "POST", "/procurement/items", "authenticated")]),
  "cai.shopping.procurement.purchase": action("cai.shopping.procurement.purchase", "shopping", "procurement-purchase", [write("purchase", "PATCH", "/procurement/items/{item_id}/purchase", "authenticated", true)]),
  "cai.shopping.procurement.template_create": action("cai.shopping.procurement.template_create", "shopping", "procurement-template-create", [write("create", "POST", "/procurement/templates", "authenticated")]),
  "cai.shopping.procurement.template_update": action("cai.shopping.procurement.template_update", "shopping", "procurement-template-update", [write("update", "PATCH", "/procurement/templates/{template_id}", "authenticated")]),
  "cai.shopping.procurement.template_deactivate": action("cai.shopping.procurement.template_deactivate", "shopping", "procurement-template-deactivate", [write("deactivate", "PATCH", "/procurement/templates/{template_id}", "authenticated")]),

  "cai.template.01.dish": action("cai.template.01.dish", "template", "dish", [read("list", "/global-dish-templates/", "authenticated"), read("show", "/global-dish-templates/{template_id}", "authenticated")]),
  "cai.template.02.ingredient": action("cai.template.02.ingredient", "template", "ingredient", [read("list", "/global-ingredient-templates/", "authenticated"), read("show", "/global-ingredient-templates/{template_id}", "authenticated")]),

  "cai.menu.01.create": action("cai.menu.01.create", "menu", "create", [write("create", "POST", "/menu/club/{club_id}/menus", "supply_create")]),
  "cai.menu.02.list": action("cai.menu.02.list", "menu", "list", [read("list", "/menu/club/{club_id}/menus")]),
  "cai.menu.03.show": action("cai.menu.03.show", "menu", "show", [read("show", "/menu/club/{club_id}/menus/{menu_id}")]),
  "cai.menu.04.add_item": action("cai.menu.04.add_item", "menu", "add-item", [write("add", "POST", "/menu/club/{club_id}/items", "supply_create")]),
  "cai.menu.05.update_item": action("cai.menu.05.update_item", "menu", "update-item", [write("update", "PUT", "/menu/items/{item_id}", "supply_manage")]),
  "cai.menu.06.delete_item": action("cai.menu.06.delete_item", "menu", "delete-item", [write("delete", "DELETE", "/menu/items/{item_id}", "supply_manage", true)]),
  "cai.menu.07.delete": action("cai.menu.07.delete", "menu", "delete", [write("delete", "DELETE", "/menu/club/{club_id}/menus/{menu_id}", "supply_manage", true)]),
  "cai.menu.08.style": action("cai.menu.08.style", "menu", "style", [operation({ name: "style", permission: "supply_manage", risk: "reversible_write", routes: [route("GET", "/menu/club/{club_id}/menus/{menu_id}", "preflight"), route("PUT", "/menu/club/{club_id}/menus/{menu_id}")] })]),
  "cai.menu.09.apply": action("cai.menu.09.apply", "menu", "apply", [operation({ name: "apply", permission: "supply_create", risk: "critical_write", routes: [route("POST", "/menu/club/{club_id}/menus"), route("POST", "/menu/club/{club_id}/items/bulk"), route("PUT", "/menu/club/{club_id}/menus/{menu_id}")] })]),
  "cai.menu.10.export": action("cai.menu.10.export", "menu", "export", [job("export", ["supply.read", "files.export"], "supply_read", [route("GET", "/menu/club/{club_id}/menus/{menu_id}/public", "preflight")])]),
});

export function validateK11Definitions(): void {
  if (Object.keys(K11_ACTION_DEFINITIONS).length !== K11_ACTION_IDS.length) throw new Error("K11-Aktionsinventar und Definitionen sind nicht deckungsgleich.");
  for (const id of K11_ACTION_IDS) {
    const definition = K11_ACTION_DEFINITIONS[id];
    if (!definition || Object.keys(definition.operations).length === 0) throw new Error(`${id}: Operationen fehlen.`);
    for (const [name, item] of Object.entries(definition.operations)) {
      if (name !== item.operation || item.backend_routes.length === 0) throw new Error(`${id}:${name}: ungültige Branch-Definition.`);
      if (item.risk_class === "read" && item.execution_gate !== "inline") throw new Error(`${id}:${name}: Read darf kein Write-Gate verwenden.`);
      if (item.risk_class === "critical_write" && item.execution_gate !== "confirmation") throw new Error(`${id}:${name}: kritische Aktion ohne Bestätigung.`);
    }
  }
}
