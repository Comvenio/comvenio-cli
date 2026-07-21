import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, OAuthScope, RequestContext } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";
import type { z } from "zod";

export const K13_SPONSOR_ACTION_IDS = [
  "cai.sponsor.01.list", "cai.sponsor.02.show", "cai.sponsor.03.add", "cai.sponsor.04.update",
  "cai.sponsor.05.delete", "cai.sponsor.06.logo", "cai.sponsor.07.product_list", "cai.sponsor.08.product_add",
  "cai.sponsor.09.product_update", "cai.sponsor.10.product_delete", "cai.sponsor.11.contract_list", "cai.sponsor.12.contract_add",
  "cai.sponsor.13.contract_update", "cai.sponsor.14.contract_delete", "cai.sponsor.15.assignment_list", "cai.sponsor.16.assign",
  "cai.sponsor.17.assignment_update", "cai.sponsor.18.cancel", "cai.sponsor.19.doc_list", "cai.sponsor.20.doc_upload",
  "cai.sponsor.21.responsible_list", "cai.sponsor.22.responsible_add", "cai.sponsor.23.responsible_update", "cai.sponsor.24.responsible_remove",
] as const;

export type K13ActionId = (typeof K13_SPONSOR_ACTION_IDS)[number];
export type K13ExecutionGate = "inline" | "write_safety" | "confirmation" | "job";
export interface K13BackendRoute {
  method: ComvenioHttpMethod;
  service: "marketing" | "content" | "connector";
  normalized_path_template: string;
  purpose: "read" | "mutation" | "preflight" | "job_input";
}
export interface K13OperationDefinition {
  operation: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_gate: K13ExecutionGate;
  backend_routes: readonly K13BackendRoute[];
  external_effect: "none" | "comvenio_private" | "comvenio_public";
}
export interface K13ActionDefinition {
  action_id: K13ActionId;
  domain: "sponsor";
  source_action: string;
  source_path: "src/commands/sponsor.ts";
  operations: Readonly<Record<string, K13OperationDefinition>>;
  publication_state: "implemented";
  blocker: null;
}
export interface K13ActionSchemaContract { input: z.ZodType; output: z.ZodType; }
export interface K13ExecutionRequest { action_id: K13ActionId; input: unknown; context: RequestContext; capability_snapshot: CapabilitySnapshot | null; }
export interface K13MutationRequest { definition: K13ActionDefinition; operation: K13OperationDefinition; input: JsonValue; context: RequestContext; capability_snapshot: CapabilitySnapshot; }
export interface K13WriteSafetyPort { execute(request: K13MutationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>; }
export interface K13JobStartPort { start(request: K13MutationRequest): Promise<JsonValue>; }
export interface K13ConfirmationPort {
  confirmOrPreview(request: { mutation: K13MutationRequest; subject: string; summary: string; effects: JsonValue[]; confirmation: { preview_id: string; confirmation_token: string } | null }, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}
export interface K13ExecutionDependencies {
  client: ComvenioApiClient;
  write_safety?: K13WriteSafetyPort;
  job_starter?: K13JobStartPort;
  confirmation?: K13ConfirmationPort;
  on_backend_forbidden?: (input: { action_id: K13ActionId; operation: string; context: RequestContext }) => void | Promise<void>;
}
export interface K13ActionResult extends Record<string, JsonValue> {
  action_id: K13ActionId;
  operation: string;
  status: "completed" | "confirmation_required" | "queued";
  result: JsonValue;
}
