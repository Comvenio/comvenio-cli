import type { NewsActionBar as NewsActionBarModel, NewsPreviewPanel as NewsPreviewPanelModel, NewsStatusFilter as NewsStatusFilterModel, NewsSummaryCard as NewsSummaryCardModel, NewsWidget as NewsWidgetModel } from "@comvenio/connector-contracts";

import { sanitizeNewsHtml } from "./sanitizer.ts";

function escapeHtml(value: string): string { return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!); }
function statusLabel(status: NewsSummaryCardModel["status"]): string { return status === "published" ? "Veröffentlicht" : status === "draft" ? "Entwurf" : "Archiviert"; }

export function NewsSummaryCard({ model, selected, index }: { model: NewsSummaryCardModel; selected: boolean; index: number }): string {
  const date = model.published_at ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(model.published_at)) : "Noch nicht veröffentlicht";
  return `<button type="button" class="news-card${selected ? " selected" : ""}" data-news-index="${index}" aria-pressed="${selected}"><span class="status status-${model.status}">${statusLabel(model.status)}</span><strong>${escapeHtml(model.title)}</strong><span class="meta">${escapeHtml(date)} · ${model.status === "published" ? "Öffentlich" : "Nur Verwaltung"}</span></button>`;
}

export function NewsPreviewPanel({ model }: { model: NewsPreviewPanelModel }): string {
  if (!model.article) return `<article class="preview news-preview"><p class="eyebrow">Homepage-Vorschau</p><h3>Beitrag auswählen</h3><p>Eine echte Vorschau wird erst nach Auswahl eines Beitrags geladen.</p></article>`;
  const article = model.article;
  const rich = sanitizeNewsHtml(article.sanitized_html);
  return `<article class="preview news-preview"><p class="eyebrow">Homepage-Vorschau</p>${article.hero_url ? `<img src="${escapeHtml(article.hero_url)}" alt="">` : ""}<h2>${escapeHtml(article.title)}</h2>${rich ? `<div class="rich-news">${rich}</div>` : `<p>${escapeHtml(article.summary || "Für diesen Beitrag ist keine sichere Inhaltsvorschau verfügbar.")}</p>`}<div class="meta"><span>${article.status === "published" ? "Öffentliche Website" : "Nicht öffentlich"}</span><span>Keine internen IDs</span></div></article>`;
}

export function NewsStatusFilter({ model }: { model: NewsStatusFilterModel }): string {
  const labels = { public: "Alle veröffentlichten", draft: "Nur Entwürfe", all_authorized: "Alle berechtigten" } as const;
  return `<label class="filter-label">Status<select class="field" aria-label="News-Status">${model.options.map((option) => `<option value="${option}"${option === model.value ? " selected" : ""}>${labels[option]}</option>`).join("")}</select></label>`;
}

export function NewsActionBar({ model }: { model: NewsActionBarModel }): string {
  const actions = model.actions.map((action, index) => action.enabled ? `<button class="btn ${action.risk_class === "critical_write" ? "btn-primary confirmation-intent" : "btn-secondary"}" type="button" data-action-index="${index}">${escapeHtml(action.risk_class === "critical_write" ? `Wirkung prüfen: ${action.label}` : action.label)}</button>` : "").join("");
  return actions ? `<div class="actions news-actions" aria-label="Erlaubte News-Aktionen">${actions}</div>` : "";
}

export function NewsWidget({ model }: { model: NewsWidgetModel }): string {
  const selected = model.data.articles.find((article) => article.news_id === model.data.selected_news_id) ?? null;
  const options = model.capability_version === null ? ["public" as const] : ["all_authorized" as const, "draft" as const];
  const empty = model.empty_state ? `<section class="state-panel"><h3>${escapeHtml(model.empty_state.title)}</h3><p>${escapeHtml(model.empty_state.description)}</p></section>` : "";
  return `<main class="page"><section class="widget" data-widget="news"><header class="widget-head"><div><p class="eyebrow">Comvenio · News</p><h2>${escapeHtml(model.title)}</h2><p>Öffentliche Beiträge lesen und berechtigte Entwürfe sicher verwalten.</p></div><div class="toolbar">${NewsStatusFilter({ model: { value: model.data.filter, options } })}${NewsActionBar({ model: { actions: model.actions.filter((action) => !action.input || typeof action.input !== "object" || Array.isArray(action.input) || !("news_id" in action.input)) } })}</div></header><div class="widget-body news-layout"><section class="stack news-list" aria-label="News-Beiträge">${empty}${model.data.articles.map((article, index) => NewsSummaryCard({ model: article, selected: article.news_id === model.data.selected_news_id, index })).join("")}</section>${NewsPreviewPanel({ model: { article: selected } })}</div>${NewsActionBar({ model: { actions: model.actions.filter((action) => action.input !== null && typeof action.input === "object" && !Array.isArray(action.input) && "news_id" in action.input) } })}</section></main>`;
}
