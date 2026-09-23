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
export function assertTenant(value: JsonValue, context: RequestContext, departments = true): JsonValue {
  if (context.club_id && valuesFor(value, new Set(["club_id"])).some((id) => id !== context.club_id)) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Finance-Service lieferte Daten eines anderen Vereins.", request_id: context.request_id, retryable: false });
  if (departments && context.department_id && valuesFor(value, new Set(["department_id"])).some((id) => id !== context.department_id)) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Finance-Service lieferte Daten einer anderen Abteilung.", request_id: context.request_id, retryable: false });
  return value;
}
export async function request(client: ComvenioApiClient, context: RequestContext, method: ComvenioHttpMethod, path: string, options: { body?: JsonValue; query?: Record<string, string> } = {}): Promise<JsonValue> {
  return client.request<JsonValue>({ method, service: "finance", path, context, ...options });
}

// Die strenge Schwester von `assertTenant` — fuer die Vorpruefung genau EINER
// Ressource, bevor etwas geschrieben wird.
//
// Der Unterschied ist die Beweislast. `assertTenant` weist ab, was
// NACHWEISLICH fremd ist; alles andere laesst es durch. Fuer eine Liste ist
// das richtig, fuer eine Schreibfreigabe nicht: `club_id` ist im
// finance-service `nullable=True` (base_model.py:14), und `department_id`
// einer vereinsweiten Position ist `null`. Beide Formen passierten die
// Pruefung, ohne je verglichen worden zu sein — die Vorpruefung war
// fail-open. Hier muss die Herkunft BELEGT sein, sonst faellt die Aktion.
// Fremdvalidierung Runde 2 (2026-09-21).
export function assertHerkunft(quelle: JsonValue, context: RequestContext, was: string): JsonObject {
  const row = quelle !== null && typeof quelle === "object" && !Array.isArray(quelle) ? quelle : null;
  const ablehnen = (grund: string): never => {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: `${was}: ${grund}`, request_id: context.request_id, retryable: false });
  };
  if (!row) return ablehnen("Der Finance-Service lieferte keinen pruefbaren Datensatz.");
  if (typeof row.club_id !== "string") return ablehnen("Der Datensatz nennt keinen Verein; ohne Beleg wird nicht geschrieben.");
  if (row.club_id !== context.club_id) return ablehnen("Der Datensatz gehoert zu einem anderen Verein.");
  if (context.department_id) {
    // Eine Position traegt ihre Abteilung selbst; `null` heisst vereinsweit
    // und liegt damit ausserhalb eines Abteilungskontexts.
    if ("department_id" in row) {
      if (typeof row.department_id !== "string") return ablehnen("Der Datensatz gehoert dem ganzen Verein, nicht der gewaehlten Abteilung.");
      if (row.department_id !== context.department_id) return ablehnen("Der Datensatz gehoert zu einer anderen Abteilung.");
    } else if (typeof row.budget_position_id !== "string") {
      // Weder eigene Abteilung noch ein Weg, sie zu ermitteln.
      return ablehnen("Die Abteilung des Datensatzes ist nicht feststellbar.");
    }
  }
  return row;
}
const handlers = new Map<string, Handler>(); const key = (id: K14ActionId, operation: string) => `${id}:${operation}`; const add = (id: K14ActionId, operation: string, handler: Handler) => handlers.set(key(id, operation), handler);
// The Finance-Hub actions (hub.ts) register through this — one handler map for all of K14.
export function addK14Handler(id: K14ActionId, operation: string, handler: (input: { [key: string]: JsonValue }, context: RequestContext, client: ComvenioApiClient) => Promise<JsonValue>): void { add(id, operation, handler); }
function simple(id: K14ActionId, operation: string, method: ComvenioHttpMethod, path: (input: JsonObject) => string, options: { body?: (input: JsonObject) => JsonValue; query?: (input: JsonObject, context: RequestContext) => Record<string, string>; map?: (value: JsonValue, input: JsonObject) => JsonValue; departments?: boolean } = {}): void {
  add(id, operation, async (input, context, client) => {
    const value = await request(client, context, method, path(input), { ...(options.body ? { body: options.body(input) } : {}), ...(options.query ? { query: options.query(input, context) } : {}) });
    const safe = assertTenant(value, context, options.departments ?? true);
    return options.map ? options.map(safe, input) : safe;
  });
}

