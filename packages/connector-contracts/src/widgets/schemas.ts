import { z } from "zod";
import { ACTION_CONFIRM_WIDGET_INPUT_SCHEMA, ACTION_PREVIEW_VIEW_SCHEMA } from "../safety/schemas.ts";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const safeText = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable();
const toolName = z.string().trim().min(1).max(200).regex(/^[a-z0-9_.:-]+$/u);
const ianaTimezone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: value }).format(0);
    return value.includes("/") && !value.startsWith("Etc/");
  } catch {
    return false;
  }
}, { message: "Der Widget-Vereinskontext benötigt eine IANA-Zeitzone." });

export const WIDGET_KIND_SCHEMA = z.enum([
  "event_calendar",
  "member_management",
  "booking_object",
  "news",
  "confirmation",
]);

export const CLUB_CHIP_SCHEMA = z.object({
  club_id: uuid,
  name: safeText(200),
  timezone: ianaTimezone,
}).strict();

export const SERVER_ACTION_DESCRIPTOR_SCHEMA = z.object({
  action_id: z.string().trim().min(1).max(200).regex(/^[a-z0-9_.:-]+$/u),
  label: safeText(80),
  tool_name: toolName,
  input: z.json(),
  visibility: z.enum(["visible", "hidden"]),
  enabled: z.boolean(),
  risk_class: z.enum(["read", "reversible_write", "critical_write"]),
  requires_confirmation: z.boolean(),
  disabled_reason: nullableText(240),
}).strict().superRefine((action, context) => {
  if (action.enabled === (action.disabled_reason !== null)) {
    context.addIssue({ code: "custom", message: "Nur eine deaktivierte Aktion darf einen sicheren Grund enthalten." });
  }
  if ((action.risk_class === "critical_write") !== action.requires_confirmation) {
    context.addIssue({ code: "custom", message: "Nur kritische Aktionen benötigen den Bestätigungsflow." });
  }
});

export const VISIBLE_SERVER_ACTION_DESCRIPTOR_SCHEMA = SERVER_ACTION_DESCRIPTOR_SCHEMA.refine(
  (action) => action.visibility === "visible",
  { message: "Verborgene Aktionen dürfen den Widget-Client nicht erreichen.", path: ["visibility"] },
);

export const EVENT_CALENDAR_EVENT_SCHEMA = z.object({
  id: uuid,
  title: safeText(300),
  summary: nullableText(2_000),
  start: instant,
  end: instant,
  all_day: z.boolean(),
  location: nullableText(500),
  status: z.enum(["draft", "published", "cancelled"]),
  cover_url: z.string().url().refine((value) => new URL(value).protocol === "https:", {
    message: "Widget-Bilder benötigen HTTPS.",
  }).nullable(),
}).strict().refine((event) => Date.parse(event.end) >= Date.parse(event.start), {
  message: "Das Eventende darf nicht vor dem Start liegen.",
  path: ["end"],
});

export const EVENT_CALENDAR_DATA_SCHEMA = z.object({
  range: z.object({ from: instant, to: instant }).strict()
    .refine((range) => Date.parse(range.to) > Date.parse(range.from), {
      message: "Das Kalenderende muss nach dem Start liegen.",
    }),
  view: z.enum(["agenda", "week", "month"]),
  filters: z.object({
    department_ids: z.array(uuid).max(100).refine((values) => new Set(values).size === values.length),
    query: z.string().trim().max(200).nullable(),
  }).strict(),
  events: z.array(EVENT_CALENDAR_EVENT_SCHEMA).max(200),
}).strict();

