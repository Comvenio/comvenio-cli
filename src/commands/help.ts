import type { CAC } from "cac";

import { resolveCliLang } from "../errors.ts";
import { help } from "../help/help.ts";

type Options = { json?: boolean };

/** Terminal width: COLUMNS, then the TTY, otherwise 80. */
export function terminalWidth(): number {
  const fromEnv = Number.parseInt(process.env.COLUMNS ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return process.stdout.columns ?? 80;
}

/**
 * `comvenio help [thema|fehler <code>|suche <text>]` — the customer
 * documentation, embedded in the program, offline and without sign-in
 * (03-programm-hilfe). `--lang de|en` or LANG choose the language.
 */
export function registerHelpCommand(cli: CAC): void {
  cli
    .command("help [topic] [...argument]", "Hilfe offline: Themen, Fehlercodes (help fehler <CODE>), Suche (help suche <text>)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action((topic: string | undefined, argument: string[], options: Options) => {
      const lang = resolveCliLang(process.argv.slice(2), process.env);
      const result = help(topic, argument.length > 0 ? argument.join(" ") : undefined, lang, terminalWidth());
      const text = options.json ? JSON.stringify(result.json, null, 2) : result.text;
      if (result.exitCode === 0) console.log(text);
      else console.error(text);
      process.exitCode = result.exitCode;
    });
}
