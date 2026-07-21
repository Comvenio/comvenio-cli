import type { JsonValue } from "@comvenio/connector-contracts";

import type {
  BackendRoutePermissionAudit,
  BackendRoutePermissionAuditEntry,
  FixtureStore,
  OperationDefinition,
  RouteTraceFixture,
  SchemaRegistry,
} from "./types.ts";
import {
  assertCatalog,
  permissionPolicyFingerprint,
  validateJsonSchema,
} from "./validation.ts";

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function routeKey(
  service: string,
  method: string,
  path: string,
): string {
  return `${service}:${method}:${path}`;
}

export function validateRouteTraceFixture(
  operation: OperationDefinition,
  fixture: RouteTraceFixture,
  fixtures: FixtureStore,
  schemas: SchemaRegistry,
): RouteTraceFixture {
  assertCatalog(fixture.contract_version === "1.0.0",
    `${operation.operation_id}: Route-Trace-Version ist ungültig.`, "ROUTE_TRACE_MISMATCH");
  assertCatalog(fixture.operation_id === operation.operation_id,
    `${operation.operation_id}: Route-Trace gehört zu einer anderen Operation.`, "ROUTE_TRACE_MISMATCH");
  assertCatalog(fixture.execution_client === "FailClosedRecordingComvenioClient",
    `${operation.operation_id}: Route-Trace muss fail-closed ausgeführt werden.`, "ROUTE_TRACE_MISMATCH");
  assertCatalog(
    JSON.stringify(sortedUnique(fixture.source_branch_locators))
      === JSON.stringify(sortedUnique(operation.source_branch_locators)),
    `${operation.operation_id}: Source-Branch-Locators weichen ab.`,
    "ROUTE_TRACE_MISMATCH",
  );
  assertCatalog(!Number.isNaN(Date.parse(fixture.fixture_clock)),
    `${operation.operation_id}: Fixture-Uhr ist ungültig.`, "ROUTE_TRACE_MISMATCH");
  assertCatalog(fixtures.get(fixture.operation_input_fixture_ref) !== undefined,
    `${operation.operation_id}: Operation-Input-Fixture fehlt.`, "ROUTE_TRACE_MISMATCH");
  const fixtureIds = fixtures.get(fixture.fixture_ids_ref);
  assertCatalog(fixtureIds !== undefined && !Array.isArray(fixtureIds) && fixtureIds !== null
    && typeof fixtureIds === "object", `${operation.operation_id}: Fixture-IDs fehlen.`,
    "ROUTE_TRACE_MISMATCH");
  assertCatalog(fixture.steps.length > 0,
    `${operation.operation_id}: Route-Trace darf nicht leer sein.`, "ROUTE_TRACE_MISMATCH");
  for (const [index, step] of fixture.steps.entries()) {
    assertCatalog(step.sequence === index + 1,
      `${operation.operation_id}: Route-Trace-Sequenz ist nicht lückenlos.`, "ROUTE_TRACE_MISMATCH");
    assertCatalog(step.normalized_path_template.startsWith("/")
      && !/[?#\\]/u.test(step.normalized_path_template),
    `${operation.operation_id}: Normalisierter Pfad ist ungültig.`, "ROUTE_TRACE_MISMATCH");
    assertCatalog(step.request_matcher.body_match === "exact_rfc8785",
      `${operation.operation_id}: Request-Body muss JCS-exakt verglichen werden.`, "ROUTE_TRACE_MISMATCH");
    if (step.request_matcher.body_fixture_ref) {
      assertCatalog(fixtures.get(step.request_matcher.body_fixture_ref) !== undefined,
        `${operation.operation_id}: Body-Fixture fehlt.`, "ROUTE_TRACE_MISMATCH");
    }
    assertCatalog(fixtures.get(step.response_fixture_ref) !== undefined,
      `${operation.operation_id}: Response-Fixture fehlt.`, "ROUTE_TRACE_MISMATCH");
    for (const errorRef of step.error_response_fixture_refs) {
      assertCatalog(fixtures.get(errorRef) !== undefined,
        `${operation.operation_id}: Fehler-Fixture ${errorRef} fehlt.`, "ROUTE_TRACE_MISMATCH");
    }
    for (const schemaRef of [step.request_schema_ref, step.response_schema_ref]) {
      if (!schemaRef) continue;
      const schema = schemas.get(schemaRef);
      assertCatalog(schema, `${operation.operation_id}: Schema ${schemaRef} fehlt.`, "SCHEMA_INVALID");
      validateJsonSchema(schema, schemaRef);
    }
  }
  const terminalSchema = schemas.get(fixture.terminal_output_schema_ref);
  assertCatalog(terminalSchema, `${operation.operation_id}: Terminal-Output-Schema fehlt.`, "SCHEMA_INVALID");
  validateJsonSchema(terminalSchema, fixture.terminal_output_schema_ref);
  return fixture;
}

export function resolveOperationPermissionAudit(
  operation: OperationDefinition,
  fixture: RouteTraceFixture,
  audit: BackendRoutePermissionAudit,
): BackendRoutePermissionAuditEntry[] {
  const auditByRoute = new Map<string, BackendRoutePermissionAuditEntry>();
  for (const entry of audit.entries) {
    const key = routeKey(entry.service, entry.http_method, entry.normalized_path_template);
    assertCatalog(!auditByRoute.has(key), `Mehrdeutiger Backend-Audit für ${key}.`,
      "PERMISSION_AUDIT_INVALID");
    auditByRoute.set(key, entry);
  }

  const resolved = fixture.steps.map((step) => {
    const key = routeKey(step.service, step.http_method, step.normalized_path_template);
    const entry = auditByRoute.get(key);
    assertCatalog(entry, `${operation.operation_id}: Kein exakter Backend-Audit für ${key}.`,
      "PERMISSION_AUDIT_INVALID");
    assertCatalog(entry.authentication !== "internal",
      `${operation.operation_id}: Interne Backend-Route ist nicht publizierbar.`,
      "PERMISSION_AUDIT_INVALID");
    const expectedAuthorization = entry.authentication === "public"
      ? "absent"
      : "fixture_bearer_required";
    assertCatalog(step.request_matcher.authorization === expectedAuthorization,
      `${operation.operation_id}: Authorization-Matcher widerspricht dem Backend-Audit.`,
      "PERMISSION_AUDIT_INVALID");
    assertCatalog(
      permissionPolicyFingerprint(entry.permission_policy)
        === permissionPolicyFingerprint(operation.permission_policy),
      `${operation.operation_id}: PermissionPolicy widerspricht dem Backend-Audit.`,
      "PERMISSION_AUDIT_INVALID",
    );
    return entry;
  });

  assertCatalog(
    JSON.stringify(sortedUnique(resolved.map((entry) => entry.audit_id)))
      === JSON.stringify(sortedUnique(operation.permission_policy.backend_audit_refs)),
    `${operation.operation_id}: backend_audit_refs sind nicht exakt.`,
    "PERMISSION_AUDIT_INVALID",
  );
  return resolved;
}

export function fixtureIdsAsRecord(value: JsonValue): Readonly<Record<string, string | number | boolean | null>> {
  assertCatalog(value !== null && typeof value === "object" && !Array.isArray(value),
    "Fixture-IDs müssen ein JSON-Objekt sein.", "ROUTE_TRACE_MISMATCH");
  for (const entry of Object.values(value)) {
    assertCatalog(entry === null || ["string", "number", "boolean"].includes(typeof entry),
      "Fixture-ID-Werte müssen primitive JSON-Werte sein.", "ROUTE_TRACE_MISMATCH");
  }
  return value as Record<string, string | number | boolean | null>;
}
