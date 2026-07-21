import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, OAuthScope, RequestContext } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";
import type { z } from "zod";

export const K9_MEETING_ACTION_IDS = [
  "cai.meeting.01.series_list_show_create_update_delete",
  "cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat",
  "cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr",
  "cai.meeting.04.note_list_list_protocol_create_update_delete",
  "cai.meeting.05.participant_list_add_update_remove_validate_unvalidate",
  "cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote",
  "cai.meeting.07.voting_open_close_results_eligible_tally",
  "cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract",
  "cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli",
  "cai.meeting.10.entry_list_show_show_agenda_create_update_delete",
  "cai.meeting.11.attachment_list_add_remove",
] as const;

export const K9_TOURNAMENT_ACTION_IDS = [
  "cai.tournament.01.series_list",
  "cai.tournament.02.series_show",
  "cai.tournament.03.series_create",
  "cai.tournament.04.series_update",
  "cai.tournament.05.series_delete",
  "cai.tournament.06.execution_create",
  "cai.tournament.07.execution_link",
  "cai.tournament.08.list",
  "cai.tournament.09.show",
  "cai.tournament.10.update",
  "cai.tournament.11.delete",
  "cai.tournament.12.status",
  "cai.tournament.13.participants",
  "cai.tournament.14.mannschaft",
  "cai.tournament.15.participant",
  "cai.tournament.16.participant_withdraw",
  "cai.tournament.17.participant_reinstate",
  "cai.tournament.18.participant_remove",
  "cai.tournament.19.start",
  "cai.tournament.20.matches",
  "cai.tournament.21.matches_clear",
  "cai.tournament.22.reset",
  "cai.tournament.23.redraw",
  "cai.tournament.24.standings",
  "cai.tournament.25.preview",
  "cai.tournament.26.draw",
  "cai.tournament.27.draw_confirm",
  "cai.tournament.28.schedule_generate",
  "cai.tournament.29.match_schedule",
  "cai.tournament.30.match_delete",
  "cai.tournament.31.match_result",
  "cai.tournament.32.deadline",
] as const;

export const K9_ACTION_IDS = [...K9_MEETING_ACTION_IDS, ...K9_TOURNAMENT_ACTION_IDS] as const;

export type K9ActionId = (typeof K9_ACTION_IDS)[number];
export type K9Domain = "meeting" | "tournament";
export type K9ExecutionGate = "inline" | "write_safety" | "agenda_confirmation" | "job";

export interface K9BackendRoute {
  method: ComvenioHttpMethod;
  service: K9Domain;
  normalized_path_template: string;
  purpose: "read" | "mutation" | "preflight";
}

export interface K9OperationDefinition {
  operation: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_gate: K9ExecutionGate;
  backend_routes: readonly K9BackendRoute[];
  external_effect: "none" | "comvenio_private" | "comvenio_public" | "third_party";
}

export interface K9ActionDefinition {
  action_id: K9ActionId;
  domain: K9Domain;
  source_action: string;
  source_path: string;
  operations: Readonly<Record<string, K9OperationDefinition>>;
  publication_state: "implemented" | "blocked";
  blocker: string | null;
}

export interface K9ActionSchemaContract {
  input: z.ZodType;
  output: z.ZodType;
}

export interface K9ExecutionRequest {
  action_id: K9ActionId;
  input: unknown;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
}

export interface K9MutationRequest {
  definition: K9ActionDefinition;
  operation: K9OperationDefinition;
  input: JsonValue;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
}

export interface K9WriteSafetyPort {
  execute(request: K9MutationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}

export interface K9JobStartPort {
  start(request: K9MutationRequest): Promise<JsonValue>;
}

export interface K9ConfirmationPreview extends Record<string, JsonValue> {
  preview_id: string;
  confirmation_token: string;
  action_id: K9ActionId;
  operation: string;
  subject: string;
  summary: string;
  effects: JsonValue[];
  expires_at: string;
}

export interface AgendaConfirmationRequest {
  mutation: K9MutationRequest;
  subject: string;
  summary: string;
  effects: JsonValue[];
  confirmation: { preview_id: string; confirmation_token: string } | null;
}

export interface AgendaConfirmationPort {
  confirmOrPreview(request: AgendaConfirmationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}

export interface K9ExecutionDependencies {
  client: ComvenioApiClient;
  write_safety?: K9WriteSafetyPort;
  job_starter?: K9JobStartPort;
  agenda_confirmation?: AgendaConfirmationPort;
  on_backend_forbidden?: (input: {
    action_id: K9ActionId;
    operation: string;
    context: RequestContext;
  }) => void | Promise<void>;
}

export interface K9ActionResult extends Record<string, JsonValue> {
  action_id: K9ActionId;
  operation: string;
  status: "completed" | "confirmation_required" | "queued";
  result: JsonValue;
}
