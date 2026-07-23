import { describe, expect, test } from "bun:test";

import type { CapabilitySnapshot } from "../../auth/src/index.ts";
import {
  BOOKING_OBJECT_WIDGET_SCHEMA,
  BOOKING_OBJECT_WIDGET_STATE_SCHEMA,
  CONFIRMATION_WIDGET_SCHEMA,
  CONFIRMATION_WIDGET_STATE_SCHEMA,
  EVENT_CALENDAR_WIDGET_SCHEMA,
  EVENT_CALENDAR_WIDGET_STATE_SCHEMA,
  MEMBER_MANAGEMENT_WIDGET_SCHEMA,
  MEMBER_MANAGEMENT_WIDGET_STATE_SCHEMA,
  NEWS_WIDGET_SCHEMA,
  NEWS_WIDGET_STATE_SCHEMA,
  type BookingObjectWidget,
  type ConfirmationChallenge,
  type ConfirmationWidget,
  type EventCalendarWidget,
  type MemberManagementWidget,
  type NewsWidget,
  type RequestContext,
  type ServerActionDescriptor,
} from "../src/index.ts";
import {
  AvailabilityBadge,
  BOOKING_OBJECT_WIDGET_ASSET_PATH,
  BOOKING_WIDGET_AVAILABILITY_MAX_AGE_SECONDS,
  BOOKING_OBJECT_WIDGET_CLIENT,
  BOOKING_OBJECT_WIDGET_CSP,
  BOOKING_WIDGET_OBJECT_MAX,
  BOOKING_OBJECT_WIDGET_RESOURCE_URI,
  BOOKING_WIDGET_SLOT_MAX,
  BOOKING_OBJECT_WIDGET_CSS,
  BOOKING_WIDGET_FIRST_RENDER_BUDGET_MS,
  BookingObjectWidget as renderBookingObjectWidget,
  BookingObjectWidgetProjector,
  BookingSlotGrid,
  BookingWidgetCapabilityPolicy,
  ObjectSelector,
  ReservationActionBar,
  bookingObjectState,
  bookingObjectToolMetadata,
  bookingObjectWidgetHtml,
  safeBookingWidgetTelemetry,
} from "../../../apps/mcp-server/src/widgets/booking-object/index.ts";
import {
  ClubContextChip,
  EVENT_CALENDAR_WIDGET_ASSET_PATH,
  EVENT_CALENDAR_WIDGET_CLIENT,
  EVENT_CALENDAR_WIDGET_CSP,
  EVENT_CALENDAR_WIDGET_RESOURCE_URI,
  EVENT_CALENDAR_WIDGET_CSS,
  EventActionBar,
  EventCalendarWidget as renderEventCalendarWidget,
  EventCalendarWidgetProjector,
  EventFilterBar,
  EventSummaryCard,
  EventWidgetCapabilityPolicy,
  WIDGET_CAPABILITY_MAX_AGE_SECONDS,
  WIDGET_FIRST_RENDER_BUDGET_MS,
  WIDGET_VIRTUALIZE_AFTER_EVENTS,
  eventCalendarState,
  eventCalendarToolMetadata,
  eventCalendarWidgetHtml,
  safeEventWidgetTelemetry,
} from "../../../apps/mcp-server/src/widgets/event-calendar/index.ts";
import {
  MEMBER_DETAIL_MAX_AGE_SECONDS,
  MEMBER_MANAGEMENT_WIDGET_ASSET_PATH,
  MEMBER_MANAGEMENT_WIDGET_CLIENT,
  MEMBER_MANAGEMENT_WIDGET_CSP,
  MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI,
  MEMBER_MANAGEMENT_WIDGET_CSS,
  MEMBER_WIDGET_FIRST_RENDER_BUDGET_MS,
  MEMBER_WIDGET_PAGE_MAX,
  MemberActionBar,
  MemberDetailPanel,
  MemberManagementWidget as renderMemberManagementWidget,
  MemberManagementWidgetProjector,
  MemberSummaryRow,
  MemberWidgetCapabilityPolicy,
  PermissionExplanation,
  memberManagementState,
  memberManagementToolMetadata,
  memberManagementWidgetHtml,
  safeMemberWidgetTelemetry,
} from "../../../apps/mcp-server/src/widgets/member-management/index.ts";
import {
  NEWS_PREVIEW_MAX_AGE_SECONDS,
  NEWS_WIDGET_ASSET_PATH,
  NEWS_WIDGET_CLIENT,
  NEWS_WIDGET_CSP,
  NEWS_WIDGET_CSS,
  NEWS_WIDGET_FIRST_RENDER_BUDGET_MS,
  NEWS_WIDGET_PAGE_MAX,
  NEWS_WIDGET_RESOURCE_URI,
  NewsActionBar,
  NewsPreviewPanel,
  NewsStatusFilter,
  NewsSummaryCard,
  NewsWidget as renderNewsWidget,
  NewsWidgetCapabilityPolicy,
  NewsWidgetProjector,
  newsToolMetadata,
  newsWidgetHtml,
  newsWidgetState,
  safeNewsWidgetTelemetry,
  sanitizeNewsHtml,
} from "../../../apps/mcp-server/src/widgets/news/index.ts";
import {
  CONFIRMATION_WIDGET_ASSET_PATH,
  CONFIRMATION_WIDGET_CLIENT,
  CONFIRMATION_WIDGET_CSP,
  CONFIRMATION_WIDGET_FIRST_RENDER_BUDGET_MS,
  CONFIRMATION_WIDGET_MAX_ACTIVE_INTENTS,
  CONFIRMATION_WIDGET_MAX_WIDTH_PX,
  CONFIRMATION_WIDGET_RESOURCE_URI,
  CONFIRMATION_WIDGET_CSS,
  ConfirmationActionBar,
  ConfirmationPanel,
  ConfirmationWidget as renderConfirmationWidget,
  ConfirmationWidgetCapabilityPolicy,
  ConfirmationWidgetProjector,
  ImpactSummary,
  MaskedFieldView,
  confirmationToolMetadata,
  confirmationWidgetHtml,
  confirmationWidgetState,
  safeConfirmationWidgetTelemetry,
} from "../../../apps/mcp-server/src/widgets/confirmation/index.ts";

