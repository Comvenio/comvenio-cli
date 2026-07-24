import type {
  JsonPrimitive,
  JsonValue,
  OAuthScope,
  RequestContext,
} from "@comvenio/connector-contracts";
import type {
  CapabilitySnapshot,
  ProviderToolUpdateMode,
} from "@comvenio/auth";
import type {
  ComvenioApiClient,
  ComvenioHttpMethod,
} from "@comvenio/comvenio-client";
import type { GeneratedToolContractMap } from "../generated/index.ts";

export type ActionRisk = "read" | "reversible_write" | "critical_write";
export type ExecutionMode = "inline" | "async_job";
export type ExternalEffect = "none" | "comvenio_private" | "comvenio_public" | "third_party";
export type IdempotencyMode = "read" | "key_required" | "not_retryable";
export type ConfirmationMode = "none" | "required";
export type DepartmentScope = "forbidden" | "optional" | "required";
export type MigrationState = "DISCOVERED" | "AUDITED" | "BLOCKED" | "PUBLISHED";
export type ToolName = keyof GeneratedToolContractMap;
export type ToolCatalogInput<N extends ToolName> = GeneratedToolContractMap[N]["input"];
export type ToolCatalogOutput<N extends ToolName> = GeneratedToolContractMap[N]["output"];

export interface PermissionPolicy {
  all_of: string[];
  any_of: string[];
  owner_or_self_allowed: boolean;
  department_scope: DepartmentScope;
  backend_audit_refs: string[];
}

export interface OperationDefinition {
  operation_id: string;
  domain: string;
  legacy_action_id: string;
  source_branch_locators: string[];
  shared_handler_ref: string;
  route_trace_fixture_ref: string;
  input_schema_ref: string;
  output_schema_ref: string;
  required_scopes: OAuthScope[];
  permission_policy: PermissionPolicy;
  risk_class: ActionRisk;
  execution_mode: ExecutionMode;
  external_effect: ExternalEffect;
  idempotency: IdempotencyMode;
  confirmation: ConfirmationMode;
}

export interface ProviderToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  tool_name: string;
  tool_group_key_sha256: string;
  title: string;
  description: string;
  copy_fixture_ref: string;
  operation_ids: string[];
  required_scopes: OAuthScope[];
  risk_class: ActionRisk;
  execution_mode: ExecutionMode;
  idempotency: IdempotencyMode;
  confirmation: ConfirmationMode;
  permission_policy: PermissionPolicy;
  external_effect: ExternalEffect;
  input_schema_ref: string;
  output_schema_ref: string;
  annotations: ProviderToolAnnotations;
}

export interface RouteTraceRequestMatcher {
  path_parameters: Record<string, JsonPrimitive>;
  query_parameters: Record<string, string | string[]>;
  authorization: "absent" | "fixture_bearer_required";
  content_type: string | null;
  idempotency_key: "absent" | "fixture_uuid_required";
  body_fixture_ref: string | null;
  body_match: "exact_rfc8785";
}

export interface RouteTraceStep {
  sequence: number;
  http_method: ComvenioHttpMethod;
  service: string;
  normalized_path_template: string;
  request_matcher: RouteTraceRequestMatcher;
  request_schema_ref: string | null;
  response_status: number;
  response_fixture_ref: string;
  error_response_fixture_refs: string[];
  response_schema_ref: string;
}

export interface RouteTraceFixture {
  contract_version: "1.0.0";
  operation_id: string;
  source_branch_locators: string[];
  operation_input_fixture_ref: string;
  fixture_clock: string;
  fixture_ids_ref: string;
  execution_client: "FailClosedRecordingComvenioClient";
  steps: RouteTraceStep[];
  terminal_output_schema_ref: string;
}

export interface BackendRoutePermissionAuditEntry {
  audit_id: string;
  service: string;
  http_method: ComvenioHttpMethod;
  normalized_path_template: string;
  backend_function: string;
  source_locator: string;
  authentication: "public" | "jwt" | "internal";
  permission_policy: PermissionPolicy;
  classification: "classified";
}

export interface BackendRoutePermissionAudit {
  contract_version: "1.0.0";
  backend_source_hash_sha256: string;
  entries: BackendRoutePermissionAuditEntry[];
  unclassified_count: 0;
}

export interface CliBinding {
  operation_id: string;
  command_expression: string;
  argument_mapper_ref: string;
  renderer_ref: string;
  compatibility_fixture_ref: string;
}

export interface McpBinding {
  operation_id: string;
  tool_name: string;
  operation_discriminator: string;
  widget_resource_uri: string | null;
}

export interface ToolCatalogSnapshot {
  contract_version: "1.0.0";
  source_hash_sha256: string;
  operations: OperationDefinition[];
  tools: ToolDefinition[];
  cli_bindings: CliBinding[];
  mcp_bindings: McpBinding[];
}

