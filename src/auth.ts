import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  clearOAuthCredentials,
  loadOAuthCredentials,
  saveOAuthCredentials,
  type OAuthCredentials,
} from "./oauth/credential-store.ts";
import {
  fetchMachineAccessToken,
  MACHINE_CLIENT_ID_PREFIX,
  MACHINE_CLIENT_SECRET_PREFIX,
  oauthRuntime,
  refreshOAuthCredentials,
  type MachineAccessToken,
  type MachineGrantCredentials,
  type OAuthRuntime,
} from "./oauth/client.ts";
import { profileSuffix } from "./profile.ts";

// Bun's os.homedir() ignores a HOME changed at runtime (Node follows it), so a
// test that redirects HOME still wrote the user's real login file. Read the
// environment first; homedir() is only the fallback.
export function stateHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || env.USERPROFILE || homedir();
}

export const STATE_FILE = join(stateHome(), `.comvenio-cli-state${profileSuffix()}.json`);
const LOGIN_HINT = 'Nicht eingeloggt. Führe "comvenio login" aus.';
const EXPIRY_SKEW_MS = 30_000;

/**
 * Die gespeicherte Anmeldung: nur noch die OAuth-Verbindung.
 *
 * Bis zum Geräte-Token-Abbau (geraetetoken-abbau-04) stand daneben ein
 * Geräte-Block mit einem `cvn_`-Token für die klassischen Befehle. Den gibt es
 * nicht mehr: Ein vorhandener Block wird beim ersten Start entfernt
 * (`removeDeviceBlock`), und der Leser beachtet ihn nicht.
 */
export type StoredComvenioCliState = {
  schemaVersion: 3;
  gatewayBaseUrl: string;
  environment: string;
  /** Die OAuth-Metadaten; die Tokens selbst liegen im Credential-Store. */
  connector: { clientId: string; resource: string; scopes: string[]; clubId?: string };
};

export type ComvenioCliState = {
  schemaVersion: 3;
  gatewayBaseUrl: string;
  environment: string;
  clubId?: string;
  /** Der OAuth-Access-Token für den Connector; geht nie an einen Fachdienst. */
  connectorToken: string;
  /** Es gibt nur noch einen Anmeldeweg; das Feld bleibt für `whoami --json`. */
  authMode: "oauth";
  oauth: { clientId: string; resource: string; scopes: string[]; clubId?: string };
  /**
   * Signed in with a machine grant from COMVENIO_CLIENT_ID and
   * COMVENIO_CLIENT_SECRET (03-maschinen-grant §4.5): the token lives only in
   * this process, nothing is read from or written to the state file or the
   * credential store.
   */
  machineGrant?: true;
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** A wrong login option (public code USAGE_ERROR); keeps the auth exit code 2. */
export class LoginOptionError extends AuthError {
  constructor(message: string) {
    super(message);
    this.name = "LoginOptionError";
  }
}

function text(wert: unknown): string | undefined {
  return typeof wert === "string" && wert.length > 0 ? wert : undefined;
}

function objekt(wert: unknown): Record<string, unknown> | null {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert)
    ? (wert as Record<string, unknown>)
    : null;
}

function leseConnector(roh: unknown): Omit<StoredComvenioCliState["connector"], "clubId"> | undefined {
  const o = objekt(roh);
  if (!o) return undefined;
  const clientId = text(o.clientId);
  const resource = text(o.resource);
  // Nicht-Strings in `scopes` fielen früher durch und landeten unverändert im
  // Runtime-Vergleich. Was kein String ist, ist kein Scope.
  const scopes = Array.isArray(o.scopes) ? o.scopes.filter((s): s is string => typeof s === "string") : null;
  if (!clientId || !resource || !scopes || scopes.length !== (o.scopes as unknown[]).length) return undefined;
  return { clientId, resource, scopes: [...scopes] };
}

/**
 * Removes the device-token part of a raw state file (04 §9, DC-1): the
 * `device` block of schema 3 and the root `cvn_` token of the old schema 1
 * together with the identity that belonged to it. Everything else — above
 * all the OAuth connection — stays as it is.
 */
