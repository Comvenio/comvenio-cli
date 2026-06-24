// State-File + Auth for the comvenio CLI.
// Vorbild: rts-cli/src/auth.ts — BUT the token here is an OPAQUE device token
// (cvn_...), not a JWT. We never decode it; the server validates expiry (D-08).
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const STATE_FILE = join(homedir(), ".comvenio-cli-state.json");
const LOGIN_HINT = 'Nicht eingeloggt. Fuehre "comvenio login --token cvn_..." aus.';

export type ComvenioCliState = {
  token: string; // opaque, starts with "cvn_" — NOT a JWT, never decoded
  gatewayBaseUrl: string; // e.g. "https://api.comvenio.app"
  clubId?: string;
  environment: string; // "prod" | "dev" | "local"
  userId?: string;
  userEmail?: string;
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Read + validate ~/.comvenio-cli-state.json. Throws AuthError with a login
 * hint when the file is missing, malformed, or missing required fields.
 * NO JWT-expiry check — the token is opaque, the server checks validity.
 */
export function loadState(): ComvenioCliState {
  if (!existsSync(STATE_FILE)) {
    throw new AuthError(`State-File nicht gefunden: ${STATE_FILE}\n${LOGIN_HINT}`);
  }

  let raw: string;
  try {
    raw = readFileSync(STATE_FILE, "utf8");
  } catch (err) {
    throw new AuthError(
      `State-File konnte nicht gelesen werden: ${(err as Error).message}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AuthError(
      `State-File ist kein gueltiges JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed.token !== "string" || !parsed.token) {
    throw new AuthError(LOGIN_HINT);
  }
  if (typeof parsed.gatewayBaseUrl !== "string" || !parsed.gatewayBaseUrl) {
    throw new AuthError(`Pflichtfeld "gatewayBaseUrl" fehlt. ${LOGIN_HINT}`);
  }

  return {
    token: parsed.token as string,
    gatewayBaseUrl: (parsed.gatewayBaseUrl as string).replace(/\/+$/, ""),
    clubId: typeof parsed.clubId === "string" ? parsed.clubId : undefined,
    environment:
      typeof parsed.environment === "string" ? parsed.environment : "prod",
    userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
    userEmail:
      typeof parsed.userEmail === "string" ? parsed.userEmail : undefined,
  };
}

/**
 * Persist a partial state with MERGE semantics: read the existing file, merge
 * the partial on top, then write. NEVER overwrite the whole file — that would
 * drop clubId/env/userId (Gotcha infrastructure.md "State-Files immer merge").
 * undefined values in `partial` are stripped so they don't clobber stored keys.
 */
export function writeState(partial: Partial<ComvenioCliState>): void {
  let current: Record<string, unknown> = {};
  if (existsSync(STATE_FILE)) {
    try {
      current = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    } catch {
      // Corrupt existing file — start fresh rather than fail the write.
      current = {};
    }
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) clean[k] = v;
  }
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ ...current, ...clean }, null, 2),
    "utf8",
  );
}

/** Remove the state file (logout). No-op if it does not exist. */
export function clearState(): void {
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
}
