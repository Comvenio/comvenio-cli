import type {
  OAuthScope,
} from "@comvenio/connector-contracts";
import type {
  ActionRisk,
  PermissionPolicy,
} from "@comvenio/tool-catalog";

import {
  K7_ACTION_IDS,
  type K7ActionDefinition,
  type K7ActionId,
  type K7BackendRoute,
  type K7Domain,
  type K7ExecutionGate,
} from "./types.ts";

const sourcePath: Record<K7Domain, string> = {
  whoami: "src/commands/whoami.ts",
  club: "src/commands/club.ts",
  member: "src/commands/member.ts",
  team: "src/commands/team.ts",
  role: "src/commands/role.ts",
};

const route = (
  route_id: K7BackendRoute["route_id"],
  method: K7BackendRoute["method"],
  service: K7BackendRoute["service"],
  normalized_path_template: string,
  purpose: K7BackendRoute["purpose"] = method === "GET" ? "read" : "mutation",
): K7BackendRoute => ({ route_id, method, service, normalized_path_template, purpose });

function policy(
  all_of: string[] = [],
  department_scope: PermissionPolicy["department_scope"] = "optional",
  owner_or_self_allowed = false,
): PermissionPolicy {
  return {
    all_of,
    any_of: [],
    owner_or_self_allowed,
    department_scope,
    backend_audit_refs: [],
  };
}

function definition(input: {
  action_id: K7ActionId;
  domain: K7Domain;
  source_action: string;
  scopes: readonly OAuthScope[];
  permission?: PermissionPolicy;
  risk?: ActionRisk;
  gate?: K7ExecutionGate;
  routes: readonly K7BackendRoute[];
  blocker?: string;
}): K7ActionDefinition {
  const risk = input.risk ?? "read";
  const gate = input.gate ?? (risk === "read" ? "inline" : "write_safety");
  return Object.freeze({
    action_id: input.action_id,
    domain: input.domain,
    source_action: input.source_action,
    source_path: sourcePath[input.domain],
    required_scopes: Object.freeze([...input.scopes]),
    permission_policy: Object.freeze(structuredClone(input.permission ?? policy())),
    risk_class: risk,
    execution_mode: gate === "job" ? "async_job" : "inline",
    confirmation: risk === "critical_write" ? "required" : "none",
    execution_gate: gate,
    department_scope: (input.permission ?? policy()).department_scope,
    backend_routes: Object.freeze(input.routes.map((item) => Object.freeze({ ...item }))),
    publication_state: input.blocker ? "blocked" : "implemented",
    blocker: input.blocker ?? null,
  });
}

const CLUB_READ = ["club.read"] as const;
const ADMIN_WRITE = ["admin.write"] as const;
const MEMBER_BASIC = ["member.read.basic"] as const;
const MEMBER_DETAILS = ["member.read.details"] as const;

