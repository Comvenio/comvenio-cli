import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import { createConnectorError, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";

import {
  minimizeGuestStatistics,
  minimizeReservation,
  minimizeReservationParticipants,
  minimizeReservations,
  minimizeTaskRelations,
  redactBookingObjectTaskValue,
  removeDirectContactData,
} from "./privacy.ts";
import type { K10ActionId, K10Service } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
type Handler = (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => Promise<JsonValue>;

function record(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error("Die validierte K10-Eingabe ist kein Objekt.");
  return value;
}

function string(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`${key} fehlt.`);
  return value;
}

function object(input: JsonObject, key: string): JsonObject {
  return record(input[key] ?? {});
}

function without(input: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
}

function query(input: JsonObject, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = input[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [[key, String(value)]] : [];
  }));
}

function assertClub(value: JsonValue, input: JsonObject, context: RequestContext): JsonValue {
  const clubId = string(input, "club_id");
  const values = Array.isArray(value) ? value : [value];
  if (values.some((entry) => {
    const item = entry !== null && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    return typeof item.club_id === "string" && item.club_id !== clubId;
  })) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Fachservice lieferte Daten eines anderen Vereins.", request_id: context.request_id, retryable: false });
  return value;
}

const handlers = new Map<string, Handler>();
const key = (actionId: K10ActionId, operation: string) => `${actionId}:${operation}`;
const add = (actionId: K10ActionId, operation: string, handler: Handler) => handlers.set(key(actionId, operation), handler);

function simple(actionId: K10ActionId, operation: string, service: K10Service, method: ComvenioHttpMethod, path: (input: JsonObject) => string, options: {
  query?: (input: JsonObject) => Record<string, string>;
  body?: (input: JsonObject) => JsonValue;
  response?: (value: JsonValue, input: JsonObject, context: RequestContext) => JsonValue;
  deleted_id?: string;
} = {}): void {
  add(actionId, operation, async (input, context, client) => {
    const value = await client.request<JsonValue>({ method, service, path: path(input), context, ...(options.query ? { query: options.query(input) } : {}), ...(options.body ? { body: options.body(input) } : {}) });
    if (options.deleted_id) return { deleted: true, id: string(input, options.deleted_id) };
    return options.response ? options.response(value, input, context) : redactBookingObjectTaskValue(assertClub(value, input, context));
  });
}

const fixed = (path: string) => () => path;
const by = (prefix: string, id: string, suffix = "") => (input: JsonObject) => `${prefix}${string(input, id)}${suffix}`;
const nested = (key: string) => (input: JsonObject) => object(input, key);

function filterReservations(value: JsonValue, input: JsonObject, context: RequestContext): JsonValue {
  const checked = assertClub(value, input, context);
  const from = Date.parse(string(input, "from"));
  const to = Date.parse(string(input, "to"));
  const list = Array.isArray(checked) ? checked : [];
  const filtered = list.filter((entry) => {
    const item = record(entry);
    return typeof item.start_time === "string" && typeof item.end_time === "string" && Date.parse(item.start_time) < to && Date.parse(item.end_time) > from;
  });
  return minimizeReservations(filtered, Number(input.limit));
}

const bookingList = "cai.booking.01.list" as const;
simple(bookingList, "list", "object", "GET", (i) => `/object-reservations/club/${string(i, "club_id")}`, { response: filterReservations });
simple(bookingList, "list_object", "object", "GET", by("/object-reservations/object/", "object_id"), { response: filterReservations });
simple("cai.booking.02.show", "show", "object", "GET", by("/object-reservations/", "reservation_id"), { response: (value, input, context) => minimizeReservation(assertClub(value, input, context)) });
simple("cai.booking.03.create", "create", "object", "POST", fixed("/object-reservations/"), { body: (i) => without(i, ["timezone", "confirmation"]), response: (value, input, context) => minimizeReservation(assertClub(value, input, context)) });

