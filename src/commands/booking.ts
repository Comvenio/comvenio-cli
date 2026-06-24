import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";

// object-service reservation endpoints (verified Sub-File 06):
//   GET   /object/object-reservations/club/{club_id}      (NO status query-filter)
//   GET   /object/object-reservations/{reservation_id}
//   PATCH /object/object-reservations/{id}                (status approved|rejected;
//                                                          club_id + object_id PFLICHT)
// approve/reject are NOT dedicated endpoints — PATCH with status. No owner-bypass.

type ObjectReservationRead = {
  id?: string;
  club_id?: string;
  object_id?: string;
  status?: string;
  resp_member_id?: string | null;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
  pending?: boolean;
  status?: string;
  objectId?: string;
};

/**
 * `comvenio booking <action> [id]` dispatcher.
 *   booking list [--pending] [--status <s>]   (filter is CLIENT-side)
 *   booking show <reservation-id>
 *   booking approve|reject <reservation-id>   (GET first → club_id+object_id, then PATCH)
 */
export function registerBookingCommands(cli: CAC): void {
  cli
    .command("booking <action> [id]", "Buchungen: list|show|approve|reject")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--pending", "Nur ausstehende Anfragen (status=requested, clientseitig)")
    .option("--status <v>", "Clientseitig nach Status filtern")
    .option("--object-id <v>", "Object-ID (approve/reject, falls nicht aus show)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "list": {
          const all = await client.get<ObjectReservationRead[]>(
            "object",
            `/object-reservations/club/${clubId}`,
          );
          // No server-side status filter — filter client-side (Sub-File 06).
          let rows = all;
          if (opts.pending) rows = all.filter((r) => r.status === "requested");
          else if (opts.status) rows = all.filter((r) => r.status === opts.status);
          output(rows, opts.json, () =>
            rows.length
              ? renderTable(rows, [
                  { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                  { header: "Objekt", width: 36, get: (r) => String(r.object_id ?? "") },
                  { header: "Status", width: 12, get: (r) => String(r.status ?? "—") },
                ])
              : "Keine Reservierungen.",
          );
          break;
        }
        case "show": {
          if (!id) throw new Error("booking show benoetigt eine <reservation-id>.");
          const r = await client.get<ObjectReservationRead>(
            "object",
            `/object-reservations/${id}`,
          );
          output(r, opts.json, () =>
            [
              `ID:      ${r.id ?? id}`,
              `Objekt:  ${r.object_id ?? "—"}`,
              `Status:  ${r.status ?? "—"}`,
              `Member:  ${r.resp_member_id ?? "—"}`,
            ].join("\n"),
          );
          break;
        }
        case "approve":
        case "reject": {
          if (!id) throw new Error(`booking ${action} benoetigt eine <reservation-id>.`);
          // club_id + object_id are PFLICHT in ObjectReservationUpdate — fetch the
          // reservation first to obtain them (else 422). Sub-File 06.
          const current = await client.get<ObjectReservationRead>(
            "object",
            `/object-reservations/${id}`,
          );
          const newStatus = action === "approve" ? "approved" : "rejected";
          const objectId = opts.objectId ?? current.object_id;
          if (!current.club_id || !objectId) {
            throw new Error(
              "Reservierung hat kein club_id/object_id — kann nicht genehmigt/abgelehnt werden.",
            );
          }
          const r = await client.patch<ObjectReservationRead>(
            "object",
            `/object-reservations/${id}`,
            { club_id: current.club_id, object_id: objectId, status: newStatus },
          );
          output(r, opts.json, () => `Reservierung ${id} → ${r.status ?? newStatus}.`);
          break;
        }
        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, approve, reject`,
          );
      }
    });
}
