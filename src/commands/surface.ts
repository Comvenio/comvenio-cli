/**
 * The command surface of the CLI after the device-token removal
 * (geraetetoken-abbau master §0.4). `comvenio --help` registers exactly these
 * top-level commands, `comvenio help` lists them; everything else ends with
 * USAGE_ERROR (04-cli-token-pfad-entfernen DC-3).
 */
export const COMMAND_SURFACE = [
  { command: "login", usage: { de: "login [--scopes <liste>]", en: "login [--scopes <list>]" } },
  { command: "logout", usage: { de: "logout", en: "logout" } },
  { command: "whoami", usage: { de: "whoami", en: "whoami" } },
  { command: "action", usage: { de: "action list|call|confirm", en: "action list|call|confirm" } },
  { command: "agent", usage: { de: "agent chat <nachricht>", en: "agent chat <message>" } },
  { command: "finance", usage: { de: "finance <aktion>", en: "finance <action>" } },
  { command: "help", usage: { de: "help [thema]", en: "help [topic]" } },
] as const;

export const SURFACE_COMMANDS: readonly string[] = COMMAND_SURFACE.map((entry) => entry.command);
