import type { JsonValue } from "@comvenio/connector-contracts";

type JsonObject = { [key: string]: JsonValue };
const forbidden = /(?:^|_)(?:authorization|token|secret|password|credential|hash|user_id|created_by|updated_by|deleted_by|audit|internal_cursor|log)(?:$|_)/iu;

function record(value: JsonValue): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function redactSupplyValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactSupplyValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.test(key)).map(([key, entry]) => [key, redactSupplyValue(entry)]));
}

export function minimizeTemplate(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(minimizeTemplate);
  const source = record(redactSupplyValue(value));
  const allowed = ["id", "name", "description", "category", "suggested_price", "suggested_age_group", "type_of_recipe", "icon", "ingredients", "unit", "suggested_cost_per_unit", "category_tags", "allergen_types", "colorant_types", "is_common"] as const;
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key === "id" ? "template_id" : key, source[key]!]));
}

export function boundedList(value: JsonValue, limit: number, mapper: (entry: JsonValue) => JsonValue = redactSupplyValue): JsonValue {
  const list = Array.isArray(value) ? value : [];
  return { items: list.slice(0, limit).map(mapper), returned: Math.min(list.length, limit), truncated: list.length > limit };
}

export function minimizeShoppingList(value: JsonValue, itemLimit = 100): JsonValue {
  const source = record(redactSupplyValue(value));
  const shoppingItems = Array.isArray(source.shopping_items) ? source.shopping_items : [];
  return {
    ...source,
    ...(source.shopping_items !== undefined ? { shopping_items: shoppingItems.slice(0, itemLimit).map(redactSupplyValue), items_truncated: shoppingItems.length > itemLimit } : {}),
  };
}
