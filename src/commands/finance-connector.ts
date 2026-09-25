// `comvenio finance` über die OAuth-Anmeldung (2026-09-23).
//
// Die Browser-Anmeldung ist der Standardweg des CLI. Bis hierher galt sie nur
// für `comvenio action …`; jeder finance-Befehl verlangte zusätzlich einen
// Geräte-Token. Jetzt läuft `comvenio finance` bei einer OAuth-Verbindung über
// die typisierten Connector-Aktionen (K14 und der vollständige Finance Hub,
// cai.finance.01–35) — dieselben Prüfungen wie für einen KI-Agenten: Verein und
// Abteilung aus dem Grant, Vorprüfung fremder Kennungen, Bestätigung.
//
// BESTÄTIGUNG: Kritische Schritte (Abschluss, Übernahme, Storno, Freigabe eines
// Kassenberichts, Prüfexport, Löschen) antworten zuerst mit einer Vorschau. Das
// CLI bestätigt sie selbst — der Befehl, den ein Mensch eintippt, IST seine
// Bestätigung. Die Vorschau steht mit `--json` in der Ausgabe; `--no-confirm`
// hält vor der Bestätigung an und gibt sie aus.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CliConnectorClient } from "../mcp/client.ts";
import { readJsonFile } from "../util/file.ts";
import type { FinanceCommandOpts } from "./finance.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** Die Hub-Bereiche, wie sie im CLI heißen, und ihre Aktion. */
export const FINANCE_AREAS: Record<string, string> = {
  "plan-period": "cai.finance.21.plan_period",
  "plan-lifecycle": "cai.finance.22.plan_lifecycle",
  settings: "cai.finance.23.settings",
  "money-account": "cai.finance.24.money_account",
  entry: "cai.finance.25.entry_correction",
  "cash-report": "cai.finance.26.cash_report",
  transfer: "cai.finance.27.department_transfer",
  result: "cai.finance.28.plan_result",
  "procedure-doc": "cai.finance.29.procedure_doc",
  "audit-export": "cai.finance.30.audit_export",
  views: "cai.finance.31.finance_views",
  "investment-plan": "cai.finance.32.investment_plan",
  "investment-item": "cai.finance.33.investment_item",
  "investment-funding": "cai.finance.34.investment_funding",
  "investment-scenario": "cai.finance.35.investment_scenario",
  // budget-organigramm-04: Baum, Rahmen, Abrechnung, Rubriken, Aufteilen.
  budget: "cai.finance.36.budget_organigram",
  // budget-saison-03: Saisons, Saisonbaum, Saisonrahmen, Vorschlag.
  season: "cai.finance.37.budget_season",
  // buchhaltung-13-04: Buchung im Detail und offene Punkte.
  detail: "cai.finance.38.entry_detail",
  // bereich-als-sicht-04: Zeitraum der Abteilung, Sicht, Rahmen, Abrechnung, Posten im Fenster.
  period: "cai.finance.39.budget_period",
};

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** preview_id und confirmation_token, wo immer die Antwort sie trägt (Widget). */
export function findConfirmation(value: unknown): { preview_id: string; confirmation_token: string } | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findConfirmation(entry);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  if (typeof value.preview_id === "string" && typeof value.confirmation_token === "string") {
    return { preview_id: value.preview_id, confirmation_token: value.confirmation_token };
  }
  for (const entry of Object.values(value)) {
    const found = findConfirmation(entry);
    if (found) return found;
  }
  return null;
}

export async function callFinance(
  client: CliConnectorClient,
  actionId: string,
  input: JsonObject,
  options: { write: boolean; confirm?: boolean },
): Promise<JsonObject> {
  // Lesen braucht keinen Schlüssel; Schreiben einen stabilen, damit die
  // Bestätigung dieselbe Anfrage meint.
  const key = options.write ? randomUUID() : undefined;
  const first = await client.callAction({ action_id: actionId, input: input as never, ...(key ? { idempotency_key: key } : {}) }) as JsonObject;
  const challenge = findConfirmation(first);
  // A confirmation widget without a credential must never pass as done.
  if (!challenge && first.widget === "confirmation") {
    throw new Error("Der Schritt verlangt eine Bestätigung, die Antwort trägt aber kein Bestätigungs-Token — nichts wurde ausgeführt.");
  }
  if (!challenge || !key) return first;
  if (options.confirm === false) return { confirmation_required: true, idempotency_key: key, ...first };
  return await client.confirm({ ...challenge, idempotency_key: key }) as JsonObject;
}

