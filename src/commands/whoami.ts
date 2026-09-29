import type { CAC } from "cac";
import { loadState, STATE_FILE } from "../auth.ts";
import { CliConnectorClient } from "../mcp/client.ts";

/**
 * `comvenio whoami` — the OAuth connection (or the machine grant) and what the
 * connector says about it: club, scopes, capability version.
 */
export function registerWhoamiCommand(cli: CAC): void {
  cli
    .command("whoami", "Aktuellen Login anzeigen (Name, Club, Umgebung)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (opts: { json?: boolean }) => {
      const state = await loadState();

      const connectorIdentity = await new CliConnectorClient({
        endpoint: state.oauth.resource,
        access_token: state.connectorToken,
      }).whoami();

      const payload = {
        // The connector grant names no person; kept for scripts reading the old shape.
        userId: null,
        email: null,
        name: null,
        clubId: typeof connectorIdentity.club_id === "string"
          ? connectorIdentity.club_id
          : state.clubId ?? null,
        authMode: state.authMode,
        connectorLogin: true,
        scopes: Array.isArray(connectorIdentity.scopes)
          ? connectorIdentity.scopes
          : state.oauth.scopes,
        capabilityVersion: typeof connectorIdentity.capability_version === "string"
          ? connectorIdentity.capability_version
          : null,
        // A machine grant signs in from COMVENIO_CLIENT_ID/COMVENIO_CLIENT_SECRET
        // and keeps nothing on disk — there is no state file to point at.
        machineGrant: state.machineGrant === true,
        environment: state.environment,
        gatewayBaseUrl: state.gatewayBaseUrl,
        stateFile: state.machineGrant ? null : STATE_FILE,
      };

      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(`Club:     ${payload.clubId ?? "—"}`);
      console.log(`Umgebung: ${payload.environment}`);
      console.log(`Gateway:  ${payload.gatewayBaseUrl}`);
      console.log(
        payload.machineGrant
          ? "Anmeldung: Maschinen-Grant aus COMVENIO_CLIENT_ID (nur im Speicher)"
          : `State:    ${payload.stateFile}`,
      );
    });
}
