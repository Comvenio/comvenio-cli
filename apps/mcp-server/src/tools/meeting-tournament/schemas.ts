import { z } from "zod";

import { isIanaTimeZone } from "../event-plan/calendar.ts";
import type { K9ActionId, K9ActionSchemaContract } from "./types.ts";

const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(300);
const text = z.string().max(30_000);
const dateTime = z.string().datetime({ offset: true });
const timezone = z.string().min(3).max(100).refine(isIanaTimeZone, "IANA-Zeitzone erforderlich.");
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(256) }).strict();
const pagination = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) } as const;

const forbiddenKey = /(?:token|secret|password|credential|authorization|local[_-]?path|file[_-]?path|frontend[_-]?base)/iu;
function containsForbidden(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbidden);
  if (value !== null && typeof value === "object") return Object.entries(value).some(([key, entry]) => forbiddenKey.test(key) || containsForbidden(entry));
  return false;
}
const safeObject = z.record(z.string().min(1).max(100), z.json()).refine((value) => !containsForbidden(value), "Secrets und lokale Pfade sind nicht zulässig.");
const club = { club_id: uuid } as const;
const grouped = <N extends string, T extends z.ZodRawShape>(operation: N, shape: T) => z.object({ ...club, operation: z.literal(operation), ...shape, confirmation: confirmation.optional() }).strict();
const single = <T extends z.ZodRawShape>(shape: T) => z.object({ ...club, ...shape, confirmation: confirmation.optional() }).strict();
const union = (items: [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]]) => z.discriminatedUnion("operation", items);
const contract = (input: z.ZodType): K9ActionSchemaContract => ({ input, output: z.json() });
const entityBody = (name: string) => ({ [name]: safeObject } as Record<string, typeof safeObject>);

const meetingSeries = union([
  grouped("list", { ...pagination }), grouped("show", { series_id: uuid }), grouped("create", entityBody("series")),
  grouped("update", { series_id: uuid, changes: safeObject }), grouped("delete", { series_id: uuid }),
]);
const meetingProtocol = union([
  grouped("list", { department_id: uuid.optional(), ...pagination }), grouped("show", { protocol_id: uuid }), grouped("create", entityBody("protocol")),
  grouped("update", { protocol_id: uuid, changes: safeObject }), grouped("delete", { protocol_id: uuid }), grouped("advance", { protocol_id: uuid }),
  grouped("revert", { protocol_id: uuid }), grouped("updates", { protocol_id: uuid, since: dateTime.optional() }), grouped("validation", { protocol_id: uuid }),
  grouped("publish", { protocol_id: uuid }),
]);
const meetingAgenda = union([
  grouped("list", { protocol_id: uuid }), grouped("show", { agenda_item_id: uuid }), grouped("create", { protocol_id: uuid, agenda_item: safeObject }),
  grouped("update", { agenda_item_id: uuid, changes: safeObject }), grouped("delete", { agenda_item_id: uuid }),
  grouped("reorder", { protocol_id: uuid, agenda_item_ids: z.array(uuid).min(1).max(300) }),
  grouped("start", { protocol_id: uuid, agenda_item_id: uuid }), grouped("complete", { protocol_id: uuid, agenda_item_id: uuid, result: safeObject.optional() }),
  grouped("skip", { protocol_id: uuid, agenda_item_id: uuid, reason: short.optional() }), grouped("approve", { agenda_item_id: uuid }),
]);
const meetingNotes = union([
  grouped("list", { agenda_item_id: uuid }), grouped("list_protocol", { protocol_id: uuid }), grouped("create", { note: safeObject }),
  grouped("update", { note_id: uuid, changes: safeObject }), grouped("delete", { note_id: uuid }),
]);
const meetingParticipants = union([
  grouped("list", { protocol_id: uuid }), grouped("add", { protocol_id: uuid, participant: safeObject }), grouped("update", { participant_id: uuid, changes: safeObject }),
  grouped("remove", { participant_id: uuid }), grouped("validate", { participant_id: uuid }), grouped("unvalidate", { participant_id: uuid }),
]);
const meetingDecisions = union([
  grouped("create", { agenda_item_id: uuid, decision: safeObject }), grouped("agenda", { decision_id: uuid }), grouped("update", { decision_id: uuid, changes: safeObject }),
  grouped("cancel", { decision_id: uuid, cancel_reason: short }), grouped("option_add", { decision_id: uuid, option: safeObject }),
  grouped("options_add", { decision_id: uuid, options: z.array(safeObject).min(1).max(100) }), grouped("promote", { decision_id: uuid, resolution_number: short }),
]);
const meetingVoting = union([
  grouped("open", { decision_id: uuid }), grouped("close", { decision_id: uuid }), grouped("results", { decision_id: uuid }),
  grouped("eligible", { decision_id: uuid }), grouped("tally", { decision_id: uuid, option_id: uuid, count: z.number().int().min(0), increment: z.boolean().default(false) }),
]);
const meetingVote = union([
  grouped("cast", { decision_id: uuid, vote: safeObject }), grouped("cast_bulk", { decision_id: uuid, votes: z.array(safeObject).min(1).max(500) }),
  grouped("proxy", { decision_id: uuid, proxy_vote: safeObject }), grouped("proxy_bulk", { decision_id: uuid, proxy_votes: z.array(safeObject).min(1).max(500) }),
  grouped("option_retract", { decision_id: uuid, option_id: uuid }), grouped("retract", { decision_id: uuid }),
]);
const meetingResolution = union([
  grouped("list", { department_id: uuid.optional(), category: short.optional(), valid_only: z.boolean().default(false), ...pagination }),
  grouped("list_protocol", { protocol_id: uuid }), grouped("show", { resolution_id: uuid }), grouped("history", { resolution_id: uuid }),
  grouped("create", { resolution: safeObject }), grouped("update", { resolution_id: uuid, changes: safeObject }), grouped("approve", { resolution_id: uuid }),
  grouped("decline", { resolution_id: uuid, reason: text.optional() }), grouped("delete", { resolution_id: uuid }),
]);
const meetingEntry = union([
  grouped("list", { protocol_id: uuid }), grouped("show", { entry_id: uuid }), grouped("show_agenda", { agenda_item_id: uuid }),
  grouped("create", { agenda_item_id: uuid, entry: safeObject }), grouped("update", { entry_id: uuid, changes: safeObject }), grouped("delete", { entry_id: uuid }),
]);
const meetingAttachment = union([
  grouped("list", { entry_id: uuid }), grouped("add", { entry_id: uuid, file_id: uuid, title: short.optional() }), grouped("remove", { attachment_id: uuid }),
]);

