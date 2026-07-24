import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readJsonFile } from "../util/file.ts";

type TeamRead = {
  id?: string;
  name?: string;
  department_id?: string;
  sport_type?: string;
  season?: string | null;
  [key: string]: unknown;
};
type TeamMemberRead = {
  id?: string;
  member_id?: string;
  role?: string;
  jersey_number?: number;
  position?: string;
  [key: string]: unknown;
};
type ResourcePriorityRead = {
  id?: string;
  object_id?: string;
  priority?: number;
  booking_duration_minutes?: number;
  notes?: string | null;
  [key: string]: unknown;
};

export type TeamCommandOpts = {
  json?: boolean;
  club?: string;
  file?: string;
  memberId?: string;
  role?: string;
  jerseyNumber?: string;
  position?: string;
  priorityId?: string;
  objectId?: string;
  priority?: string;
  bookingDurationMinutes?: string;
  notes?: string;
};

function objectPayload(path: string | undefined, command: string, required = true): Record<string, unknown> {
  if (!path) {
    if (required) throw new Error(`${command} benötigt --file <payload.json>.`);
    return {};
  }
  const body = readJsonFile<unknown>(path);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${command}: --file muss ein JSON-Objekt enthalten.`);
  }
  return body as Record<string, unknown>;
}

function integer(value: string | undefined, flag: string): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} muss eine ganze Zahl sein.`);
  return parsed;
}

export function buildTeamMemberBody(
  opts: TeamCommandOpts,
  fromFile: Record<string, unknown> = {},
): Record<string, unknown> {
  return prune({
    ...fromFile,
    member_id: opts.memberId ?? fromFile.member_id,
    role: opts.role ?? fromFile.role,
    jersey_number: integer(opts.jerseyNumber, "--jersey-number") ?? fromFile.jersey_number,
    position: opts.position ?? fromFile.position,
  });
}

export function buildResourcePriorityBody(
  opts: TeamCommandOpts,
  fromFile: Record<string, unknown> = {},
): Record<string, unknown> {
  return prune({
    ...fromFile,
    object_id: opts.objectId ?? fromFile.object_id,
    priority: integer(opts.priority, "--priority") ?? fromFile.priority,
    booking_duration_minutes:
      integer(opts.bookingDurationMinutes, "--booking-duration-minutes") ??
      fromFile.booking_duration_minutes,
    notes: opts.notes ?? fromFile.notes,
  });
}

