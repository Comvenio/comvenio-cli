import { describe, expect, test } from "bun:test";

import type { CapabilitySnapshot } from "../../auth/src/index.ts";
import {
  EVENT_CALENDAR_WIDGET_SCHEMA,
  EVENT_CALENDAR_WIDGET_STATE_SCHEMA,
  type EventCalendarWidget,
  type RequestContext,
  type ServerActionDescriptor,
} from "../src/index.ts";
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
  input: { club_id: clubId },
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
