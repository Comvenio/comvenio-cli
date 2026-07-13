import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSetsNotation } from "../util/sets.ts";

// gateway key "tournament" -> tournament-service. V3 engine: a match pairs
// PARTICIPANTS via sides (Einzelspieler / Doppel / Mannschaft), never a team.
// Only verified endpoint paths are used here (no guessing — gotcha rts.md).

type Opts = {
  json?: boolean;
  club?: string;
  name?: string;
  kind?: string;
  seed?: string;
  status?: string;
  event?: string;
  clearEvent?: boolean;
  open?: boolean;
  // draw / schedule (EXTEND 2026-07-02)
  file?: string;
  start?: string;
  end?: string;
  location?: string;
  matchMinutes?: string;
  breakMinutes?: string;
  fieldCount?: string;
  firstKickoff?: string;
  matchNumber?: string;
  dryRun?: boolean;
  autoBook?: boolean;
  // K5 (2026-07-08): withdrawal / re-draw / reset
  participant?: string;
  phase?: string;
  // match-result (2026-07-08): Tore setzen
  home?: string;
  away?: string;
  // K18 (2026-07-13): Tennis-Saetze + Sonderwertungen + Deadline
  sets?: string;
  walkover?: boolean;
  retired?: boolean;
  noShow?: boolean;
  noContest?: boolean;
  winner?: string;
  mode?: string;
  at?: string;
  policy?: string;
  show?: boolean;
};

type Tournament = {
  id?: string;
  title?: string;
  status?: string;
  tournament_mode?: string;
  team_size?: number | null;
  sport_key?: string;
  [k: string]: unknown;
};
type TournamentSeries = {
  id?: string;
  title?: string;
  sport_key?: string;
  template_key?: string;
  format_family?: string;
  public_slug?: string | null;
  is_active?: boolean;
  executions?: Tournament[];
};

type Participant = {
  id?: string;
  name?: string;
  participant_kind?: string;
  registration_status?: string;
  seed?: number | null;
  participant_metadata?: Record<string, unknown> | null;
};
type MatchSide = { side_index?: number; participant_id?: string; score?: number | null; is_winner?: boolean };
type Match = {
  id?: string;
  match_number?: number | null;
  round?: number | null;
  group?: string | null;
  status?: string;
  deadline_at?: string | null;
  sides?: MatchSide[];
  [k: string]: unknown;
};
type DrawSession = {
  id?: string;
  status?: string;
  strategy?: string;
  outcome?: { groups?: Array<{ label?: string; key?: string; participants?: unknown[] }>; materialization?: { matches_created?: number } } & Record<string, unknown>;
};
type ScheduleGenerateResult = {
  generated_count?: number;
  skipped_fixed_count?: number;
  assignments?: unknown[];
  warnings?: string[];
};
type StandingRow = {
  rank?: number;
  name?: string;
  played?: number;
  wins?: number;
  losses?: number;
  draws?: number;
  points?: number;
  goals_for?: number;
  goals_against?: number;
};
type Standings = { rows?: StandingRow[] };

const KIND_NOUN: Record<string, string> = {
  individual: "Einzelspieler",
  pair: "Doppel",
  team: "Mannschaft",
  group: "Gruppe",
};

async function openInBrowser(target: string): Promise<boolean> {
  try {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "start", "", target]
        : process.platform === "darwin"
          ? ["open", target]
          : ["xdg-open", target];
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return true;
  } catch {
    return false;
  }
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function sideNames(match: Match, byId: Map<string, string>): string {
  const sides = [...(match.sides ?? [])].sort((a, b) => (a.side_index ?? 0) - (b.side_index ?? 0));
  if (sides.length === 0) return "—";
  return sides
    .map((s) => {
      const name = byId.get(String(s.participant_id)) ?? "?";
      return `${name}${s.score != null ? ` (${s.score})` : ""}`;
    })
    .join(" vs ");
}

