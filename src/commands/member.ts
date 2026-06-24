import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";

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
};

// Map CLI flags → MemberCreate/MemberUpdate body fields. club_id is added by the
// caller (from the state file), never from a flag — and never on update.
function memberBody(o: Opts): Record<string, unknown> {
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
    membership_status_id: o.membershipStatusId,
    family_id: o.familyId,
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
    .command("member <action> [id]", "Mitglieder verwalten: list|show|add|update|remove")
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
    .option("--membership-status-id <v>", "Mitgliedsstatus-ID")
    .option("--family-id <v>", "Familien-ID")
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
          const body = { club_id: clubId, ...memberBody(opts) };
          const m = await client.post<MemberRead>("member", "/members/", body);
          output(m, opts.json, () => `Mitglied angelegt: ${memberName(m)} (${m.id})`);
          break;
        }
        case "update": {
          if (!id) throw new Error('member update benoetigt eine <member-id>.');
          // No club_id on update — not in MemberUpdate schema (Sub-File 04).
          const body = memberBody(opts);
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
        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, add, update, remove`,
          );
      }
    });
}
