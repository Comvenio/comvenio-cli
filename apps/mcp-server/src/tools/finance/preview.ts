import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";
import { request } from "./handlers.ts";
import type { K14ActionDefinition, K14OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function identifier(input: JsonObject): string {
  for (const key of ["entry_id", "transfer_id", "position_id", "year", "club_id"]) if (input[key] !== undefined && input[key] !== null) return String(input[key]);
  return "Finanzen";
}

// budget-organigramm-04 DC-2: the sub positions a delete takes along, read
// BEFORE the confirmation. null when they cannot be read — the preview then
// says so instead of pretending there were none.
// A lead sees only her subtree; the service deletes every sub position. The
// list counts as complete only when it matches the service's child_count
// (review R2-02).
async function subPositions(client: ComvenioApiClient, context: RequestContext, positionId: string): Promise<{ rows: JsonObject[]; complete: boolean } | null> {
  try {
    const position = record(await request(client, context, "GET", `/positions/${positionId}`));
    const planId = position.finance_plan_id;
    if (typeof planId !== "string" || !context.club_id) return null;
    const rows = await request(client, context, "GET", `/clubs/${context.club_id}/finance-plans/by-id/${planId}/positions`);
    if (!Array.isArray(rows)) return null;
    const unter = rows.map(record).filter((row) => row.parent_position_id === positionId);
    const erwartet = typeof position.child_count === "number" ? position.child_count : unter.length;
    return { rows: unter, complete: unter.length === erwartet };
  } catch {
    return null;
  }
}

// DC-8: the frame before the change, from the tree the service filters anyway —
// the plan tree for a plan frame, the season tree for a season frame (budget-saison-03).
async function currentFrame(client: ComvenioApiClient, context: RequestContext, data: JsonObject): Promise<number | null | undefined> {
  try {
    if (!context.club_id) return undefined;
    const path = typeof data.season_start === "string"
      ? `/clubs/${context.club_id}/budget-seasons/${data.season_start}/tree`
      : typeof data.plan_id === "string" ? `/clubs/${context.club_id}/finance-plans/by-id/${data.plan_id}/budget-tree` : null;
    if (path === null) return undefined;
    const tree = record(await request(client, context, "GET", path));
    const nodes = Array.isArray(tree.nodes) ? tree.nodes.map(record) : [];
    const node = nodes.find((n) => n.node_kind === data.node_kind && String(n.node_id ?? "club") === String(data.node_id ?? "club"));
    if (!node) return undefined;
    return typeof node.frame_cents === "number" ? node.frame_cents : null;
  } catch {
    return undefined;
  }
}

async function transferShow(client: ComvenioApiClient, context: RequestContext, transferId: string): Promise<JsonObject | null> {
  try {
    if (!context.club_id) return null;
    const transfer = record(await request(client, context, "GET", `/clubs/${context.club_id}/department-transfers/${transferId}`));
    return transfer.id === transferId ? transfer : null;
  } catch {
    return null;
  }
}

export async function buildK14Preview(definition: K14ActionDefinition, operation: K14OperationDefinition, input: JsonValue, context: RequestContext, client?: ComvenioApiClient): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
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
  // budget-organigramm-01 section 4.5: the sub positions go along; the answer
  // names them in deleted_ids. The preview names each one before the click.
  if (definition.action_id === "cai.finance.12.position_delete") {
    const positionId = typeof data.position_id === "string" ? data.position_id : null;
    const unter = client && positionId ? await subPositions(client, context, positionId) : null;
    effects.push({ type: "position_removal", position_id: positionId, affects_attached_bookings: true, includes_sub_positions: true, sub_positions_read: unter?.complete === true });
    for (const kind of unter?.rows ?? [])
      effects.push({ type: "position_removal", position_id: kind.id ?? null, name: kind.name ?? null, parent_position_id: positionId, expense_planned_cents: kind.expense_planned_cents ?? null });
  }
  // DC-8: a frame change shows the old and the new amount and the reason.
  const rahmen = (definition.action_id === "cai.finance.36.budget_organigram" && operation.operation === "frame_set")
    || (definition.action_id === "cai.finance.37.budget_season" && operation.operation === "season_frame_set");
  if (rahmen) {
    const payload = record(data.data ?? null);
    const before = client ? await currentFrame(client, context, data) : undefined;
    effects.push({ type: "frame_change", node_kind: data.node_kind ?? null, node_id: data.node_id ?? null, ...(data.season_start ? { season_start: data.season_start } : {}), old_amount_cents: before ?? null, old_amount_read: before !== undefined, new_amount_cents: payload.amount_cents ?? null, reason: payload.reason ?? null });
  }
  // buchhaltung-13-04 DC-5: eine Umbuchung zeigt vor der Entscheidung Betrag,
  // Abteilungen und Zustand — aus show, gelesen vor der Bestätigung.
  if (definition.action_id === "cai.finance.27.department_transfer" && ["confirm", "reject", "withdraw"].includes(operation.operation)) {
    const transferId = typeof data.transfer_id === "string" ? data.transfer_id : null;
    const transfer = client && transferId ? await transferShow(client, context, transferId) : null;
    effects.push({
      type: "department_transfer_decision", step: operation.operation, transfer_id: transferId, transfer_read: transfer !== null,
      amount_cents: transfer?.amount_cents ?? null, from_department_id: transfer?.from_department_id ?? null,
      to_department_id: transfer?.to_department_id ?? null, status: transfer?.status ?? null, reason: transfer?.reason ?? null,
      decision_note: record(data.data ?? null).decision_note ?? null,
    });
  }
  // Eine Korrektur nennt die geänderten Felder und ihren Grund.
  if (definition.action_id === "cai.finance.18.entry_update") {
    const changes = record(data.changes ?? null);
    effects.push({ type: "booking_correction", entry_id: data.entry_id ?? null, fields: Object.keys(changes).filter((key) => key !== "reason").sort(), reason: changes.reason ?? null });
  }
  if (definition.action_id === "cai.finance.19.entry_delete") effects.push({ type: "booking_removal", entry_id: data.entry_id ?? null, changes_actual_totals: true });
  if (definition.action_id === "cai.finance.20.entry_approve") effects.push({ type: "booking_approval", entry_id: data.entry_id ?? null, marks_entry_as_verified: true });
  return { subject: identifier(data), summary: `${definition.source_action}: ${operation.operation}`, effects };
}
