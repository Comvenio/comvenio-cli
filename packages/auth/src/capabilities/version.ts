import { createHash } from "node:crypto";

import { assertCapability } from "./errors.ts";
import type {
  CapabilitySnapshot,
  ConnectorEffectivePermissionRead,
  ConnectorPermissionSource,
} from "./types.ts";
import {
  validateCapabilityUuid,
  validateEffectivePermissionRead,
} from "./validation.ts";

export const CAPABILITY_CACHE_TTL_MS = 30_000;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assertCapability(Number.isFinite(value), "CAPABILITY_INVALID", "Nicht-endliche JSON-Zahl.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  assertCapability(typeof value === "object" && value !== null, "CAPABILITY_INVALID",
    "Nicht-kanonisierbarer Capability-Wert.");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

function normalizedSources(sources: readonly ConnectorPermissionSource[]): ConnectorPermissionSource[] {
  return [...sources].map((source) => ({ ...source })).sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
}

export function capabilityVersionPayload(
  read: Pick<ConnectorEffectivePermissionRead, "club_id" | "department_ids" | "permissions" | "sources">,
): Record<string, unknown> {
  const permissions = Object.fromEntries(Object.keys(read.permissions).sort()
    .map((key) => [key, read.permissions[key]]));
  return {
    club_id: read.club_id,
    department_ids: [...read.department_ids].sort(),
    permissions,
    sources: normalizedSources(read.sources),
  };
}

export function computeCapabilityVersion(
  read: Pick<ConnectorEffectivePermissionRead, "club_id" | "department_ids" | "permissions" | "sources">,
): string {
  return createHash("sha256")
    .update(canonicalize(capabilityVersionPayload(read)), "utf8")
    .digest("base64url");
}

export function createCapabilitySnapshot(input: {
  subject_id: string;
  response: unknown;
  observed_at: Date;
}): CapabilitySnapshot {
  const subjectId = validateCapabilityUuid(input.subject_id, "Die Subject-ID");
  const read = validateEffectivePermissionRead(input.response);
  const expectedVersion = computeCapabilityVersion(read);
  assertCapability(read.capability_version === expectedVersion, "VERSION_STALE",
    "Die Capability-Version stimmt nicht mit dem Self-Snapshot überein.");
  const observedAtMs = input.observed_at.getTime();
  assertCapability(Number.isFinite(observedAtMs), "CAPABILITY_INVALID", "Der Beobachtungszeitpunkt ist ungültig.");
  const generatedAtMs = Date.parse(read.generated_at);
  assertCapability(generatedAtMs <= observedAtMs + 1_000, "CAPABILITY_INVALID",
    "Der Capability-Snapshot liegt unzulässig in der Zukunft.");
  assertCapability(observedAtMs - generatedAtMs <= CAPABILITY_CACHE_TTL_MS, "VERSION_STALE",
    "Der Capability-Snapshot ist bereits abgelaufen.");
  return {
    ...read,
    subject_id: subjectId,
    observed_at: input.observed_at.toISOString(),
    expires_at: new Date(Math.min(
      observedAtMs + CAPABILITY_CACHE_TTL_MS,
      generatedAtMs + CAPABILITY_CACHE_TTL_MS,
    )).toISOString(),
  };
}