export const EVENT_CALENDAR_WIDGET_SCHEMA = z.object({
  widget: z.literal("event_calendar"),
  contract_version: z.literal("1.0.0"),
  title: safeText(120),
  club: CLUB_CHIP_SCHEMA.nullable(),
  capability_version: z.string().trim().min(1).max(200).nullable(),
  generated_at: instant,
  data: EVENT_CALENDAR_DATA_SCHEMA,
  actions: z.array(VISIBLE_SERVER_ACTION_DESCRIPTOR_SCHEMA).max(50),
  empty_state: z.object({ title: safeText(120), description: safeText(500) }).strict().nullable(),
}).strict().superRefine((widget, context) => {
  if ((widget.data.events.length === 0) !== (widget.empty_state !== null)) {
    context.addIssue({ code: "custom", message: "Der Leerzustand muss exakt zu einer leeren Eventliste passen." });
  }
  if (widget.actions.some((action) => {
    return !widget.club || action.input === null
      || typeof action.input !== "object" || Array.isArray(action.input)
      || Object.prototype.hasOwnProperty.call(action.input, "club_id");
  })) {
    context.addIssue({ code: "custom", message: "Jede Widget-Aktion muss ein gültiges Eingabeobjekt besitzen." });
  }
});

export const WIDGET_PHASE_SCHEMA = z.enum([
  "loading",
  "empty",
  "ready",
  "partial",
  "auth_required",
  "permission_changed",
  "error",
]);

export const EVENT_CALENDAR_WIDGET_STATE_SCHEMA = z.object({
  phase: WIDGET_PHASE_SCHEMA,
  model: EVENT_CALENDAR_WIDGET_SCHEMA.nullable(),
  message: z.string().trim().min(1).max(500).nullable(),
  retryable: z.boolean(),
}).strict().superRefine((state, context) => {
  if (["ready", "partial", "empty"].includes(state.phase) && state.model === null) {
    context.addIssue({ code: "custom", message: "Ein darstellbarer Widgetzustand benötigt ein Modell." });
  }
  if (state.phase === "empty" && state.model?.empty_state === null) {
    context.addIssue({ code: "custom", message: "Der Empty-Zustand benötigt sichere Leerzustandsdaten." });
  }
  if (["partial", "permission_changed"].includes(state.phase) && state.message === null) {
    context.addIssue({ code: "custom", message: "Dieser sichere Zwischenzustand benötigt eine Nutzerinformation." });
  }
  if (state.phase === "permission_changed" && state.model === null) {
    context.addIssue({ code: "custom", message: "Der Rechtewechsel benötigt das bereits minimierte Modell." });
  }
  if (["loading", "auth_required", "error"].includes(state.phase) && state.message === null) {
    context.addIssue({ code: "custom", message: "Dieser Widgetzustand benötigt eine sichere Nutzerinformation." });
  }
  if (["loading", "auth_required"].includes(state.phase) && state.model !== null) {
    context.addIssue({ code: "custom", message: "Vor Anmeldung oder Laden dürfen keine Kalenderdaten vorliegen." });
  }
});

const maskedContact = z.string().trim().min(1).max(320).refine(
  (value) => value.includes("*") || value.includes("•"),
  { message: "Kontaktdaten der Basisliste müssen maskiert sein." },
).nullable();

export const MEMBER_SUMMARY_ROW_SCHEMA = z.object({
  member_id: uuid,
  display_name: safeText(200),
  status_label: nullableText(160),
  department_labels: z.array(safeText(160)).max(50).refine((values) => new Set(values).size === values.length),
  email_masked: maskedContact,
  phone_masked: maskedContact,
}).strict();

export const MEMBER_DETAIL_FIELDS_SCHEMA = z.object({
  first_name: safeText(160).optional(),
  last_name: safeText(160).optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone_number: z.string().trim().min(1).max(100).nullable().optional(),
  birthdate: z.string().date().nullable().optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  postal_code: z.string().trim().min(1).max(32).nullable().optional(),
  city: z.string().trim().min(1).max(160).nullable().optional(),
  state: z.string().trim().min(1).max(160).nullable().optional(),
  country: z.string().trim().min(1).max(160).nullable().optional(),
  joined_at: z.string().date().nullable().optional(),
  left_at: z.string().date().nullable().optional(),
}).strict();

const memberDetailFieldName = z.enum([
  "first_name", "last_name", "email", "phone_number", "birthdate", "address",
  "postal_code", "city", "state", "country", "joined_at", "left_at",
]);

