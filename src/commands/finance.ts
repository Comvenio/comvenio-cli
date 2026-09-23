import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";
import { connector } from "./action.ts";
import { callFinance, mapClassic, runHub } from "./finance-connector.ts";

// Vereins-Buchhaltung des finance-service: Jahresplan, Budgetposten, Buchungen.
//
// WARUM ES DAS ERST JETZT GIBT: Bis zum 2026-09-20 kannte das CLI den
// finance-service ueberhaupt nicht — `booking` ist Raumbuchung
// (object-service), `sponsor` der lokale Sponsor. Der gesamte Finanzbereich
// war damit ueber den einzigen erlaubten Weg nicht bedienbar. Aufgefallen ist
// es, weil der DEV-Durchgang der Finanztests (Stufe 3) daran scheiterte.
//
// Dass niemand es vermisst hat, lag an `src/coverage/domains.json`: Dort steht
// seit der Bestandsaufnahme, Budgets und Kassenberichte lieferten HTTP 501.
// Das war vor dem Feature-Run am 2026-09-03 richtig und seither falsch — eine
// Aussage, die einmal stimmte und dann niemanden mehr nachsehen liess.
//
// BEWUSST NICHT HIER:
// - /internal/* (supply-poll, sync-sponsoring) — Dienst-zu-Dienst, kein
//   Bedienweg fuer Menschen.
// - accounting, club_invoices, donations, member_fees — dort liegen die
//   501-Platzhalter. Was es nicht gibt, bietet der Hilfetext auch nicht an.
// - Dashboard, Kassenbericht, Steuerbericht, Event-Finanzen, Supply-Bruecke,
//   Sponsoring — Welle 2 und 3, eigene Vorgaenge.

type AnyRec = Record<string, unknown>;

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
  overwrite?: boolean;
  includeNonRecurring?: boolean;
  positions?: string;
  // Über die OAuth-Anmeldung (finance-connector.ts):
  account?: string;
  receiptReason?: string;
  input?: string;
  out?: string;
  confirm?: boolean;
};

export type FinanceOperation = {
  action: string;
  id?: string;
  opts: FinanceCommandOpts;
  client: ComvenioClient;
  clubId: string;
};

function str(value: unknown, fallback = "—"): string {
  return value == null || value === "" ? fallback : String(value);
}

function pick(row: AnyRec, keys: string[], fallback = "—"): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && value !== "") return String(value);
  }
  return fallback;
}

