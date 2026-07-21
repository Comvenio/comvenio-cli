import type { OAuthScope } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";

import {
  K8_ACTION_IDS,
  type K8ActionDefinition,
  type K8ActionId,
  type K8BackendRoute,
  type K8Domain,
  type K8OperationDefinition,
} from "./types.ts";

const EVENT_READ = ["event.read"] as const;
const EVENT_WRITE = ["event.write"] as const;

function policy(
  all_of: string[] = [],
  any_of: string[] = [],
  department_scope: PermissionPolicy["department_scope"] = "optional",
): PermissionPolicy {
  return { all_of, any_of, owner_or_self_allowed: false, department_scope, backend_audit_refs: [] };
}

function route(
  method: K8BackendRoute["method"],
  service: K8BackendRoute["service"],
  normalized_path_template: string,
  purpose: K8BackendRoute["purpose"] = method === "GET" ? "read" : "mutation",
): K8BackendRoute {
  return { method, service, normalized_path_template, purpose };
}

function op(input: {
  name: string;
  scopes?: readonly OAuthScope[];
  permissions?: PermissionPolicy;
  risk?: ActionRisk;
  routes: readonly K8BackendRoute[];
  effect?: K8OperationDefinition["external_effect"];
  job?: boolean;
}): K8OperationDefinition {
  const risk = input.risk ?? "read";
  return Object.freeze({
    operation: input.name,
    required_scopes: Object.freeze([...(input.scopes ?? (risk === "read" ? EVENT_READ : EVENT_WRITE))]),
    permission_policy: Object.freeze(structuredClone(input.permissions ?? policy(risk === "read" ? ["view_events"] : ["manage_events"]))),
    risk_class: risk,
    execution_gate: input.job ? "job" : risk === "critical_write" ? "event_confirmation" : risk === "reversible_write" ? "write_safety" : "inline",
    backend_routes: Object.freeze(input.routes.map((item) => Object.freeze({ ...item }))),
    external_effect: input.effect ?? (risk === "read" ? "none" : "comvenio_private"),
  });
}

function action(input: {
  action_id: K8ActionId;
  domain: K8Domain;
  source_action: string;
  operations: readonly K8OperationDefinition[];
  blocker?: string;
}): K8ActionDefinition {
  return Object.freeze({
    action_id: input.action_id,
    domain: input.domain,
    source_action: input.source_action,
    source_path: input.domain === "plan" ? "src/commands/plan.ts" : "src/commands/event.ts; src/commands/event-operations.ts",
    operations: Object.freeze(Object.fromEntries(input.operations.map((item) => [item.operation, item]))),
    publication_state: input.blocker ? "blocked" : "implemented",
    blocker: input.blocker ?? null,
  });
}

const read = (name: string, path: string, service: K8BackendRoute["service"] = "event") =>
  op({ name, routes: [route("GET", service, path)] });
const write = (name: string, method: K8BackendRoute["method"], path: string, risk: ActionRisk = "reversible_write", service: K8BackendRoute["service"] = "event") =>
  op({ name, risk, routes: [route(method, service, path)] });

