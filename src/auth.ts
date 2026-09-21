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
  let credentials: OAuthCredentials | null = null;
  try {
    credentials = await resolveOAuthCredentials(state);
  } catch (error) {
    // Ein abgelaufener oder widerrufener Grant ist kein Grund, die
    // klassischen Befehle mitzureissen. Vorher warf diese Zeile, BEVOR der
    // vorhandene Geraete-Token zurueckgegeben wurde — damit blieb der
    // urspruengliche Fehler fuer genau den Fall bestehen, der ihn am
    // haeufigsten ausloest. Fremdvalidierung Runde 1 (2026-09-21), Befund 1.
    if (!deviceToken) throw error;
  }
  return {
    ...state,
    // Ohne Geraete-Token bleibt der OAuth-Token im Feld — `createClient`
    // lehnt ihn dann mit einer Meldung ab, die den Weg nennt, statt dass
    // hier schon eine Ausnahme fliegt und `comvenio action` mitreisst.
    token: deviceToken ?? credentials!.accessToken,
    ...(credentials ? { connectorToken: credentials.accessToken } : {}),
    hasDeviceToken: deviceToken !== null,
  };
}

/**
 * Der Geraete-Token aus der bestehenden Datei — oder null.
 *
 * Bewusst tolerant: Beim OAuth-Schreiben darf eine unlesbare oder fehlende
 * Datei den Vorgang nicht aufhalten. Dann gibt es eben keinen zu erhalten.
 */
