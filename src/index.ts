#!/usr/bin/env bun
import { cac } from "cac";
import type { OAuthScope } from "@comvenio/connector-contracts";
import {
  AuthError,
  clearAllAuthState,
  clearState,
  readStoredState,
  STATE_FILE,
  writeOAuthState,
  writeState,
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
import { registerEventCommands } from "./commands/event.ts";
import { registerBookingCommands } from "./commands/booking.ts";
import { registerObjectCommands } from "./commands/object.ts";
import { registerTaskCommands } from "./commands/task.ts";
import { registerRecipeCommands } from "./commands/recipe.ts";
import { registerTemplateCommands } from "./commands/template.ts";
import { registerMenuCommands } from "./commands/menu.ts";
import { registerMeetingCommands } from "./commands/meeting.ts";
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
import { registerActionCommands } from "./commands/action.ts";
import pkg from "../package.json" with { type: "json" };

// --env selects the API gateway. OAuth intentionally has its own CLI resource
// and never reuses the MCP audience.
const GATEWAY_BY_ENV: Record<string, string> = {
  prod: "https://api.comvenio.app",
  dev: "https://apidev.comvenio.app",
  local: "http://localhost",
};

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
      clearOAuthCredentials();
      writeState({
        schemaVersion: 1,
        authMode: "device_token",
        token: deviceToken,
        gatewayBaseUrl,
        environment: o.env,
        clubId,
        userId,
        userEmail,
        oauth: undefined,
      });
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
      const requestedScopes = o.scopes
        ? o.scopes.split(/[,\s]+/u).map((value) => value.trim()).filter(Boolean) as OAuthScope[]
        : undefined;
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
        writeOAuthState({
          gatewayBaseUrl,
          environment: o.env,
          clubId,
          oauth: {
            clientId: runtime.clientId,
            resource: runtime.resource,
            scopes: [...runtime.scopes],
          },
        });
      } catch (error) {
        if (oauthCredentials) {
          await revokeOAuthCredentials(runtime, oauthCredentials).catch(() => undefined);
        }
        clearOAuthCredentials();
        clearState();
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
      if (stored.authMode === "oauth") {
        const credentials = loadOAuthCredentials();
        if (credentials) {
          try {
            await revokeOAuthCredentials(
              oauthRuntime(
                stored.gatewayBaseUrl,
                stored.oauth?.resource
                  ? new URL(stored.oauth.resource).origin
                  : undefined,
                stored.oauth?.scopes as OAuthScope[] | undefined,
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
registerEventCommands(cli);
registerBookingCommands(cli);
registerObjectCommands(cli);
registerTaskCommands(cli);
registerRecipeCommands(cli);
registerTemplateCommands(cli);
registerMenuCommands(cli);
registerMeetingCommands(cli);
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
registerShoppingCommands(cli);
registerRoleCommands(cli);
registerAgentCommands(cli);
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
