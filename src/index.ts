#!/usr/bin/env bun
import { cac } from "cac";
import {
  AuthError,
  writeState,
  clearState,
  STATE_FILE,
} from "./auth.ts";
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
import pkg from "../package.json" with { type: "json" };

// --env → gateway base. Default prod. local note: the gateway routing does NOT
// run locally; "local" is only relevant for backend devs (Lastenheft § 4).
const GATEWAY_BY_ENV: Record<string, string> = {
  prod: "https://api.comvenio.app",
  dev: "https://apidev.comvenio.app",
  local: "http://localhost",
};

const cli = cac("comvenio");

type LoginOpts = {
  token?: string;
  env: string;
  club?: string;
  gateway?: string;
  json?: boolean;
};

cli
  .command("login", "Device-Token speichern (cvn_...)")
  .option("--token <token>", "Opakes Device-Token (cvn_...)")
  .option("--env <env>", "prod | dev | local", { default: "prod" })
  .option("--club <id>", "Club-ID (sonst aus /users/me abgeleitet)")
  .option("--gateway <url>", "Gateway-Basis ueberschreiben")
  .option("--json", "JSON-Ausgabe (maschinenlesbar)")
  .action(async (o: LoginOpts) => {
    if (!o.token || !o.token.startsWith("cvn_")) {
      throw new AuthError(
        'Ungueltiges Token: muss mit "cvn_" beginnen. In der Web-App unter "CLI-Zugriff" erzeugen.',
      );
    }
    const gatewayBaseUrl = (
      o.gateway ??
      GATEWAY_BY_ENV[o.env] ??
      GATEWAY_BY_ENV.prod!
    ).replace(/\/+$/, "");

    // Verify the token via /users/me BEFORE persisting — a 401 here means the
    // server does not know the token, so we never write a "logged in" state
    // with a junk token (Lastenheft TC-03, Anti-Pattern).
    const probe = createClient({ token: o.token, gatewayBaseUrl });
    const me = await probe.service<{
      id?: string;
      email?: string;
      main_club_id?: string;
    }>("user", "/users/me");

    writeState({
      token: o.token,
      gatewayBaseUrl,
      environment: o.env,
      clubId: o.club ?? me?.main_club_id,
      userId: me?.id,
      userEmail: me?.email,
    });

    if (o.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            userId: me?.id ?? null,
            email: me?.email ?? null,
            clubId: o.club ?? me?.main_club_id ?? null,
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
      `Eingeloggt als ${me?.email ?? "?"}. State gespeichert: ${STATE_FILE}`,
    );
  });

cli
  .command("logout", "Device-Token entfernen")
  .option("--json", "JSON-Ausgabe (maschinenlesbar)")
  .action((o: { json?: boolean }) => {
    clearState();
    if (o.json) {
      console.log(JSON.stringify({ ok: true, stateFile: STATE_FILE }, null, 2));
      return;
    }
    console.log("Abgemeldet — State-File entfernt.");
  });

registerWhoamiCommand(cli);
registerClubCommands(cli);
// K4–K10: domain, KI-Gen, and self-describing commands.
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
// K11 — visuelles Review (headless render → screenshots, der Agent sieht das Ergebnis).
registerVerifyCommands(cli);
// K12 — DataShare: Vereins-Dateien laden/bereitstellen/analysieren (content-service).
registerDataCommands(cli);
// Rich-News K2 — comvenio news: Vereinsnews verfassen + apply --file (rich HTML, design_source=cli).
registerNewsCommands(cli);
// Geländeplan — comvenio plan: Pläne/Bereiche/Garnituren/Marker lesen + planen (Agent-Preview via --json).
registerPlanCommands(cli);
// Tournament-Hub — comvenio tournament: V3 participant-engine (Mannschaft/Doppel/Einzel) + Preview.
registerTournamentCommands(cli);

cli.help();
cli.version(pkg.version);

async function main() {
  try {
    cli.parse(process.argv, { run: false });
    await cli.runMatchedCommand();
  } catch (err) {
    // Errors ALWAYS go to stderr, never stdout — keeps the --json contract
    // intact for agents (D-09). Exit codes: AuthError=2, HttpError=3, else 1.
    if (err instanceof AuthError) {
      console.error(`\nAuth-Fehler: ${err.message}\n`);
      process.exit(2);
    }
    if (err instanceof HttpError) {
      const hint =
        err.status === 401
          ? "  Token ungueltig/abgelaufen — neues Token erzeugen (comvenio login)."
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
