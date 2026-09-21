import type { JsonValue } from "@comvenio/connector-contracts";

type JsonObject = { [key: string]: JsonValue };
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }
// `closed_by` und `approved_by` stehen hier zusätzlich zur Sponsor-Liste: Es sind
// Personenkennungen, und wer eine Zahl prüft, braucht nicht zu wissen, wer sie
// freigegeben hat. Der Zeitpunkt (`closed_at`, `approved_at`) bleibt sichtbar,
// weil er den Zustand des Satzes beschreibt und keine Person benennt.
const forbidden = /(?:^|_)(?:authorization|token|secret|password|credential|hash|created_by|updated_by|deleted_by|closed_by|approved_by|audit|internal|log)(?:$|_)/iu;
export function redactFinanceValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactFinanceValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.test(key)).map(([key, entry]) => [key, redactFinanceValue(entry)]));
}
function select(value: JsonValue, fields: readonly [string, string][]): JsonValue {
  const source = record(redactFinanceValue(value));
  return Object.fromEntries(fields.map(([target, origin]) => [target, source[origin]]).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined));
}
export function boundedFinanceList(value: JsonValue, limit: number, mapper: (entry: JsonValue) => JsonValue): JsonValue {
  const rows = Array.isArray(value) ? value : [];
  return { items: rows.slice(0, limit).map(mapper), returned: Math.min(rows.length, limit), truncated: rows.length > limit };
}

export function minimizePlan(value: JsonValue): JsonValue {
  return select(value, [["plan_id", "id"], ["year", "year"], ["status", "status"], ["available_capital_cents", "available_capital_cents"], ["notes", "notes"], ["closed_at", "closed_at"], ["created_at", "created_at"]]);
}
export function minimizePosition(value: JsonValue): JsonValue {
  return select(value, [
    ["position_id", "id"], ["plan_id", "finance_plan_id"], ["department_id", "department_id"], ["category", "category"], ["name", "name"], ["position_number", "position_number"],
    ["context_type", "context_type"], ["context_id", "context_id"], ["parent_position_id", "parent_position_id"],
    ["revenue_planned_cents", "revenue_planned_cents"], ["expense_planned_cents", "expense_planned_cents"],
    ["revenue_actual_cents", "revenue_actual_cents"], ["expense_actual_cents", "expense_actual_cents"],
    ["revenue_previous_year_cents", "revenue_previous_year_cents"], ["expense_previous_year_cents", "expense_previous_year_cents"],
    ["children_revenue_planned_cents", "children_revenue_planned_cents"], ["children_expense_planned_cents", "children_expense_planned_cents"], ["child_count", "child_count"],
    ["comment", "comment"], ["recurring", "recurring"], ["plan_source", "plan_source"], ["plan_imported_at", "plan_imported_at"],
  ]);
}
export function minimizeEntry(value: JsonValue): JsonValue {
  return select(value, [
    ["entry_id", "id"], ["position_id", "budget_position_id"], ["entry_number", "entry_number"], ["description", "description"],
    ["revenue_cents", "revenue_cents"], ["expense_cents", "expense_cents"], ["booking_date", "booking_date"], ["receipt_file_id", "receipt_file_id"],
    ["source_type", "source_type"], ["source_id", "source_id"], ["source_reference", "source_reference"], ["notes", "notes"], ["approved_at", "approved_at"], ["created_at", "created_at"],
  ]);
}
function minimizeSummaryRow(value: JsonValue): JsonValue {
  return select(value, [
    ["department_id", "department_id"], ["category", "category"], ["position_count", "position_count"],
    ["revenue_planned_cents", "revenue_planned_cents"], ["expense_planned_cents", "expense_planned_cents"],
    ["revenue_actual_cents", "revenue_actual_cents"], ["expense_actual_cents", "expense_actual_cents"],
    ["revenue_previous_year_cents", "revenue_previous_year_cents"], ["expense_previous_year_cents", "expense_previous_year_cents"],
  ]);
}
export function minimizeSummary(value: JsonValue): JsonValue {
  const source = record(redactFinanceValue(value));
  const head = select(value, [["year", "year"], ["status", "status"], ["available_capital_cents", "available_capital_cents"], ["revenue_planned_cents", "revenue_planned_cents"], ["expense_planned_cents", "expense_planned_cents"], ["revenue_actual_cents", "revenue_actual_cents"], ["expense_actual_cents", "expense_actual_cents"]]);
  return { ...record(head), rows: (Array.isArray(source.rows) ? source.rows : []).map(minimizeSummaryRow) };
}
export function minimizeCopyResult(value: JsonValue): JsonValue {
  const source = record(redactFinanceValue(value));
  return {
    plan: minimizePlan(source.plan ?? null),
    source_year: source.source_year ?? null,
    positions_copied: source.positions_copied ?? 0,
    positions_skipped: source.positions_skipped ?? 0,
    // Die Liste bleibt vollständig: Jede Zeile darin ist eine Aufgabe für den
    // Menschen — eine übernommene Position, deren Veranstaltung im Zieljahr
    // fehlt. Gekürzt wäre sie eine stille Lücke in der Buchführung.
    unlinked_positions: (Array.isArray(source.unlinked_positions) ? source.unlinked_positions : []).map((entry) => select(entry, [["position_id", "position_id"], ["name", "name"], ["event_id", "event_id"], ["reason", "reason"], ["years", "years"]])),
  };
}
export function minimizeImportResult(value: JsonValue): JsonValue {
  const source = record(redactFinanceValue(value));
  return {
    position: minimizePosition(source.position ?? null),
    estimated_cost_cents: source.estimated_cost_cents ?? null,
    items_considered: source.items_considered ?? 0,
    applied: source.applied ?? false,
    reason: source.reason ?? null,
  };
}
