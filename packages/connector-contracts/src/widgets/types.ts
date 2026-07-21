import type { IanaTimeZone, JsonValue, UUID } from "../index.ts";
import type { ActionRisk } from "../safety/types.ts";
import type { ActionPreviewView } from "../safety/types.ts";

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

export interface BookingObjectSummary extends Record<string, JsonValue> {
  object_id: UUID;
  name: string;
  type: string;
  status: string;
}

export interface BookingSlot extends Record<string, JsonValue> {
  from: string;
  to: string;
  state: "available" | "occupied" | "blocked" | "unknown";
  booking_id: UUID | null;
  label: string;
}

export interface BookingObjectData extends Record<string, JsonValue> {
  range: { from: string; to: string };
  objects: BookingObjectSummary[];
  selected_object_id: UUID | null;
  slots: BookingSlot[];
}

export interface ObjectSelector { objects: BookingObjectSummary[]; selected_object_id: UUID | null; }
export interface BookingSlotGrid { slots: BookingSlot[]; timezone: IanaTimeZone; }
export interface AvailabilityBadge { state: BookingSlot["state"]; label: string; checked_at: string; }
export interface ReservationActionBar { actions: ServerActionDescriptor[]; }
export type BookingObjectWidget = WidgetEnvelope<BookingObjectData, "booking_object"> & { club: ClubChip };

export type BookingObjectPhase =
  | "loading"
  | "empty"
  | "ready"
  | "partial"
  | "conflict"
  | "auth_required"
  | "permission_changed"
  | "error";

export interface BookingObjectWidgetState {
  phase: BookingObjectPhase;
  model: BookingObjectWidget | null;
  message: string | null;
  retryable: boolean;
}

export interface NewsArticle extends Record<string, JsonValue> {
  news_id: UUID;
  title: string;
  summary: string;
  hero_url: string | null;
  published_at: string | null;
  status: "draft" | "published" | "archived";
  sanitized_html: string | null;
}

export interface NewsData extends Record<string, JsonValue> {
  filter: "public" | "draft" | "all_authorized";
  articles: NewsArticle[];
  selected_news_id: UUID | null;
}

export type NewsSummaryCard = NewsArticle;
export interface NewsPreviewPanel { article: NewsArticle | null; }
export interface NewsStatusFilter { value: NewsData["filter"]; options: NewsData["filter"][]; }
export interface NewsActionBar { actions: ServerActionDescriptor[]; }
export type NewsWidget = WidgetEnvelope<NewsData, "news"> & { club: ClubChip };

export type NewsWidgetPhase =
  | "loading"
  | "empty"
  | "ready_public"
  | "ready_manage"
  | "partial"
  | "preview_expired"
  | "auth_required"
  | "permission_changed"
  | "error";

export interface NewsWidgetState {
  phase: NewsWidgetPhase;
  model: NewsWidget | null;
  message: string | null;
  retryable: boolean;
}

export interface ConfirmationData extends Record<string, JsonValue> {
  preview: ActionPreviewView & Record<string, JsonValue>;
  confirmation_token: string;
  confirm_label: string;
  cancel_label: "Abbrechen";
  acknowledgement_required: boolean;
}

export interface ConfirmationPanel { data: ConfirmationData; club: ClubChip; }
export interface ImpactSummary { preview: ActionPreviewView; club: ClubChip; }
export interface MaskedFieldView { field_names: string[]; }
export interface ConfirmationActionBar { action: ServerActionDescriptor; cancel_label: "Abbrechen"; acknowledgement_required: boolean; }
export type ConfirmationWidget = Omit<WidgetEnvelope<ConfirmationData, "confirmation">, "capability_version"> & {
  club: ClubChip;
  capability_version: string;
};

export type ConfirmationWidgetPhase =
  | "loading"
  | "ready"
  | "confirming"
  | "success"
  | "cancelled"
  | "expired"
  | "stale"
  | "conflict"
  | "auth_required"
  | "permission_changed"
  | "error";

export interface ConfirmationWidgetState {
  phase: ConfirmationWidgetPhase;
  model: ConfirmationWidget | null;
  message: string | null;
  retryable: boolean;
}
