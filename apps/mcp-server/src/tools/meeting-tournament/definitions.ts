import type { ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { OAuthScope } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";

import {
  K9_ACTION_IDS,
  type K9ActionDefinition,
  type K9ActionId,
  type K9BackendRoute,
  type K9Domain,
  type K9ExecutionGate,
  type K9OperationDefinition,
} from "./types.ts";

type PermissionProfile = "meeting_view" | "meeting_manage" | "agenda_add" | "agenda_manage" | "notes_add" | "vote" | "validate" | "tournament_view" | "tournament_manage" | "tournament_participants" | "tournament_results";

const permissions: Record<PermissionProfile, string[]> = {
  meeting_view: ["meeting_view", "can_view", "manage_meetings"],
  meeting_manage: ["meeting_manage", "can_manage_protocol", "manage_meetings"],
  agenda_add: ["meeting_manage", "can_add_agenda_items", "can_manage_agenda_items", "manage_meetings"],
  agenda_manage: ["meeting_manage", "can_manage_agenda_items", "can_manage_protocol", "manage_meetings"],
  notes_add: ["meeting_manage", "can_add_notes", "can_manage_protocol", "manage_meetings"],
  vote: ["meeting_manage", "can_vote", "can_manage_protocol", "manage_meetings"],
  validate: ["meeting_manage", "can_validate", "can_manage_protocol", "manage_meetings"],
  tournament_view: ["tournament_view", "view_tournaments", "manage_tournaments"],
  tournament_manage: ["tournament_manage", "manage_tournaments"],
  tournament_participants: ["tournament_manage", "manage_tournament_participants", "register_tournament_participant", "manage_tournaments"],
  tournament_results: ["tournament_manage", "manage_tournament_results", "manage_tournaments"],
};

function policy(profile: PermissionProfile): PermissionPolicy {
  return {
    all_of: [],
    any_of: [...permissions[profile]],
    owner_or_self_allowed: false,
    department_scope: "optional",
    backend_audit_refs: [`k9:${profile}`],
  };
}

function route(method: ComvenioHttpMethod, service: K9Domain, path: string, purpose?: K9BackendRoute["purpose"]): K9BackendRoute {
  return { method, service, normalized_path_template: path, purpose: purpose ?? (method === "GET" ? "read" : "mutation") };
}

interface OpInput {
  name: string;
  domain: K9Domain;
  method?: ComvenioHttpMethod;
  path?: string;
  routes?: K9BackendRoute[];
  permission: PermissionProfile;
  risk?: ActionRisk;
  gate?: K9ExecutionGate;
  scopes?: OAuthScope[];
  effect?: K9OperationDefinition["external_effect"];
}

function op(input: OpInput): K9OperationDefinition {
  const risk = input.risk ?? (input.method === "GET" ? "read" : "reversible_write");
  return {
    operation: input.name,
    required_scopes: input.scopes ?? [input.domain === "meeting" ? (risk === "read" ? "meeting.read" : "meeting.write") : (risk === "read" ? "event.read" : "event.write")],
    permission_policy: policy(input.permission),
    risk_class: risk,
    execution_gate: input.gate ?? (risk === "read" ? "inline" : risk === "critical_write" ? "agenda_confirmation" : "write_safety"),
    backend_routes: input.routes ?? [route(input.method!, input.domain, input.path!)],
    external_effect: input.effect ?? (risk === "read" ? "none" : "comvenio_private"),
  };
}

const meetingRead = (name: string, path: string, permission: PermissionProfile = "meeting_view") => op({ name, domain: "meeting", method: "GET", path, permission });
const meetingWrite = (name: string, method: ComvenioHttpMethod, path: string, permission: PermissionProfile = "meeting_manage", critical = false) => op({ name, domain: "meeting", method, path, permission, ...(critical ? { risk: "critical_write" as const } : {}) });
const tournamentRead = (name: string, path: string) => op({ name, domain: "tournament", method: "GET", path, permission: "tournament_view" });
const tournamentWrite = (name: string, method: ComvenioHttpMethod, path: string, permission: PermissionProfile = "tournament_manage", critical = false) => op({ name, domain: "tournament", method, path, permission, ...(critical ? { risk: "critical_write" as const } : {}) });

function action(action_id: K9ActionId, domain: K9Domain, source_action: string, operations: K9OperationDefinition[]): K9ActionDefinition {
  return {
    action_id,
    domain,
    source_action,
    source_path: domain === "meeting" ? "src/commands/meeting.ts" : "src/commands/tournament.ts",
    operations: Object.freeze(Object.fromEntries(operations.map((operation) => [operation.operation, operation]))),
    publication_state: "implemented",
    blocker: null,
  };
}

export const K9_ACTION_DEFINITIONS: Readonly<Record<K9ActionId, K9ActionDefinition>> = Object.freeze({
  "cai.meeting.01.series_list_show_create_update_delete": action("cai.meeting.01.series_list_show_create_update_delete", "meeting", "series list|show|create|update|delete", [
    meetingRead("list", "/meetings/by_club/{club_id}"), meetingRead("show", "/meetings/{series_id}"),
    meetingWrite("create", "POST", "/meetings/"), meetingWrite("update", "PATCH", "/meetings/{series_id}"), meetingWrite("delete", "DELETE", "/meetings/{series_id}", "meeting_manage", true),
  ]),
  "cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat": action("cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat", "meeting", "protocol list|show|create|update|delete|advance|revert|updates|validation|publish", [
    meetingRead("list", "/protocols/?club_id={club_id}"), meetingRead("show", "/protocols/{protocol_id}/view"), meetingWrite("create", "POST", "/protocols/"),
    meetingWrite("update", "PATCH", "/protocols/{protocol_id}"), meetingWrite("delete", "DELETE", "/protocols/{protocol_id}", "meeting_manage", true),
    meetingWrite("advance", "POST", "/protocol-management/{protocol_id}/advance-phase", "meeting_manage", true), meetingWrite("revert", "POST", "/protocol-management/{protocol_id}/revert-phase", "meeting_manage", true),
    meetingRead("updates", "/protocol-management/{protocol_id}/updates"), meetingRead("validation", "/protocol-validation/protocols/{protocol_id}/validation-status"),
    meetingWrite("publish", "POST", "/protocol-validation/protocols/{protocol_id}/publish", "meeting_manage", true),
  ]),
  "cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr": action("cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr", "meeting", "agenda list|show|create|update|delete|reorder|start|complete|skip|approve", [
    meetingRead("list", "/agenda-items/protocol/{protocol_id}"), meetingRead("show", "/agenda-items/{agenda_item_id}"),
    meetingWrite("create", "POST", "/agenda-items/protocol/{protocol_id}", "agenda_add", true), meetingWrite("update", "PATCH", "/agenda-items/{agenda_item_id}", "agenda_manage", true),
    meetingWrite("delete", "DELETE", "/agenda-items/{agenda_item_id}", "agenda_manage", true), meetingWrite("reorder", "POST", "/agenda-management/protocol/{protocol_id}/reorder", "agenda_manage", true),
    meetingWrite("start", "POST", "/agenda-management/{agenda_item_id}/start", "agenda_manage", true), meetingWrite("complete", "POST", "/agenda-management/{agenda_item_id}/complete", "agenda_manage", true),
    meetingWrite("skip", "POST", "/agenda-management/{agenda_item_id}/skip", "agenda_manage", true), meetingWrite("approve", "POST", "/agenda-management/{agenda_item_id}/approve", "validate", true),
  ]),
  "cai.meeting.04.note_list_list_protocol_create_update_delete": action("cai.meeting.04.note_list_list_protocol_create_update_delete", "meeting", "note list|list-protocol|create|update|delete", [
    meetingRead("list", "/agenda-notes/agenda-item/{agenda_item_id}"), meetingRead("list_protocol", "/agenda-notes/protocol/{protocol_id}"),
    meetingWrite("create", "POST", "/agenda-notes/", "notes_add"), meetingWrite("update", "PATCH", "/agenda-notes/{note_id}", "notes_add"), meetingWrite("delete", "DELETE", "/agenda-notes/{note_id}", "notes_add", true),
  ]),
  "cai.meeting.05.participant_list_add_update_remove_validate_unvalidate": action("cai.meeting.05.participant_list_add_update_remove_validate_unvalidate", "meeting", "participant list|add|update|remove|validate|unvalidate", [
    meetingRead("list", "/participants/{protocol_id}"), meetingWrite("add", "POST", "/participants/{protocol_id}"), meetingWrite("update", "PATCH", "/participants/{participant_id}"),
    meetingWrite("remove", "DELETE", "/participants/{participant_id}", "meeting_manage", true), meetingWrite("validate", "POST", "/protocol-validation/participants/{participant_id}/validate", "validate"), meetingWrite("unvalidate", "DELETE", "/protocol-validation/participants/{participant_id}/validate", "validate", true),
  ]),
  "cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote": action("cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote", "meeting", "decision create|agenda|update|cancel|option-add|options-add|promote", [
    meetingWrite("create", "POST", "/decisions/agenda-item/{agenda_item_id}", "meeting_manage", true), meetingRead("agenda", "/decisions/{decision_id}/agenda-item"),
    meetingWrite("update", "PATCH", "/decisions/{decision_id}", "meeting_manage", true), meetingWrite("cancel", "POST", "/decisions/{decision_id}/cancel", "meeting_manage", true),
    meetingWrite("option_add", "POST", "/decisions/{decision_id}/options", "meeting_manage", true), meetingWrite("options_add", "POST", "/decisions/{decision_id}/options/batch", "meeting_manage", true),
    meetingWrite("promote", "POST", "/decisions/{decision_id}/promote-to-resolution", "meeting_manage", true),
  ]),
  "cai.meeting.07.voting_open_close_results_eligible_tally": action("cai.meeting.07.voting_open_close_results_eligible_tally", "meeting", "voting open|close|results|eligible|tally", [
    meetingWrite("open", "POST", "/votes/{decision_id}/open", "meeting_manage", true), meetingWrite("close", "POST", "/votes/{decision_id}/close", "meeting_manage", true),
    meetingRead("results", "/votes/{decision_id}/results"), meetingRead("eligible", "/votes/{decision_id}/eligible-voters"), meetingWrite("tally", "POST", "/votes/{decision_id}/offline-tally/{option_id}", "meeting_manage", true),
  ]),
  "cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract": action("cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract", "meeting", "vote cast|cast-bulk|proxy|proxy-bulk|option-retract|retract", [
    meetingWrite("cast", "POST", "/votes/{decision_id}/cast", "vote", true), meetingWrite("cast_bulk", "POST", "/votes/{decision_id}/cast/bulk", "vote", true),
    meetingWrite("proxy", "POST", "/votes/{decision_id}/proxy", "vote", true), meetingWrite("proxy_bulk", "POST", "/votes/{decision_id}/proxy/bulk", "vote", true),
    meetingWrite("option_retract", "DELETE", "/votes/{decision_id}/option/{option_id}", "vote", true), meetingWrite("retract", "DELETE", "/votes/{decision_id}", "vote", true),
  ]),
  "cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli": action("cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli", "meeting", "resolution list|list-protocol|show|history|create|update|approve|decline|delete", [
    meetingRead("list", "/resolutions/?club_id={club_id}"), meetingRead("list_protocol", "/resolutions/protocol/{protocol_id}"), meetingRead("show", "/resolutions/{resolution_id}"), meetingRead("history", "/resolutions/{resolution_id}/history"),
    meetingWrite("create", "POST", "/resolutions/", "meeting_manage", true), meetingWrite("update", "PATCH", "/resolutions/{resolution_id}", "meeting_manage", true),
    meetingWrite("approve", "POST", "/resolutions/{resolution_id}/approve", "validate", true), meetingWrite("decline", "POST", "/resolutions/{resolution_id}/decline", "validate", true), meetingWrite("delete", "DELETE", "/resolutions/{resolution_id}", "meeting_manage", true),
  ]),
  "cai.meeting.10.entry_list_show_show_agenda_create_update_delete": action("cai.meeting.10.entry_list_show_show_agenda_create_update_delete", "meeting", "entry list|show|show-agenda|create|update|delete", [
    meetingRead("list", "/protocol-entries/protocol/{protocol_id}"), meetingRead("show", "/protocol-entries/{entry_id}"), meetingRead("show_agenda", "/protocol-entries/agenda-item/{agenda_item_id}"),
    meetingWrite("create", "POST", "/protocol-entries/{agenda_item_id}"), meetingWrite("update", "PUT", "/protocol-entries/{entry_id}"), meetingWrite("delete", "DELETE", "/protocol-entries/{entry_id}", "meeting_manage", true),
  ]),
  "cai.meeting.11.attachment_list_add_remove": action("cai.meeting.11.attachment_list_add_remove", "meeting", "attachment list|add|remove", [
    meetingRead("list", "/protocol-entries/{entry_id}/attachments"),
    op({ name: "add", domain: "meeting", method: "POST", path: "/protocol-entries/{entry_id}/attachments", permission: "meeting_manage", scopes: ["meeting.write", "files.write"], gate: "job", risk: "critical_write" }),
    meetingWrite("remove", "DELETE", "/protocol-entries/attachments/{attachment_id}", "meeting_manage", true),
  ]),

  "cai.tournament.01.series_list": action("cai.tournament.01.series_list", "tournament", "series-list", [tournamentRead("list", "/tournament-series/?club_id={club_id}")]),
  "cai.tournament.02.series_show": action("cai.tournament.02.series_show", "tournament", "series-show", [tournamentRead("show", "/tournament-series/{series_id}")]),
  "cai.tournament.03.series_create": action("cai.tournament.03.series_create", "tournament", "series-create", [tournamentWrite("create", "POST", "/tournament-series/")]),
  "cai.tournament.04.series_update": action("cai.tournament.04.series_update", "tournament", "series-update", [tournamentWrite("update", "PATCH", "/tournament-series/{series_id}")]),
  "cai.tournament.05.series_delete": action("cai.tournament.05.series_delete", "tournament", "series-delete", [tournamentWrite("delete", "DELETE", "/tournament-series/{series_id}", "tournament_manage", true)]),
  "cai.tournament.06.execution_create": action("cai.tournament.06.execution_create", "tournament", "execution-create", [tournamentWrite("create", "POST", "/tournament-series/{series_id}/executions")]),
  "cai.tournament.07.execution_link": action("cai.tournament.07.execution_link", "tournament", "execution-link", [tournamentWrite("link", "PATCH", "/tournaments/{tournament_id}")]),
  "cai.tournament.08.list": action("cai.tournament.08.list", "tournament", "list", [tournamentRead("list", "/tournaments/?club_id={club_id}")]),
  "cai.tournament.09.show": action("cai.tournament.09.show", "tournament", "show", [tournamentRead("show", "/tournaments/{tournament_id}")]),
  "cai.tournament.10.update": action("cai.tournament.10.update", "tournament", "update", [tournamentWrite("update", "PATCH", "/tournaments/{tournament_id}")]),
  "cai.tournament.11.delete": action("cai.tournament.11.delete", "tournament", "delete", [tournamentWrite("delete", "DELETE", "/tournaments/{tournament_id}", "tournament_manage", true)]),
  "cai.tournament.12.status": action("cai.tournament.12.status", "tournament", "status", [tournamentWrite("set", "PATCH", "/tournaments/{tournament_id}", "tournament_manage", true)]),
  "cai.tournament.13.participants": action("cai.tournament.13.participants", "tournament", "participants", [tournamentRead("list", "/tournaments/{tournament_id}/participants")]),
  "cai.tournament.14.mannschaft": action("cai.tournament.14.mannschaft", "tournament", "mannschaft", [op({ name: "create", domain: "tournament", permission: "tournament_participants", risk: "reversible_write", routes: [route("POST", "tournament", "/tournaments/{tournament_id}/participants"), route("POST", "tournament", "/tournaments/{tournament_id}/participants/{participant_id}/members")] })]),
  "cai.tournament.15.participant": action("cai.tournament.15.participant", "tournament", "participant", [tournamentWrite("create", "POST", "/tournaments/{tournament_id}/participants", "tournament_participants")]),
  "cai.tournament.16.participant_withdraw": action("cai.tournament.16.participant_withdraw", "tournament", "participant-withdraw", [tournamentWrite("withdraw", "PATCH", "/tournaments/{tournament_id}/participants/{participant_id}", "tournament_participants", true)]),
  "cai.tournament.17.participant_reinstate": action("cai.tournament.17.participant_reinstate", "tournament", "participant-reinstate", [tournamentWrite("reinstate", "PATCH", "/tournaments/{tournament_id}/participants/{participant_id}", "tournament_participants")]),
  "cai.tournament.18.participant_remove": action("cai.tournament.18.participant_remove", "tournament", "participant-remove", [tournamentWrite("remove", "DELETE", "/tournaments/{tournament_id}/participants/{participant_id}", "tournament_participants", true)]),
  "cai.tournament.19.start": action("cai.tournament.19.start", "tournament", "start", [tournamentWrite("start", "POST", "/tournaments/{tournament_id}/start", "tournament_manage", true)]),
  "cai.tournament.20.matches": action("cai.tournament.20.matches", "tournament", "matches", [op({ name: "list", domain: "tournament", permission: "tournament_view", routes: [route("GET", "tournament", "/tournaments/{tournament_id}/matches"), route("GET", "tournament", "/tournaments/{tournament_id}/participants")] })]),
  "cai.tournament.21.matches_clear": action("cai.tournament.21.matches_clear", "tournament", "matches-clear", [tournamentWrite("clear", "POST", "/tournaments/{tournament_id}/matches/clear", "tournament_manage", true)]),
  "cai.tournament.22.reset": action("cai.tournament.22.reset", "tournament", "reset", [tournamentWrite("reset", "POST", "/tournaments/{tournament_id}/reset", "tournament_manage", true)]),
  "cai.tournament.23.redraw": action("cai.tournament.23.redraw", "tournament", "redraw", [op({ name: "redraw", domain: "tournament", permission: "tournament_manage", risk: "critical_write", gate: "job", routes: [route("POST", "tournament", "/tournaments/{tournament_id}/reset"), route("POST", "tournament", "/tournaments/{tournament_id}/matches/clear"), route("POST", "tournament", "/tournaments/{tournament_id}/draw-sessions"), route("POST", "tournament", "/draw-sessions/{draw_session_id}/confirm")] })]),
  "cai.tournament.24.standings": action("cai.tournament.24.standings", "tournament", "standings", [tournamentRead("show", "/tournaments/{tournament_id}/standings")]),
  "cai.tournament.25.preview": action("cai.tournament.25.preview", "tournament", "preview", [op({ name: "export", domain: "tournament", permission: "tournament_view", risk: "critical_write", gate: "job", scopes: ["event.read", "files.export"], routes: [route("GET", "tournament", "/tournaments/{tournament_id}", "preflight"), route("GET", "tournament", "/tournaments/{tournament_id}/participants", "preflight"), route("GET", "tournament", "/tournaments/{tournament_id}/matches", "preflight"), route("GET", "tournament", "/tournaments/{tournament_id}/standings", "preflight")] })]),
  "cai.tournament.26.draw": action("cai.tournament.26.draw", "tournament", "draw", [tournamentWrite("create", "POST", "/tournaments/{tournament_id}/draw-sessions")]),
  "cai.tournament.27.draw_confirm": action("cai.tournament.27.draw_confirm", "tournament", "draw-confirm", [op({ name: "confirm", domain: "tournament", permission: "tournament_manage", risk: "critical_write", routes: [route("GET", "tournament", "/tournaments/{tournament_id}/draw-sessions/current", "preflight"), route("POST", "tournament", "/draw-sessions/{draw_session_id}/confirm")] })]),
  "cai.tournament.28.schedule_generate": action("cai.tournament.28.schedule_generate", "tournament", "schedule-generate", [op({ name: "generate", domain: "tournament", permission: "tournament_manage", risk: "critical_write", gate: "job", routes: [route("POST", "tournament", "/tournaments/{tournament_id}/schedule/generate")] })]),
  "cai.tournament.29.match_schedule": action("cai.tournament.29.match_schedule", "tournament", "match-schedule", [op({ name: "set", domain: "tournament", permission: "tournament_manage", risk: "reversible_write", routes: [route("PATCH", "tournament", "/matches/{match_id}"), route("PATCH", "tournament", "/matches/{match_id}/schedule")] })]),
  "cai.tournament.30.match_delete": action("cai.tournament.30.match_delete", "tournament", "match-delete", [tournamentWrite("delete", "DELETE", "/matches/{match_id}", "tournament_manage", true)]),
  "cai.tournament.31.match_result": action("cai.tournament.31.match_result", "tournament", "match-result", [tournamentWrite("set", "POST", "/matches/{match_id}/result", "tournament_results")]),
  "cai.tournament.32.deadline": action("cai.tournament.32.deadline", "tournament", "deadline", [
    tournamentRead("show", "/tournaments/{tournament_id}/matches"), tournamentWrite("set_deadline", "PATCH", "/tournaments/{tournament_id}/matches/deadline", "tournament_manage"),
    op({ name: "set_policy", domain: "tournament", permission: "tournament_manage", risk: "reversible_write", routes: [route("GET", "tournament", "/tournaments/{tournament_id}", "preflight"), route("PATCH", "tournament", "/tournaments/{tournament_id}")] }),
  ]),
});

export function validateK9Definitions(): void {
  if (Object.keys(K9_ACTION_DEFINITIONS).length !== K9_ACTION_IDS.length) throw new Error("K9-Aktionsinventar und Definitionen sind nicht deckungsgleich.");
  for (const actionId of K9_ACTION_IDS) {
    const definition = K9_ACTION_DEFINITIONS[actionId];
    if (!definition || Object.keys(definition.operations).length === 0) throw new Error(`${actionId}: Operationen fehlen.`);
    for (const [name, operation] of Object.entries(definition.operations)) {
      if (name !== operation.operation || operation.backend_routes.length === 0) throw new Error(`${actionId}:${name}: ungültige Branch-Definition.`);
      if (operation.risk_class === "read" && operation.execution_gate !== "inline") throw new Error(`${actionId}:${name}: Read darf kein Write-Gate verwenden.`);
      if (operation.risk_class === "critical_write" && !["agenda_confirmation", "job"].includes(operation.execution_gate)) throw new Error(`${actionId}:${name}: kritische Aktion ohne Bestätigung oder Job.`);
    }
  }
}
