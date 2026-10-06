import { LoginOptionError } from "../auth.ts";
import { PublicCliError } from "../errors.ts";

export { COMMAND_SURFACE, SURFACE_COMMANDS } from "./surface.ts";

/**
 * Commands the CLI no longer carries (Geräte-Token-Abbau K2, D-GTA-03). They
 * are not registered; a call answers with USAGE_ERROR and names the place in
 * the web app instead of exiting silently (DC-3, rule from D-DOK-11).
 */
export const REMOVED_COMMANDS = {
  "agent approval":
    "Freigaben liest und entscheidest du in der Web-App unter „Mein Agent“, Spur „Braucht dich“ — "
    + "oder direkt über den Link, den „comvenio agent chat“ zu jeder Freigabe nennt.",
  function:
    "Funktionen des Club-Agenten findest du in der Web-App im Admin-Reiter „Fähigkeiten & Routinen“. "
    + "Aus dem Terminal sprichst du mit dem Club-Agenten über „comvenio agent chat“.",
  // automatisierungen-07 (D16): automations run over the connector actions cai.club.16–25.
  automation:
    "Automatisierungen steuerst du über die Actions „cai.club.16.automation_list“ bis "
    + "„cai.club.25.automation_delete“ („comvenio action list“, ausgeführt mit „comvenio action call“) "
    + "oder in der Web-App unter „Meine Automatisierungen“ und „Admin-Automatisierungen“.",
} as const;

export type RemovedCommand = keyof typeof REMOVED_COMMANDS;

export function removedCommandError(command: RemovedCommand): PublicCliError {
  return new PublicCliError(
    "USAGE_ERROR",
    `„comvenio ${command}“ gibt es im CLI nicht mehr.`,
    { detail: `„comvenio ${command}“ gibt es im CLI nicht mehr. ${REMOVED_COMMANDS[command]}` },
  );
}

/**
 * The classic top-level commands that ran over the legacy client with a
 * device token (04-cli-token-pfad-entfernen §4.2). Their work runs over the
 * connector actions now; a call names the command and points there.
 */
export const CLASSIC_COMMANDS = [
  "booking", "club", "data", "event", "homepage", "ingredient", "ingredient-category",
  "meeting", "member", "menu", "news", "object", "plan", "recipe", "role", "schema",
  "shopping", "sponsor", "task", "task-zones", "team", "teams", "template", "tournament", "verify",
  "weekly-preview", "zone",
] as const;

const CLASSIC = new Set<string>(CLASSIC_COMMANDS);

const ACTION_HINT =
  "„comvenio action list“ zeigt die Actions, die deine Anmeldung freigibt; "
  + "ausgeführt wird mit „comvenio action call <action-id> --input '{…}'“. "
  + "Was es als Action nicht gibt, erledigst du in der Web-App.";

/**
 * USAGE_ERROR for a top-level command outside the command surface. Never
 * forwards to an action: a script calling an old command must fail visibly
 * and name it (DC-3, DC-8).
 */
export function unknownCommandError(command: string): PublicCliError {
  const sentence = CLASSIC.has(command)
    ? `„comvenio ${command}“ gibt es im CLI nicht mehr.`
    : `„comvenio ${command}“ ist kein Befehl des CLI.`;
  return new PublicCliError("USAGE_ERROR", sentence, { detail: `${sentence} ${ACTION_HINT}` });
}

/**
 * The error for a call that matched no registered command, from the
 * positional arguments cac parsed, or null when there is nothing to reject
 * (no positional argument, e.g. `comvenio --help`). `agent approval` is
 * handled by `agent`.
 */
export function unmatchedCommandError(args: readonly string[]): PublicCliError | null {
  const head = args[0];
  if (!head) return null;
  if (head === "function" || head === "automation") return removedCommandError(head);
  return unknownCommandError(head);
}

export const DEVICE_TOKEN_GONE =
  "Geräte-Token gibt es nicht mehr — melde dich mit „comvenio login“ im Browser an. "
  + "Für Skripte und CI legt ein Vereinsadmin einen Maschinen-Grant an "
  + "(COMVENIO_CLIENT_ID und COMVENIO_CLIENT_SECRET).";

/**
 * `login --device-token` and its old alias `--token` are gone (§4.1, DC-3).
 * cac keeps unknown options in the parsed options, so the check runs on them
 * before the command; returns null when neither option was given.
 */
export function deviceTokenOptionError(
  command: string | undefined,
  options: Record<string, unknown>,
): LoginOptionError | null {
  if (command !== "login") return null;
  return "deviceToken" in options || "token" in options ? new LoginOptionError(DEVICE_TOKEN_GONE) : null;
}

/** The one-time line after a stored device token was dropped (DC-1). */
export function deviceBlockRemovedNotice(lang: "de" | "en"): string {
  return lang === "en"
    ? "Device tokens are no longer supported — sign in with comvenio login."
    : "Geräte-Token werden nicht mehr unterstützt — melde dich mit comvenio login an.";
}
