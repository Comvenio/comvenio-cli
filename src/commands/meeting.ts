import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

// Club-admin workflows of meeting-service. Deliberately excluded:
// - /internal/* service-to-service maintenance
// - public/join-token flows (/meeting-access/* and protocol token routes)
// - AI suggestion/draft routes (owned by the private Meeting Assistant)

type AnyRec = Record<string, unknown>;

export type MeetingCommandOpts = {
  json?: boolean;
  club?: string;
  type?: string;
  file?: string;
  protocol?: string;
  department?: string;
  category?: string;
  includeExpired?: boolean;
  reason?: string;
  option?: string;
  count?: string;
  increment?: boolean;
  number?: string;
  since?: string;
};

export type MeetingOperation = {
  action: string;
  id?: string;
  opts: MeetingCommandOpts;
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

export function humanDateTime(value: unknown): string {
  if (value == null || value === "") return "—";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function requiredId(id: string | undefined, action: string, kind: string): string {
  if (!id) throw new Error(`meeting ${action} benötigt eine ${kind}.`);
  return id;
}

function bodyFromFile(opts: MeetingCommandOpts, action: string, optional = false): unknown {
  if (!opts.file) {
    if (optional) return undefined;
    throw new Error(`meeting ${action} benötigt --file <payload.json>.`);
  }
  return readJsonFile<unknown>(opts.file);
}

function requiredOption(opts: MeetingCommandOpts, action: string): string {
  if (!opts.option) throw new Error(`meeting ${action} benötigt --option <option-id>.`);
  return opts.option;
}

function requiredInteger(value: string | undefined, action: string, option: string): string {
  if (value == null || !Number.isInteger(Number(value))) {
    throw new Error(`meeting ${action} benötigt ${option} <ganze-zahl>.`);
  }
  return value;
}

function requiredValue(value: string | undefined, action: string, option: string): string {
  if (!value) throw new Error(`meeting ${action} benötigt ${option}.`);
  return value;
}

function query(params: Record<string, string | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

/**
 * Map one documented meeting action to the real meeting-service route.
 * Exported so route selection can be tested without network access.
 */
export async function handleMeetingOperation({
  action,
  id,
  opts,
  client,
  clubId,
}: MeetingOperation): Promise<unknown> {
  switch (action) {
    // Meeting series
    case "series":
    case "series-list":
      return client.get("meeting", `/meetings/by_club/${clubId}`);
    case "series-show":
      return client.get("meeting", `/meetings/${requiredId(id, action, "Serien-ID")}`);
    case "series-create":
      return client.post("meeting", "/meetings/", bodyFromFile(opts, action));
    case "series-update":
      return client.patch("meeting", `/meetings/${requiredId(id, action, "Serien-ID")}`, bodyFromFile(opts, action));
    case "series-delete":
      return client.del("meeting", `/meetings/${requiredId(id, action, "Serien-ID")}`);

    // Protocol CRUD and lifecycle
    case "list":
    case "protocol-list":
      return client.get("meeting", `/protocols/${query({ club_id: clubId })}`);
    case "show":
    case "protocol-show":
      return client.get("meeting", `/protocols/${requiredId(id, action, "Protokoll-ID")}/view`);
    case "protocol-create":
      return client.post("meeting", "/protocols/", bodyFromFile(opts, action));
    case "protocol-update":
      return client.patch("meeting", `/protocols/${requiredId(id, action, "Protokoll-ID")}`, bodyFromFile(opts, action));
    case "protocol-delete":
      return client.del("meeting", `/protocols/${requiredId(id, action, "Protokoll-ID")}`);
    case "protocol-advance":
      return client.post("meeting", `/protocol-management/${requiredId(id, action, "Protokoll-ID")}/advance-phase`);
    case "protocol-revert":
      return client.post("meeting", `/protocol-management/${requiredId(id, action, "Protokoll-ID")}/revert-phase`);
    case "protocol-updates":
      return client.get("meeting", `/protocol-management/${requiredId(id, action, "Protokoll-ID")}/updates${query({ since: opts.since })}`);
    case "protocol-validation":
      return client.get("meeting", `/protocol-validation/protocols/${requiredId(id, action, "Protokoll-ID")}/validation-status`);
    case "protocol-publish":
      return client.post("meeting", `/protocol-validation/protocols/${requiredId(id, action, "Protokoll-ID")}/publish`);

    // Agenda items and live status
    case "agenda-list":
      return client.get("meeting", `/agenda-items/protocol/${requiredId(id, action, "Protokoll-ID")}`);
    case "agenda-show":
      return client.get("meeting", `/agenda-items/${requiredId(id, action, "TOP-ID")}`);
    case "agenda-create":
      return client.post("meeting", `/agenda-items/protocol/${requiredId(id, action, "Protokoll-ID")}`, bodyFromFile(opts, action));
    case "agenda-update":
      return client.patch("meeting", `/agenda-items/${requiredId(id, action, "TOP-ID")}`, bodyFromFile(opts, action));
    case "agenda-delete":
      return client.del("meeting", `/agenda-items/${requiredId(id, action, "TOP-ID")}`);
    case "agenda-reorder":
      return client.post("meeting", `/agenda-management/protocol/${requiredId(id, action, "Protokoll-ID")}/reorder`, bodyFromFile(opts, action));
    case "agenda-start":
      return client.post("meeting", `/agenda-management/${requiredId(id, action, "TOP-ID")}/start${query({ protocol_id: opts.protocol })}`);
    case "agenda-complete":
      return client.post("meeting", `/agenda-management/${requiredId(id, action, "TOP-ID")}/complete${query({ protocol_id: opts.protocol })}`, bodyFromFile(opts, action, true));
    case "agenda-skip":
      return client.post("meeting", `/agenda-management/${requiredId(id, action, "TOP-ID")}/skip${query({ protocol_id: opts.protocol })}`);
    case "agenda-approve":
      return client.post("meeting", `/agenda-management/${requiredId(id, action, "TOP-ID")}/approve`, bodyFromFile(opts, action));

    // Notes
    case "note-list":
      return client.get("meeting", `/agenda-notes/agenda-item/${requiredId(id, action, "TOP-ID")}`);
    case "note-list-protocol":
      return client.get("meeting", `/agenda-notes/protocol/${requiredId(id, action, "Protokoll-ID")}`);
    case "note-create":
      return client.post("meeting", "/agenda-notes/", bodyFromFile(opts, action));
    case "note-update":
      return client.patch("meeting", `/agenda-notes/${requiredId(id, action, "Notiz-ID")}`, bodyFromFile(opts, action));
    case "note-delete":
      return client.del("meeting", `/agenda-notes/${requiredId(id, action, "Notiz-ID")}`);

    // Participants and validation
    case "participant-list":
      return client.get("meeting", `/participants/${requiredId(id, action, "Protokoll-ID")}`);
    case "participant-add":
      return client.post("meeting", `/participants/${requiredId(id, action, "Protokoll-ID")}`, bodyFromFile(opts, action));
    case "participant-update":
      return client.patch("meeting", `/participants/${requiredId(id, action, "Teilnehmer-ID")}`, bodyFromFile(opts, action));
    case "participant-remove":
      return client.del("meeting", `/participants/${requiredId(id, action, "Teilnehmer-ID")}`);
    case "participant-validate":
      return client.post("meeting", `/protocol-validation/participants/${requiredId(id, action, "Teilnehmer-ID")}/validate`, bodyFromFile(opts, action, true));
    case "participant-unvalidate":
      return client.del("meeting", `/protocol-validation/participants/${requiredId(id, action, "Teilnehmer-ID")}/validate`);

    // Decisions and voting. Decision details are available through agenda-show.
    case "decision-create":
      return client.post("meeting", `/decisions/agenda-item/${requiredId(id, action, "TOP-ID")}`, bodyFromFile(opts, action));
    case "decision-agenda":
      return client.get("meeting", `/decisions/${requiredId(id, action, "Entscheidungs-ID")}/agenda-item`);
    case "decision-update":
      return client.patch("meeting", `/decisions/${requiredId(id, action, "Entscheidungs-ID")}`, bodyFromFile(opts, action));
    case "decision-cancel":
      return client.post("meeting", `/decisions/${requiredId(id, action, "Entscheidungs-ID")}/cancel${query({ cancel_reason: opts.reason })}`);
    case "decision-option-add":
      return client.post("meeting", `/decisions/${requiredId(id, action, "Entscheidungs-ID")}/options`, bodyFromFile(opts, action));
    case "decision-options-add":
      return client.post("meeting", `/decisions/${requiredId(id, action, "Entscheidungs-ID")}/options/batch`, bodyFromFile(opts, action));
    case "decision-promote":
      return client.post("meeting", `/decisions/${requiredId(id, action, "Entscheidungs-ID")}/promote-to-resolution${query({
        resolution_number: requiredValue(opts.number, action, "--number <beschlussnummer>"),
      })}`);
    case "voting-open":
      return client.post("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/open`);
    case "voting-close":
      return client.post("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/close`);
    case "voting-results":
      return client.get("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/results`);
    case "voting-eligible":
      return client.get("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/eligible-voters`);
    case "vote-cast":
      return client.post("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/cast`, bodyFromFile(opts, action));
    case "vote-cast-bulk":
      return client.post("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/cast/bulk`, bodyFromFile(opts, action));
    case "vote-proxy":
      return client.post("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/proxy`, bodyFromFile(opts, action));
    case "vote-proxy-bulk":
      return client.post("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/proxy/bulk`, bodyFromFile(opts, action));
    case "voting-tally":
      return client.post("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/offline-tally/${requiredOption(opts, action)}${query({
        count: requiredInteger(opts.count, action, "--count"),
        increment: opts.increment ? true : undefined,
      })}`);
    case "vote-option-retract":
      return client.del("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}/option/${requiredOption(opts, action)}`);
    case "vote-retract":
      return client.del("meeting", `/votes/${requiredId(id, action, "Entscheidungs-ID")}`);

    // Resolutions
    case "resolutions":
    case "resolution-list":
      return client.get("meeting", `/resolutions/${query({
        club_id: clubId,
        department_id: opts.department,
        category: opts.category,
        valid_only: opts.includeExpired ? false : undefined,
      })}`);
    case "resolution-list-protocol":
      return client.get("meeting", `/resolutions/protocol/${requiredId(id, action, "Protokoll-ID")}`);
    case "resolution-show":
      return client.get("meeting", `/resolutions/${requiredId(id, action, "Beschluss-ID")}`);
    case "resolution-history":
      return client.get("meeting", `/resolutions/${requiredId(id, action, "Beschluss-ID")}/history`);
    case "resolution-create":
      return client.post("meeting", "/resolutions/", bodyFromFile(opts, action));
    case "resolution-update":
      return client.patch("meeting", `/resolutions/${requiredId(id, action, "Beschluss-ID")}`, bodyFromFile(opts, action));
    case "resolution-approve":
      return client.post("meeting", `/resolutions/${requiredId(id, action, "Beschluss-ID")}/approve`, bodyFromFile(opts, action));
    case "resolution-decline":
      return client.post("meeting", `/resolutions/${requiredId(id, action, "Beschluss-ID")}/decline`, bodyFromFile(opts, action));
    case "resolution-delete":
      return client.del("meeting", `/resolutions/${requiredId(id, action, "Beschluss-ID")}`);

    // Official protocol entries and attachment links
    case "entries":
    case "entry-list":
      return client.get("meeting", `/protocol-entries/protocol/${requiredId(id, action, "Protokoll-ID")}`);
    case "entry-show":
      return client.get("meeting", `/protocol-entries/${requiredId(id, action, "Eintrags-ID")}`);
    case "entry-show-agenda":
      return client.get("meeting", `/protocol-entries/agenda-item/${requiredId(id, action, "TOP-ID")}`);
    case "entry-create":
      return client.post("meeting", `/protocol-entries/${requiredId(id, action, "TOP-ID")}`, bodyFromFile(opts, action));
    case "entry-update":
      return client.put("meeting", `/protocol-entries/${requiredId(id, action, "Eintrags-ID")}`, bodyFromFile(opts, action));
    case "entry-delete":
      return client.del("meeting", `/protocol-entries/${requiredId(id, action, "Eintrags-ID")}`);
    case "attachment-list":
      return client.get("meeting", `/protocol-entries/${requiredId(id, action, "Eintrags-ID")}/attachments`);
    case "attachment-add":
      return client.post("meeting", `/protocol-entries/${requiredId(id, action, "Eintrags-ID")}/attachments`, bodyFromFile(opts, action));
    case "attachment-remove":
      return client.del("meeting", `/protocol-entries/attachments/${requiredId(id, action, "Anhang-ID")}`);

    default:
      throw new Error(`Unbekannte Meeting-Aktion "${action}". Siehe: comvenio meeting --help oder docs/meetings.md.`);
  }
}

function renderHuman(action: string, result: unknown): string {
  const rows = Array.isArray(result) ? result as AnyRec[] : undefined;
  if (rows) {
    if (!rows.length) return "Keine Einträge gefunden.";
    if (action === "series" || action === "series-list") {
      return renderTable(rows, [
        { header: "Serie", width: 38, get: (row) => pick(row, ["title", "name"]) },
        { header: "Typ", width: 18, get: (row) => str(row.meeting_type) },
        { header: "ID", width: 36, get: (row) => str(row.id) },
      ]);
    }
    if (action === "list" || action === "protocol-list") {
      return renderTable(rows, [
        { header: "Titel", width: 34, get: (row) => pick(row, ["title", "name"]) },
        { header: "Phase", width: 22, get: (row) => str(row.status) },
        // A protocol has no meeting_date. started_at is the actual meeting start.
        { header: "Beginn", width: 18, get: (row) => humanDateTime(row.started_at) },
        { header: "ID", width: 36, get: (row) => str(row.id) },
      ]);
    }
    if (action === "resolutions" || action === "resolution-list" || action === "resolution-list-protocol") {
      return renderTable(rows, [
        { header: "Nr", width: 12, get: (row) => str(row.resolution_number) },
        { header: "Titel", width: 36, get: (row) => pick(row, ["title", "name"]) },
        { header: "Status", width: 10, get: (row) => str(row.status) },
        { header: "ID", width: 36, get: (row) => str(row.id) },
      ]);
    }
    if (action === "entries" || action === "entry-list") {
      return rows.map((entry, index) => `${index + 1}. ${pick(entry, ["title"], "Protokolleintrag")} (${str(entry.id)})\n   ${pick(entry, ["content"], "")}`).join("\n\n");
    }
    return renderTable(rows, [
      { header: "Titel/Name", width: 42, get: (row) => pick(row, ["title", "name", "content", "role"]) },
      { header: "Status/Typ", width: 18, get: (row) => pick(row, ["status", "note_type", "voting_status", "role"]) },
      { header: "ID", width: 36, get: (row) => str(row.id) },
    ]);
  }

  const row = result && typeof result === "object" ? result as AnyRec : undefined;
  if ((action === "show" || action === "protocol-show") && row) {
    const lines = [
      `Sitzung: ${pick(row, ["title", "name"])} [${str(row.status)}]`,
      `Beginn: ${humanDateTime(row.started_at)}`,
      `Ende: ${humanDateTime(row.ended_at)}`,
      `ID: ${str(row.id)}`,
    ];
    const items = Array.isArray(row.agenda_items) ? row.agenda_items as AnyRec[] : [];
    for (const [index, item] of items.entries()) {
      lines.push(`\nTOP ${index + 1}: ${pick(item, ["title", "name", "subject"])}`);
    }
    return lines.join("\n");
  }

  if (row) {
    return `${action} erfolgreich${row.id ? `: ${row.id}` : ""}.`;
  }
  return `${action} erfolgreich.`;
}

export function registerMeetingCommands(cli: CAC): void {
  cli
    .command(
      "meeting <action> [id]",
      "Meeting Hub: Serien, Protokolle, TOPs, Teilnehmer, Abstimmungen, Beschlüsse und Reinschrift",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--file <path>", "JSON-Payload für create/update/workflow-Aktionen")
    .option("--protocol <id>", "Ziel-Protokoll bei Carry-over-TOP-Statusaktionen")
    .option("--department <id>", "Beschlussliste nach Abteilung filtern")
    .option("--category <name>", "Beschlussliste nach Kategorie filtern")
    .option("--include-expired", "Beschlussliste einschließlich abgelaufener Beschlüsse")
    .option("--reason <text>", "Begründung für decision-cancel")
    .option("--number <value>", "Beschlussnummer für decision-promote")
    .option("--option <id>", "Abstimmungsoption für voting-tally/vote-option-retract")
    .option("--count <n>", "Stimmenzahl für voting-tally")
    .option("--increment", "voting-tally: --count als Delta statt absoluten Wert anwenden")
    .option("--since <iso-datetime>", "protocol-updates: nur Änderungen seit diesem Zeitpunkt")
    .option("--type <type>", "Reserviert für kompatible Inhaltsfilter")
    .option("--json", "Maschinenlesbare JSON-Ausgabe")
    .action(async (action: string, id: string | undefined, opts: MeetingCommandOpts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);
      const result = await handleMeetingOperation({ action, id, opts, client, clubId });
      output(result, opts.json, () => renderHuman(action, result));
    });
}
