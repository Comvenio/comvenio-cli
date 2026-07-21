import {
  EVENT_CALENDAR_WIDGET_STATE_SCHEMA,
  type EventCalendarWidget,
  type EventCalendarWidgetState,
  type WidgetPhase,
} from "@comvenio/connector-contracts";

import { safePermissionChangedWidget } from "./projector.ts";
import type { EventWidgetTelemetry } from "./types.ts";

export const WIDGET_FIRST_RENDER_BUDGET_MS = 1_000;
export const WIDGET_VIRTUALIZE_AFTER_EVENTS = 100;
export const WIDGET_CAPABILITY_MAX_AGE_SECONDS = 30;

export function eventCalendarState(input: {
  phase: WidgetPhase;
  model?: EventCalendarWidget | null;
  message?: string | null;
  retryable?: boolean;
}): EventCalendarWidgetState {
  const model = input.phase === "permission_changed" && input.model
    ? safePermissionChangedWidget(input.model)
    : input.model ?? null;
  return EVENT_CALENDAR_WIDGET_STATE_SCHEMA.parse({
    phase: input.phase,
    model,
    message: input.message ?? null,
    retryable: input.retryable ?? false,
  });
}

export function safeEventWidgetTelemetry(input: {
  phase: WidgetPhase;
  event_count: number;
  render_duration_ms: number;
  outcome: EventWidgetTelemetry["outcome"];
}): EventWidgetTelemetry {
  const count = Number.isSafeInteger(input.event_count) && input.event_count >= 0 ? input.event_count : 0;
  return {
    widget: "event_calendar",
    phase: input.phase,
    event_count_bucket: count === 0 ? "0" : count <= 20 ? "1-20" : count <= 100 ? "21-100" : ">100",
    render_duration_ms: Math.max(0, Math.min(60_000, Math.round(input.render_duration_ms))),
    outcome: input.outcome,
  };
}
