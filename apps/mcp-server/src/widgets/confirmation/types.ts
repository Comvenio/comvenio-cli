import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ActionPreviewView, ConfirmationChallenge } from "@comvenio/connector-contracts";
import type { ConfirmationWidget, ConfirmationWidgetPhase, JsonValue, RequestContext, ServerActionDescriptor, UUID } from "@comvenio/connector-contracts";

export interface ConfirmationWidgetDecision { allowed: boolean; }
export interface ConfirmationWidgetPolicy {
  evaluate(input: { context: RequestContext; capability_snapshot: CapabilitySnapshot; preview: ActionPreviewView }): ConfirmationWidgetDecision;
}
export interface ConfirmationWidgetProjectorInput {
  club: { club_id: UUID; name: string; timezone: string };
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
  challenge: ConfirmationChallenge | JsonValue;
  confirm_action: ServerActionDescriptor;
  generated_at?: string;
}
export interface ConfirmationWidgetTelemetry {
  widget: "confirmation";
  phase: ConfirmationWidgetPhase;
  effect_kind: "public" | "destructive" | "bulk" | "file" | "other";
  affected_count_bucket: "0" | "1" | "2-20" | "21-100" | ">100";
  render_duration_ms: number;
  outcome: "success" | "rejected" | "failed";
}
export interface ConfirmationWidgetArtifact { resource_uri: "ui://comvenio/action-confirmation"; mime_type: "text/html;profile=mcp-app"; model: ConfirmationWidget; }
