import { createConnectorError, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";

type JsonObject = { [key: string]: JsonValue };

function record(value: JsonValue): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function number(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function scaleRecipeQuantities(recipeValue: JsonValue, portions: number, context?: RequestContext): JsonValue {
  if (!Number.isInteger(portions) || portions < 1 || portions > 500) {
    if (context) throw createConnectorError({ code: "VALIDATION_FAILED", message: "Die Portionenzahl muss zwischen 1 und 500 liegen.", request_id: context.request_id, retryable: false });
    throw new Error("Ungültige Portionenzahl.");
  }
  const recipe = record(recipeValue);
  const ingredients = Array.isArray(recipe.recipe_ingredients) ? recipe.recipe_ingredients : [];
  return {
    ...recipe,
    requested_portions: portions,
    scaled_ingredients: ingredients.map((entry) => {
      const relation = record(entry);
      const baseQuantity = number(relation.quantity);
      return {
        ingredient_id: relation.ingredient_id ?? record(relation.ingredient ?? {}).id ?? null,
        name: record(relation.ingredient ?? {}).name ?? null,
        quantity: baseQuantity === null ? null : baseQuantity * portions,
        unit: relation.unit ?? null,
        quantity_state: baseQuantity === null ? "MISSING" : "KNOWN",
      };
    }),
    cost_state: recipe.total_ingredient_cost === null || recipe.total_ingredient_cost === undefined ? "UNKNOWN" : "KNOWN",
  };
}
