// comvenio teams — saisonale Mannschaftsverwaltung (Saisonale Mannschaften K9).
//
// Namespace contract (Lastenheft 09-club-agent-cli-mcp §1.1/§1.3/§5b/§6):
// - Full capability set: teams, seasons, roster, competitions, iCal
//   subscriptions and sync operations over the same RBAC-guarded backend
//   routes the web app uses (member-service + event-service).
// - Every read/write supports --json (machine-readable stdout, errors on
//   stderr).
// - Namespace-specific exit codes: 0 success, 2 validation, 3 permission,
//   4 conflict, 5 transport/service.
// - §5b: every mutation names its concrete target id (team_season_id for
//   season-scoped writes) — never an aggregate scope.
// - §6: important mutations print a full parameter summary and require
//   confirmation; --yes executes, without --yes NO backend write is sent
//   (non-interactive confirm pattern, same as `role permissions apply`).
import type { CAC } from "cac";
import { AuthError, loadState } from "../auth.ts";
import { createClient, HttpError, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readJsonFile } from "../util/file.ts";

// ── Read shapes (mirror of the backend Read schemas) ───────────────────

type SeasonTeamRead = {
  id?: string;
  name?: string;
  department_id?: string;
  sport_type?: string;
  category_name_snapshot?: string | null;
  age_group?: string | null;
  gender?: string;
  archived_at?: string | null;
  [key: string]: unknown;
};

type TeamSeasonRead = {
  id?: string;
  team_id?: string;
  name?: string;
  starts_on?: string | null;
  ends_on?: string | null;
  status?: string;
  default_visibility?: string;
  [key: string]: unknown;
};

type TeamSeasonMemberRead = {
  id?: string;
  team_season_id?: string;
  member_id?: string;
  role?: string;
  status?: string;
  jersey_number?: number | null;
  position?: string | null;
  is_primary_team?: boolean;
  [key: string]: unknown;
};

type RosterPreviewEntry = {
  member_id?: string;
  role?: string;
  status?: string;
  jersey_number?: number | null;
  position?: string | null;
  already_in_target?: boolean;
  [key: string]: unknown;
};

type CompetitionRead = {
  id?: string;
  team_season_id?: string;
  name?: string;
  type?: string;
  association?: string | null;
  external_label?: string | null;
  is_primary?: boolean;
  visibility?: string;
  [key: string]: unknown;
};

type CalendarSyncRunRead = {
  id?: string;
  subscription_id?: string;
  trigger?: string;
  status?: string;
  created?: number;
  updated?: number;
  cancelled?: number;
  unchanged?: number;
  failed?: number;
  clarifications?: number;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  [key: string]: unknown;
};

type CalendarSubscriptionRead = {
  id?: string;
  team_season_id?: string;
  masked_url?: string;
  status?: string;
  last_success_at?: string | null;
  last_error?: string | null;
  next_sync_at?: string | null;
  latest_run?: CalendarSyncRunRead | null;
  [key: string]: unknown;
};

type ActivationPreviewRead = {
  token?: string;
  expires_at?: string;
  entries?: Array<{
    external_id?: string;
    starts_at?: string | null;
    title?: string | null;
    mapping?: string | null;
    [key: string]: unknown;
  }>;
  warnings?: string[];
  [key: string]: unknown;
};

type SyncClarificationRead = {
  id?: string;
  team_season_id?: string;
  type?: string;
  status?: string;
  title?: string;
  reason?: string;
  [key: string]: unknown;
};

export type TeamsCommandOpts = {
  json?: boolean;
  club?: string;
  yes?: boolean;
  file?: string;
  // team fields
  name?: string;
  departmentId?: string;
  includeDescendants?: boolean;
  sportType?: string;
  categoryId?: string;
  ageGroup?: string;
  gender?: string;
  description?: string;
  homeLocation?: string;
  // season fields
  team?: string;
  startsOn?: string;
  endsOn?: string;
  visibility?: string;
  reason?: string;
  // roster fields
  memberId?: string;
  role?: string;
  status?: string;
  jerseyNumber?: string;
  position?: string;
  primary?: boolean;
  source?: string;
  members?: string;
  preview?: boolean;
  // competition fields
  type?: string;
  association?: string;
  externalLabel?: string;
  // ical / sync fields
  url?: string;
  previewToken?: string;
  limit?: string;
  offset?: string;
};

// ── Exit-code contract (§1.3) ──────────────────────────────────────────

/** Local input/validation problem inside the teams namespace → exit 2. */
class TeamsInputError extends Error {}

const TRANSPORT_ERROR_PATTERN =
  /fetch|network|connect|abort|timeout|socket|dns|tls|econn|unreachable/iu;

/** Map an error to the teams exit-code contract: 2/3/4/5 (§1.3). */
export function teamsExitCode(err: unknown): number {
  if (err instanceof TeamsInputError) return 2;
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return 3;
    if (err.status === 409) return 4;
    if (err.status >= 500 || err.status === 429) return 5;
    // 400/404/422: the request named an invalid payload or an unknown target
    return 2;
  }
  const candidate = err as { name?: string; message?: string };
  const text = `${candidate?.name ?? ""} ${candidate?.message ?? ""}`;
  if (TRANSPORT_ERROR_PATTERN.test(text)) return 5;
  // Everything our own code throws before the request is an input problem.
  return 2;
}