/** Cent-Betraege sind die Waehrung dieses Dienstes — hier einmal lesbar. */
function euro(cents: unknown): string {
  if (cents == null || cents === "") return "—";
  const zahl = Number(cents);
  if (!Number.isFinite(zahl)) return String(cents);
  return (zahl / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function requiredId(id: string | undefined, action: string, kind: string): string {
  if (!id) throw new Error(`finance ${action} benötigt eine ${kind}.`);
  return id;
}

/** `reason` ist am Dienst Pflicht (min_length=3); hier vor dem Netz geprueft. */
function requiredReason(opts: FinanceCommandOpts, action: string): string {
  const grund = (opts.reason ?? "").trim();
  if (grund.length < 3) {
    throw new Error(`finance ${action} benötigt --reason <text> mit mindestens 3 Zeichen.`);
  }
  return grund;
}

/** `--positions a,b,c` in die Liste, die FinancePlanCopyRequest erwartet. */
function positionIds(roh: string, action: string): string[] {
  const ids = roh.split(",").map((teil) => teil.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error(`finance ${action}: --positions darf nicht leer sein.`);
  }
  return ids;
}

/** Das Jahr ist Pflicht, wo der Pfad es traegt — und es muss eine Zahl sein. */
function requiredYear(opts: FinanceCommandOpts, action: string): number {
  if (!opts.year) throw new Error(`finance ${action} benötigt --year <jahr>.`);
  const jahr = Number(opts.year);
  if (!Number.isInteger(jahr) || jahr < 1900 || jahr > 2200) {
    throw new Error(`finance ${action}: --year muss eine Jahreszahl zwischen 1900 und 2200 sein (war: ${opts.year}).`);
  }
  return jahr;
}

function readFile(opts: FinanceCommandOpts, action: string, optional = false): AnyRec | undefined {
  if (!opts.file) {
    if (optional) return undefined;
    throw new Error(`finance ${action} benötigt --file <payload.json> oder die passenden Optionen.`);
  }
  return readJsonFile<AnyRec>(opts.file);
}

/** Cent-Angabe aus einer Option — abgelehnt wird alles, was keine ganze Zahl ist. */
function cents(wert: string | undefined, feld: string): number | undefined {
  if (wert === undefined || wert === "") return undefined;
  const zahl = Number(wert);
  if (!Number.isInteger(zahl)) {
    throw new Error(`${feld} muss eine ganze Zahl in Cent sein (war: ${wert}). 12,50 € sind 1250.`);
  }
  return zahl;
}

/**
 * Rumpf aus Datei UND Optionen. Die Datei ist die Grundlage, einzelne
 * Optionen überschreiben sie — so lässt sich eine Vorlage wiederverwenden
 * und punktuell ändern.
 */
function bodyFrom(
  opts: FinanceCommandOpts,
  action: string,
  felder: AnyRec,
): AnyRec {
  const ausDatei = readFile(opts, action, true) ?? {};
  const gesetzt: AnyRec = {};
  for (const [schluessel, wert] of Object.entries(felder)) {
    if (wert !== undefined) gesetzt[schluessel] = wert;
  }
  const rumpf = { ...ausDatei, ...gesetzt };
  if (Object.keys(rumpf).length === 0) {
    throw new Error(`finance ${action} benötigt --file <payload.json> oder die passenden Optionen.`);
  }
  return rumpf;
}

/**
 * Eine Buchung ist entweder Einnahme oder Ausgabe, nie beides und nie keines
 * (`BookingEntryCreate.xor_amount` im finance-service). Die Prüfung steht
 * hier, damit der Mensch einen Satz liest statt eines 422 vom Dienst.
 */
function pruefeBetrag(rumpf: AnyRec, action: string): AnyRec {
  const hatEinnahme = rumpf.revenue_cents != null;
  const hatAusgabe = rumpf.expense_cents != null;
  if (hatEinnahme === hatAusgabe) {
    throw new Error(
      `finance ${action}: Genau eines von --revenue und --expense angeben — eine Buchung ist Einnahme ODER Ausgabe.`,
    );
  }
  const betrag = Number(hatEinnahme ? rumpf.revenue_cents : rumpf.expense_cents);
  if (!(betrag > 0)) {
    throw new Error(`finance ${action}: Der Betrag muss grösser als null sein (war: ${betrag} Cent).`);
  }
  return rumpf;
}

function query(params: Record<string, string | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

export async function handleFinanceOperation({
  action,
  id,
  opts,
  client,
  clubId,
}: FinanceOperation): Promise<unknown> {
  switch (action) {
    // ── Jahresplan ────────────────────────────────────────────────────────
    case "plan":
    case "plan-list":
      return client.get("finance", `/clubs/${clubId}/finance-plans`);
    case "plan-show":
      return client.get("finance", `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}`);
    case "plan-create":
      return client.post("finance", `/clubs/${clubId}/finance-plans`, bodyFrom(opts, action, {
        year: opts.year ? requiredYear(opts, action) : undefined,
        available_capital_cents: cents(opts.capital, "--capital"),
        notes: opts.notes,
      }));
    case "plan-update":
      return client.patch("finance", `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}`, bodyFrom(opts, action, {
        available_capital_cents: cents(opts.capital, "--capital"),
        notes: opts.notes,
        status: opts.status,
      }));
    case "plan-close":
      // FinancePlanCloseRequest — der Rumpf ist Pflicht, seine Felder haben
      // Vorgaben. Ohne Rumpf: 422 "Field required".
      return client.post("finance", `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}/close`, {
        force: opts.force === true,
        ...(opts.notes ? { note: opts.notes } : {}),
      });
    case "plan-reopen":
      // FinancePlanReopenRequest.reason ist Pflicht (min_length=3) — hier
      // geprueft, damit der Fehler als Satz kommt und nicht als 422.
      return client.post("finance", `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}/reopen`, {
        reason: requiredReason(opts, action),
      });
    case "plan-copy":
      // Die Quelle steht als Argument, das Ziel in --year: `finance plan-copy 2025 --year 2026`.
      return client.post(
        "finance",
        `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}/copy-from/${requiredId(id, action, "Quelljahr")}`,
        // FinancePlanCopyRequest: wiederkehrende Posten kommen von selbst mit,
        // einmalige nur auf Wunsch oder per Auswahl.
        {
          include_non_recurring: opts.includeNonRecurring === true,
          ...(opts.positions ? { position_ids: positionIds(opts.positions, action) } : {}),
        },
      );

    // ── Budgetposten ──────────────────────────────────────────────────────
    case "position-list":
      return client.get(
        "finance",
        `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}/positions${query({ department_id: opts.department })}`,
      );
    case "position-create":
      return client.post(
        "finance",
        `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}/positions`,
        bodyFrom(opts, action, {
          name: opts.name,
          category: opts.category,
          department_id: opts.department,
          revenue_planned_cents: cents(opts.revenue, "--revenue"),
          expense_planned_cents: cents(opts.expense, "--expense"),
          comment: opts.notes,
        }),
      );
    case "position-show":
      return client.get("finance", `/positions/${requiredId(id, action, "Positions-ID")}`);
    case "position-update":
      return client.patch("finance", `/positions/${requiredId(id, action, "Positions-ID")}`, bodyFrom(opts, action, {
        name: opts.name,
        category: opts.category,
        department_id: opts.department,
        revenue_planned_cents: cents(opts.revenue, "--revenue"),
        expense_planned_cents: cents(opts.expense, "--expense"),
        comment: opts.notes,
      }));
    case "position-delete":
      // Deletes the sub positions along; the answer names them in deleted_ids.
      return client.del("finance", `/positions/${requiredId(id, action, "Positions-ID")}`);
    case "position-import-shopping":
      // ImportShoppingEstimateRequest — Rumpf ist Pflicht.
      return client.post("finance", `/positions/${requiredId(id, action, "Positions-ID")}/import-shopping-estimate`, {
        overwrite: opts.overwrite === true,
      });

    // ── Zusammenfassung ───────────────────────────────────────────────────
    case "summary":
      return client.get(
        "finance",
        opts.department
          ? `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}/summary/${opts.department}`
          : `/clubs/${clubId}/finance-plans/${requiredYear(opts, action)}/summary`,
      );

    // ── Buchungen ─────────────────────────────────────────────────────────
    case "entry-list":
      return client.get(
        "finance",
        `/positions/${requiredId(id, action, "Positions-ID")}/entries${query({ source_type: opts.sourceType })}`,
      );
    case "entry-create":
      return client.post(
        "finance",
        `/positions/${requiredId(id, action, "Positions-ID")}/entries`,
        pruefeBetrag(bodyFrom(opts, action, {
          description: opts.description,
          revenue_cents: cents(opts.revenue, "--revenue"),
          expense_cents: cents(opts.expense, "--expense"),
          booking_date: opts.date,
          notes: opts.notes,
        }), action),
      );
    case "entry-show":
      return client.get("finance", `/entries/${requiredId(id, action, "Buchungs-ID")}`);
    case "entry-update":
      return client.patch("finance", `/entries/${requiredId(id, action, "Buchungs-ID")}`, bodyFrom(opts, action, {
        description: opts.description,
        revenue_cents: cents(opts.revenue, "--revenue"),
        expense_cents: cents(opts.expense, "--expense"),
        booking_date: opts.date,
        notes: opts.notes,
      }));
    case "entry-delete":
      return client.del("finance", `/entries/${requiredId(id, action, "Buchungs-ID")}`);
    case "entry-approve":
      // BookingEntryApproveRequest — Rumpf ist Pflicht, die Notiz freiwillig.
      return client.post("finance", `/entries/${requiredId(id, action, "Buchungs-ID")}/approve`, {
        ...(opts.notes ? { note: opts.notes } : {}),
      });

    default:
      throw new Error(
        `Unbekannte finance-Aktion: ${action}. Verfügbar: plan-list|plan-show|plan-create|plan-update|` +
        `plan-close|plan-reopen|plan-copy, position-list|position-create|position-show|position-update|` +
        `position-delete (löscht die Unterposten mit)|position-import-shopping, summary, ` +
        `entry-list|entry-create|entry-show|entry-update|entry-delete|entry-approve`,
      );
  }
}

export function renderHuman(action: string, result: unknown): string {
  const rows = Array.isArray(result) ? result as AnyRec[] : undefined;

  if (rows && (action === "plan" || action === "plan-list")) {
    return renderTable(rows, [
      { header: "Jahr", width: 6, get: (row) => str(row.year) },
      { header: "Status", width: 10, get: (row) => str(row.status) },
      { header: "Kapital", width: 14, get: (row) => euro(row.available_capital_cents) },
      { header: "ID", width: 36, get: (row) => str(row.id) },
    ]);
  }

  if (rows && action === "position-list") {
    return renderTable(rows, [
      { header: "Nr", width: 4, get: (row) => str(row.position_number, "0") },
      { header: "Name", width: 32, get: (row) => pick(row, ["name"]) },
      { header: "Kategorie", width: 16, get: (row) => pick(row, ["category"]) },
      { header: "Plan Ein", width: 13, get: (row) => euro(row.revenue_planned_cents) },
      { header: "Plan Aus", width: 13, get: (row) => euro(row.expense_planned_cents) },
      { header: "ID", width: 36, get: (row) => str(row.id) },
    ]);
  }

  if (rows && action === "entry-list") {
    return renderTable(rows, [
      { header: "Datum", width: 12, get: (row) => str(row.booking_date) },
      { header: "Beschreibung", width: 34, get: (row) => pick(row, ["description"]) },
      { header: "Einnahme", width: 13, get: (row) => euro(row.revenue_cents) },
      { header: "Ausgabe", width: 13, get: (row) => euro(row.expense_cents) },
      { header: "Status", width: 10, get: (row) => str(row.status) },
      { header: "ID", width: 36, get: (row) => str(row.id) },
    ]);
  }

  if (rows) {
    return renderTable(rows, [
      { header: "Bezeichnung", width: 42, get: (row) => pick(row, ["name", "description", "title"]) },
      { header: "ID", width: 36, get: (row) => str(row.id) },
    ]);
  }

  const row = result && typeof result === "object" ? result as AnyRec : undefined;

  if (row && action === "summary") {
    return [
      `Jahr ${str(row.year)} — ${str(row.status)}`,
      `Einnahmen geplant: ${euro(row.revenue_planned_cents)}   Ist: ${euro(row.revenue_actual_cents)}`,
      `Ausgaben geplant:  ${euro(row.expense_planned_cents)}   Ist: ${euro(row.expense_actual_cents)}`,
      `Positionen: ${str(row.position_count, "0")}`,
    ].join("\n");
  }

  if (row && (action === "plan-show" || action === "plan-create" || action === "plan-update")) {
    return [
      `Finanzplan ${str(row.year)} [${str(row.status)}]`,
      `Verfügbares Kapital: ${euro(row.available_capital_cents)}`,
      `Notiz: ${str(row.notes)}`,
      `ID: ${str(row.id)}`,
    ].join("\n");
  }

  if (row && action.startsWith("position-")) {
    return [
      `Position ${str(row.position_number, "0")}: ${pick(row, ["name"])} [${pick(row, ["category"])}]`,
      `Plan  Einnahmen ${euro(row.revenue_planned_cents)} | Ausgaben ${euro(row.expense_planned_cents)}`,
      `Ist   Einnahmen ${euro(row.revenue_actual_cents)} | Ausgaben ${euro(row.expense_actual_cents)}`,
      `ID: ${str(row.id)}`,
    ].join("\n");
  }

  if (row && action.startsWith("entry-")) {
    return [
      `Buchung ${str(row.booking_date)}: ${pick(row, ["description"])} [${str(row.status)}]`,
      row.revenue_cents != null ? `Einnahme: ${euro(row.revenue_cents)}` : `Ausgabe: ${euro(row.expense_cents)}`,
      `ID: ${str(row.id)}`,
    ].join("\n");
  }

  // budget-organigramm-04 DC-2: the service deletes the sub positions along
  // and names every id — say so instead of a bare "erfolgreich".
  if (row && action === "position-delete" && Array.isArray(row.deleted_ids)) {
    const ids = row.deleted_ids.map((id) => str(id));
    const unter = ids.length - 1;
    return [
      unter > 0 ? `Posten gelöscht, mit ${unter} Unterposten.` : "Posten gelöscht.",
      ...ids.map((id) => `  ${id}`),
    ].join("\n");
  }

  if (row) return `${action} erfolgreich${row.id ? `: ${row.id}` : ""}.`;
  return `${action} erfolgreich.`;
}

export function registerFinanceCommands(cli: CAC): void {
  cli
    .command(
      "finance <action> [id] [operation]",
      "Vereins-Buchhaltung und Investitionsplaner — mit der OAuth-Anmeldung der ganze Finance Hub (finance run <bereich> <operation>)",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
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
    .option("--reason <text>", "Begründung — PFLICHT bei plan-reopen (mindestens 3 Zeichen)")
    .option("--force", "plan-close auch bei offenen Posten erzwingen")
    .option("--overwrite", "position-import-shopping: vorhandene Schätzung überschreiben")
    .option("--include-non-recurring", "plan-copy: auch einmalige Posten übernehmen")
    .option("--positions <ids>", "plan-copy: nur diese Posten übernehmen (Komma-getrennt)")
    .option("--account <id>", "entry-create: Geldkonto der Buchung (Pflicht, sobald der Verein Geldkonten führt)")
    .option("--receipt-reason <text>", "entry-create: Begründung eines Eigenbelegs (10–500 Zeichen), wenn kein Beleg vorliegt")
    .option("--input <json>", "finance run: Eingabe als JSON-Objekt (ohne club_id — der Verein kommt aus der Anmeldung)")
    .option("--out <datei>", "finance run audit-export download: den Prüfexport als Datei schreiben (Prüfsumme wird geprüft)")
    .option("--no-confirm", "Kritische Schritte nicht selbst bestätigen, sondern die Vorschau ausgeben")
    .option("--json", "Maschinenlesbare JSON-Ausgabe")
    .example("  $ comvenio finance run money-account list")
    .example("  $ comvenio finance run cash-report create --input '{\"data\": {\"period_start\": \"2026-01-01\", \"period_end\": \"2026-01-31\", \"money_account_id\": \"…\"}}'")
    .example("  $ comvenio finance plan-list")
    .example("  $ comvenio finance plan-create --year 2026 --capital 500000")
    .example("  $ comvenio finance position-create --year 2026 --name Sommerfest --expense 120000")
    .example("  $ comvenio finance entry-create <positions-id> --description Getränke --expense 4550 --date 2026-07-01")
    .example("  $ comvenio finance entry-approve <buchungs-id>")
    .action(async (action: string, id: string | undefined, operation: string | undefined, opts: FinanceCommandOpts) => {
      const state = await loadState();
      // Standardweg: die OAuth-Anmeldung über den Connector. Der Geräte-Token
      // bleibt der Rückfall für eine Sitzung ohne OAuth-Verbindung.
      if (state.connectorToken) {
        const via = await connector();
        const result = action === "run"
          ? await runHub(via, id, operation, opts)
          : await (async () => {
            const call = mapClassic(action, id, opts);
            return callFinance(via, call.actionId, call.input, { write: call.write, confirm: opts.confirm !== false });
          })();
        output(result, opts.json, () => JSON.stringify(result, null, 2));
        return;
      }
      if (action === "run") {
        throw new Error("finance run läuft über die OAuth-Anmeldung: comvenio login");
      }
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);
      const result = await handleFinanceOperation({ action, id, opts, client, clubId });
      output(result, opts.json, () => renderHuman(action, result));
    });
}
