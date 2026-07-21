import { CONFIRMATION_WIDGET_STATE_SCHEMA, type ConfirmationWidget, type ConfirmationWidgetPhase, type ConfirmationWidgetState } from "@comvenio/connector-contracts";
import type { ConfirmationWidgetTelemetry } from "./types.ts";

export const CONFIRMATION_WIDGET_FIRST_RENDER_BUDGET_MS = 500;
export const CONFIRMATION_WIDGET_MAX_WIDTH_PX = 680;
export const CONFIRMATION_WIDGET_MAX_ACTIVE_INTENTS = 1;

export function confirmationWidgetState(input: { phase: ConfirmationWidgetPhase; model?: ConfirmationWidget | null; message?: string | null; retryable?: boolean }): ConfirmationWidgetState {
  return CONFIRMATION_WIDGET_STATE_SCHEMA.parse({ phase: input.phase, model: input.phase === "ready" ? input.model ?? null : null, message: input.message ?? null, retryable: input.retryable ?? false });
}

function effectKind(model: ConfirmationWidget | null): ConfirmationWidgetTelemetry["effect_kind"] {
  const impact = model?.data.preview.impact;
  if (!impact) return "other";
  if (impact.publishes > 0) return "public";
  if (impact.deletes > 0) return "destructive";
  if (impact.imports > 0 || impact.exports > 0) return "file";
  if (impact.affected_total > 20) return "bulk";
  return "other";
}

export function safeConfirmationWidgetTelemetry(input: { phase: ConfirmationWidgetPhase; model: ConfirmationWidget | null; render_duration_ms: number; outcome: ConfirmationWidgetTelemetry["outcome"] }): ConfirmationWidgetTelemetry {
  const count = Math.max(0, input.model?.data.preview.impact.affected_total ?? 0);
  return { widget: "confirmation", phase: input.phase, effect_kind: effectKind(input.model),
    affected_count_bucket: count === 0 ? "0" : count === 1 ? "1" : count <= 20 ? "2-20" : count <= 100 ? "21-100" : ">100",
    render_duration_ms: Math.max(0, Math.min(60_000, Math.round(input.render_duration_ms))), outcome: input.outcome };
}