export const MEMBER_DETAIL_PANEL_SCHEMA = z.object({
  member_id: uuid,
  display_name: safeText(200),
  fields: MEMBER_DETAIL_FIELDS_SCHEMA,
  masked_fields: z.array(memberDetailFieldName).max(12).refine((values) => new Set(values).size === values.length),
  permission_explanation: z.array(safeText(500)).max(50),
}).strict();

export const MEMBER_MANAGEMENT_DATA_SCHEMA = z.object({
  query: z.string().trim().max(200).nullable(),
  rows: z.array(MEMBER_SUMMARY_ROW_SCHEMA).max(100),
  selected: MEMBER_DETAIL_PANEL_SCHEMA.nullable(),
}).strict().superRefine((data, context) => {
  if (data.selected && !data.rows.some((row) => row.member_id === data.selected?.member_id)) {
    context.addIssue({ code: "custom", message: "Die Detailansicht muss zu einer sichtbaren Mitgliederzeile gehören.", path: ["selected"] });
  }
});

export const MEMBER_MANAGEMENT_WIDGET_SCHEMA = z.object({
  widget: z.literal("member_management"),
  contract_version: z.literal("1.0.0"),
  title: safeText(120),
  club: CLUB_CHIP_SCHEMA,
  capability_version: z.string().trim().min(1).max(200).nullable(),
  generated_at: instant,
  data: MEMBER_MANAGEMENT_DATA_SCHEMA,
  actions: z.array(VISIBLE_SERVER_ACTION_DESCRIPTOR_SCHEMA).max(50),
  empty_state: z.object({ title: safeText(120), description: safeText(500) }).strict().nullable(),
}).strict().superRefine((widget, context) => {
  if ((widget.data.rows.length === 0) !== (widget.empty_state !== null)) {
    context.addIssue({ code: "custom", message: "Der Leerzustand muss exakt zur leeren Mitgliederliste passen." });
  }
  if (widget.actions.some((action) => action.input === null || typeof action.input !== "object"
    || Array.isArray(action.input)
    || Object.prototype.hasOwnProperty.call(action.input, "club_id"))) {
    context.addIssue({ code: "custom", message: "Jede Mitgliederaktion muss ein gültiges Eingabeobjekt besitzen." });
  }
});

export const MEMBER_MANAGEMENT_PHASE_SCHEMA = z.enum([
  "loading", "empty", "ready_basic", "ready_detail", "partial", "auth_required", "permission_changed", "error",
]);

export const MEMBER_MANAGEMENT_WIDGET_STATE_SCHEMA = z.object({
  phase: MEMBER_MANAGEMENT_PHASE_SCHEMA,
  model: MEMBER_MANAGEMENT_WIDGET_SCHEMA.nullable(),
  message: z.string().trim().min(1).max(500).nullable(),
  retryable: z.boolean(),
}).strict().superRefine((state, context) => {
  if (["empty", "ready_basic", "ready_detail", "partial", "permission_changed"].includes(state.phase) && state.model === null) {
    context.addIssue({ code: "custom", message: "Ein darstellbarer Mitgliederzustand benötigt ein Modell." });
  }
  if (state.phase === "ready_basic" && state.model?.data.selected !== null) {
    context.addIssue({ code: "custom", message: "Der Basiszustand darf keine Detaildaten halten." });
  }
  if (state.phase === "ready_detail" && state.model?.data.selected == null) {
    context.addIssue({ code: "custom", message: "Der Detailzustand benötigt explizit geladene Detaildaten." });
  }
  if (["empty", "ready_basic", "ready_detail", "partial"].includes(state.phase)
    && state.model?.capability_version == null) {
    context.addIssue({ code: "custom", message: "Ein aktiver Mitgliederzustand benötigt die aktuelle Capability-Version." });
  }
  if (state.phase === "permission_changed" && state.model?.capability_version !== null) {
    context.addIssue({ code: "custom", message: "Nach einem Rechtewechsel darf keine alte Capability-Version verbleiben." });
  }
  if (["loading", "auth_required"].includes(state.phase) && state.model !== null) {
    context.addIssue({ code: "custom", message: "Vor Anmeldung oder Laden dürfen keine Mitgliederdaten vorliegen." });
  }
  if (["loading", "partial", "auth_required", "permission_changed", "error"].includes(state.phase) && state.message === null) {
    context.addIssue({ code: "custom", message: "Dieser Mitgliederzustand benötigt eine sichere Nutzerinformation." });
  }
});

