#!/usr/bin/env bun
import { cac } from "cac";
import type { OAuthScope } from "@comvenio/connector-contracts";
import {
  AuthError,
  aufraeumenNachFehlschlag,
  clearAllAuthState,
  clearConnectorState,
  gleichesGateway,
  readStoredState,
  STATE_FILE,
  writeConnectorLogin,
  writeDeviceLogin,
} from "./auth.ts";
import {
  clearOAuthCredentials,
  loadOAuthCredentials,
  saveOAuthCredentials,
} from "./oauth/credential-store.ts";
import {
  loginWithOAuth,
  oauthRuntime,
  revokeOAuthCredentials,
} from "./oauth/client.ts";
import { CliConnectorClient } from "./mcp/client.ts";
import { createClient, HttpError } from "./http.ts";
import { registerWhoamiCommand } from "./commands/whoami.ts";
import { registerClubCommands } from "./commands/club.ts";
import { registerMemberCommands } from "./commands/member.ts";
import { registerTeamCommands } from "./commands/team.ts";
import { registerTeamsCommands } from "./commands/teams.ts";
import { registerEventCommands } from "./commands/event.ts";
import { registerBookingCommands } from "./commands/booking.ts";
import { registerObjectCommands } from "./commands/object.ts";
import { registerTaskCommands } from "./commands/task.ts";
import { registerRecipeCommands } from "./commands/recipe.ts";
import { registerTemplateCommands } from "./commands/template.ts";
import { registerMenuCommands } from "./commands/menu.ts";
import { registerMeetingCommands } from "./commands/meeting.ts";
import { registerFinanceCommands } from "./commands/finance.ts";
import { registerHomepageCommands } from "./commands/homepage.ts";
import { registerSchemaCommand } from "./commands/schema.ts";
import { registerVerifyCommands } from "./commands/verify.ts";
import { registerDataCommands } from "./commands/data.ts";
import { registerNewsCommands } from "./commands/news.ts";
import { registerPlanCommands } from "./commands/plan.ts";
import { registerTournamentCommands } from "./commands/tournament.ts";
import { registerSponsorCommands } from "./commands/sponsor.ts";
import { registerIngredientCommands } from "./commands/ingredient.ts";
import { registerIngredientCategoryCommands } from "./commands/ingredient-category.ts";
import { registerShoppingCommands } from "./commands/shopping.ts";
import { registerRoleCommands } from "./commands/role.ts";
import { registerAgentCommands } from "./commands/agent.ts";
import { registerFunctionCommands } from "./commands/function.ts";
import { registerActionCommands } from "./commands/action.ts";
import { registerWeeklyPreviewCommands } from "./commands/weekly-preview.ts";
import pkg from "../package.json" with { type: "json" };

// --env selects the API gateway. OAuth intentionally has its own CLI resource
// and never reuses the MCP audience.
const GATEWAY_BY_ENV: Record<string, string> = {
  prod: "https://api.comvenio.app",
  dev: "https://apidev.comvenio.app",
  local: "http://localhost",
};

/**
 * Widerruft einen Grant, der durch einen Gateway-Wechsel heimatlos wuerde.
 *
 * Ohne das bliebe er serverseitig aktiv, waehrend seine Metadaten lokal
 * verworfen werden — niemand koennte ihn danach noch zuruecknehmen. Ein
 * fehlgeschlagener Widerruf haelt die Anmeldung nicht auf; er wird gemeldet,
 * damit der Mensch ihn im Konto von Hand beenden kann.
 */
async function widerrufeVerwaistenGrant(neuesGateway: string): Promise<void> {
  let alt: ReturnType<typeof readStoredState>;
  try {
    alt = readStoredState();
  } catch {
    return;
  }
  if (!alt.connector || gleichesGateway(alt.gatewayBaseUrl, neuesGateway)) return;
  const credentials = loadOAuthCredentials();
  if (!credentials) return;
  try {
    await revokeOAuthCredentials(
      oauthRuntime(
        alt.gatewayBaseUrl,
        new URL(alt.connector.resource).origin,
        alt.connector.scopes as OAuthScope[],
      ),
      credentials,
    );
  } catch (error) {
    console.error(
      `Warnung: Der bisherige Connector-Grant an ${alt.gatewayBaseUrl} konnte nicht widerrufen werden `
      + `(${(error as Error).message}). Bitte im Comvenio-Konto beenden.`,
    );
  }
  clearOAuthCredentials();
}

const cli = cac("comvenio");

type LoginOpts = {
  token?: string;
  deviceToken?: string;
  env: string;
  club?: string;
  gateway?: string;
  connector?: string;
  scopes?: string;
  json?: boolean;
};