const clubId = "33333333-3333-4333-8333-333333333333";
const subjectId = "22222222-2222-4222-8222-222222222222";
const capabilityVersion = "A".repeat(43);
const range = { from: "2026-07-20T00:00:00+02:00", to: "2026-07-27T00:00:00+02:00" };
const context: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "mcp",
  provider: "anthropic",
  subject_id: subjectId,
  oauth_grant_id: "55555555-5555-4555-8555-555555555555",
  club_id: clubId,
  department_id: null,
  scopes: ["event.read", "event.write"],
  capability_version: capabilityVersion,
  locale: "de-DE",
  timezone: "Europe/Berlin",
};
const capabilitySnapshot: CapabilitySnapshot = {
  subject_id: subjectId,
  member_id: "66666666-6666-4666-8666-666666666666",
  club_id: clubId,
  department_ids: [],
  permissions: { view_events: true, manage_events: true },
  sources: [],
  capability_version: capabilityVersion,
  generated_at: "2026-07-21T09:00:00+02:00",
  observed_at: "2026-07-21T09:00:00+02:00",
  expires_at: "2026-07-21T09:00:30+02:00",
};
const writeAction: ServerActionDescriptor = {
  action_id: "event.plan",
  label: "Termin planen",
  tool_name: "cv_event_create",
  input: {},
  visibility: "visible",
  enabled: true,
  risk_class: "reversible_write",
  requires_confirmation: false,
  disabled_reason: null,
};
const sourceEvent = {
  event_id: "77777777-7777-4777-8777-777777777777",
  title: "Sommerfest",
  description: "Gemeinsamer Abend am Vereinsheim.",
  start_time: "2026-07-21T17:00:00+02:00",
  end_time: "2026-07-22T01:00:00+02:00",
  location: "Vereinsheim",
  status: "published" as const,
};

function privateWidget(toolNames: Iterable<string> = [writeAction.tool_name]): EventCalendarWidget {
  return new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy(toolNames)).private({
    club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
    range,
    view: "week",
    source: [sourceEvent],
    context,
    capability_snapshot: capabilitySnapshot,
    action_candidates: [writeAction],
    generated_at: "2026-07-21T09:00:00+02:00",
  });
}

describe("K16 event calendar widget contracts", () => {
  test("TC-01/TC-02: all named entities render the validated mockup shell", () => {
    const model = privateWidget();
    expect(EVENT_CALENDAR_WIDGET_SCHEMA.parse(model)).toEqual(model);
    expect(EventSummaryCard({ model: model.data.events[0]!, timezone: model.club!.timezone, publicOnly: false, virtualized: false })).toContain("event-card");
    expect(EventFilterBar({ model: { range: model.data.range, view: model.data.view, filters: model.data.filters } })).toContain("toolbar");
    expect(ClubContextChip({ model: model.club })).toContain("context-chip");
    expect(EventActionBar({ model: { actions: model.actions } })).toContain("actions");
    const html = renderEventCalendarWidget({ model });
    expect(html).toContain("calendar calendar-grid");
    expect(html).toContain("widget-body split");
    expect(html).toContain("Termin planen");
    expect(html).not.toContain(sourceEvent.event_id);
    expect(html).not.toContain(clubId);
  });

  test("TC-03: responsive CSS provides a pure 390px agenda and bounded contracts", () => {
    expect(EVENT_CALENDAR_WIDGET_CSS).toContain("@media (max-width:559px)");
    expect(EVENT_CALENDAR_WIDGET_CSS).toContain(".calendar-grid{display:none}");
    expect(EVENT_CALENDAR_WIDGET_CSS).toContain("overflow-x:hidden");
    expect(EVENT_CALENDAR_WIDGET_CSS).toContain("min-height:44px");
    const model = privateWidget();
    const tooMany = structuredClone(model);
    tooMany.data.events = Array.from({ length: 201 }, () => structuredClone(model.data.events[0]!));
    expect(EVENT_CALENDAR_WIDGET_SCHEMA.safeParse(tooMany).success).toBe(false);
    const empty = new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy([])).public({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      range,
      source: [],
    });
    expect(empty.empty_state?.title).toBe("Keine Termine in diesem Zeitraum");
  });

  test("TC-04: anonymous projection exposes only the public allowlist", () => {
    const model = new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy([])).public({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      range,
      source: [{
        id: "77777777-7777-4777-8777-777777777777",
        title: "Sommerfest",
        summary: "Für alle",
        start: "2026-07-21T17:00:00+02:00",
        end: "2026-07-21T22:00:00+02:00",
        is_public: true,
        cover_url: "http://unsafe.example/event.jpg",
        internal_notes: "nicht ausgeben",
        organizer_email: "secret@example.org",
      }, {
        id: "88888888-8888-4888-8888-888888888888",
        title: "Vorstand intern",
        start: "2026-07-22T18:00:00+02:00",
        end: "2026-07-22T20:00:00+02:00",
        is_public: false,
      }],
    });
    expect(model.data.events).toHaveLength(1);
    expect(model.data.events[0]).toEqual({
      id: "77777777-7777-4777-8777-777777777777",
      title: "Sommerfest",
      summary: "Für alle",
      start: "2026-07-21T17:00:00+02:00",
      end: "2026-07-21T22:00:00+02:00",
      all_day: false,
      location: null,
      status: "published",
      cover_url: null,
    });
    expect(JSON.stringify(model)).not.toContain("secret@example.org");
    expect(model.actions).toEqual([]);
  });

  test("TC-05: event actions are absent unless the current server policy exposes them", () => {
    expect(privateWidget([]).actions).toEqual([]);
    expect(privateWidget().actions.map((action) => action.tool_name)).toEqual(["cv_event_create"]);
    expect(new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy([writeAction.tool_name])).private({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      range,
      source: [sourceEvent],
      context,
      capability_snapshot: { ...capabilitySnapshot, permissions: { view_events: true } },
      action_candidates: [writeAction],
    }).actions).toEqual([]);
  });

  test("TC-06: permission changes strip actions and safe telemetry contains no identifiers", () => {
    const model = privateWidget();
    const changed = eventCalendarState({ phase: "permission_changed", model, message: "Deine Rechte haben sich geändert. Lade den Kalender neu." });
    expect(changed.model?.actions).toEqual([]);
    expect(changed.model?.capability_version).toBeNull();
    const telemetry = safeEventWidgetTelemetry({ phase: "permission_changed", event_count: 1, render_duration_ms: 83.4, outcome: "rejected" });
    expect(telemetry).toEqual({ widget: "event_calendar", phase: "permission_changed", event_count_bucket: "1-20", render_duration_ms: 83, outcome: "rejected" });
    expect(JSON.stringify(telemetry)).not.toContain(clubId);
    expect(JSON.stringify(telemetry)).not.toContain(subjectId);
    expect(WIDGET_FIRST_RENDER_BUDGET_MS).toBe(1_000);
    expect(WIDGET_VIRTUALIZE_AFTER_EVENTS).toBe(100);
    expect(WIDGET_CAPABILITY_MAX_AGE_SECONDS).toBe(30);
  });

  test("covers loading, empty, ready, partial, auth, permission and error states", () => {
    const model = privateWidget();
    const empty = new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy([])).public({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" }, range, source: [],
    });
    const states = [
      eventCalendarState({ phase: "loading", message: "Kalender wird geladen." }),
      eventCalendarState({ phase: "empty", model: empty }),
      eventCalendarState({ phase: "ready", model }),
      eventCalendarState({ phase: "partial", model, message: "Ein Teil der Termine ist verfügbar.", retryable: true }),
      eventCalendarState({ phase: "auth_required", message: "Bitte verbinde Comvenio." }),
      eventCalendarState({ phase: "permission_changed", model, message: "Bitte neu laden." }),
      eventCalendarState({ phase: "error", model, message: "Kalender konnte nicht aktualisiert werden.", retryable: true }),
    ];
    expect(states.every((state) => EVENT_CALENDAR_WIDGET_STATE_SCHEMA.safeParse(state).success)).toBe(true);
    expect(() => eventCalendarState({ phase: "auth_required", model, message: "Bitte anmelden." })).toThrow();
  });

  test("uses the provider-neutral MCP Apps bridge and a constrained same-origin resource", () => {
    expect(EVENT_CALENDAR_WIDGET_RESOURCE_URI).toBe("ui://comvenio/event-calendar");
    expect(EVENT_CALENDAR_WIDGET_ASSET_PATH).toMatch(/^\/widgets\/event-calendar\/assets\/event-calendar\.[a-f0-9]{64}\.js$/u);
    expect(EVENT_CALENDAR_WIDGET_CLIENT).toContain("ui/notifications/tool-result");
    expect(EVENT_CALENDAR_WIDGET_CLIENT).toContain("tools/call");
    expect(EVENT_CALENDAR_WIDGET_CLIENT).not.toContain("window.openai");
    expect(EVENT_CALENDAR_WIDGET_CLIENT).not.toContain("fetch(");
    expect(() => new Function(EVENT_CALENDAR_WIDGET_CLIENT)).not.toThrow();
    expect(EVENT_CALENDAR_WIDGET_CSP).toContain("default-src 'none'");
    expect(EVENT_CALENDAR_WIDGET_CSP).toContain("object-src 'none'");
    const html = eventCalendarWidgetHtml("production");
    expect(html).toContain(`https://mcp.comvenio.app${EVENT_CALENDAR_WIDGET_ASSET_PATH}`);
    expect(html).not.toContain("<script>");
    expect(eventCalendarToolMetadata("production")._meta.ui.resourceUri).toBe(EVENT_CALENDAR_WIDGET_RESOURCE_URI);
  });
});

