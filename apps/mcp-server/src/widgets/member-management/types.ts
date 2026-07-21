import type { CapabilitySnapshot } from "@comvenio/auth";
import type {
  JsonValue,
  MemberManagementPhase,
  MemberManagementWidget,
  RequestContext,
  ServerActionDescriptor,
  UUID,
} from "@comvenio/connector-contracts";

export interface MemberWidgetActionDecision {
  allowed: boolean;
  risk_class: ServerActionDescriptor["risk_class"];
  requires_confirmation: boolean;
}

export interface MemberWidgetActionPolicy {
  evaluate(input: {
    context: RequestContext;
    capability_snapshot: CapabilitySnapshot;
    descriptor: ServerActionDescriptor;
  }): MemberWidgetActionDecision;
}

export interface MemberManagementProjectorInput {
  club: { club_id: UUID; name: string; timezone: string };
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
  list_source: JsonValue;
  query?: string | null;
  detail_request?: { member_id: UUID; source: JsonValue; masked_fields?: string[] } | null;
  action_candidates?: ServerActionDescriptor[];
  generated_at?: string;
}

export interface MemberWidgetTelemetry {
  widget: "member_management";
  phase: MemberManagementPhase;
  row_count_bucket: "0" | "1-20" | "21-50" | "51-100";
  detail_loaded: boolean;
  render_duration_ms: number;
  outcome: "success" | "rejected" | "failed";
}

export interface MemberManagementWidgetArtifact {
  resource_uri: "ui://comvenio/member-management";
  mime_type: "text/html;profile=mcp-app";
  model: MemberManagementWidget;
}
