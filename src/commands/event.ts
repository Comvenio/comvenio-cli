import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";

// event-service endpoints (verified Sub-File 05):
//   GET   /event/events/club/{club_id}          (Query view, month, start, end, complexity)
//   GET   /event/events/{event_id}
//   POST  /event/events/                        (EventCreate)
//   PATCH /event/events/{event_id}              (EventUpdate)
//   GET   /event/events/club/{club_id}/templates
//   POST  /event/events/{id}/clone-as-template
//   POST  /event/events/{template_id}/event-from-template
//   GET   /event/event-series/by-club/{club_id}
//   POST  /event/event-series/                  (EventSeriesCreate)
//   POST  /event/event-series/{id}/materialize
//   POST  /event/event-series/{id}/materialize-next
//   GET   /event/events/areas/by-event/{id}
//   POST  /event/events/areas/                  (EventAreaCreate)
// publish = PATCH {status:"confirmed"} (NO dedicated publish endpoint; enum has no "published").

type EventRead = {
  id?: string;
  title?: string;
  event_type?: string;
  status?: string;
  visibility_scope?: string;
  start_time?: string | null;
  end_time?: string | null;
  department_id?: string;
  description?: string | null;
  is_template?: boolean;
  [key: string]: unknown;
};
type EventAreaRead = { id?: string; name?: string; [key: string]: unknown };
type EventProgramItemRead = { id?: string; title?: string; start_time?: string | null; reference_type?: string | null; reference_id?: string | null; [key: string]: unknown };
type EventSeriesRead = {
  id?: string;
  title?: string;
  dtstart?: string;
  rrule?: string | null;
  series_type?: string;
  materialization_mode?: string;
  template_event_id?: string;
  [key: string]: unknown;
};

export type EventCommandOpts = {
  json?: boolean;
  club?: string;
  view?: string;
  month?: string;
  start?: string;
  end?: string;
  complexity?: string;
  title?: string;
  eventType?: string;
  visibilityScope?: string;
  organizerType?: string;
  departmentId?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  location?: string;
  status?: string;
  organizerMemberId?: string;
  public?: boolean;
  // templates
  withoutTags?: boolean;
  withoutAreas?: boolean;
  withoutTasks?: boolean;
  copyTaskAssignments?: boolean;
  // series
  rrule?: string;
  frequency?: string;
  interval?: string;
  weekdays?: string;
  byMonth?: string;
  byMonthDay?: string;
  durationMinutes?: string;
  timezone?: string;
  until?: string;
  count?: string;
  allDay?: boolean;
  rdates?: string;
  exdates?: string;
  seriesType?: string;
  materializationMode?: string;
  // area
  name?: string;
  color?: string;
  areaCategory?: string;
  // program
  referenceType?: string;
  referenceId?: string;
  referenceLabel?: string;
  referenceUrl?: string;
  sortOrder?: string;
  // menu (EventMenu = supply-service)
  menu?: string;
  area?: string;
  notes?: string;
};

const VALID_FREQUENCIES = new Set(["daily", "weekly", "monthly", "yearly"]);
const VALID_WEEKDAYS = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

function positiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} muss eine positive ganze Zahl sein.`);
  }
  return parsed;
}

function isoDate(value: string | undefined, flag: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} muss ein gueltiges ISO-Datum sein.`);
  }
  return parsed.toISOString();
}

function isoDateList(value: string | undefined, flag: string): string[] {
  if (!value) return [];
  return value.split(",").map((entry) => {
    const trimmed = entry.trim();
    const parsed = isoDate(trimmed, flag);
    if (!parsed) throw new Error(`${flag} enthaelt einen leeren Wert.`);
    return parsed;
  });
}