export function registerTeamCommands(cli: CAC): void {
  cli
    .command(
      "team <action> [arg1] [arg2]",
      "Teams: list|show|create|update|delete | member | resource",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--file <path>", "JSON-Payload für komplexe Create-/Update-Aktionen")
    .option("--member-id <id>", "Mitglieds-ID")
    .option("--role <r>", "PLAYER|CAPTAIN|COACH|ASSISTANT_COACH|MANAGER")
    .option("--jersey-number <n>", "Trikotnummer")
    .option("--position <p>", "Position")
    .option("--priority-id <id>", "ID der Ressourcen-Priorität")
    .option("--object-id <id>", "ID des priorisierten Objekts")
    .option("--priority <n>", "Priorität als ganze Zahl")
    .option("--booking-duration-minutes <n>", "Buchungsdauer in Minuten")
    .option("--notes <text>", "Notiz zur Ressourcen-Priorität")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(
      async (
        action: string,
        arg1: string | undefined,
        arg2: string | undefined,
        opts: TeamCommandOpts,
      ) => {
        const state = await loadState();
        const client = createClient(state);
        const clubId = requireClubId(state, opts.club);

        if (action === "list") {
          const teams = await client.get<TeamRead[]>("member", `/teams/by-club/${clubId}`);
          output(teams, opts.json, () =>
            teams.length
              ? renderTable(teams, [
                  { header: "ID", width: 36, get: (t) => String(t.id ?? "") },
                  { header: "Name", width: 28, get: (t) => String(t.name ?? "—") },
                  { header: "Sport", width: 16, get: (t) => String(t.sport_type ?? "—") },
                  { header: "Saison", width: 12, get: (t) => String(t.season ?? "—") },
                ])
              : "Keine Teams.",
          );
          return;
        }

        if (action === "show") {
          if (!arg1) throw new Error("team show benötigt eine <team-id>.");
          const team = await client.get<TeamRead>("member", `/teams/${arg1}`);
          output(team, opts.json, () =>
            [
              `Team:       ${team.name ?? "—"}`,
              `ID:         ${team.id ?? arg1}`,
              `Abteilung: ${team.department_id ?? "—"}`,
              `Sport:      ${team.sport_type ?? "—"}`,
            ].join("\n"),
          );
          return;
        }

        if (action === "create") {
          const body = { ...objectPayload(opts.file, "team create"), club_id: clubId };
          const team = await client.post<TeamRead>("member", "/teams/", body);
          output(team, opts.json, () => `Team angelegt: ${team.name ?? "—"} (${team.id ?? "?"})`);
          return;
        }

        if (action === "update") {
          if (!arg1) throw new Error("team update benötigt eine <team-id>.");
          const body = objectPayload(opts.file, "team update");
          const team = await client.patch<TeamRead>("member", `/teams/${arg1}`, body);
          output(team, opts.json, () => `Team aktualisiert: ${team.name ?? "—"} (${team.id ?? arg1})`);
          return;
        }

        if (action === "delete") {
          if (!arg1) throw new Error("team delete benötigt eine <team-id>.");
          await client.del("member", `/teams/${arg1}`);
          output({ deleted: arg1 }, opts.json, () => `Team entfernt: ${arg1}`);
          return;
        }

        if (action === "member") {
          const sub = arg1;
          const teamId = arg2;
          if (!teamId) throw new Error(`team member ${sub ?? ""} benötigt eine <team-id>.`);

          if (sub === "list") {
            const members = await client.get<TeamMemberRead[]>("member", `/teams/${teamId}/members`);
            output(members, opts.json, () =>
              members.length
                ? renderTable(members, [
                    { header: "Member-ID", width: 36, get: (m) => String(m.member_id ?? "") },
                    { header: "Rolle", width: 18, get: (m) => String(m.role ?? "—") },
                    { header: "Nr.", width: 5, get: (m) => String(m.jersey_number ?? "") },
                    { header: "Position", width: 18, get: (m) => String(m.position ?? "—") },
                  ])
                : "Keine Mitglieder im Team.",
            );
            return;
          }

          if (sub === "add") {
            const body = buildTeamMemberBody(opts, objectPayload(opts.file, "team member add", false));
            if (!body.member_id) throw new Error("team member add benötigt --member-id <id> oder member_id in --file.");
            const member = await client.post<TeamMemberRead>("member", `/teams/${teamId}/members`, body);
            output(member, opts.json, () => `Mitglied hinzugefügt: ${member.member_id ?? body.member_id}`);
            return;
          }

          if (sub === "update") {
            if (!opts.memberId) throw new Error("team member update benötigt --member-id <id>.");
            const body = buildTeamMemberBody(opts, objectPayload(opts.file, "team member update", false));
            delete body.member_id;
            if (!Object.keys(body).length) throw new Error("team member update benötigt mindestens ein Änderungsfeld.");
            const member = await client.patch<TeamMemberRead>(
              "member",
              `/teams/${teamId}/members/${opts.memberId}`,
              body,
            );
            output(member, opts.json, () => `Team-Mitglied aktualisiert: ${member.member_id ?? opts.memberId}`);
            return;
          }

          if (sub === "remove") {
            if (!opts.memberId) throw new Error("team member remove benötigt --member-id <id>.");
            await client.del("member", `/teams/${teamId}/members/${opts.memberId}`);
            output({ deleted: true, team_id: teamId, member_id: opts.memberId }, opts.json, () =>
              `Mitglied ${opts.memberId} aus Team ${teamId} entfernt.`,
            );
            return;
          }

          throw new Error(`Unbekannte team-member-Aktion "${sub}". Verfügbar: list, add, update, remove`);
        }

        if (action === "resource") {
          const sub = arg1;
          const teamId = arg2;
          if (!teamId) throw new Error(`team resource ${sub ?? ""} benötigt eine <team-id>.`);

          if (sub === "list") {
            const rows = await client.get<ResourcePriorityRead[]>(
              "member",
              `/teams/${teamId}/resource-priorities`,
            );
            output(rows, opts.json, () =>
              rows.length
                ? renderTable(rows, [
                    { header: "ID", width: 36, get: (r) => String(r.id ?? "") },
                    { header: "Objekt", width: 36, get: (r) => String(r.object_id ?? "") },
                    { header: "Priorität", width: 10, get: (r) => String(r.priority ?? "—") },
                    { header: "Dauer", width: 8, get: (r) => String(r.booking_duration_minutes ?? "—") },
                  ])
                : "Keine Ressourcen-Prioritäten.",
            );
            return;
          }

          if (sub === "add") {
            const body = buildResourcePriorityBody(opts, objectPayload(opts.file, "team resource add", false));
            if (!body.object_id) throw new Error("team resource add benötigt --object-id <id> oder object_id in --file.");
            const row = await client.post<ResourcePriorityRead>(
              "member",
              `/teams/${teamId}/resource-priorities`,
              body,
            );
            output(row, opts.json, () => `Ressourcen-Priorität angelegt: ${row.id ?? "?"}`);
            return;
          }

          if (sub === "update") {
            if (!opts.priorityId) throw new Error("team resource update benötigt --priority-id <id>.");
            const body = buildResourcePriorityBody(opts, objectPayload(opts.file, "team resource update", false));
            delete body.object_id;
            if (!Object.keys(body).length) throw new Error("team resource update benötigt mindestens ein Änderungsfeld.");
            const row = await client.patch<ResourcePriorityRead>(
              "member",
              `/teams/${teamId}/resource-priorities/${opts.priorityId}`,
              body,
            );
            output(row, opts.json, () => `Ressourcen-Priorität aktualisiert: ${row.id ?? opts.priorityId}`);
            return;
          }

          if (sub === "remove") {
            if (!opts.priorityId) throw new Error("team resource remove benötigt --priority-id <id>.");
            await client.del("member", `/teams/${teamId}/resource-priorities/${opts.priorityId}`);
            output({ deleted: opts.priorityId }, opts.json, () => `Ressourcen-Priorität entfernt: ${opts.priorityId}`);
            return;
          }

          throw new Error(`Unbekannte team-resource-Aktion "${sub}". Verfügbar: list, add, update, remove`);
        }

        throw new Error(`Unbekannte Aktion "${action}". Verfügbar: list, show, create, update, delete, member, resource`);
      },
    );
}
