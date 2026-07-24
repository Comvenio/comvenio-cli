import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

type ClubObjectRead = {
  id?: string;
  club_id?: string;
  department_id?: string;
  room_id?: string | null;
  name?: string;
  type?: string;
  booking_granularity?: string;
  [key: string]: unknown;
};
type BuildingRead = {
  id?: string;
  club_id?: string;
  department_id?: string;
  name?: string;
  address?: string | null;
  club_rooms?: unknown[];
  [key: string]: unknown;
};
type RoomRead = {
  id?: string;
  building_id?: string;
  name?: string;
  capacity?: number | null;
  booking?: boolean;
  [key: string]: unknown;
};
type RuleRead = {
  id?: string;
  object_id?: string;
  title?: string;
  weekday?: string;
  start_time?: string;
  end_time?: string;
  priority?: string;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
  type?: string;
  withAll?: boolean;
  withRooms?: boolean;
  force?: boolean;
  objectId?: string;
  file?: string;
};

const VALID_TYPES = new Set(["static", "portable", "event"]);

function objectPayload(path: string | undefined, command: string): Record<string, unknown> {
  if (!path) throw new Error(`${command} benötigt --file <payload.json>.`);
  const body = readJsonFile<unknown>(path);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${command}: --file muss ein JSON-Objekt enthalten.`);
  }
  return body as Record<string, unknown>;
}

function arrayPayload(path: string | undefined, command: string): Record<string, unknown>[] {
  if (!path) throw new Error(`${command} benötigt --file <payload.json>.`);
  const body = readJsonFile<unknown>(path);
  if (!Array.isArray(body) || body.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error(`${command}: --file muss ein JSON-Array aus Objekten enthalten.`);
  }
  return body as Record<string, unknown>[];
}

export function pathWithForce(path: string, force: boolean | undefined): string {
  return force ? `${path}?force=true` : path;
}

function objectListPath(clubId: string, type: string | undefined, withAll: boolean | undefined): string {
  let path = `/objects/club/${clubId}`;
  if (type) {
    if (!VALID_TYPES.has(type)) {
      throw new Error(`Ungültiger --type "${type}". Erlaubt: static, portable, event.`);
    }
    path += `/${type}`;
  }
  if (withAll) path += "?withAll=true";
  return path;
}

export function registerObjectCommands(cli: CAC): void {
  cli
    .command(
      "object <action> [arg1] [arg2]",
      "Objekte: list|show|create|update|delete | building | room | booking-rule | task-rule",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--type <t>", "static|portable|event")
    .option("--object-id <id>", "Objekt-ID zum Filtern von Regeln")
    .option("--with-all", "Verschachtelte Objektdaten mitladen")
    .option("--with-rooms", "Gebäude inklusive Räume laden")
    .option("--force", "Kaskadierendes Soft-Delete der Kind-Entitäten")
    .option("--file <path>", "JSON-Payload für Create-/Update-/Bulk-Aktionen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(
      async (
        action: string,
        arg1: string | undefined,
        arg2: string | undefined,
        opts: Opts,
      ) => {
        const state = await loadState();
        const client = createClient(state);
        const clubId = requireClubId(state, opts.club);

        if (action === "building") {
          const sub = arg1;
          const id = arg2;
          if (sub === "list") {
            const suffix = opts.withRooms ? "?withRooms=true" : "";
            const rows = await client.get<BuildingRead[]>("object", `/buildings/club/${clubId}${suffix}`);
            output(rows, opts.json, () =>
              rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                    { header: "Gebäude", width: 28, get: (r) => String(r.name ?? "—") },
                    { header: "Adresse", width: 32, get: (r) => String(r.address ?? "—") },
                    { header: "Räume", width: 6, get: (r) => String(r.club_rooms?.length ?? "—") },
                  ])
                : "Keine Gebäude.",
            );
            return;
          }
          if (sub === "show") {
            if (!id) throw new Error("object building show benötigt eine <building-id>.");
            const suffix = opts.withRooms ? "?withRooms=true" : "";
            const row = await client.get<BuildingRead>("object", `/buildings/${id}${suffix}`);
            output(row, opts.json, () => `Gebäude: ${row.name ?? "—"} (${row.id ?? id})`);
            return;
          }
          if (sub === "create") {
            const body = { ...objectPayload(opts.file, "object building create"), club_id: clubId };
            const row = await client.post<BuildingRead>("object", "/buildings/", body);
            output(row, opts.json, () => `Gebäude angelegt: ${row.name ?? "—"} (${row.id ?? "?"})`);
            return;
          }
          if (sub === "update") {
            if (!id) throw new Error("object building update benötigt eine <building-id>.");
            const current = await client.get<BuildingRead>("object", `/buildings/${id}`);
            const file = objectPayload(opts.file, "object building update");
            const body = {
              ...file,
              id,
              club_id: clubId,
              department_id: file.department_id ?? current.department_id,
            };
            if (!body.department_id) throw new Error("Gebäude-Update benötigt department_id in --file oder im bestehenden Gebäude.");
            const row = await client.patch<BuildingRead>("object", `/buildings/${id}`, body);
            output(row, opts.json, () => `Gebäude aktualisiert: ${row.name ?? "—"} (${row.id ?? id})`);
            return;
          }
          if (sub === "delete") {
            if (!id) throw new Error("object building delete benötigt eine <building-id>.");
            await client.del("object", pathWithForce(`/buildings/${id}`, opts.force));
            output({ deleted: id, force: Boolean(opts.force) }, opts.json, () => `Gebäude entfernt: ${id}`);
            return;
          }
          throw new Error(`Unbekannte object-building-Aktion "${sub}". Verfügbar: list, show, create, update, delete`);
        }

        if (action === "room") {
          const sub = arg1;
          const id = arg2;
          if (sub === "list") {
            const rows = await client.get<RoomRead[]>("object", `/rooms/club/${clubId}`);
            output(rows, opts.json, () =>
              rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                    { header: "Raum", width: 28, get: (r) => String(r.name ?? "—") },
                    { header: "Kapazität", width: 10, get: (r) => String(r.capacity ?? "—") },
                    { header: "Buchbar", width: 7, get: (r) => (r.booking ? "ja" : "nein") },
                  ])
                : "Keine Räume.",
            );
            return;
          }
          if (sub === "show") {
            if (!id) throw new Error("object room show benötigt eine <room-id>.");
            const row = await client.get<RoomRead>("object", `/rooms/${id}`);
            output(row, opts.json, () => `Raum: ${row.name ?? "—"} (${row.id ?? id})`);
            return;
          }
          if (sub === "create") {
            const body = { ...objectPayload(opts.file, "object room create"), club_id: clubId };
            const row = await client.post<RoomRead>("object", "/rooms/", body);
            output(row, opts.json, () => `Raum angelegt: ${row.name ?? "—"} (${row.id ?? "?"})`);
            return;
          }
          if (sub === "update") {
            if (!id) throw new Error("object room update benötigt eine <room-id>.");
            const body = { ...objectPayload(opts.file, "object room update"), id };
            const row = await client.patch<RoomRead>("object", "/rooms/", body);
            output(row, opts.json, () => `Raum aktualisiert: ${row.name ?? "—"} (${row.id ?? id})`);
            return;
          }
          if (sub === "delete") {
            if (!id) throw new Error("object room delete benötigt eine <room-id>.");
            await client.del("object", pathWithForce(`/rooms/${id}`, opts.force));
            output({ deleted: id, force: Boolean(opts.force) }, opts.json, () => `Raum entfernt: ${id}`);
            return;
          }
          throw new Error(`Unbekannte object-room-Aktion "${sub}". Verfügbar: list, show, create, update, delete`);
        }

        if (action === "booking-rule") {
          const sub = arg1;
          const id = arg2;
          if (sub === "list") {
            const path = opts.objectId
              ? `/object-booking-rules/object/${opts.objectId}`
              : `/object-booking-rules/club/${clubId}`;
            const rows = await client.get<RuleRead[]>("object", path);
            output(rows, opts.json, () =>
              rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                    { header: "Objekt", width: 36, get: (r) => String(r.object_id ?? "") },
                    { header: "Wochentag", width: 10, get: (r) => String(r.weekday ?? "—") },
                    { header: "Zeit", width: 13, get: (r) => `${r.start_time ?? "—"}–${r.end_time ?? "—"}` },
                  ])
                : "Keine Buchungsregeln.",
            );
            return;
          }
          if (sub === "show") {
            if (!id) throw new Error("object booking-rule show benötigt eine <rule-id>.");
            const row = await client.get<RuleRead>("object", `/object-booking-rules/${id}`);
            output(row, opts.json, () => `Buchungsregel: ${row.weekday ?? "—"} (${row.id ?? id})`);
            return;
          }
          if (sub === "create") {
            const body = { ...objectPayload(opts.file, "object booking-rule create"), club_id: clubId };
            const row = await client.post<RuleRead>("object", "/object-booking-rules/", body);
            output(row, opts.json, () => `Buchungsregel angelegt: ${row.id ?? "?"}`);
            return;
          }
          if (sub === "bulk") {
            const body = arrayPayload(opts.file, "object booking-rule bulk").map((entry) => ({
              ...entry,
              club_id: clubId,
            }));
            const rows = await client.post<RuleRead[]>("object", "/object-booking-rules/bulk", body);
            output(rows, opts.json, () => `${rows.length} Buchungsregel(n) angelegt.`);
            return;
          }
          if (sub === "update") {
            if (!id) throw new Error("object booking-rule update benötigt eine <rule-id>.");
            const body = { ...objectPayload(opts.file, "object booking-rule update"), club_id: clubId };
            const row = await client.patch<RuleRead>("object", `/object-booking-rules/${id}`, body);
            output(row, opts.json, () => `Buchungsregel aktualisiert: ${row.id ?? id}`);
            return;
          }
          if (sub === "delete") {
            if (!id) throw new Error("object booking-rule delete benötigt eine <rule-id>.");
            await client.del("object", `/object-booking-rules/${id}`);
            output({ deleted: id }, opts.json, () => `Buchungsregel entfernt: ${id}`);
            return;
          }
          throw new Error(`Unbekannte object-booking-rule-Aktion "${sub}". Verfügbar: list, show, create, bulk, update, delete`);
        }

        if (action === "task-rule") {
          const sub = arg1;
          const id = arg2;
          if (sub === "list") {
            const path = opts.objectId
              ? `/object-task-rules/object/${opts.objectId}`
              : `/object-task-rules/club/${clubId}`;
            const rows = await client.get<RuleRead[]>("object", path);
            output(rows, opts.json, () =>
              rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                    { header: "Objekt", width: 36, get: (r) => String(r.object_id ?? "") },
                    { header: "Titel", width: 28, get: (r) => String(r.title ?? "—") },
                    { header: "Priorität", width: 10, get: (r) => String(r.priority ?? "—") },
                  ])
                : "Keine Task-Regeln.",
            );
            return;
          }
          if (sub === "show") {
            if (!id) throw new Error("object task-rule show benötigt eine <rule-id>.");
            const row = await client.get<RuleRead>("object", `/object-task-rules/${id}`);
            output(row, opts.json, () => `Task-Regel: ${row.title ?? "—"} (${row.id ?? id})`);
            return;
          }
          if (sub === "create") {
            const body = { ...objectPayload(opts.file, "object task-rule create"), club_id: clubId };
            const row = await client.post<RuleRead>("object", "/object-task-rules/", body);
            output(row, opts.json, () => `Task-Regel angelegt: ${row.title ?? "—"} (${row.id ?? "?"})`);
            return;
          }
          if (sub === "update") {
            if (!id) throw new Error("object task-rule update benötigt eine <rule-id>.");
            const body = { ...objectPayload(opts.file, "object task-rule update"), id, club_id: clubId };
            const row = await client.patch<RuleRead>("object", `/object-task-rules/${id}`, body);
            output(row, opts.json, () => `Task-Regel aktualisiert: ${row.title ?? "—"} (${row.id ?? id})`);
            return;
          }
          if (sub === "delete") {
            if (!id) throw new Error("object task-rule delete benötigt eine <rule-id>.");
            await client.del("object", `/object-task-rules/${id}`);
            output({ deleted: id }, opts.json, () => `Task-Regel entfernt: ${id}`);
            return;
          }
          throw new Error(`Unbekannte object-task-rule-Aktion "${sub}". Verfügbar: list, show, create, update, delete`);
        }

        if (action === "list") {
          const rows = await client.get<ClubObjectRead[]>(
            "object",
            objectListPath(clubId, opts.type, opts.withAll),
          );
          output(rows, opts.json, () =>
            rows.length
              ? renderTable(rows, [
                  { header: "ID", width: 36, get: (o) => String(o.id ?? "") },
                  { header: "Name", width: 24, get: (o) => String(o.name ?? "—") },
                  { header: "Typ", width: 12, get: (o) => String(o.type ?? "—") },
                  { header: "Raster", width: 10, get: (o) => String(o.booking_granularity ?? "—") },
                ])
              : "Keine Objekte.",
          );
          return;
        }

        if (action === "show") {
          if (!arg1) throw new Error("object show benötigt eine <object-id>.");
          const suffix = opts.withAll ? "?withAll=true" : "";
          const row = await client.get<ClubObjectRead>("object", `/objects/${arg1}${suffix}`);
          output(row, opts.json, () => `Objekt: ${row.name ?? "—"} (${row.id ?? arg1}) · ${row.type ?? "—"}`);
          return;
        }

        if (action === "create") {
          const body = { ...objectPayload(opts.file, "object create"), club_id: clubId };
          const row = await client.post<ClubObjectRead>("object", "/objects/", body);
          output(row, opts.json, () => `Objekt angelegt: ${row.name ?? "—"} (${row.id ?? "?"})`);
          return;
        }

        if (action === "update") {
          if (!arg1) throw new Error("object update benötigt eine <object-id>.");
          const body = { ...objectPayload(opts.file, "object update"), id: arg1 };
          const row = await client.patch<ClubObjectRead>("object", `/objects/${arg1}`, body);
          output(row, opts.json, () => `Objekt aktualisiert: ${row.name ?? "—"} (${row.id ?? arg1})`);
          return;
        }

        if (action === "delete") {
          if (!arg1) throw new Error("object delete benötigt eine <object-id>.");
          await client.del("object", pathWithForce(`/objects/${arg1}`, opts.force));
          output({ deleted: arg1, force: Boolean(opts.force) }, opts.json, () => `Objekt entfernt: ${arg1}`);
          return;
        }

        throw new Error(`Unbekannte Aktion "${action}". Verfügbar: list, show, create, update, delete, building, room, booking-rule, task-rule`);
      },
    );
}
