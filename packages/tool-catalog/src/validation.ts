import { createHash } from "node:crypto";

import {
  OAUTH_SCOPE_VALUES,
  type JsonValue,
  type OAuthScope,
} from "@comvenio/connector-contracts";

import type {
  BackendRoutePermissionAudit,
  JsonSchemaDocument,
  OperationDefinition,
  PermissionPolicy,
  ProviderToolAnnotations,
  SchemaRegistry,
  ToolDefinition,
} from "./types.ts";

const OAUTH_SCOPES = new Set<string>(OAUTH_SCOPE_VALUES);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/u;
const FORBIDDEN_DISPATCH_NAMES = /(?:generic.?api.?request|run_cli_command|shell|api_request)/iu;

export type CatalogContractErrorCode =
  | "CATALOG_INVALID"
  | "SCHEMA_INVALID"
  | "PERMISSION_AUDIT_INVALID"
  | "ROUTE_TRACE_MISMATCH"
  | "TOOL_NOT_FOUND"
  | "TOOL_NOT_VISIBLE"
  | "TENANT_MISMATCH";

export class CatalogContractError extends Error {
  readonly code: CatalogContractErrorCode;

  constructor(code: CatalogContractErrorCode, message: string) {
    super(message);
    this.name = "CatalogContractError";
    this.code = code;
  }
}