cli
  .command("login", "Sicher über OAuth bei Comvenio anmelden")
  .option("--device-token <token>", "Device-Token für Entwicklung/Automation (cvn_...)")
  .option("--token <token>", "Veralteter Alias für --device-token")
  .option("--env <env>", "prod | dev | local", { default: "prod" })
  .option("--club <id>", "Club-ID überschreiben (sonst aus /users/me)")
  .option("--gateway <url>", "Gateway-Basis überschreiben")
  .option("--connector <url>", "MCP-Connector-Origin überschreiben")
  .option("--scopes <csv>", "Minimale OAuth-Scopes, kommasepariert")
  .option("--json", "JSON-Ausgabe (maschinenlesbar)")
  .action(async (o: LoginOpts) => {
    if (!(o.env in GATEWAY_BY_ENV)) {
      throw new AuthError('Ungültige Umgebung. --env muss "prod", "dev" oder "local" sein.');
    }
    if (o.token && o.deviceToken && o.token !== o.deviceToken) {
      throw new AuthError("--token und --device-token dürfen nicht unterschiedliche Werte enthalten.");
    }

    const gatewayBaseUrl = (
      o.gateway ??
      GATEWAY_BY_ENV[o.env]!
    ).replace(/\/+$/, "");
    const deviceToken = o.deviceToken ?? o.token;
    let runtime: ReturnType<typeof oauthRuntime> | undefined;
    let oauthCredentials: Awaited<ReturnType<typeof loginWithOAuth>> | undefined;
    let authMode: "oauth" | "device_token";
    let clubId: string | undefined;
    let userId: string | undefined;
    let userEmail: string | undefined;

    if (deviceToken) {
      if (!deviceToken.startsWith("cvn_")) {
        throw new AuthError('Ungültiges Device-Token: Es muss mit "cvn_" beginnen.');
      }
      if (o.connector || o.scopes) {
        throw new AuthError("--connector und --scopes gelten nur für OAuth.");
      }
      authMode = "device_token";
      const probe = createClient({
        token: deviceToken,
        gatewayBaseUrl,
        authMode: "device_token",
      });
      const me = await probe.service<{
        id?: string;
        email?: string;
        main_club_id?: string;
      }>("user", "/users/me");
      clubId = o.club ?? me?.main_club_id;
      userId = me?.id;
      userEmail = me?.email;
      // Wechselt das Gateway, verliert ein bestehender Connector-Block hier
      // seine Gueltigkeit — dann wird der Grant VORHER widerrufen. Sonst
      // bliebe er serverseitig aktiv, waehrend die Metadaten zu seinem
      // Widerruf lokal verschwinden. Der Widerruf steht hier und nicht im
      // Schreibweg, weil er Netz braucht und `auth.ts` netzfrei bleibt.
      // Fremdvalidierung (2026-09-21), Befund 4.
      await widerrufeVerwaistenGrant(gatewayBaseUrl);
      // Schreibt NUR den Geraete-Block; ein bestehender Connector bleibt,
      // solange er zum selben Gateway gehoert. Bis zum 2026-09-21 loeschte
      // ein Geraete-Login die OAuth-Verbindung mit, so wie eine
      // OAuth-Anmeldung den Geraete-Token loeschte — beide Richtungen
      // desselben Fehlers, und der Grund war ein gemeinsames `authMode`.
      const { connectorBleibt } = writeDeviceLogin({
        token: deviceToken,
        gatewayBaseUrl,
        environment: o.env,
        clubId,
        userId,
        userEmail,
      });
      if (connectorBleibt) {
        // Die Antwort muss dasselbe sagen wie `whoami` danach.
        authMode = "oauth";
        console.log("Die bestehende Connector-Verbindung bleibt erhalten — „comvenio action …“ funktioniert weiter.");
      }
    } else {
      if (o.env === "local" || gatewayBaseUrl.startsWith("http://")) {
        throw new AuthError(
          "OAuth benötigt ein öffentliches HTTPS-Gateway. Verwende lokal ausschließlich --device-token.",
        );
      }
      if (o.club) {
        throw new AuthError(
          "--club ist bei OAuth nicht zulässig. Der Verein wird im Comvenio-Consent ausgewählt und serverseitig gebunden.",
        );
      }
      // Ob es vorher eine Verbindung gab, entscheidet im Fehlerfall darueber,
      // ob aufgeraeumt oder in Ruhe gelassen wird.
      const bestandVorher = Boolean((() => {
        try {
          return readStoredState().connector;
        } catch {
          return null;
        }
      })());
      const requestedScopes = o.scopes
        ? o.scopes.split(/[,\s]+/u).map((value) => value.trim()).filter(Boolean) as OAuthScope[]
        : undefined;
      await widerrufeVerwaistenGrant(gatewayBaseUrl);
      runtime = oauthRuntime(gatewayBaseUrl, o.connector, requestedScopes);
      if (!o.json) {
        console.error("Browser wird für die sichere Comvenio-Anmeldung geöffnet …");
      }
      authMode = "oauth";
      try {
        oauthCredentials = await loginWithOAuth(runtime);
        const identity = await new CliConnectorClient({
          endpoint: runtime.resource,
          access_token: oauthCredentials.accessToken,
        }).whoami();
        clubId = typeof identity.club_id === "string"
          ? identity.club_id
          : undefined;
        if (!clubId) {
          throw new AuthError(
            "Der OAuth-Grant enthält keinen eindeutig gebundenen Verein.",
          );
        }
        saveOAuthCredentials(oauthCredentials);
        const { geraetBleibt } = writeConnectorLogin({
          gatewayBaseUrl,
          environment: o.env,
          clubId,
          connector: {
            clientId: runtime.clientId,
            resource: runtime.resource,
            scopes: [...runtime.scopes],
          },
        });
        if (geraetBleibt && !o.json) {
          console.log("Dein Geräte-Token bleibt erhalten — die klassischen Befehle funktionieren weiter.");
        }
      } catch (error) {
        if (oauthCredentials) {
          await revokeOAuthCredentials(runtime, oauthCredentials).catch(() => undefined);
        }
        // NUR aufraeumen, wenn dieser Versuch etwas angelegt hat. Vorher
        // loeschte der Catch bedingungslos — ein im Browser abgebrochener
        // WIEDERHOLUNGSversuch meldete damit eine vorher funktionierende
        // Verbindung ab. Ein Login, der nichts geschrieben hat, darf nichts
        // hinterlassen und nichts wegnehmen. Fremdvalidierung (2026-09-21),
        // Befund 3: "der Login ist nicht transaktional".
        if (aufraeumenNachFehlschlag(Boolean(oauthCredentials), bestandVorher) === "alles") {
          clearOAuthCredentials();
          clearConnectorState();
        } else {
          console.error("Die OAuth-Anmeldung ist fehlgeschlagen; die bestehende Verbindung bleibt unverändert.");
        }
        throw error;
      }
    }

    if (o.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            authMode,
            userId: userId ?? null,
            email: userEmail ?? null,
            clubId: clubId ?? null,
            environment: o.env,
            stateFile: STATE_FILE,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(
      authMode === "oauth"
        ? `OAuth-Verbindung für Verein ${clubId} hergestellt.`
        : `Eingeloggt als ${userEmail ?? "?"} (Device-Token).`,
    );
  });

cli
  .command("logout", "OAuth-Sitzung widerrufen und lokale Anmeldung entfernen")
  .option("--json", "JSON-Ausgabe (maschinenlesbar)")
  .action(async (o: { json?: boolean }) => {
    let revoked = false;
    let revokeWarning: string | undefined;
    try {
      const stored = readStoredState();
      if (stored.connector) {
        const credentials = loadOAuthCredentials();
        if (credentials) {
          try {
            await revokeOAuthCredentials(
              oauthRuntime(
                stored.gatewayBaseUrl,
                stored.connector?.resource
                  ? new URL(stored.connector.resource).origin
                  : undefined,
                stored.connector?.scopes as OAuthScope[] | undefined,
              ),
              credentials,
            );
            revoked = true;
          } catch (error) {
            revokeWarning = `Serverseitiger Widerruf fehlgeschlagen: ${(error as Error).message}`;
          }
        }
      }
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
    } finally {
      clearAllAuthState();
    }

    if (o.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            revoked,
            warning: revokeWarning ?? null,
            stateFile: STATE_FILE,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (revokeWarning) console.error(`Hinweis: ${revokeWarning}`);
    console.log("Abgemeldet. OAuth-Credentials und CLI-State wurden entfernt.");
  });

registerWhoamiCommand(cli);
registerClubCommands(cli);
registerMemberCommands(cli);
registerTeamCommands(cli);
registerTeamsCommands(cli);
registerEventCommands(cli);
registerBookingCommands(cli);
registerObjectCommands(cli);
registerTaskCommands(cli);
registerRecipeCommands(cli);
registerTemplateCommands(cli);
registerMenuCommands(cli);
registerMeetingCommands(cli);
registerFinanceCommands(cli);
registerHomepageCommands(cli);
registerSchemaCommand(cli);
registerVerifyCommands(cli);
registerDataCommands(cli);
registerNewsCommands(cli);
registerPlanCommands(cli);
registerTournamentCommands(cli);
registerSponsorCommands(cli);
registerIngredientCommands(cli);
registerIngredientCategoryCommands(cli);
registerWeeklyPreviewCommands(cli);
registerShoppingCommands(cli);
registerRoleCommands(cli);
registerAgentCommands(cli);
registerFunctionCommands(cli);
registerActionCommands(cli);

cli.help();
cli.version(pkg.version);

async function main() {
  try {
    cli.parse(process.argv, { run: false });
    await cli.runMatchedCommand();
  } catch (err) {
    // Errors always go to stderr so --json remains machine-readable.
    if (err instanceof AuthError) {
      console.error(`\nAuth-Fehler: ${err.message}\n`);
      process.exit(2);
    }
    if (err instanceof HttpError) {
      const hint =
        err.status === 401
          ? '  Anmeldung ungültig oder abgelaufen. Führe "comvenio login" erneut aus.'
          : err.status === 403
            ? "  Kein Zugriff in diesem Club (serverseitige RBAC)."
            : err.status === 404
              ? "  Ressource nicht gefunden."
              : "";
      console.error(`\nAPI-Fehler: ${err.message}\n${hint}\n`);
      process.exit(3);
    }
    console.error(`\nFehler: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

main();
