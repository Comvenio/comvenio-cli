import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";
import type { K13ActionDefinition, K13OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function identifier(input: JsonObject): string { for (const key of ["sponsor_id", "product_id", "contract_version_id", "assignment_id", "responsible_id", "club_id"]) if (typeof input[key] === "string") return String(input[key]); return "Sponsoring"; }
export async function buildK13Preview(definition: K13ActionDefinition, operation: K13OperationDefinition, input: JsonValue, _context: RequestContext): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
  const data = record(input); const effects: JsonValue[] = [{ type: "backend_mutation", action_id: definition.action_id, operation: operation.operation, target: identifier(data), external_effect: operation.external_effect }];
  if (["cai.sponsor.04.update", "cai.sponsor.06.logo"].includes(definition.action_id)) effects.push({ type: "public_sponsor_presentation", may_change_name_logo_or_link: true });
  if (["cai.sponsor.16.assign", "cai.sponsor.17.assignment_update", "cai.sponsor.18.cancel"].includes(definition.action_id)) effects.push({ type: "sponsor_assignment_visibility", may_change_active_public_mapping: true });
  if (operation.operation === "move_department") effects.push({ type: "department_move", target_department_id: data.target_department_id ?? null, cascading_backend_effects: true });
  return { subject: identifier(data), summary: `${definition.source_action}: ${operation.operation}`, effects };
}