function rruleUntil(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("--until muss ein gueltiges ISO-Datum sein.");
  }
  return parsed.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildSeriesRrule(
  o: EventCommandOpts,
  defaultFrequency = "weekly",
): string {
  const friendlyFlags = [
    o.frequency,
    o.interval,
    o.weekdays,
    o.byMonth,
    o.byMonthDay,
    o.until,
    o.count,
  ];
  if (o.rrule) {
    if (friendlyFlags.some((value) => value != null)) {
      throw new Error("--rrule kann nicht mit den vereinfachten Serien-Flags kombiniert werden.");
    }
    return o.rrule.replace(/^RRULE:/i, "");
  }

  const frequency = (o.frequency ?? defaultFrequency).toLowerCase();
  if (!VALID_FREQUENCIES.has(frequency)) {
    throw new Error("--frequency muss daily, weekly, monthly oder yearly sein.");
  }
  if (o.count && o.until) {
    throw new Error("--count und --until koennen nicht gleichzeitig verwendet werden.");
  }

  const parts = [`FREQ=${frequency.toUpperCase()}`];
  const interval = positiveInteger(o.interval, "--interval");
  if (interval) parts.push(`INTERVAL=${interval}`);

  if (o.weekdays) {
    const weekdays = o.weekdays.split(",").map((value) => value.trim().toUpperCase());
    if (!weekdays.length || weekdays.some((value) => !VALID_WEEKDAYS.has(value))) {
      throw new Error("--weekdays erwartet MO,TU,WE,TH,FR,SA oder SU.");
    }
    parts.push(`BYDAY=${[...new Set(weekdays)].join(",")}`);
  }

  const byMonth = positiveInteger(o.byMonth, "--by-month");
  if (byMonth) {
    if (byMonth > 12) throw new Error("--by-month muss zwischen 1 und 12 liegen.");
    parts.push(`BYMONTH=${byMonth}`);
  }
  const byMonthDay = positiveInteger(o.byMonthDay, "--by-month-day");
  if (byMonthDay) {
    if (byMonthDay > 31) throw new Error("--by-month-day muss zwischen 1 und 31 liegen.");
    parts.push(`BYMONTHDAY=${byMonthDay}`);
  }

  const count = positiveInteger(o.count, "--count");
  if (count) parts.push(`COUNT=${count}`);
  if (o.until) parts.push(`UNTIL=${rruleUntil(o.until)}`);
  return parts.join(";");
}

export function eventUpdateBody(o: EventCommandOpts): Record<string, unknown> {
  return prune({
    title: o.title,
    event_type: o.eventType,
    visibility_scope: o.visibilityScope,
    organizer_type: o.organizerType,
    department_id: o.departmentId,
    start_time: o.startTime,
    end_time: o.endTime,
    description: o.description,
    location: o.location,
    status: o.status,
    organizer_member_id: o.organizerMemberId,
    event_complexity: o.complexity,
  });
}

export function buildEventCreateBody(
  o: EventCommandOpts,
  clubId: string,
  isTemplate = false,
): Record<string, unknown> {
  return {
    club_id: clubId,
    ...eventUpdateBody(o),
    ...(isTemplate ? { is_template: true } : {}),
  };
}

export function buildTemplateInstanceBody(o: EventCommandOpts): Record<string, unknown> {
  if (!o.startTime || !o.endTime) {
    throw new Error("event template instantiate benoetigt --start-time und --end-time.");
  }
  return prune({
    start_time: o.startTime,
    end_time: o.endTime,
    title: o.title,
    description: o.description,
    location: o.location,
    visibility_scope: o.visibilityScope,
    department_id: o.departmentId,
    event_type: o.eventType,
    status: o.status,
    organizer_type: o.organizerType,
    organizer_member_id: o.organizerMemberId,
    copy_tags: !o.withoutTags,
    copy_areas: !o.withoutAreas,
    copy_tasks: !o.withoutTasks,
    copy_task_assignments: Boolean(o.copyTaskAssignments),
  });
}

