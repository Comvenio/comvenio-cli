// Upload a receipt through the CLI (belegerfassung-01/-03, Tom 2026-09-27).
//
// The file goes to the content-service first — the context the web app uses:
// `finance_receipt_inbox` of the club for the inbox, `finance_receipt` of the
// plan for an entry. The finance step then runs over the OAuth connector like
// every other finance command. The OAuth grant never reaches the content-
// service (03-oauth-connection-lifecycle §11), so the upload needs the device
// token next to it — and both must point at the same club, or nothing is
// uploaded.
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import type { CliConnectorClient } from "../mcp/client.ts";
import { uploadClubFile } from "../util/upload.ts";
import { callFinance } from "./finance-connector.ts";
import type { FinanceCommandOpts } from "./finance.ts";

type State = Awaited<ReturnType<typeof loadState>>;
type JsonObject = Awaited<ReturnType<typeof callFinance>>;

/** The club of the upload: the device token's, and only if the grant agrees. */
export function belegVerein(state: Pick<State, "clubId" | "oauth" | "hasDeviceToken">): string {
  if (state.hasDeviceToken !== true) {
    throw new Error(
      "Belege hochladen braucht neben der OAuth-Anmeldung einen Geräte-Token (die Datei geht an den content-service): "
      + "comvenio login --device-token <token>.",
    );
  }
  const geraet = state.clubId;
  const grant = state.oauth?.clubId;
  if (!geraet || !grant || geraet !== grant) {
    throw new Error(
      `Geräte-Token (Verein ${geraet ?? "unbekannt"}) und OAuth-Anmeldung (Verein ${grant ?? "unbekannt"}) `
      + "zeigen auf verschiedene Vereine — nichts hochgeladen.",
    );
  }
  return geraet;
}

function ergebnis(antwort: JsonObject): Record<string, unknown> {
  const wert = (antwort as { result?: unknown }).result;
  return wert !== null && typeof wert === "object" && !Array.isArray(wert) ? (wert as Record<string, unknown>) : {};
}

export async function runBelegUpload(
  via: CliConnectorClient,
  state: State,
  action: "beleg-hochladen" | "entry-beleg",
  id: string | undefined,
  operation: string | undefined,
  opts: FinanceCommandOpts,
): Promise<JsonObject> {
  const clubId = belegVerein(state);
  const client = createClient(state);
  const confirm = opts.confirm !== false;

  if (action === "beleg-hochladen") {
    if (!id) throw new Error("finance beleg-hochladen <datei>: die Datei des Belegs angeben.");
    const datei = await uploadClubFile({ client, clubId, path: id, contextType: "finance_receipt_inbox", contextId: clubId });
    // The analysis starts in the background; `beleg-show <id>` shows its proposal.
    // belegerfassung-10: --event names the event the receipt belongs to.
    const data: Record<string, string> = { file_id: datei.file_id, kind: "RECEIPT" };
    if (opts.event) data.event_id = opts.event;
    return callFinance(via, "cai.finance.25.entry_correction",
      { operation: "receipt_scan_create", data }, { write: true, confirm });
  }

  if (!id || !operation) throw new Error("finance entry-beleg <buchungs-id> <datei>: Buchung und Datei angeben.");
  // The plan comes from the position: an entry's own finance_plan_id may be empty.
  const buchung = ergebnis(await callFinance(via, "cai.finance.17.entry_show", { entry_id: id }, { write: false }));
  // The service never replaces a receipt: check first, upload after — a file
  // in finance_receipt is kept and never tidied away.
  if (buchung.receipt_file_id) throw new Error(`Buchung ${id} hat schon einen Beleg — ein Beleg wird nie ersetzt. Nichts hochgeladen.`);
  const positionId = typeof buchung.position_id === "string" ? buchung.position_id : null;
  if (!positionId) throw new Error(`Buchung ${id}: Der Posten der Buchung ist nicht bekannt — nichts hochgeladen.`);
  const posten = ergebnis(await callFinance(via, "cai.finance.10.position_show", { position_id: positionId }, { write: false }));
  const planId = typeof posten.plan_id === "string" ? posten.plan_id : null;
  if (!planId) throw new Error(`Buchung ${id}: Der Plan der Buchung ist nicht bekannt — nichts hochgeladen.`);
  const datei = await uploadClubFile({ client, clubId, path: operation, contextType: "finance_receipt", contextId: planId });
  return callFinance(via, "cai.finance.25.entry_correction",
    { operation: "receipt", entry_id: id, data: { receipt_file_id: datei.file_id } }, { write: true, confirm });
}
