import { z } from "zod";

import type { CapabilitySnapshot } from "@comvenio/auth";
import {
  BOOKING_OBJECT_WIDGET_SCHEMA,
  SERVER_ACTION_DESCRIPTOR_SCHEMA,
  createConnectorError,
  normalizeRequestContext,
  type BookingObjectWidget,
  type BookingSlot,
  type JsonValue,
  type RequestContext,
  type ServerActionDescriptor,
} from "@comvenio/connector-contracts";

import type { BookingObjectProjectorInput, BookingWidgetActionPolicy } from "./types.ts";

const sourceObject = z.object({
  id: z.string().uuid().optional(),
  object_id: z.string().uuid().optional(),
  club_id: z.string().uuid(),
  name: z.string().trim().min(1).max(300),
  type: z.string().trim().min(1).max(100).optional(),
  object_type: z.string().trim().min(1).max(100).optional(),
  status: z.string().trim().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
}).passthrough().superRefine((value, context) => {
  if (!value.id && !value.object_id) context.addIssue({ code: "custom", message: "Dem Buchungsobjekt fehlt die ID." });
});
const objectSource = z.union([
  z.array(sourceObject).max(100),
  z.object({ items: z.array(sourceObject).max(100) }).passthrough(),
]);
const availabilitySource = z.object({
  club_id: z.string().uuid(),
  object_id: z.string().uuid(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(100),
  status: z.enum(["AVAILABLE", "BUSY", "NOT_BOOKABLE"]),
  slots: z.array(z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    status: z.enum(["AVAILABLE", "BUSY", "NOT_BOOKABLE"]),
    reason: z.string().trim().max(160).nullable(),
  }).strict()).max(200),
  booking_rules_observed: z.number().int().min(0),
}).strict();

function bound(input: BookingObjectProjectorInput): { context: RequestContext; snapshot: CapabilitySnapshot } {
  const context = normalizeRequestContext(input.context);
  const snapshot = input.capability_snapshot;
  if (!context.subject_id || !context.oauth_grant_id || !context.club_id) {
    throw createConnectorError({ code: "AUTH_REQUIRED", message: "Für die Buchungsansicht ist eine aktive Verbindung erforderlich.", request_id: context.request_id, retryable: false });
  }
  if (context.club_id !== input.club.club_id || snapshot.club_id !== input.club.club_id || snapshot.subject_id !== context.subject_id) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Buchungsansicht gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
  }
  if (!context.capability_version || context.capability_version !== snapshot.capability_version) {
    throw createConnectorError({ code: "PERMISSION_DENIED", message: "Die Berechtigungen haben sich geändert. Bitte lade die Buchungsansicht neu.", request_id: context.request_id, retryable: false });
  }
  if (!context.scopes.includes("object.read") || !context.scopes.includes("booking.read")) {
    throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Für die Buchungsansicht fehlen die aktuellen Leseberechtigungen.", request_id: context.request_id, retryable: false, required_scope: context.scopes.includes("object.read") ? "booking.read" : "object.read" });
  }
  return { context, snapshot };
}

function slotState(status: "AVAILABLE" | "BUSY" | "NOT_BOOKABLE"): BookingSlot["state"] {
  return status === "AVAILABLE" ? "available" : status === "BUSY" ? "occupied" : "blocked";
}

function slotLabel(status: "AVAILABLE" | "BUSY" | "NOT_BOOKABLE"): string {
  return status === "AVAILABLE" ? "frei" : status === "BUSY" ? "belegt" : "gesperrt";
}

function safeSlots(input: {
  source: JsonValue | null | undefined;
  clubId: string;
  objectId: string | null;
  range: { from: string; to: string };
  requestId: string;
}): BookingSlot[] {
  if (!input.objectId) return [];
  if (input.source == null) return [{ from: input.range.from, to: input.range.to, state: "unknown", booking_id: null, label: "Verfügbarkeit wird geprüft" }];
  const availability = availabilitySource.parse(input.source);
  if (availability.club_id !== input.clubId || availability.object_id !== input.objectId) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Verfügbarkeit gehört nicht zum ausgewählten Buchungsobjekt.", request_id: input.requestId, retryable: false });
  }
  if (availability.from !== input.range.from || availability.to !== input.range.to) {
    throw createConnectorError({ code: "VALIDATION_FAILED", message: "Die Verfügbarkeit gehört nicht zum angefragten Zeitraum.", request_id: input.requestId, retryable: false });
  }
  return availability.slots.map((slot) => ({
    from: slot.from,
    to: slot.to,
    state: slotState(slot.status),
    booking_id: null,
    label: slotLabel(slot.status),
  }));
}