export function assertCatalog(
  condition: unknown,
  message: string,
  code: CatalogContractErrorCode = "CATALOG_INVALID",
): asserts condition {
  if (!condition) throw new CatalogContractError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : isPlainObject(value) && Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assertCatalog(Number.isFinite(value), "Nicht-endliche Zahlen sind in JCS unzulässig.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function assertSortedUnique(values: readonly string[], field: string): void {
  assertCatalog(
    JSON.stringify(values) === JSON.stringify(sortedUnique(values)),
    `${field} muss lexikografisch sortiert und eindeutig sein.`,
  );
}

function assertNonEmptyStrings(values: readonly string[], field: string): void {
  assertCatalog(values.length > 0, `${field} darf nicht leer sein.`);
  assertCatalog(values.every((value) => typeof value === "string" && value.trim() === value && value.length > 0),
    `${field} enthält einen ungültigen Wert.`);
}

export function normalizePermissionPolicy(policy: PermissionPolicy): PermissionPolicy {
  return {
    all_of: sortedUnique(policy.all_of),
    any_of: sortedUnique(policy.any_of),
    owner_or_self_allowed: policy.owner_or_self_allowed,
    department_scope: policy.department_scope,
    backend_audit_refs: sortedUnique(policy.backend_audit_refs),
  };
}

export function validatePermissionPolicy(
  policy: PermissionPolicy,
  allowedPermissionKeys?: ReadonlySet<string>,
): PermissionPolicy {
  assertCatalog(isPlainObject(policy), "PermissionPolicy fehlt.");
  assertSortedUnique(policy.all_of, "permission_policy.all_of");
  assertSortedUnique(policy.any_of, "permission_policy.any_of");
  assertNonEmptyStrings(policy.backend_audit_refs, "permission_policy.backend_audit_refs");
  assertSortedUnique(policy.backend_audit_refs, "permission_policy.backend_audit_refs");
  assertCatalog(
    ["forbidden", "optional", "required"].includes(policy.department_scope),
    "permission_policy.department_scope ist ungültig.",
  );
  const keys = [...policy.all_of, ...policy.any_of];
  if (allowedPermissionKeys) {
    assertCatalog(keys.every((key) => allowedPermissionKeys.has(key)),
      "PermissionPolicy enthält einen nicht autoritativen Permission-Key.");
  }
  const publicAudit = policy.backend_audit_refs.some((ref) => /public/iu.test(ref));
  assertCatalog(
    keys.length > 0 || policy.owner_or_self_allowed || publicAudit,
    "Leere Permission-Ausdrücke benötigen einen Public- oder Owner-/Self-Audit.",
  );
  return policy;
}

export function deriveAnnotations(operation: OperationDefinition): ProviderToolAnnotations {
  return {
    readOnlyHint: operation.risk_class === "read",
    destructiveHint: operation.risk_class === "critical_write",
    idempotentHint: operation.idempotency === "read" || operation.idempotency === "key_required",
    openWorldHint: operation.external_effect === "comvenio_public"
      || operation.external_effect === "third_party",
  };
}

function assertRequiredClubIdSchema(schema: JsonSchemaDocument, operationId: string): void {
  const required = schema.required;
  const properties = schema.properties;
  assertCatalog(Array.isArray(required) && required.includes("club_id"),
    `${operationId}: Private Operation benötigt club_id als Pflichtfeld.`, "SCHEMA_INVALID");
  assertCatalog(isPlainObject(properties) && isPlainObject(properties.club_id),
    `${operationId}: club_id-Schema fehlt.`, "SCHEMA_INVALID");
  const clubSchema = properties.club_id;
  assertCatalog(clubSchema.type === "string" && clubSchema.format === "uuid",
    `${operationId}: club_id muss ein UUID-String sein.`, "SCHEMA_INVALID");
}

function inspectSchemaNode(value: unknown, path: string): void {
  assertCatalog(isJsonValue(value), `${path}: Schema ist kein JSON-Wert.`, "SCHEMA_INVALID");
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectSchemaNode(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  const keys = Object.keys(value);
  assertCatalog(keys.length > 0, `${path}: Leere Schema-Escape-Hatches sind verboten.`, "SCHEMA_INVALID");
  assertCatalog(value.additionalProperties !== true,
    `${path}: additionalProperties=true ist verboten.`, "SCHEMA_INVALID");
  if (value.type === "object" || "properties" in value) {
    assertCatalog(value.additionalProperties === false,
      `${path}: Objektschemas müssen additionalProperties=false setzen.`, "SCHEMA_INVALID");
    assertCatalog(isPlainObject(value.properties), `${path}: properties fehlt.`, "SCHEMA_INVALID");
  }
  for (const [key, child] of Object.entries(value)) {
    if (["properties", "$defs", "definitions"].includes(key) && isPlainObject(child)) {
      for (const [childKey, nested] of Object.entries(child)) {
        inspectSchemaNode(nested, `${path}.${key}.${childKey}`);
      }
    } else if (["oneOf", "anyOf", "allOf", "items", "not"].includes(key)) {
      inspectSchemaNode(child, `${path}.${key}`);
    }
  }
}

export function validateJsonSchema(schema: JsonSchemaDocument, schemaRef: string): JsonSchemaDocument {
  inspectSchemaNode(schema, schemaRef);
  return schema;
}

function matchesType(value: JsonValue, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

export function assertMatchesJsonSchema(
  value: JsonValue,
  schema: JsonSchemaDocument,
  schemaRef = schema.$id ?? "schema",
): void {
  validateJsonSchema(schema, schemaRef);
  if (schema.const !== undefined) {
    assertCatalog(canonicalJson(value) === canonicalJson(schema.const as JsonValue),
      `${schemaRef}: Wert entspricht nicht const.`, "SCHEMA_INVALID");
  }
  if (Array.isArray(schema.enum)) {
    assertCatalog(schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(value)),
      `${schemaRef}: Wert ist nicht Teil des Enums.`, "SCHEMA_INVALID");
  }
  if (typeof schema.type === "string") {
    assertCatalog(matchesType(value, schema.type), `${schemaRef}: Typ stimmt nicht überein.`, "SCHEMA_INVALID");
  }
  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    for (const branch of schema.oneOf) {
      try {
        assertMatchesJsonSchema(value, branch as JsonSchemaDocument, `${schemaRef}.oneOf`);
        matches++;
      } catch (error) {
        if (!(error instanceof CatalogContractError)) throw error;
      }
    }
    assertCatalog(matches === 1, `${schemaRef}: oneOf muss genau einmal passen.`, "SCHEMA_INVALID");
  }
  if (Array.isArray(value) && isPlainObject(schema.items)) {
    value.forEach((entry, index) =>
      assertMatchesJsonSchema(entry, schema.items as JsonSchemaDocument, `${schemaRef}[${index}]`));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [];
    for (const key of required) {
      assertCatalog(Object.hasOwn(value, key), `${schemaRef}: Pflichtfeld ${key} fehlt.`, "SCHEMA_INVALID");
    }
    if (schema.additionalProperties === false) {
      assertCatalog(Object.keys(value).every((key) => Object.hasOwn(properties, key)),
        `${schemaRef}: Unbekanntes Objektfeld.`, "SCHEMA_INVALID");
    }
    for (const [key, entry] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (isPlainObject(propertySchema)) {
        assertMatchesJsonSchema(entry, propertySchema as JsonSchemaDocument, `${schemaRef}.${key}`);
      }
    }
  }
}

export function validateOperationDefinition(
  operation: OperationDefinition,
  schemas: SchemaRegistry,
  allowedPermissionKeys?: ReadonlySet<string>,
): OperationDefinition {
  assertCatalog(IDENTIFIER_PATTERN.test(operation.operation_id),
    `${operation.operation_id || "Operation"}: operation_id ist ungültig.`);
  assertCatalog(IDENTIFIER_PATTERN.test(operation.domain), `${operation.operation_id}: domain ist ungültig.`);
  assertCatalog(operation.legacy_action_id.length > 0, `${operation.operation_id}: legacy_action_id fehlt.`);
  assertNonEmptyStrings(operation.source_branch_locators, `${operation.operation_id}.source_branch_locators`);
  assertCatalog(operation.shared_handler_ref.length > 0 && !FORBIDDEN_DISPATCH_NAMES.test(operation.shared_handler_ref),
    `${operation.operation_id}: shared_handler_ref ist unsicher.`);
  assertCatalog(operation.route_trace_fixture_ref.length > 0,
    `${operation.operation_id}: route_trace_fixture_ref fehlt.`);
  assertCatalog(operation.required_scopes.length > 0,
    `${operation.operation_id}: required_scopes fehlt.`);
  assertSortedUnique(operation.required_scopes, `${operation.operation_id}.required_scopes`);
  assertCatalog(operation.required_scopes.every((scope) => OAUTH_SCOPES.has(scope)),
    `${operation.operation_id}: unbekannter OAuth-Scope.`);
  validatePermissionPolicy(operation.permission_policy, allowedPermissionKeys);
  assertCatalog(["read", "reversible_write", "critical_write"].includes(operation.risk_class),
    `${operation.operation_id}: risk_class ist ungültig.`);
  assertCatalog(["inline", "async_job"].includes(operation.execution_mode),
    `${operation.operation_id}: execution_mode ist ungültig.`);
  assertCatalog(["none", "comvenio_private", "comvenio_public", "third_party"].includes(operation.external_effect),
    `${operation.operation_id}: external_effect ist ungültig.`);
  assertCatalog(["read", "key_required", "not_retryable"].includes(operation.idempotency),
    `${operation.operation_id}: idempotency ist ungültig.`);
  assertCatalog(["none", "required"].includes(operation.confirmation),
    `${operation.operation_id}: confirmation ist ungültig.`);
  if (operation.risk_class === "read") {
    assertCatalog(operation.idempotency === "read" && operation.confirmation === "none",
      `${operation.operation_id}: Reads müssen idempotency=read und confirmation=none verwenden.`);
  } else {
    assertCatalog(operation.idempotency !== "read",
      `${operation.operation_id}: Writes dürfen idempotency=read nicht verwenden.`);
  }
  if (operation.risk_class === "critical_write") {
    assertCatalog(operation.confirmation === "required",
      `${operation.operation_id}: Kritische Writes benötigen eine Bestätigung.`);
  }
  if (operation.external_effect === "comvenio_public" && operation.risk_class !== "read") {
    assertCatalog(operation.risk_class === "critical_write" && operation.confirmation === "required",
      `${operation.operation_id}: Öffentliche Statusänderungen müssen kritisch und bestätigt sein.`);
  }

  const inputSchema = schemas.get(operation.input_schema_ref);
  const outputSchema = schemas.get(operation.output_schema_ref);
  assertCatalog(inputSchema, `${operation.operation_id}: Input-Schema fehlt.`, "SCHEMA_INVALID");
  assertCatalog(outputSchema, `${operation.operation_id}: Output-Schema fehlt.`, "SCHEMA_INVALID");
  validateJsonSchema(inputSchema, operation.input_schema_ref);
  validateJsonSchema(outputSchema, operation.output_schema_ref);
  const isPrivate = !operation.required_scopes.every((scope) => scope === "public.read")
    || operation.external_effect === "comvenio_private";
  if (isPrivate) assertRequiredClubIdSchema(inputSchema, operation.operation_id);
  return operation;
}

export function validateToolDefinition(tool: ToolDefinition): ToolDefinition {
  assertCatalog(TOOL_NAME_PATTERN.test(tool.tool_name) && tool.tool_name.length <= 64,
    `${tool.tool_name}: Toolname muss ASCII-konform und höchstens 64 Zeichen lang sein.`);
  assertCatalog(!FORBIDDEN_DISPATCH_NAMES.test(tool.tool_name), `${tool.tool_name}: generisches Tool ist verboten.`);
  assertCatalog(SHA256_PATTERN.test(tool.tool_group_key_sha256), `${tool.tool_name}: Gruppenhash ist ungültig.`);
  assertCatalog(tool.title.trim().length > 0 && tool.description.trim().length > 0,
    `${tool.tool_name}: Titel und Beschreibung sind Pflicht.`);
  assertNonEmptyStrings(tool.operation_ids, `${tool.tool_name}.operation_ids`);
  assertSortedUnique(tool.operation_ids, `${tool.tool_name}.operation_ids`);
  assertSortedUnique(tool.required_scopes, `${tool.tool_name}.required_scopes`);
  validatePermissionPolicy(tool.permission_policy);
  return tool;
}

export function validateBackendRoutePermissionAudit(
  audit: BackendRoutePermissionAudit,
  allowedPermissionKeys: ReadonlySet<string>,
): BackendRoutePermissionAudit {
  assertCatalog(audit.contract_version === "1.0.0", "Backend-Audit-Version ist ungültig.",
    "PERMISSION_AUDIT_INVALID");
  assertCatalog(SHA256_PATTERN.test(audit.backend_source_hash_sha256),
    "Backend-Audit-Source-Hash ist ungültig.", "PERMISSION_AUDIT_INVALID");
  assertCatalog(audit.unclassified_count === 0,
    "Backend-Audit enthält unklassifizierte Routen.", "PERMISSION_AUDIT_INVALID");
  const ids = new Set<string>();
  for (const entry of audit.entries) {
    assertCatalog(!ids.has(entry.audit_id), `Doppelter Backend-Audit ${entry.audit_id}.`,
      "PERMISSION_AUDIT_INVALID");
    ids.add(entry.audit_id);
    assertCatalog(entry.classification === "classified", `${entry.audit_id}: Route ist unklassifiziert.`,
      "PERMISSION_AUDIT_INVALID");
    assertCatalog(entry.authentication !== "internal", `${entry.audit_id}: Interne Route darf nicht publiziert werden.`,
      "PERMISSION_AUDIT_INVALID");
    validatePermissionPolicy(entry.permission_policy, allowedPermissionKeys);
  }
  return audit;
}

export function permissionPolicyFingerprint(policy: PermissionPolicy): string {
  const normalized = normalizePermissionPolicy(policy);
  return canonicalJson(normalized as unknown as JsonValue);
}