// ── Confirmation contract (§6, TC-02) ──────────────────────────────────

/**
 * Print the full parameter summary for an important mutation. Without --yes
 * no backend write is sent (returns false); the caller re-runs with --yes.
 * With --yes the summary still goes to stderr so the write stays auditable
 * while stdout keeps the clean --json contract.
 */
function confirmMutation(
  opts: TeamsCommandOpts,
  action: string,
  parameters: Record<string, unknown>,
): boolean {
  const summary = { action, parameters };
  if (!opts.yes) {
    output(
      { confirmation_required: true, ...summary },
      opts.json,
      () =>
        [
          `Bestätigung erforderlich für: ${action}`,
          "Parameter:",
          JSON.stringify(parameters, null, 2),
          "",
          "Kein Write ausgeführt. Nach Prüfung denselben Befehl mit --yes erneut aufrufen.",
        ].join("\n"),
    );
    return false;
  }
  process.stderr.write(
    `Bestätigt (--yes): ${action}\n${JSON.stringify(parameters, null, 2)}\n`,
  );
  return true;
}

// ── Small helpers ──────────────────────────────────────────────────────

function requireId(value: string | undefined, usage: string): string {
  if (!value) throw new TeamsInputError(usage);
  return value;
}

function integer(value: string | undefined, flag: string): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new TeamsInputError(`${flag} muss eine ganze Zahl sein.`);
  }
  return parsed;
}

function filePayload(
  path: string | undefined,
  command: string,
  required = false,
): Record<string, unknown> {
  if (!path) {
    if (required) throw new TeamsInputError(`${command} benötigt --file <payload.json>.`);
    return {};
  }
  let body: unknown;
  try {
    body = readJsonFile<unknown>(path);
  } catch (err) {
    throw new TeamsInputError((err as Error).message);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TeamsInputError(`${command}: --file muss ein JSON-Objekt enthalten.`);
  }
  return body as Record<string, unknown>;
}

