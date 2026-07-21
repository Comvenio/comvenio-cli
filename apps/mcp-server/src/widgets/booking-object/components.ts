import type {
  AvailabilityBadge as AvailabilityBadgeModel,
  BookingObjectWidget as BookingObjectWidgetModel,
  BookingSlotGrid as BookingSlotGridModel,
  ObjectSelector as ObjectSelectorModel,
  ReservationActionBar as ReservationActionBarModel,
} from "@comvenio/connector-contracts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]!);
}

function dateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function ObjectSelector({ model }: { model: ObjectSelectorModel }): string {
  return `<nav class="object-selector" aria-label="Buchungsobjekte">${model.objects.map((object, index) => `<button type="button" class="object-card${object.object_id === model.selected_object_id ? " selected" : ""}" data-object-index="${index}" aria-pressed="${object.object_id === model.selected_object_id}"><strong>${escapeHtml(object.name)}</strong><span>${escapeHtml(object.type)}</span><small>${escapeHtml(object.status)}</small></button>`).join("")}</nav>`;
}

export function AvailabilityBadge({ model }: { model: AvailabilityBadgeModel }): string {
  return `<span class="availability-badge state-${model.state}"><span aria-hidden="true"></span>${escapeHtml(model.label)}</span>`;
}

export function BookingSlotGrid({ model }: { model: BookingSlotGridModel }): string {
  return `<section class="slot-grid" aria-label="Verfügbare Zeitfenster">${model.slots.map((slot) => `<article class="slot state-${slot.state}"><time>${escapeHtml(dateTime(slot.from, model.timezone))}</time><span aria-hidden="true">–</span><time>${escapeHtml(dateTime(slot.to, model.timezone))}</time>${AvailabilityBadge({ model: { state: slot.state, label: slot.label, checked_at: slot.from } })}</article>`).join("")}</section>`;
}

export function ReservationActionBar({ model }: { model: ReservationActionBarModel }): string {
  const actions = model.actions.map((action, index) => action.enabled
    ? `<button class="btn ${action.risk_class === "critical_write" ? "btn-primary" : "btn-secondary"}" type="button" data-action-index="${index}">${escapeHtml(action.label)}</button>`
    : "").join("");
  return actions ? `<div class="reservation-actions" aria-label="Erlaubte Buchungsaktionen">${actions}<p>Eine Reservierung wird immer zuerst als Vorschau angezeigt und erst nach deiner Bestätigung ausgeführt.</p></div>` : "";
}

export function BookingObjectWidget({ model }: { model: BookingObjectWidgetModel }): string {
  const empty = model.empty_state ? `<section class="state-panel"><h3>${escapeHtml(model.empty_state.title)}</h3><p>${escapeHtml(model.empty_state.description)}</p></section>` : "";
  const selected = model.data.objects.find((object) => object.object_id === model.data.selected_object_id);
  const badgeState = model.data.slots.length === 0 ? "unknown" : model.data.slots.every((slot) => slot.state === "available") ? "available" : model.data.slots.some((slot) => slot.state === "occupied") ? "occupied" : model.data.slots.some((slot) => slot.state === "blocked") ? "blocked" : "unknown";
  return `<main class="page"><section class="widget" data-widget="booking-object"><header class="widget-head"><div><p class="eyebrow">Comvenio · Buchungen</p><h2>${escapeHtml(model.title)}</h2><p>Objekte auswählen, Verfügbarkeit prüfen und Reservierung sicher vorbereiten.</p></div><span class="context-chip">${escapeHtml(model.club.name)}</span></header><div class="booking-layout"><aside>${empty}${ObjectSelector({ model: { objects: model.data.objects, selected_object_id: model.data.selected_object_id } })}</aside><section class="availability-panel"><div class="availability-head"><div><p class="eyebrow">Aktuelle Verfügbarkeit</p><h3>${escapeHtml(selected?.name ?? "Objekt auswählen")}</h3></div>${AvailabilityBadge({ model: { state: badgeState, label: badgeState === "available" ? "frei" : badgeState === "occupied" ? "teilweise belegt" : badgeState === "blocked" ? "gesperrt" : "noch nicht geprüft", checked_at: model.generated_at } })}</div>${BookingSlotGrid({ model: { slots: model.data.slots, timezone: model.club.timezone } })}</section></div>${ReservationActionBar({ model: { actions: model.actions } })}</section></main>`;
}