export const BOOKING_OBJECT_SUMMARY_SCHEMA = z.object({
  object_id: uuid,
  name: safeText(300),
  type: safeText(100),
  status: safeText(100),
}).strict();

export const BOOKING_SLOT_SCHEMA = z.object({
  from: instant,
  to: instant,
  state: z.enum(["available", "occupied", "blocked", "unknown"]),
  booking_id: uuid.nullable(),
  label: safeText(160),
}).strict().superRefine((slot, context) => {
  if (Date.parse(slot.to) <= Date.parse(slot.from)) {
    context.addIssue({ code: "custom", message: "Das Slotende muss nach dem Start liegen.", path: ["to"] });
  }
  if (slot.state !== "occupied" && slot.booking_id !== null) {
    context.addIssue({ code: "custom", message: "Nur ein belegter Slot darf eine Buchungsreferenz tragen.", path: ["booking_id"] });
  }
});

export const BOOKING_OBJECT_DATA_SCHEMA = z.object({
  range: z.object({ from: instant, to: instant }).strict().refine((range) => Date.parse(range.to) > Date.parse(range.from)),
  objects: z.array(BOOKING_OBJECT_SUMMARY_SCHEMA).max(100),
  selected_object_id: uuid.nullable(),
  slots: z.array(BOOKING_SLOT_SCHEMA).max(200),
}).strict().superRefine((data, context) => {
  if (data.selected_object_id !== null && !data.objects.some((object) => object.object_id === data.selected_object_id)) {
    context.addIssue({ code: "custom", message: "Das ausgewählte Objekt muss in der sichtbaren Objektliste liegen.", path: ["selected_object_id"] });
  }
  if (data.selected_object_id === null && data.slots.length > 0) {
    context.addIssue({ code: "custom", message: "Slots benötigen ein explizit ausgewähltes Objekt.", path: ["slots"] });
  }
  if (data.slots.some((slot) => Date.parse(slot.from) < Date.parse(data.range.from) || Date.parse(slot.to) > Date.parse(data.range.to))) {
    context.addIssue({ code: "custom", message: "Alle Slots müssen innerhalb des angefragten Zeitraums liegen.", path: ["slots"] });
  }
});

export const BOOKING_OBJECT_WIDGET_SCHEMA = z.object({
  widget: z.literal("booking_object"),
  contract_version: z.literal("1.0.0"),
  title: safeText(120),
  club: CLUB_CHIP_SCHEMA,
  capability_version: z.string().trim().min(1).max(200).nullable(),
  generated_at: instant,
  data: BOOKING_OBJECT_DATA_SCHEMA,
  actions: z.array(VISIBLE_SERVER_ACTION_DESCRIPTOR_SCHEMA).max(50),
  empty_state: z.object({ title: safeText(120), description: safeText(500) }).strict().nullable(),
}).strict().superRefine((widget, context) => {
  if ((widget.data.objects.length === 0) !== (widget.empty_state !== null)) {
    context.addIssue({ code: "custom", message: "Der Leerzustand muss exakt zur leeren Objektliste passen." });
  }
  const visibleObjectIds = new Set(widget.data.objects.map((object) => object.object_id));
  if (widget.actions.some((action) => action.input === null || typeof action.input !== "object" || Array.isArray(action.input)
    || Object.prototype.hasOwnProperty.call(action.input, "club_id")
    || (typeof action.input.object_id === "string" && !visibleObjectIds.has(action.input.object_id))
    || (action.risk_class !== "read" && action.input.object_id !== widget.data.selected_object_id))) {
    context.addIssue({ code: "custom", message: "Jede Buchungsaktion muss an ein sichtbares beziehungsweise ausgewähltes Objekt gebunden sein." });
  }
  if (widget.actions.some((action) => action.risk_class !== "read"
    && (action.risk_class !== "critical_write" || !action.requires_confirmation))) {
    context.addIssue({ code: "custom", message: "Reservierungsaktionen dürfen nur über den Bestätigungsflow laufen." });
  }
});