async function patchReservation(input: JsonObject, context: RequestContext, client: ComvenioApiClient, changes: JsonObject): Promise<JsonValue> {
  const current = record(assertClub(await client.request<JsonValue>({ method: "GET", service: "object", path: `/object-reservations/${string(input, "reservation_id")}`, context }), input, context));
  if (typeof input.object_id === "string" && current.object_id !== input.object_id) throw createConnectorError({ code: "CONFLICT", message: "Die Buchung gehört zu einem anderen Objekt.", request_id: context.request_id, retryable: false });
  const value = await client.request<JsonValue>({ method: "PATCH", service: "object", path: `/object-reservations/${string(input, "reservation_id")}`, context, body: {
    club_id: string(input, "club_id"), object_id: current.object_id!, ...changes,
  } });
  return minimizeReservation(assertClub(value, input, context));
}

add("cai.booking.04.update", "update", (input, context, client) => patchReservation(input, context, client, object(input, "changes")));
add("cai.booking.05.approve", "approve", (input, context, client) => patchReservation(input, context, client, { status: "approved" }));
add("cai.booking.06.reject", "reject", (input, context, client) => patchReservation(input, context, client, { status: "rejected", ...(typeof input.reason === "string" ? { comment: input.reason } : {}) }));
add("cai.booking.07.cancel", "cancel", (input, context, client) => patchReservation(input, context, client, { status: "cancelled", ...(typeof input.reason === "string" ? { comment: input.reason } : {}) }));
simple("cai.booking.08.delete", "delete", "object", "DELETE", by("/object-reservations/", "reservation_id"), { deleted_id: "reservation_id" });
simple("cai.booking.09.bulk", "create", "object", "POST", fixed("/object-reservations/bulk"), { body: (i) => without(i, ["timezone", "confirmation"]), response: (value, input, context) => redactBookingObjectTaskValue(assertClub(value, input, context)) });

const participant = "cai.booking.10.participant_list_show_add_add_groups_update_remove" as const;
simple(participant, "list", "object", "GET", by("/object-reservations/participants/reservation/", "reservation_id"), { response: (value, input, context) => minimizeReservationParticipants(assertClub(value, input, context), Number(input.limit)) });
simple(participant, "show", "object", "GET", by("/object-reservations/participants/", "participant_id"), { response: (value, input, context) => minimizeReservationParticipants(assertClub(value, input, context)) });
simple(participant, "add", "object", "POST", fixed("/object-reservations/participants/"), { body: (i) => ({ ...object(i, "participant"), club_id: i.club_id!, object_reservation_id: i.reservation_id! }), response: (value, input, context) => minimizeReservationParticipants(assertClub(value, input, context)) });
simple(participant, "add_groups", "object", "POST", fixed("/object-reservations/participants/by-groups"), { body: (i) => ({ club_id: i.club_id!, object_reservation_id: i.reservation_id!, group_ids: i.group_ids! }), response: (value, input, context) => minimizeReservationParticipants(assertClub(value, input, context), 500) });
simple(participant, "update", "object", "PUT", by("/object-reservations/participants/", "participant_id"), { body: (i) => ({ id: i.participant_id!, club_id: i.club_id!, status: i.status! }), response: (value, input, context) => minimizeReservationParticipants(assertClub(value, input, context)) });
simple(participant, "remove", "object", "DELETE", by("/object-reservations/participants/", "participant_id"), { deleted_id: "participant_id" });

const link = "cai.booking.11.link_list_club_add_remove" as const;
simple(link, "list", "object", "GET", by("/reservation-links/all-for-reservation/", "reservation_id"), { query: (i) => ({ club_id: string(i, "club_id") }) });
simple(link, "club", "object", "GET", by("/reservation-links/by-club/", "club_id"));
simple(link, "add", "object", "POST", fixed("/reservation-links/"), { query: (i) => ({ club_id: string(i, "club_id") }), body: (i) => ({ primary_reservation_id: i.primary_reservation_id!, linked_reservation_id: i.linked_reservation_id! }) });
simple(link, "remove", "object", "DELETE", by("/reservation-links/", "link_id"), { query: (i) => ({ club_id: string(i, "club_id") }), deleted_id: "link_id" });