describe("K17 member management widget contracts", () => {
  const memberId = "88888888-8888-4888-8888-888888888888";
  const memberContext: RequestContext = {
    ...context,
    scopes: ["member.read.basic", "member.read.details", "admin.write"],
  };
  const memberCapability: CapabilitySnapshot = {
    ...capabilitySnapshot,
    permissions: { view_members: true, view_members_details: true, manage_members: true },
  };
  const row = {
    member_id: memberId,
    display_name: "Anna M.",
    status_label: "aktiv",
    department_labels: ["Team U18"],
    email_masked: "a***@b***.de",
    phone_masked: "***1234",
  };
  const detailAction: ServerActionDescriptor = {
    action_id: "member.detail",
    label: "Details anzeigen",
    tool_name: "cv_member_show",
    input: { member_id: memberId },
    visibility: "visible",
    enabled: true,
    risk_class: "read",
    requires_confirmation: false,
    disabled_reason: null,
  };
  const manageAction: ServerActionDescriptor = {
    action_id: "member.update",
    label: "Änderung vorbereiten",
    tool_name: "cv_member_update",
    input: { member_id: memberId },
    visibility: "visible",
    enabled: true,
    risk_class: "reversible_write",
    requires_confirmation: false,
    disabled_reason: null,
  };

  function memberWidget(input: { detail?: boolean; tools?: string[]; capability?: CapabilitySnapshot } = {}): MemberManagementWidget {
    const capability = input.capability ?? memberCapability;
    return new MemberManagementWidgetProjector(new MemberWidgetCapabilityPolicy(input.tools ?? [detailAction.tool_name, manageAction.tool_name])).project({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      context: memberContext,
      capability_snapshot: capability,
      list_source: { items: [row], limit: 50, offset: 0, total: 1 },
      detail_request: input.detail ? {
        member_id: memberId,
        source: {
          member_id: memberId,
          first_name: "Anna",
          last_name: "Muster",
          email: "anna@example.org",
          phone_number: "+49 123 4567",
          birthdate: "1990-05-10",
          address: "Vereinsweg 1",
          postal_code: "12345",
          city: "Musterstadt",
          state: "Bayern",
          country: "Deutschland",
          joined_at: "2022-01-01",
          left_at: null,
        },
        masked_fields: ["email"],
      } : null,
      action_candidates: [detailAction, manageAction],
      generated_at: "2026-07-21T09:00:00+02:00",
    });
  }

  test("TC-01/TC-02: all named member entities render the bound list/detail shell", () => {
    const model = memberWidget({ detail: true });
    expect(MEMBER_MANAGEMENT_WIDGET_SCHEMA.parse(model)).toEqual(model);
    expect(MemberSummaryRow({ model: model.data.rows[0]!, detailActionIndex: 0 })).toContain("member-row");
    expect(MemberDetailPanel({ model: model.data.selected })).toContain("member-detail-panel");
    expect(PermissionExplanation({ model: { messages: model.data.selected!.permission_explanation } })).toContain("permission-note");
    expect(MemberActionBar({ model: { actions: model.actions } })).toContain("actions");
    const html = renderMemberManagementWidget({ model });
    expect(html).toContain("member-layout");
    expect(html).toContain("preview member-detail-panel");
    expect(html).toContain("Details anzeigen");
    expect(html).not.toContain(memberId);
    expect(html).not.toContain(clubId);
  });

  test("TC-03: base rows reject raw personal fields and never prerender contacts", () => {
    const basic = memberWidget();
    const html = renderMemberManagementWidget({ model: basic });
    expect(html).not.toContain("anna@example.org");
    expect(html).not.toContain("a***@b***.de");
    expect(html).not.toContain("Vereinsweg");
    expect(MEMBER_MANAGEMENT_WIDGET_SCHEMA.safeParse({
      ...basic,
      data: { ...basic.data, rows: [{ ...row, email: "raw@example.org", birthdate: "1990-05-10" }] },
    }).success).toBe(false);
    expect(MEMBER_MANAGEMENT_WIDGET_CSS).toContain("@media (max-width:899px)");
    expect(MEMBER_MANAGEMENT_WIDGET_CSS).toContain("min-height:44px");
    expect(MEMBER_MANAGEMENT_WIDGET_CSS).toContain("overflow-x:hidden");
  });

  test("TC-04: details load only on explicit request with detail scope and capability", () => {
    expect(memberWidget().data.selected).toBeNull();
    const selected = memberWidget({ detail: true }).data.selected!;
    expect(selected.fields.first_name).toBe("Anna");
    expect(selected.fields.email).toBeUndefined();
    expect(selected.masked_fields).toEqual(["email"]);
    expect(() => memberWidget({
      detail: true,
      capability: { ...memberCapability, permissions: { view_members: true, view_members_details: false, manage_members: true } },
    })).toThrow();
  });

  test("TC-05: without manage_members all member writes disappear", () => {
    const noManage = memberWidget({
      capability: { ...memberCapability, permissions: { view_members: true, view_members_details: true, manage_members: false } },
    });
    expect(noManage.actions.map((action) => action.tool_name)).toEqual([detailAction.tool_name]);
    expect(memberWidget({ tools: [] }).actions).toEqual([]);
  });

  test("TC-06: permission change removes loaded details, actions and identifiers from telemetry", () => {
    const changed = memberManagementState({
      phase: "permission_changed",
      model: memberWidget({ detail: true }),
      message: "Deine Rechte haben sich geändert. Bitte lade die Ansicht neu.",
    });
    expect(changed.model?.data.selected).toBeNull();
    expect(changed.model?.actions).toEqual([]);
    expect(changed.model?.capability_version).toBeNull();
    const telemetry = safeMemberWidgetTelemetry({ phase: "permission_changed", row_count: 1, detail_loaded: false, render_duration_ms: 42.8, outcome: "rejected" });
    expect(telemetry).toEqual({ widget: "member_management", phase: "permission_changed", row_count_bucket: "1-20", detail_loaded: false, render_duration_ms: 43, outcome: "rejected" });
    expect(JSON.stringify(telemetry)).not.toContain(memberId);
    expect(JSON.stringify(telemetry)).not.toContain(clubId);
    expect(MEMBER_WIDGET_FIRST_RENDER_BUDGET_MS).toBe(1_000);
    expect(MEMBER_WIDGET_PAGE_MAX).toBe(100);
    expect(MEMBER_DETAIL_MAX_AGE_SECONDS).toBe(30);
  });

  test("validates every member state, empty state and the 100-row boundary", () => {
    const basic = memberWidget();
    const detail = memberWidget({ detail: true });
    const empty = new MemberManagementWidgetProjector(new MemberWidgetCapabilityPolicy([])).project({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      context: memberContext,
      capability_snapshot: memberCapability,
      list_source: { items: [], limit: 50, offset: 0, total: 0 },
    });
    const states = [
      memberManagementState({ phase: "loading", message: "Mitglieder werden geladen." }),
      memberManagementState({ phase: "empty", model: empty }),
      memberManagementState({ phase: "ready_basic", model: basic }),
      memberManagementState({ phase: "ready_detail", model: detail }),
      memberManagementState({ phase: "partial", model: basic, message: "Ein Teil ist verfügbar.", retryable: true }),
      memberManagementState({ phase: "auth_required", message: "Bitte verbinde Comvenio." }),
      memberManagementState({ phase: "permission_changed", model: detail, message: "Bitte neu laden." }),
      memberManagementState({ phase: "error", model: basic, message: "Ansicht nicht aktualisiert.", retryable: true }),
    ];
    expect(states.every((state) => MEMBER_MANAGEMENT_WIDGET_STATE_SCHEMA.safeParse(state).success)).toBe(true);
    const tooMany = structuredClone(basic);
    tooMany.data.rows = Array.from({ length: 101 }, () => structuredClone(row));
    expect(MEMBER_MANAGEMENT_WIDGET_SCHEMA.safeParse(tooMany).success).toBe(false);
  });

  test("uses a provider-neutral, CSP-constrained member resource", () => {
    expect(MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI).toBe("ui://comvenio/member-management");
    expect(MEMBER_MANAGEMENT_WIDGET_ASSET_PATH).toMatch(/^\/widgets\/member-management\/assets\/member-management\.[a-f0-9]{64}\.js$/u);
    expect(MEMBER_MANAGEMENT_WIDGET_CLIENT).toContain("ui/notifications/tool-result");
    expect(MEMBER_MANAGEMENT_WIDGET_CLIENT).toContain("tools/call");
    expect(MEMBER_MANAGEMENT_WIDGET_CLIENT).not.toContain("window.openai");
    expect(MEMBER_MANAGEMENT_WIDGET_CLIENT).not.toContain("fetch(");
    expect(() => new Function(MEMBER_MANAGEMENT_WIDGET_CLIENT)).not.toThrow();
    expect(MEMBER_MANAGEMENT_WIDGET_CSP).toContain("default-src 'none'");
    expect(memberManagementWidgetHtml("production")).toContain(`https://mcp.comvenio.app${MEMBER_MANAGEMENT_WIDGET_ASSET_PATH}`);
    expect(memberManagementToolMetadata("production")._meta.ui.resourceUri).toBe(MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI);
  });
});