// Jede Mutation, deren Pfad nur eine nackte Ressourcenkennung traegt, laeuft
// ueber diesen Weg: erst lesen, Herkunft pruefen, dann aendern.
//
// WARUM DAS NOETIG IST — und warum die Antwortpruefung allein NICHT reicht:
// Der Dienst ermittelt den Verein aus der Ressource und prueft die Rechte des
// anfragenden Menschen fuer GENAU DIESEN Verein (budget_positions.py:176,
// booking_entries.py:88/147/224). Wer in zwei Vereinen Finanzrechte hat, kann
// im Kontext von A eine Kennung aus B uebergeben. Der Dienst fuehrt die
// Aenderung aus; `assertTenant` auf der ANTWORT verwirft dann zwar das
// Ergebnis — geschrieben ist es trotzdem. Bei `entry_create` erzeugt jeder
// Wiederholungsversuch eine weitere Buchung in einem fremden Verein.
//
// Gefunden in der Fremdvalidierung (Runde 1, 2026-09-21). Die beiden
// Loeschwege hatten den Preflight schon — dort war die Begruendung „204 ohne
// Rumpf, also nichts zu pruefen", und die war zu eng: Der Grund ist nicht die
// leere Antwort, sondern die vollzogene Wirkung.
function mitVorpruefung(
  id: K14ActionId,
  operation: string,
  vorpruefung: (input: JsonObject) => string,
  method: ComvenioHttpMethod,
  path: (input: JsonObject) => string,
  options: { body?: (input: JsonObject) => JsonValue; map?: (value: JsonValue, input: JsonObject) => JsonValue } = {},
): void {
  add(id, operation, async (input, context, client) => {
    const quelle = assertHerkunft(await request(client, context, "GET", vorpruefung(input)), context, "Vorpruefung");
    await assertDepartmentOfEntry(quelle, context, client);
    await assertParentPosition(input, context, client);
    const value = await request(client, context, method, path(input), { ...(options.body ? { body: options.body(input) } : {}) });
    const safe = assertTenant(value, context);
    return options.map ? options.map(safe, input) : safe;
  });
}

// Ein Elternposten ist eine WIRKUNG auf fremdem Gebiet: Die Werte des Kindes
// werden in ihn eingerollt (crud/budget_position.py:173) und in der
// Zusammenfassung SEINER Abteilung zugerechnet
// (routes/budget_positions.py:350). Der Dienst prueft dabei nur, ob der
// Elternposten zum selben Jahresplan gehoert (budget_positions.py:99/184) —
// nicht, ob er zur selben Abteilung gehoert. Diese Luecke schliesst der
// Connector hier. Fremdvalidierung Runde 2 (2026-09-21).
async function assertParentPosition(input: JsonObject, context: RequestContext, client: ComvenioApiClient): Promise<void> {
  const direkt = input.parent_position_id;
  const ausChanges = input.changes !== null && typeof input.changes === "object" && !Array.isArray(input.changes)
    ? (input.changes as JsonObject).parent_position_id
    : undefined;
  const parentId = typeof direkt === "string" ? direkt : typeof ausChanges === "string" ? ausChanges : null;
  if (!parentId) return;
  assertHerkunft(await request(client, context, "GET", `/positions/${parentId}`), context, "Elternposten");
}

