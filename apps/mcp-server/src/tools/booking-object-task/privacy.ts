import type { JsonValue } from "@comvenio/connector-contracts";

type JsonObject = { [key: string]: JsonValue };

const forbidden = /(?:^|_)(?:authorization|token|secret|password|credential|hash|user_id|created_by|updated_by|deleted_by|audit|internal_cursor|log)(?:$|_)/iu;
const directContact = /(?:email|phone|birthdate|date_of_birth|postal_code|guest_name|resp_member_id|member_id)/iu;

function record(value: JsonValue): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function redactBookingObjectTaskValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactBookingObjectTaskValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !forbidden.test(key))
    .map(([key, entry]) => [key, redactBookingObjectTaskValue(entry)]));
}

export function minimizeReservation(value: JsonValue): JsonValue {
  const source = record(value);
  const allowed = ["id", "object_id", "club_id", "start_time", "end_time", "status", "title", "approval_required", "created_at", "updated_at"] as const;
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key === "id" ? "reservation_id" : key, redactBookingObjectTaskValue(source[key]!)]));
}

export function minimizeReservations(value: JsonValue, limit = 100): JsonValue {
  const items = Array.isArray(value) ? value : [];
  return {
    items: items.slice(0, limit).map(minimizeReservation),
    returned: Math.min(items.length, limit),
    truncated: items.length > limit,
  };
}

export function minimizeReservationParticipants(value: JsonValue, limit = 100): JsonValue {
  const input = Array.isArray(value) ? value : [value];
  const items = input.slice(0, limit).map((entry) => {
    const participant = record(entry);
    return Object.fromEntries(["id", "object_reservation_id", "status", "is_guest"]
      .filter((key) => participant[key] !== undefined)
      .map((key) => [key === "id" ? "participant_id" : key, participant[key]!]));
  });
  return Array.isArray(value) ? { items, returned: Math.min(input.length, limit), truncated: input.length > limit } : (items[0] ?? {});
}

export function minimizeGuestStatistics(value: JsonValue, limit = 100): JsonValue {
  const source = record(value);
  const members = Array.isArray(source.members) ? source.members : [];
  return {
    club_id: source.club_id ?? null,
    from_date: source.from_date ?? null,
    to_date: source.to_date ?? null,
    total_guests: source.total_guests ?? 0,
    total_fee: source.total_fee ?? 0,
    members: members.slice(0, limit).map((entry) => {
      const member = record(entry);
      return {
        total_guests: member.total_guests ?? 0,
        total_bookings_with_guests: member.total_bookings_with_guests ?? 0,
        total_fee: member.total_fee ?? 0,
      };
    }),
    truncated: members.length > limit,
  };
}

export function minimizeTaskRelations(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(minimizeTaskRelations);
  const source = record(redactBookingObjectTaskValue(value));
  const assignments = Array.isArray(source.assignments) ? source.assignments.map((entry) => {
    const assignment = record(entry);
    return Object.fromEntries(["id", "task_id", "member_id", "is_responsible"]
      .filter((key) => assignment[key] !== undefined)
      .map((key) => [key === "id" ? "assignment_id" : key, assignment[key]!]));
  }) : source.assignments;
  return assignments === undefined ? source : { ...source, assignments };
}

export function removeDirectContactData(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(removeDirectContactData);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !directContact.test(key) && !forbidden.test(key))
    .map(([key, entry]) => [key, removeDirectContactData(entry)]));
}
