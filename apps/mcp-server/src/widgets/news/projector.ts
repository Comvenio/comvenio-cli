import { z } from "zod";

import type { CapabilitySnapshot } from "@comvenio/auth";
import {
  NEWS_WIDGET_SCHEMA,
  SERVER_ACTION_DESCRIPTOR_SCHEMA,
  createConnectorError,
  normalizeRequestContext,
  type NewsArticle,
  type NewsWidget,
  type RequestContext,
  type ServerActionDescriptor,
} from "@comvenio/connector-contracts";

import { sanitizeNewsHtml } from "./sanitizer.ts";
import type { NewsWidgetActionPolicy, PrivateNewsProjectorInput, PublicNewsProjectorInput } from "./types.ts";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const publicArticle = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(2_000),
  sanitized_html: z.string().max(200_000).nullable().optional(),
  hero_url: z.string().url().nullable().optional(),
  published_at: instant,
  visibility_scope: z.literal("public").optional(),
  is_draft: z.literal(false).optional(),
  status: z.literal("published").optional(),
}).passthrough();
const publicSource = z.union([z.array(publicArticle).max(100), publicArticle]);
const privateSummary = z.object({
  news_id: uuid,
  title: z.string().trim().min(1).max(300),
  teaser: z.string().trim().max(2_000).nullable().optional(),
  category: z.string().trim().max(200).nullable().optional(),
  published_at: instant.nullable().optional(),
  is_draft: z.boolean().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
}).passthrough();
const privateList = z.union([
  z.array(privateSummary).max(100),
  z.object({ items: z.array(privateSummary).max(100), returned: z.number().int().min(0).optional(), truncated: z.boolean().optional() }).passthrough(),
]);
const privateDetail = privateSummary.extend({
  content: z.string().max(200_000).nullable().optional(),
  sanitized_html: z.string().max(200_000).nullable().optional(),
  hero_url: z.string().url().nullable().optional(),
}).passthrough();
const previewResult = z.object({
  news_id: uuid.optional(),
  sanitized_html: z.string().max(200_000).nullable().optional(),
  html: z.string().max(200_000).nullable().optional(),
  content: z.string().max(200_000).nullable().optional(),
  summary: z.string().trim().max(2_000).nullable().optional(),
  hero_url: z.string().url().nullable().optional(),
  expires_at: instant.optional(),
}).passthrough();

function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).protocol === "https:" ? value : null; }
  catch { return null; }
}

function status(value: z.infer<typeof privateSummary>): NewsArticle["status"] {
  if (value.status) return value.status;
  return value.is_draft === true ? "draft" : value.published_at ? "published" : "draft";
}

function bound(input: PrivateNewsProjectorInput): { context: RequestContext; snapshot: CapabilitySnapshot } {
  const context = normalizeRequestContext(input.context);
  const snapshot = input.capability_snapshot;
  if (!context.subject_id || !context.oauth_grant_id || !context.club_id) {
    throw createConnectorError({ code: "AUTH_REQUIRED", message: "Für Entwürfe und News-Verwaltung ist eine aktive Verbindung erforderlich.", request_id: context.request_id, retryable: false });
  }
  if (context.club_id !== input.club.club_id || snapshot.club_id !== input.club.club_id || snapshot.subject_id !== context.subject_id) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die News-Ansicht gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
  }
  if (!context.capability_version || context.capability_version !== snapshot.capability_version) {
    throw createConnectorError({ code: "PERMISSION_DENIED", message: "Die Berechtigungen haben sich geändert. Bitte lade die News-Ansicht neu.", request_id: context.request_id, retryable: false });
  }
  if (!context.scopes.includes("content.read") || (snapshot.permissions.read_news !== true && snapshot.permissions.manage_news !== true)) {
    throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Für die News-Ansicht fehlt die aktuelle Leseberechtigung.", request_id: context.request_id, retryable: false, required_scope: "content.read" });
  }
  return { context, snapshot };
}

function filteredActions(input: PrivateNewsProjectorInput, context: RequestContext, snapshot: CapabilitySnapshot, policy: NewsWidgetActionPolicy, selectedNewsId: string | null): ServerActionDescriptor[] {
  return (input.action_candidates ?? []).flatMap((candidate) => {
    const parsed = SERVER_ACTION_DESCRIPTOR_SCHEMA.safeParse(candidate);
    if (!parsed.success || parsed.data.visibility === "hidden") return [];
    const action = parsed.data;
    if (action.input === null || typeof action.input !== "object" || Array.isArray(action.input) || action.input.club_id !== input.club.club_id) return [];
    if (typeof action.input.news_id === "string" && action.input.news_id !== selectedNewsId) return [];
    if (/publish|veroeffentlich/iu.test(action.action_id) && (action.risk_class !== "critical_write" || !action.requires_confirmation)) return [];
    const decision = policy.evaluate({ context, capability_snapshot: snapshot, descriptor: action });
    return decision.allowed && decision.risk_class === action.risk_class && decision.requires_confirmation === action.requires_confirmation ? [action] : [];
  });
}

function articleFromPrivate(value: z.infer<typeof privateSummary>): NewsArticle {
  return {
    news_id: value.news_id,
    title: value.title,
    summary: value.teaser ?? "",
    hero_url: null,
    published_at: value.published_at ?? null,
    status: status(value),
    sanitized_html: null,
  };
}

