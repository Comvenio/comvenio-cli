import { z } from "zod";

import { isIanaTimeZone } from "../event-plan/calendar.ts";
import type { K10ActionId, K10ActionSchemaContract } from "./types.ts";

const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(300);
const text = z.string().max(30_000);
const dateTime = z.string().datetime({ offset: true });
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u);
const timezone = z.string().min(3).max(100).refine(isIanaTimeZone, "IANA-Zeitzone erforderlich.");
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(256) }).strict();
const pagination = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) } as const;
const range = { from: dateTime, to: dateTime, timezone } as const;
const club = { club_id: uuid } as const;

const grouped = <N extends string, T extends z.ZodRawShape>(operation: N, shape: T) =>
  z.object({ ...club, operation: z.literal(operation), ...shape, confirmation: confirmation.optional() }).strict();
const single = <T extends z.ZodRawShape>(shape: T) => z.object({ ...club, ...shape, confirmation: confirmation.optional() }).strict();
const union = (items: [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]]) => z.discriminatedUnion("operation", items);
const contract = (input: z.ZodType): K10ActionSchemaContract => ({ input, output: z.json() });

const reservationStatus = z.enum(["requested", "approved", "rejected", "cancelled"]);
const participantStatus = z.enum(["invited", "accepted", "declined", "cancelled"]);
const objectType = z.enum(["static", "portable", "event"]);
const bookingGranularity = z.enum(["15min", "30min", "hourly", "timedate"]);
const guestFeeMode = z.enum(["per_booking", "per_hour"]);
const weekday = z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const taskStatus = z.enum(["open", "in_progress", "completed", "cancelled"]);
const taskPriority = z.enum(["low", "medium", "high"]);
const taskPhase = z.enum(["preparation", "execution", "followup"]);
const systemTaskType = z.enum(["none", "create_event", "manage_event", "assign_shift", "create_news", "create_object", "manage_object", "create_meeting", "manage_meeting", "create_protocol", "create_supply", "manage_supply", "manage_shopping"]);
const taskContextType = z.enum(["club", "event", "object", "meeting", "supply"]);

const participantCreate = z.object({
  club_id: uuid,
  member_id: uuid.optional(),
  status: participantStatus.default("invited"),
  is_guest: z.boolean().default(false),
  guest_name: short.optional(),
  guest_email: z.string().email().max(320).optional(),
}).strict().superRefine((value, context) => {
  if (value.is_guest && !value.member_id && !value.guest_name) context.addIssue({ code: "custom", message: "Gastname oder Mitglied ist erforderlich." });
  if (!value.is_guest && !value.member_id) context.addIssue({ code: "custom", message: "Mitglied ist erforderlich." });
});

const bookingCreateFields = {
  object_id: uuid,
  start_time: dateTime,
  end_time: dateTime,
  timezone,
  status: reservationStatus.default("requested"),
  title: short.default("Buchung"),
  comment: text.optional(),
  resp_member_id: uuid.optional(),
  participants: z.array(participantCreate).max(500).optional(),
} as const;