export function dropDeviceBlock(state: Record<string, unknown>): { state: Record<string, unknown>; removed: boolean } {
  const rest = { ...state };
  let removed = false;
  if ("device" in rest) {
    delete rest.device;
    removed = true;
  }
  if (typeof rest.token === "string" && rest.token.startsWith("cvn_")) {
    // Schema 1 kept the device identity at the root.
    for (const name of ["token", "clubId", "userId", "userEmail"]) delete rest[name];
    if (rest.authMode === "device_token") delete rest.authMode;
    removed = true;
  }
  return { state: rest, removed };
}

/** The connection of a raw state file without device part, or nothing. */
function connectorAusRoh(parsed: Record<string, unknown>): StoredComvenioCliState["connector"] | undefined {
  // Die Altform 2 traegt `oauth` plus `authMode: "oauth"` und die
  // Vereinskennung an der Wurzel.
  const rohConnector = leseConnector(parsed.connector) ?? leseConnector(parsed.oauth);
  if (!rohConnector) return undefined;
  const clubId = text(objekt(parsed.connector)?.clubId ?? parsed.clubId);
  return { ...rohConnector, ...(clubId ? { clubId } : {}) };
}

function leseDatei(): Record<string, unknown> {
  if (!existsSync(STATE_FILE)) {
    throw new AuthError(`State-File nicht gefunden: ${STATE_FILE}\n${LOGIN_HINT}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (error) {
    throw new AuthError(`State-File ist ungültig: ${(error as Error).message}`);
  }
  const o = objekt(parsed);
  if (!o) throw new AuthError(`State-File ist ungültig: kein Objekt. ${LOGIN_HINT}`);
  return o;
}

/**
 * Liest die Datei und übersetzt die Altform 2 (nur OAuth) mit — niemand soll
 * sich nach einem Update neu anmelden müssen. Ein Geräte-Token zählt nicht
 * mehr als Anmeldung, auch wenn er noch in der Datei steht.
 */
function parseStoredState(): StoredComvenioCliState {
  const { state: parsed } = dropDeviceBlock(leseDatei());
  const gatewayBaseUrl = text(parsed.gatewayBaseUrl);
  if (!gatewayBaseUrl) {
    throw new AuthError(`Pflichtfeld "gatewayBaseUrl" fehlt. ${LOGIN_HINT}`);
  }
  const connector = connectorAusRoh(parsed);
  if (!connector) throw new AuthError(LOGIN_HINT);
  return {
    schemaVersion: 3,
    gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/u, ""),
    environment: text(parsed.environment) ?? "prod",
    connector,
  };
}

/** Zwei Adressen desselben Gateways dürfen nicht als verschieden gelten. */
export function gleichesGateway(a: string, b: string): boolean {
  const kanonisch = (roh: string): string | null => {
    let url: URL;
    try {
      url = new URL(roh);
    } catch {
      // Nicht deutbar heisst nicht gleich: Zwei unlesbare Werte duerfen nicht
      // als dasselbe Gateway gelten, nur weil ihr Rohtext uebereinstimmt.
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Userinfo, Query und Fragment gehoeren nicht zu einem Gateway. Statt sie
    // stillschweigend zu ignorieren, gilt eine solche Adresse als nicht
    // vergleichbar — sonst waeren `https://user@host` und `https://host`
    // dasselbe.
    if (url.username || url.password || url.search || url.hash) return null;
    const port = url.port === "" || (url.protocol === "https:" && url.port === "443")
      || (url.protocol === "http:" && url.port === "80")
      ? ""
      : `:${url.port}`;
    // Der abschliessende Punkt im Hostnamen bezeichnet dieselbe Wurzel.
    const host = url.hostname.toLowerCase().replace(/\.$/u, "");
    // Der Pfad bleibt bedeutsam: `…/a` und `…/b` sind verschiedene Ziele.
    return `${url.protocol}//${host}${port}${url.pathname.replace(/\/+$/u, "")}`;
  };
  const links = kanonisch(a);
  return links !== null && links === kanonisch(b);
}

function runtimeForState(state: StoredComvenioCliState): OAuthRuntime {
  const connectorOrigin = new URL(state.connector.resource).origin;
  const runtime = oauthRuntime(
    state.gatewayBaseUrl,
    connectorOrigin,
    state.connector.scopes as OAuthRuntime["scopes"],
  );
  if (
    state.connector.clientId !== runtime.clientId
    || state.connector.resource !== runtime.resource
  ) {
    throw new AuthError("Der gespeicherte OAuth-Client passt nicht zur aktuellen Umgebung. Bitte erneut anmelden.");
  }
  return {
    ...runtime,
    scopes: state.connector.scopes as OAuthRuntime["scopes"],
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

export const MACHINE_CLIENT_ID_ENV = "COMVENIO_CLIENT_ID";
export const MACHINE_CLIENT_SECRET_ENV = "COMVENIO_CLIENT_SECRET";
/** Optional: which Comvenio environment the machine grant belongs to (prod | dev). */
export const MACHINE_ENVIRONMENT_ENV = "COMVENIO_ENV";

// Only public HTTPS gateways; a machine grant is issued by the web app of
// exactly one environment. Same addresses as `comvenio login --env`.
const MACHINE_GATEWAY_BY_ENV: Record<string, string> = {
  prod: "https://api.comvenio.app",
  dev: "https://apidev.comvenio.app",
};

export type MachineGrantEnvironment = MachineGrantCredentials & {
  environment: string;
  gatewayBaseUrl: string;
};

/**
 * Reads the machine grant from the environment (03-maschinen-grant §4.5, B3).
 *
 * There is deliberately no command-line option for the secret: an argument
 * ends up in the shell history and in process listings. Returns null when
 * neither variable is set; one of the two alone is an incomplete sign-in and
 * names the missing variable (DC-3: AUTH_REQUIRED).
 */
export function machineGrantFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MachineGrantEnvironment | null {
  const clientId = env[MACHINE_CLIENT_ID_ENV];
  const clientSecret = env[MACHINE_CLIENT_SECRET_ENV];
  if (!clientId && !clientSecret) return null;
  if (!clientId) {
    throw new AuthError(
      `${MACHINE_CLIENT_ID_ENV} fehlt: Für die Anmeldung mit einem Maschinen-Grant müssen `
      + `${MACHINE_CLIENT_ID_ENV} und ${MACHINE_CLIENT_SECRET_ENV} gesetzt sein.`,
    );
  }
  if (!clientSecret) {
    throw new AuthError(
      `${MACHINE_CLIENT_SECRET_ENV} fehlt: Für die Anmeldung mit einem Maschinen-Grant müssen `
      + `${MACHINE_CLIENT_ID_ENV} und ${MACHINE_CLIENT_SECRET_ENV} gesetzt sein.`,
    );
  }
  // Checked before anything goes over the wire. The error names the
  // variable, never its value.
  if (!clientId.startsWith(MACHINE_CLIENT_ID_PREFIX) || !/^[\x21-\x7e]+$/u.test(clientId)) {
    throw new AuthError(
      `${MACHINE_CLIENT_ID_ENV} ist keine Client-ID eines Maschinen-Grants (erwartet: ${MACHINE_CLIENT_ID_PREFIX}…).`,
    );
  }
  if (!clientSecret.startsWith(MACHINE_CLIENT_SECRET_PREFIX) || !/^[\x21-\x7e]+$/u.test(clientSecret)) {
    throw new AuthError(
      `${MACHINE_CLIENT_SECRET_ENV} ist kein Secret eines Maschinen-Grants (erwartet: ${MACHINE_CLIENT_SECRET_PREFIX}…).`,
    );
  }
  const environment = env[MACHINE_ENVIRONMENT_ENV] || "prod";
  const gatewayBaseUrl = MACHINE_GATEWAY_BY_ENV[environment];
  if (!gatewayBaseUrl) {
    throw new LoginOptionError(`${MACHINE_ENVIRONMENT_ENV} muss "prod" oder "dev" sein.`);
  }
  return { clientId, clientSecret, environment, gatewayBaseUrl };
}

// The machine access token of this process. Keyed by a hash of grant and
// gateway so a changed secret never reuses a token issued for the old one.
let machineTokenCache: { key: string; token: MachineAccessToken } | null = null;

function machineCacheKey(machine: MachineGrantEnvironment): string {
  return createHash("sha256")
    .update(`${machine.gatewayBaseUrl}\n${machine.clientId}\n${machine.clientSecret}`, "utf8")
    .digest("hex");
}

/** Only for tests: forget the in-memory machine token. */
export function resetMachineTokenCache(): void {
  machineTokenCache = null;
}

async function loadMachineState(machine: MachineGrantEnvironment): Promise<ComvenioCliState> {
  const runtime = oauthRuntime(machine.gatewayBaseUrl);
  const key = machineCacheKey(machine);
  let token = machineTokenCache?.key === key ? machineTokenCache.token : null;
  if (!token || token.accessExpiresAt <= Date.now() + EXPIRY_SKEW_MS) {
    try {
      token = await fetchMachineAccessToken(runtime, machine);
    } catch (error) {
      machineTokenCache = null;
      // invalid_client covers unknown client, wrong or rotated secret,
      // revoked and expired grant alike (DC-3) — the hint names all of them.
      throw new AuthError(
        `Die Anmeldung mit ${MACHINE_CLIENT_ID_ENV} und ${MACHINE_CLIENT_SECRET_ENV} ist fehlgeschlagen `
        + `(${(error as Error).message}). Der Maschinen-Grant ist unbekannt, widerrufen oder abgelaufen, `
        + "oder das Secret wurde erneuert. Prüfe ihn in den Vereinseinstellungen unter „Automation“.",
      );
    }
    machineTokenCache = { key, token };
  }
  return {
    schemaVersion: 3,
    gatewayBaseUrl: runtime.gatewayBaseUrl,
    environment: machine.environment,
    connectorToken: token.accessToken,
    authMode: "oauth",
    oauth: { clientId: machine.clientId, resource: runtime.resource, scopes: [...token.scopes] },
    machineGrant: true,
  };
}

/** Der Zustand für den aufrufenden Befehl: die OAuth-Verbindung oder der Maschinen-Grant. */
export async function loadState(): Promise<ComvenioCliState> {
  // A machine grant in the environment wins over a stored sign-in: a script
  // or CI job that sets both variables means exactly this grant, never the
  // person who happens to be signed in on the machine.
  const machine = machineGrantFromEnv();
  if (machine) return loadMachineState(machine);
  const state = parseStoredState();
  const credentials = await resolveOAuthCredentials(state);
  return {
    schemaVersion: 3,
    gatewayBaseUrl: state.gatewayBaseUrl,
    environment: state.environment,
    ...(state.connector.clubId ? { clubId: state.connector.clubId } : {}),
    connectorToken: credentials.accessToken,
    authMode: "oauth",
    oauth: state.connector,
  };
}

/** Was in der Datei stehen darf — alles andere wird beim Schreiben abgelehnt. */
const ERLAUBTE_WURZELFELDER = new Set([
  "schemaVersion", "gatewayBaseUrl", "environment", "connector",
]);

/**
 * Schreibt die Datei und prüft vorher die STRUKTUR, nicht den Text.
 *
 * Die Form ist geschlossen: Nur bekannte Felder, nur bekannte Typen. In der
 * Datei steht kein Geheimnis — OAuth-Access- und Refresh-Tokens gehören in den
 * Credential-Store des Betriebssystems und kommen hier nie an.
 */
function schreibeZustand(state: StoredComvenioCliState): void {
  for (const name of Object.keys(state)) {
    if (!ERLAUBTE_WURZELFELDER.has(name)) {
      throw new AuthError(`Unbekanntes Feld „${name}“ im CLI-State — es könnte ein Geheimnis tragen.`);
    }
  }
  if (!state.gatewayBaseUrl || !state.environment) {
    throw new AuthError("Gateway und Umgebung dürfen nicht leer sein.");
  }
  const erlaubt = new Set(["clientId", "resource", "scopes", "clubId"]);
  for (const name of Object.keys(state.connector ?? {})) {
    if (!erlaubt.has(name)) {
      throw new AuthError(`Unbekanntes Feld „connector.${name}“ — Tokens gehören in den Credential-Store.`);
    }
  }
  const { clientId, resource, scopes } = state.connector ?? {};
  if (!clientId || !resource || typeof clientId !== "string" || typeof resource !== "string"
    || !Array.isArray(scopes) || !scopes.every((s) => typeof s === "string" && s.length > 0)) {
    throw new AuthError("Der Block „connector“ hat nicht die erwartete Form.");
  }
  // Letzter Riegel: Ein Geräte-Token hat in der Datei nichts mehr verloren.
  if (/cvn_/u.test(JSON.stringify(state))) {
    throw new AuthError("Ein Geräte-Token darf nicht im CLI-State stehen.");
  }
  // Write next to the file and rename: a failed write (full disk, crash)
  // leaves the previous sign-in intact instead of a truncated file.
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") chmodSync(temp, 0o600);
    renameSync(temp, STATE_FILE);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function readStoredState(): StoredComvenioCliState {
  return parseStoredState();
}

/**
 * Entfernt einen Geräte-Block aus der Zustandsdatei — einmal, beim ersten
 * Start nach dem Update (04 §4.4, DC-1, DC-8).
 *
 * - Geräte-Block und OAuth-Verbindung: die Verbindung bleibt, der Block geht.
 * - nur Geräte-Block: die Datei geht; danach ist niemand angemeldet.
 * - keine Datei, kein Geräte-Block, unlesbare Datei: nichts ändert sich.
 *
 * Gibt `true` zurück, wenn ein Block entfernt wurde — dann meldet der Aufrufer
 * es einmal; beim nächsten Start ist nichts mehr zu entfernen.
 */
export function removeDeviceBlock(): boolean {
  let roh: Record<string, unknown>;
  try {
    roh = leseDatei();
  } catch {
    return false;
  }
  const { state, removed } = dropDeviceBlock(roh);
  if (!removed) return false;
  const gatewayBaseUrl = text(state.gatewayBaseUrl);
  const connector = connectorAusRoh(state);
  if (gatewayBaseUrl && connector) {
    schreibeZustand({
      schemaVersion: 3,
      gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/u, ""),
      environment: text(state.environment) ?? "prod",
      connector,
    });
  } else {
    clearState();
  }
  return true;
}

/** Setzt die OAuth-Verbindung. */
export function writeConnectorLogin(input: {
  gatewayBaseUrl: string;
  environment: string;
  clubId?: string;
  connector: { clientId: string; resource: string; scopes: string[] };
}): void {
  schreibeZustand({
    schemaVersion: 3,
    gatewayBaseUrl: input.gatewayBaseUrl.replace(/\/+$/u, ""),
    environment: input.environment,
    connector: {
      // Nur die bekannten Felder, damit ein Aufrufer nichts danebenlegen kann.
      clientId: input.connector.clientId,
      resource: input.connector.resource,
      scopes: [...input.connector.scopes],
      ...(input.clubId ? { clubId: input.clubId } : {}),
    },
  });
}

/**
 * Was nach einem gescheiterten OAuth-Login aufzuraeumen ist.
 *
 * Als reine Funktion, weil sie die eigentliche Entscheidung traegt und in
 * der CLI-Definition nicht pruefbar waere. Genau diese Luecke hatte die
 * Fremdvalidierung benannt: "Die Tests messen den kritischen Login-Fehlerpfad
 * nicht."
 *
 * - `hatNeueCredentials` — dieser Versuch hat bereits etwas gespeichert.
 *   Dann muss es weg, sonst bleibt ein halber Zustand.
 * - `bestandVorher` — es gab schon eine funktionierende Verbindung. Die
 *   gehoert diesem Versuch nicht; ein im Browser abgebrochener
 *   WIEDERHOLUNGSversuch darf sie nicht abmelden.
 */
export function aufraeumenNachFehlschlag(
  hatNeueCredentials: boolean,
  bestandVorher: boolean,
): "alles" | "nichts" {
  if (hatNeueCredentials) return "alles";
  return bestandVorher ? "nichts" : "alles";
}

export function clearState(): void {
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
}

export function clearAllAuthState(): void {
  // Ob es etwas zu löschen gibt, entscheidet sich VOR dem Versuch:
  // `clearOAuthCredentials` wirft auch, wenn nichts da ist — unter Windows
  // scheitert `Remove-Item` schon am fehlenden Ordner.
  let hatteCredentials: boolean;
  try {
    hatteCredentials = loadOAuthCredentials() !== null;
  } catch {
    hatteCredentials = true;
  }
  try {
    clearOAuthCredentials();
  } catch (error) {
    if (!hatteCredentials) {
      clearState();
      return;
    }
    // Das Secret liegt noch im System — dann bleibt die Datei stehen, denn
    // sie trägt die Metadaten für einen zweiten Versuch.
    throw new AuthError(
      "Die OAuth-Credentials konnten nicht entfernt werden; die Anmeldung bleibt bestehen, "
      + `damit „comvenio logout“ es erneut versuchen kann. Ursache: ${(error as Error).message}`,
    );
  }
  clearState();
}