function cents(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const zahl = Number(value);
  if (!Number.isInteger(zahl)) throw new Error(`${field} muss eine ganze Zahl in Cent sein (war: ${value}). 12,50 € sind 1250.`);
  return zahl;
}
function year(opts: FinanceCommandOpts, action: string): number {
  const jahr = Number(opts.year);
  if (!opts.year || !Number.isInteger(jahr)) throw new Error(`finance ${action} benötigt --year <jahr>.`);
  return jahr;
}
function need(id: string | undefined, action: string, kind: string): string {
  if (!id) throw new Error(`finance ${action} benötigt eine ${kind}.`);
  return id;
}
function compact(value: Record<string, Json | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Json] => entry[1] !== undefined));
}
function fileInput(opts: FinanceCommandOpts): JsonObject {
  if (!opts.file) return {};
  const value = readJsonFile<unknown>(opts.file);
  if (!isObject(value)) throw new Error("--file muss ein JSON-Objekt enthalten.");
  return value;
}

/**
 * Die klassischen finance-Befehle auf die Connector-Aktionen. `club_id` fehlt
 * mit Absicht: Der Verein kommt aus dem OAuth-Grant, nie aus der Eingabe.
 */
export function mapClassic(action: string, id: string | undefined, opts: FinanceCommandOpts): { actionId: string; input: JsonObject; write: boolean } {
  switch (action) {
    case "plan":
    case "plan-list":
      return { actionId: "cai.finance.01.plan_list", input: { limit: 100 }, write: false };
    case "plan-show":
      return { actionId: "cai.finance.02.plan_show", input: { year: year(opts, action) }, write: false };
    case "plan-create":
      return { actionId: "cai.finance.03.plan_create", write: true, input: compact({ ...fileInput(opts), year: year(opts, action), available_capital_cents: cents(opts.capital, "--capital"), notes: opts.notes }) };
    case "plan-update":
      return { actionId: "cai.finance.04.plan_update", write: true, input: { year: year(opts, action), changes: compact({ ...fileInput(opts), available_capital_cents: cents(opts.capital, "--capital"), notes: opts.notes, status: opts.status }) } };
    case "plan-close":
      return { actionId: "cai.finance.05.plan_close", write: true, input: compact({ year: year(opts, action), force: opts.force === true, note: opts.notes }) };
    case "plan-reopen":
      throw new Error("plan-reopen verlangt eine Plattformrolle und läuft nicht über die OAuth-Anmeldung. Ein MasterAdmin öffnet mit Geräte-Token: comvenio login --device-token …");
    case "plan-copy":
      return { actionId: "cai.finance.07.plan_copy", write: true, input: compact({ year: year(opts, action), source_year: Number(need(id, action, "Quelljahr")), include_non_recurring: opts.includeNonRecurring === true, position_ids: opts.positions ? opts.positions.split(",").map((part) => part.trim()).filter(Boolean) : undefined }) };
    case "position-list":
      return { actionId: "cai.finance.08.position_list", input: compact({ year: year(opts, action), department_id: opts.department, limit: 200 }), write: false };
    case "position-create":
      return { actionId: "cai.finance.09.position_create", write: true, input: compact({ ...fileInput(opts), year: year(opts, action), name: opts.name, category: opts.category, department_id: opts.department, revenue_planned_cents: cents(opts.revenue, "--revenue"), expense_planned_cents: cents(opts.expense, "--expense"), comment: opts.notes }) };
    case "position-show":
      return { actionId: "cai.finance.10.position_show", input: { position_id: need(id, action, "Positions-ID") }, write: false };
    case "position-update":
      return { actionId: "cai.finance.11.position_update", write: true, input: { position_id: need(id, action, "Positions-ID"), changes: compact({ ...fileInput(opts), name: opts.name, category: opts.category, department_id: opts.department, revenue_planned_cents: cents(opts.revenue, "--revenue"), expense_planned_cents: cents(opts.expense, "--expense"), comment: opts.notes }) } };
    case "position-delete":
      return { actionId: "cai.finance.12.position_delete", input: { position_id: need(id, action, "Positions-ID") }, write: true };
    case "position-import-shopping":
      return { actionId: "cai.finance.13.position_import_shopping", input: { position_id: need(id, action, "Positions-ID"), overwrite: opts.overwrite === true }, write: true };
    case "summary":
      return opts.department
        ? { actionId: "cai.finance.14.summary", input: { operation: "by_department", year: year(opts, action), department_id: opts.department }, write: false }
        : { actionId: "cai.finance.14.summary", input: { operation: "total", year: year(opts, action) }, write: false };
    case "entry-list":
      return { actionId: "cai.finance.15.entry_list", input: compact({ position_id: need(id, action, "Positions-ID"), source_type: opts.sourceType, limit: 200 }), write: false };
    case "entry-create": {
      // Über den Hub, nicht über cai.finance.16: Nur dort gehen Geldkonto und
      // Eigenbeleg-Begründung mit, ohne die ein GoBD-Verein nicht bucht.
      const data = compact({
        ...fileInput(opts),
        description: opts.description,
        revenue_cents: cents(opts.revenue, "--revenue"),
        expense_cents: cents(opts.expense, "--expense"),
        booking_date: opts.date,
        notes: opts.notes,
        money_account_id: opts.account,
        receipt_exemption_reason: opts.receiptReason,
      });
      const einnahme = data.revenue_cents != null;
      if (einnahme === (data.expense_cents != null)) throw new Error("finance entry-create: Genau eines von --revenue und --expense angeben.");
      return { actionId: "cai.finance.25.entry_correction", input: { operation: "entry_create", position_id: need(id, action, "Positions-ID"), data }, write: true };
    }
    case "entry-show":
      return { actionId: "cai.finance.17.entry_show", input: { entry_id: need(id, action, "Buchungs-ID") }, write: false };
    case "entry-update":
      return { actionId: "cai.finance.18.entry_update", write: true, input: { entry_id: need(id, action, "Buchungs-ID"), changes: compact({ ...fileInput(opts), description: opts.description, revenue_cents: cents(opts.revenue, "--revenue"), expense_cents: cents(opts.expense, "--expense"), booking_date: opts.date, notes: opts.notes }) } };
    case "entry-delete":
      return { actionId: "cai.finance.19.entry_delete", input: { entry_id: need(id, action, "Buchungs-ID") }, write: true };
    case "entry-approve":
      return { actionId: "cai.finance.20.entry_approve", input: compact({ entry_id: need(id, action, "Buchungs-ID"), note: opts.notes }), write: true };
    default:
      throw new Error(`Unbekannte finance-Aktion: ${action}. Den ganzen Finance Hub erreichst du mit: comvenio finance run <bereich> <operation> --input '{…}' (Bereiche: ${Object.keys(FINANCE_AREAS).join(", ")}).`);
  }
}

