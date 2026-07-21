import type {
  ClubContextChip as ClubContextChipModel,
  EventActionBar as EventActionBarModel,
  EventCalendarEvent,
  EventCalendarWidget as EventCalendarWidgetModel,
  EventFilterBar as EventFilterBarModel,
  EventSummaryCard as EventSummaryCardModel,
} from "@comvenio/connector-contracts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

function localDateParts(value: string, timezone: string): { date: string; time: string } {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: timezone,
    }).format(date),
    time: new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date),
  };
}

function eventTime(event: EventCalendarEvent, timezone: string): string {
  const start = localDateParts(event.start, timezone);
  const end = localDateParts(event.end, timezone);
  if (event.all_day) return start.date === end.date ? `${start.date} · ganztägig` : `${start.date}–${end.date} · ganztägig`;
  return start.date === end.date
    ? `${start.date} · ${start.time}–${end.time}`
    : `${start.date}, ${start.time} – ${end.date}, ${end.time}`;
}

export function ClubContextChip({ model }: { model: ClubContextChipModel | null }): string {
  if (!model) return "";
  return `<span class="context-chip" aria-label="Ausgewählter Verein">${escapeHtml(model.name)}</span>`;
}

export function EventFilterBar({ model }: { model: EventFilterBarModel }): string {
  const from = localDateParts(model.range.from, "Europe/Berlin").date;
  const to = localDateParts(model.range.to, "Europe/Berlin").date;
  const view = model.view === "month" ? "Monat" : model.view === "week" ? "Woche" : "Agenda";
  const query = model.filters.query ? `<span class="filter-summary">Suche: ${escapeHtml(model.filters.query)}</span>` : "";
  return `<div class="toolbar" aria-label="Kalenderfilter"><span class="field range-label">${from}–${to}</span><span class="field">${view}</span>${query}</div>`;
}

export function EventSummaryCard(input: {
  model: EventSummaryCardModel;
  timezone: string;
  publicOnly: boolean;
  virtualized: boolean;
}): string {
  const event = input.model;
  const status = event.status === "cancelled" ? "Abgesagt" : input.publicOnly ? "Öffentlich" : "Vereinstermin";
  const summary = event.summary ? `<p>${escapeHtml(event.summary)}</p>` : "";
  const location = event.location ? `<span>${escapeHtml(event.location)}</span>` : "";
  return `<article class="event-card"${input.virtualized ? " data-virtualized=\"true\"" : ""}><span class="pill">${status}</span><h3>${escapeHtml(event.title)}</h3>${summary}<div class="meta"><span>${escapeHtml(eventTime(event, input.timezone))}</span>${location}</div></article>`;
}

export function EventActionBar({ model }: { model: EventActionBarModel }): string {
  if (model.actions.length === 0) return "";
  const actions = model.actions.map((action, index) => action.enabled
    ? `<button class="btn ${action.risk_class === "critical_write" ? "btn-danger" : "btn-primary"}" type="button" data-action-index="${index}">${escapeHtml(action.label)}</button>`
    : `<span class="action-unavailable" role="status">${escapeHtml(action.label)}: ${escapeHtml(action.disabled_reason ?? "Derzeit nicht verfügbar")}</span>`).join("");
  return `<div class="actions" aria-label="Erlaubte Eventaktionen">${actions}</div>`;
}

function CalendarGrid(model: EventCalendarWidgetModel): string {
  const timezone = model.club?.timezone ?? "Europe/Berlin";
  const days = new Map<string, EventCalendarEvent[]>();
  for (const event of model.data.events) {
    const key = localDateParts(event.start, timezone).date;
    days.set(key, [...(days.get(key) ?? []), event]);
  }
  const cells = [...days.entries()].slice(0, 31).map(([date, events]) => {
    const names = events.slice(0, 3).map((event) => `<span>${escapeHtml(event.title)}</span>`).join("");
    return `<div class="day"><strong>${escapeHtml(date.slice(0, 5))}</strong>${names}</div>`;
  }).join("");
  return `<div class="calendar calendar-grid" aria-label="Kalenderübersicht">${cells || "<div class=\"day\"><strong>–</strong></div>"}</div>`;
}

function stateMessage(model: EventCalendarWidgetModel): string {
  return model.empty_state
    ? `<section class="state-panel empty-state"><h3>${escapeHtml(model.empty_state.title)}</h3><p>${escapeHtml(model.empty_state.description)}</p></section>`
    : "";
}

export function EventCalendarWidget({ model }: { model: EventCalendarWidgetModel }): string {
  const timezone = model.club?.timezone ?? "Europe/Berlin";
  const cards = model.data.events.map((event, index) => EventSummaryCard({
    model: event,
    timezone,
    publicOnly: model.capability_version === null,
    virtualized: index >= 100,
  })).join("");
  return `<main class="page"><section class="widget" data-widget="event-calendar"><header class="widget-head"><div><p class="eyebrow">Comvenio · Kalender</p><h2>${escapeHtml(model.title)}</h2><p>Termine im gewählten Verein entdecken und verwalten.</p></div>${ClubContextChip({ model: model.club })}</header><div class="filter-region">${EventFilterBar({ model: { range: model.data.range, view: model.data.view, filters: model.data.filters } })}</div><div class="widget-body split"><section>${CalendarGrid(model)}<p class="mobile-note">Auf Mobilgeräten wird der Kalender als Agenda-Liste dargestellt.</p></section><aside class="stack agenda" aria-label="Terminagenda">${stateMessage(model)}${cards}</aside></div>${EventActionBar({ model: { actions: model.actions } })}</section></main>`;
}

export function EventCalendarStatus(input: { title: string; message: string; retryable?: boolean }): string {
  return `<main class="page"><section class="widget state-panel" role="status"><h2>${escapeHtml(input.title)}</h2><p>${escapeHtml(input.message)}</p>${input.retryable ? "<button class=\"btn btn-secondary\" type=\"button\" data-retry>Erneut versuchen</button>" : ""}</section></main>`;
}