export const BOOKING_OBJECT_PHASE_SCHEMA = z.enum([
  "loading", "empty", "ready", "partial", "conflict", "auth_required", "permission_changed", "error",
]);

export const BOOKING_OBJECT_WIDGET_STATE_SCHEMA = z.object({
  phase: BOOKING_OBJECT_PHASE_SCHEMA,
  model: BOOKING_OBJECT_WIDGET_SCHEMA.nullable(),
  message: z.string().trim().min(1).max(500).nullable(),
  retryable: z.boolean(),
}).strict().superRefine((state, context) => {
  if (["empty", "ready", "partial", "conflict", "permission_changed"].includes(state.phase) && state.model === null) {
    context.addIssue({ code: "custom", message: "Ein darstellbarer Buchungszustand benötigt ein Modell." });
  }
  if (["loading", "auth_required"].includes(state.phase) && state.model !== null) {
    context.addIssue({ code: "custom", message: "Vor Anmeldung oder Laden dürfen keine Buchungsdaten vorliegen." });
  }
  if (["loading", "partial", "conflict", "auth_required", "permission_changed", "error"].includes(state.phase) && state.message === null) {
    context.addIssue({ code: "custom", message: "Dieser Buchungszustand benötigt eine sichere Nutzerinformation." });
  }
  if (["empty", "ready", "partial"].includes(state.phase) && state.model?.capability_version == null) {
    context.addIssue({ code: "custom", message: "Ein aktiver Buchungszustand benötigt die Capability-Version." });
  }
  if (["conflict", "permission_changed"].includes(state.phase) && state.model?.actions.length !== 0) {
    context.addIssue({ code: "custom", message: "Nach Konflikt oder Rechtewechsel dürfen keine alten Reservierungsaktionen verbleiben." });
  }
});

function allowlistedNewsHtml(value: string): boolean {
  if (/<!--|<\/?(?:script|style|iframe|form|input|button|img|svg|math|object|embed|template|link|meta)\b/iu.test(value)) return false;
  const allowedTag = /^<\/?(?:p|br|h2|h3|strong|em|ul|ol|li|blockquote)>$/iu;
  const allowedLink = /^<a href="https:\/\/[^"<>\s]+" target="_blank" rel="noopener noreferrer">$/u;
  for (const match of value.matchAll(/<[^>]*>/gu)) {
    if (!allowedTag.test(match[0]) && !allowedLink.test(match[0]) && match[0] !== "</a>") return false;
  }
  return !/(?:javascript\s*:|data\s*:|\son[a-z]+\s*=|\sstyle\s*=)/iu.test(value);
}

export const NEWS_ARTICLE_SCHEMA = z.object({
  news_id: uuid,
  title: safeText(300),
  summary: z.string().trim().max(2_000),
  hero_url: z.string().url().refine((value) => new URL(value).protocol === "https:", { message: "News-Bilder benötigen HTTPS." }).nullable(),
  published_at: instant.nullable(),
  status: z.enum(["draft", "published", "archived"]),
  sanitized_html: z.string().max(200_000).refine(allowlistedNewsHtml, { message: "Der News-Inhalt verletzt die HTML-Allowlist." }).nullable(),
}).strict().superRefine((article, context) => {
  if (article.status === "published" && article.published_at === null) {
    context.addIssue({ code: "custom", message: "Ein veröffentlichter Beitrag benötigt ein Veröffentlichungsdatum.", path: ["published_at"] });
  }
});

