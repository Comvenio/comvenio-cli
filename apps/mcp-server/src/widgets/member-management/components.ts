import type {
  MemberActionBar as MemberActionBarModel,
  MemberDetailPanel as MemberDetailPanelModel,
  MemberManagementWidget as MemberManagementWidgetModel,
  MemberSummaryRow as MemberSummaryRowModel,
  PermissionExplanation as PermissionExplanationModel,
  ServerActionDescriptor,
} from "@comvenio/connector-contracts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]!);
}

function initials(displayName: string): string {
  return displayName.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("de-DE") ?? "").join("") || "M";
}

function actionMemberId(action: ServerActionDescriptor): string | null {
  return action.input !== null && typeof action.input === "object" && !Array.isArray(action.input)
    && typeof action.input.member_id === "string" ? action.input.member_id : null;
}

export function MemberSummaryRow(input: {
  model: MemberSummaryRowModel;
  detailActionIndex: number | null;
}): string {
  const member = input.model;
  const department = member.department_labels.join(" · ") || "Keine Gruppe";
  const status = member.status_label ?? "Status nicht angegeben";
  const action = input.detailActionIndex === null ? "" : `<button class="btn btn-secondary member-detail-action" type="button" data-action-index="${input.detailActionIndex}">Details anzeigen</button>`;
  return `<article class="member-row"><span class="avatar" aria-hidden="true">${escapeHtml(initials(member.display_name))}</span><div class="member-summary"><strong>${escapeHtml(member.display_name)}</strong><div class="meta">${escapeHtml(department)} · ${escapeHtml(status)}</div></div><span class="pill">Basis</span>${action}</article>`;
}

const FIELD_LABELS: Record<string, string> = {
  first_name: "Vorname", last_name: "Nachname", email: "E-Mail", phone_number: "Telefon",
  birthdate: "Geburtsdatum", address: "Adresse", postal_code: "Postleitzahl", city: "Ort",
  state: "Bundesland", country: "Land", joined_at: "Mitglied seit", left_at: "Ausgetreten am",
};

export function PermissionExplanation({ model }: { model: PermissionExplanationModel }): string {
  if (model.messages.length === 0) return "";
  return `<section class="permission-note" aria-label="Deine Berechtigungen"><strong>Deine Ansicht:</strong><ul>${model.messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul></section>`;
}

export function MemberDetailPanel({ model }: { model: MemberDetailPanelModel | null }): string {
  if (!model) return `<aside class="preview member-detail-panel"><p class="eyebrow">Sichere Detailansicht</p><h3>Mitglied auswählen</h3><p>Details werden erst nach einem expliziten, berechtigten Abruf geladen.</p></aside>`;
  const fields = Object.entries(model.fields).map(([key, value]) => {
    if (value === null || typeof value !== "string") return "";
    return `<div class="detail-field"><dt>${escapeHtml(FIELD_LABELS[key] ?? key)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }).join("");
  const masked = model.masked_fields.map((key) => `<div class="detail-field"><dt>${escapeHtml(FIELD_LABELS[key] ?? key)}</dt><dd>Geschützt</dd></div>`).join("");
  return `<aside class="preview member-detail-panel"><p class="eyebrow">Sichere Detailansicht</p><h3>${escapeHtml(model.display_name)}</h3><dl>${fields}${masked}</dl>${PermissionExplanation({ model: { messages: model.permission_explanation } })}</aside>`;
}

export function MemberActionBar({ model, actionIndices }: { model: MemberActionBarModel; actionIndices?: number[] }): string {
  const actions = model.actions.map((action, position) => action.enabled
    ? `<button class="btn ${action.risk_class === "critical_write" ? "btn-danger" : "btn-primary"}" type="button" data-action-index="${actionIndices?.[position] ?? position}">${escapeHtml(action.label)}</button>`
    : "").join("");
  return actions ? `<div class="actions" aria-label="Erlaubte Mitgliederaktionen">${actions}</div>` : "";
}

export function MemberManagementWidget({ model }: { model: MemberManagementWidgetModel }): string {
  const rowActionIndices = new Set<number>();
  const rows = model.data.rows.map((row) => {
    const index = model.actions.findIndex((action) => action.enabled && action.risk_class === "read" && actionMemberId(action) === row.member_id);
    if (index >= 0) rowActionIndices.add(index);
    return MemberSummaryRow({ model: row, detailActionIndex: index < 0 ? null : index });
  }).join("");
  const remainingActions = model.actions.map((action, index) => ({ action, index })).filter(({ index }) => !rowActionIndices.has(index));
  const empty = model.empty_state ? `<section class="state-panel"><h3>${escapeHtml(model.empty_state.title)}</h3><p>${escapeHtml(model.empty_state.description)}</p></section>` : "";
  const query = model.data.query ? `<span class="field">Suche: ${escapeHtml(model.data.query)}</span>` : `<span class="field">Alle Mitglieder</span>`;
  return `<main class="page"><section class="widget" data-widget="member-management"><header class="widget-head"><div><p class="eyebrow">Comvenio · Mitglieder</p><h2>${escapeHtml(model.title)}</h2><p>Minimierte Datenansicht gemäß deiner wirksamen Berechtigung.</p></div><span class="context-chip">${escapeHtml(model.club!.name)}</span></header><div class="filter-region"><div class="toolbar" aria-label="Mitgliederfilter">${query}</div></div><div class="widget-body"><p class="permission-note"><strong>Deine Ansicht:</strong> Basisdaten und Teamzuordnung. Kontaktdetails werden nur nach explizitem Abruf geladen.</p><div class="member-layout"><section class="stack member-list" aria-label="Mitgliederliste">${empty}${rows}</section>${MemberDetailPanel({ model: model.data.selected })}</div></div>${MemberActionBar({ model: { actions: remainingActions.map(({ action }) => action) }, actionIndices: remainingActions.map(({ index }) => index) })}</section></main>`;
}
