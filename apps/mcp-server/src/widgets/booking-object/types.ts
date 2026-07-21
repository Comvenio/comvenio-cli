import type { CapabilitySnapshot } from "@comvenio/auth";
import type {
  BookingObjectPhase,
  BookingObjectWidget,
  JsonValue,
  RequestContext,
  ServerActionDescriptor,
  UUID,
} from "@comvenio/connector-contracts";

export interface BookingWidgetActionDecision {
  allowed: boolean;
  risk_class: ServerActionDescriptor["risk_class"];
  requires_confirmation: boolean;
}

export interface BookingWidgetActionPolicy {
  evaluate(input: {
    context: RequestContext;
    capability_snapshot: CapabilitySnapshot;
    descriptor: ServerActionDescriptor;
  }): BookingWidgetActionDecision;
}

export interface BookingObjectProjectorInput {
  club: { club_id: UUID; name: string; timezone: string };
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
  object_source: JsonValue;
  selected_object_id?: UUID | null;
  availability_source?: JsonValue | null;
  range: { from: string; to: string };
  action_candidates?: ServerActionDescriptor[];
  generated_at?: string;
}

export interface BookingWidgetTelemetry {
  widget: "booking_object";
  phase: BookingObjectPhase;
  object_count_bucket: "0" | "1-20" | "21-50" | "51-100";
  slot_count_bucket: "0" | "1-20" | "21-100" | "101-200";
  availability_state: "available" | "occupied" | "blocked" | "unknown" | "mixed";
  render_duration_ms: number;
  outcome: "success" | "rejected" | "failed";
}

export interface BookingObjectWidgetArtifact {
  resource_uri: "ui://comvenio/booking-object";
  mime_type: "text/html;profile=mcp-app";
  model: BookingObjectWidget;
}