/** Mask a sensitive iCal URL for summaries/logs (AK-N-02): keep host only. */
export function maskIcalUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}/…(maskiert)`;
  } catch {
    return "…(maskiert)";
  }
}

const fmt = (value: unknown): string =>
  value === null || value === undefined || value === "" ? "—" : String(value);

// ── Registration ───────────────────────────────────────────────────────

const ACTION_OVERVIEW =
  "Saisonale Mannschaften: list | show | create | update | archive | " +
  "season list|show|create|update|activate|complete | " +
  "roster show|add|update|remove|carry-over | " +
  "competition list|create|update|delete | " +
  "ical list|create|preview|activate|deactivate | " +
  "sync now|runs|clarifications|resolve";

export function registerTeamsCommands(cli: CAC): void {
  cli
    .command("teams <action> [arg1] [arg2]", ACTION_OVERVIEW)
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .option("--yes", "Bestätigt eine wichtige Mutation (sonst nur Parameterzusammenfassung)")
    .option("--file <path>", "JSON-Payload für komplexe Create-/Update-Aktionen")
    .option("--name <text>", "Name (Team, Saison oder Wettbewerb)")
    .option("--department-id <id>", "Abteilungs-ID (Team-Create bzw. list-Filter)")
    .option("--include-descendants", "list --department-id: Unterabteilungen einschließen")
    .option("--sport-type <t>", "FOOTBALL|TENNIS|HANDBALL|BASKETBALL|VOLLEYBALL|TABLE_TENNIS|OTHER")
    .option("--category-id <id>", "Kategorie-ID der Abteilung")
    .option("--age-group <text>", "Altersgruppe (z.B. Herren, D-Jugend)")
    .option("--gender <g>", "MALE|FEMALE|MIXED")
    .option("--description <text>", "Beschreibung")
    .option("--home-location <text>", "Heimspielstätte")
    .option("--team <id>", "Team-ID (für season show)")
    .option("--starts-on <date>", "Saisonbeginn (YYYY-MM-DD)")
    .option("--ends-on <date>", "Saisonende (YYYY-MM-DD)")
    .option("--visibility <v>", "PUBLIC|MEMBERS")
    .option("--reason <text>", "Korrekturgrund (season update, min. 5 Zeichen)")
    .option("--member-id <id>", "Mitglieds-ID (roster add)")
    .option("--role <r>", "PLAYER|CAPTAIN|COACH|ASSISTANT_COACH|MANAGER")
    .option("--status <s>", "Kaderstatus ACTIVE|INACTIVE|LEFT")
    .option("--jersey-number <n>", "Trikotnummer")
    .option("--position <p>", "Position")
    .option("--primary", "Als Stammteam markieren (roster add/update)")
    .option("--source <season-id>", "Quell-Saison (roster carry-over)")
    .option("--members <ids>", "Kommagetrennte Mitglieds-IDs (roster carry-over)")
    .option("--preview", "roster carry-over: nur Vorschau, kein Write")
    .option("--type <t>", "Wettbewerbstyp LEAGUE|CUP|FRIENDLY|TOURNAMENT|OTHER")
    .option("--association <text>", "Verband (Wettbewerb)")
    .option("--external-label <text>", "Externes Label (Wettbewerb)")
    .option("--url <url>", "iCal-Abonnement-URL (ical create)")
    .option("--preview-token <t>", "Vorschau-Token aus ical preview (ical activate)")
    .option("--limit <n>", "sync runs: Seitengröße")
    .option("--offset <n>", "sync runs: Offset")
    .action(
      async (
        action: string,
        arg1: string | undefined,
        arg2: string | undefined,
        opts: TeamsCommandOpts,
      ) => {
        try {
          await runTeamsAction(action, arg1, arg2, opts);
        } catch (err) {
          // AuthError bubbles to main() (exit 2 there, same as everywhere).
          if (err instanceof AuthError) throw err;
          console.error(`\nFehler: ${(err as Error).message}\n`);
          process.exit(teamsExitCode(err));
        }
      },
    );
}

async function runTeamsAction(
  action: string,
  arg1: string | undefined,
  arg2: string | undefined,
  opts: TeamsCommandOpts,
): Promise<void> {
  const state = await loadState();
  const client = createClient(state);
  const clubId = requireClubId(state, opts.club);

  switch (action) {
    case "list":
      return teamsList(client, clubId, opts);
    case "show":
      return teamsShow(client, requireId(arg1, "teams show benötigt eine <team-id>."), opts);
    case "create":
      return teamsCreate(client, clubId, opts);
    case "update":
      return teamsUpdate(client, requireId(arg1, "teams update benötigt eine <team-id>."), opts);
    case "archive":
      return teamsArchive(client, requireId(arg1, "teams archive benötigt eine <team-id>."), opts);
    case "season":
      return seasonAction(client, arg1, arg2, opts);
    case "roster":
      return rosterAction(client, arg1, arg2, opts);
    case "competition":
      return competitionAction(client, arg1, arg2, opts);
    case "ical":
      return icalAction(client, arg1, arg2, opts);
    case "sync":
      return syncAction(client, arg1, arg2, opts);
    default:
      throw new TeamsInputError(
        `Unbekannte Aktion "${action}". Verfügbar: list, show, create, update, archive, ` +
        "season list|show|create|update|activate|complete, " +
        "roster show|add|update|remove|carry-over, " +
        "competition list|create|update|delete, " +
        "ical list|create|preview|activate|deactivate, " +
        "sync now|runs|clarifications|resolve",
      );
  }
}

// ── teams (Stammdaten, member-service) ─────────────────────────────────

async function teamsList(client: ComvenioClient, clubId: string, opts: TeamsCommandOpts): Promise<void> {
  const path = opts.departmentId
    ? `/teams/by-department/${opts.departmentId}${opts.includeDescendants ? "?include_descendants=true" : ""}`
    : `/teams/by-club/${clubId}`;
  const teams = await client.get<SeasonTeamRead[]>("member", path);
  output(teams, opts.json, () =>
    teams.length
      ? renderTable(teams, [
          { header: "ID", width: 36, get: (t) => fmt(t.id) },
          { header: "Name", width: 26, get: (t) => fmt(t.name) },
          { header: "Sport", width: 12, get: (t) => fmt(t.sport_type) },
          { header: "Kategorie", width: 14, get: (t) => fmt(t.category_name_snapshot) },
          { header: "Archiviert", width: 10, get: (t) => (t.archived_at ? "ja" : "nein") },
        ])
      : "Keine Mannschaften.",
  );
}

async function teamsShow(client: ComvenioClient, teamId: string, opts: TeamsCommandOpts): Promise<void> {
  const team = await client.get<SeasonTeamRead>("member", `/teams/${teamId}`);
  output(team, opts.json, () =>
    [
      `Mannschaft: ${fmt(team.name)}`,
      `ID:         ${fmt(team.id ?? teamId)}`,
      `Abteilung:  ${fmt(team.department_id)}`,
      `Sport:      ${fmt(team.sport_type)}`,
      `Kategorie:  ${fmt(team.category_name_snapshot)}`,
      `Altersgr.:  ${fmt(team.age_group)}`,
      `Archiviert: ${team.archived_at ? String(team.archived_at) : "nein"}`,
    ].join("\n"),
  );
}

function teamBody(opts: TeamsCommandOpts, fromFile: Record<string, unknown>): Record<string, unknown> {
  return prune({
    ...fromFile,
    name: opts.name ?? fromFile.name,
    department_id: opts.departmentId ?? fromFile.department_id,
    sport_type: opts.sportType ?? fromFile.sport_type,
    category_id: opts.categoryId ?? fromFile.category_id,
    age_group: opts.ageGroup ?? fromFile.age_group,
    gender: opts.gender ?? fromFile.gender,
    description: opts.description ?? fromFile.description,
    home_location: opts.homeLocation ?? fromFile.home_location,
  });
}

async function teamsCreate(client: ComvenioClient, clubId: string, opts: TeamsCommandOpts): Promise<void> {
  const body: Record<string, unknown> = {
    ...teamBody(opts, filePayload(opts.file, "teams create")),
    club_id: clubId,
  };
  if (!body.name || !body.department_id || !body.sport_type) {
    throw new TeamsInputError(
      "teams create benötigt --name, --department-id und --sport-type (oder die Felder in --file).",
    );
  }
  if (!confirmMutation(opts, "Mannschaft anlegen", body)) return;
  const team = await client.post<SeasonTeamRead>("member", "/teams/", body);
  output(team, opts.json, () => `Mannschaft angelegt: ${fmt(team.name)} (${fmt(team.id)})`);
}

async function teamsUpdate(client: ComvenioClient, teamId: string, opts: TeamsCommandOpts): Promise<void> {
  const body = teamBody(opts, filePayload(opts.file, "teams update"));
  if (!Object.keys(body).length) {
    throw new TeamsInputError("teams update benötigt mindestens ein Änderungsfeld.");
  }
  if (!confirmMutation(opts, "Mannschaft ändern", { team_id: teamId, ...body })) return;
  const team = await client.patch<SeasonTeamRead>("member", `/teams/${teamId}`, body);
  output(team, opts.json, () => `Mannschaft aktualisiert: ${fmt(team.name)} (${fmt(team.id ?? teamId)})`);
}

async function teamsArchive(client: ComvenioClient, teamId: string, opts: TeamsCommandOpts): Promise<void> {
  // Archiving is the sanctioned end state for teams with history — hard
  // delete is rejected by the backend (409 TEAM_HAS_HISTORY_USE_ARCHIVE).
  const body = { archived_at: new Date().toISOString() };
  if (!confirmMutation(opts, "Mannschaft archivieren", { team_id: teamId, ...body })) return;
  const team = await client.patch<SeasonTeamRead>("member", `/teams/${teamId}`, body);
  output(team, opts.json, () =>
    `Mannschaft archiviert: ${fmt(team.name)} (${fmt(team.id ?? teamId)}) — Historie bleibt lesbar.`,
  );
}

// ── season (Lifecycle, member-service) ─────────────────────────────────

async function seasonAction(
  client: ComvenioClient,
  sub: string | undefined,
  id: string | undefined,
  opts: TeamsCommandOpts,
): Promise<void> {
  switch (sub) {
    case "list": {
      const teamId = requireId(id, "teams season list benötigt eine <team-id>.");
      const seasons = await client.get<TeamSeasonRead[]>("member", `/teams/${teamId}/seasons`);
      output(seasons, opts.json, () => renderSeasonTable(seasons));
      return;
    }
    case "show": {
      const seasonId = requireId(id, "teams season show benötigt eine <season-id>.");
      if (!opts.team) {
        // There is no single-season read route; the season list of the owning
        // team is the canonical read path (§5b: caller names the exact scope).
        throw new TeamsInputError("teams season show benötigt zusätzlich --team <team-id>.");
      }
      const seasons = await client.get<TeamSeasonRead[]>("member", `/teams/${opts.team}/seasons`);
      const season = seasons.find((entry) => entry.id === seasonId);
      if (!season) {
        throw new TeamsInputError(`Saison ${seasonId} wurde im Team ${opts.team} nicht gefunden.`);
      }
      output(season, opts.json, () =>
        [
          `Saison:       ${fmt(season.name)}`,
          `ID:           ${fmt(season.id)}`,
          `Team:         ${fmt(season.team_id)}`,
          `Status:       ${fmt(season.status)}`,
          `Zeitraum:     ${fmt(season.starts_on)} – ${fmt(season.ends_on)}`,
          `Sichtbarkeit: ${fmt(season.default_visibility)}`,
        ].join("\n"),
      );
      return;
    }
    case "create": {
      const teamId = requireId(id, "teams season create benötigt eine <team-id>.");
      const body = prune({
        ...filePayload(opts.file, "teams season create"),
        name: opts.name,
        starts_on: opts.startsOn,
        ends_on: opts.endsOn,
        default_visibility: opts.visibility,
      });
      if (!body.name) {
        throw new TeamsInputError("teams season create benötigt --name (oder name in --file).");
      }
      if (!confirmMutation(opts, "Saison anlegen", { team_id: teamId, ...body })) return;
      const season = await client.post<TeamSeasonRead>("member", `/teams/${teamId}/seasons`, body);
      output(season, opts.json, () => `Saison angelegt: ${fmt(season.name)} (${fmt(season.id)}) — Status ${fmt(season.status)}`);
      return;
    }
    case "update": {
      // Seasons have no free PATCH: the backend only offers the audited
      // historical correction (reason + patch), so `update` maps onto it.
      const seasonId = requireId(id, "teams season update benötigt eine <season-id>.");
      if (!opts.reason || opts.reason.trim().length < 5) {
        throw new TeamsInputError("teams season update benötigt --reason mit mindestens 5 Zeichen.");
      }
      const patch = prune({
        ...filePayload(opts.file, "teams season update"),
        name: opts.name,
        starts_on: opts.startsOn,
        ends_on: opts.endsOn,
        default_visibility: opts.visibility,
      });
      if (!Object.keys(patch).length) {
        throw new TeamsInputError("teams season update benötigt mindestens ein Änderungsfeld.");
      }
      const body = { reason: opts.reason, patch };
      if (!confirmMutation(opts, "Saison korrigieren (auditiert)", { team_season_id: seasonId, ...body })) return;
      const season = await client.post<TeamSeasonRead>(
        "member",
        `/team-seasons/${seasonId}/historical-corrections`,
        body,
      );
      output(season, opts.json, () => `Saison korrigiert: ${fmt(season.name)} (${fmt(season.id ?? seasonId)})`);
      return;
    }
    case "activate":
    case "complete": {
      const seasonId = requireId(id, `teams season ${sub} benötigt eine <season-id>.`);
      const label = sub === "activate" ? "Saison aktivieren" : "Saison abschließen";
      if (!confirmMutation(opts, label, { team_season_id: seasonId, transition: sub })) return;
      const season = await client.post<TeamSeasonRead>(
        "member",
        `/team-seasons/${seasonId}/transitions/${sub}`,
      );
      output(season, opts.json, () =>
        `${label} erfolgreich: ${fmt(season.name)} (${fmt(season.id ?? seasonId)}) — Status ${fmt(season.status)}`,
      );
      return;
    }
    default:
      throw new TeamsInputError(
        `Unbekannte season-Aktion "${sub ?? ""}". Verfügbar: list, show, create, update, activate, complete`,
      );
  }
}

function renderSeasonTable(seasons: TeamSeasonRead[]): string {
  return seasons.length
    ? renderTable(seasons, [
        { header: "ID", width: 36, get: (s) => fmt(s.id) },
        { header: "Name", width: 20, get: (s) => fmt(s.name) },
        { header: "Status", width: 14, get: (s) => fmt(s.status) },
        { header: "Beginn", width: 10, get: (s) => fmt(s.starts_on) },
        { header: "Ende", width: 10, get: (s) => fmt(s.ends_on) },
      ])
    : "Keine Saisons.";
}

// ── roster (Kader, member-service) ─────────────────────────────────────

async function rosterAction(
  client: ComvenioClient,
  sub: string | undefined,
  id: string | undefined,
  opts: TeamsCommandOpts,
): Promise<void> {
  switch (sub) {
    case "show": {
      const seasonId = requireId(id, "teams roster show benötigt eine <season-id>.");
      const entries = await client.get<TeamSeasonMemberRead[]>(
        "member",
        `/team-seasons/${seasonId}/members`,
      );
      output(entries, opts.json, () =>
        entries.length
          ? renderTable(entries, [
              { header: "Kader-ID", width: 36, get: (e) => fmt(e.id) },
              { header: "Member-ID", width: 36, get: (e) => fmt(e.member_id) },
              { header: "Rolle", width: 15, get: (e) => fmt(e.role) },
              { header: "Status", width: 8, get: (e) => fmt(e.status) },
              { header: "Nr.", width: 4, get: (e) => fmt(e.jersey_number) },
            ])
          : "Kader ist leer.",
      );
      return;
    }
    case "add": {
      const seasonId = requireId(id, "teams roster add benötigt eine <season-id>.");
      const body = prune({
        ...filePayload(opts.file, "teams roster add"),
        member_id: opts.memberId,
        role: opts.role,
        status: opts.status,
        jersey_number: integer(opts.jerseyNumber, "--jersey-number"),
        position: opts.position,
        is_primary_team: opts.primary ? true : undefined,
      });
      if (!body.member_id) {
        throw new TeamsInputError("teams roster add benötigt --member-id (oder member_id in --file).");
      }
      if (!confirmMutation(opts, "Kadermitglied aufnehmen", { team_season_id: seasonId, ...body })) return;
      const entry = await client.post<TeamSeasonMemberRead>(
        "member",
        `/team-seasons/${seasonId}/members`,
        body,
      );
      output(entry, opts.json, () =>
        `Kadermitglied aufgenommen: ${fmt(entry.member_id)} als ${fmt(entry.role)} (Kader-ID ${fmt(entry.id)})`,
      );
      return;
    }
    case "update": {
      const rosterId = requireId(id, "teams roster update benötigt eine <roster-id>.");
      const body = prune({
        ...filePayload(opts.file, "teams roster update"),
        role: opts.role,
        status: opts.status,
        jersey_number: integer(opts.jerseyNumber, "--jersey-number"),
        position: opts.position,
        is_primary_team: opts.primary ? true : undefined,
      });
      if (!Object.keys(body).length) {
        throw new TeamsInputError("teams roster update benötigt mindestens ein Änderungsfeld.");
      }
      if (!confirmMutation(opts, "Kadereintrag ändern", { roster_id: rosterId, ...body })) return;
      const entry = await client.patch<TeamSeasonMemberRead>(
        "member",
        `/team-season-members/${rosterId}`,
        body,
      );
      output(entry, opts.json, () => `Kadereintrag aktualisiert: ${fmt(entry.member_id)} (${fmt(entry.id ?? rosterId)})`);
      return;
    }
    case "remove": {
      const rosterId = requireId(id, "teams roster remove benötigt eine <roster-id>.");
      if (!confirmMutation(opts, "Kadermitglied austragen", { roster_id: rosterId })) return;
      await client.del("member", `/team-season-members/${rosterId}`);
      output({ removed: true, roster_id: rosterId }, opts.json, () =>
        `Kadermitglied ausgetragen (Kader-ID ${rosterId}) — Historie bleibt erhalten.`,
      );
      return;
    }
    case "carry-over": {
      const seasonId = requireId(id, "teams roster carry-over benötigt eine <ziel-season-id>.");
      if (!opts.source) {
        throw new TeamsInputError("teams roster carry-over benötigt --source <quell-season-id>.");
      }
      // The preview is the shared basis: it feeds --preview mode AND the full
      // parameter summary of the actual carry-over (selective take-over).
      const preview = await client.post<RosterPreviewEntry[]>(
        "member",
        `/team-seasons/${seasonId}/roster-preview`,
        { source_season_id: opts.source },
      );
      if (opts.preview) {
        output(preview, opts.json, () =>
          preview.length
            ? renderTable(preview, [
                { header: "Member-ID", width: 36, get: (e) => fmt(e.member_id) },
                { header: "Rolle", width: 15, get: (e) => fmt(e.role) },
                { header: "Status", width: 8, get: (e) => fmt(e.status) },
                { header: "Bereits im Ziel", width: 15, get: (e) => (e.already_in_target ? "ja" : "nein") },
              ])
            : "Quell-Saison hat keinen übernehmbaren Kader.",
        );
        return;
      }
      const requested = opts.members
        ? opts.members.split(",").map((entry) => entry.trim()).filter(Boolean)
        : preview.filter((entry) => !entry.already_in_target).map((entry) => String(entry.member_id));
      if (!requested.length) {
        throw new TeamsInputError(
          "Keine übernehmbaren Mitglieder (alle bereits im Ziel oder leere --members-Liste).",
        );
      }
      const body = { source_season_id: opts.source, member_ids: requested };
      if (!confirmMutation(opts, "Kader selektiv übernehmen", { team_season_id: seasonId, ...body })) return;
      const created = await client.post<TeamSeasonMemberRead[]>(
        "member",
        `/team-seasons/${seasonId}/roster-carry-over`,
        body,
      );
      output(created, opts.json, () =>
        `${created.length} Kadermitglied(er) in Saison ${seasonId} übernommen.`,
      );
      return;
    }
    default:
      throw new TeamsInputError(
        `Unbekannte roster-Aktion "${sub ?? ""}". Verfügbar: show, add, update, remove, carry-over`,
      );
  }
}

// ── competition (Wettbewerbe, member-service) ──────────────────────────

function competitionBody(opts: TeamsCommandOpts, fromFile: Record<string, unknown>): Record<string, unknown> {
  return prune({
    ...fromFile,
    name: opts.name ?? fromFile.name,
    type: opts.type ?? fromFile.type,
    association: opts.association ?? fromFile.association,
    external_label: opts.externalLabel ?? fromFile.external_label,
    is_primary: opts.primary ? true : (fromFile.is_primary as boolean | undefined),
    visibility: opts.visibility ?? fromFile.visibility,
  });
}

async function competitionAction(
  client: ComvenioClient,
  sub: string | undefined,
  id: string | undefined,
  opts: TeamsCommandOpts,
): Promise<void> {
  switch (sub) {
    case "list": {
      const seasonId = requireId(id, "teams competition list benötigt eine <season-id>.");
      const rows = await client.get<CompetitionRead[]>(
        "member",
        `/team-seasons/${seasonId}/competitions`,
      );
      output(rows, opts.json, () =>
        rows.length
          ? renderTable(rows, [
              { header: "ID", width: 36, get: (c) => fmt(c.id) },
              { header: "Name", width: 24, get: (c) => fmt(c.name) },
              { header: "Typ", width: 11, get: (c) => fmt(c.type) },
              { header: "Primär", width: 6, get: (c) => (c.is_primary ? "ja" : "nein") },
              { header: "Sichtbar", width: 8, get: (c) => fmt(c.visibility) },
            ])
          : "Keine Wettbewerbe.",
      );
      return;
    }
    case "create": {
      const seasonId = requireId(id, "teams competition create benötigt eine <season-id>.");
      const body = competitionBody(opts, filePayload(opts.file, "teams competition create"));
      if (!body.name) {
        throw new TeamsInputError("teams competition create benötigt --name (oder name in --file).");
      }
      if (!confirmMutation(opts, "Wettbewerb anlegen", { team_season_id: seasonId, ...body })) return;
      const competition = await client.post<CompetitionRead>(
        "member",
        `/team-seasons/${seasonId}/competitions`,
        body,
      );
      output(competition, opts.json, () =>
        `Wettbewerb angelegt: ${fmt(competition.name)} (${fmt(competition.id)})`,
      );
      return;
    }
    case "update": {
      const competitionId = requireId(id, "teams competition update benötigt eine <competition-id>.");
      const body = competitionBody(opts, filePayload(opts.file, "teams competition update"));
      if (!Object.keys(body).length) {
        throw new TeamsInputError("teams competition update benötigt mindestens ein Änderungsfeld.");
      }
      if (!confirmMutation(opts, "Wettbewerb ändern", { competition_id: competitionId, ...body })) return;
      const competition = await client.patch<CompetitionRead>(
        "member",
        `/team-season-competitions/${competitionId}`,
        body,
      );
      output(competition, opts.json, () =>
        `Wettbewerb aktualisiert: ${fmt(competition.name)} (${fmt(competition.id ?? competitionId)})`,
      );
      return;
    }
    case "delete": {
      const competitionId = requireId(id, "teams competition delete benötigt eine <competition-id>.");
      if (!confirmMutation(opts, "Wettbewerb entfernen", { competition_id: competitionId })) return;
      await client.del("member", `/team-season-competitions/${competitionId}`);
      output({ deleted: true, competition_id: competitionId }, opts.json, () =>
        `Wettbewerb entfernt: ${competitionId}`,
      );
      return;
    }
    default:
      throw new TeamsInputError(
        `Unbekannte competition-Aktion "${sub ?? ""}". Verfügbar: list, create, update, delete`,
      );
  }
}

// ── ical (Kalender-Abonnements, event-service) ─────────────────────────

async function icalAction(
  client: ComvenioClient,
  sub: string | undefined,
  id: string | undefined,
  opts: TeamsCommandOpts,
): Promise<void> {
  switch (sub) {
    case "list": {
      const seasonId = requireId(id, "teams ical list benötigt eine <season-id>.");
      const rows = await client.get<CalendarSubscriptionRead[]>(
        "event",
        `/team-seasons/${seasonId}/calendar-subscriptions`,
      );
      output(rows, opts.json, () =>
        rows.length
          ? renderTable(rows, [
              { header: "ID", width: 36, get: (s) => fmt(s.id) },
              { header: "Quelle (maskiert)", width: 30, get: (s) => fmt(s.masked_url) },
              { header: "Status", width: 10, get: (s) => fmt(s.status) },
              { header: "Nächster Sync", width: 20, get: (s) => fmt(s.next_sync_at) },
            ])
          : "Keine Kalender-Abonnements.",
      );
      return;
    }
    case "create": {
      const seasonId = requireId(id, "teams ical create benötigt eine <season-id>.");
      const url = opts.url ?? (filePayload(opts.file, "teams ical create").url as string | undefined);
      if (!url) throw new TeamsInputError("teams ical create benötigt --url <ical-url>.");
      // AK-N-02: the sensitive iCal URL never appears in summaries or output —
      // the backend returns masked_url, the summary shows the masked form.
      if (!confirmMutation(opts, "iCal-Quelle speichern (inaktiv)", {
        team_season_id: seasonId,
        url: maskIcalUrl(url),
      })) return;
      const subscription = await client.post<CalendarSubscriptionRead>(
        "event",
        `/team-seasons/${seasonId}/calendar-subscriptions`,
        { url },
      );
      output(subscription, opts.json, () =>
        `iCal-Quelle gespeichert: ${fmt(subscription.masked_url)} (${fmt(subscription.id)}) — Status ${fmt(subscription.status)}. ` +
        "Nächster Schritt: teams ical preview <subscription-id>",
      );
      return;
    }
    case "preview": {
      const subscriptionId = requireId(id, "teams ical preview benötigt eine <subscription-id>.");
      const preview = await client.post<ActivationPreviewRead>(
        "event",
        `/calendar-subscriptions/${subscriptionId}/preview`,
      );
      output(preview, opts.json, () =>
        [
          `Vorschau-Token: ${fmt(preview.token)} (gültig bis ${fmt(preview.expires_at)})`,
          `${preview.entries?.length ?? 0} Einträge, ${preview.warnings?.length ?? 0} Hinweise.`,
          ...(preview.warnings ?? []).map((warning) => `  Hinweis: ${warning}`),
          "Aktivieren: teams ical activate <subscription-id> --preview-token <token> --yes",
        ].join("\n"),
      );
      return;
    }
    case "activate": {
      const subscriptionId = requireId(id, "teams ical activate benötigt eine <subscription-id>.");
      if (!opts.previewToken) {
        throw new TeamsInputError(
          "teams ical activate benötigt --preview-token aus einer aktuellen Vorschau (TC-03: Parameteränderung verwirft die Bestätigung).",
        );
      }
      const mappings = (filePayload(opts.file, "teams ical activate").mappings ?? {}) as Record<string, string>;
      const body = { preview_token: opts.previewToken, mappings };
      if (!confirmMutation(opts, "iCal-Abonnement aktivieren", { subscription_id: subscriptionId, ...body })) return;
      const subscription = await client.post<CalendarSubscriptionRead>(
        "event",
        `/calendar-subscriptions/${subscriptionId}/activate`,
        body,
      );
      output(subscription, opts.json, () =>
        `Abonnement aktiviert: ${fmt(subscription.masked_url)} — Status ${fmt(subscription.status)}, nächster Sync ${fmt(subscription.next_sync_at)}`,
      );
      return;
    }
    case "deactivate": {
      const subscriptionId = requireId(id, "teams ical deactivate benötigt eine <subscription-id>.");
      if (!confirmMutation(opts, "iCal-Abonnement deaktivieren", { subscription_id: subscriptionId })) return;
      const subscription = await client.post<CalendarSubscriptionRead>(
        "event",
        `/calendar-subscriptions/${subscriptionId}/deactivate`,
      );
      output(subscription, opts.json, () =>
        `Abonnement deaktiviert: ${fmt(subscription.masked_url)} — Status ${fmt(subscription.status)}. Bestehende Termine bleiben erhalten.`,
      );
      return;
    }
    default:
      throw new TeamsInputError(
        `Unbekannte ical-Aktion "${sub ?? ""}". Verfügbar: list, create, preview, activate, deactivate`,
      );
  }
}

// ── sync (Betrieb & Klärungsfälle, event-service) ──────────────────────

async function syncAction(
  client: ComvenioClient,
  sub: string | undefined,
  id: string | undefined,
  opts: TeamsCommandOpts,
): Promise<void> {
  switch (sub) {
    case "now": {
      const subscriptionId = requireId(id, "teams sync now benötigt eine <subscription-id>.");
      if (!confirmMutation(opts, "Sofort-Synchronisation starten", { subscription_id: subscriptionId })) return;
      const run = await client.post<CalendarSyncRunRead>(
        "event",
        `/calendar-subscriptions/${subscriptionId}/sync`,
      );
      output(run, opts.json, () =>
        `Sync gestartet: Run ${fmt(run.id)} (${fmt(run.status)}) — Verlauf: teams sync runs ${subscriptionId}`,
      );
      return;
    }
    case "runs": {
      const subscriptionId = requireId(id, "teams sync runs benötigt eine <subscription-id>.");
      const limit = integer(opts.limit, "--limit") ?? 20;
      const offset = integer(opts.offset, "--offset") ?? 0;
      const runs = await client.get<CalendarSyncRunRead[]>(
        "event",
        `/calendar-subscriptions/${subscriptionId}/runs?limit=${limit}&offset=${offset}`,
      );
      output(runs, opts.json, () =>
        runs.length
          ? renderTable(runs, [
              { header: "Run-ID", width: 36, get: (r) => fmt(r.id) },
              { header: "Auslöser", width: 9, get: (r) => fmt(r.trigger) },
              { header: "Status", width: 9, get: (r) => fmt(r.status) },
              { header: "Neu", width: 4, get: (r) => fmt(r.created) },
              { header: "Geänd.", width: 6, get: (r) => fmt(r.updated) },
              { header: "Klärf.", width: 6, get: (r) => fmt(r.clarifications) },
              { header: "Beendet", width: 20, get: (r) => fmt(r.finished_at) },
            ])
          : "Keine Sync-Läufe.",
      );
      return;
    }
    case "clarifications": {
      const seasonId = requireId(id, "teams sync clarifications benötigt eine <season-id>.");
      const rows = await client.get<SyncClarificationRead[]>(
        "event",
        `/team-seasons/${seasonId}/sync-clarifications`,
      );
      output(rows, opts.json, () =>
        rows.length
          ? renderTable(rows, [
              { header: "ID", width: 36, get: (c) => fmt(c.id) },
              { header: "Typ", width: 20, get: (c) => fmt(c.type) },
              { header: "Status", width: 9, get: (c) => fmt(c.status) },
              { header: "Titel", width: 30, get: (c) => fmt(c.title) },
            ])
          : "Keine offenen Klärungsfälle.",
      );
      return;
    }
    case "resolve": {
      const clarificationId = requireId(id, "teams sync resolve benötigt eine <clarification-id>.");
      const resolution = filePayload(opts.file, "teams sync resolve", true);
      if (!resolution.type || !resolution.action) {
        throw new TeamsInputError(
          'teams sync resolve: --file muss ein Auflösungsobjekt mit "type" und "action" enthalten ' +
          "(z.B. {\"type\":\"AMBIGUOUS_HOME_ROLE\",\"action\":\"CONFIRM_HOME\",\"trigger_resource_reconcile\":true}).",
        );
      }
      if (!confirmMutation(opts, "Klärungsfall auflösen", { clarification_id: clarificationId, ...resolution })) return;
      const result = await client.post<{ clarification?: SyncClarificationRead; resource_reconcile_triggered?: boolean }>(
        "event",
        `/sync-clarifications/${clarificationId}/resolve`,
        resolution,
      );
      output(result, opts.json, () =>
        `Klärungsfall aufgelöst: ${fmt(result.clarification?.id ?? clarificationId)} — Status ${fmt(result.clarification?.status)}` +
        (result.resource_reconcile_triggered ? " (Ressourcen-Abgleich angestoßen)" : ""),
      );
      return;
    }
    default:
      throw new TeamsInputError(
        `Unbekannte sync-Aktion "${sub ?? ""}". Verfügbar: now, runs, clarifications, resolve`,
      );
  }
}