const stats = "cai.booking.12.stats_object_guests" as const;
simple(stats, "object", "object", "GET", (i) => `/object-reservations/object/${string(i, "object_id")}/stats`, { query: (i) => query(i, ["year", "month"]) });
simple(stats, "guests", "object", "GET", by("/object-reservations/statistics/guests/", "club_id"), { query: (i) => query(i, ["from_date", "to_date"]), response: (value, input, context) => minimizeGuestStatistics(assertClub(value, input, context), Number(input.limit)) });

simple("cai.object.01.list", "list", "object", "GET", (i) => `/objects/club/${string(i, "club_id")}${typeof i.type === "string" ? `/${i.type}` : ""}`, { query: () => ({ withAll: "true" }), response: (value, input, context) => removeDirectContactData(assertClub(value, input, context)) });
simple("cai.object.02.show", "show", "object", "GET", by("/objects/", "object_id"), { query: () => ({ withAll: "true" }), response: (value, input, context) => removeDirectContactData(assertClub(value, input, context)) });
simple("cai.object.03.create", "create", "object", "POST", fixed("/objects/"), { body: (i) => ({ ...object(i, "object"), club_id: i.club_id!, department_id: i.department_id!, room_id: i.room_id ?? null, is_default: i.is_default! }) });
simple("cai.object.04.update", "update", "object", "PATCH", by("/objects/", "object_id"), { body: (i) => ({ id: i.object_id!, ...object(i, "changes") }) });
simple("cai.object.05.delete", "delete", "object", "DELETE", by("/objects/", "object_id"), { query: () => ({ force: "true" }), deleted_id: "object_id" });

const building = "cai.object.06.building_list_show_create_update_delete" as const;
simple(building, "list", "object", "GET", by("/buildings/club/", "club_id"), { query: (i) => ({ withRooms: String(i.with_rooms) }) });
simple(building, "show", "object", "GET", by("/buildings/", "building_id"), { query: (i) => ({ withRooms: String(i.with_rooms) }) });
simple(building, "create", "object", "POST", fixed("/buildings/"), { body: (i) => ({ ...object(i, "building"), club_id: i.club_id! }) });
add(building, "update", async (input, context, client) => {
  const current = record(assertClub(await client.request<JsonValue>({ method: "GET", service: "object", path: `/buildings/${string(input, "building_id")}`, context }), input, context));
  const changes = object(input, "changes");
  return redactBookingObjectTaskValue(assertClub(await client.request<JsonValue>({ method: "PATCH", service: "object", path: `/buildings/${string(input, "building_id")}`, context, body: {
    id: input.building_id!, club_id: input.club_id!, name: changes.name ?? current.name!, description: changes.description ?? current.description ?? null,
    address: changes.address ?? current.address ?? null, department_id: changes.department_id ?? current.department_id!,
  } }), input, context));
});
simple(building, "delete", "object", "DELETE", by("/buildings/", "building_id"), { query: () => ({ force: "true" }), deleted_id: "building_id" });

const room = "cai.object.07.room_list_show_create_update_delete" as const;
simple(room, "list", "object", "GET", by("/rooms/club/", "club_id"));
simple(room, "show", "object", "GET", by("/rooms/", "room_id"));
simple(room, "create", "object", "POST", fixed("/rooms/"), { body: (i) => ({ ...object(i, "room"), club_id: i.club_id! }) });
simple(room, "update", "object", "PATCH", fixed("/rooms/"), { body: (i) => ({ id: i.room_id!, club_id: i.club_id!, ...object(i, "changes") }) });
simple(room, "delete", "object", "DELETE", by("/rooms/", "room_id"), { query: () => ({ force: "true" }), deleted_id: "room_id" });

