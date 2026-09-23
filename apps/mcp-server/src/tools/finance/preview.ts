import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";
import type { K14ActionDefinition, K14OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function identifier(input: JsonObject): string {
  for (const key of ["entry_id", "position_id", "year", "club_id"]) if (input[key] !== undefined && input[key] !== null) return String(input[key]);
  return "Finanzen";
}

export async function buildK14Preview(definition: K14ActionDefinition, operation: K14OperationDefinition, input: JsonValue, _context: RequestContext): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
  const data = record(input);
  const effects: JsonValue[] = [{ type: "backend_mutation", action_id: definition.action_id, operation: operation.operation, target: identifier(data), external_effect: operation.external_effect }];
  // Was der Mensch vor dem Klick wissen muss, ist nicht die Route, sondern die
  // Reichweite: Ein geschlossenes Jahr nimmt keine Buchung mehr an, ein
  // übernommener Plan legt auf einen Schlag viele Posten an, und eine Freigabe
  // macht aus einem Entwurf einen verbuchten Beleg.
  if (definition.action_id === "cai.finance.05.plan_close") effects.push({ type: "plan_lock", year: data.year ?? null, blocks_further_bookings: true, forced: data.force === true });
  if (definition.action_id === "cai.finance.07.plan_copy") {
    effects.push({ type: "bulk_position_creation", source_year: data.source_year ?? null, target_year: data.year ?? null, selected_positions: Array.isArray(data.position_ids) ? data.position_ids.length : null, includes_non_recurring: data.include_non_recurring === true });
  }
  // budget-organigramm-01 section 4.5: the sub positions go along; the answer names them in deleted_ids.
  if (definition.action_id === "cai.finance.12.position_delete")
    effects.push({ type: "position_removal", position_id: data.position_id ?? null, affects_attached_bookings: true, includes_sub_positions: true });
  if (definition.action_id === "cai.finance.19.entry_delete") effects.push({ type: "booking_removal", entry_id: data.entry_id ?? null, changes_actual_totals: true });
  if (definition.action_id === "cai.finance.20.entry_approve") effects.push({ type: "booking_approval", entry_id: data.entry_id ?? null, marks_entry_as_verified: true });
  return { subject: identifier(data), summary: `${definition.source_action}: ${operation.operation}`, effects };
}
