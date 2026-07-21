import {
  createProviderNeutralResult,
  normalizeRequestContext,
  type JsonValue,
  type RequestContext,
} from "@comvenio/connector-contracts";

import { assertCapability } from "./errors.ts";
import type {
  CapabilitySnapshot,
  PermissionsExplainInput,
  PermissionsExplainOutput,
  PermissionsExplainResult,
} from "./types.ts";
import { validateCapabilityUuid } from "./validation.ts";

export const PERMISSIONS_EXPLAIN_INPUT_SCHEMA: JsonValue = {
  type: "object",
  additionalProperties: false,
  required: ["club_id"],
  properties: {
    club_id: { type: "string", format: "uuid" },
    department_id: { type: "string", format: "uuid" },
  },
};

export const PERMISSIONS_EXPLAIN_OUTPUT_SCHEMA: JsonValue = {
  type: "object",
  additionalProperties: false,
  required: [
    "club_id",
    "department_ids",
    "capability_version",
    "generated_at",
    "allowed_capabilities",
    "denied_capabilities",
    "sources",
  ],
  properties: {
    club_id: { type: "string", format: "uuid" },
    department_ids: { type: "array", items: { type: "string", format: "uuid" } },
    capability_version: { type: "string" },
    generated_at: { type: "string", format: "date-time" },
    allowed_capabilities: { type: "array", items: { type: "string" } },
    denied_capabilities: { type: "array", items: { type: "string" } },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["permission_key", "allowed", "scope", "department_id", "assignment_type"],
        properties: {
          permission_key: { type: "string" },
          allowed: { type: "boolean" },
          scope: { enum: ["club", "department"] },
          department_id: { type: ["string", "null"] },
          assignment_type: { enum: ["direct", "position"] },
        },
      },
    },
  },
};

export class PermissionsExplainTool {
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  execute(
    input: PermissionsExplainInput,
    contextInput: RequestContext,
    snapshot: CapabilitySnapshot,
  ): PermissionsExplainResult {
    const context = normalizeRequestContext(contextInput);
    const clubId = validateCapabilityUuid(input.club_id, "Die Vereins-ID");
    const departmentId = input.department_id === undefined
      ? null
      : validateCapabilityUuid(input.department_id, "Die Abteilungs-ID");
    assertCapability(context.subject_id !== null && snapshot.subject_id === context.subject_id,
      "PERMISSION_DENIED", "Die Eigenerklärung benötigt einen passenden Login-Kontext.");
    assertCapability(context.club_id === clubId && snapshot.club_id === clubId,
      "TENANT_MISMATCH", "Die Eigenerklärung gehört zu einem anderen Verein.");
    assertCapability(context.department_id === departmentId, "TENANT_MISMATCH",
      "Die Eigenerklärung gehört zu einem anderen Abteilungskontext.");
    assertCapability(context.capability_version === snapshot.capability_version,
      "VERSION_STALE", "Die Eigenerklärung benötigt einen aktuellen Capability-Snapshot.");
    assertCapability(Date.parse(snapshot.expires_at) > this.#now().getTime(),
      "VERSION_STALE", "Die Eigenerklärung benötigt einen nicht abgelaufenen Capability-Snapshot.");

    const allowedCapabilities = Object.keys(snapshot.permissions)
      .filter((key) => snapshot.permissions[key] === true).sort();
    const deniedCapabilities = Object.keys(snapshot.permissions)
      .filter((key) => snapshot.permissions[key] === false).sort();
    const output: PermissionsExplainOutput = {
      club_id: snapshot.club_id,
      department_ids: [...snapshot.department_ids],
      capability_version: snapshot.capability_version,
      generated_at: snapshot.generated_at,
      allowed_capabilities: allowedCapabilities,
      denied_capabilities: deniedCapabilities,
      sources: snapshot.sources.map((source) => ({ ...source })),
    };
    return createProviderNeutralResult(context, output, [{
      type: "text",
      text: "Das sind deine aktuell wirksamen Comvenio-Berechtigungen für den ausgewählten Verein.",
    }]);
  }
}
