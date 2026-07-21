import booking from "../../../../../src/schema/booking.json" with { type: "json" };
import coverage from "../../../../../src/schema/coverage.json" with { type: "json" };
import data from "../../../../../src/schema/data.json" with { type: "json" };
import design from "../../../../../src/schema/design.json" with { type: "json" };
import event from "../../../../../src/schema/event.json" with { type: "json" };
import homepage from "../../../../../src/schema/homepage.json" with { type: "json" };
import ingredientCategory from "../../../../../src/schema/ingredient-category.json" with { type: "json" };
import ingredient from "../../../../../src/schema/ingredient.json" with { type: "json" };
import meeting from "../../../../../src/schema/meeting.json" with { type: "json" };
import member from "../../../../../src/schema/member.json" with { type: "json" };
import menu from "../../../../../src/schema/menu.json" with { type: "json" };
import object from "../../../../../src/schema/object.json" with { type: "json" };
import role from "../../../../../src/schema/role.json" with { type: "json" };
import shopping from "../../../../../src/schema/shopping.json" with { type: "json" };
import sponsor from "../../../../../src/schema/sponsor.json" with { type: "json" };
import task from "../../../../../src/schema/task.json" with { type: "json" };
import team from "../../../../../src/schema/team.json" with { type: "json" };
import type { JsonValue } from "@comvenio/connector-contracts";

export const K12_SCHEMA_DOMAINS = ["homepage", "design", "menu", "event", "member", "booking", "task", "sponsor", "meeting", "data", "team", "object", "ingredient", "ingredient-category", "shopping", "role", "coverage"] as const;
export type K12SchemaDomain = (typeof K12_SCHEMA_DOMAINS)[number];
const registry: Record<K12SchemaDomain, JsonValue> = { homepage, design, menu, event, member, booking, task, sponsor, meeting, data, team, object, ingredient, "ingredient-category": ingredientCategory, shopping, role, coverage } as unknown as Record<K12SchemaDomain, JsonValue>;
const coverageByDomain = new Map(((coverage as { domains?: Array<{ id: string; status: string }> }).domains ?? []).map((entry) => [entry.id, entry.status]));

export function listK12Schemas(): JsonValue {
  return { coverage_status: "core-partial", domains: K12_SCHEMA_DOMAINS.map((domain) => ({ domain, status: coverageByDomain.get(domain) ?? "core-partial" })) };
}
export function showK12Schema(domain: K12SchemaDomain): JsonValue {
  return { domain, coverage_status: coverageByDomain.get(domain) ?? "core-partial", schema: structuredClone(registry[domain]) };
}
export { homepage as K12_HOMEPAGE_REGISTRY };
