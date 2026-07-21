import {
  BOOKING_OBJECT_WIDGET_STATE_SCHEMA,
  type BookingObjectPhase,
  type BookingObjectWidget,
  type BookingObjectWidgetState,
  type JsonValue,
} from "@comvenio/connector-contracts";

import { safeBookingConflictWidget, safeBookingPermissionChangedWidget } from "./projector.ts";
import type { BookingWidgetTelemetry } from "./types.ts";

export const BOOKING_WIDGET_FIRST_RENDER_BUDGET_MS = 1_000;
export const BOOKING_WIDGET_AVAILABILITY_MAX_AGE_SECONDS = 30;
export const BOOKING_WIDGET_OBJECT_MAX = 100;
export const BOOKING_WIDGET_SLOT_MAX = 200;

export function bookingObjectState(input: {
  phase: BookingObjectPhase;
  model?: BookingObjectWidget | null;
  current_availability?: JsonValue;
  message?: string | null;
  retryable?: boolean;
}): BookingObjectWidgetState {
  let model = input.model ?? null;
  if (input.phase === "permission_changed" && model) model = safeBookingPermissionChangedWidget(model);
  if (input.phase === "conflict" && model) {
    model = input.current_availability === undefined
      ? BOOKING_OBJECT_WIDGET_STATE_SCHEMA.shape.model.unwrap().parse({ ...model, actions: [] })
      : safeBookingConflictWidget(model, input.current_availability);
  }
  return BOOKING_OBJECT_WIDGET_STATE_SCHEMA.parse({
    phase: input.phase,
    model,
    message: input.message ?? null,
    retryable: input.retryable ?? false,
  });
}

function availabilityState(model: BookingObjectWidget | null): BookingWidgetTelemetry["availability_state"] {
  const states = new Set(model?.data.slots.map((slot) => slot.state) ?? []);
  if (states.size === 0) return "unknown";
  if (states.size > 1) return "mixed";
  return [...states][0]!;
}

export function safeBookingWidgetTelemetry(input: {
  phase: BookingObjectPhase;
  model: BookingObjectWidget | null;
  render_duration_ms: number;
  outcome: BookingWidgetTelemetry["outcome"];
}): BookingWidgetTelemetry {
  const objectCount = Math.max(0, Math.min(100, input.model?.data.objects.length ?? 0));
  const slotCount = Math.max(0, Math.min(200, input.model?.data.slots.length ?? 0));
  return {
    widget: "booking_object",
    phase: input.phase,
    object_count_bucket: objectCount === 0 ? "0" : objectCount <= 20 ? "1-20" : objectCount <= 50 ? "21-50" : "51-100",
    slot_count_bucket: slotCount === 0 ? "0" : slotCount <= 20 ? "1-20" : slotCount <= 100 ? "21-100" : "101-200",
    availability_state: availabilityState(input.model),
    render_duration_ms: Math.max(0, Math.min(60_000, Math.round(input.render_duration_ms))),
    outcome: input.outcome,
  };
}
