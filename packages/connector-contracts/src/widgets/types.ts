import type { IanaTimeZone, JsonValue, UUID } from "../index.ts";
import type { ActionRisk } from "../safety/types.ts";

export type WidgetKind =
  | "event_calendar"
  | "member_management"
  | "booking_object"
  | "news"
  | "confirmation";

export type ActionVisibility = "visible" | "hidden";

export interface ClubChip {
  club_id: UUID;
  name: string;
  timezone: IanaTimeZone;
}

export interface ServerActionDescriptor {
  action_id: string;
  label: string;
  tool_name: string;
  input: JsonValue;
  visibility: ActionVisibility;
  enabled: boolean;
  risk_class: ActionRisk;
  requires_confirmation: boolean;
  disabled_reason: string | null;
}

export interface WidgetEmptyState {
  title: string;
  description: string;
}

export interface WidgetEnvelope<T extends JsonValue, K extends WidgetKind = WidgetKind> {
  widget: K;
  contract_version: "1.0.0";
  title: string;
  club: ClubChip | null;
  capability_version: string | null;
  generated_at: string;
  data: T;
  actions: ServerActionDescriptor[];
  empty_state: WidgetEmptyState | null;
}

export interface EventCalendarEvent extends Record<string, JsonValue> {
  id: UUID;
  title: string;
  summary: string | null;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  status: "draft" | "published" | "cancelled";
  cover_url: string | null;
}

export interface EventCalendarData extends Record<string, JsonValue> {
  range: { from: string; to: string };
  view: "agenda" | "week" | "month";
  filters: { department_ids: UUID[]; query: string | null };
  events: EventCalendarEvent[];
}

export type EventSummaryCard = EventCalendarEvent;
export interface EventFilterBar {
  range: EventCalendarData["range"];
  view: EventCalendarData["view"];
  filters: EventCalendarData["filters"];
}
export type ClubContextChip = ClubChip;
export interface EventActionBar { actions: ServerActionDescriptor[]; }
export type EventCalendarWidget = WidgetEnvelope<EventCalendarData, "event_calendar">;

export type WidgetPhase =
  | "loading"
  | "empty"
  | "ready"
  | "partial"
  | "auth_required"
  | "permission_changed"
  | "error";

export interface EventCalendarWidgetState {
  phase: WidgetPhase;
  model: EventCalendarWidget | null;
  message: string | null;
  retryable: boolean;
}

export interface MemberSummaryRow extends Record<string, JsonValue> {
  member_id: UUID;
  display_name: string;
  status_label: string | null;
  department_labels: string[];
  email_masked: string | null;
  phone_masked: string | null;
}

export interface MemberDetailFields {
  first_name?: string;
  last_name?: string;
  email?: string | null;
  phone_number?: string | null;
  birthdate?: string | null;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  joined_at?: string | null;
  left_at?: string | null;
}

export type MemberDetailFieldName = keyof MemberDetailFields;

export interface MemberDetailPanel extends Record<string, JsonValue> {
  member_id: UUID;
  display_name: string;
  fields: MemberDetailFields & Record<string, JsonValue>;
  masked_fields: MemberDetailFieldName[];
  permission_explanation: string[];
}

export interface MemberManagementData extends Record<string, JsonValue> {
  query: string | null;
  rows: MemberSummaryRow[];
  selected: MemberDetailPanel | null;
}

export interface PermissionExplanation { messages: string[]; }
export interface MemberActionBar { actions: ServerActionDescriptor[]; }
export type MemberManagementWidget = WidgetEnvelope<MemberManagementData, "member_management"> & { club: ClubChip };

export type MemberManagementPhase =
  | "loading"
  | "empty"
  | "ready_basic"
  | "ready_detail"
  | "partial"
  | "auth_required"
  | "permission_changed"
  | "error";

export interface MemberManagementWidgetState {
  phase: MemberManagementPhase;
  model: MemberManagementWidget | null;
  message: string | null;
  retryable: boolean;
}
