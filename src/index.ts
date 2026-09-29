#!/usr/bin/env bun
import { cac } from "cac";
import type { OAuthScope } from "@comvenio/connector-contracts";
import {
  AuthError,
  LoginOptionError,
  aufraeumenNachFehlschlag,
  clearAllAuthState,
  clearState,
  gleichesGateway,
  readStoredState,
  removeDeviceBlock,
  STATE_FILE,
  writeConnectorLogin,
  MACHINE_CLIENT_ID_ENV,
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
import { exitCodeFor, formatCliError, resolveCliLang, toPublicError } from "./errors.ts";
import { registerWhoamiCommand } from "./commands/whoami.ts";
import { registerFinanceCommands } from "./commands/finance.ts";
import { registerAgentCommands } from "./commands/agent.ts";
import { deviceBlockRemovedNotice, deviceTokenOptionError, unmatchedCommandError } from "./commands/removed.ts";
import { registerActionCommands } from "./commands/action.ts";
import { registerHelpCommand } from "./commands/help.ts";
import pkg from "../package.json" with { type: "json" };
import { cliVersion } from "./build-info.ts";

// --env selects the API gateway. OAuth intentionally has its own CLI resource
// and never reuses the MCP audience.
const GATEWAY_BY_ENV: Record<string, string> = {
  prod: "https://api.comvenio.app",
  dev: "https://apidev.comvenio.app",
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
  env: string;
  club?: string;
  gateway?: string;
  connector?: string;
  scopes?: string;
  json?: boolean;
};

cli
  .command("login", "Sicher über OAuth bei Comvenio anmelden")
  .option("--env <env>", "prod | dev", { default: "prod" })
  .option("--club <id>", "Nicht zulässig: Der Verein wird im Comvenio-Consent ausgewählt")
  .option("--gateway <url>", "Gateway-Basis überschreiben")
  .option("--connector <url>", "MCP-Connector-Origin überschreiben")
  .option("--scopes <csv>", "OAuth-Scopes einschränken, kommasepariert (ohne: alle)")
  .option("--json", "JSON-Ausgabe (maschinenlesbar)")
  .action(async (o: LoginOpts) => {
    if (!(o.env in GATEWAY_BY_ENV)) {
      throw new LoginOptionError('Ungültige Umgebung. --env muss "prod" oder "dev" sein.');
    }

    const gatewayBaseUrl = (
      o.gateway ??
      GATEWAY_BY_ENV[o.env]!
    ).replace(/\/+$/, "");

    if (gatewayBaseUrl.startsWith("http://")) {
      throw new LoginOptionError("OAuth benötigt ein öffentliches HTTPS-Gateway.");
    }
    if (o.club) {
      throw new LoginOptionError(
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
    const runtime = oauthRuntime(gatewayBaseUrl, o.connector, requestedScopes);
    if (!o.json) {
      console.error("Browser wird für die sichere Comvenio-Anmeldung geöffnet …");
    }
    let oauthCredentials: Awaited<ReturnType<typeof loginWithOAuth>> | undefined;
    let clubId: string | undefined;
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
      writeConnectorLogin({
        gatewayBaseUrl,
        environment: o.env,
        clubId,
        connector: {
          clientId: runtime.clientId,
          resource: runtime.resource,
          scopes: [...runtime.scopes],
        },
      });
    } catch (error) {
      if (oauthCredentials) {
        await revokeOAuthCredentials(runtime, oauthCredentials).catch(() => undefined);
      }
      // NUR aufraeumen, wenn dieser Versuch etwas angelegt hat. Ein im Browser
      // abgebrochener WIEDERHOLUNGSversuch darf eine vorher funktionierende
      // Verbindung nicht abmelden. Fremdvalidierung (2026-09-21), Befund 3:
      // "der Login ist nicht transaktional".
      if (aufraeumenNachFehlschlag(Boolean(oauthCredentials), bestandVorher) === "alles") {
        clearOAuthCredentials();
        clearState();
      } else {
        console.error("Die OAuth-Anmeldung ist fehlgeschlagen; die bestehende Verbindung bleibt unverändert.");
      }
      throw error;
    }

    if (o.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            authMode: "oauth",
            // The connector grant names no person; kept for scripts reading the old shape.
            userId: null,
            email: null,
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
    console.log(`OAuth-Verbindung für Verein ${clubId} hergestellt.`);
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

// The command surface of master §0.4 (COMMAND_SURFACE in commands/removed.ts);
// login and logout are registered above.
registerWhoamiCommand(cli);
registerActionCommands(cli);
registerAgentCommands(cli);
registerFinanceCommands(cli);
registerHelpCommand(cli);

cli.option("--lang <lang>", "Sprache der Fehlermeldungen: de oder en (sonst LANG, sonst de)");
cli.help();
cli.version(cliVersion(pkg.version));

async function main() {
  try {
    const lang = resolveCliLang(process.argv.slice(2), process.env);
    // First start after the update (04 §4.4, DC-1): a stored device token is
    // dropped and named once on stderr, so --json output stays clean. A
    // machine grant never touches the state file (03 §4.5).
    if (!process.env[MACHINE_CLIENT_ID_ENV]) {
      let removed = false;
      try {
        removed = removeDeviceBlock();
      } catch {
        // Best effort: the reader ignores a device block anyway.
      }
      if (removed) console.error(deviceBlockRemovedNotice(lang));
    }
    cli.parse(process.argv, { run: false });
    // --help and --version print and end without a command.
    if (!cli.options.help && !cli.options.version) {
      // Commands outside the surface are not registered; a call fails
      // visibly with USAGE_ERROR and names the command (DC-3, DC-8).
      const unmatched = cli.matchedCommand ? null : unmatchedCommandError(cli.args);
      if (unmatched) throw unmatched;
      const deviceOption = deviceTokenOptionError(cli.matchedCommand?.name, cli.options);
      if (deviceOption) throw deviceOption;
    }
    await cli.runMatchedCommand();
  } catch (err) {
    // Errors always go to stderr so --json remains machine-readable.
    const argv = process.argv.slice(2);
    let grantedScopes: string[] = [];
    try {
      grantedScopes = readStoredState().connector?.scopes ?? [];
    } catch {
      // Without a stored sign-in the login hint simply requests all scopes.
    }
    const rendered = toPublicError(err, {
      lang: resolveCliLang(argv, process.env),
      granted_scopes: grantedScopes,
      machine_grant: Boolean(process.env[MACHINE_CLIENT_ID_ENV]),
    });
    if (process.env.COMVENIO_DEBUG === "1" && err instanceof Error && err.stack) console.error(err.stack);
    console.error(argv.includes("--json")
      ? JSON.stringify(rendered, null, 2)
      : `\n${formatCliError(rendered)}\n`);
    process.exit(exitCodeFor(err));
  }
}

main();