export const NEWS_DATA_SCHEMA = z.object({
  filter: z.enum(["public", "draft", "all_authorized"]),
  articles: z.array(NEWS_ARTICLE_SCHEMA).max(100),
  selected_news_id: uuid.nullable(),
}).strict().superRefine((data, context) => {
  if (data.selected_news_id !== null && !data.articles.some((article) => article.news_id === data.selected_news_id)) {
    context.addIssue({ code: "custom", message: "Der ausgewählte News-Beitrag muss in der sichtbaren Liste liegen.", path: ["selected_news_id"] });
  }
  if (data.filter === "public" && data.articles.some((article) => article.status !== "published")) {
    context.addIssue({ code: "custom", message: "Der öffentliche Filter darf ausschließlich veröffentlichte Beiträge enthalten.", path: ["articles"] });
  }
  if (data.filter === "draft" && data.articles.some((article) => article.status !== "draft")) {
    context.addIssue({ code: "custom", message: "Der Entwurfsfilter darf ausschließlich Entwürfe enthalten.", path: ["articles"] });
  }
});

export const NEWS_WIDGET_SCHEMA = z.object({
  widget: z.literal("news"),
  contract_version: z.literal("1.0.0"),
  title: safeText(120),
  club: CLUB_CHIP_SCHEMA,
  capability_version: z.string().trim().min(1).max(200).nullable(),
  generated_at: instant,
  data: NEWS_DATA_SCHEMA,
  actions: z.array(VISIBLE_SERVER_ACTION_DESCRIPTOR_SCHEMA).max(50),
  empty_state: z.object({ title: safeText(120), description: safeText(500) }).strict().nullable(),
}).strict().superRefine((widget, context) => {
  if ((widget.data.articles.length === 0) !== (widget.empty_state !== null)) {
    context.addIssue({ code: "custom", message: "Der Leerzustand muss exakt zur leeren Newsliste passen." });
  }
  if (widget.data.filter === "public" && (widget.capability_version !== null || widget.actions.length > 0)) {
    context.addIssue({ code: "custom", message: "Der öffentliche Newsfeed darf keine Capability oder Verwaltungsaktionen enthalten." });
  }
  const visibleNewsIds = new Set(
    widget.data.articles.map((article) => article.news_id),
  );
  if (widget.actions.some((action) => action.input === null || typeof action.input !== "object" || Array.isArray(action.input)
    || Object.prototype.hasOwnProperty.call(action.input, "club_id")
    || (typeof action.input.news_id === "string" && !visibleNewsIds.has(action.input.news_id))
    || (action.risk_class !== "read" && action.input.news_id !== widget.data.selected_news_id))) {
    context.addIssue({ code: "custom", message: "Jede News-Aktion muss an einen sichtbaren beziehungsweise ausgewählten Beitrag gebunden sein." });
  }
  if (widget.actions.some((action) => /publish|veroeffentlich/iu.test(action.action_id)
    && (action.risk_class !== "critical_write" || !action.requires_confirmation))) {
    context.addIssue({ code: "custom", message: "Öffentliche News-Wirkungen dürfen nur über den Bestätigungsflow laufen." });
  }
});

export const NEWS_WIDGET_PHASE_SCHEMA = z.enum([
  "loading", "empty", "ready_public", "ready_manage", "partial", "preview_expired", "auth_required", "permission_changed", "error",
]);

export const NEWS_WIDGET_STATE_SCHEMA = z.object({
  phase: NEWS_WIDGET_PHASE_SCHEMA,
  model: NEWS_WIDGET_SCHEMA.nullable(),
  message: z.string().trim().min(1).max(500).nullable(),
  retryable: z.boolean(),
}).strict().superRefine((state, context) => {
  if (["empty", "ready_public", "ready_manage", "partial", "preview_expired", "permission_changed"].includes(state.phase) && state.model === null) {
    context.addIssue({ code: "custom", message: "Ein darstellbarer Newszustand benötigt ein Modell." });
  }
  if (["loading", "auth_required"].includes(state.phase) && state.model !== null) {
    context.addIssue({ code: "custom", message: "Vor Anmeldung oder Laden dürfen keine privaten Newsdaten vorliegen." });
  }
  if (["loading", "partial", "preview_expired", "auth_required", "permission_changed", "error"].includes(state.phase) && state.message === null) {
    context.addIssue({ code: "custom", message: "Dieser Newszustand benötigt eine sichere Nutzerinformation." });
  }
  if (state.phase === "ready_public" && state.model?.data.filter !== "public") {
    context.addIssue({ code: "custom", message: "Der öffentliche Zustand benötigt den öffentlichen Filter." });
  }
  if (["ready_manage", "partial"].includes(state.phase) && state.model?.capability_version == null) {
    context.addIssue({ code: "custom", message: "Ein verwaltender Newszustand benötigt die aktuelle Capability-Version." });
  }
  if (["preview_expired", "permission_changed"].includes(state.phase) && state.model?.actions.length !== 0) {
    context.addIssue({ code: "custom", message: "Nach Ablauf oder Rechtewechsel dürfen keine alten Newsaktionen verbleiben." });
  }
});

