import type {
  OAuthScope,
  JsonValue,
  ProviderNeutralResult,
  RequestContext,
  UUID,
} from "@comvenio/connector-contracts";

export type CapabilityKey = string;
export type CapabilityVersion = string;
export type CapabilityCacheState =
  | "HIT"
  | "MISS_RELOADED"
  | "EXPIRED_RELOADED"
  | "VERSION_STALE_RELOADED"
  | "WRITE_RECHECK";
export type ProviderToolUpdateMode = "dynamic" | "stable_cached";

export interface ConnectorPermissionSource {
  permission_key: CapabilityKey;
  allowed: boolean;
  scope: "club" | "department";
  department_id: UUID | null;
  assignment_type: "direct" | "position";
}

export interface ConnectorEffectivePermissionRead {
  member_id: UUID;
  club_id: UUID;
  department_ids: UUID[];
  permissions: Record<CapabilityKey, boolean>;
  sources: ConnectorPermissionSource[];
  capability_version: CapabilityVersion;
  generated_at: string;
}

export interface CapabilitySnapshot extends ConnectorEffectivePermissionRead {
  subject_id: UUID;
  observed_at: string;
  expires_at: string;
}

export interface EffectivePermissionSelfRequest {
  request_id: UUID;
  subject_id: UUID;
  club_id: UUID;
  department_id: UUID | null;
}

export interface EffectivePermissionSelfPort {
  readSelf(request: EffectivePermissionSelfRequest): Promise<unknown>;
}

export interface CapabilityCacheResult {
  snapshot: CapabilitySnapshot;
  state: CapabilityCacheState;
}

export interface PermissionPolicyInput {
  all_of: readonly CapabilityKey[];
  any_of: readonly CapabilityKey[];
  owner_or_self_allowed: boolean;
  department_scope: "forbidden" | "optional" | "required";
}

export interface ToolVisibilitySubject {
  tool_name: string;
  required_scopes: readonly OAuthScope[];
  permission_policy: PermissionPolicyInput;
  is_public: boolean;
}

export type ToolVisibilityReason =
  | "VISIBLE"
  | "NOT_IN_CATALOG"
  | "SCOPE_REQUIRED"
  | "CONTEXT_MISSING"
  | "VERSION_STALE"
  | "TENANT_MISMATCH"
  | "DEPARTMENT_MISMATCH"
  | "PERMISSION_REQUIRED"
  | "PROVIDER_STATIC_TOOLSET";

export interface ToolVisibilityDecision {
  visible: boolean;
  authorized: boolean;
  reason: ToolVisibilityReason;
}

export interface ToolVisibilityInput {
  tool: ToolVisibilitySubject;
  context: RequestContext;
  snapshot: CapabilitySnapshot | null;
  provider_tool_updates: ProviderToolUpdateMode;
  catalog_contains_tool: boolean;
}

export interface PermissionsExplainInput {
  club_id: UUID;
  department_id?: UUID;
}

export interface PermissionsExplainSource extends Record<string, JsonValue> {
  permission_key: CapabilityKey;
  allowed: boolean;
  scope: "club" | "department";
  department_id: UUID | null;
  assignment_type: "direct" | "position";
}

export interface PermissionsExplainOutput extends Record<string, JsonValue> {
  club_id: UUID;
  department_ids: UUID[];
  capability_version: CapabilityVersion;
  generated_at: string;
  allowed_capabilities: CapabilityKey[];
  denied_capabilities: CapabilityKey[];
  sources: PermissionsExplainSource[];
}

export type PermissionsExplainResult = ProviderNeutralResult<PermissionsExplainOutput>;