export interface ParityReport {
  action_inventory_version: string;
  operation_catalog_version: string;
  legacy_actions_total: 303;
  covered_action_ids: string[];
  oauth_lifecycle_replacements: string[];
  missing_action_ids: string[];
  extra_operation_ids: string[];
  status: "pass" | "fail";
}

export interface CopyFixture {
  group_key_sha256: string;
  fixture_ref: string;
  title: string;
  description: string;
}

export interface OperationBindingMetadata {
  operation_id: string;
  command_expression: string;
  argument_mapper_ref: string;
  renderer_ref: string;
  compatibility_fixture_ref: string;
  operation_discriminator: string;
  widget_resource_uri: string | null;
}

export interface JsonSchemaDocument {
  $id?: string;
  $schema?: string;
  [key: string]: JsonValue | undefined;
}

export interface SchemaRegistry {
  get(schemaRef: string): JsonSchemaDocument | undefined;
}

export interface FixtureStore {
  get(fixtureRef: string): JsonValue | undefined;
}

export interface RouteTraceRegistry {
  get(routeTraceFixtureRef: string): RouteTraceFixture | undefined;
}

export interface SharedHandlerDependencies {
  client: ComvenioApiClient;
  context: RequestContext;
  now(): string;
  fixture_ids: Readonly<Record<string, JsonPrimitive>>;
}

export type SharedOperationHandler = (
  input: JsonValue,
  dependencies: SharedHandlerDependencies,
) => Promise<JsonValue>;

export interface SharedHandlerRegistry {
  get(handlerRef: string): SharedOperationHandler | undefined;
}

export interface LegacyActionInventoryEntry {
  id: string;
  domain: string;
  coverage_status: string;
  source_action: string;
  delivery: string;
  risk_class: ActionRisk;
  execution_mode: ExecutionMode;
  oauth_scope: OAuthScope;
  source_paths: string[];
  schema_source: string;
  route_contract: string;
  backend_capability: string;
}

export interface LegacyActionInventory {
  contract_version: string;
  source_registry_version: string;
  source_cli_version: string;
  verified_at: string;
  entry_count: number;
  domain_count: number;
  entries: LegacyActionInventoryEntry[];
}

export interface RouteInventoryEntry {
  id: string;
  source_locator: string;
  http_method: ComvenioHttpMethod;
  client_method: string;
  service: string;
  path_expression: string;
  path_kind: string;
}

export interface RouteInventory {
  contract_version: string;
  source_cli_version: string;
  verified_at: string;
  entry_count: number;
  semantics: {
    inventory_only: true;
    source_hash_sha256: string;
    [key: string]: JsonValue;
  };
  routes: RouteInventoryEntry[];
}

export interface MigrationCoverageEntry {
  legacy_action_id: string;
  domain: string;
  state: "DISCOVERED";
  published: false;
  candidate_operation_ids: string[];
  blockers: string[];
}

export interface OAuthLifecycleReplacement {
  legacy_action_id: string;
  replacement: "oauth_connect" | "oauth_disconnect";
}

export interface MigrationCoverageSnapshot {
  contract_version: "1.0.0";
  action_inventory_version: string;
  legacy_actions_total: 303;
  discovered_candidates: MigrationCoverageEntry[];
  oauth_lifecycle_replacements: OAuthLifecycleReplacement[];
}

export interface VirtualToolContract {
  tool_name: string;
  title: string;
  description: string;
  risk_class: ActionRisk;
  permission: string;
  oauth_scopes: OAuthScope[];
  input_schema_ref: string;
  output_schema_ref: string;
  annotations: ProviderToolAnnotations;
}

export interface ProviderToolContract {
  contract_version: "1.0.0";
  current_cli_action_count: 303;
  current_cli_callsite_count: 572;
  expected_virtual_tool_count: 8;
  max_tool_name_length: 64;
  virtual_tools: VirtualToolContract[];
}

export interface InventoryManifest {
  contract_version: "1.0.0";
  generated_at_source_date: string;
  action_count: 303;
  domain_count: 26;
  route_callsite_count: 572;
  virtual_tool_count: 8;
  source_sha256: {
    actions: string;
    routes: string;
    provider_tools: string;
    backend_rbac_audit: string;
  };
}

export interface BackendPermissionAuditDraft {
  contract_version: "1.0.0";
  classification_status: "migration_required";
  backend_source_hash_sha256: string;
  source_audit_entry_count: number;
  entries: [];
  unclassified_count: 572;
  notice: string;
}

export interface ToolCatalogVisibilityContext {
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
  provider_tool_updates: ProviderToolUpdateMode;
}

export interface CatalogCallRequest {
  tool_name: string;
  operation_id: string;
  club_id: string | null;
}