export const CONFIRMATION_DATA_SCHEMA = z.object({
  preview: ACTION_PREVIEW_VIEW_SCHEMA,
  confirm_label: safeText(100),
  cancel_label: z.literal("Abbrechen"),
  acknowledgement_required: z.boolean(),
}).strict().superRefine((data, context) => {
  if (data.preview.masked_fields.some((field) => !/^[a-z][a-z0-9_.-]{0,99}$/u.test(field))) {
    context.addIssue({ code: "custom", message: "Maskierte Felder dürfen nur sichere Feldbezeichner enthalten.", path: ["preview", "masked_fields"] });
  }
});

export const CONFIRMATION_WIDGET_SCHEMA = z.object({
  widget: z.literal("confirmation"),
  contract_version: z.literal("1.0.0"),
  title: safeText(120),
  club: CLUB_CHIP_SCHEMA,
  capability_version: z.string().trim().min(1).max(200),
  generated_at: instant,
  data: CONFIRMATION_DATA_SCHEMA,
  actions: z.array(VISIBLE_SERVER_ACTION_DESCRIPTOR_SCHEMA).length(1),
  empty_state: z.null(),
}).strict().superRefine((widget, context) => {
  if (widget.data.preview.club_id !== widget.club.club_id) {
    context.addIssue({ code: "custom", message: "Vorschau und Dialog müssen an denselben Verein gebunden sein." });
  }
  if (Date.parse(widget.data.preview.expires_at) <= Date.parse(widget.generated_at)) {
    context.addIssue({ code: "custom", message: "Eine abgelaufene Vorschau darf nicht als bestätigbar gerendert werden." });
  }
  const action = widget.actions[0];
  const input = ACTION_CONFIRM_WIDGET_INPUT_SCHEMA.safeParse(action?.input);
  if (!action || action.tool_name !== "action_confirm" || action.risk_class !== "critical_write" || !action.requires_confirmation
    || !input.success || input.data.preview_id !== widget.data.preview.preview_id) {
    context.addIssue({ code: "custom", message: "Die Bestätigungsaktion muss exakt an Vorschau und Idempotenzschlüssel gebunden sein." });
  }
});

export const CONFIRMATION_WIDGET_PHASE_SCHEMA = z.enum([
  "loading", "ready", "confirming", "success", "cancelled", "expired", "stale", "conflict", "auth_required", "permission_changed", "error",
]);

export const CONFIRMATION_WIDGET_STATE_SCHEMA = z.object({
  phase: CONFIRMATION_WIDGET_PHASE_SCHEMA,
  model: CONFIRMATION_WIDGET_SCHEMA.nullable(),
  message: z.string().trim().min(1).max(500).nullable(),
  retryable: z.boolean(),
}).strict().superRefine((state, context) => {
  if (state.phase === "ready" && state.model === null) context.addIssue({ code: "custom", message: "Der bestätigbare Zustand benötigt genau eine aktuelle Vorschau." });
  if (state.phase !== "ready" && state.model !== null) context.addIssue({ code: "custom", message: "Außerhalb des bestätigbaren Zustands muss der Intent aus dem Client-State entfernt sein." });
  if (state.phase !== "ready" && state.message === null) context.addIssue({ code: "custom", message: "Ein nicht bestätigbarer Zustand benötigt eine sichere Nutzerinformation." });
});