export const K8_ACTION_DEFINITIONS: Readonly<Record<K8ActionId, K8ActionDefinition>> = Object.freeze({
  "cai.event.01.list": action({ action_id: "cai.event.01.list", domain: "event", source_action: "list", operations: [read("list", "/events/club/{club_id}")] }),
  "cai.event.02.show": action({ action_id: "cai.event.02.show", domain: "event", source_action: "show", operations: [read("show", "/events/{event_id}")] }),
  "cai.event.03.create": action({ action_id: "cai.event.03.create", domain: "event", source_action: "create", operations: [op({ name: "create", risk: "reversible_write", permissions: policy(["create_events"]), routes: [route("POST", "event", "/events/")] })] }),
  "cai.event.04.update": action({ action_id: "cai.event.04.update", domain: "event", source_action: "update", operations: [write("update", "PATCH", "/events/{event_id}")] }),
  "cai.event.05.publish": action({ action_id: "cai.event.05.publish", domain: "event", source_action: "publish", operations: [op({ name: "publish", risk: "critical_write", effect: "comvenio_public", routes: [route("GET", "event", "/events/{event_id}", "preflight"), route("PATCH", "event", "/events/{event_id}")] })] }),
  "cai.event.06.delete": action({ action_id: "cai.event.06.delete", domain: "event", source_action: "delete", operations: [op({ name: "delete", risk: "critical_write", effect: "comvenio_public", routes: [route("GET", "event", "/events/{event_id}", "preflight"), route("DELETE", "event", "/events/{event_id}")] })] }),
  "cai.event.07.template_list_create_clone_instantiate": action({
    action_id: "cai.event.07.template_list_create_clone_instantiate", domain: "event", source_action: "template list|create|clone|instantiate", operations: [
      read("list", "/events/club/{club_id}/templates"),
      op({ name: "create", risk: "reversible_write", permissions: policy(["create_events"]), routes: [route("POST", "event", "/events/")] }),
      write("clone", "POST", "/events/{event_id}/clone-as-template"),
      op({ name: "instantiate", risk: "reversible_write", permissions: policy(["create_events"]), routes: [route("POST", "event", "/events/{template_id}/event-from-template")] }),
    ],
  }),
  "cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n": action({
    action_id: "cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n", domain: "event", source_action: "series list|show|create|update|delete|materialize|next|promote-recurring|promote-yearly", operations: [
      read("list", "/event-series/by-club/{club_id}"), read("show", "/event-series/{series_id}"),
      write("create", "POST", "/event-series/"), write("update", "PATCH", "/event-series/{series_id}"),
      write("delete", "DELETE", "/event-series/{series_id}", "critical_write"),
      write("materialize", "POST", "/event-series/{series_id}/materialize", "critical_write"),
      write("materialize_next", "POST", "/event-series/{series_id}/materialize-next", "critical_write"),
      write("promote_recurring", "POST", "/events/{event_id}/promote-to-recurring-series", "critical_write"),
      write("promote_yearly", "POST", "/events/{event_id}/promote-to-yearly-series", "critical_write"),
    ],
  }),
  "cai.event.09.area_list_add_show_update_delete_bulk_copy": action({
    action_id: "cai.event.09.area_list_add_show_update_delete_bulk_copy", domain: "event", source_action: "area list|add|show|update|delete|bulk|copy", operations: [
      read("list", "/events/areas/by-event/{event_id}"), write("add", "POST", "/events/areas/"), read("show", "/events/areas/{area_id}"),
      write("update", "PATCH", "/events/areas/{area_id}"), write("delete", "DELETE", "/events/areas/{area_id}", "critical_write"),
      write("bulk", "POST", "/events/areas/bulk", "critical_write"), write("copy", "POST", "/events/areas/copy-to-events", "critical_write"),
    ],
  }),
  "cai.event.10.assignment_list_add_remove_clear": action({ action_id: "cai.event.10.assignment_list_add_remove_clear", domain: "event", source_action: "assignment list|add|remove|clear", operations: [
    read("list", "/events/areas/{area_id}/assignments"), write("add", "POST", "/events/areas/{area_id}/assign-member"),
    write("remove", "DELETE", "/events/areas/{area_id}/assign-member/{member_id}", "critical_write"), write("clear", "DELETE", "/events/areas/{area_id}/assignments", "critical_write"),
  ] }),
  "cai.event.11.lead_list_add_update_delete": action({ action_id: "cai.event.11.lead_list_add_update_delete", domain: "event", source_action: "lead list|add|update|delete", operations: [read("list", "/events/areas/{area_id}/leads"), write("add", "POST", "/events/areas/{area_id}/leads"), write("update", "PATCH", "/events/areas/leads/{lead_id}"), write("delete", "DELETE", "/events/areas/leads/{lead_id}", "critical_write")] }),
  "cai.event.12.area_note_list_add_update_delete": action({ action_id: "cai.event.12.area_note_list_add_update_delete", domain: "event", source_action: "area-note list|add|update|delete", operations: [read("list", "/events/areas/{area_id}/notes"), write("add", "POST", "/events/areas/{area_id}/notes"), write("update", "PUT", "/events/areas/notes/{note_id}"), write("delete", "DELETE", "/events/areas/notes/{note_id}", "critical_write")] }),
  "cai.event.13.program_list_add_update_delete_reorder": action({ action_id: "cai.event.13.program_list_add_update_delete_reorder", domain: "event", source_action: "program list|add|update|delete|reorder", operations: [read("list", "/events/{event_id}/program-items"), write("add", "POST", "/events/{event_id}/program-items"), write("update", "PATCH", "/events/program-items/{item_id}"), write("delete", "DELETE", "/events/program-items/{item_id}", "critical_write"), write("reorder", "PUT", "/events/{event_id}/program-items/reorder", "critical_write")] }),
  "cai.event.14.contact_list_add_update_delete": action({ action_id: "cai.event.14.contact_list_add_update_delete", domain: "event", source_action: "contact list|add|update|delete", operations: [read("list", "/events/{event_id}/contacts"), write("add", "POST", "/events/{event_id}/contacts"), write("update", "PATCH", "/events/contacts/{contact_id}"), write("delete", "DELETE", "/events/contacts/{contact_id}", "critical_write")] }),
  "cai.event.15.resource_list_add_set_remove_link_show_link_update_link_delete_usage_u": action({
    action_id: "cai.event.15.resource_list_add_set_remove_link_show_link_update_link_delete_usage_u", domain: "event", source_action: "resource list|add|set|remove|link-show|link-update|link-delete|usage|usage-batch", operations: [
      read("list", "/events/{event_id}/resources"), write("add", "POST", "/events/{event_id}/resources"), write("set", "PUT", "/events/{event_id}/resources"),
      write("remove", "DELETE", "/events/{event_id}/resources", "critical_write"), read("link_show", "/event-resource-links/{link_id}"),
      write("link_update", "PATCH", "/event-resource-links/{link_id}"), write("link_delete", "DELETE", "/event-resource-links/{link_id}", "critical_write"),
      read("usage", "/events/resource-usage/"), op({ name: "usage_batch", risk: "read", routes: [route("POST", "event", "/events/resource-usage/batch", "read")] }),
    ],
  }),
  "cai.event.16.attachment_list_show_add_update_delete": action({ action_id: "cai.event.16.attachment_list_show_add_update_delete", domain: "event", source_action: "attachment list|show|add|update|delete", operations: [read("list", "/events/{event_id}/attachments"), read("show", "/events/attachments/{attachment_id}"), write("add", "POST", "/events/{event_id}/attachments"), write("update", "PATCH", "/events/attachments/{attachment_id}"), write("delete", "DELETE", "/events/attachments/{attachment_id}", "critical_write")] }),
  "cai.event.17.tag_category_and_assignment_workflows": action({
    action_id: "cai.event.17.tag_category_and_assignment_workflows", domain: "event", source_action: "tag category and assignment workflows", operations: [
      read("category_list", "/events/tags/category/by-club/{club_id}"), read("category_show", "/events/tags/category/{category_id}"), write("category_add", "POST", "/events/tags/category"), write("category_update", "PATCH", "/events/tags/category/{category_id}"), write("category_delete", "DELETE", "/events/tags/category/{category_id}", "critical_write"),
      read("tag_list", "/events/tags/by-club/{club_id}"), read("tag_show", "/events/tags/{tag_id}"), write("tag_add", "POST", "/events/tags/"), write("tag_update", "PATCH", "/events/tags/{tag_id}"), write("tag_delete", "DELETE", "/events/tags/{tag_id}", "critical_write"),
      read("assigned", "/events/tags/assigned-tags/by-event/{event_id}/by-club/{club_id}"), read("assignment_list", "/events/tags/assign/by-event/{event_id}"), write("assign", "POST", "/events/tags/assign"), write("unassign", "DELETE", "/events/tags/assign/{assignment_id}", "critical_write"), write("clear", "DELETE", "/events/tags/assign/by-event/{event_id}", "critical_write"),
    ],
  }),
  "cai.event.18.sponsor_and_sponsor_program_workflows": action({
    action_id: "cai.event.18.sponsor_and_sponsor_program_workflows", domain: "event", source_action: "sponsor and sponsor-program workflows", operations: [
      read("link_list", "/events/{event_id}/sponsor-links"), write("link_add", "POST", "/events/{event_id}/sponsor-links"), write("link_delete", "DELETE", "/events/sponsor-links/{link_id}", "critical_write"),
      read("tier_list", "/events/{event_id}/sponsor-tier-mappings"), write("tier_add", "POST", "/events/{event_id}/sponsor-tier-mappings"), write("tier_update", "PATCH", "/events/sponsor-tier-mappings/{mapping_id}"), write("tier_delete", "DELETE", "/events/sponsor-tier-mappings/{mapping_id}", "critical_write"), write("tier_sync", "POST", "/events/{event_id}/sponsor-tier-mappings/sync", "critical_write"),
      read("program_by_sponsor", "/events/sponsor-links/{link_id}/program-items"), read("program_by_item", "/events/program-items/{item_id}/sponsor-links"), write("program_add", "POST", "/events/sponsor-links/{link_id}/program-items"), write("program_delete", "DELETE", "/events/sponsor-links/{link_id}/program-items/{item_id}", "critical_write"),
    ],
  }),
  "cai.event.19.invitation_and_club_invitation_workflows": action({
    action_id: "cai.event.19.invitation_and_club_invitation_workflows", domain: "event", source_action: "invitation and club-invitation workflows", operations: [
      read("member_mine", "/events/invitations/my-invitations"), read("member_list", "/events/invitations/by-event/{event_id}"), read("member_show", "/events/invitations/{invitation_id}"),
      write("member_add", "POST", "/events/invitations/"), write("member_add_groups", "POST", "/events/invitations/invite-groups"), write("member_add_departments", "POST", "/events/invitations/invite-departments"), write("member_add_org_groups", "POST", "/events/invitations/invite-organization-groups"),
      write("member_update", "PATCH", "/events/invitations/{invitation_id}"), write("member_status", "PATCH", "/events/invitations/status/{invitation_id}"), write("member_delete", "DELETE", "/events/invitations/{invitation_id}", "critical_write"), read("member_notified", "/events/invitations/by-event/{event_id}/notified"),
      read("club_list", "/events/club-invitations/by-event/{event_id}"), read("club_attending", "/events/club-invitations/by-event/{event_id}/attending"), read("club_incoming", "/events/club-invitations/by-invited-club/{club_id}"), read("club_accepted", "/events/club-invitations/by-invited-club/{club_id}/accepted"), read("club_show", "/events/club-invitations/{invitation_id}"),
      write("club_add", "POST", "/events/club-invitations/"), op({ name: "club_external", risk: "critical_write", effect: "third_party", routes: [route("POST", "event", "/club-event-invitations/external")] }), write("club_self_join", "POST", "/events/club-invitations/self-join", "critical_write"), write("club_update", "PATCH", "/events/club-invitations/{invitation_id}"), write("club_respond", "PATCH", "/events/club-invitations/{invitation_id}/respond", "critical_write"), write("club_delete", "DELETE", "/events/club-invitations/{invitation_id}", "critical_write"),
    ],
  }),
  "cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate": action({ action_id: "cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate", domain: "event", source_action: "registration list|add|stats|show|update|adjust|delete|aggregate", operations: [read("list", "/events/{event_id}/attendee-registrations"), write("add", "POST", "/events/{event_id}/attendee-registrations"), read("stats", "/events/{event_id}/attendee-stats"), read("show", "/event-attendee-registrations/{registration_id}"), write("update", "PATCH", "/event-attendee-registrations/{registration_id}"), write("adjust", "PATCH", "/event-attendee-registrations/{registration_id}/admin-adjust", "critical_write"), write("delete", "DELETE", "/event-attendee-registrations/{registration_id}", "critical_write"), read("aggregate", "/club-event-invitations/{invitation_id}/aggregate")] }),
  "cai.event.21.budget_show_set_delete": action({ action_id: "cai.event.21.budget_show_set_delete", domain: "event", source_action: "budget show|set|delete", operations: [read("show", "/events/budget-link/{event_id}"), write("set", "POST", "/events/budget-link/"), write("delete", "DELETE", "/events/budget-link/{event_id}", "critical_write")] }),
  "cai.event.22.design_theme_and_asset_workflows": action({ action_id: "cai.event.22.design_theme_and_asset_workflows", domain: "event", source_action: "design theme and asset workflows", operations: [read("theme_show", "/events/{event_id}/design/theme"), write("theme_set", "PUT", "/events/{event_id}/design/theme"), write("theme_delete", "DELETE", "/events/{event_id}/design/theme", "critical_write"), read("asset_list", "/events/{event_id}/design/assets"), op({ name: "asset_upload", scopes: ["files.write", "event.write"], permissions: policy(["manage_events"]), risk: "critical_write", job: true, routes: [route("POST", "event", "/events/{event_id}/design/assets/upload")] }), write("asset_delete", "DELETE", "/events/{event_id}/design/assets/{asset_id}", "critical_write")] }),
  "cai.event.23.copy_set_reset": action({ action_id: "cai.event.23.copy_set_reset", domain: "event", source_action: "copy set|reset", operations: [write("set", "PATCH", "/events/{event_id}/public-hub-copy"), write("reset", "DELETE", "/events/{event_id}/public-hub-copy/{key}", "critical_write")] }),
  "cai.event.24.dj_settings_and_request_workflows": action({ action_id: "cai.event.24.dj_settings_and_request_workflows", domain: "event", source_action: "dj settings and request workflows", operations: [read("settings", "/public/events/{event_id}/dj/settings"), read("requests", "/public/events/{event_id}/dj/requests"), write("settings_set", "PATCH", "/events/{event_id}/dj/settings"), write("request_status", "PATCH", "/events/dj/requests/{request_id}/status"), write("reset", "POST", "/events/{event_id}/dj/requests/reset", "critical_write")] }),
  "cai.event.25.external_sync_workflows": action({ action_id: "cai.event.25.external_sync_workflows", domain: "event", source_action: "external-sync workflows", operations: [read("list", "/external-team-syncs/by-club/{club_id}"), write("add", "POST", "/external-team-syncs/"), read("show", "/external-team-syncs/{sync_id}"), write("update", "PATCH", "/external-team-syncs/{sync_id}"), write("delete", "DELETE", "/external-team-syncs/{sync_id}", "critical_write"), read("matches", "/external-team-syncs/{sync_id}/matches"), write("run", "POST", "/external-team-syncs/sync/{club_id}", "critical_write"), read("stats", "/external-team-syncs/stats/{club_id}"), op({ name: "provider_run", risk: "critical_write", effect: "third_party", routes: [route("POST", "event", "/external-team-syncs/sync/by-provider/{provider_id}")] })] }),
  "cai.event.26.instance_previous_next_compare_clone_next": action({ action_id: "cai.event.26.instance_previous_next_compare_clone_next", domain: "event", source_action: "instance previous|next|compare|clone-next", operations: [read("previous", "/events/{event_id}/previous-instance"), read("next", "/events/{event_id}/next-instance"), read("compare", "/events/{event_id}/compare/{other_event_id}"), write("clone_next", "POST", "/events/{event_id}/clone-next")] }),
  "cai.event.27.child_list_create_invitation_summary": action({ action_id: "cai.event.27.child_list_create_invitation_summary", domain: "event", source_action: "child list|create|invitation-summary", operations: [read("list", "/events/{event_id}/children"), write("create", "POST", "/events/{event_id}/children"), read("invitation_summary", "/events/{event_id}/child-invitation-summary")] }),
  "cai.event.28.menu_list_assign_unassign": action({ action_id: "cai.event.28.menu_list_assign_unassign", domain: "event", source_action: "menu list|assign|unassign", operations: [read("list", "/menu/events/{event_id}/menus", "supply"), write("assign", "POST", "/menu/events/menus", "reversible_write", "supply"), write("unassign", "DELETE", "/menu/events/menus/{event_menu_id}", "critical_write", "supply")] }),

  "cai.plan.01.list": action({ action_id: "cai.plan.01.list", domain: "plan", source_action: "list", operations: [read("list", "/events/{event_id}/map-plans")] }),
  "cai.plan.02.show": action({ action_id: "cai.plan.02.show", domain: "plan", source_action: "show", operations: [read("show", "/events/map-plans/{plan_id}/map")] }),
  "cai.plan.03.create": action({ action_id: "cai.plan.03.create", domain: "plan", source_action: "create", operations: [write("create", "POST", "/events/{event_id}/map-plans")] }),
  "cai.plan.04.update": action({ action_id: "cai.plan.04.update", domain: "plan", source_action: "update", operations: [write("update", "PATCH", "/events/map-plans/{plan_id}")] }),
  "cai.plan.05.delete": action({ action_id: "cai.plan.05.delete", domain: "plan", source_action: "delete", operations: [write("delete", "DELETE", "/events/map-plans/{plan_id}", "critical_write")] }),
  "cai.plan.06.zone_list_create_update_delete_link_unlink": action({ action_id: "cai.plan.06.zone_list_create_update_delete_link_unlink", domain: "plan", source_action: "zone list|create|update|delete|link|unlink", operations: [read("list", "/events/map-plans/{plan_id}/map"), write("create", "POST", "/events/map-zones"), write("update", "PATCH", "/events/map-zones/{zone_id}"), write("delete", "DELETE", "/events/map-zones/{zone_id}", "critical_write"), write("link", "POST", "/events/map-zones/{zone_id}/areas"), write("unlink", "DELETE", "/events/map-zones/{zone_id}/areas/{area_id}", "critical_write")] }),
  "cai.plan.07.table_create_duplicate_update_delete": action({ action_id: "cai.plan.07.table_create_duplicate_update_delete", domain: "plan", source_action: "table create|duplicate|update|delete", operations: [write("create", "POST", "/events/tables"), write("duplicate", "POST", "/events/tables/{table_id}/duplicate"), write("update", "PATCH", "/events/tables/{table_id}"), write("delete", "DELETE", "/events/tables/{table_id}", "critical_write")] }),
  "cai.plan.08.marker_create_update_delete": action({ action_id: "cai.plan.08.marker_create_update_delete", domain: "plan", source_action: "marker create|update|delete", operations: [write("create", "POST", "/events/map-markers"), write("update", "PATCH", "/events/map-markers/{marker_id}"), write("delete", "DELETE", "/events/map-markers/{marker_id}", "critical_write")] }),
  "cai.plan.09.guest_list_add_update_delete": action({ action_id: "cai.plan.09.guest_list_add_update_delete", domain: "plan", source_action: "guest list|add|update|delete", operations: [read("list", "/events/{event_id}/guests"), write("add", "POST", "/events/{event_id}/guests"), write("update", "PATCH", "/events/guests/{guest_id}"), write("delete", "DELETE", "/events/guests/{guest_id}", "critical_write")] }),
  "cai.plan.10.detail": action({ action_id: "cai.plan.10.detail", domain: "plan", source_action: "detail", operations: [write("create", "POST", "/events/map-zones/{zone_id}/detail-plan")] }),
  "cai.plan.11.export": action({ action_id: "cai.plan.11.export", domain: "plan", source_action: "export", operations: [op({ name: "export", scopes: ["files.export", "event.read"], permissions: policy(["view_events"]), risk: "critical_write", job: true, routes: [route("GET", "event", "/events/{event_id}/map-plans", "preflight")] })] }),
  "cai.plan.12.illustrate": action({ action_id: "cai.plan.12.illustrate", domain: "plan", source_action: "illustrate", operations: [op({ name: "illustrate", scopes: ["files.export", "event.read"], permissions: policy(["view_events"]), risk: "critical_write", job: true, effect: "third_party", routes: [route("GET", "event", "/events/{event_id}/map-plans", "preflight")] })] }),
  "cai.plan.13.compose": action({ action_id: "cai.plan.13.compose", domain: "plan", source_action: "compose", operations: [op({ name: "compose", scopes: ["files.write", "event.write"], permissions: policy(["manage_events"]), risk: "critical_write", job: true, routes: [route("GET", "event", "/events/map-plans/{plan_id}/map", "preflight")] })] }),
});

export function validateK8Definitions(): void {
  if (Object.keys(K8_ACTION_DEFINITIONS).length !== K8_ACTION_IDS.length) {
    throw new Error("K8-Aktionsinventar und Definitionen sind nicht deckungsgleich.");
  }
  for (const actionId of K8_ACTION_IDS) {
    const definition = K8_ACTION_DEFINITIONS[actionId];
    if (!definition || Object.keys(definition.operations).length === 0) throw new Error(`${actionId}: Operationen fehlen.`);
    for (const [name, operation] of Object.entries(definition.operations)) {
      if (name !== operation.operation || operation.backend_routes.length === 0) throw new Error(`${actionId}:${name}: ungültige Branch-Definition.`);
      if (operation.risk_class === "read" && operation.execution_gate !== "inline") throw new Error(`${actionId}:${name}: Read darf kein Write-Gate nutzen.`);
      if (operation.risk_class === "critical_write" && !["event_confirmation", "job"].includes(operation.execution_gate)) throw new Error(`${actionId}:${name}: kritische Aktion ohne Bestätigung/Job.`);
    }
  }
}
