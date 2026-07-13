import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readJsonFile } from "../util/file.ts";

// member-service endpoints (verified in Sub-File 04):
//   GET    /member/members/by_club/{club_id}     (Query limit, offset)
//   GET    /member/members/{member_id}
//   POST   /member/members/                      (MemberCreate)
//   PATCH  /member/members/{member_id}           (MemberUpdate, no club_id)
//   DELETE /member/members/{member_id}           (204, soft-delete)
// gateway service key = "member"; router prefix = "/members".

type MemberRead = {
  id?: string;
  club_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  user_id?: string | null;
  joined_at?: string | null;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
  limit?: string;
  offset?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  birthdate?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
  joinedAt?: string;
  userId?: string;
  membershipStatusId?: string;
  familyId?: string;
  file?: string;
};

// Map CLI flags → MemberCreate/MemberUpdate body fields. club_id is added by the
// caller (from the state file), never from a flag — and never on update.
function memberBody(o: Opts, mode: "create" | "update"): Record<string, unknown> {
  return prune({
    first_name: o.firstName,
    last_name: o.lastName,
    email: o.email,
    phone_number: o.phone,
    birthdate: o.birthdate,
    address: o.address,
    postal_code: o.postalCode,
    city: o.city,
    state: o.state,
    country: o.country,
    joined_at: o.joinedAt,
    user_id: o.userId,
    membership_status_id: mode === "create" ? o.membershipStatusId : undefined,
    family_id: mode === "create" ? o.familyId : undefined,
  });
}