describe("K18 booking object widget contracts", () => {
  const objectId = "91919191-9191-4191-8191-919191919191";
  const bookingContext: RequestContext = {
    ...context,
    scopes: ["object.read", "booking.read", "booking.write"],
  };
  const bookingCapability: CapabilitySnapshot = { ...capabilitySnapshot, permissions: {} };
  const objectSource = [{
    id: objectId,
    club_id: clubId,
    name: "Tennisplatz 1",
    object_type: "Sportplatz",
    is_active: true,
    contact_email: "private@example.org",
  }];
  const availability = {
    club_id: clubId,
    object_id: objectId,
    from: range.from,
    to: range.to,
    timezone: "Europe/Berlin",
    status: "AVAILABLE" as const,
    slots: [{ from: range.from, to: range.to, status: "AVAILABLE" as const, reason: null }],
    booking_rules_observed: 1,
  };
  const selectAction: ServerActionDescriptor = {
    action_id: "object.availability",
    label: "Verfügbarkeit anzeigen",
    tool_name: "cv_object_availability",
    input: { object_id: objectId },
    visibility: "visible",
    enabled: true,
    risk_class: "read",
    requires_confirmation: false,
    disabled_reason: null,
  };
  const reserveAction: ServerActionDescriptor = {
    action_id: "booking.create",
    label: "Reservierung vorbereiten",
    tool_name: "cv_booking_create",
    input: { object_id: objectId, start_time: range.from, end_time: range.to, timezone: "Europe/Berlin" },
    visibility: "visible",
    enabled: true,
    risk_class: "critical_write",
    requires_confirmation: true,
    disabled_reason: null,
  };

  function bookingWidget(tools: string[] = [selectAction.tool_name, reserveAction.tool_name]): BookingObjectWidget {
    return new BookingObjectWidgetProjector(new BookingWidgetCapabilityPolicy(tools)).project({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      context: bookingContext,
      capability_snapshot: bookingCapability,
      object_source: objectSource,
      selected_object_id: objectId,
      availability_source: availability,
      range,
      action_candidates: [selectAction, reserveAction],
      generated_at: "2026-07-21T09:00:00+02:00",
    });
  }

  test("TC-01/TC-02: all named booking entities render the bound mockup shell", () => {
    const model = bookingWidget();
    expect(BOOKING_OBJECT_WIDGET_SCHEMA.parse(model)).toEqual(model);
    expect(ObjectSelector({ model: { objects: model.data.objects, selected_object_id: objectId } })).toContain("object-selector");
    expect(BookingSlotGrid({ model: { slots: model.data.slots, timezone: model.club.timezone } })).toContain("slot-grid");
    expect(AvailabilityBadge({ model: { state: "available", label: "frei", checked_at: model.generated_at } })).toContain("frei");
    expect(ReservationActionBar({ model: { actions: model.actions } })).toContain("Vorschau");
    const html = renderBookingObjectWidget({ model });
    expect(html).toContain("booking-layout");
    expect(html).toContain("Tennisplatz 1");
    expect(html).not.toContain(objectId);
    expect(html).not.toContain(clubId);
    expect(JSON.stringify(model)).not.toContain("private@example.org");
  });

  test("TC-03: 390px layout has two bounded slots and textual states", () => {
    expect(BOOKING_OBJECT_WIDGET_CSS).toContain("@media (max-width:559px)");
    expect(BOOKING_OBJECT_WIDGET_CSS).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(BOOKING_OBJECT_WIDGET_CSS).toContain("overflow-x:hidden");
    expect(BOOKING_OBJECT_WIDGET_CSS).toContain("min-height:44px");
    const model = bookingWidget();
    expect(renderBookingObjectWidget({ model })).toContain("frei");
    const tooMany = structuredClone(model);
    tooMany.data.slots = Array.from({ length: 201 }, () => structuredClone(model.data.slots[0]!));
    expect(BOOKING_OBJECT_WIDGET_SCHEMA.safeParse(tooMany).success).toBe(false);
  });

  test("TC-04: foreign-club objects and availability are rejected instead of filtered", () => {
    const projector = new BookingObjectWidgetProjector(new BookingWidgetCapabilityPolicy([]));
    const base = {
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      context: bookingContext,
      capability_snapshot: bookingCapability,
      selected_object_id: objectId,
      range,
    } as const;
    expect(() => projector.project({ ...base, object_source: [{ ...objectSource[0], club_id: "44444444-4444-4444-8444-444444444444" }] })).toThrow();
    expect(() => projector.project({ ...base, object_source: objectSource, availability_source: { ...availability, club_id: "44444444-4444-4444-8444-444444444444" } })).toThrow();
  });

  test("TC-05: reservation intent is preview-only and governed by current policy", () => {
    expect(bookingWidget([]).actions).toEqual([]);
    expect(bookingWidget().actions.map((action) => action.tool_name)).toEqual([selectAction.tool_name, reserveAction.tool_name]);
    expect(bookingWidget().actions[1]).toMatchObject({ risk_class: "critical_write", requires_confirmation: true });
    const unsafe = { ...reserveAction, risk_class: "reversible_write" as const, requires_confirmation: false };
    const projected = new BookingObjectWidgetProjector(new BookingWidgetCapabilityPolicy([unsafe.tool_name])).project({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" }, context: bookingContext,
      capability_snapshot: bookingCapability, object_source: objectSource, selected_object_id: objectId,
      availability_source: availability, range, action_candidates: [unsafe],
    });
    expect(projected.actions).toEqual([]);
  });

  test("TC-06: conflict replaces stale availability and removes reservation actions", () => {
    const model = bookingWidget();
    const current = {
      ...availability,
      status: "BUSY" as const,
      slots: [{ from: range.from, to: range.to, status: "BUSY" as const, reason: "RESERVATION_CONFLICT" }],
    };
    const conflict = bookingObjectState({ phase: "conflict", model, current_availability: current, message: "Der Zeitraum wurde inzwischen belegt. Wähle eine aktuelle Alternative." });
    expect(conflict.model?.actions).toEqual([]);
    expect(conflict.model?.data.slots).toEqual([{ from: range.from, to: range.to, state: "occupied", booking_id: null, label: "belegt" }]);
    expect(BOOKING_OBJECT_WIDGET_STATE_SCHEMA.parse(conflict)).toEqual(conflict);
    const permission = bookingObjectState({ phase: "permission_changed", model, message: "Bitte neu laden." });
    expect(permission.model?.actions).toEqual([]);
    expect(permission.model?.capability_version).toBeNull();
    const telemetry = safeBookingWidgetTelemetry({ phase: "conflict", model: conflict.model, render_duration_ms: 33.7, outcome: "rejected" });
    expect(telemetry).toMatchObject({ widget: "booking_object", phase: "conflict", object_count_bucket: "1-20", slot_count_bucket: "1-20", availability_state: "occupied", render_duration_ms: 34 });
    expect(JSON.stringify(telemetry)).not.toContain(objectId);
    expect(JSON.stringify(telemetry)).not.toContain(clubId);
    expect(BOOKING_WIDGET_FIRST_RENDER_BUDGET_MS).toBe(1_000);
    expect(BOOKING_WIDGET_AVAILABILITY_MAX_AGE_SECONDS).toBe(30);
    expect(BOOKING_WIDGET_OBJECT_MAX).toBe(100);
    expect(BOOKING_WIDGET_SLOT_MAX).toBe(200);
  });

  test("covers safe states and the provider-neutral MCP App resource", () => {
    const model = bookingWidget();
    const empty = new BookingObjectWidgetProjector(new BookingWidgetCapabilityPolicy([])).project({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" }, context: bookingContext,
      capability_snapshot: bookingCapability, object_source: [], range,
    });
    const states = [
      bookingObjectState({ phase: "loading", message: "Buchungsansicht wird geladen." }),
      bookingObjectState({ phase: "empty", model: empty }),
      bookingObjectState({ phase: "ready", model }),
      bookingObjectState({ phase: "partial", model, message: "Ein Teil der Verfügbarkeit fehlt.", retryable: true }),
      bookingObjectState({ phase: "auth_required", message: "Bitte verbinde Comvenio." }),
      bookingObjectState({ phase: "permission_changed", model, message: "Bitte neu laden." }),
      bookingObjectState({ phase: "error", model, message: "Ansicht nicht aktualisiert.", retryable: true }),
    ];
    expect(states.every((state) => BOOKING_OBJECT_WIDGET_STATE_SCHEMA.safeParse(state).success)).toBe(true);
    expect(BOOKING_OBJECT_WIDGET_RESOURCE_URI).toBe("ui://comvenio/booking-object");
    expect(BOOKING_OBJECT_WIDGET_ASSET_PATH).toMatch(/^\/widgets\/booking-object\/assets\/booking-object\.[a-f0-9]{64}\.js$/u);
    expect(BOOKING_OBJECT_WIDGET_CLIENT).toContain("ui/notifications/tool-result");
    expect(BOOKING_OBJECT_WIDGET_CLIENT).toContain("tools/call");
    expect(BOOKING_OBJECT_WIDGET_CLIENT).not.toContain("window.openai");
    expect(BOOKING_OBJECT_WIDGET_CLIENT).not.toContain("fetch(");
    expect(() => new Function(BOOKING_OBJECT_WIDGET_CLIENT)).not.toThrow();
    expect(BOOKING_OBJECT_WIDGET_CSP).toContain("default-src 'none'");
    expect(bookingObjectWidgetHtml("production")).toContain(`https://mcp.comvenio.app${BOOKING_OBJECT_WIDGET_ASSET_PATH}`);
    expect(bookingObjectToolMetadata("production")._meta.ui.resourceUri).toBe(BOOKING_OBJECT_WIDGET_RESOURCE_URI);
  });
});

