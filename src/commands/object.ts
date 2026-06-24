import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";

// object-service bookable-object endpoints (verified Sub-File 06):
//   GET /object/objects/club/{club_id}            (?withAll=true)
//   GET /object/objects/club/{club_id}/{static|portable|event}   (--type → SUB-PATH, not query)

type ClubObjectRead = {
  id?: string;
  name?: string;
  object_type?: string;
  [key: string]: unknown;
};

type Opts = { json?: boolean; club?: string; type?: string; withAll?: boolean };

const VALID_TYPES = new Set(["static", "portable", "event"]);

/**
 * `comvenio object <action>` dispatcher. Only `list` is in scope.
 *   object list [--type static|portable|event] [--with-all]
 */
export function registerObjectCommands(cli: CAC): void {
  cli
    .command("object <action>", "Buchbare Objekte: list")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--type <t>", "static|portable|event (Sub-Pfad, kein Query-Param)")
    .option("--with-all", "Verschachtelte Daten mitladen (?withAll=true)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "list": {
          let path = `/objects/club/${clubId}`;
          if (opts.type) {
            if (!VALID_TYPES.has(opts.type)) {
              throw new Error(
                `Ungueltiger --type "${opts.type}". Erlaubt: static, portable, event.`,
              );
            }
            // --type maps to a SUB-PATH, not a query param (Sub-File 06).
            path += `/${opts.type}`;
          }
          if (opts.withAll) path += "?withAll=true";
          const data = await client.get<ClubObjectRead[]>("object", path);
          output(data, opts.json, () =>
            data.length
              ? renderTable(data, [
                  { header: "ID", width: 36, get: (o) => String(o.id ?? "") },
                  { header: "Name", width: 24, get: (o) => String(o.name ?? "—") },
                  { header: "Typ", width: 12, get: (o) => String(o.object_type ?? "—") },
                ])
              : "Keine Objekte.",
          );
          break;
        }
        default:
          throw new Error(`Unbekannte Aktion "${action}". Verfuegbar: list`);
      }
    });
}