const tournamentSeriesCreate = single({ series: safeObject });
const tournamentParticipant = single({
  tournament_id: uuid, name: short, participant_kind: z.enum(["team", "individual", "pair"]).default("team"),
  registration_status: z.enum(["pending", "confirmed", "withdrawn", "rejected"]).default("confirmed"), seed: z.number().int().min(1).max(10_000).optional(), member_id: uuid.optional(),
});
const tournamentMatches = single({ tournament_id: uuid, timezone: timezone.default("Europe/Berlin"), limit: z.number().int().min(1).max(500).default(100) });
const drawPlan = z.object({
  strategy: z.enum(["random", "seeded", "manual"]), fixed_assignments: z.array(safeObject).max(1_000).optional(), knockout_config: safeObject.optional(),
}).strict();

export const K9_ACTION_SCHEMAS: Readonly<Record<K9ActionId, K9ActionSchemaContract>> = Object.freeze({
  "cai.meeting.01.series_list_show_create_update_delete": contract(meetingSeries),
  "cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat": contract(meetingProtocol),
  "cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr": contract(meetingAgenda),
  "cai.meeting.04.note_list_list_protocol_create_update_delete": contract(meetingNotes),
  "cai.meeting.05.participant_list_add_update_remove_validate_unvalidate": contract(meetingParticipants),
  "cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote": contract(meetingDecisions),
  "cai.meeting.07.voting_open_close_results_eligible_tally": contract(meetingVoting),
  "cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract": contract(meetingVote),
  "cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli": contract(meetingResolution),
  "cai.meeting.10.entry_list_show_show_agenda_create_update_delete": contract(meetingEntry),
  "cai.meeting.11.attachment_list_add_remove": contract(meetingAttachment),

  "cai.tournament.01.series_list": contract(single({ ...pagination })),
  "cai.tournament.02.series_show": contract(single({ series_id: uuid })),
  "cai.tournament.03.series_create": contract(tournamentSeriesCreate),
  "cai.tournament.04.series_update": contract(single({ series_id: uuid, changes: safeObject })),
  "cai.tournament.05.series_delete": contract(single({ series_id: uuid })),
  "cai.tournament.06.execution_create": contract(single({ series_id: uuid, execution: safeObject })),
  "cai.tournament.07.execution_link": contract(single({ tournament_id: uuid, event_id: uuid.nullable() })),
  "cai.tournament.08.list": contract(single({ department_id: uuid.optional(), status: short.optional(), ...pagination })),
  "cai.tournament.09.show": contract(single({ tournament_id: uuid, timezone: timezone.default("Europe/Berlin") })),
  "cai.tournament.10.update": contract(single({ tournament_id: uuid, changes: safeObject })),
  "cai.tournament.11.delete": contract(single({ tournament_id: uuid })),
  "cai.tournament.12.status": contract(single({ tournament_id: uuid, status: z.enum(["draft", "registration", "draw", "scheduled", "active", "completed", "cancelled", "archived"]) })),
  "cai.tournament.13.participants": contract(single({ tournament_id: uuid, limit: z.number().int().min(1).max(500).default(100) })),
  "cai.tournament.14.mannschaft": contract(tournamentParticipant),
  "cai.tournament.15.participant": contract(tournamentParticipant),
  "cai.tournament.16.participant_withdraw": contract(single({ tournament_id: uuid, participant_id: uuid, mode: z.enum(["cancel", "walkover"]).optional() })),
  "cai.tournament.17.participant_reinstate": contract(single({ tournament_id: uuid, participant_id: uuid })),
  "cai.tournament.18.participant_remove": contract(single({ tournament_id: uuid, participant_id: uuid })),
  "cai.tournament.19.start": contract(single({ tournament_id: uuid })),
  "cai.tournament.20.matches": contract(tournamentMatches),
  "cai.tournament.21.matches_clear": contract(single({ tournament_id: uuid, phase: z.enum(["group", "finals", "all"]).default("all") })),
  "cai.tournament.22.reset": contract(single({ tournament_id: uuid })),
  "cai.tournament.23.redraw": contract(single({ tournament_id: uuid, draw_plan: drawPlan })),
  "cai.tournament.24.standings": contract(single({ tournament_id: uuid })),
  "cai.tournament.25.preview": contract(single({ tournament_id: uuid, output_format: z.literal("html").default("html") })),
  "cai.tournament.26.draw": contract(single({ tournament_id: uuid, draw_plan: drawPlan })),
  "cai.tournament.27.draw_confirm": contract(single({ tournament_id: uuid })),
  "cai.tournament.28.schedule_generate": contract(single({
    tournament_id: uuid, match_minutes: z.number().int().min(1).max(1_440).optional(), break_minutes: z.number().int().min(0).max(1_440).optional(),
    field_count: z.number().int().min(1).max(500).optional(), first_kickoff: dateTime.optional(), auto_book: z.boolean().default(true), dry_run: z.boolean().default(false),
  })),
  "cai.tournament.29.match_schedule": contract(single({
    match_id: uuid, starts_at: dateTime.optional(), ends_at: dateTime.optional(), location: short.optional(), match_number: z.number().int().min(1).optional(),
    schedule_status: z.enum(["proposed", "confirmed", "postponed"]).default("proposed"),
  }).refine((value) => value.starts_at || value.ends_at || value.location || value.match_number, "Mindestens eine Spielplanänderung ist erforderlich.")),
  "cai.tournament.30.match_delete": contract(single({ match_id: uuid })),
  "cai.tournament.31.match_result": contract(single({
    match_id: uuid, result_status: z.enum(["draft", "confirmed"]).default("confirmed"), result_type: z.enum(["played", "walkover", "retired", "no_show", "no_contest"]).default("played"),
    winner_side_id: z.enum(["home", "away"]).optional(), score_home: z.number().int().min(0).max(999).optional(), score_away: z.number().int().min(0).max(999).optional(), score: safeObject.optional(),
  }).superRefine((value, ctx) => {
    if (value.result_type === "played" && value.score === undefined && (value.score_home === undefined || value.score_away === undefined)) ctx.addIssue({ code: "custom", message: "Ein gespieltes Ergebnis benötigt Tore oder Satzdaten." });
    if (!["played", "no_contest"].includes(value.result_type) && !value.winner_side_id) ctx.addIssue({ code: "custom", message: "Die Sonderwertung benötigt eine Gewinnerseite." });
  })),
  "cai.tournament.32.deadline": contract(union([
    grouped("show", { tournament_id: uuid, phase: z.enum(["group", "finals", "all"]).default("group") }),
    grouped("set_deadline", { tournament_id: uuid, phase: z.enum(["group", "finals", "all"]).default("group"), deadline_at: dateTime }),
    grouped("set_policy", { tournament_id: uuid, policy: z.enum(["manual", "auto_no_contest"]) }),
  ])),
});
