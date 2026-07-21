import type { CapabilitySnapshot } from "@comvenio/auth";
import type {
  EventCalendarWidget,
  JsonValue,
  RequestContext,
  ServerActionDescriptor,
  UUID,
} from "@comvenio/connector-contracts";

export interface EventWidgetActionDecision {
  allowed: boolean;
  risk_class: ServerActionDescriptor["risk_class"];
  requires_confirmation: boolean;
}

export interface EventWidgetActionPolicy {
  evaluate(input: {
    context: RequestContext;
    capability_snapshot: CapabilitySnapshot;
    descriptor: ServerActionDescriptor;
  }): EventWidgetActionDecision;
}

export interface EventCalendarProjectorInput {
  club: { club_id: UUID; name: string; timezone: string };
  range: { from: string; to: string };
  view?: "agenda" | "week" | "month";
  filters?: { department_ids?: UUID[]; query?: string | null };
  source: JsonValue;
  generated_at?: string;
}

export interface PrivateEventCalendarProjectorInput extends EventCalendarProjectorInput {
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
  action_candidates?: ServerActionDescriptor[];
}

export interface EventWidgetTelemetry {
  widget: "event_calendar";
  phase: "loading" | "empty" | "ready" | "partial" | "auth_required" | "permission_changed" | "error";
  event_count_bucket: "0" | "1-20" | "21-100" | ">100";
  render_duration_ms: number;
  outcome: "success" | "rejected" | "failed";
}

export interface EventCalendarWidgetArtifact {
  resource_uri: "ui://comvenio/event-calendar";
  mime_type: "text/html;profile=mcp-app";
  model: EventCalendarWidget;
}
