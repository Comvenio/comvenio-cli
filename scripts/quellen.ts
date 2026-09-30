/**
 * Access to the neighbouring repositories of the workspace, shared by every
 * generator that reads them (gen:schema, gen:web-app-fuehrung).
 *
 * Workspace root resolution (no hard-coded absolute paths):
 *   1. process.env.COMVENIO_WORKSPACE  (if set)
 *   2. ../  relative to comvenio-cli
 *
 * Moved out of gen-schema.ts for comvenio-cli-doku 08 §4.1: the web-app guide
 * reads the UI specifications in comvenio-tools the same way gen:schema reads
 * web-page — one hardened access path instead of a second one next to it
 * (08 FAQ, incident 2026-08-28 below).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Env = Readonly<Record<string, string | undefined>>;

export interface QuellOptionen {
  /** Environment to read the switches from; default `process.env`. */
  env?: Env;
}

/**
 * Umleitungen je Quell-Repositorium.
 *
 * Der Generator liest die ARBEITSBAEUME unter dem Workspace, nicht deren
 * main-Stand. Steht ein Baum auf einem fremden Zweig, schreibt ein Lauf
 * dessen Code ins Schema — und das Ergebnis sieht plausibel aus, weshalb es
 * niemand bemerkt.
 *
 * Am 2026-08-28 waere das beinahe passiert: Nach dem Merge dreier PRs meldete
 * der Lauf unveraendert 57 tote Felder, weil der ai-service auf
 * docs/data-model-wegweiser-main stand und web-page auf
 * docs/ui-spezifikationen — zehn abweichende ClubHome-Dateien, darunter
 * TickerWidget mit 116 Zeilen Unterschied. Es sah aus wie ein gescheiterter
 * Merge.
 *
 * Fuer den ai-service gab es schon einen Schalter, fuer web-page nicht.
 * Alle stehen jetzt in einer Tabelle: Ein weiteres Repositorium kostet eine
 * Zeile, und tests/schema.test.ts haelt sie gegen die Pfade, die die
 * Generatoren tatsaechlich lesen — ein Schalter auf ein Praefix, das niemand
 * nutzt, waere sonst ein Versprechen ohne Wirkung.
 */
export const QUELL_UMLEITUNGEN: ReadonlyArray<{ prefix: string; env: string }> = [
  { prefix: "Backend/Microservice-Backend/ai-service/", env: "COMVENIO_AI_SERVICE_ROOT" },
  // widget_kinds.py — a new widget kind lands in club-service and web-page together.
  { prefix: "Backend/Microservice-Backend/club-service/", env: "COMVENIO_CLUB_SERVICE_ROOT" },
  { prefix: "Frontend/web-page/", env: "COMVENIO_WEBPAGE_ROOT" },
  // UI specifications for the web-app guide (comvenio-cli-doku 08 §4.1). The
  // switch names the repository root, like COMVENIO_WEBPAGE_ROOT does.
  { prefix: "comvenio-tools/", env: "COMVENIO_TOOLS_ROOT" },
];

/** Workspace root: env override, else one level above comvenio-cli. */
export function workspaceRoot(options: QuellOptionen = {}): string {
  const env = options.env ?? process.env;
  return env.COMVENIO_WORKSPACE ? resolve(env.COMVENIO_WORKSPACE) : resolve(CLI_ROOT, "..");
}

/** The switch that redirects `relPath`, if any is set. */
function umleitung(relPath: string, env: Env): { prefix: string; env: string; wurzel: string } | null {
  for (const eintrag of QUELL_UMLEITUNGEN) {
    const wurzel = env[eintrag.env];
    if (wurzel && relPath.startsWith(eintrag.prefix)) return { ...eintrag, wurzel };
  }
  return null;
}

/**
 * Resolve a workspace-relative path (file or directory) to an absolute one, or
 * throw an error that names the expected location and the switches.
 */
export function resolveSource(relPath: string, options: QuellOptionen = {}): string {
  const env = options.env ?? process.env;
  const workspace = workspaceRoot(options);
  const treffer = umleitung(relPath, env);
  const abs = treffer
    ? join(resolve(treffer.wurzel), relPath.slice(treffer.prefix.length))
    : join(workspace, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `Quelle nicht gefunden: ${relPath}\n` +
        `  erwartet unter: ${abs}\n` +
        `  Workspace-Root: ${workspace}\n` +
        `  Fuer isolierte Worktrees: COMVENIO_WORKSPACE, oder je Repositorium ` +
        QUELL_UMLEITUNGEN.map((u) => u.env).join(" / ") + ".",
    );
  }
  return abs;
}

/** Resolve a workspace-relative path and read it, or throw a clear error. */
export function readSource(relPath: string, options: QuellOptionen = {}): string {
  return readFileSync(resolveSource(relPath, options), "utf8");
}
