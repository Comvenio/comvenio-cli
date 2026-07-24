import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readJsonFile } from "../util/file.ts";

export type ObjectReservationRead = {
  id?: string;
  club_id?: string;
  object_id?: string;
  title?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  resp_member_id?: string | null;
  [key: string]: unknown;
};
type ParticipantRead = {
  id?: string;
  member_id?: string | null;
  status?: string;
  is_guest?: boolean;
  guest_name?: string | null;
  [key: string]: unknown;
};
type ReservationLinkRead = {
  id?: string;
  primary_reservation_id?: string;
  linked_reservation_id?: string;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
  pending?: boolean;
  status?: string;
  objectId?: string;
  file?: string;
  memberId?: string;
  guest?: boolean;
  guestName?: string;
  guestEmail?: string;
  year?: string;
  month?: string;
  from?: string;
  to?: string;
};

function objectPayload(path: string | undefined, command: string, required = true): Record<string, unknown> {
  if (!path) {
    if (required) throw new Error(`${command} benötigt --file <payload.json>.`);
    return {};
  }
  const body = readJsonFile<unknown>(path);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${command}: --file muss ein JSON-Objekt enthalten.`);
  }
  return body as Record<string, unknown>;
}

function positiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} muss eine positive ganze Zahl sein.`);
  }
  return parsed;
}

export function buildReservationMutationBody(
  current: ObjectReservationRead,
  changes: Record<string, unknown> = {},
  status?: "approved" | "rejected" | "cancelled",
): Record<string, unknown> {
  if (!current.club_id || !current.object_id) {
    throw new Error("Reservierung hat kein club_id/object_id und kann nicht aktualisiert werden.");
  }
  return prune({
    ...changes,
    club_id: current.club_id,
    object_id: current.object_id,
    status: status ?? changes.status,
  });
}

