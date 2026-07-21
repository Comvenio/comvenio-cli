import type { ConfirmationActionBar as ConfirmationActionBarModel, ConfirmationPanel as ConfirmationPanelModel, ConfirmationWidget as ConfirmationWidgetModel, ImpactSummary as ImpactSummaryModel, MaskedFieldView as MaskedFieldViewModel } from "@comvenio/connector-contracts";

function escapeHtml(value: string): string { return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!); }
function fieldLabel(value: string): string { return value.split(/[._-]/u).filter(Boolean).map((part) => part[0]!.toLocaleUpperCase("de-DE") + part.slice(1)).join(" "); }

export function ImpactSummary({ model }: { model: ImpactSummaryModel }): string {
  const preview = model.preview;
  return `<section class="impact" aria-label="Auswirkungen"><div><span>Verein</span><strong>${escapeHtml(model.club.name)}</strong></div><div><span>Wirkung</span><strong>${escapeHtml(preview.impact.summary)}</strong></div><div><span>Gültig bis</span><strong>${escapeHtml(new Intl.DateTimeFormat("de-DE", { timeZone: model.club.timezone, timeStyle: "short" }).format(new Date(preview.expires_at)))} Uhr</strong></div><div><span>Ziel</span><strong>${escapeHtml(preview.target.label)}</strong></div><div><span>Betroffen</span><strong>${preview.impact.affected_total}</strong></div><div><span>Risiko</span><strong>Kritische Aktion</strong></div></section>`;
}

export function MaskedFieldView({ model }: { model: MaskedFieldViewModel }): string {
  const fields = model.field_names.map((field) => `<li><span>${escapeHtml(fieldLabel(field))}</span><strong>Geschützt</strong></li>`).join("");
  return `<section class="permission-note" aria-label="Datenschutz"><strong>Datenschutz:</strong><p>Die Vorschau enthält keine sensiblen Rohwerte.</p>${fields ? `<ul>${fields}</ul>` : ""}</section>`;
}

export function ConfirmationActionBar({ model }: { model: ConfirmationActionBarModel }): string {
  return `<div class="actions"><button class="btn btn-secondary cancel-action" type="button">${escapeHtml(model.cancel_label)}</button><button class="btn btn-primary confirm-action" type="button" data-action-index="0"${model.acknowledgement_required ? " aria-describedby=\"acknowledgement\"" : ""}>${escapeHtml(model.action.label)}</button></div>`;
}

export function ConfirmationPanel({ model }: { model: ConfirmationPanelModel }): string {
  return `<article class="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description"><span class="pill">Kritische Aktion</span><h2 id="confirm-title">${escapeHtml(model.data.confirm_label)}?</h2><p id="confirm-description">${escapeHtml(model.data.preview.safe_summary)}</p>${ImpactSummary({ model: { preview: model.data.preview, club: model.club } })}${MaskedFieldView({ model: { field_names: model.data.preview.masked_fields } })}${model.data.acknowledgement_required ? `<p id="acknowledgement" class="acknowledgement">Mit der Bestätigung wird ausschließlich der oben dargestellte, serverseitig gespeicherte Intent ausgeführt.</p>` : ""}</article>`;
}

export function ConfirmationWidget({ model }: { model: ConfirmationWidgetModel }): string {
  return `<main class="overlay-demo" data-widget="confirmation"><section class="dialog-host">${ConfirmationPanel({ model: { data: model.data, club: model.club } })}${ConfirmationActionBar({ model: { action: model.actions[0]!, cancel_label: model.data.cancel_label, acknowledgement_required: model.data.acknowledgement_required } })}</section></main>`;
}
