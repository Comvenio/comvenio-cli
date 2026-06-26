import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";

// Sitzungen/Protokolle (meeting-service, Port 8013, gateway-key "meeting"). READ-ONLY.
// Verifiziert an meeting-service app/routes (Code = Wahrheit, via ai-docs-expert + Explore):
//   series      → GET /meetings/by_club/{club_id}         MeetingRead[]            (Meeting-Serien)
//   list        → GET /protocols/?club_id={id}            ProtocolRead[]           (die Sitzungen)
//   show <id>   → GET /protocols/{id}/view                ProtocolReadWithDetails  (agenda_items + notes + decisions)
//   entries <id>→ GET /protocol-entries/protocol/{id}     ProtocolEntryRead[]      (offizielle Reinschrift, Phase 6+)
//   resolutions → GET /resolutions/?club_id={id}          ResolutionRead[]         (formale Beschlüsse)
// Auth: cvn_-JWT mit manage_meetings ODER MeetingAccessRight.can_view. List-Endpoints
// filtern serverseitig (leer statt 403); /view + detail → 403 ohne can_view.
// VORAUSSETZUNG: meeting-service braucht die cvn_-Device-Token-Middleware (Teil A) —
// sonst 401, weil get_token_payload den cvn_-Token nicht als JWT decodieren kann.

type AnyRec = Record<string, unknown>;
type ProtocolRead = {
  id?: string;
  [key: string]: unknown;
};

function str(v: unknown, fb = "—"): string {
  return v == null || v === "" ? fb : String(v);
}
/** Erstes nicht-leeres Feld aus einer Kandidatenliste (Schema-Feldnamen defensiv). */
function pick(o: AnyRec, keys: string[], fb = "—"): string {
  for (const k of keys) {
    const v = o[k];
    if (v != null && v !== "") return String(v);
  }
  return fb;
}
function dateOnly(s: unknown): string {
  const v = str(s, "");
  return v ? v.slice(0, 10) : "—";
}

type Opts = { json?: boolean; club?: string; type?: string };

/**
 * `comvenio meeting <action> [id]` — Sitzungen/Protokolle read-only auslesen.
 * Für die inhaltliche Auswertung IMMER `--json` nutzen (volle Notizen/Beschlüsse).
 */
export function registerMeetingCommands(cli: CAC): void {
  cli
    .command(
      "meeting <action> [id]",
      "Sitzungen/Protokolle (read-only): list | show | series | entries | resolutions",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--type <t>", "Notiz-Typ-Filter (show): discussion|note|summary")
    .option("--json", "JSON-Ausgabe (maschinenlesbar) — fuer Inhalts-Auswertung")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "list": {
          const rows = await client.get<ProtocolRead[]>("meeting", `/protocols/?club_id=${clubId}`);
          output(rows, opts.json, () =>
            Array.isArray(rows) && rows.length
              ? renderTable(rows, [
                  { header: "Titel", width: 34, get: (r) => pick(r as AnyRec, ["title", "name", "subject"]) },
                  { header: "Status", width: 18, get: (r) => str((r as AnyRec).status) },
                  { header: "Datum", width: 12, get: (r) => dateOnly((r as AnyRec).meeting_date ?? (r as AnyRec).date ?? (r as AnyRec).created_at) },
                  { header: "ID", width: 36, get: (r) => str((r as AnyRec).id) },
                ])
              : "Keine Sitzungen sichtbar (kein can_view/manage_meetings — oder cvn_-Middleware fehlt → 401).",
          );
          break;
        }

        case "series": {
          const rows = await client.get<AnyRec[]>("meeting", `/meetings/by_club/${clubId}`);
          output(rows, opts.json, () =>
            Array.isArray(rows) && rows.length
              ? renderTable(rows, [
                  { header: "Serie", width: 42, get: (r) => pick(r, ["title", "name"]) },
                  { header: "ID", width: 36, get: (r) => str(r.id) },
                ])
              : "Keine Meeting-Serien sichtbar.",
          );
          break;
        }

        case "show": {
          if (!id) throw new Error("meeting show <protocol_id> benoetigt eine Protokoll-ID (siehe: comvenio meeting list).");
          const p = await client.get<AnyRec>("meeting", `/protocols/${id}/view`);
          output(p, opts.json, () => {
            const lines: string[] = [
              `Sitzung: ${pick(p, ["title", "name"])} [${str(p.status)}] (${dateOnly(p.meeting_date ?? p.date ?? p.created_at)})`,
              `ID: ${str(p.id, id)}`,
            ];
            const items = (p.agenda_items as AnyRec[] | undefined) ?? [];
            for (const [i, it] of items.entries()) {
              lines.push(`\nTOP ${i + 1}: ${pick(it, ["title", "name", "subject"])}`);
              for (const n of ((it.notes as AnyRec[] | undefined) ?? [])) {
                const t = str(n.note_type, "note");
                if (opts.type && t !== opts.type) continue;
                const text = pick(n, ["content", "text", "body"], "");
                if (text) lines.push(`  - [${t}] ${text}`);
              }
              for (const d of ((it.decisions as AnyRec[] | undefined) ?? [])) {
                lines.push(`  Beschluss: ${pick(d, ["title", "question", "label"], "")} (${str(d.decision_type ?? d.status, "")})`);
              }
            }
            if (!items.length) lines.push("(keine Tagesordnungspunkte sichtbar)");
            return lines.join("\n");
          });
          break;
        }

        case "entries": {
          if (!id) throw new Error("meeting entries <protocol_id> benoetigt eine Protokoll-ID.");
          const rows = await client.get<AnyRec[]>("meeting", `/protocol-entries/protocol/${id}`);
          output(rows, opts.json, () =>
            Array.isArray(rows) && rows.length
              ? rows
                  .map((e, i) => `${i + 1}. ${pick(e, ["title", "agenda_item_title"], "Eintrag")}\n   ${pick(e, ["content", "text", "body"], "")}`)
                  .join("\n\n")
              : "Keine Protokolleintraege (Reinschrift) vorhanden.",
          );
          break;
        }

        case "resolutions": {
          const rows = await client.get<AnyRec[]>("meeting", `/resolutions/?club_id=${clubId}`);
          output(rows, opts.json, () =>
            Array.isArray(rows) && rows.length
              ? renderTable(rows, [
                  { header: "Nr", width: 12, get: (r) => str(r.resolution_number) },
                  { header: "Titel", width: 38, get: (r) => pick(r, ["title", "name"]) },
                  { header: "Status", width: 10, get: (r) => str(r.status) },
                  { header: "ID", width: 36, get: (r) => str(r.id) },
                ])
              : "Keine Beschluesse (Resolutions).",
          );
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, series, entries, resolutions`,
          );
      }
    });
}
