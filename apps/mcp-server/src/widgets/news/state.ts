import { NEWS_WIDGET_STATE_SCHEMA, type NewsWidget, type NewsWidgetPhase, type NewsWidgetState } from "@comvenio/connector-contracts";

import { safeNewsPermissionChangedWidget, safeNewsPreviewExpiredWidget } from "./projector.ts";
import type { NewsWidgetTelemetry } from "./types.ts";

export const NEWS_WIDGET_FIRST_RENDER_BUDGET_MS = 1_000;
export const NEWS_WIDGET_PAGE_MAX = 100;
export const NEWS_PREVIEW_MAX_AGE_SECONDS = 300;

export function newsWidgetState(input: { phase: NewsWidgetPhase; model?: NewsWidget | null; message?: string | null; retryable?: boolean }): NewsWidgetState {
  let model = input.model ?? null;
  if (input.phase === "permission_changed" && model) model = safeNewsPermissionChangedWidget(model);
  if (input.phase === "preview_expired" && model) model = safeNewsPreviewExpiredWidget(model);
  return NEWS_WIDGET_STATE_SCHEMA.parse({ phase: input.phase, model, message: input.message ?? null, retryable: input.retryable ?? false });
}

export function safeNewsWidgetTelemetry(input: { phase: NewsWidgetPhase; model: NewsWidget | null; render_duration_ms: number; outcome: NewsWidgetTelemetry["outcome"] }): NewsWidgetTelemetry {
  const count = Math.max(0, Math.min(100, input.model?.data.articles.length ?? 0));
  const selected = input.model?.data.articles.find((article) => article.news_id === input.model?.data.selected_news_id) ?? null;
  return {
    widget: "news", phase: input.phase,
    article_count_bucket: count === 0 ? "0" : count <= 20 ? "1-20" : count <= 50 ? "21-50" : "51-100",
    mode: input.model?.data.filter === "public" ? "public" : "manage",
    preview_loaded: selected?.sanitized_html != null,
    render_duration_ms: Math.max(0, Math.min(60_000, Math.round(input.render_duration_ms))), outcome: input.outcome,
  };
}