/** Lesende Teiloperationen des Hubs — alles andere schreibt und bekommt einen Idempotenz-Schlüssel. */
const READ_OPERATIONS = new Set([
  "list", "show", "positions", "summary", "journal", "entries_without_receipt", "sphere_report", "dashboard", "audit_check", "receipt_file",
  "opening_versions", "cash_book", "reconciliation", "versions", "account_choices", "result",
  "open_items", "resolutions", "version", "download", "event", "event_reconciliation", "series_comparison",
  "department_history", "object", "feasibility", "funding_summary", "loan_details", "loan_show", "cashflow_list",
  // bereich-als-sicht-04
  "tree", "frame_versions", "statement", "grants", "booking_accounts",
  // buchhaltung-14-02
  "transfers", "transfer_show",
]);

// ── buchhaltung-16-03: der Prüfdurchlauf als Bericht ────────────────────

type PruefRegel = { code: string; requirement: string; severity: string; fulfilled: boolean; count: number; detail?: string | null; findings: JsonObject[] };

const REGEL_TITEL: Record<string, string> = {
  JOURNAL_GAP: "Journalnummern lückenlos",
  PERIOD_NOT_CLOSED: "Abgelaufener Zeitraum festgeschrieben",
  ENTRY_NOT_APPROVED: "Freigabe durch eine zweite Person",
  RECEIPT_MISSING: "Beleg oder Begründung je Buchung",
  SELF_ISSUED: "Eigenbelege",
  SPHERE_MISSING: "Steuerliche Sphäre je Posten",
  CASH_NEGATIVE: "Kasse nie unter null",
  RECONCILIATION_OPEN: "Abgleich mit dem Kontoauszug",
  ENTRY_WITHOUT_ACCOUNT: "Geldkonto je Buchung",
  OUT_OF_PERIOD: "Buchungsdatum im Zeitraum",
  LATE_ENTRY: "Zeitgerechte Erfassung",
  SOFT_DELETED_ENTRY: "Weich gelöschte Altbuchungen",
  PROCEDURE_DOC_MISSING: "Verfahrensdokumentation",
};