function memberName(m: MemberRead): string {
  return [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || "—";
}

/**
 * `comvenio member <action> [id]` dispatcher. cac has no native multi-word
 * commands (Gotcha workflow.md) → one "member <action>" command + switch.
 * Each action maps 1:1 onto a member-service endpoint; RBAC is server-side.
 */
export function registerMemberCommands(cli: CAC): void {
  cli
    .command("member <action> [id]", "Mitglieder, Familien, Status, Mitgliedschaftszeiten und Import verwalten")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--limit <n>", "Seitengroesse (1-500, paginiert)")
    .option("--offset <n>", "Offset (Default 0)")
    .option("--first-name <v>", "Vorname (Pflicht bei add)")
    .option("--last-name <v>", "Nachname (Pflicht bei add)")
    .option("--email <v>", "E-Mail")
    .option("--phone <v>", "Telefonnummer")
    .option("--birthdate <v>", "Geburtsdatum (ISO)")
    .option("--address <v>", "Strasse + Hausnummer")
    .option("--postal-code <v>", "Postleitzahl")
    .option("--city <v>", "Ort")
    .option("--state <v>", "Bundesland")
    .option("--country <v>", "Land")
    .option("--joined-at <v>", "Eintrittsdatum (ISO)")
    .option("--user-id <v>", "Verknuepfte User-ID")
    .option("--membership-status-id <v>", "Mitgliedsstatus-ID (nur add; nicht Teil von MemberUpdate)")
    .option("--family-id <v>", "Familien-ID (nur add; nicht Teil von MemberUpdate)")
    .option("--file <path>", "JSON-Payload fuer Familien, Status, Mitgliedschaftszeiten oder Import")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "list": {
          let path = `/members/by_club/${clubId}`;
          if (opts.limit) {
            const offset = opts.offset ?? "0";
            path += `?limit=${encodeURIComponent(opts.limit)}&offset=${encodeURIComponent(offset)}`;
          }
          const data = await client.get<MemberRead[] | { items: MemberRead[] }>(
            "member",
            path,
          );
          const rows = Array.isArray(data) ? data : (data.items ?? []);
          output(data, opts.json, () =>
            rows.length
              ? renderTable(rows, [
                  { header: "ID", width: 36, get: (m) => String(m.id ?? "") },
                  { header: "Name", width: 28, get: memberName },
                  { header: "E-Mail", width: 28, get: (m) => String(m.email ?? "—") },
                ])
              : "Keine Mitglieder.",
          );
          break;
        }
        case "show": {
          if (!id) throw new Error('member show benoetigt eine <member-id>.');
          const m = await client.get<MemberRead>("member", `/members/${id}`);
          output(m, opts.json, () =>
            [
              `Name:    ${memberName(m)}`,
              `ID:      ${m.id ?? id}`,
              `E-Mail:  ${m.email ?? "—"}`,
              `Telefon: ${m.phone_number ?? "—"}`,
              `User-ID: ${m.user_id ?? "—"}`,
            ].join("\n"),
          );
          break;
        }
        case "add": {
          if (!opts.firstName || !opts.lastName) {
            throw new Error("member add benoetigt --first-name und --last-name.");
          }
          const body = { club_id: clubId, ...memberBody(opts, "create") };
          const m = await client.post<MemberRead>("member", "/members/", body);
          output(m, opts.json, () => `Mitglied angelegt: ${memberName(m)} (${m.id})`);
          break;
        }
        case "update": {
          if (!id) throw new Error('member update benoetigt eine <member-id>.');
          // No club_id on update — not in MemberUpdate schema (Sub-File 04).
          if (opts.membershipStatusId !== undefined || opts.familyId !== undefined) {
            throw new Error(
              "member update unterstuetzt --membership-status-id/--family-id nicht. Nutze die jeweiligen Mitgliedsstatus-/Familien-Workflows.",
            );
          }
          const body = memberBody(opts, "update");
          if (Object.keys(body).length === 0) {
            throw new Error("member update benoetigt mindestens ein zu aenderndes Feld.");
          }
          const m = await client.patch<MemberRead>("member", `/members/${id}`, body);
          output(m, opts.json, () => `Mitglied aktualisiert: ${memberName(m)} (${m.id})`);
          break;
        }
        case "remove": {
          if (!id) throw new Error('member remove benoetigt eine <member-id>.');
          await client.del("member", `/members/${id}`);
          output({ deleted: true, id }, opts.json, () => `Mitglied geloescht: ${id}`);
          break;
        }
        case "family-list": {
          const rows = await client.get<Record<string, unknown>[]>("member", `/families/by_club/${clubId}`);
          output(rows, opts.json, () => JSON.stringify(rows, null, 2));
          break;
        }
        case "family-show": {
          if (!id) throw new Error("member family-show <family-id> benoetigt eine ID.");
          const row = await client.get<Record<string, unknown>>("member", `/families/${id}`);
          output(row, opts.json, () => JSON.stringify(row, null, 2));
          break;
        }
        case "family-add": {
          if (!opts.file) throw new Error("member family-add benoetigt --file <family.json>.");
          const body = { ...readJsonFile<Record<string, unknown>>(opts.file), club_id: clubId };
          const row = await client.post<Record<string, unknown>>("member", "/families/", body);
          output(row, opts.json, () => `Familie angelegt: ${row.name ?? row.id ?? "?"}.`);
          break;
        }
        case "family-update": {
          if (!id) throw new Error("member family-update <family-id> benoetigt eine ID.");
          if (!opts.file) throw new Error("member family-update benoetigt --file <family-update.json>.");
          const row = await client.patch<Record<string, unknown>>(
            "member",
            `/families/${id}`,
            readJsonFile<Record<string, unknown>>(opts.file),
          );
          output(row, opts.json, () => `Familie aktualisiert: ${row.name ?? id}.`);
          break;
        }
        case "family-delete": {
          if (!id) throw new Error("member family-delete <family-id> benoetigt eine ID.");
          await client.del("member", `/families/${id}`);
          output({ deleted: true, id }, opts.json, () => `Familie geloescht: ${id}.`);
          break;
        }
        case "status-list": {
          const rows = await client.get<Record<string, unknown>[]>(
            "member",
            `/membership-status/by_club/${clubId}`,
          );
          output(rows, opts.json, () => JSON.stringify(rows, null, 2));
          break;
        }
        case "status-show": {
          if (!id) throw new Error("member status-show <status-id> benoetigt eine ID.");
          const row = await client.get<Record<string, unknown>>("member", `/membership-status/${id}`);
          output(row, opts.json, () => JSON.stringify(row, null, 2));
          break;
        }
        case "status-add": {
          if (!opts.file) throw new Error("member status-add benoetigt --file <status.json>.");
          const body = { ...readJsonFile<Record<string, unknown>>(opts.file), club_id: clubId };
          const row = await client.post<Record<string, unknown>>("member", "/membership-status/", body);
          output(row, opts.json, () => `Mitgliedsstatus angelegt: ${row.name ?? row.id ?? "?"}.`);
          break;
        }
        case "status-update": {
          if (!id) throw new Error("member status-update <status-id> benoetigt eine ID.");
          if (!opts.file) throw new Error("member status-update benoetigt --file <status-update.json>.");
          const row = await client.patch<Record<string, unknown>>(
            "member",
            `/membership-status/${id}`,
            readJsonFile<Record<string, unknown>>(opts.file),
          );
          output(row, opts.json, () => `Mitgliedsstatus aktualisiert: ${row.name ?? id}.`);
          break;
        }
        case "status-delete": {
          if (!id) throw new Error("member status-delete <status-id> benoetigt eine ID.");
          await client.del("member", `/membership-status/${id}`);
          output({ deleted: true, id }, opts.json, () => `Mitgliedsstatus geloescht: ${id}.`);
          break;
        }
        case "period-list": {
          if (!id) throw new Error("member period-list <member-id> benoetigt eine Member-ID.");
          const rows = await client.get<Record<string, unknown>[]>("member", `/membership-periods/member/${id}`);
          output(rows, opts.json, () => JSON.stringify(rows, null, 2));
          break;
        }
        case "period-show": {
          if (!id) throw new Error("member period-show <period-id> benoetigt eine ID.");
          const row = await client.get<Record<string, unknown>>("member", `/membership-periods/${id}`);
          output(row, opts.json, () => JSON.stringify(row, null, 2));
          break;
        }
        case "period-add": {
          if (!opts.file) throw new Error("member period-add benoetigt --file <period.json>.");
          const body = { ...readJsonFile<Record<string, unknown>>(opts.file), club_id: clubId };
          const row = await client.post<Record<string, unknown>>("member", "/membership-periods/", body);
          output(row, opts.json, () => `Mitgliedschaftszeitraum angelegt: ${row.id ?? "?"}.`);
          break;
        }
        case "period-update": {
          if (!id) throw new Error("member period-update <period-id> benoetigt eine ID.");
          if (!opts.file) throw new Error("member period-update benoetigt --file <period-update.json>.");
          const row = await client.patch<Record<string, unknown>>(
            "member",
            `/membership-periods/${id}`,
            readJsonFile<Record<string, unknown>>(opts.file),
          );
          output(row, opts.json, () => `Mitgliedschaftszeitraum aktualisiert: ${row.id ?? id}.`);
          break;
        }
        case "period-delete": {
          if (!id) throw new Error("member period-delete <period-id> benoetigt eine ID.");
          await client.del("member", `/membership-periods/${id}`);
          output({ deleted: true, id }, opts.json, () => `Mitgliedschaftszeitraum geloescht: ${id}.`);
          break;
        }
        case "import": {
          if (!opts.file) throw new Error("member import benoetigt --file <bulk-import.json>.");
          const body = { ...readJsonFile<Record<string, unknown>>(opts.file), club_id: clubId };
          const result = await client.post<Record<string, unknown>>("member", "/members/import/bulk", body);
          output(result, opts.json, () => JSON.stringify(result, null, 2));
          break;
        }
        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, add, update, remove, family-list, family-show, family-add, family-update, family-delete, status-list, status-show, status-add, status-update, status-delete, period-list, period-show, period-add, period-update, period-delete, import`,
          );
      }
    });
}
