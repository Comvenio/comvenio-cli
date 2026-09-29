import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { PublicCliError } from "../errors.ts";
import { output } from "../format.ts";
import { connector } from "./action.ts";
import { callFinance, checkClubChoice, mapClassic, runBelege, runHub, runPruefung } from "./finance-connector.ts";

// Vereins-Buchhaltung des finance-service: Jahresplan, Budgetposten, Buchungen,
// der ganze Finance Hub. Seit dem Geräte-Token-Abbau (geraetetoken-abbau-04)
// nur noch über die OAuth-Anmeldung und die Connector-Aktionen
// (finance-connector.ts); der klassische Weg über den Legacy-Client ist weg.

export type FinanceCommandOpts = {
  json?: boolean;
  club?: string;
  file?: string;
  year?: string;
  department?: string;
  sourceType?: string;
  // Direkte Felder fuer den Alltagsweg — eine Buchung soll keine JSON-Datei
  // brauchen. `--file` bleibt fuer alles Uebrige und hat Vorrang.
  name?: string;
  description?: string;
  category?: string;
  revenue?: string;
  expense?: string;
  date?: string;
  notes?: string;
  capital?: string;
  status?: string;
  // Diese fuenf Endpunkte verlangen einen Rumpf; `reason` ist dort sogar ein
  // Pflichtfeld. Ohne sie antwortet der Dienst mit 422 statt zu arbeiten.
  reason?: string;
  force?: boolean;
  // finance pruefung: set „Haushaltsjahr geprüft“ after a clean audit (16-04).
  kennzeichnen?: boolean;
  overwrite?: boolean;
  includeNonRecurring?: boolean;
  positions?: string;
  // Über die OAuth-Anmeldung (finance-connector.ts):
  account?: string;
  receiptReason?: string;
  // belegerfassung-01/-03: beleg-anhaengen, beleg-buchen.
  entry?: string;
  position?: string;
  // belegerfassung-10: beleg-event --event, beleg-event --none, beleg-buchen --event-posten.
  event?: string;
  none?: boolean;
  eventPosten?: boolean;
  input?: string;
  out?: string;
  confirm?: boolean;
  idempotencyKey?: string;
};

/**
 * Receipt uploads sent the file to the content-service with the device token
 * next to the OAuth sign-in; with the device token they are gone. Named
 * instead of falling through to "unknown action" (DC-3).
 */
export const REMOVED_FINANCE_ACTIONS = new Set(["beleg-hochladen", "entry-beleg"]);

export function removedFinanceActionError(action: string): PublicCliError {
  const sentence = `„comvenio finance ${action}“ gibt es im CLI nicht mehr.`;
  return new PublicCliError("USAGE_ERROR", sentence, {
    detail: `${sentence} Belege lädst du in der Web-App hoch; danach arbeitest du hier mit „comvenio finance beleg-liste“ und „comvenio finance beleg-buchen“ weiter.`,
  });
}

