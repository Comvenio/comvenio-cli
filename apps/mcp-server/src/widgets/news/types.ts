import type { CapabilitySnapshot } from "@comvenio/auth";
import type {
  JsonValue,
  NewsWidget,
  NewsWidgetPhase,
  RequestContext,
  ServerActionDescriptor,
  UUID,
} from "@comvenio/connector-contracts";

export interface NewsWidgetActionDecision {
  allowed: boolean;
  risk_class: ServerActionDescriptor["risk_class"];
  requires_confirmation: boolean;
}

export interface NewsWidgetActionPolicy {
  evaluate(input: { context: RequestContext; capability_snapshot: CapabilitySnapshot; descriptor: ServerActionDescriptor }): NewsWidgetActionDecision;
}

export interface PublicNewsProjectorInput {
  club: { club_id: UUID; name: string; timezone: string };
  source: JsonValue;
  selected_news_id?: UUID | null;
  generated_at?: string;
}

export interface PrivateNewsProjectorInput {
  club: { club_id: UUID; name: string; timezone: string };
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
  list_source: JsonValue;
  filter?: "draft" | "all_authorized";
  selected_news_id?: UUID | null;
  detail_source?: JsonValue | null;
  preview_source?: JsonValue | null;
  action_candidates?: ServerActionDescriptor[];
  generated_at?: string;
}

export interface NewsWidgetTelemetry {
  widget: "news";
  phase: NewsWidgetPhase;
  article_count_bucket: "0" | "1-20" | "21-50" | "51-100";
  mode: "public" | "manage";
  preview_loaded: boolean;
  render_duration_ms: number;
  outcome: "success" | "rejected" | "failed";
}

export interface NewsWidgetArtifact {
  resource_uri: "ui://comvenio/news";
  mime_type: "text/html;profile=mcp-app";
  model: NewsWidget;
}
