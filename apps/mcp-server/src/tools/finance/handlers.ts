import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import { createConnectorError, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import { boundedFinanceList, minimizeCopyResult, minimizeEntry, minimizeImportResult, minimizePlan, minimizePosition, minimizeSummary } from "./privacy.ts";
import type { K14ActionId } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
type Handler = (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => Promise<JsonValue>;
function record(value: JsonValue): JsonObject { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Die validierte K14-Eingabe ist kein Objekt."); return value; }
function string(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string") throw new Error(`${key} fehlt.`); return value; }
function integer(input: JsonObject, key: string): number { const value = input[key]; if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${key} fehlt.`); return value; }
function object(input: JsonObject, key: string): JsonObject { return record(input[key] ?? {}); }
function compact(value: Record<string, JsonValue | undefined>): JsonObject { return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)); }
function valuesFor(value: JsonValue, keys: Set<string>): string[] { if (value === null || typeof value !== "object") return []; if (Array.isArray(value)) return value.flatMap((entry) => valuesFor(entry, keys)); return Object.entries(value).flatMap(([key, entry]) => keys.has(key) && typeof entry === "string" ? [entry] : valuesFor(entry, keys)); }

// `departments: false` für Antworten, die von Natur aus mehrere Abteilungen
// tragen — die vereinsweite Zusammenfassung ist der Fall. Dort wäre der
// Abteilungsabgleich kein Schutz, sondern ein Fehlalarm. Dass ein reiner
// Abteilungskontext die vereinsweite Sicht gar nicht erst bekommt, entscheidet
// das ToolSet vor dem Aufruf.
function assertTenant(value: JsonValue, context: RequestContext, departments = true): JsonValue {
  if (context.club_id && valuesFor(value, new Set(["club_id"])).some((id) => id !== context.club_id)) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Finance-Service lieferte Daten eines anderen Vereins.", request_id: context.request_id, retryable: false });
  if (departments && context.department_id && valuesFor(value, new Set(["department_id"])).some((id) => id !== context.department_id)) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Finance-Service lieferte Daten einer anderen Abteilung.", request_id: context.request_id, retryable: false });
  return value;
}
async function request(client: ComvenioApiClient, context: RequestContext, method: ComvenioHttpMethod, path: string, options: { body?: JsonValue; query?: Record<string, string> } = {}): Promise<JsonValue> {
  return client.request<JsonValue>({ method, service: "finance", path, context, ...options });
}
const handlers = new Map<string, Handler>(); const key = (id: K14ActionId, operation: string) => `${id}:${operation}`; const add = (id: K14ActionId, operation: string, handler: Handler) => handlers.set(key(id, operation), handler);
function simple(id: K14ActionId, operation: string, method: ComvenioHttpMethod, path: (input: JsonObject) => string, options: { body?: (input: JsonObject) => JsonValue; query?: (input: JsonObject, context: RequestContext) => Record<string, string>; map?: (value: JsonValue, input: JsonObject) => JsonValue; departments?: boolean } = {}): void {
  add(id, operation, async (input, context, client) => {
    const value = await request(client, context, method, path(input), { ...(options.body ? { body: options.body(input) } : {}), ...(options.query ? { query: options.query(input, context) } : {}) });
    const safe = assertTenant(value, context, options.departments ?? true);
    return options.map ? options.map(safe, input) : safe;
  });
}

const plans = (input: JsonObject) => `/clubs/${string(input, "club_id")}/finance-plans`;
const plan = (input: JsonObject) => `${plans(input)}/${integer(input, "year")}`;
const position = (input: JsonObject) => `/positions/${string(input, "position_id")}`;
const entry = (input: JsonObject) => `/entries/${string(input, "entry_id")}`;

// ── Jahresplan ──────────────────────────────────────────────────────────────
simple("cai.finance.01.plan_list", "list", "GET", plans, { map: (value, input) => boundedFinanceList(value, Number(input.limit), minimizePlan) });
simple("cai.finance.02.plan_show", "show", "GET", plan, { map: minimizePlan });
simple("cai.finance.03.plan_create", "create", "POST", plans, { body: (input) => compact({ year: input.year!, available_capital_cents: input.available_capital_cents!, notes: input.notes }), map: minimizePlan });
simple("cai.finance.04.plan_update", "update", "PATCH", plan, { body: (input) => object(input, "changes"), map: minimizePlan });
// Jeder dieser drei Endpunkte verlangt einen Rumpf — `reopen` sogar ein
// Pflichtfeld (`reason`, min_length=3). Ein Aufruf ohne Rumpf endet in 422.
simple("cai.finance.05.plan_close", "close", "POST", (input) => `${plan(input)}/close`, { body: (input) => compact({ force: input.force!, note: input.note }), map: minimizePlan });
simple("cai.finance.06.plan_reopen", "reopen", "POST", (input) => `${plan(input)}/reopen`, { body: (input) => ({ reason: string(input, "reason") }), map: minimizePlan });
simple("cai.finance.07.plan_copy", "copy", "POST", (input) => `${plan(input)}/copy-from/${integer(input, "source_year")}`, {
  body: (input) => compact({ position_ids: input.position_ids, include_non_recurring: input.include_non_recurring! }),
  map: minimizeCopyResult,
  // Das Ergebnis trägt die übernommenen Posten mehrerer Abteilungen.
  departments: false,
});

// ── Budgetposten ────────────────────────────────────────────────────────────
simple("cai.finance.08.position_list", "list", "GET", (input) => `${plan(input)}/positions`, {
  // Ohne diesen Filter käme der ganze Plan zurück, und der Abteilungsabgleich
  // würde eine völlig rechtmässige Antwort verwerfen. Der Dienst filtert.
  query: (input, context) => { const department = typeof input.department_id === "string" ? input.department_id : context.department_id; return department ? { department_id: department } : ({} as Record<string, string>); },
  map: (value, input) => boundedFinanceList(value, Number(input.limit), minimizePosition),
});
simple("cai.finance.09.position_create", "create", "POST", (input) => `${plan(input)}/positions`, {
  body: (input) => compact({
    name: input.name!, category: input.category!, department_id: input.department_id, position_number: input.position_number!,
    context_type: input.context_type!, context_id: input.context_id, parent_position_id: input.parent_position_id,
    revenue_planned_cents: input.revenue_planned_cents!, expense_planned_cents: input.expense_planned_cents!, comment: input.comment, recurring: input.recurring!,
  }),
  map: minimizePosition,
});
simple("cai.finance.10.position_show", "show", "GET", position, { map: minimizePosition });
simple("cai.finance.11.position_update", "update", "PATCH", position, { body: (input) => object(input, "changes"), map: minimizePosition });
add("cai.finance.12.position_delete", "delete", async (input, context, client) => {
  const path = position(input);
  assertTenant(await request(client, context, "GET", path), context);
  await request(client, context, "DELETE", path);
  return { deleted: true, position_id: input.position_id! };
});
simple("cai.finance.13.position_import_shopping", "import", "POST", (input) => `${position(input)}/import-shopping-estimate`, { body: (input) => ({ overwrite: input.overwrite === true }), map: minimizeImportResult });

// ── Zusammenfassung ─────────────────────────────────────────────────────────
simple("cai.finance.14.summary", "total", "GET", (input) => `${plan(input)}/summary`, { map: minimizeSummary, departments: false });
// Anders als `total` liefert dieser Endpunkt keine Zusammenfassung, sondern die
// Positionen der Abteilung (routes/budget_positions.py: List[BudgetPositionRead]).
simple("cai.finance.14.summary", "by_department", "GET", (input) => `${plan(input)}/summary/${string(input, "department_id")}`, { map: (value) => boundedFinanceList(value, 200, minimizePosition) });

// ── Buchungen ───────────────────────────────────────────────────────────────
simple("cai.finance.15.entry_list", "list", "GET", (input) => `${position(input)}/entries`, {
  query: (input) => (typeof input.source_type === "string" ? { source_type: input.source_type } : ({} as Record<string, string>)),
  map: (value, input) => boundedFinanceList(value, Number(input.limit), minimizeEntry),
});
simple("cai.finance.16.entry_create", "create", "POST", (input) => `${position(input)}/entries`, {
  body: (input) => compact({ description: input.description!, revenue_cents: input.revenue_cents, expense_cents: input.expense_cents, booking_date: input.booking_date!, receipt_file_id: input.receipt_file_id, notes: input.notes }),
  map: minimizeEntry,
});
simple("cai.finance.17.entry_show", "show", "GET", entry, { map: minimizeEntry });
simple("cai.finance.18.entry_update", "update", "PATCH", entry, { body: (input) => object(input, "changes"), map: minimizeEntry });
add("cai.finance.19.entry_delete", "delete", async (input, context, client) => {
  const path = entry(input);
  assertTenant(await request(client, context, "GET", path), context);
  await request(client, context, "DELETE", path);
  return { deleted: true, entry_id: input.entry_id! };
});
simple("cai.finance.20.entry_approve", "approve", "POST", (input) => `${entry(input)}/approve`, { body: (input) => compact({ note: input.note }), map: minimizeEntry });

export function hasK14OperationHandler(actionId: K14ActionId, operation: string): boolean { return handlers.has(key(actionId, operation)); }
export async function executeK14Operation(actionId: K14ActionId, operation: string, input: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<JsonValue> {
  const handler = handlers.get(key(actionId, operation)); if (!handler) throw new Error(`${actionId}:${operation}: Der typisierte Handler fehlt.`); return handler(record(input), context, client);
}