// Backslash, senkrechter Strich und Zeilenumbrüche würden eine Tabellenzeile brechen (review R1-11).
const zelle = (wert: unknown): string => (wert === null || wert === undefined ? "" : String(wert))
  .replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Alle Fundstellen eines Befunds — Buchung, Posten, Konto (review R1-7). */
function fundstelle(f: JsonObject): string {
  return [["Buchung", f.entry_id], ["Posten", f.position_id], ["Konto", f.money_account_id]]
    .filter(([, wert]) => wert)
    .map(([name, wert]) => `${name} ${zelle(wert)}`)
    .join(", ");
}

/** Der Bericht in Markdown — Kopf, eine Zeile je Regel, je Befund die Fundstellen. */
export function renderPruefbericht(ergebnis: JsonObject, jahr: number): string {
  const regeln = (ergebnis.rules ?? []) as unknown as PruefRegel[];
  const summe = (ergebnis.summary ?? {}) as JsonObject;
  const zeilen = [
    `# Prüfdurchlauf ${jahr}`,
    "",
    `- Plan: ${zelle(ergebnis.plan_id)} (${zelle(ergebnis.status)}), Zeitraum ${zelle(ergebnis.period_start)} bis ${zelle(ergebnis.period_end)}`,
    `- Buchungen im Journal: ${zelle(ergebnis.entry_count)}`,
    `- Geprüft am ${zelle(ergebnis.checked_at)} von ${zelle(ergebnis.checked_by)}`,
    `- Ergebnis: ${zelle(summe.errors)} Fehler, ${zelle(summe.notes)} Hinweise, ${zelle(summe.check_failed)} nicht prüfbar`,
    "",
    "| Regel | GoBD | Stufe | Ergebnis |",
    "|---|---|---|---|",
    ...regeln.map((r) => {
      const ergebnisText = r.severity === "CHECK_FAILED"
        ? `nicht prüfbar: ${zelle(r.detail)}`
        : r.fulfilled ? `erfüllt${r.detail ? ` (${zelle(r.detail)})` : ""}` : `${r.count} Befund(e)`;
      return `| ${REGEL_TITEL[r.code] ?? r.code} | ${r.requirement} | ${r.severity} | ${ergebnisText} |`;
    }),
  ];
  for (const r of regeln.filter((regel) => regel.findings.length > 0)) {
    zeilen.push("", `## ${REGEL_TITEL[r.code] ?? r.code} (${r.code})`, "", "| Journal | Datum | Detail | Fundstelle |", "|---|---|---|---|");
    for (const f of r.findings) zeilen.push(`| ${zelle(f.journal_number)} | ${zelle(f.date)} | ${zelle(f.detail)} | ${fundstelle(f)} |`);
  }
  return zeilen.join("\n") + "\n";
}

/**
 * `comvenio finance pruefung [plan-id] --year <jahr> [--out <basisname>]` —
 * prüft den Vereinsplan des Jahres, mit Plan-ID genau diesen Plan (auch einen
 * Abteilungsplan; buchhaltung-16-03). Mit --out entstehen <basisname>.md und
 * <basisname>.json; Exit 1 bei Fehlern oder nicht prüfbaren Regeln.
 */
/** The club plan of a year — never picked silently among several (16-03 R1-8). */
async function vereinsplanDesJahres(client: CliConnectorClient, befehl: string, opts: FinanceCommandOpts, planId?: string): Promise<string> {
  if (planId) return planId;
  const jahr = Number(opts.year);
  if (!opts.year || !Number.isInteger(jahr)) throw new Error(`finance ${befehl} benötigt --year <jahr> oder eine Plan-ID.`);
  const liste = await callFinance(client, FINANCE_AREAS["plan-period"]!, { operation: "list" }, { write: false });
  const plaene = (Array.isArray(liste.result) ? liste.result : []) as JsonObject[];
  const treffer = plaene.filter((p) => p.year === jahr && !p.department_id);
  if (treffer.length === 0) throw new Error(`Für ${jahr} gibt es keinen Vereinsplan.`);
  if (treffer.length > 1) {
    throw new Error(`Für ${jahr} gibt es ${treffer.length} Vereinspläne — Plan-ID angeben: ${treffer.map((p) => `${p.id} (${p.period_start} bis ${p.period_end})`).join(", ")}`);
  }
  return treffer[0]!.id as string;
}