export function registerFinanceCommands(cli: CAC): void {
  cli
    .command(
      "finance <action> [id] [operation]",
      "Vereins-Buchhaltung und Investitionsplaner über die Anmeldung mit comvenio login — der ganze Finance Hub (finance run <bereich> <operation>)",
    )
    .option("--club <id>", "Nur zur Kontrolle: muss dem Verein der Anmeldung entsprechen")
    .option("--year <jahr>", "Planjahr — Pflicht bei allen plan-*, position-list/create und summary")
    .option("--file <path>", "JSON-Payload; einzelne Optionen überschreiben einzelne Felder daraus")
    .option("--name <text>", "Name einer Budgetposition")
    .option("--description <text>", "Beschreibung einer Buchung")
    .option("--category <text>", "Kategorie einer Budgetposition (Vorgabe: Allgemein)")
    .option("--department <id>", "Abteilung: filtert position-list und summary, setzt sie bei create/update")
    .option("--revenue <cent>", "Einnahme in Cent (12,50 € sind 1250)")
    .option("--expense <cent>", "Ausgabe in Cent")
    .option("--date <YYYY-MM-DD>", "Buchungsdatum")
    .option("--capital <cent>", "Verfügbares Kapital des Jahresplans in Cent")
    .option("--status <wert>", "Status beim plan-update")
    .option("--notes <text>", "Notiz bzw. Kommentar")
    .option("--source-type <typ>", "entry-list nach Herkunft filtern (manual, supply, sponsoring, …)")
    .option("--reason <text>", "Begründung — PFLICHT bei plan-reopen (mindestens 3 Zeichen); bei entry-update der Grund der Korrektur (Pflicht, solange die Buchung beanstandet ist)")
    .option("--force", "plan-close auch bei offenen Posten erzwingen")
    .option("--kennzeichnen", "finance pruefung: ein abgeschlossenes, fehlerfreies Jahr als „Haushaltsjahr geprüft“ kennzeichnen (--notes wird die Notiz)")
    .option("--overwrite", "position-import-shopping: vorhandene Schätzung überschreiben")
    .option("--include-non-recurring", "plan-copy: auch einmalige Posten übernehmen")
    .option("--positions <ids>", "plan-copy: nur diese Posten übernehmen (Komma-getrennt)")
    .option("--account <id>", "entry-create: Geldkonto der Buchung (Pflicht, sobald der Verein Geldkonten führt)")
    .option("--receipt-reason <text>", "entry-create: Begründung eines Eigenbelegs (10–500 Zeichen), wenn kein Beleg vorliegt")
    .option("--entry <id>", "beleg-anhaengen: die Buchung, an die der Beleg kommt")
    .option("--position <id>", "beleg-buchen: der Posten, auf den der Beleg gebucht wird (etwa der Posten eines Events)")
    .option("--event <id>", "beleg-event: das Event, zu dem der Beleg gehört")
    .option("--none", "beleg-event: das Event des Belegs entfernen")
    .option("--event-posten", "beleg-buchen: statt --position auf den Hauptposten des Events buchen — fehlt er, wird er im Vereinsplan des Eventjahrs angelegt")
    .option("--input <json>", "finance run: Eingabe als JSON-Objekt (ohne club_id — der Verein kommt aus der Anmeldung)")
    .option("--out <datei>", "finance run audit-export download: den Prüfexport als Datei schreiben (Prüfsumme wird geprüft); finance pruefung: Basisname für <name>.md und <name>.json")
    .option("--no-confirm", "Kritische Schritte nicht selbst bestätigen, sondern die Vorschau ausgeben")
    .option("--idempotency-key <uuid>", "finance run: fester Schlüssel eines Schreibschritts — ein Wiederholungslauf mit demselben Schlüssel und derselben Eingabe liefert 24 Stunden lang das erste Ergebnis statt einer zweiten Wirkung")
    .option("--json", "Maschinenlesbare JSON-Ausgabe")
    .example("  $ comvenio finance run money-account list")
    .example("  $ comvenio finance run cash-report create --input '{\"data\": {\"period_start\": \"2026-01-01\", \"period_end\": \"2026-01-31\", \"money_account_id\": \"…\"}}'")
    .example("  $ comvenio finance pruefung --year 2025 --out pruefung-2025")
    .example("  $ comvenio finance pruefung --year 2025 --kennzeichnen --notes \"Kassenprüfung 12.03.\"")
    .example("  $ comvenio finance belege --year 2025 --out belege-2025")
    .example("  $ comvenio finance plan-list")
    .example("  $ comvenio finance plan-create --year 2026 --capital 500000")
    .example("  $ comvenio finance position-create --year 2026 --name Sommerfest --expense 120000")
    .example("  $ comvenio finance entry-create <positions-id> --description Getränke --expense 4550 --date 2026-07-01")
    .example("  $ comvenio finance entry-approve <buchungs-id>")
    .example("  $ comvenio finance beleg-event <beleg-id> --event <event-id>")
    .example("  $ comvenio finance beleg-buchen <beleg-id> --event-posten --expense 45900 --date 2026-07-05 --account <konto-id> --description \"Getränke Sommerfest\"")
    .example("  $ comvenio finance beleg-liste")
    .example("  $ comvenio finance beleg-buchen <beleg-id> --position <posten-id> --expense 45900 --date 2026-07-01 --account <konto-id> --description \"Getränke Maifest\"")
    .action(async (action: string, id: string | undefined, operation: string | undefined, opts: FinanceCommandOpts) => {
      if (REMOVED_FINANCE_ACTIONS.has(action)) throw removedFinanceActionError(action);
      const state = await loadState();
      checkClubChoice(opts.club, state.oauth.clubId);
      const via = await connector();
      const result = action === "run"
        ? await runHub(via, id, operation, opts)
        : action === "pruefung"
        ? await runPruefung(via, opts, id)
        : action === "belege"
        ? await runBelege(via, opts, id)
        : await (async () => {
          const call = mapClassic(action, id, opts);
          return callFinance(via, call.actionId, call.input, { write: call.write, confirm: opts.confirm !== false });
        })();
      output(result, opts.json, () => JSON.stringify(result, null, 2));
    });
}