// Eine Buchung traegt keine Abteilung (BookingEntryRead hat kein
// `department_id`), ihre Position schon. Steht ein Abteilungskontext, wird sie
// deshalb nachgeladen — sonst nicht, denn ohne Abteilungskontext gibt es
// nichts zu pruefen und der Aufruf waere reine Last.
async function assertDepartmentOfEntry(quelle: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<void> {
  if (!context.department_id) return;
  const row = quelle !== null && typeof quelle === "object" && !Array.isArray(quelle) ? quelle : {};
  if ("department_id" in row) return; // `assertHerkunft` hat sie schon geprueft — auch auf null.
  const positionId = row.budget_position_id;
  if (typeof positionId !== "string") return; // ebenso schon abgelehnt.
  assertHerkunft(await request(client, context, "GET", `/positions/${positionId}`), context, "Position der Buchung");
}

function addMitElternpruefung(id: K14ActionId, operation: string, method: ComvenioHttpMethod, path: (input: JsonObject) => string, options: { body?: (input: JsonObject) => JsonValue; map?: (value: JsonValue, input: JsonObject) => JsonValue }): void {
  add(id, operation, async (input, context, client) => {
    await assertParentPosition(input, context, client);
    const value = await request(client, context, method, path(input), { ...(options.body ? { body: options.body(input) } : {}) });
    const safe = assertTenant(value, context);
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
// Diese Endpunkte verlangen einen Rumpf; ohne ihn antwortet der Dienst mit 422.
simple("cai.finance.05.plan_close", "close", "POST", (input) => `${plan(input)}/close`, { body: (input) => compact({ force: input.force!, note: input.note }), map: minimizePlan });
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
// Der Pfad traegt `club_id`, eine Vorpruefung der Position gibt es also nicht
// — wohl aber die des Elternpostens, falls einer genannt ist.
addMitElternpruefung("cai.finance.09.position_create", "create", "POST", (input) => `${plan(input)}/positions`, {
  body: (input) => compact({
    name: input.name!, category: input.category!, department_id: input.department_id, position_number: input.position_number!,
    context_type: input.context_type!, context_id: input.context_id, parent_position_id: input.parent_position_id,
    revenue_planned_cents: input.revenue_planned_cents!, expense_planned_cents: input.expense_planned_cents!,
    revenue_previous_year_cents: input.revenue_previous_year_cents!, expense_previous_year_cents: input.expense_previous_year_cents!,
    comment: input.comment, recurring: input.recurring!,
  }),
  map: minimizePosition,
});
simple("cai.finance.10.position_show", "show", "GET", position, { map: minimizePosition });
mitVorpruefung("cai.finance.11.position_update", "update", position, "PATCH", position, { body: (input) => object(input, "changes"), map: minimizePosition });
add("cai.finance.12.position_delete", "delete", async (input, context, client) => {
  const path = position(input);
  const quelle = await request(client, context, "GET", path);
  assertTenant(quelle, context);
  await assertDepartmentOfEntry(quelle, context, client);
  await request(client, context, "DELETE", path);
  return { deleted: true, position_id: input.position_id! };
});
mitVorpruefung("cai.finance.13.position_import_shopping", "import", position, "POST", (input) => `${position(input)}/import-shopping-estimate`, { body: (input) => ({ overwrite: input.overwrite === true }), map: minimizeImportResult });

// ── Zusammenfassung ─────────────────────────────────────────────────────────
simple("cai.finance.14.summary", "total", "GET", (input) => `${plan(input)}/summary`, { map: minimizeSummary, departments: false });
// Anders als `total` liefert dieser Endpunkt keine Zusammenfassung, sondern die
// Positionen der Abteilung (routes/budget_positions.py: List[BudgetPositionRead]).
simple("cai.finance.14.summary", "by_department", "GET", (input) => `${plan(input)}/summary/${string(input, "department_id")}`, { map: (value) => boundedFinanceList(value, 200, minimizePosition) });

// ── Buchungen ───────────────────────────────────────────────────────────────
// Liest ueber die Position — deren Abteilung wird mitgeprueft, denn die
// Buchungen selbst tragen keine.
add("cai.finance.15.entry_list", "list", async (input, context, client) => {
  const quelle = await request(client, context, "GET", position(input));
  assertTenant(quelle, context);
  const value = await request(client, context, "GET", `${position(input)}/entries`, {
    ...(typeof input.source_type === "string" ? { query: { source_type: input.source_type } } : {}),
  });
  return boundedFinanceList(assertTenant(value, context), Number(input.limit), minimizeEntry);
});
mitVorpruefung("cai.finance.16.entry_create", "create", position, "POST", (input) => `${position(input)}/entries`, {
  body: (input) => compact({ description: input.description!, revenue_cents: input.revenue_cents, expense_cents: input.expense_cents, booking_date: input.booking_date!, receipt_file_id: input.receipt_file_id, notes: input.notes }),
  map: minimizeEntry,
});
add("cai.finance.17.entry_show", "show", async (input, context, client) => {
  const value = await request(client, context, "GET", entry(input));
  assertTenant(value, context);
  await assertDepartmentOfEntry(value, context, client);
  return minimizeEntry(value);
});
mitVorpruefung("cai.finance.18.entry_update", "update", entry, "PATCH", entry, { body: (input) => object(input, "changes"), map: minimizeEntry });
add("cai.finance.19.entry_delete", "delete", async (input, context, client) => {
  const path = entry(input);
  const quelle = await request(client, context, "GET", path);
  assertTenant(quelle, context);
  await assertDepartmentOfEntry(quelle, context, client);
  await request(client, context, "DELETE", path);
  return { deleted: true, entry_id: input.entry_id! };
});
mitVorpruefung("cai.finance.20.entry_approve", "approve", entry, "POST", (input) => `${entry(input)}/approve`, { body: (input) => compact({ note: input.note }), map: minimizeEntry });

export function hasK14OperationHandler(actionId: K14ActionId, operation: string): boolean { return handlers.has(key(actionId, operation)); }
export async function executeK14Operation(actionId: K14ActionId, operation: string, input: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<JsonValue> {
  const handler = handlers.get(key(actionId, operation)); if (!handler) throw new Error(`${actionId}:${operation}: Der typisierte Handler fehlt.`); return handler(record(input), context, client);
}
