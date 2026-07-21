import { z } from "zod";

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
    if (!widget.club || action.input === null || typeof action.input !== "object" || Array.isArray(action.input)) return true;
    return action.input.club_id !== widget.club.club_id;
  })) {
    context.addIssue({ code: "custom", message: "Jede Widget-Aktion muss an denselben Verein gebunden sein." });
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
