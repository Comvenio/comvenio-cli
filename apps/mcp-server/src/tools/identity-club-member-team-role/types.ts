import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type {
  JsonValue,
  OAuthScope,
  RequestContext,
} from "@comvenio/connector-contracts";
import type {
  ActionRisk,
  DepartmentScope,
  PermissionPolicy,
} from "@comvenio/tool-catalog";
import type { z } from "zod";

export const K7_ACTION_IDS = [
  "cai.whoami.01.whoami",
  "cai.club.01.info",
  "cai.club.02.update",
  "cai.club.03.settings",
  "cai.club.04.settings_update",
  "cai.club.05.design",
  "cai.club.06.department_list",
  "cai.club.07.department_show",
  "cai.club.08.department_add",
  "cai.club.09.department_update",
  "cai.club.10.department_delete",
  "cai.member.01.list",
  "cai.member.02.show",
  "cai.member.03.add",
  "cai.member.04.update",
  "cai.member.05.remove",
  "cai.member.06.import",
  "cai.member.07.family_list",
  "cai.member.08.family_show",
  "cai.member.09.family_add",
  "cai.member.10.family_update",
  "cai.member.11.family_delete",
  "cai.member.12.status_list",
  "cai.member.13.status_show",
  "cai.member.14.status_add",
  "cai.member.15.status_update",
  "cai.member.16.status_delete",
  "cai.member.17.period_list",
  "cai.member.18.period_show",
  "cai.member.19.period_add",
  "cai.member.20.period_update",
  "cai.member.21.period_delete",
  "cai.team.01.list",
  "cai.team.02.show",
  "cai.team.03.create",
  "cai.team.04.update",
  "cai.team.05.delete",
  "cai.team.06.member_list_add_update_remove",
  "cai.team.07.resource_list_add_update_remove",
  "cai.role.01.list",
  "cai.role.02.show",
  "cai.role.03.create",
  "cai.role.04.update",
  "cai.role.05.delete",
  "cai.role.06.permission_defs",
  "cai.role.07.permission_set",
  "cai.role.08.permissions_show_apply",
  "cai.role.09.assign",
  "cai.role.10.unassign",
  "cai.role.11.assignments",
  "cai.role.12.position_link",
  "cai.role.13.position_unlink",
  "cai.role.14.position_list",
  "cai.role.15.effective",
] as const;

export type K7ActionId = (typeof K7_ACTION_IDS)[number];
export type K7Domain = "whoami" | "club" | "member" | "team" | "role";
export type K7ExecutionGate = "inline" | "write_safety" | "job" | "blocked";
export type K7PublicationState = "implemented" | "blocked";

export interface K7BackendRoute {
  route_id: `route.${number}` | null;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  service: "user" | "club" | "member" | "role";
  normalized_path_template: string;
  purpose: "read" | "mutation" | "preflight";
}

export interface K7ActionDefinition {
  action_id: K7ActionId;
  domain: K7Domain;
  source_action: string;
  source_path: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_mode: "inline" | "async_job";
  confirmation: "none" | "required";
  execution_gate: K7ExecutionGate;
  department_scope: DepartmentScope;
  backend_routes: readonly K7BackendRoute[];
  publication_state: K7PublicationState;
  blocker: string | null;
}

export interface K7ActionSchemaContract {
  input: z.ZodType;
  output: z.ZodType;
}

export interface K7ExecutionRequest {
  action_id: K7ActionId;
  input: unknown;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
}

export interface K7MutationRequest {
  definition: K7ActionDefinition;
  input: JsonValue;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
}

export interface K7WriteSafetyPort {
  execute(
    request: K7MutationRequest,
    mutation: () => Promise<JsonValue>,
  ): Promise<JsonValue>;
}

export interface K7JobStartPort {
  start(request: K7MutationRequest): Promise<JsonValue>;
}

export interface K7ExecutionDependencies {
  client: ComvenioApiClient;
  write_safety?: K7WriteSafetyPort;
  job_starter?: K7JobStartPort;
  on_backend_forbidden?: (input: {
    action_id: K7ActionId;
    context: RequestContext;
  }) => void | Promise<void>;
}

export interface K7ActionResult extends Record<string, JsonValue> {
  action_id: K7ActionId;
  result: JsonValue;
}

export type K7ActionHandler = (
  input: JsonValue,
  context: RequestContext,
  client: ComvenioApiClient,
) => Promise<JsonValue>;
