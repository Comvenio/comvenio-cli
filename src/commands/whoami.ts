import type { CAC } from "cac";
import { loadState, STATE_FILE } from "../auth.ts";
import { createClient, HttpError } from "../http.ts";

type MeResponse = {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  main_club_id?: string;
};

/**
 * `comvenio whoami` — resolve the logged-in user via GET /user/users/me.
 * Best-effort: a valid state file already proves login, so if the user-service
 * is unreachable we still report clubId/environment from the local state.
 */
export function registerWhoamiCommand(cli: CAC): void {
  cli
    .command("whoami", "Aktuellen Login anzeigen (Name, Club, Umgebung)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (opts: { json?: boolean }) => {
      const state = loadState();
      const client = createClient(state);

      let user: MeResponse | null = null;
      try {
        user = await client.service<MeResponse>("user", "/users/me");
      } catch (error) {
        // A cached state file is not proof that the token is still valid. Keep the
        // offline fallback for transient outages, but never hide auth failures.
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
          throw error;
        }
      }

      const name =
        user?.full_name ||
        [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
        null;

      const payload = {
        userId: user?.id ?? state.userId ?? null,
        email: user?.email ?? state.userEmail ?? null,
        name,
        clubId: state.clubId ?? user?.main_club_id ?? null,
        environment: state.environment,
        gatewayBaseUrl: state.gatewayBaseUrl,
        stateFile: STATE_FILE,
      };

      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(
        `User:     ${payload.name ?? payload.userId ?? "?"} <${payload.email ?? "?"}>`,
      );
      console.log(`Club:     ${payload.clubId ?? "—"}`);
      console.log(`Umgebung: ${payload.environment}`);
      console.log(`Gateway:  ${payload.gatewayBaseUrl}`);
      console.log(`State:    ${payload.stateFile}`);
    });
}
