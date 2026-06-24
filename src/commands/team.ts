import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";

// team-service (member-service router /teams) endpoints (verified Sub-File 04):
//   GET    /member/teams/by-club/{club_id}
//   GET    /member/teams/{team_id}/members
//   POST   /member/teams/{team_id}/members            (TeamMemberCreate)
//   DELETE /member/teams/{team_id}/members/{member_id} (204)
// gateway service key = "member"; router prefix = "/teams".

type TeamRead = { id?: string; name?: string; [key: string]: unknown };
type TeamMemberRead = {
  id?: string;
  member_id?: string;
  role?: string;
  jersey_number?: number;
  position?: string;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
  memberId?: string;
  role?: string;
  jerseyNumber?: string;
  position?: string;
};

/**
 * `comvenio team <action> [arg1] [arg2]` dispatcher.
 *   team list                                 → list club teams
 *   team member list <team-id>                → list squad
 *   team member add <team-id> --member-id <m> → add to squad
 *   team member remove <team-id> <member-id>  → remove from squad
 */
export function registerTeamCommands(cli: CAC): void {
  cli
    .command("team <action> [arg1] [arg2]", "Teams verwalten: list | member list|add|remove")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--member-id <id>", "Member-ID (bei member add)")
    .option("--role <r>", "PLAYER|CAPTAIN|COACH|ASSISTANT_COACH|MANAGER")
    .option("--jersey-number <n>", "Trikotnummer")
    .option("--position <p>", "Position")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(
      async (
        action: string,
        arg1: string | undefined,
        arg2: string | undefined,
        opts: Opts,
      ) => {
        const state = loadState();
        const client = createClient(state);
        const clubId = requireClubId(state, opts.club);

        if (action === "list") {
          const teams = await client.get<TeamRead[]>("member", `/teams/by-club/${clubId}`);
          output(teams, opts.json, () =>
            teams.length
              ? renderTable(teams, [
                  { header: "ID", width: 36, get: (t) => String(t.id ?? "") },
                  { header: "Name", width: 30, get: (t) => String(t.name ?? "—") },
                ])
              : "Keine Teams.",
          );
          return;
        }

        if (action === "member") {
          // member sub-dispatcher: arg1 = sub-action, arg2 = team-id (or member-id on remove)
          const sub = arg1;
          switch (sub) {
            case "list": {
              const teamId = arg2;
              if (!teamId) throw new Error("team member list benoetigt eine <team-id>.");
              const members = await client.get<TeamMemberRead[]>(
                "member",
                `/teams/${teamId}/members`,
              );
              output(members, opts.json, () =>
                members.length
                  ? renderTable(members, [
                      { header: "Member-ID", width: 36, get: (m) => String(m.member_id ?? "") },
                      { header: "Rolle", width: 16, get: (m) => String(m.role ?? "—") },
                      { header: "Nr.", width: 5, get: (m) => String(m.jersey_number ?? "") },
                    ])
                  : "Keine Spieler im Kader.",
              );
              return;
            }
            case "add": {
              const teamId = arg2;
              if (!teamId) throw new Error("team member add benoetigt eine <team-id>.");
              if (!opts.memberId)
                throw new Error("team member add benoetigt --member-id <id>.");
              const body = prune({
                member_id: opts.memberId,
                role: opts.role,
                jersey_number: opts.jerseyNumber ? Number(opts.jerseyNumber) : undefined,
                position: opts.position,
              });
              const res = await client.post<TeamMemberRead>(
                "member",
                `/teams/${teamId}/members`,
                body,
              );
              output(res, opts.json, () =>
                `Mitglied zum Team hinzugefuegt: ${res.member_id ?? opts.memberId}`,
              );
              return;
            }
            case "remove": {
              const teamId = arg2;
              if (!teamId)
                throw new Error("team member remove benoetigt <team-id> <member-id>.");
              // memberId comes from --member-id OR is the next positional. cac only
              // captures arg1/arg2, so for remove we require --member-id explicitly.
              const memberId = opts.memberId;
              if (!memberId)
                throw new Error(
                  "team member remove benoetigt --member-id <id> (zusaetzlich zur <team-id>).",
                );
              await client.del("member", `/teams/${teamId}/members/${memberId}`);
              output({ deleted: true, team_id: teamId, member_id: memberId }, opts.json, () =>
                `Mitglied ${memberId} aus Team ${teamId} entfernt.`,
              );
              return;
            }
            default:
              throw new Error(
                `Unbekannte team-member-Aktion "${sub}". Verfuegbar: list, add, remove`,
              );
          }
        }

        throw new Error(`Unbekannte Aktion "${action}". Verfuegbar: list, member`);
      },
    );
}