const bookingRule = "cai.object.08.booking_rule_list_show_create_bulk_update_delete" as const;
simple(bookingRule, "list", "object", "GET", by("/object-booking-rules/club/", "club_id"));
simple(bookingRule, "list_object", "object", "GET", by("/object-booking-rules/object/", "object_id"));
simple(bookingRule, "show", "object", "GET", by("/object-booking-rules/", "rule_id"));
simple(bookingRule, "create", "object", "POST", fixed("/object-booking-rules/"), { body: (i) => ({ ...object(i, "rule"), club_id: i.club_id! }) });
simple(bookingRule, "bulk", "object", "POST", fixed("/object-booking-rules/bulk"), { body: (i) => (i.rules as JsonValue[]).map((entry) => ({ ...record(entry), club_id: i.club_id! })) });
simple(bookingRule, "update", "object", "PATCH", by("/object-booking-rules/", "rule_id"), { body: (i) => ({ club_id: i.club_id!, ...object(i, "changes") }) });
simple(bookingRule, "delete", "object", "DELETE", by("/object-booking-rules/", "rule_id"), { deleted_id: "rule_id" });

const taskRule = "cai.object.09.task_rule_list_show_create_update_delete" as const;
simple(taskRule, "list", "object", "GET", by("/object-task-rules/club/", "club_id"));
simple(taskRule, "list_object", "object", "GET", by("/object-task-rules/object/", "object_id"));
simple(taskRule, "show", "object", "GET", by("/object-task-rules/", "rule_id"));
simple(taskRule, "create", "object", "POST", fixed("/object-task-rules/"), { body: (i) => ({ ...object(i, "rule"), club_id: i.club_id! }) });
simple(taskRule, "update", "object", "PATCH", by("/object-task-rules/", "rule_id"), { body: (i) => ({ id: i.rule_id!, club_id: i.club_id!, ...object(i, "changes") }) });
simple(taskRule, "delete", "object", "DELETE", by("/object-task-rules/", "rule_id"), { deleted_id: "rule_id" });

const taskList = "cai.task.01.list" as const;
simple(taskList, "list", "task", "GET", by("/tasks/by-club/", "club_id"), { response: (value, input, context) => minimizeTaskRelations(assertClub(value, input, context)) });
simple(taskList, "mine", "task", "GET", by("/tasks/my-tasks/assigned/", "club_id"), { response: (value, input, context) => minimizeTaskRelations(assertClub(value, input, context)) });
for (const [actionId, suffix] of [["cai.task.02.show", ""], ["cai.task.03.show_subtasks", "/subtasks"], ["cai.task.04.show_chain", "/chain"]] as const) {
  simple(actionId, "show", "task", "GET", by("/tasks/", "task_id", suffix), { response: (value, input, context) => minimizeTaskRelations(assertClub(value, input, context)) });
}
simple("cai.task.05.create", "create", "task", "POST", fixed("/tasks/"), { body: (i) => ({ ...object(i, "task"), club_id: i.club_id! }), response: (value, input, context) => minimizeTaskRelations(assertClub(value, input, context)) });
simple("cai.task.06.bulk", "create", "task", "POST", fixed("/tasks/bulk"), { body: (i) => ({ items: (i.items as JsonValue[]).map((entry) => { const item = record(entry); return { ...item, task: { ...record(item.task ?? {}), club_id: i.club_id! } }; }) }), response: (value, input, context) => minimizeTaskRelations(assertClub(value, input, context)) });
simple("cai.task.07.update", "update", "task", "PUT", by("/tasks/", "task_id"), { body: nested("changes"), response: (value, input, context) => minimizeTaskRelations(assertClub(value, input, context)) });
simple("cai.task.08.assign", "assign", "task", "POST", fixed("/task-assignments/"), { body: (i) => ({ ...object(i, "assignment"), task_id: i.task_id!, club_id: i.club_id! }), response: (value) => minimizeTaskRelations(value) });
simple("cai.task.09.done", "complete", "task", "PUT", by("/tasks/", "task_id"), { body: (i) => ({ status: "completed", completed_at: i.completed_at! }), response: (value, input, context) => minimizeTaskRelations(assertClub(value, input, context)) });
simple("cai.task.10.delete", "delete", "task", "DELETE", by("/tasks/", "task_id"), { deleted_id: "task_id" });

