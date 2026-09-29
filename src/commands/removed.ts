import { PublicCliError } from "../errors.ts";

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
  automation:
    "Automationen verwaltest du in der Web-App unter „Automatisierungen“: "
    + "„Meine Automatisierungen“ für deine eigenen, „Admin-Automatisierungen“ für die des Vereins.",
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
 * The removed top-level command of a call that matched no command, from the
 * positional arguments cac parsed (`agent approval` is handled by `agent`).
 */
export function removedTopLevelCommand(args: readonly string[]): RemovedCommand | null {
  const head = args[0];
  return head === "function" || head === "automation" ? head : null;
}
