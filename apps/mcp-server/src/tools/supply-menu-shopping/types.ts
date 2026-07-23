import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, OAuthScope, RequestContext } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";
import type { z } from "zod";

export const K11_RECIPE_ACTION_IDS = [
  "cai.recipe.01.create", "cai.recipe.02.from_template", "cai.recipe.03.list", "cai.recipe.04.show", "cai.recipe.05.update", "cai.recipe.06.delete",
] as const;
export const K11_INGREDIENT_ACTION_IDS = [
  "cai.ingredient.01.list", "cai.ingredient.02.show", "cai.ingredient.03.create", "cai.ingredient.04.update", "cai.ingredient.05.delete",
] as const;
export const K11_INGREDIENT_CATEGORY_ACTION_IDS = [
  "cai.ingredient-category.01.list", "cai.ingredient-category.02.roots", "cai.ingredient-category.03.tree", "cai.ingredient-category.04.by_ingredient",
  "cai.ingredient-category.05.show", "cai.ingredient-category.06.create", "cai.ingredient-category.07.update", "cai.ingredient-category.08.delete",
  "cai.ingredient-category.09.assign", "cai.ingredient-category.10.unassign", "cai.ingredient-category.11.init",
] as const;
export const K11_SHOPPING_ACTION_IDS = [
  "cai.shopping.01.list", "cai.shopping.02.active", "cai.shopping.03.completed", "cai.shopping.04.by_context", "cai.shopping.05.by_context_type",
  "cai.shopping.06.show", "cai.shopping.07.create", "cai.shopping.08.update", "cai.shopping.09.delete", "cai.shopping.10.item_add",
  "cai.shopping.11.item_update", "cai.shopping.12.item_delete", "cai.shopping.13.purchased", "cai.shopping.14.generate_from_recipe", "cai.shopping.15.generate_from_menu",
  "cai.shopping.procurement.list", "cai.shopping.procurement.templates", "cai.shopping.procurement.activate", "cai.shopping.procurement.add",
  "cai.shopping.procurement.purchase", "cai.shopping.procurement.template_create", "cai.shopping.procurement.template_update",
  "cai.shopping.procurement.template_deactivate",
] as const;
export const K11_TEMPLATE_ACTION_IDS = ["cai.template.01.dish", "cai.template.02.ingredient"] as const;
export const K11_MENU_ACTION_IDS = [
  "cai.menu.01.create", "cai.menu.02.list", "cai.menu.03.show", "cai.menu.04.add_item", "cai.menu.05.update_item",
  "cai.menu.06.delete_item", "cai.menu.07.delete", "cai.menu.08.style", "cai.menu.09.apply", "cai.menu.10.export",
] as const;
export const K11_ACTION_IDS = [
  ...K11_RECIPE_ACTION_IDS, ...K11_INGREDIENT_ACTION_IDS, ...K11_INGREDIENT_CATEGORY_ACTION_IDS,
  ...K11_SHOPPING_ACTION_IDS, ...K11_TEMPLATE_ACTION_IDS, ...K11_MENU_ACTION_IDS,
] as const;

export type K11ActionId = (typeof K11_ACTION_IDS)[number];
export type K11Domain = "recipe" | "ingredient" | "ingredient-category" | "shopping" | "template" | "menu";
export type K11ExecutionGate = "inline" | "write_safety" | "confirmation" | "job";

export interface K11BackendRoute {
  method: ComvenioHttpMethod;
  service: "supply";
  normalized_path_template: string;
  purpose: "read" | "mutation" | "preflight";
}
export interface K11OperationDefinition {
  operation: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_gate: K11ExecutionGate;
  backend_routes: readonly K11BackendRoute[];
  external_effect: "none" | "comvenio_private" | "comvenio_public" | "third_party";
}
export interface K11ActionDefinition {
  action_id: K11ActionId;
  domain: K11Domain;
  source_action: string;
  source_path: string;
  operations: Readonly<Record<string, K11OperationDefinition>>;
  publication_state: "implemented" | "blocked";
  blocker: string | null;
}
export interface K11ActionSchemaContract { input: z.ZodType; output: z.ZodType; }
export interface K11ExecutionRequest { action_id: K11ActionId; input: unknown; context: RequestContext; capability_snapshot: CapabilitySnapshot | null; }
export interface K11MutationRequest { definition: K11ActionDefinition; operation: K11OperationDefinition; input: JsonValue; context: RequestContext; capability_snapshot: CapabilitySnapshot; }
export interface K11WriteSafetyPort { execute(request: K11MutationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>; }
export interface K11JobStartPort { start(request: K11MutationRequest): Promise<JsonValue>; }
export interface K11ConfirmationPreview extends Record<string, JsonValue> {
  preview_id: string; confirmation_token: string; action_id: K11ActionId; operation: string; subject: string; summary: string; effects: JsonValue[]; expires_at: string;
}
export interface K11ConfirmationPort {
  confirmOrPreview(request: {
    mutation: K11MutationRequest; subject: string; summary: string; effects: JsonValue[];
    confirmation: { preview_id: string; confirmation_token: string } | null;
  }, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}
export interface K11ExecutionDependencies {
  client: ComvenioApiClient;
  write_safety?: K11WriteSafetyPort;
  job_starter?: K11JobStartPort;
  confirmation?: K11ConfirmationPort;
  on_backend_forbidden?: (input: { action_id: K11ActionId; operation: string; context: RequestContext }) => void | Promise<void>;
}
export interface K11ActionResult extends Record<string, JsonValue> {
  action_id: K11ActionId;
  operation: string;
  status: "completed" | "confirmation_required" | "queued";
  result: JsonValue;
}
