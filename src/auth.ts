import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  clearOAuthCredentials,
  loadOAuthCredentials,
  saveOAuthCredentials,
  type OAuthCredentials,
} from "./oauth/credential-store.ts";
import {
  oauthRuntime,
  refreshOAuthCredentials,
  type OAuthRuntime,
} from "./oauth/client.ts";

export const STATE_FILE = join(homedir(), ".comvenio-cli-state.json");
const LOGIN_HINT = 'Nicht eingeloggt. Führe "comvenio login" aus.';
const EXPIRY_SKEW_MS = 30_000;

export type StoredComvenioCliState = {
  schemaVersion: 1 | 2;
  authMode: "device_token" | "oauth";
  token?: string;
  gatewayBaseUrl: string;
  clubId?: string;
  environment: string;
  userId?: string;
  userEmail?: string;
  oauth?: {
    clientId: string;
    resource: string;
    scopes: string[];
  };
};

export type ComvenioCliState = Omit<StoredComvenioCliState, "token"> & {
  token: string;
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function parseStoredState(): StoredComvenioCliState {
  if (!existsSync(STATE_FILE)) {
    throw new AuthError(`State-File nicht gefunden: ${STATE_FILE}\n${LOGIN_HINT}`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (error) {
    throw new AuthError(`State-File ist ungültig: ${(error as Error).message}`);
  }
  if (typeof parsed.gatewayBaseUrl !== "string" || !parsed.gatewayBaseUrl) {
    throw new AuthError(`Pflichtfeld "gatewayBaseUrl" fehlt. ${LOGIN_HINT}`);
  }
  const legacyToken = typeof parsed.token === "string" ? parsed.token : undefined;
  const authMode = parsed.authMode === "oauth"
    ? "oauth"
    : "device_token";
  const oauth = parsed.oauth;
  if (
    authMode === "oauth"
    && (
      typeof oauth !== "object"
      || oauth === null
      || typeof (oauth as Record<string, unknown>).clientId !== "string"
      || typeof (oauth as Record<string, unknown>).resource !== "string"
      || !Array.isArray((oauth as Record<string, unknown>).scopes)
    )
  ) {
    throw new AuthError(`OAuth-Metadaten fehlen. ${LOGIN_HINT}`);
  }
  if (authMode === "device_token" && (!legacyToken || !legacyToken.startsWith("cvn_"))) {
    throw new AuthError(LOGIN_HINT);
  }
  return {
    schemaVersion: authMode === "oauth" ? 2 : 1,
    authMode,
    token: legacyToken,
    gatewayBaseUrl: parsed.gatewayBaseUrl.replace(/\/+$/, ""),
    clubId: typeof parsed.clubId === "string" ? parsed.clubId : undefined,
    environment: typeof parsed.environment === "string" ? parsed.environment : "prod",
    userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
    userEmail: typeof parsed.userEmail === "string" ? parsed.userEmail : undefined,
    oauth: authMode === "oauth"
      ? {
          clientId: (oauth as Record<string, unknown>).clientId as string,
          resource: (oauth as Record<string, unknown>).resource as string,
          scopes: [...((oauth as Record<string, unknown>).scopes as string[])],
        }
      : undefined,
  };
}

function runtimeForState(state: StoredComvenioCliState): OAuthRuntime {
  const connectorOrigin = state.oauth?.resource
    ? new URL(state.oauth.resource).origin
    : undefined;
  const runtime = oauthRuntime(
    state.gatewayBaseUrl,
    connectorOrigin,
    state.oauth?.scopes as OAuthRuntime["scopes"],
  );
  if (
    state.oauth?.clientId !== runtime.clientId
    || state.oauth?.resource !== runtime.resource
  ) {
    throw new AuthError("Der gespeicherte OAuth-Client passt nicht zur aktuellen Umgebung. Bitte erneut anmelden.");
  }
  return {
    ...runtime,
    scopes: state.oauth.scopes as OAuthRuntime["scopes"],
  };
}

async function resolveOAuthCredentials(
  state: StoredComvenioCliState,
): Promise<OAuthCredentials> {
  let credentials: OAuthCredentials;
  try {
    const loaded = loadOAuthCredentials();
    if (!loaded) throw new Error("kein Credential-Eintrag");
    credentials = loaded;
  } catch (error) {
    throw new AuthError(`OAuth-Credentials fehlen oder sind nicht lesbar: ${(error as Error).message}`);
  }
  const runtime = runtimeForState(state);
  try {
    if (credentials.accessExpiresAt <= Date.now() + EXPIRY_SKEW_MS) {
      credentials = await refreshOAuthCredentials(runtime, credentials);
    }
    saveOAuthCredentials(credentials);
    return credentials;
  } catch (firstError) {
    try {
      credentials = await refreshOAuthCredentials(runtime, credentials);
      saveOAuthCredentials(credentials);
      return credentials;
    } catch {
      throw new AuthError(
        `Die OAuth-Sitzung ist abgelaufen oder wurde widerrufen. Bitte erneut anmelden. (${(firstError as Error).message})`,
      );
    }
  }
}

export async function loadState(): Promise<ComvenioCliState> {
  const state = parseStoredState();
  if (state.authMode === "device_token") {
    return { ...state, token: state.token as string };
  }
  const credentials = await resolveOAuthCredentials(state);
  return { ...state, token: credentials.accessToken };
}

export function readStoredState(): StoredComvenioCliState {
  return parseStoredState();
}

export function writeState(state: StoredComvenioCliState): void {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (value !== undefined) clean[key] = value;
  }
  writeFileSync(STATE_FILE, JSON.stringify(clean, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") chmodSync(STATE_FILE, 0o600);
}

export function writeOAuthState(
  state: Omit<StoredComvenioCliState, "schemaVersion" | "authMode" | "token">,
): void {
  const serializable = {
    ...state,
    schemaVersion: 2 as const,
    authMode: "oauth" as const,
  };
  const encoded = JSON.stringify(serializable, null, 2);
  if (/access[_T]oken|refresh[_T]oken|actor[_T]oken|cvn_/u.test(encoded)) {
    throw new AuthError("OAuth-Secrets dürfen nicht im CLI-State gespeichert werden.");
  }
  writeFileSync(STATE_FILE, encoded, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") chmodSync(STATE_FILE, 0o600);
}

export function clearState(): void {
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
}

export function clearAllAuthState(): void {
  let credentialError: unknown;
  try {
    clearOAuthCredentials();
  } catch (error) {
    credentialError = error;
  } finally {
    clearState();
  }
  if (credentialError) throw credentialError;
}