export function buildSeriesCreateBody(
  o: EventCommandOpts,
  clubId: string,
  template: EventRead,
): Record<string, unknown> {
  if (template.is_template !== true) {
    throw new Error("Die angegebene Event-ID ist keine Vorlage.");
  }
  if (!o.startTime) {
    throw new Error("event series create benoetigt --start-time <iso>.");
  }

  const rawSeriesType = (o.seriesType ?? "recurring").toLowerCase();
  if (!new Set(["recurring", "yearly"]).has(rawSeriesType)) {
    throw new Error("--series-type muss recurring oder yearly sein.");
  }
  const seriesType = rawSeriesType === "yearly" ? "YEARLY_TEMPLATE" : "RECURRING";
  const rawMode = (o.materializationMode ?? (seriesType === "YEARLY_TEMPLATE" ? "manual" : "auto")).toLowerCase();
  if (!new Set(["auto", "manual"]).has(rawMode)) {
    throw new Error("--materialization-mode muss auto oder manual sein.");
  }
  const title = o.title ?? template.title;
  if (!title) throw new Error("Die Vorlage hat keinen Titel; bitte --title angeben.");

  const templateDuration = template.start_time && template.end_time
    ? Math.max(1, Math.round((new Date(template.end_time).getTime() - new Date(template.start_time).getTime()) / 60000))
    : 120;
  const duration = positiveInteger(o.durationMinutes, "--duration-minutes") ?? templateDuration;
  const defaultFrequency = seriesType === "YEARLY_TEMPLATE" ? "yearly" : "weekly";

  return prune({
    club_id: clubId,
    title,
    description: o.description ?? template.description,
    dtstart: isoDate(o.startTime, "--start-time"),
    duration_minutes: duration,
    timezone: o.timezone ?? "Europe/Berlin",
    rrule: buildSeriesRrule(o, defaultFrequency),
    rdates: isoDateList(o.rdates, "--rdates"),
    exdates: isoDateList(o.exdates, "--exdates"),
    until: isoDate(o.until, "--until"),
    count: positiveInteger(o.count, "--count"),
    is_all_day: Boolean(o.allDay),
    template_event_id: template.id,
    default_department_id: o.departmentId ?? template.department_id,
    series_type: seriesType,
    materialization_mode: rawMode.toUpperCase(),
  });
}

/**
 * `comvenio event <action> [arg1] [arg2]` dispatcher.
 *   event list|show|create|update|publish
 *   event template list|create|clone|instantiate [id]
 *   event series list|show|create|materialize|next|promote-recurring|promote-yearly [id]
 *   event area list <event-id> | event area add <event-id> --name X
 *   event program list <event-id> | event program add <event-id> --title X --area <area-id>
 */