function bestehenderGeraeteToken(gatewayBaseUrl: string): string | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, unknown>;
    if (typeof parsed.token !== "string" || !parsed.token.startsWith("cvn_")) return null;
    // Anderes Gateway heisst anderer Aussteller: Der Token wird nicht
    // mitgenommen, sondern fallengelassen.
    const bisher = typeof parsed.gatewayBaseUrl === "string" ? parsed.gatewayBaseUrl.replace(/\/+$/u, "") : null;
    return bisher === gatewayBaseUrl.replace(/\/+$/u, "") ? parsed.token : null;
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
export function readOAuthConnectorState(gatewayBaseUrl: string): StoredComvenioCliState["oauth"] {
  if (!existsSync(STATE_FILE)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, unknown>;
    if (parsed.authMode !== "oauth") return undefined;
    // Ein Geraete-Login gegen ein ANDERES Gateway darf die alten
    // OAuth-Metadaten nicht mitschleppen: `runtimeForState` verwirft die
    // Kombination spaeter und blockiert dann jeden Befehl.
    const bisher = typeof parsed.gatewayBaseUrl === "string" ? parsed.gatewayBaseUrl.replace(/\/+$/u, "") : null;
    if (bisher !== gatewayBaseUrl.replace(/\/+$/u, "")) return undefined;
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

/**
 * Der reine Geraete-Stand der bestehenden Datei — zum Zuruecklegen, wenn ein
 * OAuth-Anmeldeversuch scheitert.
 *
 * Gibt nur zurueck, was ohne OAuth traegt: Token, Gateway, Umgebung und die
 * Kennungen. Die OAuth-Metadaten bleiben bewusst draussen, denn der Versuch
 * ist ja gescheitert und die Credentials sind entfernt.
 */
export function vorherigerGeraeteStand(): StoredComvenioCliState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, unknown>;
    const token = typeof parsed.token === "string" && parsed.token.startsWith("cvn_") ? parsed.token : null;
    if (!token || typeof parsed.gatewayBaseUrl !== "string") return null;
    return {
      schemaVersion: 1,
      authMode: "device_token",
      token,
      gatewayBaseUrl: parsed.gatewayBaseUrl,
      environment: typeof parsed.environment === "string" ? parsed.environment : "prod",
      clubId: typeof parsed.clubId === "string" ? parsed.clubId : undefined,
      userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
      userEmail: typeof parsed.userEmail === "string" ? parsed.userEmail : undefined,
      oauth: undefined,
    };
  } catch {
    return null;
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
  // Der Geraete-Token gehoert zu DEM Gateway, an dem er ausgestellt wurde.
  // Ohne diese Bindung haette eine OAuth-Anmeldung gegen ein anderes
  // `--gateway` den alten Token dorthin mitgenommen und im
  // Authorization-Header an einen fremden Ursprung gesendet.
  // Fremdvalidierung Runde 1 (2026-09-21), Befund 3.
  const uebernommen = bestehenderGeraeteToken(state.gatewayBaseUrl);
  const serializable = {
    ...state,
    schemaVersion: 2 as const,
    authMode: "oauth" as const,
    ...(uebernommen ? { token: uebernommen } : {}),
  };
  // Die Pruefung galt frueher auch dem Geraete-Token (`cvn_`) und machte das
  // Nebeneinander unmoeglich; sie bleibt scharf gegen OAuth-Secrets — die
  // gehoeren in den Credential-Store des Betriebssystems, nie in diese Datei.
  //
  // Sie prueft jetzt die STRUKTUR statt den Text. Die alte Regex war
  // case-sensitive und kannte drei Schreibweisen: `AccessToken`,
  // `access-token` oder `bearerToken` gingen durch, und ein verschachteltes
  // `oauth.token: "cvn_…"` erfuellte den Texttreffer fuer das erlaubte Feld.
  // Fremdvalidierung Runde 1 (2026-09-21), Befund 4.
  const erlaubteFelder = new Set(["schemaVersion", "authMode", "token", "gatewayBaseUrl", "clubId", "environment", "userId", "userEmail", "oauth"]);
  const verbotenerName = /(?:access|refresh|actor|bearer|id|session)[-_]?token|secret|password|credential/iu;
  function pruefeKnoten(wert: unknown, pfad: string): void {
    if (Array.isArray(wert)) { wert.forEach((eintrag, i) => pruefeKnoten(eintrag, `${pfad}[${i}]`)); return; }
    if (wert === null || typeof wert !== "object") {
      if (typeof wert === "string" && wert.startsWith("cvn_") && pfad !== "token") {
        throw new AuthError("Ein Geräte-Token darf nur im Feld „token“ stehen.");
      }
      return;
    }
    for (const [name, eintrag] of Object.entries(wert as Record<string, unknown>)) {
      const kind = pfad ? `${pfad}.${name}` : name;
      if (verbotenerName.test(name) && kind !== "token") {
        throw new AuthError(`OAuth-Secrets dürfen nicht im CLI-State gespeichert werden (Feld „${kind}“).`);
      }
      if (!pfad && !erlaubteFelder.has(name)) {
        throw new AuthError(`Unbekanntes Feld „${name}“ im CLI-State — es könnte ein Secret tragen.`);
      }
      pruefeKnoten(eintrag, kind);
    }
  }
  pruefeKnoten(serializable, "");
  const encoded = JSON.stringify(serializable, null, 2);
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
  // Ob überhaupt etwas zu löschen ist, entscheidet sich VOR dem Versuch.
  // `clearOAuthCredentials` wirft auch dann, wenn es nichts zu entfernen gibt
  // — unter Windows scheitert `Remove-Item` schon am fehlenden Ordner, trotz
  // `-ErrorAction SilentlyContinue`. Ohne diese Unterscheidung hätte die
  // Reparatur von Befund 5 jeden Logout ohne OAuth-Anmeldung zerschossen:
  // ein neuer Fehler aus der Behebung eines alten.
  let hatteCredentials: boolean;
  try {
    hatteCredentials = loadOAuthCredentials() !== null;
  } catch {
    // Unlesbar heisst: vorhanden, aber kaputt — also gibt es etwas zu räumen.
    hatteCredentials = true;
  }
  try {
    clearOAuthCredentials();
  } catch (error) {
    if (!hatteCredentials) {
      // Nichts da, nichts verloren.
      clearState();
      return;
    }
    // Die Zustandsdatei bleibt stehen, wenn das Secret NICHT weg ist: Sie
    // traegt die Metadaten, die ein zweiter Versuch zum Loeschen und
    // Widerrufen braucht. Vorher loeschte das `finally` sie in jedem Fall —
    // das Secret blieb im Betriebssystem, und der Weg dorthin war weg.
    // Fremdvalidierung Runde 1 (2026-09-21), Befund 5.
    throw new AuthError(
      "Die OAuth-Credentials konnten nicht entfernt werden; die Anmeldung bleibt bestehen, "
      + `damit „comvenio logout“ es erneut versuchen kann. Ursache: ${(error as Error).message}`,
    );
  }
  clearState();
}
