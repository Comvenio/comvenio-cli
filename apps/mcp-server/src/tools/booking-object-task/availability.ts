import { createHash } from "node:crypto";
import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import { createConnectorError, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";

import type { AvailabilityRequest, AvailabilityResult, AvailabilitySlot, K10MutationRequest } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };

function record(value: JsonValue): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function items(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value;
  const nested = record(value).items;
  return Array.isArray(nested) ? nested : [];
}

function requiredString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${name} fehlt in der Fachservice-Antwort.`);
  return value;
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}

function mergeBusySlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const sorted = [...slots].sort((left, right) => Date.parse(left.from) - Date.parse(right.from) || Date.parse(left.to) - Date.parse(right.to));
  const merged: AvailabilitySlot[] = [];
  for (const slot of sorted) {
    const prior = merged.at(-1);
    if (prior && Date.parse(slot.from) <= Date.parse(prior.to)) {
      if (Date.parse(slot.to) > Date.parse(prior.to)) prior.to = slot.to;
      continue;
    }
    merged.push({ ...slot });
  }
  return merged;
}

function durationReason(object: JsonObject, from: number, to: number): string | null {
  const minutes = (to - from) / 60_000;
  if (typeof object.min_duration_minutes === "number" && minutes < object.min_duration_minutes) return "MIN_DURATION";
  if (typeof object.max_duration_minutes === "number" && minutes > object.max_duration_minutes) return "MAX_DURATION";
  const granularity = object.booking_granularity;
  const step = granularity === "15min" ? 15 : granularity === "30min" ? 30 : granularity === "hourly" ? 60 : null;
  if (step !== null && minutes % step !== 0) return "BOOKING_GRANULARITY";
  return null;
}

export class AvailabilityContract {
  readonly #client: ComvenioApiClient;

  constructor(client: ComvenioApiClient) {
    this.#client = client;
  }

  async check(request: AvailabilityRequest, context: RequestContext): Promise<AvailabilityResult> {
    if (context.club_id !== request.club_id) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Verfügbarkeitsabfrage gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
    const from = Date.parse(request.from);
    const to = Date.parse(request.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw createConnectorError({ code: "VALIDATION_FAILED", message: "Der Buchungszeitraum ist ungültig.", request_id: context.request_id, retryable: false });

    const [objectValue, reservationsValue, rulesValue] = await Promise.all([
      this.#client.request<JsonValue>({ method: "GET", service: "object", path: `/objects/${request.object_id}`, query: { withAll: "true" }, context }),
      this.#client.request<JsonValue>({ method: "GET", service: "object", path: `/object-reservations/object/${request.object_id}`, context }),
      this.#client.request<JsonValue>({ method: "GET", service: "object", path: `/object-booking-rules/object/${request.object_id}`, context }),
    ]);
    const object = record(objectValue);
    if (requiredString(object.club_id, "club_id") !== request.club_id || requiredString(object.id, "object_id") !== request.object_id) {
      throw createConnectorError({ code: "TENANT_MISMATCH", message: "Das Buchungsobjekt gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
    }

    const base = {
      club_id: request.club_id,
      object_id: request.object_id,
      from: request.from,
      to: request.to,
      timezone: request.timezone,
      booking_rules_observed: items(rulesValue).length,
    } as const;
    if (object.is_active !== true) return { ...base, status: "NOT_BOOKABLE", slots: [{ from: request.from, to: request.to, status: "NOT_BOOKABLE", reason: "OBJECT_INACTIVE" }] };
    const invalidDuration = durationReason(object, from, to);
    if (invalidDuration) return { ...base, status: "NOT_BOOKABLE", slots: [{ from: request.from, to: request.to, status: "NOT_BOOKABLE", reason: invalidDuration }] };

    const busy = items(reservationsValue).flatMap((entry): AvailabilitySlot[] => {
      const reservation = record(entry);
      if (reservation.id === request.exclude_reservation_id || ["cancelled", "rejected"].includes(String(reservation.status))) return [];
      if (reservation.club_id !== request.club_id || reservation.object_id !== request.object_id) return [];
      if (typeof reservation.start_time !== "string" || typeof reservation.end_time !== "string") return [];
      const start = Math.max(from, Date.parse(reservation.start_time));
      const end = Math.min(to, Date.parse(reservation.end_time));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
      return [{ from: new Date(start).toISOString(), to: new Date(end).toISOString(), status: "BUSY", reason: "RESERVATION_CONFLICT" }];
    });
    const slots = mergeBusySlots(busy);
    return slots.length > 0
      ? { ...base, status: "BUSY", slots }
      : { ...base, status: "AVAILABLE", slots: [{ from: request.from, to: request.to, status: "AVAILABLE", reason: null }] };
  }

  fingerprint(results: AvailabilityResult[]): string {
    return createHash("sha256").update(canonical(results)).digest("hex");
  }
}

export async function availabilityRequestsForMutation(request: K10MutationRequest, client: ComvenioApiClient): Promise<AvailabilityRequest[]> {
  if (request.definition.domain !== "booking") return [];
  const input = record(request.input);
  const clubId = requiredString(input.club_id, "club_id");
  const timezone = typeof input.timezone === "string" ? input.timezone : "Europe/Berlin";
  if (["create"].includes(request.operation.operation) && typeof input.object_id === "string" && typeof input.start_time === "string" && typeof input.end_time === "string") {
    const requests: AvailabilityRequest[] = [{ club_id: clubId, object_id: input.object_id, from: input.start_time, to: input.end_time, timezone }];
    const portable = Array.isArray(input.portable_reservations) ? input.portable_reservations : [];
    for (const entry of portable) {
      const value = record(entry);
      if (typeof value.object_id === "string" && typeof value.start_time === "string" && typeof value.end_time === "string") requests.push({ club_id: clubId, object_id: value.object_id, from: value.start_time, to: value.end_time, timezone });
    }
    return requests;
  }
  if (!["update", "approve"].includes(request.operation.operation) || typeof input.reservation_id !== "string") return [];
  const current = record(await client.request<JsonValue>({ method: "GET", service: "object", path: `/object-reservations/${input.reservation_id}`, context: request.context }));
  if (current.club_id !== clubId) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Buchung gehört nicht zum ausgewählten Verein.", request_id: request.context.request_id, retryable: false });
  const changes = record(input.changes ?? {});
  const objectId = typeof input.object_id === "string" ? input.object_id : requiredString(current.object_id, "object_id");
  return [{
    club_id: clubId,
    object_id: objectId,
    from: typeof changes.start_time === "string" ? changes.start_time : requiredString(current.start_time, "start_time"),
    to: typeof changes.end_time === "string" ? changes.end_time : requiredString(current.end_time, "end_time"),
    timezone,
    exclude_reservation_id: input.reservation_id,
  }];
}
