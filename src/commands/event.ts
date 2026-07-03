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
  [key: string]: unknown;
};
type EventAreaRead = { id?: string; name?: string; [key: string]: unknown };
type EventProgramItemRead = { id?: string; title?: string; start_time?: string | null; reference_type?: string | null; reference_id?: string | null; [key: string]: unknown };

type Opts = {
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

function eventUpdateBody(o: Opts): Record<string, unknown> {
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
    complexity: o.complexity,
  });
}

/**
 * `comvenio event <action> [arg1] [arg2]` dispatcher.
 *   event list|show|create|update|publish
 *   event area list <event-id> | event area add <event-id> --name X
 *   event program list <event-id> | event program add <event-id> --title X --area <area-id>
 */
export function registerEventCommands(cli: CAC): void {
  cli
    .command("event <action> [arg1] [arg2]", "Veranstaltungen: list|show|create|update|publish | area list|add | program list|add | menu list|assign|unassign")
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
        opts: Opts,
      ) => {
        const state = loadState();
        const client = createClient(state);
        const clubId = requireClubId(state, opts.club);

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
            const body = { club_id: clubId, ...eventUpdateBody(opts) };
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
              `Unbekannte Aktion "${action}". Verfuegbar: list, show, create, update, publish, area, program, menu`,
            );
        }
      },
    );
}
