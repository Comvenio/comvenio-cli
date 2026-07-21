import { z } from "zod";

import { isIanaTimeZone } from "./calendar.ts";
import type { K8ActionId, K8ActionSchemaContract } from "./types.ts";

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1).max(500);
const shortText = z.string().trim().min(1).max(180);
const text = z.string().max(20_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const dateTime = z.string().datetime({ offset: true });
const timezone = z.string().min(3).max(100).refine(isIanaTimeZone, "IANA-Zeitzone erforderlich.");
const color = z.string().regex(/^#[0-9a-f]{6}$/iu);
const url = z.string().url().max(2_048);
const email = z.string().email().max(320);
const positive = z.number().positive();
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(256) }).strict();
const club = { club_id: uuid } as const;
const confirmable = <T extends z.ZodRawShape>(shape: T) => z.object({ ...club, ...shape, confirmation: confirmation.optional() }).strict();
const plain = <T extends z.ZodRawShape>(shape: T) => z.object({ ...club, ...shape }).strict();
const branch = <N extends string, T extends z.ZodRawShape>(operation: N, shape: T, critical = false) =>
  critical ? confirmable({ operation: z.literal(operation), ...shape }) : plain({ operation: z.literal(operation), ...shape });
const union = (items: [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]]) => z.discriminatedUnion("operation", items);
const output = z.json();
const contract = (input: z.ZodType, result: z.ZodType = output): K8ActionSchemaContract => ({ input, output: result });

const localRange = z.object({
  from: date,
  to: date,
  timezone: timezone.default("Europe/Berlin"),
  from_inclusive: z.literal(true).default(true),
  to_exclusive: z.literal(true).default(true),
}).strict().refine((value) => value.from < value.to, "Der exklusive Endtag muss nach dem Starttag liegen.");

const eventFields = {
  title: shortText,
  description: text.nullable().optional(),
  location: z.string().max(1_000).nullable().optional(),
  start_time: dateTime.nullable().optional(),
  end_time: dateTime.nullable().optional(),
  event_type: z.enum(["party", "meeting", "excursion", "training", "competition", "other"]),
  visibility_scope: z.enum(["public", "member", "private", "department", "invite_only"]),
  organizer_type: z.enum(["member", "external"]),
  organizer_member_id: uuid.nullable().optional(),
  external_name: z.string().max(300).nullable().optional(),
  external_email: email.nullable().optional(),
  status: z.enum(["draft", "planned", "confirmed", "archived", "cancelled"]).optional(),
  event_complexity: z.enum(["simple", "multi_day"]).default("simple"),
  has_protocol_support: z.boolean().default(false),
  has_counter_support: z.boolean().default(false),
  has_purchase_support: z.boolean().default(false),
  feature_profile: z.record(z.string().max(80), z.boolean()).refine((value) => Object.keys(value).length <= 30).nullable().optional(),
} as const;
const eventCreate = z.object({ department_id: uuid, ...eventFields }).strict()
  .refine((value) => value.end_time == null || value.start_time == null || Date.parse(value.end_time) >= Date.parse(value.start_time), "Event-Ende liegt vor dem Start.");