export async function runPruefung(client: CliConnectorClient, opts: FinanceCommandOpts, planId?: string): Promise<JsonObject> {
  const jahr = Number(opts.year);
  const id = await vereinsplanDesJahres(client, "pruefung", opts, planId);
  const antwort = await callFinance(client, FINANCE_AREAS["plan-period"]!, { operation: "audit_check", plan_id: id }, { write: false });
  const ergebnis = (isObject(antwort.result) ? antwort.result : antwort) as JsonObject;
  const summe = (ergebnis.summary ?? {}) as JsonObject;
  if (Number(summe.errors ?? 0) > 0 || Number(summe.check_failed ?? 0) > 0) process.exitCode = 1;
  if (!opts.out) return ergebnis;
  writeFileSync(`${opts.out}.json`, JSON.stringify(ergebnis, null, 2));
  writeFileSync(`${opts.out}.md`, renderPruefbericht(ergebnis, Number(ergebnis.year ?? jahr)));
  return { written: [`${opts.out}.md`, `${opts.out}.json`], summary: summe };
}

// ── buchhaltung-16-02: Belege je Buchung ─────────────────────────────────

const ENDUNG: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp",
};

type BelegDatei = { bytes: Buffer; sha256: string; content_type: string };

/** One receipt through the connector, its checksum verified before anything is written. */
async function belegLaden(client: CliConnectorClient, entryId: string): Promise<BelegDatei> {
  const antwort = await callFinance(client, FINANCE_AREAS["entry"]!, { operation: "receipt_file", entry_id: entryId }, { write: false });
  const datei = (isObject(antwort.result) ? antwort.result : antwort) as JsonObject;
  if (typeof datei.content_base64 !== "string") throw new Error("Die Antwort trägt keine Datei.");
  const bytes = Buffer.from(datei.content_base64, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (typeof datei.sha256 === "string" && datei.sha256 !== sha256) throw new Error("Die Prüfsumme des Belegs stimmt nicht.");
  return { bytes, sha256, content_type: String(datei.content_type ?? "application/octet-stream") };
}

const csvZelle = (wert: unknown): string => {
  const text = wert === null || wert === undefined ? "" : String(wert);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * `comvenio finance belege <buchungs-id> --out <datei>` — ein Beleg;
 * `comvenio finance belege --year <jahr> [plan-id] --out <verzeichnis>` — alle
 * Belege des Vereinsplans in Journalreihenfolge, dazu belege.csv mit dem
 * Zustand jeder Buchung (buchhaltung-16-02). Vorhandene Dateien bleiben
 * unberührt; Exit 1, wenn ein Beleg nicht geladen werden konnte.
 */
export async function runBelege(client: CliConnectorClient, opts: FinanceCommandOpts, id?: string): Promise<JsonObject> {
  if (!opts.out) throw new Error("finance belege benötigt --out (eine Datei für einen Beleg, ein Verzeichnis für ein Jahr).");
  if (id && !opts.year) {
    const datei = await belegLaden(client, id);
    if (existsSync(opts.out)) throw new Error(`${opts.out} gibt es schon — nichts überschrieben.`);
    writeFileSync(opts.out, datei.bytes);
    return { written: opts.out, size_bytes: datei.bytes.byteLength, sha256: datei.sha256, content_type: datei.content_type };
  }
  const planId = await vereinsplanDesJahres(client, "belege", opts, id);
  const verzeichnis = join(opts.out, "belege.csv");
  // An earlier index is evidence too — never overwritten (review K16-02 R1-5).
  if (existsSync(verzeichnis)) throw new Error(`${verzeichnis} gibt es schon — ein neues Verzeichnis wählen; nichts überschrieben.`);
  mkdirSync(opts.out, { recursive: true });
  const zeilen: string[][] = [["journal", "datum", "buchung", "datei", "sha256", "zustand"]];
  let nach: number | undefined;
  let geladen = 0;
  let fehler = 0;
  do {
    const seite = await callFinance(client, FINANCE_AREAS["plan-period"]!, {
      operation: "journal", plan_id: planId, limit: 500, ...(nach !== undefined ? { after_journal_number: nach } : {}),
    }, { write: false });
    const inhalt = (isObject(seite.result) ? seite.result : seite) as JsonObject;
    for (const row of (Array.isArray(inhalt.rows) ? inhalt.rows : []) as JsonObject[]) {
      const basis = [String(row.journal_number ?? ""), String(row.booking_date ?? ""), String(row.entry_id ?? "")];
      if (row.deleted_before_protocol) { zeilen.push([...basis, "", "", "weich gelöscht"]); continue; }
      if (row.reversal_of_journal_number) { zeilen.push([...basis, "", "", `Storno von ${row.reversal_of_journal_number}`]); continue; }
      if (!row.has_receipt) {
        zeilen.push([...basis, "", "", row.receipt_exemption_reason ? `Eigenbeleg: ${row.receipt_exemption_reason}` : `kein Beleg (${row.receipt_state ?? "fehlt"})`]);
        continue;
      }
      try {
        const datei = await belegLaden(client, row.entry_id as string);
        const name = `${row.journal_number}_${row.booking_date}.${ENDUNG[datei.content_type] ?? "bin"}`;
        const pfad = join(opts.out, name);
        if (existsSync(pfad)) {
          // The index names the checksum of the file that is there, and says when it differs.
          const lokal = createHash("sha256").update(readFileSync(pfad)).digest("hex");
          zeilen.push([...basis, name, lokal, lokal === datei.sha256 ? "vorhanden, gleich" : `vorhanden, abweichend von der Quelle (${datei.sha256})`]);
          continue;
        }
        writeFileSync(pfad, datei.bytes);
        geladen += 1;
        zeilen.push([...basis, name, datei.sha256, "geladen"]);
      } catch (err) {
        fehler += 1;
        zeilen.push([...basis, "", "", `Fehler: ${(err as Error).message}`]);
      }
    }
    nach = typeof inhalt.next_after === "number" ? inhalt.next_after : undefined;
  } while (nach !== undefined);
  writeFileSync(verzeichnis, zeilen.map((z) => z.map(csvZelle).join(";")).join("\n") + "\n");
  if (fehler > 0) process.exitCode = 1;
  return { plan_id: planId, written: verzeichnis, entries: zeilen.length - 1, downloaded: geladen, failed: fehler };
}

/**
 * `comvenio finance run <bereich> <operation>` — jede Teiloperation des Hubs.
 * Die Eingabe kommt aus --input/--file; `operation` setzt der Befehl.
 */
export async function runHub(client: CliConnectorClient, area: string | undefined, operation: string | undefined, opts: FinanceCommandOpts): Promise<JsonObject> {
  const actionId = area ? FINANCE_AREAS[area] : undefined;
  if (!actionId || !operation) {
    throw new Error(`finance run <bereich> <operation> — Bereiche: ${Object.keys(FINANCE_AREAS).join(", ")}.`);
  }
  let input: JsonObject = fileInput(opts);
  if (opts.input) {
    const parsed: unknown = JSON.parse(opts.input);
    if (!isObject(parsed)) throw new Error("--input muss ein JSON-Objekt sein.");
    input = { ...input, ...parsed };
  }
  if ("club_id" in input) throw new Error("Der Verein kommt aus der OAuth-Anmeldung; club_id gehört nicht in die Eingabe.");
  const write = !READ_OPERATIONS.has(operation);
  const result = await callFinance(client, actionId, { ...input, operation }, { write, confirm: opts.confirm !== false });
  // Der Prüfexport kommt als base64 mit Prüfsumme — mit --out landet er als Datei.
  const inner = isObject(result.result) ? result.result : result;
  if (opts.out && typeof inner.content_base64 === "string") {
    const bytes = Buffer.from(inner.content_base64, "base64");
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (typeof inner.sha256 === "string" && inner.sha256 !== sha) throw new Error("Die Prüfsumme der geladenen Datei stimmt nicht — die Datei wurde nicht geschrieben.");
    writeFileSync(opts.out, bytes);
    return { written: opts.out, size_bytes: bytes.byteLength, sha256: sha };
  }
  return result;
}