function query(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function registerBookingCommands(cli: CAC): void {
  cli
    .command(
      "booking <action> [arg1] [arg2]",
      "Buchungen: list|show|create|update|approve|reject|cancel|delete|bulk | participant | link | stats",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--pending", "Nur ausstehende Anfragen (status=requested, clientseitig)")
    .option("--status <v>", "Statusfilter oder Teilnehmerstatus")
    .option("--object-id <id>", "Buchungen eines Objekts laden")
    .option("--file <path>", "JSON-Payload für komplexe Create-/Update-/Bulk-Aktionen")
    .option("--member-id <id>", "Mitglieds-ID für Teilnehmer")
    .option("--guest", "Teilnehmer als Gast anlegen")
    .option("--guest-name <v>", "Name eines Gastes ohne Mitgliedskonto")
    .option("--guest-email <v>", "E-Mail eines Gastes")
    .option("--year <yyyy>", "Statistikjahr")
    .option("--month <m>", "Statistikmonat 1–12")
    .option("--from <iso>", "Beginn des Statistikzeitraums")
    .option("--to <iso>", "Ende des Statistikzeitraums")
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

        if (action === "participant") {
          const sub = arg1;
          const id = arg2;
          if (!id) throw new Error(`booking participant ${sub ?? ""} benötigt eine ID.`);

          if (sub === "list") {
            const rows = await client.get<ParticipantRead[]>(
              "object",
              `/object-reservations/participants/reservation/${id}`,
            );
            output(rows, opts.json, () =>
              rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (p) => String(p.id ?? "") },
                    { header: "Mitglied", width: 36, get: (p) => String(p.member_id ?? p.guest_name ?? "—") },
                    { header: "Status", width: 10, get: (p) => String(p.status ?? "—") },
                    { header: "Gast", width: 5, get: (p) => (p.is_guest ? "ja" : "nein") },
                  ])
                : "Keine Teilnehmer.",
            );
            return;
          }

          if (sub === "show") {
            const row = await client.get<ParticipantRead>("object", `/object-reservations/participants/${id}`);
            output(row, opts.json, () => `Teilnehmer: ${row.member_id ?? row.guest_name ?? "—"} (${row.id ?? id})`);
            return;
          }

          if (sub === "add") {
            const file = objectPayload(opts.file, "booking participant add", false);
            const body = prune({
              ...file,
              club_id: clubId,
              object_reservation_id: id,
              member_id: opts.memberId ?? file.member_id,
              status: opts.status ?? file.status,
              is_guest: opts.guest ?? file.is_guest,
              guest_name: opts.guestName ?? file.guest_name,
              guest_email: opts.guestEmail ?? file.guest_email,
            });
            if (!body.member_id && !body.guest_name) {
              throw new Error("booking participant add benötigt --member-id, --guest-name oder entsprechende Felder in --file.");
            }
            const row = await client.post<ParticipantRead>("object", "/object-reservations/participants/", body);
            output(row, opts.json, () => `Teilnehmer hinzugefügt: ${row.member_id ?? row.guest_name ?? row.id}`);
            return;
          }

          if (sub === "add-groups") {
            const body = {
              ...objectPayload(opts.file, "booking participant add-groups"),
              club_id: clubId,
              object_reservation_id: id,
            };
            const rows = await client.post<ParticipantRead[]>(
              "object",
              "/object-reservations/participants/by-groups",
              body,
            );
            output(rows, opts.json, () => `${rows.length} Teilnehmer aus Gruppen hinzugefügt.`);
            return;
          }

          if (sub === "update") {
            const file = objectPayload(opts.file, "booking participant update", false);
            const body = prune({
              ...file,
              id,
              club_id: clubId,
              status: opts.status ?? file.status,
            });
            if (!body.status) throw new Error("booking participant update benötigt --status oder status in --file.");
            const row = await client.put<ParticipantRead>(
              "object",
              `/object-reservations/participants/${id}`,
              body,
            );
            output(row, opts.json, () => `Teilnehmer aktualisiert: ${row.id ?? id} → ${row.status ?? body.status}`);
            return;
          }

          if (sub === "remove") {
            await client.del("object", `/object-reservations/participants/${id}`);
            output({ deleted: id }, opts.json, () => `Teilnehmer entfernt: ${id}`);
            return;
          }

          throw new Error(`Unbekannte booking-participant-Aktion "${sub}". Verfügbar: list, show, add, add-groups, update, remove`);
        }

        if (action === "link") {
          const sub = arg1;
          const id = arg2;
          if (sub === "list") {
            if (!id) throw new Error("booking link list benötigt eine <reservation-id>.");
            const rows = await client.get<ReservationLinkRead[]>(
              "object",
              query(`/reservation-links/all-for-reservation/${id}`, { club_id: clubId }),
            );
            output(rows, opts.json, () =>
              rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                    { header: "Hauptbuchung", width: 36, get: (r) => String(r.primary_reservation_id ?? "") },
                    { header: "Verknüpft", width: 36, get: (r) => String(r.linked_reservation_id ?? "") },
                  ])
                : "Keine Buchungsverknüpfungen.",
            );
            return;
          }
          if (sub === "club") {
            const rows = await client.get<ReservationLinkRead[]>("object", `/reservation-links/by-club/${clubId}`);
            output(rows, opts.json, () => `${rows.length} Buchungsverknüpfung(en).`);
            return;
          }
          if (sub === "add") {
            const body = objectPayload(opts.file, "booking link add");
            const row = await client.post<ReservationLinkRead>(
              "object",
              query("/reservation-links/", { club_id: clubId }),
              body,
            );
            output(row, opts.json, () => `Buchungsverknüpfung angelegt: ${row.id ?? "?"}`);
            return;
          }
          if (sub === "remove") {
            if (!id) throw new Error("booking link remove benötigt eine <link-id>.");
            await client.del("object", query(`/reservation-links/${id}`, { club_id: clubId }));
            output({ deleted: id }, opts.json, () => `Buchungsverknüpfung entfernt: ${id}`);
            return;
          }
          throw new Error(`Unbekannte booking-link-Aktion "${sub}". Verfügbar: list, club, add, remove`);
        }

        if (action === "stats") {
          const sub = arg1;
          if (sub === "object") {
            if (!arg2) throw new Error("booking stats object benötigt eine <object-id>.");
            const month = positiveInteger(opts.month, "--month");
            if (month && month > 12) throw new Error("--month muss zwischen 1 und 12 liegen.");
            const data = await client.get<Record<string, unknown>>(
              "object",
              query(`/object-reservations/object/${arg2}/stats`, {
                year: positiveInteger(opts.year, "--year"),
                month,
              }),
            );
            output(data, opts.json, () =>
              [
                `Buchungen gesamt: ${data.total_bookings ?? "—"}`,
                `Dieses Jahr:      ${data.bookings_this_year ?? "—"}`,
                `Bester Monat:     ${data.best_month ?? "—"}`,
              ].join("\n"),
            );
            return;
          }
          if (sub === "guests") {
            const data = await client.get<Record<string, unknown>>(
              "object",
              query(`/object-reservations/statistics/guests/${clubId}`, {
                from_date: opts.from,
                to_date: opts.to,
              }),
            );
            output(data, opts.json, () =>
              `Gast-Statistik: ${data.total_guests ?? "—"} Gäste · Gebühren ${data.total_fee ?? "—"}`,
            );
            return;
          }
          throw new Error(`Unbekannte booking-stats-Aktion "${sub}". Verfügbar: object, guests`);
        }

        if (action === "list") {
          const path = opts.objectId
            ? `/object-reservations/object/${opts.objectId}`
            : `/object-reservations/club/${clubId}`;
          const all = await client.get<ObjectReservationRead[]>("object", path);
          let rows = all;
          if (opts.pending) rows = all.filter((r) => r.status === "requested");
          else if (opts.status) rows = all.filter((r) => r.status === opts.status);
          output(rows, opts.json, () =>
            rows.length
              ? renderTable(rows, [
                  { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                  { header: "Titel", width: 24, get: (r) => String(r.title ?? "—") },
                  { header: "Objekt", width: 36, get: (r) => String(r.object_id ?? "") },
                  { header: "Status", width: 12, get: (r) => String(r.status ?? "—") },
                ])
              : "Keine Reservierungen.",
          );
          return;
        }

        if (action === "show") {
          if (!arg1) throw new Error("booking show benötigt eine <reservation-id>.");
          const row = await client.get<ObjectReservationRead>("object", `/object-reservations/${arg1}`);
          output(row, opts.json, () =>
            [
              `Titel:   ${row.title ?? "—"}`,
              `ID:      ${row.id ?? arg1}`,
              `Objekt:  ${row.object_id ?? "—"}`,
              `Status:  ${row.status ?? "—"}`,
              `Mitglied:${row.resp_member_id ?? "—"}`,
            ].join("\n"),
          );
          return;
        }

        if (action === "create") {
          const body = { ...objectPayload(opts.file, "booking create"), club_id: clubId };
          const row = await client.post<ObjectReservationRead>("object", "/object-reservations/", body);
          output(row, opts.json, () => `Buchung angelegt: ${row.title ?? "—"} (${row.id ?? "?"})`);
          return;
        }

        if (action === "bulk") {
          const body = { ...objectPayload(opts.file, "booking bulk"), club_id: clubId };
          const result = await client.post<Record<string, unknown>>("object", "/object-reservations/bulk", body);
          const main = result.main_reservation as ObjectReservationRead | undefined;
          const portable = Array.isArray(result.portable_reservations) ? result.portable_reservations.length : 0;
          output(result, opts.json, () => `Sammelbuchung angelegt: ${main?.id ?? "?"} · ${portable} Zusatzbuchung(en)`);
          return;
        }

        if (action === "update" || action === "approve" || action === "reject" || action === "cancel") {
          if (!arg1) throw new Error(`booking ${action} benötigt eine <reservation-id>.`);
          const current = await client.get<ObjectReservationRead>("object", `/object-reservations/${arg1}`);
          const status = action === "approve"
            ? "approved"
            : action === "reject"
              ? "rejected"
              : action === "cancel"
                ? "cancelled"
                : undefined;
          const changes = action === "update" ? objectPayload(opts.file, "booking update") : {};
          const body = buildReservationMutationBody(current, changes, status);
          const row = await client.patch<ObjectReservationRead>("object", `/object-reservations/${arg1}`, body);
          output(row, opts.json, () => `Buchung aktualisiert: ${row.id ?? arg1} → ${row.status ?? body.status ?? "gespeichert"}`);
          return;
        }

        if (action === "delete") {
          if (!arg1) throw new Error("booking delete benötigt eine <reservation-id>.");
          await client.del("object", `/object-reservations/${arg1}`);
          output({ deleted: arg1 }, opts.json, () => `Buchung entfernt: ${arg1}`);
          return;
        }

        throw new Error(`Unbekannte Aktion "${action}". Verfügbar: list, show, create, update, approve, reject, cancel, delete, bulk, participant, link, stats`);
      },
    );
}
