import type { JsonValue } from "@comvenio/connector-contracts";

import { eventDaySegments } from "../event-plan/calendar.ts";

type JsonObject = { [key: string]: JsonValue };

const forbidden = /(?:^|_)(?:authorization|token|secret|password|credential|hash|user_id|created_by|updated_by|deleted_by|audit|internal_cursor)(?:$|_)/iu;
const participantContact = /(?:email|phone|address|birthdate|date_of_birth|postal_code|city|member_id|captain_member_id)/iu;

function record(value: JsonValue): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function redactMeetingTournamentValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactMeetingTournamentValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !forbidden.test(key))
    .map(([key, entry]) => [key, redactMeetingTournamentValue(entry)]));
}

export function minimizeTournamentParticipant(value: JsonValue): JsonValue {
  const source = record(value);
  const allowed = ["id", "name", "display_name", "participant_kind", "registration_status", "seed", "status"] as const;
  return Object.fromEntries(allowed
    .filter((key) => source[key] !== undefined && !participantContact.test(key))
    .map((key) => [key === "id" ? "participant_id" : key, redactMeetingTournamentValue(source[key]!)]));
}

export function minimizeTournamentParticipants(value: JsonValue, limit = 100): JsonValue {
  const items = Array.isArray(value) ? value : [];
  return {
    items: items.slice(0, limit).map(minimizeTournamentParticipant),
    returned: Math.min(items.length, limit),
    truncated: items.length > limit,
  };
}

function time(value: JsonObject, keys: readonly string[]): string | null {
  for (const key of keys) if (typeof value[key] === "string" && !Number.isNaN(Date.parse(value[key] as string))) return value[key] as string;
  return null;
}

export function withLocalDaySegments(value: JsonValue, timezone: string): JsonValue {
  if (Array.isArray(value)) return value.map((item) => withLocalDaySegments(item, timezone));
  if (value === null || typeof value !== "object") return value;
  const safe = record(redactMeetingTournamentValue(value));
  const start = time(safe, ["starts_at", "start_time", "start_at"]);
  const end = time(safe, ["ends_at", "end_time", "end_at"]);
  if (!start) return safe;
  return {
    ...safe,
    timezone,
    day_segments: eventDaySegments(start, end ?? start, timezone),
  };
}

function compareNullable(left: string | number | null, right: string | number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

export function stableTournamentMatches(value: JsonValue, timezone: string, limit = 100): JsonValue {
  const items = Array.isArray(value) ? value : [];
  const sorted = [...items].sort((left, right) => {
    const a = record(left);
    const b = record(right);
    return compareNullable(typeof a.starts_at === "string" ? a.starts_at : null, typeof b.starts_at === "string" ? b.starts_at : null)
      || compareNullable(typeof a.match_number === "number" ? a.match_number : null, typeof b.match_number === "number" ? b.match_number : null)
      || compareNullable(typeof a.id === "string" ? a.id : null, typeof b.id === "string" ? b.id : null);
  });
  return {
    items: sorted.slice(0, limit).map((item) => withLocalDaySegments(item, timezone)),
    returned: Math.min(sorted.length, limit),
    truncated: sorted.length > limit,
    timezone,
  };
}

export function minimizeMeetingParticipants(value: JsonValue): JsonValue {
  const isList = Array.isArray(value);
  const items = isList ? value : [value];
  const minimized = items.filter((item) => item !== null && typeof item === "object").map((item) => {
    const source = record(item);
    return Object.fromEntries(["id", "display_name", "name", "role", "validation_status", "is_present"]
      .filter((key) => source[key] !== undefined)
      .map((key) => [key === "id" ? "participant_id" : key, redactMeetingTournamentValue(source[key]!)]));
  });
  return isList ? minimized : minimized[0] ?? {};
}
