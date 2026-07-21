import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";

import { privateCalendarEvent, privateCalendarEvents, redactEventPlanValue } from "./privacy.ts";
import { rangeQuery, type LocalDateRange } from "./calendar.ts";
import type { K8ActionId } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
type PathBuilder = (input: JsonObject) => string;
type BodyBuilder = (input: JsonObject) => JsonValue | undefined;
type QueryBuilder = (input: JsonObject) => Record<string, string> | undefined;

interface RouteSpec {
  method: ComvenioHttpMethod;
  service: "event" | "supply";
  path: PathBuilder;
  body?: BodyBuilder;
  query?: QueryBuilder;
  deleted_id?: string;
  response?: (value: JsonValue, input: JsonObject, context: RequestContext) => JsonValue;
}

function record(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error("Die validierte K8-Eingabe ist kein Objekt.");
  return value;
}

function object(input: JsonObject, key: string): JsonObject {
  const value = input[key];
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error(`Die validierte K8-Eingabe enthält kein Objekt ${key}.`);
  return value;
}

function string(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Die validierte K8-Eingabe enthält kein ${key}.`);
  return value;
}

function without(input: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
}

function nested(key: string, merge: BodyBuilder | null = null): BodyBuilder {
  return (input) => ({ ...object(input, key), ...(merge ? record(merge(input) ?? {}) : {}) });
}

function direct(excluded: readonly string[] = ["operation", "club_id", "confirmation"]): BodyBuilder {
  return (input) => without(input, excluded);
}

function range(input: JsonObject): LocalDateRange {
  return object(input, "range") as LocalDateRange;
}

const key = (actionId: K8ActionId, operation: string) => `${actionId}:${operation}`;
const specs = new Map<string, RouteSpec>();
const add = (actionId: K8ActionId, operation: string, spec: RouteSpec) => specs.set(key(actionId, operation), spec);
const fixed = (path: string): PathBuilder => () => path;
const by = (prefix: string, field: string, suffix = ""): PathBuilder => (input) => `${prefix}${encodeURIComponent(string(input, field))}${suffix}`;
const simple = (
  actionId: K8ActionId,
  operation: string,
  method: ComvenioHttpMethod,
  path: PathBuilder,
  options: Partial<Omit<RouteSpec, "method" | "path">> = {},
) => add(actionId, operation, { method, service: "event", path, ...options });

simple("cai.event.01.list", "list", "GET", by("/events/club/", "club_id"), {
  query: (input) => ({ ...rangeQuery(range(input)), ...(typeof input.view === "string" ? { view: input.view } : {}), ...(typeof input.complexity === "string" ? { complexity: input.complexity } : {}) }),
  response: (value, input, context) => ({
    items: privateCalendarEvents(value, range(input).timezone),
    range: input.range!,
    limit: input.limit!,
    cursor: null,
    capability_version: context.capability_version,
  }),
});
simple("cai.event.02.show", "show", "GET", by("/events/", "event_id"), { response: (value, _input, context) => privateCalendarEvent(value, context.timezone) });
simple("cai.event.03.create", "create", "POST", fixed("/events/"), { body: nested("event", (input) => ({ club_id: string(input, "club_id") })) });
simple("cai.event.04.update", "update", "PATCH", by("/events/", "event_id"), { body: nested("changes") });
simple("cai.event.05.publish", "publish", "PATCH", by("/events/", "event_id"), { body: (input) => ({ status: "confirmed", ...(input.make_public === true ? { visibility_scope: "public" } : {}) }) });
simple("cai.event.06.delete", "delete", "DELETE", by("/events/", "event_id"), { deleted_id: "event_id" });

const template = "cai.event.07.template_list_create_clone_instantiate" as const;
simple(template, "list", "GET", (i) => `/events/club/${string(i, "club_id")}/templates`);
simple(template, "create", "POST", fixed("/events/"), { body: nested("template", (i) => ({ club_id: string(i, "club_id"), is_template: true })) });
simple(template, "clone", "POST", by("/events/", "event_id", "/clone-as-template"), { body: (i) => typeof i.title === "string" ? { title: i.title } : undefined });
simple(template, "instantiate", "POST", by("/events/", "template_id", "/event-from-template"), { body: nested("instance") });

const series = "cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n" as const;
simple(series, "list", "GET", by("/event-series/by-club/", "club_id"));
simple(series, "show", "GET", by("/event-series/", "series_id"));
simple(series, "create", "POST", fixed("/event-series/"), { body: nested("series", (i) => ({ club_id: string(i, "club_id") })) });
simple(series, "update", "PATCH", by("/event-series/", "series_id"), { body: nested("changes") });
simple(series, "delete", "DELETE", by("/event-series/", "series_id"), { deleted_id: "series_id" });
simple(series, "materialize", "POST", by("/event-series/", "series_id", "/materialize"), { body: (i) => rangeQuery(range(i)) });
simple(series, "materialize_next", "POST", by("/event-series/", "series_id", "/materialize-next"));
simple(series, "promote_recurring", "POST", by("/events/", "event_id", "/promote-to-recurring-series"), { body: nested("recurrence") });
simple(series, "promote_yearly", "POST", by("/events/", "event_id", "/promote-to-yearly-series"), { body: nested("recurrence") });

const area = "cai.event.09.area_list_add_show_update_delete_bulk_copy" as const;
simple(area, "list", "GET", by("/events/areas/by-event/", "event_id"));
simple(area, "add", "POST", fixed("/events/areas/"), { body: nested("area", (i) => ({ event_id: string(i, "event_id"), club_id: string(i, "club_id") })) });
simple(area, "show", "GET", by("/events/areas/", "area_id"));
simple(area, "update", "PATCH", by("/events/areas/", "area_id"), { body: nested("changes") });
simple(area, "delete", "DELETE", by("/events/areas/", "area_id"), { deleted_id: "area_id" });
simple(area, "bulk", "POST", fixed("/events/areas/bulk"), { body: (i) => ({ club_id: string(i, "club_id"), event_id: string(i, "event_id"), areas: i.areas! }) });
simple(area, "copy", "POST", fixed("/events/areas/copy-to-events"), { body: (i) => ({ source_event_id: i.source_event_id!, target_event_ids: i.target_event_ids! }) });

const assignment = "cai.event.10.assignment_list_add_remove_clear" as const;
simple(assignment, "list", "GET", by("/events/areas/", "area_id", "/assignments"));
simple(assignment, "add", "POST", by("/events/areas/", "area_id", "/assign-member"), { body: (i) => ({ club_id: i.club_id!, event_id: i.event_id!, event_area_id: i.area_id!, member_id: i.member_id! }) });
simple(assignment, "remove", "DELETE", (i) => `/events/areas/${string(i, "area_id")}/assign-member/${string(i, "member_id")}`, { deleted_id: "member_id" });
simple(assignment, "clear", "DELETE", by("/events/areas/", "area_id", "/assignments"), { deleted_id: "area_id" });

const crudGroup = (
  actionId: K8ActionId,
  parentName: string,
  entityName: string,
  base: string,
  entityBase: string,
  payloadKey: string,
) => {
  simple(actionId, "list", "GET", by(base, parentName));
  simple(actionId, "add", "POST", by(base, parentName), { body: nested(payloadKey) });
  simple(actionId, "update", entityName === "note_id" ? "PUT" : "PATCH", by(entityBase, entityName), { body: nested("changes") });
  simple(actionId, "delete", "DELETE", by(entityBase, entityName), { deleted_id: entityName });
};
crudGroup("cai.event.11.lead_list_add_update_delete", "area_id", "lead_id", "/events/areas/", "/events/areas/leads/", "lead");
crudGroup("cai.event.12.area_note_list_add_update_delete", "area_id", "note_id", "/events/areas/", "/events/areas/notes/", "note");
// The two parent collections use explicit suffixes.
specs.get(key("cai.event.11.lead_list_add_update_delete", "list"))!.path = by("/events/areas/", "area_id", "/leads");
specs.get(key("cai.event.11.lead_list_add_update_delete", "add"))!.path = by("/events/areas/", "area_id", "/leads");
specs.get(key("cai.event.12.area_note_list_add_update_delete", "list"))!.path = by("/events/areas/", "area_id", "/notes");
specs.get(key("cai.event.12.area_note_list_add_update_delete", "list"))!.query = (i) => ({ limit: String(i.limit), offset: String(i.offset) });
specs.get(key("cai.event.12.area_note_list_add_update_delete", "add"))!.path = by("/events/areas/", "area_id", "/notes");

crudGroup("cai.event.13.program_list_add_update_delete_reorder", "event_id", "item_id", "/events/", "/events/program-items/", "item");
specs.get(key("cai.event.13.program_list_add_update_delete_reorder", "list"))!.path = by("/events/", "event_id", "/program-items");
specs.get(key("cai.event.13.program_list_add_update_delete_reorder", "add"))!.path = by("/events/", "event_id", "/program-items");
simple("cai.event.13.program_list_add_update_delete_reorder", "reorder", "PUT", by("/events/", "event_id", "/program-items/reorder"), { body: (i) => ({ item_ids: i.item_ids! }) });
crudGroup("cai.event.14.contact_list_add_update_delete", "event_id", "contact_id", "/events/", "/events/contacts/", "contact");
specs.get(key("cai.event.14.contact_list_add_update_delete", "list"))!.path = by("/events/", "event_id", "/contacts");
specs.get(key("cai.event.14.contact_list_add_update_delete", "add"))!.path = by("/events/", "event_id", "/contacts");

const resource = "cai.event.15.resource_list_add_set_remove_link_show_link_update_link_delete_usage_u" as const;
simple(resource, "list", "GET", by("/events/", "event_id", "/resources"));
simple(resource, "add", "POST", by("/events/", "event_id", "/resources"), { body: nested("resource") });
simple(resource, "set", "PUT", by("/events/", "event_id", "/resources"), { body: (i) => i.resources! });
simple(resource, "remove", "DELETE", by("/events/", "event_id", "/resources"), { query: (i) => ({ target_type: string(i, "target_type"), target_id: string(i, "target_id") }), deleted_id: "target_id" });
simple(resource, "link_show", "GET", by("/event-resource-links/", "link_id"));
simple(resource, "link_update", "PATCH", by("/event-resource-links/", "link_id"), { body: nested("changes") });
simple(resource, "link_delete", "DELETE", by("/event-resource-links/", "link_id"), { deleted_id: "link_id" });
simple(resource, "usage", "GET", fixed("/events/resource-usage/"), { query: (i) => ({ target_type: string(i, "target_type"), target_id: string(i, "target_id"), ...rangeQuery(range(i)), ...(typeof i.status === "string" ? { status: i.status } : {}) }) });
simple(resource, "usage_batch", "POST", fixed("/events/resource-usage/batch"), { body: (i) => ({ targets: i.targets!, ...rangeQuery(range(i)) }) });

const attachment = "cai.event.16.attachment_list_show_add_update_delete" as const;
simple(attachment, "list", "GET", by("/events/", "event_id", "/attachments"), { query: (i) => typeof i.attachment_type === "string" ? { attachment_type: i.attachment_type } : undefined });
simple(attachment, "show", "GET", by("/events/attachments/", "attachment_id"));
simple(attachment, "add", "POST", by("/events/", "event_id", "/attachments"), { body: nested("attachment") });
simple(attachment, "update", "PATCH", by("/events/attachments/", "attachment_id"), { body: nested("changes") });
simple(attachment, "delete", "DELETE", by("/events/attachments/", "attachment_id"), { deleted_id: "attachment_id" });

const tag = "cai.event.17.tag_category_and_assignment_workflows" as const;
simple(tag, "category_list", "GET", by("/events/tags/category/by-club/", "club_id"));
simple(tag, "category_show", "GET", by("/events/tags/category/", "category_id"));
simple(tag, "category_add", "POST", fixed("/events/tags/category"), { body: nested("category", (i) => ({ club_id: i.club_id! })) });
simple(tag, "category_update", "PATCH", by("/events/tags/category/", "category_id"), { body: nested("changes") });
simple(tag, "category_delete", "DELETE", by("/events/tags/category/", "category_id"), { deleted_id: "category_id" });
simple(tag, "tag_list", "GET", (i) => `/events/tags/by-club/${string(i, "club_id")}${typeof i.category_id === "string" ? `/by-category/${i.category_id}` : ""}`);
simple(tag, "tag_show", "GET", by("/events/tags/", "tag_id"));
simple(tag, "tag_add", "POST", fixed("/events/tags/"), { body: nested("tag", (i) => ({ club_id: i.club_id! })) });
simple(tag, "tag_update", "PATCH", by("/events/tags/", "tag_id"), { body: nested("changes") });
simple(tag, "tag_delete", "DELETE", by("/events/tags/", "tag_id"), { deleted_id: "tag_id" });
simple(tag, "assigned", "GET", (i) => `/events/tags/assigned-tags/by-event/${string(i, "event_id")}/by-club/${string(i, "club_id")}`);
simple(tag, "assignment_list", "GET", by("/events/tags/assign/by-event/", "event_id"));
simple(tag, "assign", "POST", fixed("/events/tags/assign"), { body: (i) => ({ event_id: i.event_id!, tag_id: i.tag_id!, club_id: i.club_id! }) });
simple(tag, "unassign", "DELETE", by("/events/tags/assign/", "assignment_id"), { deleted_id: "assignment_id" });
simple(tag, "clear", "DELETE", by("/events/tags/assign/by-event/", "event_id"), { deleted_id: "event_id" });

const sponsor = "cai.event.18.sponsor_and_sponsor_program_workflows" as const;
simple(sponsor, "link_list", "GET", by("/events/", "event_id", "/sponsor-links"));
simple(sponsor, "link_add", "POST", by("/events/", "event_id", "/sponsor-links"), { body: nested("link") });
simple(sponsor, "link_delete", "DELETE", by("/events/sponsor-links/", "link_id"), { deleted_id: "link_id" });
simple(sponsor, "tier_list", "GET", by("/events/", "event_id", "/sponsor-tier-mappings"));
simple(sponsor, "tier_add", "POST", by("/events/", "event_id", "/sponsor-tier-mappings"), { body: nested("mapping") });
simple(sponsor, "tier_update", "PATCH", by("/events/sponsor-tier-mappings/", "mapping_id"), { body: nested("changes") });
simple(sponsor, "tier_delete", "DELETE", by("/events/sponsor-tier-mappings/", "mapping_id"), { deleted_id: "mapping_id" });
simple(sponsor, "tier_sync", "POST", by("/events/", "event_id", "/sponsor-tier-mappings/sync"));
simple(sponsor, "program_by_sponsor", "GET", by("/events/sponsor-links/", "link_id", "/program-items"));
simple(sponsor, "program_by_item", "GET", by("/events/program-items/", "item_id", "/sponsor-links"));
simple(sponsor, "program_add", "POST", by("/events/sponsor-links/", "link_id", "/program-items"), { body: (i) => ({ program_item_id: i.item_id! }) });
simple(sponsor, "program_delete", "DELETE", (i) => `/events/sponsor-links/${string(i, "link_id")}/program-items/${string(i, "item_id")}`, { deleted_id: "item_id" });

const invitation = "cai.event.19.invitation_and_club_invitation_workflows" as const;
simple(invitation, "member_mine", "GET", fixed("/events/invitations/my-invitations"));
simple(invitation, "member_list", "GET", by("/events/invitations/by-event/", "event_id"));
simple(invitation, "member_show", "GET", by("/events/invitations/", "invitation_id"));
simple(invitation, "member_add", "POST", fixed("/events/invitations/"), { body: nested("invitation", (i) => ({ club_id: i.club_id! })) });
for (const [operation, path, ids] of [
  ["member_add_groups", "/events/invitations/invite-groups", "group_ids"],
  ["member_add_departments", "/events/invitations/invite-departments", "department_ids"],
  ["member_add_org_groups", "/events/invitations/invite-organization-groups", "organization_group_ids"],
] as const) simple(invitation, operation, "POST", fixed(path), { body: (i) => ({ event_id: i.event_id!, club_id: i.club_id!, [ids]: i[ids]! }) });
simple(invitation, "member_update", "PATCH", by("/events/invitations/", "invitation_id"), { body: nested("changes") });
simple(invitation, "member_status", "PATCH", by("/events/invitations/status/", "invitation_id"), { body: (i) => ({ status: i.status! }) });
simple(invitation, "member_delete", "DELETE", by("/events/invitations/", "invitation_id"), { deleted_id: "invitation_id" });
simple(invitation, "member_notified", "GET", by("/events/invitations/by-event/", "event_id", "/notified"));
simple(invitation, "club_list", "GET", by("/events/club-invitations/by-event/", "event_id"));
simple(invitation, "club_attending", "GET", by("/events/club-invitations/by-event/", "event_id", "/attending"));
simple(invitation, "club_incoming", "GET", by("/events/club-invitations/by-invited-club/", "club_id"));
simple(invitation, "club_accepted", "GET", by("/events/club-invitations/by-invited-club/", "club_id", "/accepted"), { query: (i) => i.range ? rangeQuery(range(i)) : undefined });
simple(invitation, "club_show", "GET", by("/events/club-invitations/", "invitation_id"));
simple(invitation, "club_add", "POST", fixed("/events/club-invitations/"), { body: direct() });
simple(invitation, "club_external", "POST", fixed("/club-event-invitations/external"), { body: direct() });
simple(invitation, "club_self_join", "POST", fixed("/events/club-invitations/self-join"), { body: (i) => ({ event_id: i.event_id!, club_id: i.club_id! }) });
simple(invitation, "club_update", "PATCH", by("/events/club-invitations/", "invitation_id"), { body: direct(["operation", "club_id", "invitation_id", "confirmation"]) });
simple(invitation, "club_respond", "PATCH", by("/events/club-invitations/", "invitation_id", "/respond"), { body: direct(["operation", "club_id", "invitation_id", "confirmation"]) });
simple(invitation, "club_delete", "DELETE", by("/events/club-invitations/", "invitation_id"), { deleted_id: "invitation_id" });

const registration = "cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate" as const;
simple(registration, "list", "GET", by("/events/", "event_id", "/attendee-registrations"));
simple(registration, "add", "POST", by("/events/", "event_id", "/attendee-registrations"), { body: nested("registration") });
simple(registration, "stats", "GET", by("/events/", "event_id", "/attendee-stats"));
simple(registration, "show", "GET", by("/event-attendee-registrations/", "registration_id"));
simple(registration, "update", "PATCH", by("/event-attendee-registrations/", "registration_id"), { body: nested("changes") });
simple(registration, "adjust", "PATCH", by("/event-attendee-registrations/", "registration_id", "/admin-adjust"), { body: direct(["operation", "club_id", "registration_id", "confirmation"]) });
simple(registration, "delete", "DELETE", by("/event-attendee-registrations/", "registration_id"), { deleted_id: "registration_id" });
simple(registration, "aggregate", "GET", by("/club-event-invitations/", "invitation_id", "/aggregate"));

const budget = "cai.event.21.budget_show_set_delete" as const;
simple(budget, "show", "GET", by("/events/budget-link/", "event_id"));
simple(budget, "set", "POST", fixed("/events/budget-link/"), { body: (i) => ({ event_id: i.event_id!, club_id: i.club_id!, budget_id: i.budget_id! }) });
simple(budget, "delete", "DELETE", by("/events/budget-link/", "event_id"), { deleted_id: "event_id" });

const design = "cai.event.22.design_theme_and_asset_workflows" as const;
simple(design, "theme_show", "GET", by("/events/", "event_id", "/design/theme"));
simple(design, "theme_set", "PUT", by("/events/", "event_id", "/design/theme"), { body: nested("theme", (i) => ({ event_id: i.event_id!, club_id: i.club_id! })) });
simple(design, "theme_delete", "DELETE", by("/events/", "event_id", "/design/theme"), { deleted_id: "event_id" });
simple(design, "asset_list", "GET", by("/events/", "event_id", "/design/assets"));
simple(design, "asset_delete", "DELETE", (i) => `/events/${string(i, "event_id")}/design/assets/${string(i, "asset_id")}`, { deleted_id: "asset_id" });

const copy = "cai.event.23.copy_set_reset" as const;
simple(copy, "set", "PATCH", by("/events/", "event_id", "/public-hub-copy"), { body: (i) => i.values! });
simple(copy, "reset", "DELETE", (i) => `/events/${string(i, "event_id")}/public-hub-copy/${encodeURIComponent(string(i, "key"))}`, { deleted_id: "event_id" });

const dj = "cai.event.24.dj_settings_and_request_workflows" as const;
simple(dj, "settings", "GET", by("/public/events/", "event_id", "/dj/settings"));
simple(dj, "requests", "GET", by("/public/events/", "event_id", "/dj/requests"));
simple(dj, "settings_set", "PATCH", by("/events/", "event_id", "/dj/settings"), { body: direct(["operation", "club_id", "event_id"]) });
simple(dj, "request_status", "PATCH", by("/events/dj/requests/", "request_id", "/status"), { body: (i) => ({ status: i.status! }) });
simple(dj, "reset", "POST", by("/events/", "event_id", "/dj/requests/reset"));

const sync = "cai.event.25.external_sync_workflows" as const;
simple(sync, "list", "GET", by("/external-team-syncs/by-club/", "club_id"));
simple(sync, "add", "POST", fixed("/external-team-syncs/"), { body: nested("sync", (i) => ({ club_id: i.club_id! })) });
simple(sync, "show", "GET", by("/external-team-syncs/", "sync_id"));
simple(sync, "update", "PATCH", by("/external-team-syncs/", "sync_id"), { body: nested("changes") });
simple(sync, "delete", "DELETE", by("/external-team-syncs/", "sync_id"), { deleted_id: "sync_id" });
simple(sync, "matches", "GET", by("/external-team-syncs/", "sync_id", "/matches"));
simple(sync, "run", "POST", by("/external-team-syncs/sync/", "club_id"));
simple(sync, "stats", "GET", by("/external-team-syncs/stats/", "club_id"));
simple(sync, "provider_run", "POST", by("/external-team-syncs/sync/by-provider/", "provider_id"));

const instance = "cai.event.26.instance_previous_next_compare_clone_next" as const;
simple(instance, "previous", "GET", by("/events/", "event_id", "/previous-instance"));
simple(instance, "next", "GET", by("/events/", "event_id", "/next-instance"));
simple(instance, "compare", "GET", (i) => `/events/${string(i, "event_id")}/compare/${string(i, "other_event_id")}`);
simple(instance, "clone_next", "POST", by("/events/", "event_id", "/clone-next"), { body: direct(["operation", "club_id", "event_id"]) });

const child = "cai.event.27.child_list_create_invitation_summary" as const;
simple(child, "list", "GET", by("/events/", "event_id", "/children"));
simple(child, "create", "POST", by("/events/", "event_id", "/children"), { body: nested("child", (i) => ({ club_id: i.club_id! })) });
simple(child, "invitation_summary", "GET", by("/events/", "event_id", "/child-invitation-summary"));

const menu = "cai.event.28.menu_list_assign_unassign" as const;
simple(menu, "list", "GET", by("/menu/events/", "event_id", "/menus"), { service: "supply" });
simple(menu, "assign", "POST", fixed("/menu/events/menus"), { service: "supply", body: direct() });
simple(menu, "unassign", "DELETE", by("/menu/events/menus/", "event_menu_id"), { service: "supply", deleted_id: "event_menu_id" });

simple("cai.plan.01.list", "list", "GET", by("/events/", "event_id", "/map-plans"));
simple("cai.plan.02.show", "show", "GET", by("/events/map-plans/", "plan_id", "/map"));
simple("cai.plan.03.create", "create", "POST", by("/events/", "event_id", "/map-plans"), { body: nested("plan") });
simple("cai.plan.04.update", "update", "PATCH", by("/events/map-plans/", "plan_id"), { body: nested("changes") });
simple("cai.plan.05.delete", "delete", "DELETE", by("/events/map-plans/", "plan_id"), { deleted_id: "plan_id" });

const zone = "cai.plan.06.zone_list_create_update_delete_link_unlink" as const;
simple(zone, "list", "GET", by("/events/map-plans/", "plan_id", "/map"), { response: (value) => redactEventPlanValue(record(value).zones ?? []) });
simple(zone, "create", "POST", fixed("/events/map-zones"), { body: nested("zone", (i) => ({ plan_id: i.plan_id! })) });
simple(zone, "update", "PATCH", by("/events/map-zones/", "zone_id"), { body: nested("changes") });
simple(zone, "delete", "DELETE", by("/events/map-zones/", "zone_id"), { deleted_id: "zone_id" });
simple(zone, "link", "POST", by("/events/map-zones/", "zone_id", "/areas"), { body: (i) => ({ area_id: i.area_id! }) });
simple(zone, "unlink", "DELETE", (i) => `/events/map-zones/${string(i, "zone_id")}/areas/${string(i, "area_id")}`, { deleted_id: "area_id" });

const table = "cai.plan.07.table_create_duplicate_update_delete" as const;
simple(table, "create", "POST", fixed("/events/tables"), { body: nested("table") });
simple(table, "duplicate", "POST", by("/events/tables/", "table_id", "/duplicate"));
simple(table, "update", "PATCH", by("/events/tables/", "table_id"), { body: nested("changes") });
simple(table, "delete", "DELETE", by("/events/tables/", "table_id"), { deleted_id: "table_id" });

const marker = "cai.plan.08.marker_create_update_delete" as const;
simple(marker, "create", "POST", fixed("/events/map-markers"), { body: nested("marker") });
simple(marker, "update", "PATCH", by("/events/map-markers/", "marker_id"), { body: nested("changes") });
simple(marker, "delete", "DELETE", by("/events/map-markers/", "marker_id"), { deleted_id: "marker_id" });

const guest = "cai.plan.09.guest_list_add_update_delete" as const;
simple(guest, "list", "GET", by("/events/", "event_id", "/guests"));
simple(guest, "add", "POST", by("/events/", "event_id", "/guests"), { body: nested("guest") });
simple(guest, "update", "PATCH", by("/events/guests/", "guest_id"), { body: nested("changes") });
simple(guest, "delete", "DELETE", by("/events/guests/", "guest_id"), { deleted_id: "guest_id" });
simple("cai.plan.10.detail", "create", "POST", by("/events/map-zones/", "zone_id", "/detail-plan"), { body: nested("detail_plan") });

export function hasK8OperationHandler(actionId: K8ActionId, operation: string): boolean {
  return specs.has(key(actionId, operation));
}

export async function executeK8Operation(
  actionId: K8ActionId,
  operation: string,
  inputValue: JsonValue,
  context: RequestContext,
  client: ComvenioApiClient,
): Promise<JsonValue> {
  const input = record(inputValue);
  const spec = specs.get(key(actionId, operation));
  if (!spec) throw new Error(`${actionId}:${operation}: Der typisierte Handler fehlt.`);
  const result = await client.request({
    method: spec.method,
    service: spec.service,
    path: spec.path(input),
    context,
    ...(spec.query ? { query: spec.query(input) } : {}),
    ...(spec.body ? { body: spec.body(input) } : {}),
  });
  if (spec.deleted_id) return { deleted: true, id: string(input, spec.deleted_id) };
  return spec.response ? spec.response(result, input, context) : redactEventPlanValue(result);
}
