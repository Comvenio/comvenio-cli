import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, OAuthScope, RequestContext } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";
import type { z } from "zod";

export const K14_FINANCE_ACTION_IDS = [
  "cai.finance.01.plan_list", "cai.finance.02.plan_show", "cai.finance.03.plan_create", "cai.finance.04.plan_update",
  "cai.finance.05.plan_close", "cai.finance.06.plan_reopen", "cai.finance.07.plan_copy", "cai.finance.08.position_list",
  "cai.finance.09.position_create", "cai.finance.10.position_show", "cai.finance.11.position_update", "cai.finance.12.position_delete",
  "cai.finance.13.position_import_shopping", "cai.finance.14.summary", "cai.finance.15.entry_list", "cai.finance.16.entry_create",
  "cai.finance.17.entry_show", "cai.finance.18.entry_update", "cai.finance.19.entry_delete", "cai.finance.20.entry_approve",
] as const;

export type K14ActionId = (typeof K14_FINANCE_ACTION_IDS)[number];
export type K14ExecutionGate = "inline" | "write_safety" | "confirmation" | "job";
export interface K14BackendRoute {
  method: ComvenioHttpMethod;
  service: "finance";
  normalized_path_template: string;
  purpose: "read" | "mutation" | "preflight" | "job_input";
}
export interface K14OperationDefinition {
  operation: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_gate: K14ExecutionGate;
  backend_routes: readonly K14BackendRoute[];
  external_effect: "none" | "comvenio_private" | "comvenio_public";
}
export interface K14ActionDefinition {
  action_id: K14ActionId;
  domain: "finance";
  source_action: string;
  source_path: "src/commands/finance.ts";
  operations: Readonly<Record<string, K14OperationDefinition>>;
  publication_state: "implemented";
  blocker: null;
}
export interface K14ActionSchemaContract { input: z.ZodType; output: z.ZodType; }
export interface K14ExecutionRequest { action_id: K14ActionId; input: unknown; context: RequestContext; capability_snapshot: CapabilitySnapshot | null; }
export interface K14MutationRequest { definition: K14ActionDefinition; operation: K14OperationDefinition; input: JsonValue; context: RequestContext; capability_snapshot: CapabilitySnapshot; }
export interface K14WriteSafetyPort { execute(request: K14MutationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>; }
export interface K14ConfirmationPort {
  confirmOrPreview(request: { mutation: K14MutationRequest; subject: string; summary: string; effects: JsonValue[]; confirmation: { preview_id: string; confirmation_token: string } | null }, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}
export interface K14ExecutionDependencies {
  client: ComvenioApiClient;
  write_safety?: K14WriteSafetyPort;
  confirmation?: K14ConfirmationPort;
  on_backend_forbidden?: (input: { action_id: K14ActionId; operation: string; context: RequestContext }) => void | Promise<void>;
}
export interface K14ActionResult extends Record<string, JsonValue> {
  action_id: K14ActionId;
  operation: string;
  status: "completed" | "confirmation_required";
  result: JsonValue;
}