const childEventCreate = z.object({ department_id: uuid.optional(), ...eventFields }).strict();
const eventChanges = z.object({
  title: shortText.optional(), department_id: uuid.optional(), description: text.nullable().optional(), location: z.string().max(1_000).nullable().optional(),
  start_time: dateTime.nullable().optional(), end_time: dateTime.nullable().optional(), event_type: eventFields.event_type.optional(),
  visibility_scope: eventFields.visibility_scope.optional(), organizer_type: eventFields.organizer_type.optional(), organizer_member_id: uuid.nullable().optional(),
  external_name: z.string().max(300).nullable().optional(), external_email: email.nullable().optional(), status: eventFields.status,
  event_complexity: eventFields.event_complexity.optional(), feature_profile: eventFields.feature_profile,
  has_protocol_support: z.boolean().optional(), has_counter_support: z.boolean().optional(), has_purchase_support: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Mindestens eine Änderung ist erforderlich.");

const seriesData = z.object({
  name: shortText, department_id: uuid, title_template: shortText.optional(), description_template: text.nullable().optional(),
  event_type: eventFields.event_type, visibility_scope: eventFields.visibility_scope, timezone: timezone.default("Europe/Berlin"),
  rrule: z.string().min(3).max(2_000), dtstart: dateTime, duration_minutes: z.number().int().min(1).max(100_800),
}).strict();
const seriesChanges = seriesData.partial().strict().refine((value) => Object.keys(value).length > 0);
const areaData = z.object({ name: shortText, description: text.nullable().optional(), color: color.nullable().optional(), is_public: z.boolean().default(false), public_description: text.nullable().optional(), area_category: z.string().max(100).nullable().optional() }).strict();
const areaChanges = areaData.partial().strict().refine((value) => Object.keys(value).length > 0);
const noteData = z.object({ content: text, is_public: z.boolean().default(false) }).strict();
const leadData = z.object({ member_id: uuid, role: z.string().max(160).nullable().optional() }).strict();
const programData = z.object({ title: shortText, description: text.nullable().optional(), start_time: dateTime.nullable().optional(), end_time: dateTime.nullable().optional(), location: z.string().max(500).nullable().optional(), sort_order: z.number().int().min(0).max(100_000).optional() }).strict();
const contactData = z.object({ name: shortText, role: z.string().max(180).nullable().optional(), email: email.nullable().optional(), phone_number: z.string().max(100).nullable().optional(), is_public: z.boolean().default(false) }).strict();
const resourceTarget = z.object({ target_type: z.string().min(1).max(80), target_id: uuid, quantity: z.number().min(0).max(1_000_000).optional(), notes: text.nullable().optional() }).strict();
const attachmentData = z.object({ file_id: uuid, attachment_type: z.string().min(1).max(80), title: z.string().max(300).nullable().optional(), description: text.nullable().optional(), is_public: z.boolean().default(false) }).strict();
const tagData = z.object({ name: shortText, color: color.nullable().optional(), description: text.nullable().optional(), category_id: uuid.nullable().optional() }).strict();
const sponsorLinkData = z.object({ sponsor_id: uuid, tier: z.string().max(160).nullable().optional(), amount: z.number().min(0).nullable().optional(), notes: text.nullable().optional() }).strict();
const invitationData = z.object({ event_id: uuid, member_id: uuid, status: z.string().max(80).optional(), message: text.nullable().optional() }).strict();
const selectorIds = z.array(uuid).min(1).max(500);
const registrationData = z.object({ participant_count: z.number().int().min(1).max(10_000).default(1), status: z.string().max(80).optional(), notes: text.nullable().optional(), member_id: uuid.nullable().optional(), external_name: z.string().max(300).nullable().optional(), external_email: email.nullable().optional() }).strict();
const themeData = z.object({ primary_color: color.optional(), secondary_color: color.optional(), accent_color: color.optional(), font_family: z.string().max(160).optional(), custom_copy: z.record(z.string().max(100), z.string().max(5_000)).refine((value) => Object.keys(value).length <= 100).optional() }).strict();
const syncData = z.object({ provider_id: z.string().min(1).max(160), external_club_id: z.string().min(1).max(300), team_id: uuid.nullable().optional(), active: z.boolean().default(true) }).strict();

const planData = z.object({
  name: shortText, plan_type: z.enum(["gelaende", "fluchtplan", "festumzug", "sonstiges"]).default("gelaende"),
  background_type: z.enum(["satellite", "image"]).default("satellite"), image_file_id: uuid.nullable().optional(),
  center_lat: z.number().min(-90).max(90).nullable().optional(), center_lng: z.number().min(-180).max(180).nullable().optional(), zoom: z.number().int().min(0).max(24).nullable().optional(),
  image_width: z.number().int().positive().max(50_000).nullable().optional(), image_height: z.number().int().positive().max(50_000).nullable().optional(),
  crs_mode: z.enum(["geo", "image"]).default("geo"), sort_order: z.number().int().min(0).max(100_000).nullable().optional(),
  real_width_m: positive.max(100_000).nullable().optional(), real_height_m: positive.max(100_000).nullable().optional(), bounds_radius_m: positive.max(1_000_000).nullable().optional(), inherit_to_days: z.boolean().default(false),
}).strict();
const planChanges = planData.partial().strict().refine((value) => Object.keys(value).length > 0);
const zoneData = z.object({
  name: z.string().max(300).nullable().optional(), color: color.nullable().optional(), geometry: z.string().max(500_000).nullable().optional(),
  crs_mode: z.enum(["geo", "image"]).default("geo"), shape_type: z.enum(["polygon", "polyline"]).default("polygon"), area_id: uuid.nullable().optional(), event_id: uuid.nullable().optional(),
  length_m: positive.max(100_000).nullable().optional(), width_m: positive.max(100_000).nullable().optional(), rotation: z.number().min(-360).max(360).nullable().optional(),
  arrow: z.boolean().default(false), line_weight: positive.max(100).nullable().optional(), label_x: z.number().nullable().optional(), label_y: z.number().nullable().optional(),
}).strict();
const zoneChanges = zoneData.partial().strict().refine((value) => Object.keys(value).length > 0);
const position = { lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(), pos_x: z.number().nullable().optional(), pos_y: z.number().nullable().optional() } as const;
const tableData = z.object({
  event_id: uuid, plan_id: uuid.nullable().optional(), label: z.string().max(300).nullable().optional(), number: z.number().int().nullable().optional(), capacity: z.number().int().min(1).max(100_000).default(8), ...position,
  shape: z.enum(["round", "rect"]).default("round"), length_m: positive.nullable().optional(), width_m: positive.nullable().optional(), rotation: z.number().min(-360).max(360).default(0),
  furniture_type: z.enum(["beer_set", "round", "standing", "square", "custom"]).default("custom"), area_id: uuid.nullable().optional(), assignment_type: z.enum(["free", "registration", "club", "user"]).default("free"),
  assignment_label: z.string().max(300).nullable().optional(), registration_id: uuid.nullable().optional(), assigned_club_id: uuid.nullable().optional(), assigned_user_id: uuid.nullable().optional(), logo_file_id: uuid.nullable().optional(), assigned_guest_id: uuid.nullable().optional(),
}).strict();
const tableChanges = tableData.omit({ event_id: true }).partial().strict().refine((value) => Object.keys(value).length > 0);
const markerData = z.object({ event_id: uuid, plan_id: uuid.nullable().optional(), marker_type: z.string().min(1).max(100), label: z.string().max(300).nullable().optional(), logo_file_id: uuid.nullable().optional(), assigned_club_id: uuid.nullable().optional(), ...position, size: z.number().positive().max(10).default(1) }).strict();
const markerChanges = markerData.omit({ event_id: true }).partial().strict().refine((value) => Object.keys(value).length > 0);
const guestData = z.object({ name: shortText, logo_file_id: uuid.nullable().optional() }).strict();

export const K8_ACTION_SCHEMAS: Readonly<Record<K8ActionId, K8ActionSchemaContract>> = Object.freeze({
  "cai.event.01.list": contract(plain({ range: localRange, view: z.string().max(80).optional(), complexity: z.enum(["simple", "multi_day"]).optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().max(500).optional() })),
  "cai.event.02.show": contract(plain({ event_id: uuid })),
  "cai.event.03.create": contract(plain({ event: eventCreate })),
  "cai.event.04.update": contract(plain({ event_id: uuid, changes: eventChanges })),
  "cai.event.05.publish": contract(confirmable({ event_id: uuid, make_public: z.boolean().default(false) })),
  "cai.event.06.delete": contract(confirmable({ event_id: uuid })),
  "cai.event.07.template_list_create_clone_instantiate": contract(union([
    branch("list", {}), branch("create", { template: eventCreate }), branch("clone", { event_id: uuid, title: shortText.optional() }),
    branch("instantiate", { template_id: uuid, instance: z.object({ start_time: dateTime, end_time: dateTime, title: shortText.optional(), description: text.nullable().optional(), location: z.string().max(1_000).nullable().optional(), visibility_scope: eventFields.visibility_scope.optional(), department_id: uuid.optional(), event_type: eventFields.event_type.optional(), status: eventFields.status, organizer_type: eventFields.organizer_type.optional(), organizer_member_id: uuid.nullable().optional(), external_name: z.string().max(300).nullable().optional(), copy_tags: z.boolean().default(true), copy_areas: z.boolean().default(true), copy_resources: z.boolean().default(true), copy_tasks: z.boolean().default(true), copy_task_assignments: z.boolean().default(false) }).strict() }),
  ])),
  "cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n": contract(union([
    branch("list", {}), branch("show", { series_id: uuid }), branch("create", { series: seriesData }), branch("update", { series_id: uuid, changes: seriesChanges }),
    branch("delete", { series_id: uuid }, true), branch("materialize", { series_id: uuid, range: localRange }, true), branch("materialize_next", { series_id: uuid }, true),
    branch("promote_recurring", { event_id: uuid, recurrence: z.object({ rrule: z.string().min(3).max(2_000), timezone: timezone.default("Europe/Berlin") }).strict() }, true),
    branch("promote_yearly", { event_id: uuid, recurrence: z.object({ timezone: timezone.default("Europe/Berlin"), years_ahead: z.number().int().min(1).max(20).default(5) }).strict() }, true),
  ])),
  "cai.event.09.area_list_add_show_update_delete_bulk_copy": contract(union([
    branch("list", { event_id: uuid }), branch("add", { event_id: uuid, area: areaData }), branch("show", { area_id: uuid }), branch("update", { area_id: uuid, changes: areaChanges }), branch("delete", { area_id: uuid }, true),
    branch("bulk", { event_id: uuid, areas: z.array(areaData).min(1).max(200) }, true), branch("copy", { source_event_id: uuid, target_event_ids: z.array(uuid).min(1).max(100) }, true),
  ])),
  "cai.event.10.assignment_list_add_remove_clear": contract(union([branch("list", { area_id: uuid }), branch("add", { area_id: uuid, event_id: uuid, member_id: uuid }), branch("remove", { area_id: uuid, member_id: uuid }, true), branch("clear", { area_id: uuid }, true)])),
  "cai.event.11.lead_list_add_update_delete": contract(union([branch("list", { area_id: uuid }), branch("add", { area_id: uuid, lead: leadData }), branch("update", { lead_id: uuid, changes: leadData.partial().strict() }), branch("delete", { lead_id: uuid }, true)])),
  "cai.event.12.area_note_list_add_update_delete": contract(union([branch("list", { area_id: uuid, limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) }), branch("add", { area_id: uuid, note: noteData }), branch("update", { note_id: uuid, changes: noteData.partial().strict() }), branch("delete", { note_id: uuid }, true)])),
  "cai.event.13.program_list_add_update_delete_reorder": contract(union([branch("list", { event_id: uuid }), branch("add", { event_id: uuid, item: programData }), branch("update", { item_id: uuid, changes: programData.partial().strict() }), branch("delete", { item_id: uuid }, true), branch("reorder", { event_id: uuid, item_ids: z.array(uuid).min(1).max(1_000) }, true)])),
  "cai.event.14.contact_list_add_update_delete": contract(union([branch("list", { event_id: uuid }), branch("add", { event_id: uuid, contact: contactData }), branch("update", { contact_id: uuid, changes: contactData.partial().strict() }), branch("delete", { contact_id: uuid }, true)])),
  "cai.event.15.resource_list_add_set_remove_link_show_link_update_link_delete_usage_u": contract(union([
    branch("list", { event_id: uuid }), branch("add", { event_id: uuid, resource: resourceTarget }), branch("set", { event_id: uuid, resources: z.array(resourceTarget).max(500) }), branch("remove", { event_id: uuid, target_type: z.string().max(80), target_id: uuid }, true),
    branch("link_show", { link_id: uuid }), branch("link_update", { link_id: uuid, changes: resourceTarget.partial().strict() }), branch("link_delete", { link_id: uuid }, true),
    branch("usage", { target_type: z.string().max(80), target_id: uuid, range: localRange, status: z.string().max(80).optional() }), branch("usage_batch", { targets: z.array(resourceTarget.pick({ target_type: true, target_id: true })).min(1).max(200), range: localRange }),
  ])),
  "cai.event.16.attachment_list_show_add_update_delete": contract(union([branch("list", { event_id: uuid, attachment_type: z.string().max(80).optional() }), branch("show", { attachment_id: uuid }), branch("add", { event_id: uuid, attachment: attachmentData }), branch("update", { attachment_id: uuid, changes: attachmentData.omit({ file_id: true }).partial().strict() }), branch("delete", { attachment_id: uuid }, true)])),
  "cai.event.17.tag_category_and_assignment_workflows": contract(union([
    branch("category_list", {}), branch("category_show", { category_id: uuid }), branch("category_add", { category: tagData.omit({ category_id: true }) }), branch("category_update", { category_id: uuid, changes: tagData.omit({ category_id: true }).partial().strict() }), branch("category_delete", { category_id: uuid }, true),
    branch("tag_list", { category_id: uuid.optional() }), branch("tag_show", { tag_id: uuid }), branch("tag_add", { tag: tagData }), branch("tag_update", { tag_id: uuid, changes: tagData.partial().strict() }), branch("tag_delete", { tag_id: uuid }, true),
    branch("assigned", { event_id: uuid }), branch("assignment_list", { event_id: uuid }), branch("assign", { event_id: uuid, tag_id: uuid }), branch("unassign", { assignment_id: uuid }, true), branch("clear", { event_id: uuid }, true),
  ])),
  "cai.event.18.sponsor_and_sponsor_program_workflows": contract(union([
    branch("link_list", { event_id: uuid }), branch("link_add", { event_id: uuid, link: sponsorLinkData }), branch("link_delete", { link_id: uuid }, true), branch("tier_list", { event_id: uuid }), branch("tier_add", { event_id: uuid, mapping: z.object({ sponsor_tier_id: uuid, event_tier: z.string().max(160) }).strict() }), branch("tier_update", { mapping_id: uuid, changes: z.object({ event_tier: z.string().max(160).optional(), sponsor_tier_id: uuid.optional() }).strict() }), branch("tier_delete", { mapping_id: uuid }, true), branch("tier_sync", { event_id: uuid }, true),
    branch("program_by_sponsor", { link_id: uuid }), branch("program_by_item", { item_id: uuid }), branch("program_add", { link_id: uuid, item_id: uuid }), branch("program_delete", { link_id: uuid, item_id: uuid }, true),
  ])),
  "cai.event.19.invitation_and_club_invitation_workflows": contract(union([
    branch("member_mine", {}), branch("member_list", { event_id: uuid }), branch("member_show", { invitation_id: uuid }), branch("member_add", { invitation: invitationData }), branch("member_add_groups", { event_id: uuid, group_ids: selectorIds }), branch("member_add_departments", { event_id: uuid, department_ids: selectorIds }), branch("member_add_org_groups", { event_id: uuid, organization_group_ids: selectorIds }), branch("member_update", { invitation_id: uuid, changes: invitationData.omit({ event_id: true, member_id: true }).partial().strict() }), branch("member_status", { invitation_id: uuid, status: z.string().min(1).max(80) }), branch("member_delete", { invitation_id: uuid }, true), branch("member_notified", { event_id: uuid }),
    branch("club_list", { event_id: uuid }), branch("club_attending", { event_id: uuid }), branch("club_incoming", {}), branch("club_accepted", { range: localRange.optional() }), branch("club_show", { invitation_id: uuid }), branch("club_add", { event_id: uuid, invited_club_id: uuid, invitation_type: z.enum(["public", "private"]), message: text.nullable().optional() }), branch("club_external", { event_id: uuid, external_email: email, external_club_name: shortText, external_contact_name: z.string().max(300).nullable().optional(), message: text.nullable().optional() }, true), branch("club_self_join", { event_id: uuid }, true), branch("club_update", { invitation_id: uuid, invitation_type: z.enum(["public", "private"]).optional(), message: text.nullable().optional() }), branch("club_respond", { invitation_id: uuid, status: z.enum(["accepted", "declined"]), message: text.nullable().optional() }, true), branch("club_delete", { invitation_id: uuid }, true),
  ])),
  "cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate": contract(union([branch("list", { event_id: uuid }), branch("add", { event_id: uuid, registration: registrationData }), branch("stats", { event_id: uuid }), branch("show", { registration_id: uuid }), branch("update", { registration_id: uuid, changes: registrationData.partial().strict() }), branch("adjust", { registration_id: uuid, participant_count: z.number().int().min(0).max(10_000), reason: text }, true), branch("delete", { registration_id: uuid }, true), branch("aggregate", { invitation_id: uuid })])),
  "cai.event.21.budget_show_set_delete": contract(union([branch("show", { event_id: uuid }), branch("set", { event_id: uuid, budget_id: uuid }), branch("delete", { event_id: uuid }, true)])),
  "cai.event.22.design_theme_and_asset_workflows": contract(union([branch("theme_show", { event_id: uuid }), branch("theme_set", { event_id: uuid, theme: themeData }), branch("theme_delete", { event_id: uuid }, true), branch("asset_list", { event_id: uuid }), branch("asset_upload", { event_id: uuid, file_id: uuid, asset_type: z.enum(["FLYER", "TITLE_PICTURE"]) }, true), branch("asset_delete", { event_id: uuid, asset_id: uuid }, true)])),
  "cai.event.23.copy_set_reset": contract(union([branch("set", { event_id: uuid, values: z.record(z.string().min(1).max(100), z.string().max(5_000)).refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 100) }), branch("reset", { event_id: uuid, key: z.string().min(1).max(100) }, true)])),
  "cai.event.24.dj_settings_and_request_workflows": contract(union([branch("settings", { event_id: uuid }), branch("requests", { event_id: uuid }), branch("settings_set", { event_id: uuid, enabled: z.boolean().optional(), requests_open: z.boolean().optional(), max_requests_per_user: z.number().int().min(0).max(100).optional() }), branch("request_status", { request_id: uuid, status: z.enum(["played", "rejected", "pending"]) }), branch("reset", { event_id: uuid }, true)])),
  "cai.event.25.external_sync_workflows": contract(union([branch("list", {}), branch("add", { sync: syncData }), branch("show", { sync_id: uuid }), branch("update", { sync_id: uuid, changes: syncData.partial().strict() }), branch("delete", { sync_id: uuid }, true), branch("matches", { sync_id: uuid }), branch("run", {}, true), branch("stats", {}), branch("provider_run", { provider_id: z.string().min(1).max(160) }, true)])),
  "cai.event.26.instance_previous_next_compare_clone_next": contract(union([branch("previous", { event_id: uuid }), branch("next", { event_id: uuid }), branch("compare", { event_id: uuid, other_event_id: uuid }), branch("clone_next", { event_id: uuid, start_time: dateTime.optional(), end_time: dateTime.optional() })])),
  "cai.event.27.child_list_create_invitation_summary": contract(union([branch("list", { event_id: uuid }), branch("create", { event_id: uuid, child: childEventCreate }), branch("invitation_summary", { event_id: uuid })])),
  "cai.event.28.menu_list_assign_unassign": contract(union([branch("list", { event_id: uuid }), branch("assign", { event_id: uuid, event_area_id: uuid, menu_id: uuid, notes: text.nullable().optional() }), branch("unassign", { event_menu_id: uuid }, true)])),

  "cai.plan.01.list": contract(plain({ event_id: uuid })),
  "cai.plan.02.show": contract(plain({ plan_id: uuid })),
  "cai.plan.03.create": contract(plain({ event_id: uuid, plan: planData })),
  "cai.plan.04.update": contract(plain({ plan_id: uuid, changes: planChanges })),
  "cai.plan.05.delete": contract(confirmable({ plan_id: uuid })),
  "cai.plan.06.zone_list_create_update_delete_link_unlink": contract(union([branch("list", { plan_id: uuid }), branch("create", { plan_id: uuid, zone: zoneData }), branch("update", { zone_id: uuid, changes: zoneChanges }), branch("delete", { zone_id: uuid }, true), branch("link", { zone_id: uuid, area_id: uuid }), branch("unlink", { zone_id: uuid, area_id: uuid }, true)])),
  "cai.plan.07.table_create_duplicate_update_delete": contract(union([branch("create", { table: tableData }), branch("duplicate", { table_id: uuid }), branch("update", { table_id: uuid, changes: tableChanges }), branch("delete", { table_id: uuid }, true)])),
  "cai.plan.08.marker_create_update_delete": contract(union([branch("create", { marker: markerData }), branch("update", { marker_id: uuid, changes: markerChanges }), branch("delete", { marker_id: uuid }, true)])),
  "cai.plan.09.guest_list_add_update_delete": contract(union([branch("list", { event_id: uuid }), branch("add", { event_id: uuid, guest: guestData }), branch("update", { guest_id: uuid, changes: guestData.partial().strict() }), branch("delete", { guest_id: uuid }, true)])),
  "cai.plan.10.detail": contract(plain({ zone_id: uuid, detail_plan: planData.omit({ plan_type: true, sort_order: true, bounds_radius_m: true, inherit_to_days: true }).partial({ name: true }).strict() })),
  "cai.plan.11.export": contract(plain({ event_id: uuid, plan_id: uuid.optional(), format: z.enum(["png", "pdf", "both"]).default("png"), hide_zone_ids: z.array(uuid).max(500).default([]), hide_marker_ids: z.array(uuid).max(500).default([]), hide_tables: z.boolean().default(false), hide_labels: z.boolean().default(false) })),
  "cai.plan.12.illustrate": contract(plain({ event_id: uuid, plan_id: uuid.optional(), style: z.string().max(2_000).optional(), output_format: z.enum(["png", "pdf"]).default("png") })),
  "cai.plan.13.compose": contract(plain({ event_id: uuid, plan_id: uuid, illustration_file_id: uuid, draw_lines: z.boolean().default(true), output_format: z.enum(["png", "pdf"]).default("png") })),
});