export function registerEventCommands(cli: CAC): void {
  cli
    .command("event <action> [arg1] [arg2]", "Veranstaltungen: list|show|create|update|publish | template | series | area | program | menu")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--view <v>", "full|calendar (Default full)")
    .option("--month <v>", "YYYY-MM")
    .option("--start <v>", "ISO Start")
    .option("--end <v>", "ISO Ende")
    .option("--complexity <v>", "simple|multi_day")
    .option("--title <v>", "Titel")
    .option("--event-type <v>", "party|meeting|excursion|training|competition|other")
    .option("--visibility-scope <v>", "public|member|private|department|invite_only")
    .option("--organizer-type <v>", "member|external")
    .option("--department-id <v>", "Abteilungs-ID (Pflicht bei create)")
    .option("--start-time <v>", "ISO datetime")
    .option("--end-time <v>", "ISO datetime")
    .option("--description <v>", "Beschreibung")
    .option("--location <v>", "Ort")
    .option("--status <v>", "draft|planned|confirmed|archived|cancelled")
    .option("--organizer-member-id <v>", "Organisator (Member-ID)")
    .option("--public", "publish: visibility_scope auf public setzen")
    // template flags
    .option("--without-tags", "instantiate: Tags nicht aus der Vorlage kopieren")
    .option("--without-areas", "instantiate: Bereiche nicht aus der Vorlage kopieren")
    .option("--without-tasks", "instantiate: Aufgaben nicht aus der Vorlage kopieren")
    .option("--copy-task-assignments", "instantiate: auch Aufgaben-Zuweisungen kopieren")
    // series flags
    .option("--series-type <v>", "recurring|yearly (Default recurring)")
    .option("--materialization-mode <v>", "auto|manual (Default passend zum Serien-Typ)")
    .option("--frequency <v>", "daily|weekly|monthly|yearly (Default weekly)")
    .option("--interval <n>", "Wiederholung alle n Tage/Wochen/Monate/Jahre")
    .option("--weekdays <v>", "Wochentage als MO,TU,WE,TH,FR,SA,SU")
    .option("--by-month <n>", "Monat 1-12 fuer jaehrliche Serien")
    .option("--by-month-day <n>", "Tag im Monat 1-31")
    .option("--rrule <v>", "Erweiterte RRULE; ersetzt die vereinfachten Serien-Flags")
    .option("--duration-minutes <n>", "Termindauer in Minuten (Default aus Vorlage oder 120)")
    .option("--timezone <v>", "Zeitzone (Default Europe/Berlin)")
    .option("--until <iso>", "Letzte Wiederholung als ISO-Datum")
    .option("--count <n>", "Maximale Anzahl Wiederholungen")
    .option("--all-day", "Ganztagstermin")
    .option("--rdates <v>", "Zusaetzliche ISO-Termine, kommasepariert")
    .option("--exdates <v>", "Ausgenommene ISO-Termine, kommasepariert")
    // area flags
    .option("--name <v>", "Bereichsname (area add)")
    .option("--color <v>", "Bereichsfarbe (area add)")
    .option("--area-category <v>", "Bereichskategorie (area add)")
    // program flags
    .option("--reference-type <v>", "Programmpunkt-Referenztyp, z. B. tournament")
    .option("--reference-id <v>", "Programmpunkt-Referenz-ID")
    .option("--reference-label <v>", "Programmpunkt-Referenz-Anzeige")
    .option("--reference-url <v>", "Programmpunkt-Referenz-Link")
    .option("--sort-order <n>", "Programmpunkt-Reihenfolge")
    // menu flags (EventMenu = Speisekarte je Event/Bereich)
    .option("--menu <id>", "Speisekarte-ID (menu assign)")
    .option("--area <id>", "Bereich/EventArea-ID (menu assign; siehe: event area list <event-id>)")
    .option("--notes <text>", "Notiz zur Zuordnung (menu assign)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(
      async (
        action: string,
        arg1: string | undefined,
        arg2: string | undefined,
        opts: EventCommandOpts,
      ) => {
        const state = loadState();
        const client = createClient(state);
        const clubId = requireClubId(state, opts.club);

        // event template <sub> [id]
        if (action === "template") {
          const sub = arg1;
          const id = arg2;
          if (sub === "list") {
            const params = new URLSearchParams();
            if (opts.view) params.set("view", opts.view);
            if (opts.month) params.set("month", opts.month);
            if (opts.start) params.set("start", opts.start);
            if (opts.end) params.set("end", opts.end);
            const qs = params.toString();
            const templates = await client.get<EventRead[]>(
              "event",
              `/events/club/${clubId}/templates${qs ? `?${qs}` : ""}`,
            );
            output(templates, opts.json, () =>
              templates.length
                ? renderTable(templates, [
                    { header: "ID", width: 36, get: (e) => String(e.id ?? "") },
                    { header: "Vorlage", width: 28, get: (e) => String(e.title ?? "—") },
                    { header: "Typ", width: 14, get: (e) => String(e.event_type ?? "—") },
                  ])
                : "Keine Event-Vorlagen.",
            );
            return;
          }
          if (sub === "create") {
            const missing = [
              ["--title", opts.title],
              ["--event-type", opts.eventType],
              ["--visibility-scope", opts.visibilityScope],
              ["--organizer-type", opts.organizerType],
              ["--department-id", opts.departmentId],
            ].filter(([, value]) => !value).map(([flag]) => flag);
            if (missing.length) {
              throw new Error(`event template create benoetigt: ${missing.join(", ")}.`);
            }
            const template = await client.post<EventRead>(
              "event",
              "/events/",
              buildEventCreateBody(opts, clubId, true),
            );
            output(template, opts.json, () => `Event-Vorlage angelegt: ${template.title} (${template.id})`);
            return;
          }
          if (sub === "clone") {
            if (!id) throw new Error("event template clone benoetigt eine <event-id>.");
            const template = await client.post<EventRead>("event", `/events/${id}/clone-as-template`);
            output(template, opts.json, () => `Event als Vorlage gespeichert: ${template.title ?? id} (${template.id})`);
            return;
          }
          if (sub === "instantiate") {
            if (!id) throw new Error("event template instantiate benoetigt eine <template-id>.");
            const event = await client.post<EventRead>(
              "event",
              `/events/${id}/event-from-template`,
              buildTemplateInstanceBody(opts),
            );
            output(event, opts.json, () => `Termin aus Vorlage angelegt: ${event.title ?? "—"} (${event.id})`);
            return;
          }
          throw new Error(`Unbekannte event-template-Aktion "${sub}". Verfuegbar: list, create, clone, instantiate`);
        }

        // event series <sub> [id]
        if (action === "series") {
          const sub = arg1;
          const id = arg2;
          if (sub === "list") {
            const rows = await client.get<EventSeriesRead[]>("event", `/event-series/by-club/${clubId}`);
            output(rows, opts.json, () =>
              rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (s) => String(s.id ?? "") },
                    { header: "Terminserie", width: 28, get: (s) => String(s.title ?? "—") },
                    { header: "Typ", width: 16, get: (s) => String(s.series_type ?? "—") },
                    { header: "Start", width: 20, get: (s) => String(s.dtstart ?? "—") },
                  ])
                : "Keine Terminserien.",
            );
            return;
          }
          if (sub === "show") {
            if (!id) throw new Error("event series show benoetigt eine <series-id>.");
            const series = await client.get<EventSeriesRead>("event", `/event-series/${id}`);
            output(series, opts.json, () => [
              `Terminserie: ${series.title ?? "—"}`,
              `ID:          ${series.id ?? id}`,
              `Typ:         ${series.series_type ?? "—"}`,
              `Start:       ${series.dtstart ?? "—"}`,
              `Regel:       ${series.rrule ?? "—"}`,
            ].join("\n"));
            return;
          }
          if (sub === "create") {
            if (!id) throw new Error("event series create benoetigt eine <template-id>.");
            const template = await client.get<EventRead>("event", `/events/${id}`);
            const series = await client.post<EventSeriesRead>(
              "event",
              "/event-series/",
              buildSeriesCreateBody(opts, clubId, template),
            );
            output(series, opts.json, () => `Terminserie angelegt: ${series.title ?? "—"} (${series.id})`);
            return;
          }
          if (sub === "materialize") {
            if (!id) throw new Error("event series materialize benoetigt eine <series-id>.");
            if (!opts.start || !opts.end) {
              throw new Error("event series materialize benoetigt --start und --end.");
            }
            const result = await client.post<Record<string, unknown>>(
              "event",
              `/event-series/${id}/materialize`,
              { window_start: opts.start, window_end: opts.end },
            );
            output(result, opts.json, () => {
              const created = Array.isArray(result.created_event_ids) ? result.created_event_ids.length : 0;
              return `${created} Termin(e) erstellt; ${result.skipped_existing ?? 0} bereits vorhanden.`;
            });
            return;
          }
          if (sub === "next") {
            if (!id) throw new Error("event series next benoetigt eine <series-id>.");
            if (!opts.startTime) throw new Error("event series next benoetigt --start-time <iso>.");
            const event = await client.post<EventRead>(
              "event",
              `/event-series/${id}/materialize-next`,
              { start_time: opts.startTime },
            );
            output(event, opts.json, () => `Naechsten Termin angelegt: ${event.title ?? "—"} (${event.id})`);
            return;
          }
          if (sub === "promote-recurring") {
            if (!id) throw new Error("event series promote-recurring benoetigt eine <event-id>.");
            const result = await client.post<Record<string, unknown>>(
              "event",
              `/events/${id}/promote-to-recurring-series`,
              {
                rrule: buildSeriesRrule(opts, "weekly"),
                title: opts.title,
                timezone: opts.timezone ?? "Europe/Berlin",
              },
            );
            output(result, opts.json, () => `Event in Terminserie umgewandelt: ${result.series_id ?? "—"}`);
            return;
          }
          if (sub === "promote-yearly") {
            if (!id) throw new Error("event series promote-yearly benoetigt eine <event-id>.");
            const result = await client.post<Record<string, unknown>>(
              "event",
              `/events/${id}/promote-to-yearly-series`,
            );
            output(result, opts.json, () => `Event als jaehrliche Terminserie gespeichert: ${result.series_id ?? "—"}`);
            return;
          }
          throw new Error(
            `Unbekannte event-series-Aktion "${sub}". Verfuegbar: list, show, create, materialize, next, promote-recurring, promote-yearly`,
          );
        }

        // event area <sub> <event-id>
        if (action === "area") {
          const sub = arg1;
          const eventId = arg2;
          if (sub === "list") {
            if (!eventId) throw new Error("event area list benoetigt eine <event-id>.");
            const areas = await client.get<EventAreaRead[]>(
              "event",
              `/events/areas/by-event/${eventId}`,
            );
            output(areas, opts.json, () =>
              areas.length
                ? renderTable(areas, [
                    { header: "ID", width: 36, get: (a) => String(a.id ?? "") },
                    { header: "Name", width: 24, get: (a) => String(a.name ?? "—") },
                  ])
                : "Keine Bereiche.",
            );
            return;
          }
          if (sub === "add") {
            if (!eventId) throw new Error("event area add benoetigt eine <event-id>.");
            if (!opts.name) throw new Error("event area add benoetigt --name <v>.");
            const body = prune({
              event_id: eventId,
              club_id: clubId,
              name: opts.name,
              description: opts.description,
              color: opts.color,
              public: opts.public,
              area_category: opts.areaCategory,
            });
            const area = await client.post<EventAreaRead>("event", "/events/areas/", body);
            output(area, opts.json, () => `Bereich angelegt: ${area.name} (${area.id})`);
            return;
          }
          throw new Error(`Unbekannte event-area-Aktion "${sub}". Verfuegbar: list, add`);
        }

        // event program <sub> <event-id> — Programmpunkte im event-service.
        if (action === "program") {
          const sub = arg1;
          const eventId = arg2;
          if (sub === "list") {
            if (!eventId) throw new Error("event program list benoetigt eine <event-id>.");
            const rows = await client.get<EventProgramItemRead[]>("event", `/events/${eventId}/program-items`);
            output(rows, opts.json, () =>
              Array.isArray(rows) && rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                    { header: "Titel", width: 30, get: (r) => String(r.title ?? "—") },
                    { header: "Start", width: 20, get: (r) => String(r.start_time ?? "—") },
                    { header: "Referenz", width: 16, get: (r) => String(r.reference_type ?? "—") },
                    { header: "Ref-ID", width: 36, get: (r) => String(r.reference_id ?? "—") },
                  ])
                : "Keine Programmpunkte.",
            );
            return;
          }
          if (sub === "add") {
            if (!eventId) throw new Error("event program add benoetigt eine <event-id>.");
            if (!opts.title) throw new Error("event program add benoetigt --title <v>.");
            if (!opts.area) throw new Error("event program add benoetigt --area <area-id>.");
            if (!opts.startTime) throw new Error("event program add benoetigt --start-time <iso>.");
            const body = prune({
              club_id: clubId,
              area_id: opts.area,
              title: opts.title,
              description: opts.description,
              start_time: opts.startTime,
              end_time: opts.endTime,
              sort_order: opts.sortOrder != null ? Number(opts.sortOrder) : undefined,
              reference_type: opts.referenceType,
              reference_id: opts.referenceId,
              reference_label: opts.referenceLabel,
              reference_url: opts.referenceUrl,
            });
            const item = await client.post<EventProgramItemRead>("event", `/events/${eventId}/program-items`, body);
            output(item, opts.json, () => `Programmpunkt angelegt: ${item.title ?? opts.title} (${item.id ?? "?"})`);
            return;
          }
          throw new Error(`Unbekannte event-program-Aktion "${sub}". Verfuegbar: list, add`);
        }
        // event menu <sub> [event-id|event-menu-id]  — EventMenu liegt im SUPPLY-service
        // (gateway-key "supply"), NICHT event-service. Verifiziert: routes/menu.py.
        //   list    → GET    /menu/events/{event_id}/menus        (alle Zuordnungen des Events)
        //   assign  → POST   /menu/events/menus                   (EventMenuCreate: event_id, event_area_id PFLICHT, menu_id, notes; club_id wird aus dem Menu abgeleitet)
        //   unassign→ DELETE /menu/events/menus/{event_menu_id}
        if (action === "menu") {
          const sub = arg1;
          if (sub === "list") {
            const eventId = arg2;
            if (!eventId) throw new Error("event menu list benoetigt eine <event-id>.");
            const rows = await client.get<Array<Record<string, unknown>>>(
              "supply",
              `/menu/events/${eventId}/menus`,
            );
            output(rows, opts.json, () =>
              Array.isArray(rows) && rows.length
                ? renderTable(rows, [
                    { header: "EventMenu-ID", width: 36, get: (r) => String(r.id ?? "") },
                    { header: "Menu-ID", width: 36, get: (r) => String(r.menu_id ?? "") },
                    { header: "Bereich/Area", width: 36, get: (r) => String(r.event_area_id ?? "— (Default)") },
                  ])
                : "Keine Speisekarten zugeordnet.",
            );
            return;
          }
          if (sub === "assign") {
            const eventId = arg2;
            if (!eventId) throw new Error("event menu assign benoetigt eine <event-id>.");
            if (!opts.menu) throw new Error("event menu assign benoetigt --menu <menu-id>.");
            if (!opts.area) {
              throw new Error("event menu assign benoetigt --area <area-id> (EventArea; siehe: event area list <event-id>).");
            }
            const body = prune({
              event_id: eventId,
              event_area_id: opts.area,
              menu_id: opts.menu,
              notes: opts.notes,
            });
            const em = await client.post<Record<string, unknown>>("supply", "/menu/events/menus", body);
            output(em, opts.json, () =>
              `Speisekarte zugeordnet: Menu ${opts.menu} -> Event ${eventId} / Bereich ${opts.area} (${em.id ?? "?"})`,
            );
            return;
          }
          if (sub === "unassign") {
            const eventMenuId = arg2;
            if (!eventMenuId) {
              throw new Error("event menu unassign benoetigt eine <event-menu-id> (siehe: event menu list <event-id>).");
            }
            await client.del("supply", `/menu/events/menus/${eventMenuId}`);
            output({ deleted: eventMenuId }, opts.json, () => `Zuordnung entfernt: ${eventMenuId}`);
            return;
          }
          throw new Error(`Unbekannte event-menu-Aktion "${sub}". Verfuegbar: list, assign, unassign`);
        }

        switch (action) {
          case "list": {
            const params = new URLSearchParams();
            if (opts.view) params.set("view", opts.view);
            if (opts.month) params.set("month", opts.month);
            if (opts.start) params.set("start", opts.start);
            if (opts.end) params.set("end", opts.end);
            if (opts.complexity) params.set("complexity", opts.complexity);
            const qs = params.toString();
            const data = await client.get<EventRead[]>(
              "event",
              `/events/club/${clubId}${qs ? `?${qs}` : ""}`,
            );
            output(data, opts.json, () =>
              data.length
                ? renderTable(data, [
                    { header: "ID", width: 36, get: (e) => String(e.id ?? "") },
                    { header: "Titel", width: 24, get: (e) => String(e.title ?? "—") },
                    { header: "Typ", width: 12, get: (e) => String(e.event_type ?? "—") },
                    { header: "Status", width: 10, get: (e) => String(e.status ?? "—") },
                  ])
                : "Keine Veranstaltungen.",
            );
            break;
          }
          case "show": {
            const id = arg1;
            if (!id) throw new Error("event show benoetigt eine <event-id>.");
            const e = await client.get<EventRead>("event", `/events/${id}`);
            output(e, opts.json, () =>
              [
                `Titel:      ${e.title ?? "—"}`,
                `ID:         ${e.id ?? id}`,
                `Typ:        ${e.event_type ?? "—"}`,
                `Status:     ${e.status ?? "—"}`,
                `Sichtbar:   ${e.visibility_scope ?? "—"}`,
                `Start:      ${e.start_time ?? "—"}`,
              ].join("\n"),
            );
            break;
          }
          case "create": {
            const missing = [
              ["--title", opts.title],
              ["--event-type", opts.eventType],
              ["--visibility-scope", opts.visibilityScope],
              ["--organizer-type", opts.organizerType],
              ["--department-id", opts.departmentId],
            ].filter(([, v]) => !v).map(([flag]) => flag);
            if (missing.length) {
              throw new Error(`event create benoetigt: ${missing.join(", ")}.`);
            }
            const body = buildEventCreateBody(opts, clubId);
            const e = await client.post<EventRead>("event", "/events/", body);
            output(e, opts.json, () => `Veranstaltung angelegt: ${e.title} (${e.id})`);
            break;
          }
          case "update": {
            const id = arg1;
            if (!id) throw new Error("event update benoetigt eine <event-id>.");
            const body = eventUpdateBody(opts);
            if (Object.keys(body).length === 0) {
              throw new Error("event update benoetigt mindestens ein zu aenderndes Feld.");
            }
            const e = await client.patch<EventRead>("event", `/events/${id}`, body);
            output(e, opts.json, () => `Veranstaltung aktualisiert: ${e.title} (${e.id})`);
            break;
          }
          case "publish": {
            const id = arg1;
            if (!id) throw new Error("event publish benoetigt eine <event-id>.");
            // No dedicated publish endpoint — PATCH status=confirmed (Sub-File 05).
            const body: Record<string, string> = { status: "confirmed" };
            if (opts.public) body.visibility_scope = "public";
            const e = await client.patch<EventRead>("event", `/events/${id}`, body);
            output(e, opts.json, () =>
              `Veranstaltung veroeffentlicht: ${e.title ?? id} (status=${e.status ?? "confirmed"})`,
            );
            break;
          }
          default:
            throw new Error(
              `Unbekannte Aktion "${action}". Verfuegbar: list, show, create, update, publish, template, series, area, program, menu`,
            );
        }
      },
    );
}
