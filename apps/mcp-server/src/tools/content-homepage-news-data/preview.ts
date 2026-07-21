import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";
import type { K12ActionDefinition, K12OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function identifier(input: JsonObject): string { for (const key of ["news_id", "file_id", "folder_id", "right_id", "paper_id", "club_id"]) if (typeof input[key] === "string") return String(input[key]); return "Vereinsinhalt"; }

export async function buildK12Preview(definition: K12ActionDefinition, operation: K12OperationDefinition, input: JsonValue, _context: RequestContext): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
  const data = record(input);
  const effects: JsonValue[] = [{ type: "backend_mutation", action_id: definition.action_id, operation: operation.operation, target: identifier(data), external_effect: operation.external_effect }];
  if (definition.action_id === "cai.homepage.02.apply") effects.push({ type: "homepage_publication", clear_existing: data.clear_existing === true, tab_count: Array.isArray(data.tabs) ? data.tabs.length : 0 });
  if (definition.domain === "news") effects.push({ type: "news_publication_state", may_change_public_content: operation.external_effect === "comvenio_public" });
  if (definition.action_id === "cai.data.35.export_members_bookings") effects.push({ type: "personal_data_export", entity: operation.operation, delivery: "connector_file_reference" });
  if (definition.action_id === "cai.data.28.folder_right_bulk") effects.push({ type: "bulk_rights_change", count: Array.isArray(data.rights) ? data.rights.length : 0 });
  return { subject: identifier(data), summary: `${definition.source_action}: ${operation.operation}`, effects };
}