function buildPreviewHtml(t: Tournament, parts: Participant[], matches: Match[], standings: Standings): string {
  const byId = new Map<string, string>(parts.map((p) => [String(p.id), String(p.name ?? "?")]));
  const standingsRows = (standings.rows ?? [])
    .map(
      (r) =>
        `<tr><td>${r.rank ?? ""}</td><td>${esc(r.name)}</td><td>${r.played ?? 0}</td><td>${r.wins ?? 0}</td><td>${r.draws ?? 0}</td><td>${r.losses ?? 0}</td><td>${r.goals_for ?? 0}:${r.goals_against ?? 0}</td><td><b>${r.points ?? 0}</b></td></tr>`,
    )
    .join("");
  const matchRows = matches
    .map((m) => `<li>${m.group ? `[${esc(m.group)}] ` : ""}${esc(sideNames(m, byId))} <span class="st">${esc(m.status)}</span></li>`)
    .join("");
  const partRows = parts
    .map(
      (p) =>
        `<li>${esc(p.name)} <span class="k">${KIND_NOUN[String(p.participant_kind)] ?? esc(p.participant_kind)}</span> <span class="st">${esc(p.registration_status)}</span></li>`,
    )
    .join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(t.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;color:#1a2233}
h1{margin-bottom:.2rem}.meta{color:#667;margin-bottom:1.5rem}table{border-collapse:collapse;width:100%;margin:.5rem 0 2rem}
th,td{border:1px solid #dde;padding:.4rem .6rem;text-align:left}th{background:#f4f6fb}.st{color:#88a;font-size:.85em}
.k{color:#3a6;font-size:.85em}ul{line-height:1.7}h2{margin-top:1.5rem;border-bottom:2px solid #eef;padding-bottom:.2rem}</style></head>
<body><h1>${esc(t.title)}</h1>
<div class="meta">Sportart: ${esc(t.sport_key ?? "—")} &middot; Modus: ${esc(t.tournament_mode ?? "—")} &middot; Status: ${esc(t.status ?? "—")} &middot; ${parts.length} Teilnehmer &middot; ${matches.length} Spiele</div>
<h2>Tabelle</h2><table><thead><tr><th>#</th><th>Teilnehmer</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>Pkt</th></tr></thead><tbody>${standingsRows || '<tr><td colspan="8">Noch keine Ergebnisse.</td></tr>'}</tbody></table>
<h2>Teilnehmer</h2><ul>${partRows || "<li>Noch keine.</li>"}</ul>
<h2>Spiele</h2><ul>${matchRows || "<li>Noch kein Spielplan &mdash; <code>tournament start &lt;id&gt;</code>.</li>"}</ul>
</body></html>`;
}

/**
 * `comvenio tournament <action>` — V3 participant engine (gateway key "tournament").
 * Diese CLI ist die EINZIGE erlaubte Backend-Schnittstelle fuer Agenten — NIE direkte API-Calls.
 * Fehlt ein Befehl, wird er HIER ergaenzt (so wird das CLI staendig auf Fehler geprueft).
 *   list | series-list | series-create | execution-create | execution-link | status | show | participants | mannschaft (add)
 *   | participant-withdraw | participant-reinstate | participant-remove | start | matches | matches-clear | reset | redraw
 *   | standings | preview | draw | draw-confirm | schedule-generate | match-schedule | match-delete | match-result
 */
export function registerTournamentCommands(cli: CAC): void {
  cli
    .command(
      "tournament <action> [id]",
      "Turniere V3: list | series-list | series-create | execution-create | execution-link | status | show | participants | mannschaft | participant-withdraw | participant-reinstate | participant-remove | start | matches | matches-clear | reset | redraw | standings | preview | draw | draw-confirm | schedule-generate | match-schedule | match-delete | match-result | deadline",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--name <name>", "Name (mannschaft: Mannschafts-/Spielername)")
    .option("--kind <kind>", "Teilnehmer-Art: team (Mannschaft) | individual | pair (default: team)")
    .option("--seed <n>", "Setznummer (mannschaft)")
    .option("--status <s>", "mannschaft: registration_status (default confirmed) | match-schedule: schedule_status (default proposed)")
    .option("--event <id>", "execution-link: Event-ID setzen")
    .option("--clear-event", "execution-link: Event-Verknuepfung entfernen")
    .option("--open", "Preview im Standard-Browser oeffnen")
    .option("--file <path>", "draw: JSON-Datei mit dem Draw-Session-Body (strategy, fixed_assignments, knockout_config)")
    .option("--start <iso>", "match-schedule: starts_at (ISO, z. B. 2026-07-04T14:00:00Z)")
    .option("--end <iso>", "match-schedule: ends_at (ISO)")
    .option("--location <label>", 'match-schedule: Feld-Label, z. B. "Feld 1"')
    .option("--match-minutes <n>", "schedule-generate: Spieldauer in Minuten")
    .option("--break-minutes <n>", "schedule-generate: Pause zwischen Slots in Minuten")
    .option("--field-count <n>", "schedule-generate: Anzahl paralleler Felder")
    .option("--first-kickoff <iso>", "schedule-generate: erster Anpfiff (ISO; leer = Turnier-Startzeit)")
    .option("--match-number <n>", "match-schedule: Spielnummer setzen")
    .option("--dry-run", "schedule-generate: nur Vorschau, nichts persistieren")
    .option("--no-auto-book", "schedule-generate: keine automatische Objekt-Buchung")
    .option("--participant <id>", "participant-withdraw/-reinstate/-remove: Teilnehmer-ID")
    .option("--phase <p>", "matches-clear: group | finals | all (default all)")
    .option("--home <n>", "match-result: Tore Heim (side 0)")
    .option("--away <n>", "match-result: Tore Auswaerts (side 1)")
    .option("--sets <notation>", 'match-result: Tennis-Saetze, z. B. "6:2,7:6(9:7)" oder "7:6(7:4),1:6,MTB2:10"')
    .option("--walkover", "match-result: kampflos (w.o.) — Gegner nicht angetreten, Template-Wertung (Tennis 6:0 6:0)")
    .option("--retired", "match-result: Aufgabe im Match — Teil-Score via --sets, Rest wird fuer den Gegner gewertet")
    .option("--no-show", "match-result: einseitiger Nichtantritt (Wertung wie walkover, eigener Marker)")
    .option("--no-contest", "match-result: beide nicht angetreten — ohne Wertung abschliessen")
    .option("--winner <side>", "match-result: Gewinner-Seite home | away (Pflicht bei walkover/retired/no-show)")
    .option("--mode <m>", "participant-withdraw: cancel | walkover (Default: vor Turnierstart cancel, danach walkover)")
    .option("--at <iso>", "deadline: Ergebnis-Deadline (ISO) fuer offene Spiele der Phase setzen")
    .option("--policy <p>", "deadline: manual | auto_no_contest (Verhalten bei Deadline-Ueberschreitung)")
    .option("--show", "deadline: aktuelle Konfiguration + ueberfaellige Spiele anzeigen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);

      switch (action) {
        case "series-list": {
          const clubId = requireClubId(state, opts.club);
          const items = await client.get<TournamentSeries[]>("tournament", `/tournament-series/?club_id=${clubId}`);
          output(items, opts.json, () =>
            Array.isArray(items) && items.length
              ? renderTable(items, [
                  { header: "Titel", width: 32, get: (s) => String(s.title ?? "—") },
                  { header: "Sport", width: 10, get: (s) => String(s.sport_key ?? "—") },
                  { header: "Template", width: 28, get: (s) => String(s.template_key ?? "—") },
                  { header: "Exec", width: 5, get: (s) => String((s.executions ?? []).length) },
                  { header: "ID", width: 36, get: (s) => String(s.id ?? "—") },
                ])
              : "Keine Turnierserien.",
          );
          break;
        }

        case "series-create": {
          if (!opts.file) throw new Error("tournament series-create benoetigt --file <series.json>.");
          const clubId = requireClubId(state, opts.club);
          const body = { club_id: clubId, ...JSON.parse(readFileSync(opts.file, "utf-8")) };
          const created = await client.post<TournamentSeries>("tournament", "/tournament-series/", body);
          output(created, opts.json, () => `Turnierserie angelegt: ${created.title ?? "?"} (${created.id ?? "?"}).`);
          break;
        }

        case "execution-create": {
          if (!id) throw new Error("tournament execution-create <series-id> benoetigt eine Serien-ID.");
          if (!opts.file) throw new Error("tournament execution-create benoetigt --file <execution.json>.");
          const body = JSON.parse(readFileSync(opts.file, "utf-8"));
          const created = await client.post<Tournament>("tournament", `/tournament-series/${id}/executions`, body);
          output(created, opts.json, () => `Turnier-Ausführung angelegt: ${created.title ?? "?"} (${created.id ?? "?"}).`);
          break;
        }
        case "execution-link": {
          if (!id) throw new Error("tournament execution-link <tournament-id> benoetigt eine Ausfuehrungs-ID.");
          if (!opts.event && !opts.clearEvent) throw new Error("tournament execution-link benoetigt --event <event-id> oder --clear-event.");
          const updated = await client.patch<Tournament>("tournament", `/tournaments/${id}`, {
            event_id: opts.clearEvent ? null : opts.event,
          });
          output(updated, opts.json, () => `Turnier-Ausfuehrung ${id}: Event ${opts.clearEvent ? "entfernt" : opts.event}.`);
          break;
        }        case "status": {
          if (!id) throw new Error("tournament status <id> benoetigt eine Turnier-ID + --status <status>.");
          if (!opts.status) throw new Error("tournament status benoetigt --status <draft|registration|draw|scheduled|active|completed|cancelled|archived>.");
          const updated = await client.patch<Tournament>("tournament", `/tournaments/${id}`, { status: opts.status });
          output(updated, opts.json, () => `Turnier ${id}: Status ${updated.status ?? opts.status}.`);
          break;
        }
        case "list": {
          const clubId = requireClubId(state, opts.club);
          const items = await client.get<Tournament[]>("tournament", `/tournaments/?club_id=${clubId}`);
          output(items, opts.json, () =>
            Array.isArray(items) && items.length
              ? renderTable(items, [
                  { header: "Titel", width: 32, get: (t) => String(t.title ?? "—") },
                  { header: "Sport", width: 10, get: (t) => String(t.sport_key ?? "—") },
                  { header: "Status", width: 12, get: (t) => String(t.status ?? "—") },
                  { header: "ID", width: 36, get: (t) => String(t.id ?? "—") },
                ])
              : "Keine Turniere.",
          );
          break;
        }

        case "show": {
          if (!id) throw new Error("tournament show <id> benoetigt eine Turnier-ID.");
          const t = await client.get<Tournament>("tournament", `/tournaments/${id}`);
          output(
            t,
            opts.json,
            () => `${t.title ?? "?"} — ${t.sport_key ?? "?"} / ${t.tournament_mode ?? "?"} — Status ${t.status ?? "?"} (${t.id ?? id})`,
          );
          break;
        }

        case "participants": {
          if (!id) throw new Error("tournament participants <id> benoetigt eine Turnier-ID.");
          const parts = await client.get<Participant[]>("tournament", `/tournaments/${id}/participants`);
          output(parts, opts.json, () =>
            Array.isArray(parts) && parts.length
              ? renderTable(parts, [
                  { header: "Name", width: 28, get: (p) => String(p.name ?? "—") },
                  { header: "Art", width: 14, get: (p) => KIND_NOUN[String(p.participant_kind)] ?? String(p.participant_kind ?? "—") },
                  { header: "Status", width: 12, get: (p) => String(p.registration_status ?? "—") },
                  { header: "ID", width: 36, get: (p) => String(p.id ?? "—") },
                ])
              : "Noch keine Teilnehmer.",
          );
          break;
        }

        case "mannschaft":
        case "participant": {
          if (!id) throw new Error('tournament mannschaft <id> benoetigt eine Turnier-ID + --name "...".');
          if (!opts.name) throw new Error('tournament mannschaft benoetigt --name "...".');
          const kind = opts.kind ?? "team";
          const created = await client.post<Participant>(
            "tournament",
            `/tournaments/${id}/participants`,
            prune({
              name: opts.name,
              participant_kind: kind,
              origin: "host_club",
              registration_status: opts.status ?? "confirmed",
              seed: opts.seed != null ? Number(opts.seed) : undefined,
            }),
          );
          output(created, opts.json, () => `${KIND_NOUN[kind] ?? kind} angelegt: ${opts.name} (${created.id ?? "?"}).`);
          break;
        }

        case "start": {
          if (!id) throw new Error("tournament start <id> benoetigt eine Turnier-ID.");
          const t = await client.post<Tournament>("tournament", `/tournaments/${id}/start`);
          output(t, opts.json, () => `Turnier gestartet — Status ${t.status ?? "?"}. Spielplan: comvenio tournament matches ${id}`);
          break;
        }

        case "matches": {
          if (!id) throw new Error("tournament matches <id> benoetigt eine Turnier-ID.");
          const [matches, parts] = await Promise.all([
            client.get<Match[]>("tournament", `/tournaments/${id}/matches`),
            client.get<Participant[]>("tournament", `/tournaments/${id}/participants`),
          ]);
          const byId = new Map<string, string>((parts ?? []).map((p) => [String(p.id), String(p.name ?? "?")]));
          output(matches, opts.json, () =>
            Array.isArray(matches) && matches.length
              ? matches.map((m) => `${m.group ? `[${m.group}] ` : ""}${sideNames(m, byId)} — ${m.status ?? "?"}`).join("\n")
              : `Noch kein Spielplan. comvenio tournament start ${id}`,
          );
          break;
        }

        case "standings": {
          if (!id) throw new Error("tournament standings <id> benoetigt eine Turnier-ID.");
          const s = await client.get<Standings>("tournament", `/tournaments/${id}/standings`);
          const rows = s.rows ?? [];
          output(s, opts.json, () =>
            rows.length
              ? renderTable(rows, [
                  { header: "#", width: 3, get: (r) => String(r.rank ?? "") },
                  { header: "Teilnehmer", width: 26, get: (r) => String(r.name ?? "—") },
                  { header: "Sp", width: 3, get: (r) => String(r.played ?? 0) },
                  { header: "S-U-N", width: 9, get: (r) => `${r.wins ?? 0}-${r.draws ?? 0}-${r.losses ?? 0}` },
                  { header: "Tore", width: 8, get: (r) => `${r.goals_for ?? 0}:${r.goals_against ?? 0}` },
                  { header: "Pkt", width: 4, get: (r) => String(r.points ?? 0) },
                ])
              : "Noch keine Ergebnisse.",
          );
          break;
        }

        case "preview": {
          if (!id) throw new Error("tournament preview <id> benoetigt eine Turnier-ID.");
          const [t, parts, matches, standings] = await Promise.all([
            client.get<Tournament>("tournament", `/tournaments/${id}`),
            client.get<Participant[]>("tournament", `/tournaments/${id}/participants`),
            client.get<Match[]>("tournament", `/tournaments/${id}/matches`),
            client.get<Standings>("tournament", `/tournaments/${id}/standings`),
          ]);
          const html = buildPreviewHtml(t, parts ?? [], matches ?? [], standings ?? { rows: [] });
          const file = join(tmpdir(), `tournament-${id}.html`);
          writeFileSync(file, html, "utf-8");
          const opened = opts.open ? await openInBrowser(file) : false;
          output(
            { preview_file: file, opened },
            opts.json,
            () =>
              `Preview geschrieben: ${file}${opts.open ? (opened ? " (im Browser geoeffnet)" : " (Browser-Open fehlgeschlagen)") : " — mit --open im Browser oeffnen"}`,
          );
          break;
        }

        case "draw": {
          // EXTEND 2026-07-02: fixed draw via JSON body (TournamentDrawSessionCreate) -
          // strategy "manual" + fixed_assignments places groups exactly; with
          // knockout_config (incl. placement_mode) the confirm also builds the KO bracket.
          if (!id) throw new Error("tournament draw <tournament-id> benoetigt eine Turnier-ID + --file <plan.json>.");
          if (!opts.file) throw new Error("tournament draw benoetigt --file <plan.json> (Body: TournamentDrawSessionCreate).");
          const body = JSON.parse(readFileSync(opts.file, "utf-8"));
          const session = await client.post<DrawSession>("tournament", `/tournaments/${id}/draw-sessions`, body);
          const groups = session.outcome?.groups ?? [];
          output(session, opts.json, () =>
            [
              `Draw-Session ${session.id ?? "?"} angelegt — Status ${session.status ?? "?"} (${session.strategy ?? "?"}).`,
              ...groups.map(
                (g) => `  ${g.label ?? g.key ?? "?"}: ${(g.participants ?? []).length} Teilnehmer`,
              ),
              `Bestaetigen (materialisiert Spiele + K.O.-Bracket): comvenio tournament draw-confirm ${id}`,
            ].join("\n"),
          );
          break;
        }

        case "draw-confirm": {
          if (!id) throw new Error("tournament draw-confirm <tournament-id> benoetigt eine Turnier-ID.");
          const current = await client.get<DrawSession>("tournament", `/tournaments/${id}/draw-sessions/current`);
          if (!current?.id) throw new Error("Keine Draw-Session gefunden — zuerst: comvenio tournament draw <id> --file plan.json");
          const confirmed = await client.post<DrawSession>("tournament", `/draw-sessions/${current.id}/confirm`);
          const created = confirmed.outcome?.materialization?.matches_created;
          output(confirmed, opts.json, () =>
            `Auslosung bestaetigt — ${created ?? "?"} Spiele materialisiert (inkl. K.O.-Bracket bei group_knockout). Spielplan: comvenio tournament matches ${id}`,
          );
          break;
        }

        case "schedule-generate": {
          if (!id) throw new Error("tournament schedule-generate <tournament-id> benoetigt eine Turnier-ID.");
          const body = prune({
            match_minutes: opts.matchMinutes != null ? Number(opts.matchMinutes) : undefined,
            break_minutes: opts.breakMinutes != null ? Number(opts.breakMinutes) : undefined,
            field_count: opts.fieldCount != null ? Number(opts.fieldCount) : undefined,
            first_kickoff: opts.firstKickoff,
            auto_book: opts.autoBook === false ? false : undefined,
            dry_run: opts.dryRun ? true : undefined,
          });
          const result = await client.post<ScheduleGenerateResult>("tournament", `/tournaments/${id}/schedule/generate`, body);
          output(result, opts.json, () =>
            [
              `${opts.dryRun ? "Vorschau" : "Spielplan generiert"}: ${result.generated_count ?? 0} Spiele` +
                ((result.skipped_fixed_count ?? 0) > 0 ? ` (${result.skipped_fixed_count} fixierte uebersprungen)` : ""),
              ...(result.warnings ?? []).map((w) => `  ⚠ ${w}`),
            ].join("\n"),
          );
          break;
        }

        case "match-schedule": {
          // id = MATCH id here (not tournament id). Sets exact time/field for one match.
          if (!id) throw new Error("tournament match-schedule <match-id> benoetigt eine Match-ID + --start/--end/--location.");
          if (!opts.start && !opts.end && !opts.location) {
            throw new Error("tournament match-schedule benoetigt mindestens --start, --end oder --location.");
          }
          const body = prune({
            starts_at: opts.start,
            ends_at: opts.end,
            location: opts.location,
            schedule_status: opts.status ?? "proposed",
          });
          if (opts.matchNumber != null) {
            await client.patch<Match>("tournament", `/matches/${id}`, { match_number: Number(opts.matchNumber) });
          }
          const updated = await client.patch<Match>("tournament", `/matches/${id}/schedule`, body);
          output(updated, opts.json, () =>
            `Match ${id}: ${opts.start ?? "(Zeit unveraendert)"} — ${opts.location ?? "(Feld unveraendert)"} gesetzt.`,
          );
          break;
        }

        case "match-delete": {
          if (!id) throw new Error("tournament match-delete <match-id> benoetigt eine Match-ID.");
          await client.del("tournament", `/matches/${id}`);
          output({ deleted: id }, opts.json, () => `Match ${id} geloescht (Soft-Delete).`);
          break;
        }

        case "participant-withdraw":
        case "participant-reinstate": {
          // K5: withdraw (registration_status=withdrawn) removes a participant from draws +
          // public view and cancels its open matches (backend K2); reinstate sets it back to
          // confirmed. Backend: PATCH /tournaments/{tid}/participants/{pid}.
          if (!id) throw new Error(`tournament ${action} <tournament-id> benoetigt eine Turnier-ID + --participant <pid>.`);
          if (!opts.participant) throw new Error(`tournament ${action} benoetigt --participant <participant-id>.`);
          const registration_status = action === "participant-withdraw" ? "withdrawn" : "confirmed";
          if (opts.mode && !["cancel", "walkover"].includes(opts.mode)) {
            throw new Error('tournament participant-withdraw --mode erwartet "cancel" oder "walkover".');
          }
          const updated = await client.patch<Participant>(
            "tournament",
            `/tournaments/${id}/participants/${opts.participant}`,
            prune({
              registration_status,
              // K18/K17: cancel = annullieren (Re-Draw), walkover = offene Spiele
              // 6:0 6:0 fuer die Gegner werten. Ohne --mode: Backend-Default
              // (vor Turnierstart cancel, danach walkover).
              withdrawal_mode: action === "participant-withdraw" ? opts.mode : undefined,
            }),
          );
          const summary = (updated.participant_metadata as Record<string, any> | undefined)?.withdrawal_summary;
          output(updated, opts.json, () =>
            action === "participant-withdraw"
              ? summary?.mode === "walkover"
                ? `Teilnehmer ${updated.name ?? opts.participant} abgemeldet — ${summary.walkover_matches ?? 0} offene Spiele als Walkover (6:0 6:0) fuer die Gegner gewertet.`
                : `Teilnehmer ${updated.name ?? opts.participant} abgemeldet (withdrawn) — ${summary?.cancelled_matches ?? "offene"} Spiele annulliert.`
              : `Teilnehmer ${updated.name ?? opts.participant} wieder angemeldet (confirmed). Neuer Spielplan: comvenio tournament redraw ${id} --file plan.json`,
          );
          break;
        }

        case "participant-remove": {
          // K5: hard removal (soft-delete) of a participant incl. its open matches (backend K2).
          if (!id) throw new Error("tournament participant-remove <tournament-id> benoetigt eine Turnier-ID + --participant <pid>.");
          if (!opts.participant) throw new Error("tournament participant-remove benoetigt --participant <participant-id>.");
          await client.del("tournament", `/tournaments/${id}/participants/${opts.participant}`);
          output({ removed: opts.participant }, opts.json, () => `Teilnehmer ${opts.participant} entfernt (Soft-Delete) — offene Spiele wurden annulliert.`);
          break;
        }

        case "matches-clear": {
          // K5: bulk-clear matches (phase group|finals|all) before a re-draw. Backend K3.
          if (!id) throw new Error("tournament matches-clear <tournament-id> benoetigt eine Turnier-ID.");
          const phase = opts.phase ?? "all";
          const result = await client.post<{ cleared?: number; phase?: string }>(
            "tournament",
            `/tournaments/${id}/matches/clear?phase=${phase}`,
          );
          output(result, opts.json, () => `${result.cleared ?? 0} Spiele geleert (Phase: ${result.phase ?? phase}).`);
          break;
        }

        case "reset": {
          // K5: reset a tournament to a re-draw-able state (status=registration). Backend K4.
          if (!id) throw new Error("tournament reset <tournament-id> benoetigt eine Turnier-ID.");
          const t = await client.post<Tournament>("tournament", `/tournaments/${id}/reset`);
          output(t, opts.json, () => `Turnier ${id} auf Status ${t.status ?? "registration"} gesetzt. Neue Auslosung kann starten.`);
          break;
        }

        case "redraw": {
          // K5: convenience wrapper for a full re-draw: reset -> matches-clear all ->
          // draw (--file) -> draw-confirm. Withdrawn participants are NOT drawn back in
          // (backend only draws "confirmed") — so: first participant-withdraw, then redraw.
          if (!id) throw new Error("tournament redraw <tournament-id> benoetigt eine Turnier-ID + --file <plan.json>.");
          if (!opts.file) throw new Error("tournament redraw benoetigt --file <plan.json> (Body: TournamentDrawSessionCreate).");
          const body = JSON.parse(readFileSync(opts.file, "utf-8"));
          await client.post<Tournament>("tournament", `/tournaments/${id}/reset`);
          const cleared = await client.post<{ cleared?: number }>("tournament", `/tournaments/${id}/matches/clear?phase=all`);
          const session = await client.post<DrawSession>("tournament", `/tournaments/${id}/draw-sessions`, body);
          if (!session?.id) throw new Error("Draw-Session konnte nicht angelegt werden.");
          const confirmed = await client.post<DrawSession>("tournament", `/draw-sessions/${session.id}/confirm`);
          const created = confirmed.outcome?.materialization?.matches_created;
          output(
            { reset: true, cleared: cleared.cleared, draw_session: session.id, matches_created: created },
            opts.json,
            () =>
              [
                "Re-Draw abgeschlossen:",
                "  Reset -> registration",
                `  ${cleared.cleared ?? 0} alte Spiele geleert`,
                `  Neue Auslosung: ${session.id ?? "?"}`,
                `  ${created ?? "?"} Spiele materialisiert (inkl. K.O.-Bracket)`,
                `Zeiten/Felder: comvenio tournament schedule-generate ${id} --match-minutes ... --field-count ...`,
              ].join("\n"),
          );
          break;
        }

        case "match-result": {
          // Ergebnis eines Matches setzen (Backend POST /matches/{id}/result).
          // id = MATCH-id (nicht Turnier-id). K18: Tennis-Saetze via --sets,
          // Sonderwertungen via --walkover/--retired/--no-show/--no-contest.
          if (!id) throw new Error("tournament match-result <match-id> benoetigt eine Match-ID.");

          const specialFlags = [
            opts.walkover ? "walkover" : null,
            opts.retired ? "retired" : null,
            opts.noShow ? "no_show" : null,
            opts.noContest ? "no_contest" : null,
          ].filter(Boolean) as string[];
          if (specialFlags.length > 1) {
            throw new Error(
              `Nur EINE Sonderwertung erlaubt (--walkover | --retired | --no-show | --no-contest), gefunden: ${specialFlags.join(", ")}.`,
            );
          }
          const resultType = specialFlags[0] ?? "played";

          const winner = (opts.winner ?? "").trim().toLowerCase();
          if (resultType !== "played" && resultType !== "no_contest" && !["home", "away"].includes(winner)) {
            throw new Error(`tournament match-result --${resultType.replace("_", "-")} benoetigt --winner home|away.`);
          }
          if (resultType === "retired" && !opts.sets) {
            throw new Error('tournament match-result --retired benoetigt --sets "<Teil-Score bei Aufgabe>", z. B. --sets "6:3,2:1".');
          }

          const body: Record<string, unknown> = { result_status: opts.status ?? "confirmed" };
          if (resultType !== "played") body.result_type = resultType;
          if (winner) body.winner_side_id = winner;
          if (opts.sets) {
            // Parser-Fehler fliegen VOR dem Request (AK-18-01).
            body.score = { sets: parseSetsNotation(opts.sets) };
          } else if (resultType === "played" || (opts.home != null && opts.away != null)) {
            if (resultType === "played" && (opts.home == null || opts.away == null)) {
              throw new Error('tournament match-result benoetigt --home <tore> --away <tore> ODER --sets "6:2,7:6(9:7)".');
            }
            if (opts.home != null && opts.away != null) {
              body.score_home = Number(opts.home);
              body.score_away = Number(opts.away);
            }
          }

          const updated = await client.post<Match>("tournament", `/matches/${id}/result`, body);
          const scoreLabel = opts.sets
            ? opts.sets
            : opts.home != null
              ? `${opts.home}:${opts.away}`
              : resultType === "no_contest"
                ? "ohne Wertung"
                : "Template-Wertung (z. B. 6:0 6:0)";
          const typeLabel =
            resultType === "played"
              ? ""
              : ` [${{ walkover: "w.o.", retired: "Aufgabe", no_show: "nicht angetreten", no_contest: "beide nicht angetreten" }[resultType]}]`;
          output(updated, opts.json, () => `Ergebnis gesetzt: Match ${id} ${scoreLabel}${typeLabel} (${updated.status ?? "?"}).`);
          break;
        }

        case "deadline": {
          // K18: Ergebnis-Deadline pro Phase + Policy (Backend K17).
          if (!id) throw new Error("tournament deadline <tournament-id> benoetigt eine Turnier-ID (+ --at | --policy | --show).");
          const phase = opts.phase ?? "group";

          if (opts.at) {
            const result = await client.patch<{ updated?: number; phase?: string; deadline_at?: string }>(
              "tournament",
              `/tournaments/${id}/matches/deadline?phase=${phase}`,
              { deadline_at: opts.at },
            );
            output(result, opts.json, () =>
              `Deadline ${opts.at} auf ${result.updated ?? 0} offene Spiele gesetzt (Phase: ${result.phase ?? phase}).`,
            );
            break;
          }

          if (opts.policy) {
            if (!["manual", "auto_no_contest"].includes(opts.policy)) {
              throw new Error('tournament deadline --policy erwartet "manual" oder "auto_no_contest".');
            }
            // rules_config merge-semantisch patchen (PATCH ersetzt das ganze JSON-Feld).
            const tournament = await client.get<Tournament>("tournament", `/tournaments/${id}`);
            const rules = { ...((tournament.rules_config as Record<string, unknown>) ?? {}) };
            rules.result_deadline = { ...((rules.result_deadline as Record<string, unknown>) ?? {}), policy: opts.policy };
            const updated = await client.patch<Tournament>("tournament", `/tournaments/${id}`, { rules_config: rules });
            output(updated, opts.json, () =>
              `Deadline-Policy: ${opts.policy === "auto_no_contest" ? "automatisch ohne Wertung (auto_no_contest)" : "Admin entscheidet (manual)"} gesetzt.`,
            );
            break;
          }

          // --show (Default ohne --at/--policy)
          const tournament = await client.get<Tournament>("tournament", `/tournaments/${id}`);
          const deadlineConfig = ((tournament.rules_config as Record<string, unknown>) ?? {}).result_deadline as
            | Record<string, unknown>
            | undefined;
          const matches = await client.get<Match[]>("tournament", `/tournaments/${id}/matches`);
          const now = Date.now();
          const overdue = (matches ?? []).filter(
            (m) =>
              (m.status === "scheduled" || m.status === "postponed") &&
              m.deadline_at &&
              Date.parse(String(m.deadline_at)) < now,
          );
          output({ policy: deadlineConfig?.policy ?? null, overdue: overdue.map((m) => m.id) }, opts.json, () =>
            [
              `Deadline-Policy: ${deadlineConfig?.policy ?? "(nicht gesetzt — Admin entscheidet)"}`,
              `Ueberfaellige offene Spiele: ${overdue.length}`,
              ...overdue.map((m) => `  ${m.id}  (Deadline ${m.deadline_at})`),
            ].join("\n"),
          );
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, series-list, series-create, execution-create, execution-link, status, show, participants, mannschaft, participant-withdraw, participant-reinstate, participant-remove, start, matches, matches-clear, reset, redraw, standings, preview, draw, draw-confirm, schedule-generate, match-schedule, match-delete, match-result, deadline`,
          );
      }
    });
}
