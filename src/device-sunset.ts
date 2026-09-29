// Warning line for the last CLI versions with a device token
// (geraetetoken-abbau-05 §4.6, D-GTA-08, D-GTA-13).
//
// Every call that runs with a stored device token writes one line to stderr
// naming the end of the deadline. The date comes from
// GET /user/users/me/api-tokens/status and is kept for one day in the state
// file. The line is best effort: it never delays a command by more than the
// short timeout below and never turns into an error.

import { MACHINE_CLIENT_ID_ENV, readStoredState, rememberDeviceSunset, type StoredComvenioCliState } from "./auth.ts";

const CACHE_MS = 24 * 60 * 60 * 1_000;
const STATUS_TIMEOUT_MS = 3_000;
// Commands that manage the sign-in itself or only print local text.
const SKIPPED_COMMANDS = new Set(["login", "logout", "help", "version"]);

export type SunsetDeps = {
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  readState?: () => StoredComvenioCliState;
  remember?: (sunsetAt: string, checkedAt: string) => void;
  fetchSunset?: (state: StoredComvenioCliState) => Promise<string | null>;
  write?: (line: string) => void;
};

/** TT.MM.JJJJ in UTC, like the web app (05 §5). */
export function formatSunsetDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function sunsetWarningLine(iso: string, lang: "de" | "en"): string {
  const date = formatSunsetDate(iso);
  return lang === "en"
    ? `Your device token expires on ${date} — switch to comvenio login.`
    : `Dein Geräte-Token läuft am ${date} aus — stell auf comvenio login um.`;
}

async function fetchSunsetFromStatus(state: StoredComvenioCliState): Promise<string | null> {
  if (!state.device) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(`${state.gatewayBaseUrl}/user/users/me/api-tokens/status`, {
      headers: { Authorization: `Bearer ${state.device.token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json() as { sunset_at?: unknown };
    return typeof body.sunset_at === "string" && !Number.isNaN(Date.parse(body.sunset_at)) ? body.sunset_at : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function warnDeviceTokenSunset(
  command: string | undefined,
  lang: "de" | "en",
  deps: SunsetDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  try {
    // A machine grant never uses the stored device token (03 §4.5).
    if (env[MACHINE_CLIENT_ID_ENV]) return;
    if (command && SKIPPED_COMMANDS.has(command)) return;
    const state = (deps.readState ?? readStoredState)();
    const device = state.device;
    if (!device) return;
    let sunsetAt = device.sunsetAt ?? null;
    const checkedAt = device.sunsetCheckedAt ? Date.parse(device.sunsetCheckedAt) : Number.NaN;
    if (!sunsetAt || Number.isNaN(checkedAt) || now.getTime() - checkedAt > CACHE_MS) {
      const fresh = await (deps.fetchSunset ?? fetchSunsetFromStatus)(state);
      if (fresh) {
        sunsetAt = fresh;
        (deps.remember ?? rememberDeviceSunset)(fresh, now.toISOString());
      }
    }
    if (!sunsetAt) return;
    (deps.write ?? ((line: string) => process.stderr.write(line)))(`${sunsetWarningLine(sunsetAt, lang)}\n`);
  } catch {
    // Best effort: without a readable state or status there is no line.
  }
}
