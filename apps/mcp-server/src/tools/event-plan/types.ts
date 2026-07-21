import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, OAuthScope, RequestContext } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";
import type { z } from "zod";

export const K8_EVENT_ACTION_IDS = [
  "cai.event.01.list",
  "cai.event.02.show",
  "cai.event.03.create",
  "cai.event.04.update",
  "cai.event.05.publish",
  "cai.event.06.delete",
  "cai.event.07.template_list_create_clone_instantiate",
  "cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n",
  "cai.event.09.area_list_add_show_update_delete_bulk_copy",
  "cai.event.10.assignment_list_add_remove_clear",
  "cai.event.11.lead_list_add_update_delete",
  "cai.event.12.area_note_list_add_update_delete",
  "cai.event.13.program_list_add_update_delete_reorder",
  "cai.event.14.contact_list_add_update_delete",
  "cai.event.15.resource_list_add_set_remove_link_show_link_update_link_delete_usage_u",
  "cai.event.16.attachment_list_show_add_update_delete",
  "cai.event.17.tag_category_and_assignment_workflows",
  "cai.event.18.sponsor_and_sponsor_program_workflows",
  "cai.event.19.invitation_and_club_invitation_workflows",
  "cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate",
  "cai.event.21.budget_show_set_delete",
  "cai.event.22.design_theme_and_asset_workflows",
  "cai.event.23.copy_set_reset",
  "cai.event.24.dj_settings_and_request_workflows",
  "cai.event.25.external_sync_workflows",
  "cai.event.26.instance_previous_next_compare_clone_next",
  "cai.event.27.child_list_create_invitation_summary",
  "cai.event.28.menu_list_assign_unassign",
] as const;

export const K8_PLAN_ACTION_IDS = [
  "cai.plan.01.list",
  "cai.plan.02.show",
  "cai.plan.03.create",
  "cai.plan.04.update",
  "cai.plan.05.delete",
  "cai.plan.06.zone_list_create_update_delete_link_unlink",
  "cai.plan.07.table_create_duplicate_update_delete",
  "cai.plan.08.marker_create_update_delete",
  "cai.plan.09.guest_list_add_update_delete",
  "cai.plan.10.detail",
  "cai.plan.11.export",
  "cai.plan.12.illustrate",
  "cai.plan.13.compose",
] as const;

export const K8_ACTION_IDS = [...K8_EVENT_ACTION_IDS, ...K8_PLAN_ACTION_IDS] as const;

export type K8ActionId = (typeof K8_ACTION_IDS)[number];
export type K8Domain = "event" | "plan";
export type K8ExecutionGate = "inline" | "write_safety" | "event_confirmation" | "job";

export interface K8BackendRoute {
  method: ComvenioHttpMethod;
  service: "event" | "supply";
  normalized_path_template: string;
  purpose: "read" | "mutation" | "preflight";
}

export interface K8OperationDefinition {
  operation: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_gate: K8ExecutionGate;
  backend_routes: readonly K8BackendRoute[];
  external_effect: "none" | "comvenio_private" | "comvenio_public" | "third_party";
}

export interface K8ActionDefinition {
  action_id: K8ActionId;
  domain: K8Domain;
  source_action: string;
  source_path: string;
  operations: Readonly<Record<string, K8OperationDefinition>>;
  publication_state: "implemented" | "blocked";
  blocker: string | null;
}

export interface K8ActionSchemaContract {
  input: z.ZodType;
  output: z.ZodType;
}

export interface EventPreviewContract extends Record<string, JsonValue> {
  preview_id: string;
  confirmation_token: string;
  action_id: K8ActionId;
  operation: string;
  subject: string;
  summary: string;
  effects: JsonValue[];
  expires_at: string;
}

export interface K8ExecutionRequest {
  action_id: K8ActionId;
  input: unknown;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
}

export interface K8MutationRequest {
  definition: K8ActionDefinition;
  operation: K8OperationDefinition;
  input: JsonValue;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
}

export interface K8WriteSafetyPort {
  execute(request: K8MutationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}

export interface K8JobStartPort {
  start(request: K8MutationRequest): Promise<JsonValue>;
}

export interface EventConfirmationRequest {
  mutation: K8MutationRequest;
  subject: string;
  summary: string;
  effects: JsonValue[];
  confirmation: { preview_id: string; confirmation_token: string } | null;
}

export interface EventConfirmationPort {
  confirmOrPreview(request: EventConfirmationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}

export interface K8ExecutionDependencies {
  client: ComvenioApiClient;
  write_safety?: K8WriteSafetyPort;
  job_starter?: K8JobStartPort;
  event_confirmation?: EventConfirmationPort;
  on_backend_forbidden?: (input: {
    action_id: K8ActionId;
    operation: string;
    context: RequestContext;
  }) => void | Promise<void>;
}

export interface K8ActionResult extends Record<string, JsonValue> {
  action_id: K8ActionId;
  operation: string;
  status: "completed" | "confirmation_required";
  result: JsonValue;
}

export type K8ActionHandler = (
  input: JsonValue,
  context: RequestContext,
  client: ComvenioApiClient,
) => Promise<JsonValue>;
