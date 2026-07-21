import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";

import {
  minimizeMeetingParticipants,
  minimizeTournamentParticipant,
  minimizeTournamentParticipants,
  redactMeetingTournamentValue,
  stableTournamentMatches,
  withLocalDaySegments,
} from "./privacy.ts";
import type { K9ActionId, K9Domain } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
type Handler = (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => Promise<JsonValue>;

function record(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error("Die validierte K9-Eingabe ist kein Objekt.");
  return value;
}

function object(input: JsonObject, key: string): JsonObject {
  const value = input[key];
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error(`Die validierte K9-Eingabe enthält kein Objekt ${key}.`);
  return value;
}

function string(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Die validierte K9-Eingabe enthält kein ${key}.`);
  return value;
}

function without(input: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
}

function query(input: JsonObject, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = input[key];
    return value === undefined || value === null ? [] : [[key, String(value)]];
  }));
}

const key = (actionId: K9ActionId, operation: string) => `${actionId}:${operation}`;
const handlers = new Map<string, Handler>();
const add = (actionId: K9ActionId, operation: string, handler: Handler) => handlers.set(key(actionId, operation), handler);

interface SimpleOptions {
  body?: (input: JsonObject) => JsonValue | undefined;
  query?: (input: JsonObject) => Record<string, string> | undefined;
  deleted_id?: string;
  response?: (value: JsonValue, input: JsonObject, context: RequestContext) => JsonValue;
}

function simple(actionId: K9ActionId, operation: string, service: K9Domain, method: ComvenioHttpMethod, path: (input: JsonObject) => string, options: SimpleOptions = {}): void {
  add(actionId, operation, async (input, context, client) => {
    const value = await client.request<JsonValue>({ method, service, path: path(input), context, ...(options.query ? { query: options.query(input) } : {}), ...(options.body ? { body: options.body(input) } : {}) });
    if (options.deleted_id) return { deleted: true, id: string(input, options.deleted_id) };
    return options.response ? options.response(value, input, context) : redactMeetingTournamentValue(value);
  });
}

const fixed = (path: string) => () => path;
const by = (prefix: string, field: string, suffix = "") => (input: JsonObject) => `${prefix}${encodeURIComponent(string(input, field))}${suffix}`;
const nested = (field: string, merge: JsonObject = {}) => (input: JsonObject) => ({ ...object(input, field), ...merge });

const series = "cai.meeting.01.series_list_show_create_update_delete" as const;
simple(series, "list", "meeting", "GET", by("/meetings/by_club/", "club_id"));
simple(series, "show", "meeting", "GET", by("/meetings/", "series_id"));
simple(series, "create", "meeting", "POST", fixed("/meetings/"), { body: (i) => ({ ...object(i, "series"), club_id: i.club_id! }) });
simple(series, "update", "meeting", "PATCH", by("/meetings/", "series_id"), { body: nested("changes") });
simple(series, "delete", "meeting", "DELETE", by("/meetings/", "series_id"), { deleted_id: "series_id" });

const protocol = "cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat" as const;
simple(protocol, "list", "meeting", "GET", fixed("/protocols/"), { query: (i) => query(i, ["club_id", "department_id", "limit", "offset"]) });
simple(protocol, "show", "meeting", "GET", by("/protocols/", "protocol_id", "/view"));
simple(protocol, "create", "meeting", "POST", fixed("/protocols/"), { body: (i) => ({ ...object(i, "protocol"), club_id: i.club_id! }) });
simple(protocol, "update", "meeting", "PATCH", by("/protocols/", "protocol_id"), { body: nested("changes") });
simple(protocol, "delete", "meeting", "DELETE", by("/protocols/", "protocol_id"), { deleted_id: "protocol_id" });
simple(protocol, "advance", "meeting", "POST", by("/protocol-management/", "protocol_id", "/advance-phase"));
simple(protocol, "revert", "meeting", "POST", by("/protocol-management/", "protocol_id", "/revert-phase"));
simple(protocol, "updates", "meeting", "GET", by("/protocol-management/", "protocol_id", "/updates"), { query: (i) => query(i, ["since"]) });
simple(protocol, "validation", "meeting", "GET", by("/protocol-validation/protocols/", "protocol_id", "/validation-status"));
simple(protocol, "publish", "meeting", "POST", by("/protocol-validation/protocols/", "protocol_id", "/publish"));

const agenda = "cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr" as const;
simple(agenda, "list", "meeting", "GET", by("/agenda-items/protocol/", "protocol_id"));
simple(agenda, "show", "meeting", "GET", by("/agenda-items/", "agenda_item_id"));
simple(agenda, "create", "meeting", "POST", by("/agenda-items/protocol/", "protocol_id"), { body: nested("agenda_item") });
simple(agenda, "update", "meeting", "PATCH", by("/agenda-items/", "agenda_item_id"), { body: nested("changes") });
simple(agenda, "delete", "meeting", "DELETE", by("/agenda-items/", "agenda_item_id"), { deleted_id: "agenda_item_id" });
simple(agenda, "reorder", "meeting", "POST", by("/agenda-management/protocol/", "protocol_id", "/reorder"), { body: (i) => ({ agenda_item_ids: i.agenda_item_ids! }) });
for (const operation of ["start", "complete", "skip"] as const) {
  simple(agenda, operation, "meeting", "POST", (i) => `/agenda-management/${string(i, "agenda_item_id")}/${operation}`, {
    query: (i) => ({ protocol_id: string(i, "protocol_id") }),
    body: operation === "complete" ? (i) => i.result : operation === "skip" ? (i) => typeof i.reason === "string" ? { reason: i.reason } : undefined : undefined,
  });
}
simple(agenda, "approve", "meeting", "POST", by("/agenda-management/", "agenda_item_id", "/approve"));

const notes = "cai.meeting.04.note_list_list_protocol_create_update_delete" as const;
simple(notes, "list", "meeting", "GET", by("/agenda-notes/agenda-item/", "agenda_item_id"));
simple(notes, "list_protocol", "meeting", "GET", by("/agenda-notes/protocol/", "protocol_id"));
simple(notes, "create", "meeting", "POST", fixed("/agenda-notes/"), { body: nested("note") });
simple(notes, "update", "meeting", "PATCH", by("/agenda-notes/", "note_id"), { body: nested("changes") });
simple(notes, "delete", "meeting", "DELETE", by("/agenda-notes/", "note_id"), { deleted_id: "note_id" });

const meetingParticipants = "cai.meeting.05.participant_list_add_update_remove_validate_unvalidate" as const;
simple(meetingParticipants, "list", "meeting", "GET", by("/participants/", "protocol_id"), { response: minimizeMeetingParticipants });
simple(meetingParticipants, "add", "meeting", "POST", by("/participants/", "protocol_id"), { body: nested("participant"), response: minimizeMeetingParticipants });
simple(meetingParticipants, "update", "meeting", "PATCH", by("/participants/", "participant_id"), { body: nested("changes"), response: minimizeMeetingParticipants });
simple(meetingParticipants, "remove", "meeting", "DELETE", by("/participants/", "participant_id"), { deleted_id: "participant_id" });
simple(meetingParticipants, "validate", "meeting", "POST", by("/protocol-validation/participants/", "participant_id", "/validate"), { response: minimizeMeetingParticipants });
simple(meetingParticipants, "unvalidate", "meeting", "DELETE", by("/protocol-validation/participants/", "participant_id", "/validate"), { deleted_id: "participant_id" });

const decision = "cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote" as const;
simple(decision, "create", "meeting", "POST", by("/decisions/agenda-item/", "agenda_item_id"), { body: nested("decision") });
simple(decision, "agenda", "meeting", "GET", by("/decisions/", "decision_id", "/agenda-item"));
simple(decision, "update", "meeting", "PATCH", by("/decisions/", "decision_id"), { body: nested("changes") });
simple(decision, "cancel", "meeting", "POST", by("/decisions/", "decision_id", "/cancel"), { query: (i) => ({ cancel_reason: string(i, "cancel_reason") }) });
simple(decision, "option_add", "meeting", "POST", by("/decisions/", "decision_id", "/options"), { body: nested("option") });
simple(decision, "options_add", "meeting", "POST", by("/decisions/", "decision_id", "/options/batch"), { body: (i) => i.options! });
simple(decision, "promote", "meeting", "POST", by("/decisions/", "decision_id", "/promote-to-resolution"), { query: (i) => ({ resolution_number: string(i, "resolution_number") }) });

const voting = "cai.meeting.07.voting_open_close_results_eligible_tally" as const;
for (const operation of ["open", "close"] as const) simple(voting, operation, "meeting", "POST", (i) => `/votes/${string(i, "decision_id")}/${operation}`);
simple(voting, "results", "meeting", "GET", by("/votes/", "decision_id", "/results"));
simple(voting, "eligible", "meeting", "GET", by("/votes/", "decision_id", "/eligible-voters"), { response: minimizeMeetingParticipants });
simple(voting, "tally", "meeting", "POST", (i) => `/votes/${string(i, "decision_id")}/offline-tally/${string(i, "option_id")}`, { query: (i) => query(i, ["count", "increment"]) });

const vote = "cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract" as const;
simple(vote, "cast", "meeting", "POST", by("/votes/", "decision_id", "/cast"), { body: nested("vote") });
simple(vote, "cast_bulk", "meeting", "POST", by("/votes/", "decision_id", "/cast/bulk"), { body: (i) => i.votes! });
simple(vote, "proxy", "meeting", "POST", by("/votes/", "decision_id", "/proxy"), { body: nested("proxy_vote") });
simple(vote, "proxy_bulk", "meeting", "POST", by("/votes/", "decision_id", "/proxy/bulk"), { body: (i) => i.proxy_votes! });
simple(vote, "option_retract", "meeting", "DELETE", (i) => `/votes/${string(i, "decision_id")}/option/${string(i, "option_id")}`, { deleted_id: "option_id" });
simple(vote, "retract", "meeting", "DELETE", by("/votes/", "decision_id"), { deleted_id: "decision_id" });

const resolution = "cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli" as const;
simple(resolution, "list", "meeting", "GET", fixed("/resolutions/"), { query: (i) => query(i, ["club_id", "department_id", "category", "valid_only", "limit", "offset"]) });
simple(resolution, "list_protocol", "meeting", "GET", by("/resolutions/protocol/", "protocol_id"));
simple(resolution, "show", "meeting", "GET", by("/resolutions/", "resolution_id"));
simple(resolution, "history", "meeting", "GET", by("/resolutions/", "resolution_id", "/history"));
simple(resolution, "create", "meeting", "POST", fixed("/resolutions/"), { body: nested("resolution") });
simple(resolution, "update", "meeting", "PATCH", by("/resolutions/", "resolution_id"), { body: nested("changes") });
for (const operation of ["approve", "decline"] as const) simple(resolution, operation, "meeting", "POST", (i) => `/resolutions/${string(i, "resolution_id")}/${operation}`, { body: operation === "decline" ? (i) => typeof i.reason === "string" ? { reason: i.reason } : undefined : undefined });
simple(resolution, "delete", "meeting", "DELETE", by("/resolutions/", "resolution_id"), { deleted_id: "resolution_id" });

const entry = "cai.meeting.10.entry_list_show_show_agenda_create_update_delete" as const;
simple(entry, "list", "meeting", "GET", by("/protocol-entries/protocol/", "protocol_id"));
simple(entry, "show", "meeting", "GET", by("/protocol-entries/", "entry_id"));
simple(entry, "show_agenda", "meeting", "GET", by("/protocol-entries/agenda-item/", "agenda_item_id"));
simple(entry, "create", "meeting", "POST", by("/protocol-entries/", "agenda_item_id"), { body: nested("entry") });
simple(entry, "update", "meeting", "PUT", by("/protocol-entries/", "entry_id"), { body: nested("changes") });
simple(entry, "delete", "meeting", "DELETE", by("/protocol-entries/", "entry_id"), { deleted_id: "entry_id" });

const attachment = "cai.meeting.11.attachment_list_add_remove" as const;
simple(attachment, "list", "meeting", "GET", by("/protocol-entries/", "entry_id", "/attachments"));
simple(attachment, "remove", "meeting", "DELETE", by("/protocol-entries/attachments/", "attachment_id"), { deleted_id: "attachment_id" });

const tournament = (number: number, suffix: string) => `cai.tournament.${String(number).padStart(2, "0")}.${suffix}` as K9ActionId;
simple(tournament(1, "series_list"), "list", "tournament", "GET", fixed("/tournament-series/"), { query: (i) => query(i, ["club_id", "limit", "offset"]) });
simple(tournament(2, "series_show"), "show", "tournament", "GET", by("/tournament-series/", "series_id"));
simple(tournament(3, "series_create"), "create", "tournament", "POST", fixed("/tournament-series/"), { body: (i) => ({ ...object(i, "series"), club_id: i.club_id! }) });
simple(tournament(4, "series_update"), "update", "tournament", "PATCH", by("/tournament-series/", "series_id"), { body: nested("changes") });
simple(tournament(5, "series_delete"), "delete", "tournament", "DELETE", by("/tournament-series/", "series_id"), { deleted_id: "series_id" });
simple(tournament(6, "execution_create"), "create", "tournament", "POST", by("/tournament-series/", "series_id", "/executions"), { body: nested("execution") });
simple(tournament(7, "execution_link"), "link", "tournament", "PATCH", by("/tournaments/", "tournament_id"), { body: (i) => ({ event_id: i.event_id! }) });
simple(tournament(8, "list"), "list", "tournament", "GET", fixed("/tournaments/"), { query: (i) => query(i, ["club_id", "department_id", "status", "limit", "offset"]) });
simple(tournament(9, "show"), "show", "tournament", "GET", by("/tournaments/", "tournament_id"), { response: (value, input) => withLocalDaySegments(value, string(input, "timezone")) });
simple(tournament(10, "update"), "update", "tournament", "PATCH", by("/tournaments/", "tournament_id"), { body: nested("changes") });
simple(tournament(11, "delete"), "delete", "tournament", "DELETE", by("/tournaments/", "tournament_id"), { deleted_id: "tournament_id" });
simple(tournament(12, "status"), "set", "tournament", "PATCH", by("/tournaments/", "tournament_id"), { body: (i) => ({ status: i.status! }) });
simple(tournament(13, "participants"), "list", "tournament", "GET", by("/tournaments/", "tournament_id", "/participants"), { response: (value, input) => minimizeTournamentParticipants(value, Number(input.limit)) });

async function createTournamentParticipant(input: JsonObject, context: RequestContext, client: ComvenioApiClient, withMember: boolean): Promise<JsonValue> {
  const created = await client.request<JsonValue>({ method: "POST", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}/participants`, context, body: {
    name: input.name!, participant_kind: input.participant_kind!, origin: "host_club", registration_status: input.registration_status!, ...(input.seed !== undefined ? { seed: input.seed } : {}), ...(input.member_id ? { captain_member_id: input.member_id } : {}),
  } });
  const participantId = record(created).id;
  if (withMember && typeof input.member_id === "string" && typeof participantId === "string") {
    await client.request({ method: "POST", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}/participants/${participantId}/members`, context, body: { member_id: input.member_id, display_name: input.name!, role: "player" } });
  }
  return minimizeTournamentParticipant(created);
}
add(tournament(14, "mannschaft"), "create", (i, c, client) => createTournamentParticipant(i, c, client, true));
add(tournament(15, "participant"), "create", (i, c, client) => createTournamentParticipant(i, c, client, false));
simple(tournament(16, "participant_withdraw"), "withdraw", "tournament", "PATCH", (i) => `/tournaments/${string(i, "tournament_id")}/participants/${string(i, "participant_id")}`, { body: (i) => ({ registration_status: "withdrawn", ...(i.mode ? { withdrawal_mode: i.mode } : {}) }), response: minimizeTournamentParticipant });
simple(tournament(17, "participant_reinstate"), "reinstate", "tournament", "PATCH", (i) => `/tournaments/${string(i, "tournament_id")}/participants/${string(i, "participant_id")}`, { body: () => ({ registration_status: "confirmed" }), response: minimizeTournamentParticipant });
simple(tournament(18, "participant_remove"), "remove", "tournament", "DELETE", (i) => `/tournaments/${string(i, "tournament_id")}/participants/${string(i, "participant_id")}`, { deleted_id: "participant_id" });
simple(tournament(19, "start"), "start", "tournament", "POST", by("/tournaments/", "tournament_id", "/start"));
add(tournament(20, "matches"), "list", async (input, context, client) => {
  const [matches, participants] = await Promise.all([
    client.request<JsonValue>({ method: "GET", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}/matches`, context }),
    client.request<JsonValue>({ method: "GET", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}/participants`, context }),
  ]);
  return { ...record(stableTournamentMatches(matches, string(input, "timezone"), Number(input.limit))), participants: record(minimizeTournamentParticipants(participants, Number(input.limit))).items ?? [] };
});
simple(tournament(21, "matches_clear"), "clear", "tournament", "POST", by("/tournaments/", "tournament_id", "/matches/clear"), { query: (i) => ({ phase: string(i, "phase") }) });
simple(tournament(22, "reset"), "reset", "tournament", "POST", by("/tournaments/", "tournament_id", "/reset"));
simple(tournament(24, "standings"), "show", "tournament", "GET", by("/tournaments/", "tournament_id", "/standings"));
simple(tournament(26, "draw"), "create", "tournament", "POST", by("/tournaments/", "tournament_id", "/draw-sessions"), { body: nested("draw_plan") });
add(tournament(27, "draw_confirm"), "confirm", async (input, context, client) => {
  const current = await client.request<JsonValue>({ method: "GET", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}/draw-sessions/current`, context });
  const drawSessionId = record(current).id;
  if (typeof drawSessionId !== "string") throw new Error("Keine aktuelle Auslosung zum Bestätigen gefunden.");
  return redactMeetingTournamentValue(await client.request({ method: "POST", service: "tournament", path: `/draw-sessions/${drawSessionId}/confirm`, context }));
});
add(tournament(29, "match_schedule"), "set", async (input, context, client) => {
  if (typeof input.match_number === "number") await client.request({ method: "PATCH", service: "tournament", path: `/matches/${string(input, "match_id")}`, context, body: { match_number: input.match_number } });
  return redactMeetingTournamentValue(await client.request({ method: "PATCH", service: "tournament", path: `/matches/${string(input, "match_id")}/schedule`, context, body: without(input, ["club_id", "match_id", "confirmation"]) }));
});
simple(tournament(30, "match_delete"), "delete", "tournament", "DELETE", by("/matches/", "match_id"), { deleted_id: "match_id" });
simple(tournament(31, "match_result"), "set", "tournament", "POST", by("/matches/", "match_id", "/result"), { body: (i) => without(i, ["club_id", "match_id", "confirmation"]) });
add(tournament(32, "deadline"), "show", async (input, context, client) => {
  const [tournamentValue, matchesValue] = await Promise.all([
    client.request<JsonValue>({ method: "GET", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}`, context }),
    client.request<JsonValue>({ method: "GET", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}/matches`, context }),
  ]);
  const rules = record(record(tournamentValue).rules_config ?? {});
  const deadline = record(rules.result_deadline ?? {});
  const overdue = (Array.isArray(matchesValue) ? matchesValue : []).filter((item) => {
    const match = record(item);
    return ["scheduled", "postponed"].includes(String(match.status)) && typeof match.deadline_at === "string" && Date.parse(match.deadline_at) < Date.now();
  }).map((item) => record(item).id).filter((id): id is string => typeof id === "string");
  return { policy: deadline.policy ?? null, overdue_match_ids: overdue };
});
simple(tournament(32, "deadline"), "set_deadline", "tournament", "PATCH", by("/tournaments/", "tournament_id", "/matches/deadline"), { query: (i) => ({ phase: string(i, "phase") }), body: (i) => ({ deadline_at: i.deadline_at! }) });
add(tournament(32, "deadline"), "set_policy", async (input, context, client) => {
  const current = await client.request<JsonValue>({ method: "GET", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}`, context });
  const rules = { ...record(record(current).rules_config ?? {}) };
  rules.result_deadline = { ...record(rules.result_deadline ?? {}), policy: input.policy! };
  return redactMeetingTournamentValue(await client.request({ method: "PATCH", service: "tournament", path: `/tournaments/${string(input, "tournament_id")}`, context, body: { rules_config: rules } }));
});

export function hasK9OperationHandler(actionId: K9ActionId, operation: string): boolean {
  return handlers.has(key(actionId, operation));
}

export async function executeK9Operation(actionId: K9ActionId, operation: string, inputValue: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<JsonValue> {
  const handler = handlers.get(key(actionId, operation));
  if (!handler) throw new Error(`${actionId}:${operation}: Der typisierte Handler fehlt.`);
  return handler(record(inputValue), context, client);
}