describe("K19 news widget contracts", () => {
  const newsId = "93939393-9393-4393-8393-939393939393";
  const draftId = "94949494-9494-4494-8494-949494949494";
  const newsContext: RequestContext = { ...context, scopes: ["content.read", "content.write"] };
  const newsCapability: CapabilitySnapshot = { ...capabilitySnapshot, permissions: { read_news: true, manage_news: true } };
  const manageList = { items: [
    { news_id: newsId, title: "Jugendturnier", teaser: "Ein sportlicher Tag.", category: "Verein", published_at: "2026-07-18T10:00:00+02:00", is_draft: false },
    { news_id: draftId, title: "Neue Trainingszeiten", teaser: "Vorschau", category: "Training", published_at: null, is_draft: true },
  ], returned: 2, truncated: false };
  const selectAction: ServerActionDescriptor = { action_id: "news.show", label: "Vorschau anzeigen", tool_name: "cv_news_show", input: { news_id: newsId }, visibility: "visible", enabled: true, risk_class: "read", requires_confirmation: false, disabled_reason: null };
  const draftAction: ServerActionDescriptor = { action_id: "news.create.draft", label: "Entwurf erstellen", tool_name: "cv_news_create_draft", input: {}, visibility: "visible", enabled: true, risk_class: "reversible_write", requires_confirmation: false, disabled_reason: null };
  const publishAction: ServerActionDescriptor = { action_id: "news.publish", label: "Publikation vorbereiten", tool_name: "cv_news_publish", input: { news_id: newsId }, visibility: "visible", enabled: true, risk_class: "critical_write", requires_confirmation: true, disabled_reason: null };

  function manageWidget(tools: string[] = [selectAction.tool_name, draftAction.tool_name, publishAction.tool_name]): NewsWidget {
    return new NewsWidgetProjector(new NewsWidgetCapabilityPolicy(tools)).private({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" }, context: newsContext,
      capability_snapshot: newsCapability, list_source: manageList, filter: "all_authorized", selected_news_id: newsId,
      detail_source: { news_id: newsId, title: "Jugendturnier", teaser: "Ein sportlicher Tag.", published_at: "2026-07-18T10:00:00+02:00", is_draft: false, content: `<h2 onclick="steal()">Rückblick</h2><p>Viele <strong>Helferinnen</strong>.</p><script>steal()</script><a href="https://comvenio.de/news" style="color:red">Mehr</a><iframe src="https://evil.example"></iframe>` },
      preview_source: { news_id: newsId, html: `<h2>Homepage-Vorschau</h2><p>Ein <em>sportlicher</em> Tag.</p>`, expires_at: "2026-07-21T09:05:00+02:00" },
      action_candidates: [selectAction, draftAction, publishAction], generated_at: "2026-07-21T09:00:00+02:00",
    });
  }

  test("TC-01/TC-02: all named News entities render the NWS-01 list/preview shell", () => {
    const model = manageWidget();
    expect(NEWS_WIDGET_SCHEMA.parse(model)).toEqual(model);
    expect(NewsSummaryCard({ model: model.data.articles[0]!, selected: true, index: 0 })).toContain("news-card");
    expect(NewsPreviewPanel({ model: { article: model.data.articles[0]! } })).toContain("Homepage-Vorschau");
    expect(NewsStatusFilter({ model: { value: "all_authorized", options: ["all_authorized", "draft"] } })).toContain("Nur Entwürfe");
    expect(NewsActionBar({ model: { actions: model.actions } })).toContain("Wirkung prüfen");
    const html = renderNewsWidget({ model });
    expect(html).toContain("news-layout");
    expect(html).toContain("Jugendturnier");
    expect(html).not.toContain(newsId);
    expect(html).not.toContain(clubId);
    expect(html).not.toContain("Jetzt veröffentlichen");
    expect(html).not.toContain("DirectPublishButton");
  });

  test("TC-03: anonymous status is public-only and raw drafts fail closed", () => {
    const projector = new NewsWidgetProjector(new NewsWidgetCapabilityPolicy([]));
    const model = projector.public({ club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" }, selected_news_id: newsId, source: [{ id: newsId, title: "Jugendturnier", summary: "Öffentlicher Rückblick", published_at: "2026-07-18T10:00:00+02:00", visibility_scope: "public", is_draft: false }] });
    expect(model.data.filter).toBe("public");
    expect(model.data.articles.every((article) => article.status === "published")).toBe(true);
    expect(model.actions).toEqual([]);
    expect(model.capability_version).toBeNull();
    expect(NewsStatusFilter({ model: { value: model.data.filter, options: ["public"] } })).not.toContain("Entwürfe");
    expect(() => projector.public({ club: model.club, source: [{ id: draftId, title: "Leaker", summary: "intern", published_at: "2026-07-18T10:00:00+02:00", is_draft: true }] })).toThrow();
    const tooMany = structuredClone(model);
    tooMany.data.articles = Array.from({ length: 101 }, () => structuredClone(model.data.articles[0]!));
    expect(NEWS_WIDGET_SCHEMA.safeParse(tooMany).success).toBe(false);
  });

  test("TC-04: preview uses doubly allowlisted rich content with safe text fallback", () => {
    const sanitized = sanitizeNewsHtml(`<h2 onclick="x()">Titel</h2><p>Text</p><script>secret()</script><a href="http://unsafe.example">Unsicher</a><a href="https://comvenio.de">Sicher</a>`)!;
    expect(sanitized).toContain("<h2>Titel</h2>");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("script");
    expect(sanitized).not.toContain("http://unsafe");
    expect(sanitized).toContain(`target="_blank" rel="noopener noreferrer"`);
    expect(NEWS_WIDGET_SCHEMA.safeParse({ ...manageWidget(), data: { ...manageWidget().data, articles: [{ ...manageWidget().data.articles[0], sanitized_html: `<img src=x onerror=steal()>` }, manageWidget().data.articles[1]] } }).success).toBe(false);
    const article = { ...manageWidget().data.articles[0]!, sanitized_html: null, summary: `<script>nicht rendern</script>` };
    const html = NewsPreviewPanel({ model: { article } });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("TC-05/TC-06: management actions require current manage rights and publish stays a confirmation intent", () => {
    expect(manageWidget([]).actions).toEqual([]);
    const model = manageWidget();
    expect(model.actions.map((action) => action.tool_name)).toEqual([selectAction.tool_name, draftAction.tool_name, publishAction.tool_name]);
    expect(model.actions[2]).toMatchObject({ risk_class: "critical_write", requires_confirmation: true });
    const noManage = new NewsWidgetProjector(new NewsWidgetCapabilityPolicy([selectAction.tool_name, draftAction.tool_name, publishAction.tool_name])).private({
      club: model.club, context: { ...newsContext, scopes: ["content.read"] }, capability_snapshot: { ...newsCapability, permissions: { read_news: true, manage_news: false } },
      list_source: manageList, selected_news_id: newsId, action_candidates: [selectAction, draftAction, publishAction],
    });
    expect(noManage.actions.map((action) => action.tool_name)).toEqual([selectAction.tool_name]);
    const unsafePublish = { ...publishAction, risk_class: "reversible_write" as const, requires_confirmation: false };
    const unsafeModel = new NewsWidgetProjector(new NewsWidgetCapabilityPolicy([unsafePublish.tool_name])).private({ club: model.club, context: newsContext, capability_snapshot: newsCapability, list_source: manageList, selected_news_id: newsId, action_candidates: [unsafePublish] });
    expect(unsafeModel.actions).toEqual([]);
  });

  test("safe states discard expired preview and all private data after permission changes", () => {
    const model = manageWidget();
    const expired = newsWidgetState({ phase: "preview_expired", model, message: "Die Vorschau ist abgelaufen. Bitte erneuern." });
    expect(expired.model?.data.articles.find((article) => article.news_id === newsId)?.sanitized_html).toBeNull();
    expect(expired.model?.actions).toEqual([]);
    const changed = newsWidgetState({ phase: "permission_changed", model, message: "Deine Rechte haben sich geändert." });
    expect(changed.model?.data.filter).toBe("public");
    expect(changed.model?.data.articles.every((article) => article.status === "published")).toBe(true);
    expect(changed.model?.data.articles.some((article) => article.news_id === draftId)).toBe(false);
    expect(changed.model?.actions).toEqual([]);
    expect(changed.model?.capability_version).toBeNull();
    const publicModel = new NewsWidgetProjector(new NewsWidgetCapabilityPolicy([])).public({ club: model.club, source: [] });
    const states = [newsWidgetState({ phase: "loading", message: "News werden geladen." }), newsWidgetState({ phase: "empty", model: publicModel }), newsWidgetState({ phase: "ready_public", model: new NewsWidgetProjector(new NewsWidgetCapabilityPolicy([])).public({ club: model.club, source: [{ id: newsId, title: "X", summary: "Y", published_at: "2026-07-18T10:00:00+02:00" }] }) }), newsWidgetState({ phase: "ready_manage", model }), newsWidgetState({ phase: "partial", model, message: "Ein Teil fehlt." }), expired, newsWidgetState({ phase: "auth_required", message: "Bitte verbinden." }), changed, newsWidgetState({ phase: "error", model, message: "Nicht aktualisiert.", retryable: true })];
    expect(states.every((state) => NEWS_WIDGET_STATE_SCHEMA.safeParse(state).success)).toBe(true);
  });

  test("telemetry, responsive shell and MCP App resource remain provider-neutral", () => {
    const model = manageWidget();
    const telemetry = safeNewsWidgetTelemetry({ phase: "ready_manage", model, render_duration_ms: 44.6, outcome: "success" });
    expect(telemetry).toMatchObject({ widget: "news", article_count_bucket: "1-20", mode: "manage", preview_loaded: true, render_duration_ms: 45 });
    expect(JSON.stringify(telemetry)).not.toContain(newsId);
    expect(JSON.stringify(telemetry)).not.toContain(clubId);
    expect(NEWS_WIDGET_FIRST_RENDER_BUDGET_MS).toBe(1_000);
    expect(NEWS_WIDGET_PAGE_MAX).toBe(100);
    expect(NEWS_PREVIEW_MAX_AGE_SECONDS).toBe(300);
    expect(NEWS_WIDGET_CSS).toContain("@media (max-width:559px)");
    expect(NEWS_WIDGET_CSS).toContain("overflow-x:hidden");
    expect(NEWS_WIDGET_CSS).toContain("min-height:44px");
    expect(NEWS_WIDGET_RESOURCE_URI).toBe("ui://comvenio/news");
    expect(NEWS_WIDGET_ASSET_PATH).toMatch(/^\/widgets\/news\/assets\/news\.[a-f0-9]{64}\.js$/u);
    expect(NEWS_WIDGET_CLIENT).toContain("ui/notifications/tool-result");
    expect(NEWS_WIDGET_CLIENT).toContain("tools/call");
    expect(NEWS_WIDGET_CLIENT).not.toContain("window.openai");
    expect(NEWS_WIDGET_CLIENT).not.toContain("fetch(");
    expect(() => new Function(NEWS_WIDGET_CLIENT)).not.toThrow();
    expect(NEWS_WIDGET_CSP).toContain("frame-src 'none'");
    expect(newsWidgetHtml("production")).toContain(`https://mcp.comvenio.app${NEWS_WIDGET_ASSET_PATH}`);
    expect(newsToolMetadata("production")._meta.ui.resourceUri).toBe(NEWS_WIDGET_RESOURCE_URI);
  });
});

describe("K20 universal preview and confirmation widget contracts", () => {
  const previewId = "97979797-9797-4797-8797-979797979797";
  const newsId = "98989898-9898-4898-8898-989898989898";
  const idempotencyKey = "99999999-9999-4999-8999-999999999999";
  const criticalToolName = "cv_news_publish_critical_12345678";
  const confirmationToken = "T".repeat(43);
  const confirmationContext: RequestContext = { ...context, scopes: ["content.write"] };
  const confirmationCapability: CapabilitySnapshot = { ...capabilitySnapshot, permissions: { manage_news: true } };

  function challenge(overrides: Partial<ConfirmationChallenge> = {}): ConfirmationChallenge {
    return {
      preview: {
        preview_id: previewId,
        request_id: context.request_id,
        club_id: clubId,
        tool_name: criticalToolName,
        risk_class: "critical_write",
        target: { type: "news", id: newsId, label: "Jugendturnier" },
        impact: { creates: 0, updates: 0, deletes: 0, publishes: 1, imports: 0, exports: 0, affected_total: 1, summary: "Ein Beitrag wird öffentlich sichtbar." },
        safe_summary: "Der Beitrag Jugendturnier wird veröffentlicht.",
        masked_fields: ["bank_account", "contact_email"],
        expires_at: "2026-07-21T09:05:00+02:00",
      },
      confirmation_token: confirmationToken,
      confirm_label: "News veröffentlichen",
      cancel_label: "Abbrechen",
      acknowledgement_required: true,
      ...overrides,
    };
  }

  function confirmAction(input: Record<string, unknown> = {}): ServerActionDescriptor {
    return {
      action_id: "action.confirm",
      label: "Jetzt bestätigen",
      tool_name: "action_confirm",
      input: {
        preview_id: previewId,
        confirmation_token: confirmationToken,
        idempotency_key: idempotencyKey,
        ...input,
      },
      visibility: "visible",
      enabled: true,
      risk_class: "critical_write",
      requires_confirmation: true,
      disabled_reason: null,
    };
  }

  function widget(): ConfirmationWidget {
    return new ConfirmationWidgetProjector(new ConfirmationWidgetCapabilityPolicy([criticalToolName])).project({
      club: { club_id: clubId, name: "TSV Musterstadt", timezone: "Europe/Berlin" },
      context: confirmationContext,
      capability_snapshot: confirmationCapability,
      challenge: challenge(),
      confirm_action: confirmAction(),
      generated_at: "2026-07-21T09:00:00+02:00",
    });
  }

  test("TC-01: all named entities render the bound CNF-01 confirmation shell", () => {
    const model = widget();
    expect(CONFIRMATION_WIDGET_SCHEMA.safeParse(model).success).toBe(true);
    expect(ConfirmationPanel({ model: { data: model.data, club: model.club } })).toContain("News veröffentlichen?");
    expect(ImpactSummary({ model: { preview: model.data.preview, club: model.club } })).toContain("Ein Beitrag wird öffentlich sichtbar.");
    expect(MaskedFieldView({ model: { field_names: model.data.preview.masked_fields } })).toContain("Geschützt");
    expect(ConfirmationActionBar({ model: { action: model.actions[0]!, cancel_label: "Abbrechen", acknowledgement_required: true } })).toContain("data-action-index=\"0\"");
    const html = renderConfirmationWidget({ model });
    expect(html).toContain("data-widget=\"confirmation\"");
    expect(html).toContain("Kritische Aktion");
    for (const secret of [previewId, context.request_id, clubId, confirmationToken, idempotencyKey]) expect(html).not.toContain(secret);
  });

  test("TC-02: desktop modal and mobile bottom sheet keep actions and keyboard handling accessible", () => {
    expect(CONFIRMATION_WIDGET_MAX_WIDTH_PX).toBe(680);
    expect(CONFIRMATION_WIDGET_CSS).toContain("width:min(100%,680px)");
    expect(CONFIRMATION_WIDGET_CSS).toContain("@media (max-width:559px)");
    expect(CONFIRMATION_WIDGET_CSS).toContain("align-items:end");
    expect(CONFIRMATION_WIDGET_CSS).toContain("position:sticky");
    expect(CONFIRMATION_WIDGET_CSS).toContain("min-height:44px");
    expect(CONFIRMATION_WIDGET_CLIENT).toContain('event.key==="Escape"');
    expect(CONFIRMATION_WIDGET_CLIENT).toContain('event.key!=="Tab"');
  });

  test("TC-03: masked field names are visible but sensitive raw values fail closed", () => {
    const model = widget();
    const html = MaskedFieldView({ model: { field_names: model.data.preview.masked_fields } });
    expect(html).toContain("Contact Email");
    expect(html).toContain("Bank Account");
    expect(html).not.toContain("max@example.org");
    const unsafeChallenge = challenge({ preview: { ...challenge().preview, safe_summary: "Kontakt max@example.org veröffentlichen." } });
    expect(() => new ConfirmationWidgetProjector(new ConfirmationWidgetCapabilityPolicy([criticalToolName])).project({
      club: model.club, context: confirmationContext, capability_snapshot: confirmationCapability,
      challenge: unsafeChallenge, confirm_action: confirmAction(), generated_at: "2026-07-21T09:00:00+02:00",
    })).toThrow();
  });

  test("TC-04: expired, stale and conflict states discard the complete actionable model", () => {
    const model = widget();
    expect(() => new ConfirmationWidgetProjector(new ConfirmationWidgetCapabilityPolicy([criticalToolName])).project({
      club: model.club, context: confirmationContext, capability_snapshot: confirmationCapability,
      challenge: challenge(), confirm_action: confirmAction(), generated_at: "2026-07-21T09:05:01+02:00",
    })).toThrow();
    for (const phase of ["expired", "stale", "conflict"] as const) {
      const state = confirmationWidgetState({ phase, model, message: "Bitte erstelle eine neue Vorschau.", retryable: true });
      expect(CONFIRMATION_WIDGET_STATE_SCHEMA.parse(state).model).toBeNull();
      expect(JSON.stringify(state)).not.toContain(confirmationToken);
      expect(JSON.stringify(state)).not.toContain(previewId);
    }
  });

  test("TC-05: the model-visible action excludes the app-only confirmation credential", () => {
    const model = widget();
    expect(Object.keys(model.actions[0]!.input as Record<string, unknown>).sort()).toEqual(["idempotency_key", "preview_id"]);
    expect(JSON.stringify(model)).not.toContain("confirmation_token");
    expect(CONFIRMATION_WIDGET_SCHEMA.safeParse({ ...model, actions: [confirmAction({ normalized_input: { publish: false } })] }).success).toBe(false);
    expect(CONFIRMATION_WIDGET_CLIENT).toContain('Object.keys(input).sort().join(",")==="idempotency_key,preview_id"');
    expect(CONFIRMATION_WIDGET_CLIENT).toContain('value["comvenio/confirmation"]');
    expect(CONFIRMATION_WIDGET_CLIENT).toContain("toolResponseMetadata");
    expect(CONFIRMATION_WIDGET_CLIENT).toContain("confirmation_token:credential.confirmation_token");
    expect(CONFIRMATION_WIDGET_CLIENT).not.toContain("normalized_input");
    expect(CONFIRMATION_WIDGET_CLIENT).not.toContain("fetch(");
    expect(() => new Function(CONFIRMATION_WIDGET_CLIENT)).not.toThrow();
  });

  test("TC-06: telemetry and MCP App resource remain provider-neutral and data-free", () => {
    const model = widget();
    const telemetry = safeConfirmationWidgetTelemetry({ phase: "ready", model, render_duration_ms: 42.6, outcome: "success" });
    expect(telemetry).toMatchObject({ widget: "confirmation", effect_kind: "public", affected_count_bucket: "1", render_duration_ms: 43 });
    for (const secret of [previewId, clubId, confirmationToken, idempotencyKey]) expect(JSON.stringify(telemetry)).not.toContain(secret);
    expect(CONFIRMATION_WIDGET_FIRST_RENDER_BUDGET_MS).toBe(500);
    expect(CONFIRMATION_WIDGET_MAX_ACTIVE_INTENTS).toBe(1);
    expect(CONFIRMATION_WIDGET_RESOURCE_URI).toBe("ui://comvenio/action-confirmation");
    expect(CONFIRMATION_WIDGET_ASSET_PATH).toMatch(/^\/widgets\/action-confirmation\/assets\/action-confirmation\.[a-f0-9]{64}\.js$/u);
    expect(CONFIRMATION_WIDGET_CSP).toContain("default-src 'none'");
    const html = confirmationWidgetHtml("production");
    expect(html).toContain(`https://mcp.comvenio.app${CONFIRMATION_WIDGET_ASSET_PATH}`);
    for (const secret of [previewId, clubId, confirmationToken, idempotencyKey]) expect(html).not.toContain(secret);
    expect(confirmationToolMetadata("production")._meta.ui.resourceUri).toBe(CONFIRMATION_WIDGET_RESOURCE_URI);
  });
});
