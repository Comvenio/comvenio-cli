import type { ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { OAuthScope } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";

import { K10_ACTION_IDS, type K10ActionDefinition, type K10ActionId, type K10BackendRoute, type K10Domain, type K10ExecutionGate, type K10OperationDefinition, type K10Service } from "./types.ts";

type PermissionProfile = "member" | "booking_self" | "booking_admin" | "booking_guest_stats" | "object_manage" | "task_member" | "task_create" | "task_edit" | "task_manage";
const profiles: Record<PermissionProfile, { any_of: string[]; self: boolean }> = {
  member: { any_of: [], self: false },
  booking_self: { any_of: [], self: true },
  booking_admin: { any_of: ["booking_manage", "confirm_object_bookings"], self: false },
  booking_guest_stats: { any_of: ["booking_manage", "confirm_object_bookings", "object_manage", "manage_objects"], self: false },
  object_manage: { any_of: ["object_manage", "manage_objects"], self: false },
  task_member: { any_of: [], self: false },
  task_create: { any_of: ["task_manage", "create_tasks", "manage_tasks"], self: false },
  task_edit: { any_of: [], self: true },
  task_manage: { any_of: ["task_manage", "manage_tasks"], self: false },
};

function policy(profile: PermissionProfile): PermissionPolicy {
  const value = profiles[profile];
  return { all_of: [], any_of: [...value.any_of], owner_or_self_allowed: value.self, department_scope: "optional", backend_audit_refs: [`k10:${profile}`] };
}

function route(method: ComvenioHttpMethod, service: K10Service, path: string, purpose?: K10BackendRoute["purpose"]): K10BackendRoute {
  return { method, service, normalized_path_template: path, purpose: purpose ?? (method === "GET" ? "read" : "mutation") };
}

function op(input: { name: string; domain: K10Domain; service: K10Service; permission: PermissionProfile; method?: ComvenioHttpMethod; path?: string; routes?: K10BackendRoute[]; risk?: ActionRisk; gate?: K10ExecutionGate; scopes?: OAuthScope[] }): K10OperationDefinition {
  const risk = input.risk ?? (input.method === "GET" ? "read" : "reversible_write");
  const defaultScope = input.domain === "booking" ? (risk === "read" ? "booking.read" : "booking.write") : input.domain === "object" ? (risk === "read" ? "object.read" : "object.write") : (risk === "read" ? "task.read" : "task.write");
  return {
    operation: input.name,
    required_scopes: input.scopes ?? [defaultScope],
    permission_policy: policy(input.permission),
    risk_class: risk,
    execution_gate: input.gate ?? (risk === "read" ? "inline" : risk === "critical_write" ? "booking_confirmation" : "write_safety"),
    backend_routes: input.routes ?? [route(input.method!, input.service, input.path!)],
    external_effect: risk === "read" ? "none" : "comvenio_private",
  };
}

const read = (domain: K10Domain, service: K10Service, name: string, path: string, permission: PermissionProfile) => op({ name, domain, service, method: "GET", path, permission });
const write = (domain: K10Domain, service: K10Service, name: string, method: ComvenioHttpMethod, path: string, permission: PermissionProfile, critical = false, gate?: K10ExecutionGate) => op({ name, domain, service, method, path, permission, ...(critical ? { risk: "critical_write" as const } : {}), ...(gate ? { gate } : {}) });
const bookingRead = (name: string, path: string) => read("booking", "object", name, path, "member");
const bookingWrite = (name: string, method: ComvenioHttpMethod, path: string, permission: PermissionProfile = "booking_self", critical = false, gate?: K10ExecutionGate) => write("booking", "object", name, method, path, permission, critical, gate);
const objectRead = (name: string, path: string) => read("object", "object", name, path, "member");
const objectWrite = (name: string, method: ComvenioHttpMethod, path: string, critical = false) => write("object", "object", name, method, path, "object_manage", critical);
const taskRead = (name: string, path: string) => read("task", "task", name, path, "task_member");
const taskWrite = (name: string, method: ComvenioHttpMethod, path: string, permission: PermissionProfile = "task_edit", critical = false) => write("task", "task", name, method, path, permission, critical);

function action(action_id: K10ActionId, domain: K10Domain, source_action: string, operations: K10OperationDefinition[]): K10ActionDefinition {
  return { action_id, domain, source_action, source_path: `src/commands/${domain}.ts`, operations: Object.freeze(Object.fromEntries(operations.map((item) => [item.operation, item]))), publication_state: "implemented", blocker: null };
}

export const K10_ACTION_DEFINITIONS: Readonly<Record<K10ActionId, K10ActionDefinition>> = Object.freeze({
  "cai.booking.01.list": action("cai.booking.01.list", "booking", "list", [bookingRead("list", "/object-reservations/club/{club_id}"), bookingRead("list_object", "/object-reservations/object/{object_id}")]),
  "cai.booking.02.show": action("cai.booking.02.show", "booking", "show", [bookingRead("show", "/object-reservations/{reservation_id}")]),
  "cai.booking.03.create": action("cai.booking.03.create", "booking", "create", [op({ name: "create", domain: "booking", service: "object", permission: "booking_self", risk: "critical_write", gate: "booking_confirmation", scopes: ["booking.write", "object.read"], routes: [route("GET", "object", "/objects/{object_id}", "preflight"), route("GET", "object", "/object-reservations/object/{object_id}", "preflight"), route("GET", "object", "/object-booking-rules/object/{object_id}", "preflight"), route("POST", "object", "/object-reservations/")] })]),
  "cai.booking.04.update": action("cai.booking.04.update", "booking", "update", [op({ name: "update", domain: "booking", service: "object", permission: "booking_self", risk: "critical_write", scopes: ["booking.write", "object.read"], routes: [route("GET", "object", "/object-reservations/{reservation_id}", "preflight"), route("GET", "object", "/object-reservations/object/{object_id}", "preflight"), route("PATCH", "object", "/object-reservations/{reservation_id}")] })]),
  "cai.booking.05.approve": action("cai.booking.05.approve", "booking", "approve", [bookingWrite("approve", "PATCH", "/object-reservations/{reservation_id}", "booking_admin", true)]),
  "cai.booking.06.reject": action("cai.booking.06.reject", "booking", "reject", [bookingWrite("reject", "PATCH", "/object-reservations/{reservation_id}", "booking_admin", true)]),
  "cai.booking.07.cancel": action("cai.booking.07.cancel", "booking", "cancel", [bookingWrite("cancel", "PATCH", "/object-reservations/{reservation_id}", "booking_self", true)]),
  "cai.booking.08.delete": action("cai.booking.08.delete", "booking", "delete", [bookingWrite("delete", "DELETE", "/object-reservations/{reservation_id}", "booking_self", true)]),
  "cai.booking.09.bulk": action("cai.booking.09.bulk", "booking", "bulk", [op({ name: "create", domain: "booking", service: "object", permission: "booking_self", risk: "critical_write", scopes: ["booking.write", "object.read"], routes: [route("GET", "object", "/objects/{object_id}", "preflight"), route("GET", "object", "/object-reservations/object/{object_id}", "preflight"), route("POST", "object", "/object-reservations/bulk")] })]),
  "cai.booking.10.participant_list_show_add_add_groups_update_remove": action("cai.booking.10.participant_list_show_add_add_groups_update_remove", "booking", "participant list|show|add|add-groups|update|remove", [
    bookingRead("list", "/object-reservations/participants/reservation/{reservation_id}"), bookingRead("show", "/object-reservations/participants/{participant_id}"),
    bookingWrite("add", "POST", "/object-reservations/participants/"), bookingWrite("add_groups", "POST", "/object-reservations/participants/by-groups", "booking_self", true),
    bookingWrite("update", "PUT", "/object-reservations/participants/{participant_id}"), bookingWrite("remove", "DELETE", "/object-reservations/participants/{participant_id}", "booking_self", true),
  ]),
  "cai.booking.11.link_list_club_add_remove": action("cai.booking.11.link_list_club_add_remove", "booking", "link list|club|add|remove", [
    bookingRead("list", "/reservation-links/all-for-reservation/{reservation_id}"), bookingRead("club", "/reservation-links/by-club/{club_id}"),
    bookingWrite("add", "POST", "/reservation-links/"), bookingWrite("remove", "DELETE", "/reservation-links/{link_id}", "booking_self", true),
  ]),
  "cai.booking.12.stats_object_guests": action("cai.booking.12.stats_object_guests", "booking", "stats object|guests", [bookingRead("object", "/object-reservations/object/{object_id}/stats"), read("booking", "object", "guests", "/object-reservations/statistics/guests/{club_id}", "booking_guest_stats")]),

  "cai.object.01.list": action("cai.object.01.list", "object", "list", [objectRead("list", "/objects/club/{club_id}{type_suffix}")]),
  "cai.object.02.show": action("cai.object.02.show", "object", "show", [objectRead("show", "/objects/{object_id}")]),
  "cai.object.03.create": action("cai.object.03.create", "object", "create", [objectWrite("create", "POST", "/objects/")]),
  "cai.object.04.update": action("cai.object.04.update", "object", "update", [objectWrite("update", "PATCH", "/objects/{object_id}")]),
  "cai.object.05.delete": action("cai.object.05.delete", "object", "delete", [objectWrite("delete", "DELETE", "/objects/{object_id}", true)]),
  "cai.object.06.building_list_show_create_update_delete": action("cai.object.06.building_list_show_create_update_delete", "object", "building list|show|create|update|delete", [objectRead("list", "/buildings/club/{club_id}"), objectRead("show", "/buildings/{building_id}"), objectWrite("create", "POST", "/buildings/"), objectWrite("update", "PATCH", "/buildings/{building_id}"), objectWrite("delete", "DELETE", "/buildings/{building_id}", true)]),
  "cai.object.07.room_list_show_create_update_delete": action("cai.object.07.room_list_show_create_update_delete", "object", "room list|show|create|update|delete", [objectRead("list", "/rooms/club/{club_id}"), objectRead("show", "/rooms/{room_id}"), objectWrite("create", "POST", "/rooms/"), objectWrite("update", "PATCH", "/rooms/"), objectWrite("delete", "DELETE", "/rooms/{room_id}", true)]),
  "cai.object.08.booking_rule_list_show_create_bulk_update_delete": action("cai.object.08.booking_rule_list_show_create_bulk_update_delete", "object", "booking-rule list|show|create|bulk|update|delete", [objectRead("list", "/object-booking-rules/club/{club_id}"), objectRead("list_object", "/object-booking-rules/object/{object_id}"), objectRead("show", "/object-booking-rules/{rule_id}"), objectWrite("create", "POST", "/object-booking-rules/"), objectWrite("bulk", "POST", "/object-booking-rules/bulk", true), objectWrite("update", "PATCH", "/object-booking-rules/{rule_id}"), objectWrite("delete", "DELETE", "/object-booking-rules/{rule_id}", true)]),
  "cai.object.09.task_rule_list_show_create_update_delete": action("cai.object.09.task_rule_list_show_create_update_delete", "object", "task-rule list|show|create|update|delete", [objectRead("list", "/object-task-rules/club/{club_id}"), objectRead("list_object", "/object-task-rules/object/{object_id}"), objectRead("show", "/object-task-rules/{rule_id}"), objectWrite("create", "POST", "/object-task-rules/"), objectWrite("update", "PATCH", "/object-task-rules/{rule_id}"), objectWrite("delete", "DELETE", "/object-task-rules/{rule_id}", true)]),

  "cai.task.01.list": action("cai.task.01.list", "task", "list", [taskRead("list", "/tasks/by-club/{club_id}"), taskRead("mine", "/tasks/my-tasks/assigned/{club_id}")]),
  "cai.task.02.show": action("cai.task.02.show", "task", "show", [taskRead("show", "/tasks/{task_id}")]),
  "cai.task.03.show_subtasks": action("cai.task.03.show_subtasks", "task", "show-subtasks", [taskRead("show", "/tasks/{task_id}/subtasks")]),
  "cai.task.04.show_chain": action("cai.task.04.show_chain", "task", "show-chain", [taskRead("show", "/tasks/{task_id}/chain")]),
  "cai.task.05.create": action("cai.task.05.create", "task", "create", [taskWrite("create", "POST", "/tasks/", "task_create")]),
  "cai.task.06.bulk": action("cai.task.06.bulk", "task", "bulk", [taskWrite("create", "POST", "/tasks/bulk", "task_create", true)]),
  "cai.task.07.update": action("cai.task.07.update", "task", "update", [taskWrite("update", "PUT", "/tasks/{task_id}")]),
  "cai.task.08.assign": action("cai.task.08.assign", "task", "assign", [taskWrite("assign", "POST", "/task-assignments/")]),
  "cai.task.09.done": action("cai.task.09.done", "task", "done", [taskWrite("complete", "PUT", "/tasks/{task_id}")]),
  "cai.task.10.delete": action("cai.task.10.delete", "task", "delete", [taskWrite("delete", "DELETE", "/tasks/{task_id}", "task_manage", true)]),
  "cai.task.11.context_list_show_create_update_delete": action("cai.task.11.context_list_show_create_update_delete", "task", "context list|show|create|update|delete", [taskRead("list", "/task-contexts/by-club/{club_id}"), taskRead("show", "/task-contexts/{context_id}"), taskWrite("create", "POST", "/task-contexts/", "task_create"), taskWrite("update", "PUT", "/task-contexts/{context_id}", "task_manage"), taskWrite("delete", "DELETE", "/task-contexts/{context_id}", "task_manage", true)]),
  "cai.task.12.assignment_list_show_update_delete": action("cai.task.12.assignment_list_show_update_delete", "task", "assignment list|show|update|delete", [taskRead("list", "/task-assignments/by-task/{task_id}"), taskRead("show", "/task-assignments/{assignment_id}"), taskWrite("update", "PUT", "/task-assignments/{assignment_id}"), taskWrite("delete", "DELETE", "/task-assignments/{assignment_id}", "task_edit", true)]),
  "cai.task.13.note_list_add_update_delete": action("cai.task.13.note_list_add_update_delete", "task", "note list|add|update|delete", [taskRead("list", "/tasks/{task_id}/notes"), taskWrite("add", "POST", "/tasks/{task_id}/notes"), taskWrite("update", "PUT", "/tasks/notes/{note_id}"), taskWrite("delete", "DELETE", "/tasks/notes/{note_id}", "task_edit", true)]),
  "cai.task.14.checklist_list_add_update_toggle_delete_reorder": action("cai.task.14.checklist_list_add_update_toggle_delete_reorder", "task", "checklist list|add|update|toggle|delete|reorder", [taskRead("list", "/tasks/{task_id}/checklist-items"), taskWrite("add", "POST", "/tasks/{task_id}/checklist-items"), taskWrite("update", "PUT", "/tasks/checklist-items/{item_id}"), taskWrite("toggle", "PATCH", "/tasks/checklist-items/{item_id}/toggle"), taskWrite("delete", "DELETE", "/tasks/checklist-items/{item_id}", "task_edit", true), taskWrite("reorder", "PATCH", "/tasks/{task_id}/checklist-items/reorder", "task_edit", true)]),
});

export function validateK10Definitions(): void {
  if (Object.keys(K10_ACTION_DEFINITIONS).length !== K10_ACTION_IDS.length) throw new Error("K10-Aktionsinventar und Definitionen sind nicht deckungsgleich.");
  for (const id of K10_ACTION_IDS) {
    const definition = K10_ACTION_DEFINITIONS[id];
    if (!definition || Object.keys(definition.operations).length === 0) throw new Error(`${id}: Operationen fehlen.`);
    for (const [name, operation] of Object.entries(definition.operations)) {
      if (name !== operation.operation || operation.backend_routes.length === 0) throw new Error(`${id}:${name}: ungültige Branch-Definition.`);
      if (operation.risk_class === "read" && operation.execution_gate !== "inline") throw new Error(`${id}:${name}: Read darf kein Write-Gate verwenden.`);
      if (operation.risk_class === "critical_write" && operation.execution_gate !== "booking_confirmation") throw new Error(`${id}:${name}: kritische Aktion ohne Bestätigung.`);
    }
  }
}
