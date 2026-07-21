import type { JsonValue } from "@comvenio/connector-contracts";

import { eventDaySegments } from "./calendar.ts";

const SECRET_KEYS = new Set([
  "access_token", "refresh_token", "token", "invite_token", "invitation_token", "authorization",
  "secret", "secret_key", "password", "service_token", "external_data_json",
]);
const AUDIT_KEYS = new Set(["created_by", "updated_by", "deleted_by", "internal_cursor"]);
const CONTACT_KEYS = new Set([
  "email", "external_email", "phone", "phone_number", "external_contact_name", "external_name",
  "first_name", "last_name", "full_name",
]);

function isSecretOrInternalKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SECRET_KEYS.has(normalized)
    || AUDIT_KEYS.has(normalized)
    || /(?:^|_)(?:access|refresh|invite|invitation|oauth|bearer|service)?_?token(?:$|_)/u.test(normalized)
    || /(?:^|_)(?:secret|password|credential|api_?key|authorization|cookie)(?:$|_)/u.test(normalized)
    || /(?:^|_)(?:user_id|member_id|assigned_user_id)(?:$|_)/u.test(normalized)
    || normalized === "external_data_json";
}

function maskEmail(value: string): string {
  const [local, domain = ""] = value.split("@");
  const [host, ...suffix] = domain.split(".");
  return `${local?.slice(0, 1) ?? ""}***@${host?.slice(0, 1) ?? ""}***${suffix.length ? `.${suffix.join(".")}` : ""}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return digits.length > 4 ? `***${digits.slice(-4)}` : "***";
}

export function redactEventPlanValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactEventPlanValue);
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSecretOrInternalKey(key)) continue;
    if (key === "assigned_user_id" || key === "registration_id") {
      if (entry !== null) output.is_reserved = true;
      continue;
    }
    if (CONTACT_KEYS.has(key) && typeof entry === "string") {
      output[`${key}_masked`] = key.includes("email") ? maskEmail(entry) : key.includes("phone") ? maskPhone(entry) : "***";
      continue;
    }
    output[key] = redactEventPlanValue(entry);
  }
  return output;
}

export function publicCalendarEvent(value: JsonValue, timezone: string): JsonValue {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Der Event-Service hat kein Event-Objekt geliefert.");
  }
  const start = typeof value.start_time === "string" ? value.start_time : null;
  const end = typeof value.end_time === "string" ? value.end_time : null;
  return {
    title: typeof value.title === "string" ? value.title : "",
    description: typeof value.description === "string" ? value.description : null,
    location: typeof value.location === "string" ? value.location : null,
    start_time: start,
    end_time: end,
    event_type: typeof value.event_type === "string" ? value.event_type : "other",
    status: typeof value.status === "string" ? value.status : "confirmed",
    timezone,
    day_segments: eventDaySegments(start, end, timezone),
  };
}

export function publicCalendarEvents(value: JsonValue, timezone: string): JsonValue {
  if (!Array.isArray(value)) throw new Error("Der Event-Service hat keine Event-Liste geliefert.");
  return value.map((entry) => publicCalendarEvent(entry, timezone));
}

export function privateCalendarEvent(value: JsonValue, timezone: string): JsonValue {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Der Event-Service hat kein Event-Objekt geliefert.");
  }
  const start = typeof value.start_time === "string" ? value.start_time : null;
  const end = typeof value.end_time === "string" ? value.end_time : null;
  return {
    event_id: typeof value.id === "string" ? value.id : null,
    department_id: typeof value.department_id === "string" ? value.department_id : null,
    title: typeof value.title === "string" ? value.title : "",
    description: typeof value.description === "string" ? value.description : null,
    location: typeof value.location === "string" ? value.location : null,
    start_time: start,
    end_time: end,
    event_type: typeof value.event_type === "string" ? value.event_type : "other",
    visibility_scope: typeof value.visibility_scope === "string" ? value.visibility_scope : "private",
    status: typeof value.status === "string" ? value.status : "draft",
    event_complexity: typeof value.event_complexity === "string" ? value.event_complexity : "simple",
    series_id: typeof value.series_id === "string" ? value.series_id : null,
    is_template: value.is_template === true,
    feature_profile: value.feature_profile !== undefined ? redactEventPlanValue(value.feature_profile) : null,
    timezone,
    day_segments: eventDaySegments(start, end, timezone),
  };
}

export function privateCalendarEvents(value: JsonValue, timezone: string): JsonValue {
  if (!Array.isArray(value)) throw new Error("Der Event-Service hat keine Event-Liste geliefert.");
  return value.map((entry) => privateCalendarEvent(entry, timezone));
}