function filteredActions(
  input: BookingObjectProjectorInput,
  context: RequestContext,
  snapshot: CapabilitySnapshot,
  policy: BookingWidgetActionPolicy,
  visibleObjectIds: ReadonlySet<string>,
  selectedObjectId: string | null,
): ServerActionDescriptor[] {
  return (input.action_candidates ?? []).flatMap((candidate) => {
    const parsed = SERVER_ACTION_DESCRIPTOR_SCHEMA.safeParse(candidate);
    if (!parsed.success || parsed.data.visibility === "hidden") return [];
    const action = parsed.data;
    if (action.input === null || typeof action.input !== "object" || Array.isArray(action.input)
      || action.input.club_id !== input.club.club_id) return [];
    const actionObjectId = typeof action.input.object_id === "string" ? action.input.object_id : null;
    if (actionObjectId && (!visibleObjectIds.has(actionObjectId) || actionObjectId !== selectedObjectId)) return [];
    if (action.risk_class !== "read" && (action.risk_class !== "critical_write" || !action.requires_confirmation || !actionObjectId)) return [];
    const decision = policy.evaluate({ context, capability_snapshot: snapshot, descriptor: action });
    if (!decision.allowed || decision.risk_class !== action.risk_class
      || decision.requires_confirmation !== action.requires_confirmation) return [];
    return [action];
  });
}

export class BookingObjectWidgetProjector {
  constructor(private readonly actionPolicy: BookingWidgetActionPolicy) {}

  project(input: BookingObjectProjectorInput): BookingObjectWidget {
    const binding = bound(input);
    const parsed = objectSource.parse(input.object_source);
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (items.some((item) => item.club_id !== input.club.club_id)) {
      throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Objektliste enthält Daten eines anderen Vereins.", request_id: binding.context.request_id, retryable: false });
    }
    const objects = items.map((item) => ({
      object_id: item.object_id ?? item.id!,
      name: item.name,
      type: item.type ?? item.object_type ?? "Buchungsobjekt",
      status: item.status ?? (item.is_active === false ? "gesperrt" : "verfügbar"),
    }));
    const visibleObjectIds = new Set(objects.map((object) => object.object_id));
    const selectedObjectId = input.selected_object_id ?? null;
    if (selectedObjectId && !visibleObjectIds.has(selectedObjectId)) {
      throw createConnectorError({ code: "NOT_FOUND", message: "Das ausgewählte Buchungsobjekt ist in dieser Ansicht nicht verfügbar.", request_id: binding.context.request_id, retryable: false });
    }
    const slots = safeSlots({ source: input.availability_source, clubId: input.club.club_id, objectId: selectedObjectId, range: input.range, requestId: binding.context.request_id });
    return BOOKING_OBJECT_WIDGET_SCHEMA.parse({
      widget: "booking_object",
      contract_version: "1.0.0",
      title: "Objekte & Buchungen",
      club: input.club,
      capability_version: binding.snapshot.capability_version,
      generated_at: input.generated_at ?? new Date().toISOString(),
      data: { range: input.range, objects, selected_object_id: selectedObjectId, slots },
      actions: filteredActions(input, binding.context, binding.snapshot, this.actionPolicy, visibleObjectIds, selectedObjectId),
      empty_state: objects.length === 0
        ? { title: "Keine Buchungsobjekte verfügbar", description: "Für deinen Verein sind aktuell keine freigegebenen Buchungsobjekte sichtbar." }
        : null,
    });
  }
}

export function safeBookingPermissionChangedWidget(model: BookingObjectWidget): BookingObjectWidget {
  return BOOKING_OBJECT_WIDGET_SCHEMA.parse({ ...model, capability_version: null, actions: [] });
}

export function safeBookingConflictWidget(model: BookingObjectWidget, currentAvailability: JsonValue): BookingObjectWidget {
  const slots = safeSlots({
    source: currentAvailability,
    clubId: model.club.club_id,
    objectId: model.data.selected_object_id,
    range: model.data.range,
    requestId: "00000000-0000-4000-8000-000000000000",
  });
  return BOOKING_OBJECT_WIDGET_SCHEMA.parse({ ...model, data: { ...model.data, slots }, actions: [] });
}
