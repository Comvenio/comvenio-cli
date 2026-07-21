import { z } from "zod";

import type { CapabilitySnapshot } from "@comvenio/auth";
import {
  EVENT_CALENDAR_WIDGET_SCHEMA,
  SERVER_ACTION_DESCRIPTOR_SCHEMA,
  createConnectorError,
  normalizeRequestContext,
  type EventCalendarEvent,
  type EventCalendarWidget,
  type JsonValue,
  type RequestContext,
  type ServerActionDescriptor,
} from "@comvenio/connector-contracts";

import type {
  EventCalendarProjectorInput,
  EventWidgetActionPolicy,
  PrivateEventCalendarProjectorInput,
} from "./types.ts";

const sourceInstant = z.string().datetime({ offset: true });
const sourceUuid = z.string().uuid();
const publicSourceEvent = z.object({
  id: sourceUuid,
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(2_000).nullable().optional(),
  start: sourceInstant,
  end: sourceInstant,
  all_day: z.boolean().optional(),
  location: z.string().trim().max(500).nullable().optional(),
  is_public: z.boolean(),
  cover_url: z.string().url().nullable().optional(),
}).passthrough();

const privateSourceEvent = z.object({
  event_id: sourceUuid,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2_000).nullable().optional(),
  start_time: sourceInstant,
  end_time: sourceInstant,
  all_day: z.boolean().optional(),
  location: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["draft", "confirmed", "published", "cancelled"]),
  cover_url: z.string().url().nullable().optional(),
}).passthrough();

const privateSource = z.union([
  z.array(privateSourceEvent).max(200),
  z.object({ items: z.array(privateSourceEvent).max(200) }).passthrough(),
]);

function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).protocol === "https:" ? value : null; }
  catch { return null; }
}

function eventStatus(value: "draft" | "confirmed" | "published" | "cancelled"): EventCalendarEvent["status"] {
  return value === "confirmed" ? "published" : value;
}

function sortEvents(events: EventCalendarEvent[]): EventCalendarEvent[] {
  return events.sort((left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
}

function common(input: EventCalendarProjectorInput, events: EventCalendarEvent[], inputActions: ServerActionDescriptor[], capabilityVersion: string | null): EventCalendarWidget {
  return EVENT_CALENDAR_WIDGET_SCHEMA.parse({
    widget: "event_calendar",
    contract_version: "1.0.0",
    title: "Event & Kalender",
    club: input.club,
    capability_version: capabilityVersion,
    generated_at: input.generated_at ?? new Date().toISOString(),
    data: {
      range: input.range,
      view: input.view ?? "week",
      filters: {
        department_ids: input.filters?.department_ids ?? [],
        query: input.filters?.query ?? null,
      },
      events: sortEvents(events),
    },
    actions: inputActions,
    empty_state: events.length === 0
      ? { title: "Keine Termine in diesem Zeitraum", description: "Wähle einen anderen Zeitraum oder entferne einen Filter." }
      : null,
  });
}

function boundPrivate(input: PrivateEventCalendarProjectorInput): { context: RequestContext; snapshot: CapabilitySnapshot } {
  const context = normalizeRequestContext(input.context);
  const snapshot = input.capability_snapshot;
  if (!context.subject_id || !context.oauth_grant_id || !context.club_id) {
    throw createConnectorError({ code: "AUTH_REQUIRED", message: "Für den privaten Kalender ist eine aktive Verbindung erforderlich.", request_id: context.request_id, retryable: false });
  }
  if (context.club_id !== input.club.club_id
    || snapshot.club_id !== input.club.club_id
    || snapshot.subject_id !== context.subject_id) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Kalender gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
  }
  if (!context.capability_version || snapshot.capability_version !== context.capability_version) {
    throw createConnectorError({ code: "PERMISSION_DENIED", message: "Die Berechtigungen haben sich geändert. Bitte lade den Kalender neu.", request_id: context.request_id, retryable: false });
  }
  if (!context.scopes.includes("event.read")) {
    throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Für private Termine fehlt der Scope event.read.", request_id: context.request_id, retryable: false, required_scope: "event.read" });
  }
  return { context, snapshot };
}

function filteredActions(input: PrivateEventCalendarProjectorInput, context: RequestContext, snapshot: CapabilitySnapshot, policy: EventWidgetActionPolicy): ServerActionDescriptor[] {
  return (input.action_candidates ?? []).flatMap((candidateInput) => {
    const parsed = SERVER_ACTION_DESCRIPTOR_SCHEMA.safeParse(candidateInput);
    if (!parsed.success || parsed.data.visibility === "hidden") return [];
    const action = parsed.data;
    if (!input.club || action.input === null || typeof action.input !== "object" || Array.isArray(action.input)
      || action.input.club_id !== input.club.club_id) return [];
    const decision = policy.evaluate({ context, capability_snapshot: snapshot, descriptor: action });
    if (!decision.allowed
      || decision.risk_class !== action.risk_class
      || decision.requires_confirmation !== action.requires_confirmation) return [];
    return [action];
  });
}

export class EventCalendarWidgetProjector {
  constructor(private readonly actionPolicy: EventWidgetActionPolicy) {}

  public(input: EventCalendarProjectorInput): EventCalendarWidget {
    const source = z.array(publicSourceEvent).max(200).parse(input.source);
    const events = source.filter((event) => event.is_public).map((event): EventCalendarEvent => ({
      id: event.id,
      title: event.title,
      summary: event.summary ?? null,
      start: event.start,
      end: event.end,
      all_day: event.all_day ?? false,
      location: event.location ?? null,
      status: "published",
      cover_url: httpsUrl(event.cover_url),
    }));
    return common(input, events, [], null);
  }

  private(input: PrivateEventCalendarProjectorInput): EventCalendarWidget {
    const binding = boundPrivate(input);
    const parsed = privateSource.parse(input.source);
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    const events = items.map((event): EventCalendarEvent => ({
      id: event.event_id,
      title: event.title,
      summary: event.description ?? null,
      start: event.start_time,
      end: event.end_time,
      all_day: event.all_day ?? false,
      location: event.location ?? null,
      status: eventStatus(event.status),
      cover_url: httpsUrl(event.cover_url),
    }));
    return common(
      input,
      events,
      filteredActions(input, binding.context, binding.snapshot, this.actionPolicy),
      binding.snapshot.capability_version,
    );
  }
}

export function safePermissionChangedWidget(model: EventCalendarWidget): EventCalendarWidget {
  return EVENT_CALENDAR_WIDGET_SCHEMA.parse({ ...model, capability_version: null, actions: [] });
}

export function assertEventWidgetJson(value: unknown): asserts value is JsonValue {
  if (!z.json().safeParse(value).success) throw new Error("Das Event-Widget-Modell enthält ungültige JSON-Werte.");
}
