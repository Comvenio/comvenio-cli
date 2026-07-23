import type { JsonValue } from "@comvenio/connector-contracts";

import { assertCapability } from "./errors.ts";
import type {
  CapabilityVersion,
  ConnectorEffectivePermissionRead,
  ConnectorPermissionSource,
} from "./types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const CAPABILITY_VERSION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
// FastAPI/Pydantic emits RFC 3339 UTC instants with variable sub-second
// precision and may serialize UTC as either Z or +00:00.
const UTC_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/u;

const EFFECTIVE_KEYS = [
  "member_id",
  "club_id",
  "department_ids",
  "permissions",
  "sources",
  "capability_version",
  "generated_at",
] as const;
const SOURCE_KEYS = [
  "permission_key",
  "allowed",
  "scope",
  "department_id",
  "assignment_type",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_INSTANT_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysPerMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysPerMonth[month - 1]!
    && hour <= 23
    && minute <= 59
    && second <= 59
    && Number.isFinite(Date.parse(value));
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const exact = actual.length === expected.length
    && [...expected].sort().every((key, index) => actual[index] === key);
  assertCapability(exact, "CAPABILITY_INVALID", `${field} enthält unerlaubte oder fehlende Felder.`);
}

export function validateCapabilityUuid(value: unknown, field: string): string {
  assertCapability(typeof value === "string" && UUID_PATTERN.test(value.trim()),
    "CAPABILITY_INVALID", `${field} ist ungültig.`);
  return value.trim();
}

export function validateCapabilityVersion(value: unknown): CapabilityVersion {
  assertCapability(typeof value === "string" && CAPABILITY_VERSION_PATTERN.test(value),
    "CAPABILITY_INVALID", "Die Capability-Version ist ungültig.");
  return value;
}

function validateCapabilityKey(value: unknown): string {
  assertCapability(typeof value === "string" && CAPABILITY_KEY_PATTERN.test(value),
    "CAPABILITY_INVALID", "Ein Capability-Key ist ungültig.");
  return value;
}

function validatePermissionSource(value: unknown): ConnectorPermissionSource {
  assertCapability(isRecord(value), "CAPABILITY_INVALID", "Eine Capability-Provenienz ist ungültig.");
  assertExactKeys(value, SOURCE_KEYS, "Capability-Provenienz");
  const permissionKey = validateCapabilityKey(value.permission_key);
  assertCapability(typeof value.allowed === "boolean", "CAPABILITY_INVALID",
    "Der Provenienzstatus ist ungültig.");
  assertCapability(value.scope === "club" || value.scope === "department", "CAPABILITY_INVALID",
    "Der Provenienzscope ist ungültig.");
  assertCapability(value.assignment_type === "direct" || value.assignment_type === "position",
    "CAPABILITY_INVALID", "Der Zuweisungstyp ist ungültig.");
  const departmentId = value.department_id === null
    ? null
    : validateCapabilityUuid(value.department_id, "Die Provenienz-Abteilung");
  assertCapability(
    (value.scope === "club" && departmentId === null)
      || (value.scope === "department" && departmentId !== null),
    "CAPABILITY_INVALID",
    "Provenienzscope und Abteilung widersprechen sich.",
  );
  return {
    permission_key: permissionKey,
    allowed: value.allowed,
    scope: value.scope,
    department_id: departmentId,
    assignment_type: value.assignment_type,
  };
}

export function compareConnectorPermissionSources(
  left: ConnectorPermissionSource,
  right: ConnectorPermissionSource,
): number {
  const leftKey = [
    left.permission_key,
    left.allowed ? "1" : "0",
    left.scope,
    left.department_id ?? "",
    left.assignment_type,
  ];
  const rightKey = [
    right.permission_key,
    right.allowed ? "1" : "0",
    right.scope,
    right.department_id ?? "",
    right.assignment_type,
  ];
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index]! < rightKey[index]!) return -1;
    if (leftKey[index]! > rightKey[index]!) return 1;
  }
  return 0;
}

export function validateEffectivePermissionRead(value: unknown): ConnectorEffectivePermissionRead {
  assertCapability(isRecord(value), "CAPABILITY_INVALID", "Die Effective-Permission-Antwort ist ungültig.");
  assertExactKeys(value, EFFECTIVE_KEYS, "Effective-Permission-Antwort");
  const memberId = validateCapabilityUuid(value.member_id, "Die eigene Mitglieds-ID");
  const clubId = validateCapabilityUuid(value.club_id, "Die Vereins-ID");

  assertCapability(Array.isArray(value.department_ids), "CAPABILITY_INVALID",
    "Die Abteilungsliste ist ungültig.");
  const departmentIds = value.department_ids
    .map((departmentId) => validateCapabilityUuid(departmentId, "Eine Abteilungs-ID"))
    .sort();
  assertCapability(new Set(departmentIds).size === departmentIds.length, "CAPABILITY_INVALID",
    "Die Abteilungsliste enthält Duplikate.");

  assertCapability(isRecord(value.permissions), "CAPABILITY_INVALID", "Die Capability-Matrix ist ungültig.");
  const permissions: Record<string, boolean> = {};
  for (const key of Object.keys(value.permissions).sort()) {
    const capability = validateCapabilityKey(key);
    const allowed = value.permissions[key];
    assertCapability(typeof allowed === "boolean", "CAPABILITY_INVALID",
      "Ein Capability-Wert ist ungültig.");
    permissions[capability] = allowed;
  }

  assertCapability(Array.isArray(value.sources), "CAPABILITY_INVALID",
    "Die Capability-Provenienz ist ungültig.");
  const sources = value.sources.map(validatePermissionSource)
    .sort(compareConnectorPermissionSources);
  for (const source of sources) {
    assertCapability(Object.hasOwn(permissions, source.permission_key), "CAPABILITY_INVALID",
      "Eine Provenienz verweist auf eine unbekannte Capability.");
    if (source.department_id !== null) {
      assertCapability(departmentIds.includes(source.department_id), "CAPABILITY_INVALID",
        "Eine Provenienz verweist auf eine unsichtbare Abteilung.");
    }
  }

  const capabilityVersion = validateCapabilityVersion(value.capability_version);
  const generatedAt = value.generated_at;
  assertCapability(validUtcInstant(generatedAt), "CAPABILITY_INVALID",
    "Der Erzeugungszeitpunkt ist ungültig.");

  return {
    member_id: memberId,
    club_id: clubId,
    department_ids: departmentIds,
    permissions,
    sources,
    capability_version: capabilityVersion,
    generated_at: new Date(generatedAt).toISOString(),
  };
}

export const EFFECTIVE_PERMISSION_READ_SCHEMA: JsonValue = {
  type: "object",
  additionalProperties: false,
  required: [...EFFECTIVE_KEYS],
  properties: {
    member_id: { type: "string", format: "uuid" },
    club_id: { type: "string", format: "uuid" },
    department_ids: { type: "array", uniqueItems: true, items: { type: "string", format: "uuid" } },
    permissions: { type: "object", additionalProperties: { type: "boolean" } },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [...SOURCE_KEYS],
        properties: {
          permission_key: { type: "string" },
          allowed: { type: "boolean" },
          scope: { enum: ["club", "department"] },
          department_id: { type: ["string", "null"], format: "uuid" },
          assignment_type: { enum: ["direct", "position"] },
        },
      },
    },
    capability_version: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
    generated_at: { type: "string", format: "date-time" },
  },
};
