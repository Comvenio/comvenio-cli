import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { JsonValue, OAuthScope, RequestContext } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";
import type { z } from "zod";

export const K12_HOMEPAGE_ACTION_IDS = ["cai.homepage.01.preview", "cai.homepage.02.apply", "cai.homepage.03.show"] as const;
export const K12_SCHEMA_ACTION_IDS = ["cai.schema.01.list_domains", "cai.schema.02.show_domain_schema"] as const;
export const K12_VERIFY_ACTION_IDS = ["cai.verify.01.url", "cai.verify.02.event", "cai.verify.03.menu", "cai.verify.04.homepage", "cai.verify.05.news", "cai.verify.06.certificate"] as const;
export const K12_DATA_ACTION_IDS = [
  "cai.data.01.list", "cai.data.02.show", "cai.data.03.update", "cai.data.04.url", "cai.data.05.download", "cai.data.06.upload",
  "cai.data.07.delete", "cai.data.08.restore", "cai.data.09.move", "cai.data.10.visibility", "cai.data.11.stats", "cai.data.12.empty_trash",
  "cai.data.13.area_media", "cai.data.14.area_shares", "cai.data.15.area_share_add", "cai.data.16.area_share_remove", "cai.data.17.children",
  "cai.data.18.search", "cai.data.19.breadcrumb", "cai.data.20.folder_create", "cai.data.21.folder_rename", "cai.data.22.folder_move",
  "cai.data.23.folder_protect", "cai.data.24.folder_delete", "cai.data.25.folder_restore", "cai.data.26.folder_rights",
  "cai.data.27.folder_right_add", "cai.data.28.folder_right_bulk", "cai.data.29.folder_right_delete", "cai.data.30.papers",
  "cai.data.31.paper_show", "cai.data.32.paper_add", "cai.data.33.paper_update", "cai.data.34.paper_delete", "cai.data.35.export_members_bookings",
] as const;
export const K12_NEWS_ACTION_IDS = [
  "cai.news.01.list", "cai.news.02.show", "cai.news.03.create", "cai.news.04.update", "cai.news.05.delete", "cai.news.06.apply",
  "cai.news.07.preview", "cai.news.08.publish", "cai.news.09.video_slideshow_result_teaser",
] as const;
export const K12_ACTION_IDS = [...K12_HOMEPAGE_ACTION_IDS, ...K12_SCHEMA_ACTION_IDS, ...K12_VERIFY_ACTION_IDS, ...K12_DATA_ACTION_IDS, ...K12_NEWS_ACTION_IDS] as const;

export type K12ActionId = (typeof K12_ACTION_IDS)[number];
export type K12Domain = "homepage" | "schema" | "verify" | "data" | "news";
export type K12ExecutionGate = "inline" | "write_safety" | "confirmation" | "job" | "confirmed_job";
export interface K12BackendRoute {
  method: ComvenioHttpMethod;
  service: "club" | "content" | "member" | "object" | "frontend" | "connector";
  normalized_path_template: string;
  purpose: "read" | "mutation" | "preflight" | "job_input";
}
export interface K12OperationDefinition {
  operation: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_gate: K12ExecutionGate;
  backend_routes: readonly K12BackendRoute[];
  external_effect: "none" | "comvenio_private" | "comvenio_public" | "third_party";
}
export interface K12ActionDefinition {
  action_id: K12ActionId;
  domain: K12Domain;
  source_action: string;
  source_path: string;
  operations: Readonly<Record<string, K12OperationDefinition>>;
  publication_state: "implemented" | "blocked";
  blocker: string | null;
  coverage_status: "covered" | "core-partial";
}
export interface K12ActionSchemaContract { input: z.ZodType; output: z.ZodType; }
export interface K12ExecutionRequest { action_id: K12ActionId; input: unknown; context: RequestContext; capability_snapshot: CapabilitySnapshot | null; }
export interface K12MutationRequest { definition: K12ActionDefinition; operation: K12OperationDefinition; input: JsonValue; context: RequestContext; capability_snapshot: CapabilitySnapshot; }
export interface K12WriteSafetyPort { execute(request: K12MutationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue>; }
export interface K12JobStartPort { start(request: K12MutationRequest): Promise<JsonValue>; }
export interface K12VerifyTargetGuard { assertSafe(targetUrl: string, context: RequestContext): Promise<void>; }
export interface K12ConfirmationPort {
  confirmOrPreview(request: {
    mutation: K12MutationRequest;
    subject: string;
    summary: string;
    effects: JsonValue[];
    confirmation: { preview_id: string; confirmation_token: string } | null;
  }, mutation: () => Promise<JsonValue>): Promise<JsonValue>;
}
export interface K12ExecutionDependencies {
  client: ComvenioApiClient;
  write_safety?: K12WriteSafetyPort;
  job_starter?: K12JobStartPort;
  confirmation?: K12ConfirmationPort;
  verify_target_guard?: K12VerifyTargetGuard;
  on_backend_forbidden?: (input: { action_id: K12ActionId; operation: string; context: RequestContext }) => void | Promise<void>;
}
export interface K12ActionResult extends Record<string, JsonValue> {
  action_id: K12ActionId;
  operation: string;
  status: "completed" | "confirmation_required" | "queued";
  result: JsonValue;
}