const taskContext = "cai.task.11.context_list_show_create_update_delete" as const;
simple(taskContext, "list", "task", "GET", by("/task-contexts/by-club/", "club_id"));
simple(taskContext, "show", "task", "GET", by("/task-contexts/", "context_id"));
simple(taskContext, "create", "task", "POST", fixed("/task-contexts/"), { body: (i) => ({ ...object(i, "context"), club_id: i.club_id! }) });
simple(taskContext, "update", "task", "PUT", by("/task-contexts/", "context_id"), { body: (i) => ({ is_default: i.is_default! }) });
simple(taskContext, "delete", "task", "DELETE", by("/task-contexts/", "context_id"), { deleted_id: "context_id" });

const taskAssignment = "cai.task.12.assignment_list_show_update_delete" as const;
simple(taskAssignment, "list", "task", "GET", by("/task-assignments/by-task/", "task_id"), { response: minimizeTaskRelations });
simple(taskAssignment, "show", "task", "GET", by("/task-assignments/", "assignment_id"), { response: minimizeTaskRelations });
simple(taskAssignment, "update", "task", "PUT", by("/task-assignments/", "assignment_id"), { body: (i) => ({ is_responsible: i.is_responsible! }), response: minimizeTaskRelations });
simple(taskAssignment, "delete", "task", "DELETE", by("/task-assignments/", "assignment_id"), { deleted_id: "assignment_id" });

const note = "cai.task.13.note_list_add_update_delete" as const;
simple(note, "list", "task", "GET", by("/tasks/", "task_id", "/notes"));
simple(note, "add", "task", "POST", by("/tasks/", "task_id", "/notes"), { body: (i) => ({ content: i.content! }) });
simple(note, "update", "task", "PUT", by("/tasks/notes/", "note_id"), { body: (i) => ({ content: i.content! }) });
simple(note, "delete", "task", "DELETE", by("/tasks/notes/", "note_id"), { deleted_id: "note_id" });

const checklist = "cai.task.14.checklist_list_add_update_toggle_delete_reorder" as const;
simple(checklist, "list", "task", "GET", by("/tasks/", "task_id", "/checklist-items"));
simple(checklist, "add", "task", "POST", by("/tasks/", "task_id", "/checklist-items"), { body: nested("item") });
simple(checklist, "update", "task", "PUT", by("/tasks/checklist-items/", "item_id"), { body: nested("changes") });
simple(checklist, "toggle", "task", "PATCH", by("/tasks/checklist-items/", "item_id", "/toggle"));
simple(checklist, "delete", "task", "DELETE", by("/tasks/checklist-items/", "item_id"), { deleted_id: "item_id" });
simple(checklist, "reorder", "task", "PATCH", by("/tasks/", "task_id", "/checklist-items/reorder"), { body: (i) => ({ ordered_ids: i.ordered_ids! }) });

export function hasK10OperationHandler(actionId: K10ActionId, operation: string): boolean {
  return handlers.has(key(actionId, operation));
}

export async function executeK10Operation(actionId: K10ActionId, operation: string, inputValue: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<JsonValue> {
  const handler = handlers.get(key(actionId, operation));
  if (!handler) throw new Error(`${actionId}:${operation}: Der typisierte Handler fehlt.`);
  return handler(record(inputValue), context, client);
}