export const K7_ACTION_DEFINITIONS: Readonly<Record<K7ActionId, K7ActionDefinition>> = Object.freeze({
  "cai.whoami.01.whoami": definition({
    action_id: "cai.whoami.01.whoami", domain: "whoami", source_action: "whoami", scopes: CLUB_READ,
    permission: policy([], "optional", true), routes: [route("route.560", "GET", "user", "/users/me")],
  }),
  "cai.club.01.info": definition({
    action_id: "cai.club.01.info", domain: "club", source_action: "info", scopes: CLUB_READ,
    routes: [route("route.021", "GET", "club", "/clubs/{club_id}")],
    blocker: "GET /clubs/{club_id} besitzt keinen Auth-/RBAC-Guard und liefert ClubRead inklusive Settings; stattdessen bleibt public_club_profile verfügbar.",
  }),
  "cai.club.02.update": definition({
    action_id: "cai.club.02.update", domain: "club", source_action: "update", scopes: ADMIN_WRITE,
    permission: policy(["manage_club_settings"]), risk: "reversible_write",
    routes: [route("route.022", "PUT", "club", "/clubs/{club_id}")],
  }),
  "cai.club.03.settings": definition({
    action_id: "cai.club.03.settings", domain: "club", source_action: "settings", scopes: CLUB_READ,
    routes: [route("route.023", "GET", "club", "/clubs/{club_id}/settings")],
  }),
  "cai.club.04.settings_update": definition({
    action_id: "cai.club.04.settings_update", domain: "club", source_action: "settings-update", scopes: ADMIN_WRITE,
    permission: policy(["manage_club_settings"]), risk: "reversible_write",
    routes: [route("route.024", "PUT", "club", "/clubs/{club_id}/settings")],
  }),
  "cai.club.05.design": definition({
    action_id: "cai.club.05.design", domain: "club", source_action: "design", scopes: ADMIN_WRITE,
    permission: policy(["manage_club_settings"]), risk: "reversible_write",
    routes: [route("route.030", "PUT", "club", "/clubs/{club_id}/settings")],
  }),
  "cai.club.06.department_list": definition({
    action_id: "cai.club.06.department_list", domain: "club", source_action: "department-list", scopes: CLUB_READ,
    routes: [route("route.025", "GET", "club", "/departments/by_club/{club_id}{tree_suffix}")],
  }),
  "cai.club.07.department_show": definition({
    action_id: "cai.club.07.department_show", domain: "club", source_action: "department-show", scopes: CLUB_READ,
    routes: [route("route.026", "GET", "club", "/departments/by_dep_id/{department_id}")],
  }),
  "cai.club.08.department_add": definition({
    action_id: "cai.club.08.department_add", domain: "club", source_action: "department-add", scopes: ADMIN_WRITE,
    permission: policy(["manage_club_areas"]), risk: "reversible_write",
    routes: [route("route.027", "POST", "club", "/departments/{club_id}")],
  }),
  "cai.club.09.department_update": definition({
    action_id: "cai.club.09.department_update", domain: "club", source_action: "department-update", scopes: ADMIN_WRITE,
    permission: policy(["manage_club_areas"]), risk: "reversible_write",
    routes: [route("route.028", "PUT", "club", "/departments/{department_id}")],
  }),
  "cai.club.10.department_delete": definition({
    action_id: "cai.club.10.department_delete", domain: "club", source_action: "department-delete", scopes: ADMIN_WRITE,
    permission: policy(["manage_club_areas"]), risk: "critical_write",
    routes: [route("route.029", "DELETE", "club", "/departments/{department_id}")],
  }),

  "cai.member.01.list": definition({
    action_id: "cai.member.01.list", domain: "member", source_action: "list", scopes: MEMBER_BASIC,
    permission: policy(["view_members"]), routes: [route("route.285", "GET", "member", "/members/by_club/{club_id}")],
  }),
  "cai.member.02.show": definition({
    action_id: "cai.member.02.show", domain: "member", source_action: "show", scopes: MEMBER_DETAILS,
    permission: policy(["view_members_details"]), routes: [route("route.286", "GET", "member", "/members/{member_id}")],
  }),
  "cai.member.03.add": definition({
    action_id: "cai.member.03.add", domain: "member", source_action: "add", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write",
    routes: [route("route.287", "POST", "member", "/members/")],
  }),
  "cai.member.04.update": definition({
    action_id: "cai.member.04.update", domain: "member", source_action: "update", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write",
    routes: [route("route.288", "PATCH", "member", "/members/{member_id}")],
  }),
  "cai.member.05.remove": definition({
    action_id: "cai.member.05.remove", domain: "member", source_action: "remove", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "critical_write",
    routes: [route("route.289", "DELETE", "member", "/members/{member_id}")],
  }),
  "cai.member.06.import": definition({
    action_id: "cai.member.06.import", domain: "member", source_action: "import", scopes: ["files.import"],
    permission: policy(["manage_members"]), risk: "critical_write", gate: "job",
    routes: [route("route.305", "POST", "member", "/members/import/bulk")],
  }),
  "cai.member.07.family_list": definition({
    action_id: "cai.member.07.family_list", domain: "member", source_action: "family-list", scopes: MEMBER_DETAILS,
    permission: policy(["view_members_details"]), routes: [route("route.290", "GET", "member", "/families/by_club/{club_id}")],
  }),
  "cai.member.08.family_show": definition({
    action_id: "cai.member.08.family_show", domain: "member", source_action: "family-show", scopes: MEMBER_DETAILS,
    permission: policy(["view_members_details"]), routes: [route("route.291", "GET", "member", "/families/{family_id}")],
  }),
  "cai.member.09.family_add": definition({
    action_id: "cai.member.09.family_add", domain: "member", source_action: "family-add", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write", routes: [route("route.292", "POST", "member", "/families/")],
  }),
  "cai.member.10.family_update": definition({
    action_id: "cai.member.10.family_update", domain: "member", source_action: "family-update", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write", routes: [route("route.293", "PATCH", "member", "/families/{family_id}")],
  }),
  "cai.member.11.family_delete": definition({
    action_id: "cai.member.11.family_delete", domain: "member", source_action: "family-delete", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "critical_write", routes: [route("route.294", "DELETE", "member", "/families/{family_id}")],
  }),
  "cai.member.12.status_list": definition({
    action_id: "cai.member.12.status_list", domain: "member", source_action: "status-list", scopes: MEMBER_BASIC,
    permission: policy(["view_members"]), routes: [route("route.295", "GET", "member", "/membership-status/by_club/{club_id}")],
  }),
  "cai.member.13.status_show": definition({
    action_id: "cai.member.13.status_show", domain: "member", source_action: "status-show", scopes: MEMBER_DETAILS,
    permission: policy(["view_members_details"]), routes: [route("route.296", "GET", "member", "/membership-status/{status_id}")],
  }),
  "cai.member.14.status_add": definition({
    action_id: "cai.member.14.status_add", domain: "member", source_action: "status-add", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write", routes: [route("route.297", "POST", "member", "/membership-status/")],
  }),
  "cai.member.15.status_update": definition({
    action_id: "cai.member.15.status_update", domain: "member", source_action: "status-update", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write", routes: [route("route.298", "PATCH", "member", "/membership-status/{status_id}")],
  }),
  "cai.member.16.status_delete": definition({
    action_id: "cai.member.16.status_delete", domain: "member", source_action: "status-delete", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "critical_write", routes: [route("route.299", "DELETE", "member", "/membership-status/{status_id}")],
  }),
  "cai.member.17.period_list": definition({
    action_id: "cai.member.17.period_list", domain: "member", source_action: "period-list", scopes: MEMBER_BASIC,
    permission: policy(["view_members"]), routes: [route("route.300", "GET", "member", "/membership-periods/member/{member_id}")],
  }),
  "cai.member.18.period_show": definition({
    action_id: "cai.member.18.period_show", domain: "member", source_action: "period-show", scopes: MEMBER_DETAILS,
    permission: policy(["view_members_details"]), routes: [route("route.301", "GET", "member", "/membership-periods/{period_id}")],
  }),
  "cai.member.19.period_add": definition({
    action_id: "cai.member.19.period_add", domain: "member", source_action: "period-add", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write", routes: [route("route.302", "POST", "member", "/membership-periods/")],
  }),
  "cai.member.20.period_update": definition({
    action_id: "cai.member.20.period_update", domain: "member", source_action: "period-update", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write", routes: [route("route.303", "PATCH", "member", "/membership-periods/{period_id}")],
  }),
  "cai.member.21.period_delete": definition({
    action_id: "cai.member.21.period_delete", domain: "member", source_action: "period-delete", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "critical_write", routes: [route("route.304", "DELETE", "member", "/membership-periods/{period_id}")],
  }),

  "cai.team.01.list": definition({
    action_id: "cai.team.01.list", domain: "team", source_action: "list", scopes: CLUB_READ,
    permission: policy(["view_members"]), routes: [route("route.494", "GET", "member", "/teams/by-club/{club_id}")],
  }),
  "cai.team.02.show": definition({
    action_id: "cai.team.02.show", domain: "team", source_action: "show", scopes: CLUB_READ,
    permission: policy(["view_members"]), routes: [route("route.495", "GET", "member", "/teams/{team_id}")],
  }),
  "cai.team.03.create": definition({
    action_id: "cai.team.03.create", domain: "team", source_action: "create", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write", routes: [route("route.496", "POST", "member", "/teams/")],
  }),
  "cai.team.04.update": definition({
    action_id: "cai.team.04.update", domain: "team", source_action: "update", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "reversible_write", routes: [route("route.497", "PATCH", "member", "/teams/{team_id}")],
  }),
  "cai.team.05.delete": definition({
    action_id: "cai.team.05.delete", domain: "team", source_action: "delete", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "critical_write", routes: [route("route.498", "DELETE", "member", "/teams/{team_id}")],
  }),
  "cai.team.06.member_list_add_update_remove": definition({
    action_id: "cai.team.06.member_list_add_update_remove", domain: "team", source_action: "member list|add|update|remove", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "critical_write", routes: [
      route("route.499", "GET", "member", "/teams/{team_id}/members"),
      route("route.500", "POST", "member", "/teams/{team_id}/members"),
      route("route.501", "PATCH", "member", "/teams/{team_id}/members/{member_id}"),
      route("route.502", "DELETE", "member", "/teams/{team_id}/members/{member_id}"),
    ],
  }),
  "cai.team.07.resource_list_add_update_remove": definition({
    action_id: "cai.team.07.resource_list_add_update_remove", domain: "team", source_action: "resource list|add|update|remove", scopes: ADMIN_WRITE,
    permission: policy(["manage_members"]), risk: "critical_write", routes: [
      route("route.503", "GET", "member", "/teams/{team_id}/resource-priorities"),
      route("route.504", "POST", "member", "/teams/{team_id}/resource-priorities"),
      route("route.505", "PATCH", "member", "/teams/{team_id}/resource-priorities/{priority_id}"),
      route("route.506", "DELETE", "member", "/teams/{team_id}/resource-priorities/{priority_id}"),
    ],
  }),

  "cai.role.01.list": definition({
    action_id: "cai.role.01.list", domain: "role", source_action: "list", scopes: CLUB_READ,
    routes: [route("route.398", "GET", "role", "/roles/by-club/{club_id}")],
  }),
  "cai.role.02.show": definition({
    action_id: "cai.role.02.show", domain: "role", source_action: "show", scopes: CLUB_READ,
    routes: [route("route.399", "GET", "role", "/roles/{role_id}")],
  }),
  "cai.role.03.create": definition({
    action_id: "cai.role.03.create", domain: "role", source_action: "create", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "reversible_write", routes: [route("route.400", "POST", "role", "/roles/")],
  }),
  "cai.role.04.update": definition({
    action_id: "cai.role.04.update", domain: "role", source_action: "update", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "reversible_write", routes: [
      route("route.397", "GET", "role", "/roles/{role_id}", "preflight"),
      route("route.401", "PATCH", "role", "/roles/{role_id}"),
    ],
  }),
  "cai.role.05.delete": definition({
    action_id: "cai.role.05.delete", domain: "role", source_action: "delete", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "critical_write", routes: [
      route("route.397", "GET", "role", "/roles/{role_id}", "preflight"),
      route("route.402", "DELETE", "role", "/roles/{role_id}"),
    ],
  }),
  "cai.role.06.permission_defs": definition({
    action_id: "cai.role.06.permission_defs", domain: "role", source_action: "permission-defs", scopes: CLUB_READ,
    routes: [route("route.405", "GET", "role", "/permission-definitions/")],
  }),
  "cai.role.07.permission_set": definition({
    action_id: "cai.role.07.permission_set", domain: "role", source_action: "permission set", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "reversible_write", routes: [
      route("route.397", "GET", "role", "/roles/{role_id}", "preflight"),
      route("route.406", "GET", "role", "/permissions/by-role/{role_id}", "preflight"),
      route("route.407", "GET", "role", "/permission-definitions/", "preflight"),
      route("route.408", "POST", "role", "/roles/{role_id}/permissions/apply"),
    ],
  }),
  "cai.role.08.permissions_show_apply": definition({
    action_id: "cai.role.08.permissions_show_apply", domain: "role", source_action: "permissions show|apply", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "critical_write", routes: [
      route("route.406", "GET", "role", "/permissions/by-role/{role_id}"),
      route("route.407", "GET", "role", "/permission-definitions/", "preflight"),
      route("route.408", "POST", "role", "/roles/{role_id}/permissions/apply"),
    ],
  }),
  "cai.role.09.assign": definition({
    action_id: "cai.role.09.assign", domain: "role", source_action: "assign", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "reversible_write", routes: [
      route("route.410", "GET", "role", "/member-role-assignments/by-member/{member_id}", "preflight"),
      route("route.411", "POST", "role", "/member-role-assignments/"),
    ],
  }),
  "cai.role.10.unassign": definition({
    action_id: "cai.role.10.unassign", domain: "role", source_action: "unassign", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "critical_write", routes: [
      route("route.412", "GET", "role", "/member-role-assignments/by_id/{assignment_id}", "preflight"),
      route("route.413", "DELETE", "role", "/member-role-assignments/{assignment_id}"),
    ],
  }),
  "cai.role.11.assignments": definition({
    action_id: "cai.role.11.assignments", domain: "role", source_action: "assignments", scopes: CLUB_READ,
    permission: policy(["manage_roles"]), routes: [route("route.416", "GET", "role", "/member-role-assignments/{selector}")],
  }),
  "cai.role.12.position_link": definition({
    action_id: "cai.role.12.position_link", domain: "role", source_action: "position-link", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "reversible_write", routes: [
      route("route.417", "GET", "role", "/position-roles/by-position/{position_id}", "preflight"),
      route("route.418", "POST", "role", "/position-roles/"),
    ],
  }),
  "cai.role.13.position_unlink": definition({
    action_id: "cai.role.13.position_unlink", domain: "role", source_action: "position-unlink", scopes: ADMIN_WRITE,
    permission: policy(["manage_roles"]), risk: "critical_write", routes: [
      route("route.419", "GET", "role", "/position-roles/{assignment_id}", "preflight"),
      route("route.420", "DELETE", "role", "/position-roles/{assignment_id}"),
    ],
  }),
  "cai.role.14.position_list": definition({
    action_id: "cai.role.14.position_list", domain: "role", source_action: "position-list", scopes: CLUB_READ,
    permission: policy(["manage_roles"]), routes: [route("route.423", "GET", "role", "/position-roles/by-position/{position_id}")],
  }),
  "cai.role.15.effective": definition({
    action_id: "cai.role.15.effective", domain: "role", source_action: "effective", scopes: CLUB_READ,
    permission: policy([], "optional", true), routes: [route(null, "GET", "role", "/permissions/effective/self")],
    blocker: "Der erforderliche Self-Endpunkt GET /permissions/effective/self ist im Role-Service noch nicht implementiert; der Legacy-Fremdmember-Pfad wird nicht exponiert.",
  }),
});

export function validateK7Definitions(): void {
  const keys = Object.keys(K7_ACTION_DEFINITIONS);
  if (keys.length !== K7_ACTION_IDS.length
    || K7_ACTION_IDS.some((id) => !Object.hasOwn(K7_ACTION_DEFINITIONS, id))) {
    throw new Error("Die K7-Aktionsdefinitionen bilden das 54-Aktionen-Inventar nicht vollständig ab.");
  }
  for (const definition of Object.values(K7_ACTION_DEFINITIONS)) {
    if (definition.publication_state === "blocked" && !definition.blocker) {
      throw new Error(`${definition.action_id}: Blockierter Adapter benötigt einen Blocker.`);
    }
    if (definition.risk_class === "critical_write" && definition.confirmation !== "required") {
      throw new Error(`${definition.action_id}: Kritischer Write benötigt Bestätigung.`);
    }
    if (definition.risk_class !== "read" && definition.execution_gate === "inline") {
      throw new Error(`${definition.action_id}: Write darf nicht direkt ausgeführt werden.`);
    }
    if (definition.backend_routes.length === 0) {
      throw new Error(`${definition.action_id}: Backend-Routen fehlen.`);
    }
  }
}