export class NewsWidgetProjector {
  constructor(private readonly actionPolicy: NewsWidgetActionPolicy) {}

  public(input: PublicNewsProjectorInput): NewsWidget {
    const parsed = publicSource.parse(input.source);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const articles = items.map((item): NewsArticle => ({
      news_id: item.id,
      title: item.title,
      summary: item.summary,
      hero_url: httpsUrl(item.hero_url),
      published_at: item.published_at,
      status: "published",
      sanitized_html: sanitizeNewsHtml(item.sanitized_html),
    }));
    const selectedNewsId = input.selected_news_id ?? null;
    if (selectedNewsId && !articles.some((article) => article.news_id === selectedNewsId)) {
      throw createConnectorError({ code: "NOT_FOUND", message: "Der ausgewählte Beitrag ist nicht öffentlich verfügbar.", request_id: "00000000-0000-4000-8000-000000000000", retryable: false });
    }
    return NEWS_WIDGET_SCHEMA.parse({
      widget: "news", contract_version: "1.0.0", title: "News", club: input.club,
      capability_version: null, generated_at: input.generated_at ?? new Date().toISOString(),
      data: { filter: "public", articles, selected_news_id: selectedNewsId }, actions: [],
      empty_state: articles.length === 0 ? { title: "Keine veröffentlichten News", description: "Dieser Verein hat aktuell keine öffentlichen Beiträge." } : null,
    });
  }

  private(input: PrivateNewsProjectorInput): NewsWidget {
    const binding = bound(input);
    const parsed = privateList.parse(input.list_source);
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    const filter = input.filter ?? "all_authorized";
    let articles = items.map(articleFromPrivate).filter((article) => filter !== "draft" || article.status === "draft");
    const selectedNewsId = input.selected_news_id ?? null;
    if (selectedNewsId && !articles.some((article) => article.news_id === selectedNewsId)) {
      throw createConnectorError({ code: "NOT_FOUND", message: "Der ausgewählte Beitrag ist in dieser Ansicht nicht verfügbar.", request_id: binding.context.request_id, retryable: false });
    }
    if (selectedNewsId && input.detail_source) {
      const detail = privateDetail.parse(input.detail_source);
      if (detail.news_id !== selectedNewsId) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Detailantwort gehört nicht zum ausgewählten Beitrag.", request_id: binding.context.request_id, retryable: false });
      articles = articles.map((article) => article.news_id === selectedNewsId ? {
        ...article,
        title: detail.title,
        summary: detail.teaser ?? article.summary,
        hero_url: httpsUrl(detail.hero_url),
        published_at: detail.published_at ?? null,
        status: status(detail),
        sanitized_html: sanitizeNewsHtml(detail.sanitized_html ?? detail.content),
      } : article);
    }
    if (selectedNewsId && input.preview_source) {
      const preview = previewResult.parse(input.preview_source);
      if (preview.news_id && preview.news_id !== selectedNewsId) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Vorschau gehört nicht zum ausgewählten Beitrag.", request_id: binding.context.request_id, retryable: false });
      const expired = preview.expires_at !== undefined && Date.parse(preview.expires_at) <= Date.parse(input.generated_at ?? new Date().toISOString());
      articles = articles.map((article) => article.news_id === selectedNewsId ? {
        ...article,
        summary: preview.summary ?? article.summary,
        hero_url: httpsUrl(preview.hero_url) ?? article.hero_url,
        sanitized_html: expired ? null : sanitizeNewsHtml(preview.sanitized_html ?? preview.html ?? preview.content),
      } : article);
    }
    return NEWS_WIDGET_SCHEMA.parse({
      widget: "news", contract_version: "1.0.0", title: "News", club: input.club,
      capability_version: binding.snapshot.capability_version, generated_at: input.generated_at ?? new Date().toISOString(),
      data: { filter, articles, selected_news_id: selectedNewsId },
      actions: filteredActions(input, binding.context, binding.snapshot, this.actionPolicy, selectedNewsId),
      empty_state: articles.length === 0 ? { title: "Keine News gefunden", description: "Passe den Statusfilter an oder erstelle einen neuen Entwurf." } : null,
    });
  }
}

export function safeNewsPermissionChangedWidget(model: NewsWidget): NewsWidget {
  const articles = model.data.articles.filter((article) => article.status === "published").map((article) => ({ ...article, sanitized_html: null }));
  return NEWS_WIDGET_SCHEMA.parse({
    ...model, capability_version: null, data: { filter: "public", articles, selected_news_id: articles.some((article) => article.news_id === model.data.selected_news_id) ? model.data.selected_news_id : null },
    actions: [], empty_state: articles.length === 0 ? { title: "Keine veröffentlichten News", description: "Lade deine Berechtigungen neu, um verwaltende Inhalte zu sehen." } : null,
  });
}

export function safeNewsPreviewExpiredWidget(model: NewsWidget): NewsWidget {
  return NEWS_WIDGET_SCHEMA.parse({ ...model, data: { ...model.data, articles: model.data.articles.map((article) => article.news_id === model.data.selected_news_id ? { ...article, sanitized_html: null } : article) }, actions: [] });
}
