import {
  MEMBER_MANAGEMENT_WIDGET_STATE_SCHEMA,
  type MemberManagementPhase,
  type MemberManagementWidget,
  type MemberManagementWidgetState,
} from "@comvenio/connector-contracts";

import { safeMemberPermissionChangedWidget } from "./projector.ts";
import type { MemberWidgetTelemetry } from "./types.ts";

export const MEMBER_WIDGET_FIRST_RENDER_BUDGET_MS = 1_000;
export const MEMBER_WIDGET_PAGE_MAX = 100;
export const MEMBER_DETAIL_MAX_AGE_SECONDS = 30;

export function memberManagementState(input: {
  phase: MemberManagementPhase;
  model?: MemberManagementWidget | null;
  message?: string | null;
  retryable?: boolean;
}): MemberManagementWidgetState {
  const model = input.phase === "permission_changed" && input.model
    ? safeMemberPermissionChangedWidget(input.model)
    : input.model ?? null;
  return MEMBER_MANAGEMENT_WIDGET_STATE_SCHEMA.parse({
    phase: input.phase,
    model,
    message: input.message ?? null,
    retryable: input.retryable ?? false,
  });
}

export function safeMemberWidgetTelemetry(input: {
  phase: MemberManagementPhase;
  row_count: number;
  detail_loaded: boolean;
  render_duration_ms: number;
  outcome: MemberWidgetTelemetry["outcome"];
}): MemberWidgetTelemetry {
  const count = Number.isSafeInteger(input.row_count) && input.row_count >= 0 ? input.row_count : 0;
  return {
    widget: "member_management",
    phase: input.phase,
    row_count_bucket: count === 0 ? "0" : count <= 20 ? "1-20" : count <= 50 ? "21-50" : "51-100",
    detail_loaded: input.detail_loaded,
    render_duration_ms: Math.max(0, Math.min(60_000, Math.round(input.render_duration_ms))),
    outcome: input.outcome,
  };
}
