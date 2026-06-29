import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  open?: boolean;
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
type Participant = {
  id?: string;
  name?: string;
  participant_kind?: string;
  registration_status?: string;
  seed?: number | null;
};
type MatchSide = { side_index?: number; participant_id?: string; score?: number | null; is_winner?: boolean };
type Match = {
  id?: string;
  match_number?: number | null;
  round?: number | null;
  group?: string | null;
  status?: string;
  sides?: MatchSide[];
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
 *   list | show | participants | mannschaft (add) | start | matches | standings | preview
 */
export function registerTournamentCommands(cli: CAC): void {
  cli
    .command(
      "tournament <action> [id]",
      "Turniere V3: list | show | participants | mannschaft | start | matches | standings | preview",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--name <name>", "Name (mannschaft: Mannschafts-/Spielername)")
    .option("--kind <kind>", "Teilnehmer-Art: team (Mannschaft) | individual | pair (default: team)")
    .option("--seed <n>", "Setznummer (mannschaft)")
    .option("--status <s>", "registration_status (mannschaft, default confirmed)")
    .option("--open", "Preview im Standard-Browser oeffnen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);

      switch (action) {
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

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, participants, mannschaft, start, matches, standings, preview`,
          );
      }
    });
}
