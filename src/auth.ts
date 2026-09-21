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
  /**
   * Der Token fuer die klassischen Befehle. Das ist der Geraete-Token
   * (`cvn_…`), solange einer vorliegt — auch nach einer OAuth-Anmeldung.
   */
  token: string;
  /**
   * Der OAuth-Access-Token des Connectors, wenn per OAuth verbunden. Nur
   * `comvenio action` benutzt ihn; er geht NIE an die Fachdienste.
   */
  connectorToken?: string;
  /** true, wenn `token` ein echter Geraete-Token ist und kein Ersatz. */
  hasDeviceToken: boolean;
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

/**
 * Der Zustand fuer den aufrufenden Befehl.
 *
 * Bis zum 2026-09-21 schlossen die beiden Anmeldewege einander aus: Wer sich
 * per OAuth verband, verlor seinen Geraete-Token und damit ALLE klassischen
 * Befehle — `createClient` warf, nur `comvenio action` lief noch. Ursache war
 * nicht der Vertrag, sondern eine gemeinsame Zustandsdatei mit einem einzigen
 * `authMode`.
 *
 * Jetzt tragen beide nebeneinander: `token` ist der Geraete-Token, solange
 * einer vorliegt, `connectorToken` der OAuth-Access-Token. Das verletzt
 * `03-oauth-connection-lifecycle.md` §11 nicht — der verbietet, aus OAuth
 * einen Aktor-Token FUERS CLI abzuleiten, nicht, einen unabhaengig
 * erworbenen Geraete-Token zu behalten.
 */
export async function loadState(): Promise<ComvenioCliState> {
  const state = parseStoredState();
  const deviceToken = typeof state.token === "string" && state.token.startsWith("cvn_")
    ? state.token
    : null;
  if (state.authMode === "device_token") {
    return { ...state, token: state.token as string, hasDeviceToken: true };
  }
  const credentials = await resolveOAuthCredentials(state);
  return {
    ...state,
    // Ohne Geraete-Token bleibt der OAuth-Token im Feld — `createClient`
    // lehnt ihn dann mit einer Meldung ab, die den Weg nennt, statt dass
    // hier schon eine Ausnahme fliegt und `comvenio action` mitreisst.
    token: deviceToken ?? credentials.accessToken,
    connectorToken: credentials.accessToken,
    hasDeviceToken: deviceToken !== null,
  };
}

/**
 * Der Geraete-Token aus der bestehenden Datei — oder null.
 *
 * Bewusst tolerant: Beim OAuth-Schreiben darf eine unlesbare oder fehlende
 * Datei den Vorgang nicht aufhalten. Dann gibt es eben keinen zu erhalten.
 */
function bestehenderGeraeteToken(): string | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, unknown>;
    return typeof parsed.token === "string" && parsed.token.startsWith("cvn_") ? parsed.token : null;
  } catch {
    return null;
  }
}

/**
 * Die OAuth-Metadaten der bestehenden Anmeldung — oder undefined.
 *
 * Nur die Metadaten (Client, Resource, Scopes); die Tokens selbst liegen im
 * Credential-Store des Betriebssystems und werden hier nie angefasst. Ein
 * Geraete-Login benutzt das, um eine bestehende Connector-Verbindung
 * stehenzulassen, statt sie zu loeschen.
 */
export function readOAuthConnectorState(): StoredComvenioCliState["oauth"] {
  if (!existsSync(STATE_FILE)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, unknown>;
    if (parsed.authMode !== "oauth") return undefined;
    const oauth = parsed.oauth as Record<string, unknown> | undefined;
    if (!oauth || typeof oauth.clientId !== "string" || typeof oauth.resource !== "string" || !Array.isArray(oauth.scopes)) {
      return undefined;
    }
    // Ohne gueltige Credentials im Store ist die Verbindung nur noch eine
    // Karteileiche — dann wird sie nicht kuenstlich am Leben gehalten.
    if (!loadOAuthCredentials()) return undefined;
    return { clientId: oauth.clientId, resource: oauth.resource, scopes: [...(oauth.scopes as string[])] };
  } catch {
    return undefined;
  }
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
  // Einen vorhandenen Geraete-Token behalten: Eine OAuth-Anmeldung ist ein
  // ZUSATZ, kein Ersatz. Vorher loeschte dieses Schreiben ihn mit, und das
  // CLI verlor seine 26 klassischen Befehlsgruppen.
  const serializable = {
    ...state,
    schemaVersion: 2 as const,
    authMode: "oauth" as const,
    ...(bestehenderGeraeteToken() ? { token: bestehenderGeraeteToken() } : {}),
  };
  const encoded = JSON.stringify(serializable, null, 2);
  // Die Pruefung galt auch dem Geraete-Token (`cvn_`) und machte damit das
  // Nebeneinander unmoeglich. Sie bleibt scharf gegen OAuth-Secrets — die
  // gehoeren in den Credential-Store des Betriebssystems, nie in diese Datei.
  if (/access[_T]oken|refresh[_T]oken|actor[_T]oken/u.test(encoded)) {
    throw new AuthError("OAuth-Secrets dürfen nicht im CLI-State gespeichert werden.");
  }
  // Genau EIN `cvn_` ist erlaubt, und nur als Wert von `token`.
  const geraeteTokenStellen = encoded.match(/cvn_/gu)?.length ?? 0;
  if (geraeteTokenStellen > 1 || (geraeteTokenStellen === 1 && !/"token":\s*"cvn_/u.test(encoded))) {
    throw new AuthError("Ein Geräte-Token darf nur im Feld „token“ stehen.");
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