const bookingChanges = z.object({
  start_time: dateTime.optional(),
  end_time: dateTime.optional(),
  title: short.optional(),
  comment: text.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Mindestens eine Änderung ist erforderlich.");

const objectFields = {
  name: short,
  description: text.nullable().optional(),
  type: objectType,
  is_active: z.boolean().default(true),
  booking_granularity: bookingGranularity,
  min_duration_minutes: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  max_duration_minutes: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  approval_required: z.boolean().default(false),
  max_participants: z.number().int().min(1).max(1_000).nullable().optional(),
  guest_fee: z.number().min(0).nullable().optional(),
  guest_fee_mode: guestFeeMode.nullable().optional(),
  guest_fee_per_person: z.boolean().default(true),
} as const;

const objectChanges = z.object({
  name: short.optional(), description: text.nullable().optional(), type: objectType.optional(), is_active: z.boolean().optional(),
  booking_granularity: bookingGranularity.optional(), min_duration_minutes: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  max_duration_minutes: z.number().int().min(1).max(2_147_483_647).nullable().optional(), approval_required: z.boolean().optional(),
  max_participants: z.number().int().min(1).max(1_000).nullable().optional(), guest_fee: z.number().min(0).nullable().optional(),
  guest_fee_mode: guestFeeMode.nullable().optional(), guest_fee_per_person: z.boolean().optional(), sponsor_deal_id: uuid.nullable().optional(),
  is_sponsored: z.boolean().optional(), sponsor_label: short.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Mindestens eine Änderung ist erforderlich.");

const buildingFields = { name: short, description: text.nullable().optional(), address: z.string().max(1_000).nullable().optional(), department_id: uuid } as const;
const buildingChanges = z.object({ name: short.optional(), description: text.nullable().optional(), address: z.string().max(1_000).nullable().optional(), department_id: uuid.optional() }).strict().refine((value) => Object.keys(value).length > 0);
const roomFields = { name: short, description: text.nullable().optional(), capacity: z.number().int().min(0).max(100_000).nullable().optional(), building_id: uuid, booking: z.boolean().default(false) } as const;
const roomChanges = z.object({ name: short.optional(), description: text.nullable().optional(), capacity: z.number().int().min(0).max(100_000).nullable().optional(), building_id: uuid.optional(), booking: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0);

const bookingRuleFields = {
  object_id: uuid, weekday, start_time: time, end_time: time,
  valid_from_month: z.number().int().min(1).max(12).nullable().optional(), valid_from_day: z.number().int().min(1).max(31).nullable().optional(),
  valid_until_month: z.number().int().min(1).max(12).nullable().optional(), valid_until_day: z.number().int().min(1).max(31).nullable().optional(),
} as const;
const bookingRuleChanges = z.object({
  weekday: weekday.optional(), start_time: time.optional(), end_time: time.optional(),
  valid_from_month: z.number().int().min(1).max(12).nullable().optional(), valid_from_day: z.number().int().min(1).max(31).nullable().optional(),
  valid_until_month: z.number().int().min(1).max(12).nullable().optional(), valid_until_day: z.number().int().min(1).max(31).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const taskRuleFields = { object_id: uuid, title: short, description: text.nullable().optional(), priority: taskPriority.default("medium"), due_offset_days: z.number().int().min(0).max(36_500).default(0) } as const;
const taskRuleChanges = z.object({ title: short.optional(), description: text.nullable().optional(), priority: taskPriority.optional(), due_offset_days: z.number().int().min(0).max(36_500).optional() }).strict().refine((value) => Object.keys(value).length > 0);

const taskFields = {
  title: short, description: text.nullable().optional(), department_id: uuid.nullable().optional(), status: taskStatus.default("open"), priority: taskPriority.default("medium"),
  due_date: dateTime.nullable().optional(), reminder_active: z.boolean().default(false), reminder_date: dateTime.nullable().optional(), is_template: z.boolean().default(false),
  parent_task_id: uuid.nullable().optional(), completion_rate: z.number().int().min(0).max(100).nullable().optional(), completed_at: dateTime.nullable().optional(),
  system_task_type: systemTaskType.default("none"), system_data_id: uuid.nullable().optional(), task_phase: taskPhase.nullable().optional(),
  scheduled_start: dateTime.nullable().optional(), scheduled_end: dateTime.nullable().optional(), required_assignees: z.number().int().min(1).nullable().optional(),
  max_assignees: z.number().int().min(1).nullable().optional(), task_context_id: uuid,
} as const;
const taskChanges = z.object({
  title: short.optional(), description: text.nullable().optional(), status: taskStatus.optional(), priority: taskPriority.optional(), due_date: dateTime.nullable().optional(),
  reminder_active: z.boolean().optional(), reminder_date: dateTime.nullable().optional(), is_template: z.boolean().optional(), parent_task_id: uuid.nullable().optional(),
  completion_rate: z.number().int().min(0).max(100).nullable().optional(), completed_at: dateTime.nullable().optional(), system_task_type: systemTaskType.optional(),
  system_data_id: uuid.nullable().optional(), task_phase: taskPhase.nullable().optional(), scheduled_start: dateTime.nullable().optional(), scheduled_end: dateTime.nullable().optional(),
  required_assignees: z.number().int().min(1).nullable().optional(), max_assignees: z.number().int().min(1).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Mindestens eine Änderung ist erforderlich.");
const checklistItem = z.object({ title: short, description: text.nullable().optional(), order_index: z.number().int().min(0).max(100_000).default(0) }).strict();
const assignment = z.object({ member_id: uuid, is_responsible: z.boolean().default(false) }).strict();

const schemas: Record<K10ActionId, K10ActionSchemaContract> = {
  "cai.booking.01.list": contract(union([grouped("list", { ...range, ...pagination }), grouped("list_object", { object_id: uuid, ...range, ...pagination })])),
  "cai.booking.02.show": contract(single({ reservation_id: uuid, timezone })),
  "cai.booking.03.create": contract(single(bookingCreateFields).refine((value) => Date.parse(value.start_time) < Date.parse(value.end_time), "Das Ende muss nach dem Beginn liegen.")),
  "cai.booking.04.update": contract(single({ reservation_id: uuid, object_id: uuid, timezone, changes: bookingChanges })),
  "cai.booking.05.approve": contract(single({ reservation_id: uuid, object_id: uuid })),
  "cai.booking.06.reject": contract(single({ reservation_id: uuid, object_id: uuid, reason: text.optional() })),
  "cai.booking.07.cancel": contract(single({ reservation_id: uuid, object_id: uuid, reason: text.optional() })),
  "cai.booking.08.delete": contract(single({ reservation_id: uuid })),
  "cai.booking.09.bulk": contract(single({
    ...bookingCreateFields, group_ids: z.array(uuid).max(500).optional(),
    portable_reservations: z.array(z.object({ object_id: uuid, start_time: dateTime, end_time: dateTime, title: short.optional() }).strict()).max(100).optional(),
  })),
  "cai.booking.10.participant_list_show_add_add_groups_update_remove": contract(union([
    grouped("list", { reservation_id: uuid, ...pagination }), grouped("show", { participant_id: uuid }),
    grouped("add", { reservation_id: uuid, participant: participantCreate }), grouped("add_groups", { reservation_id: uuid, group_ids: z.array(uuid).min(1).max(500) }),
    grouped("update", { participant_id: uuid, status: participantStatus }), grouped("remove", { participant_id: uuid }),
  ])),
  "cai.booking.11.link_list_club_add_remove": contract(union([
    grouped("list", { reservation_id: uuid }), grouped("club", { ...pagination }), grouped("add", { primary_reservation_id: uuid, linked_reservation_id: uuid }), grouped("remove", { link_id: uuid }),
  ])),
  "cai.booking.12.stats_object_guests": contract(union([
    grouped("object", { object_id: uuid, year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12).optional() }),
    grouped("guests", { from_date: dateTime.optional(), to_date: dateTime.optional(), limit: z.number().int().min(1).max(100).default(50) }),
  ])),

  "cai.object.01.list": contract(single({ type: objectType.optional(), ...pagination })),
  "cai.object.02.show": contract(single({ object_id: uuid })),
  "cai.object.03.create": contract(single({ department_id: uuid, room_id: uuid.nullable().optional(), is_default: z.boolean().default(false), object: z.object(objectFields).strict() })),
  "cai.object.04.update": contract(single({ object_id: uuid, changes: objectChanges })),
  "cai.object.05.delete": contract(single({ object_id: uuid, force: z.literal(true) })),
  "cai.object.06.building_list_show_create_update_delete": contract(union([
    grouped("list", { department_id: uuid.optional(), with_rooms: z.boolean().default(true) }), grouped("show", { building_id: uuid, with_rooms: z.boolean().default(true) }),
    grouped("create", { building: z.object(buildingFields).strict() }), grouped("update", { building_id: uuid, changes: buildingChanges }), grouped("delete", { building_id: uuid, force: z.literal(true) }),
  ])),
  "cai.object.07.room_list_show_create_update_delete": contract(union([
    grouped("list", { building_id: uuid.optional() }), grouped("show", { room_id: uuid }), grouped("create", { room: z.object(roomFields).strict() }),
    grouped("update", { room_id: uuid, changes: roomChanges }), grouped("delete", { room_id: uuid, force: z.literal(true) }),
  ])),
  "cai.object.08.booking_rule_list_show_create_bulk_update_delete": contract(union([
    grouped("list", { ...pagination }), grouped("list_object", { object_id: uuid }), grouped("show", { rule_id: uuid }),
    grouped("create", { rule: z.object(bookingRuleFields).strict() }), grouped("bulk", { rules: z.array(z.object(bookingRuleFields).strict()).min(1).max(500) }),
    grouped("update", { rule_id: uuid, changes: bookingRuleChanges }), grouped("delete", { rule_id: uuid }),
  ])),
  "cai.object.09.task_rule_list_show_create_update_delete": contract(union([
    grouped("list", { ...pagination }), grouped("list_object", { object_id: uuid }), grouped("show", { rule_id: uuid }),
    grouped("create", { rule: z.object(taskRuleFields).strict() }), grouped("update", { rule_id: uuid, changes: taskRuleChanges }), grouped("delete", { rule_id: uuid }),
  ])),

  "cai.task.01.list": contract(union([grouped("list", { ...pagination }), grouped("mine", { ...pagination })])),
  "cai.task.02.show": contract(single({ task_id: uuid })),
  "cai.task.03.show_subtasks": contract(single({ task_id: uuid })),
  "cai.task.04.show_chain": contract(single({ task_id: uuid })),
  "cai.task.05.create": contract(single({ task: z.object(taskFields).strict() })),
  "cai.task.06.bulk": contract(single({ items: z.array(z.object({ task: z.object(taskFields).strict(), checklist_items: z.array(checklistItem).max(500).default([]), assignments: z.array(assignment).max(500).default([]) }).strict()).min(1).max(100) })),
  "cai.task.07.update": contract(single({ task_id: uuid, changes: taskChanges })),
  "cai.task.08.assign": contract(single({ task_id: uuid, assignment })),
  "cai.task.09.done": contract(single({ task_id: uuid, completed_at: dateTime })),
  "cai.task.10.delete": contract(single({ task_id: uuid })),
  "cai.task.11.context_list_show_create_update_delete": contract(union([
    grouped("list", { ...pagination }), grouped("show", { context_id: uuid }), grouped("create", { context: z.object({ context_type: taskContextType, context_id: uuid, is_default: z.boolean().default(false) }).strict() }),
    grouped("update", { context_id: uuid, is_default: z.boolean() }), grouped("delete", { context_id: uuid }),
  ])),
  "cai.task.12.assignment_list_show_update_delete": contract(union([
    grouped("list", { task_id: uuid }), grouped("show", { assignment_id: uuid }), grouped("update", { assignment_id: uuid, is_responsible: z.boolean() }), grouped("delete", { assignment_id: uuid }),
  ])),
  "cai.task.13.note_list_add_update_delete": contract(union([
    grouped("list", { task_id: uuid }), grouped("add", { task_id: uuid, content: text.min(1) }), grouped("update", { note_id: uuid, content: text.min(1) }), grouped("delete", { note_id: uuid }),
  ])),
  "cai.task.14.checklist_list_add_update_toggle_delete_reorder": contract(union([
    grouped("list", { task_id: uuid }), grouped("add", { task_id: uuid, item: checklistItem }),
    grouped("update", { item_id: uuid, changes: z.object({ title: short.optional(), description: text.nullable().optional(), is_completed: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0) }),
    grouped("toggle", { item_id: uuid }), grouped("delete", { item_id: uuid }), grouped("reorder", { task_id: uuid, ordered_ids: z.array(uuid).min(1).max(500) }),
  ])),
};

export const K10_ACTION_SCHEMAS: Readonly<Record<K10ActionId, K10ActionSchemaContract>> = Object.freeze(schemas);
