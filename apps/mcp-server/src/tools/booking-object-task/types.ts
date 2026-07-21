import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, OAuthScope, RequestContext } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";
import type { z } from "zod";

export const K10_BOOKING_ACTION_IDS = [
  "cai.booking.01.list", "cai.booking.02.show", "cai.booking.03.create", "cai.booking.04.update",
  "cai.booking.05.approve", "cai.booking.06.reject", "cai.booking.07.cancel", "cai.booking.08.delete",
  "cai.booking.09.bulk", "cai.booking.10.participant_list_show_add_add_groups_update_remove",
  "cai.booking.11.link_list_club_add_remove", "cai.booking.12.stats_object_guests",
] as const;

export const K10_OBJECT_ACTION_IDS = [
  "cai.object.01.list", "cai.object.02.show", "cai.object.03.create", "cai.object.04.update", "cai.object.05.delete",
  "cai.object.06.building_list_show_create_update_delete", "cai.object.07.room_list_show_create_update_delete",
  "cai.object.08.booking_rule_list_show_create_bulk_update_delete", "cai.object.09.task_rule_list_show_create_update_delete",
] as const;

export const K10_TASK_ACTION_IDS = [
  "cai.task.01.list", "cai.task.02.show", "cai.task.03.show_subtasks", "cai.task.04.show_chain", "cai.task.05.create",
  "cai.task.06.bulk", "cai.task.07.update", "cai.task.08.assign", "cai.task.09.done", "cai.task.10.delete",
  "cai.task.11.context_list_show_create_update_delete", "cai.task.12.assignment_list_show_update_delete",
  "cai.task.13.note_list_add_update_delete", "cai.task.14.checklist_list_add_update_toggle_delete_reorder",
] as const;

export const K10_ACTION_IDS = [...K10_BOOKING_ACTION_IDS, ...K10_OBJECT_ACTION_IDS, ...K10_TASK_ACTION_IDS] as const;
export type K10ActionId = (typeof K10_ACTION_IDS)[number];
export type K10Domain = "booking" | "object" | "task";
export type K10Service = "object" | "task";
export type K10ExecutionGate = "inline" | "write_safety" | "booking_confirmation";

export interface K10BackendRoute {
  method: ComvenioHttpMethod;
  service: K10Service;
  normalized_path_template: string;
  purpose: "read" | "mutation" | "preflight";
}

export interface K10OperationDefinition {
  operation: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_gate: K10ExecutionGate;
  backend_routes: readonly K10BackendRoute[];
  external_effect: "none" | "comvenio_private" | "comvenio_public" | "third_party";
}

export interface K10ActionDefinition {
  action_id: K10ActionId;
  domain: K10Domain;
  source_action: string;
  source_path: string;
  operations: Readonly<Record<string, K10OperationDefinition>>;
  publication_state: "implemented" | "blocked";
  blocker: string | null;
}

export interface K10ActionSchemaContract { input: z.ZodType; output: z.ZodType; }
export interface K10ExecutionRequest { action_id: K10ActionId; input: unknown; context: RequestContext; capability_snapshot: CapabilitySnapshot | null; }
export interface K10MutationRequest { definition: K10ActionDefinition; operation: K10OperationDefinition; input: JsonValue; context: RequestContext; capability_snapshot: CapabilitySnapshot; }
export interface K10WriteSafetyPort { execute(request: K10MutationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>; }
export interface K10ConfirmationPreview extends Record<string, JsonValue> {
  preview_id: string;
  confirmation_token: string;
  action_id: K10ActionId;
  operation: string;
  subject: string;
  summary: string;
  effects: JsonValue[];
  availability: AvailabilityResult[];
  expires_at: string;
}
export interface BookingConfirmationRequest {
  mutation: K10MutationRequest;
  subject: string;
  summary: string;
  effects: JsonValue[];
  availability_requests: AvailabilityRequest[];
  confirmation: { preview_id: string; confirmation_token: string } | null;
}
export interface BookingConflictPort {
  confirmOrPreview(request: BookingConfirmationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}
export interface K10ExecutionDependencies {
  client: ComvenioApiClient;
  write_safety?: K10WriteSafetyPort;
  booking_conflict?: BookingConflictPort;
  on_backend_forbidden?: (input: { action_id: K10ActionId; operation: string; context: RequestContext }) => void | Promise<void>;
}
export interface K10ActionResult extends Record<string, JsonValue> { action_id: K10ActionId; operation: string; status: "completed" | "confirmation_required"; result: JsonValue; }

export interface AvailabilityRequest { club_id: string; object_id: string; from: string; to: string; timezone: string; exclude_reservation_id?: string; }
export interface AvailabilitySlot extends Record<string, JsonValue> { from: string; to: string; status: "AVAILABLE" | "BUSY" | "NOT_BOOKABLE"; reason: string | null; }
export interface AvailabilityResult extends Record<string, JsonValue> {
  club_id: string;
  object_id: string;
  from: string;
  to: string;
  timezone: string;
  status: "AVAILABLE" | "BUSY" | "NOT_BOOKABLE";
  slots: AvailabilitySlot[];
  booking_rules_observed: number;
}
