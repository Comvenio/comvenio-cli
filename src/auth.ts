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

/**
 * Die gespeicherte Anmeldung — ZWEI unabhängige Blöcke.
 *
 * WARUM ES KEIN `authMode` MEHR GIBT: Bis zum 2026-09-21 trug die Datei ein
 * gemeinsames `authMode`, und das Feld `token` bedeutete je nach Modus zwei
 * verschiedene Dinge — mal den Geräte-Token, mal den OAuth-Access-Token. Zwei
 * Fremdvalidierungsrunden fanden sieben und dann neun Befunde, von denen
 * mindestens fünf aus den Reparaturen der jeweils vorigen Runde entstanden.
 * Darunter ein Bruch, bei dem der Geräte-Token an den Connector ging.
 *
 * Die Ursache war nicht die einzelne Fundstelle, sondern die Verschränkung.
 * Jetzt schreibt jeder Weg NUR seinen eigenen Block: Wer sich per OAuth
 * verbindet, fasst `device` nicht an; wer einen Geräte-Token setzt, fasst
 * `connector` nicht an. Damit fällt die ganze Fehlerklasse weg, statt einzeln
 * geflickt zu werden.
 *
 * Die GELESENE Form (`ComvenioCliState`) bleibt unverändert, damit die 27
 * Aufrufer von `loadState()` unberührt bleiben.
 */
export type StoredComvenioCliState = {
  schemaVersion: 3;
  /** Beide Wege reden mit demselben Gateway — deshalb steht es gemeinsam. */
  gatewayBaseUrl: string;
  environment: string;
  /** Der `cvn_`-Token für die klassischen Befehle. */
  device?: { token: string };
  /** Die OAuth-Metadaten; die Tokens selbst liegen im Credential-Store. */
  connector?: { clientId: string; resource: string; scopes: string[] };
  clubId?: string;
  userId?: string;
  userEmail?: string;
};

export type ComvenioCliState = {
  schemaVersion: 3;
  gatewayBaseUrl: string;
  environment: string;
  clubId?: string;
  userId?: string;
  userEmail?: string;
  /**
   * Der Token für die klassischen Befehle — der Geräte-Token, solange einer
   * vorliegt. Sonst der OAuth-Access-Token, den `createClient` dann ablehnt.
   */
  token: string;
  /** Nur für `comvenio action`; geht nie an einen Fachdienst. */
  connectorToken?: string;
  hasDeviceToken: boolean;
  /** Für Aufrufer, die den alten Namen lesen. */
  authMode: "device_token" | "oauth";
  oauth?: { clientId: string; resource: string; scopes: string[] };
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function text(wert: unknown): string | undefined {
  return typeof wert === "string" && wert.length > 0 ? wert : undefined;
}

function leseConnector(roh: unknown): StoredComvenioCliState["connector"] {
  if (roh === null || typeof roh !== "object" || Array.isArray(roh)) return undefined;
  const o = roh as Record<string, unknown>;
  const clientId = text(o.clientId);
  const resource = text(o.resource);
  // Nicht-Strings in `scopes` fielen früher durch und landeten unverändert im
  // Runtime-Vergleich. Was kein String ist, ist kein Scope.
  const scopes = Array.isArray(o.scopes) ? o.scopes.filter((s): s is string => typeof s === "string") : null;
  if (!clientId || !resource || !scopes || scopes.length !== (o.scopes as unknown[]).length) return undefined;
  return { clientId, resource, scopes: [...scopes] };
}

/**
 * Liest die Datei und übersetzt die beiden Altformen mit.
 *
 * `schemaVersion` 1 (nur Gerät) und 2 (nur OAuth) werden NICHT verworfen —
 * niemand soll sich nach einem Update neu anmelden müssen. Sie hatten je
 * einen Weg; der wandert in seinen Block.
 */
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
  const gatewayBaseUrl = text(parsed.gatewayBaseUrl);
  if (!gatewayBaseUrl) {
    throw new AuthError(`Pflichtfeld "gatewayBaseUrl" fehlt. ${LOGIN_HINT}`);
  }

  const alterToken = text(parsed.token);
  const device = typeof parsed.device === "object" && parsed.device !== null
    ? (text((parsed.device as Record<string, unknown>).token) ? { token: (parsed.device as { token: string }).token } : undefined)
    : alterToken && alterToken.startsWith("cvn_")
      ? { token: alterToken }
      : undefined;

  const connector = leseConnector(parsed.connector)
    // Altform 2: `oauth` plus `authMode: "oauth"`.
    ?? (parsed.authMode === "oauth" ? leseConnector(parsed.oauth) : undefined);

  if (!device && !connector) throw new AuthError(LOGIN_HINT);

  return {
    schemaVersion: 3,
    gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/u, ""),
    environment: text(parsed.environment) ?? "prod",
    ...(device ? { device } : {}),
    ...(connector ? { connector } : {}),
    ...(text(parsed.clubId) ? { clubId: text(parsed.clubId) } : {}),
    ...(text(parsed.userId) ? { userId: text(parsed.userId) } : {}),
    ...(text(parsed.userEmail) ? { userEmail: text(parsed.userEmail) } : {}),
  };
}

/** Zwei Adressen desselben Gateways dürfen nicht als verschieden gelten. */
export function gleichesGateway(a: string, b: string): boolean {
  const kanonisch = (roh: string): string => {
    try {
      const url = new URL(roh);
      const port = url.port === "" || (url.protocol === "https:" && url.port === "443")
        || (url.protocol === "http:" && url.port === "80")
        ? ""
        : `:${url.port}`;
      // Der Pfad bleibt bedeutsam: `…/a` und `…/b` sind verschiedene Ziele.
      return `${url.protocol}//${url.hostname.toLowerCase()}${port}${url.pathname.replace(/\/+$/u, "")}`;
    } catch {
      return roh.replace(/\/+$/u, "").toLowerCase();
    }
  };
  return kanonisch(a) === kanonisch(b);
}

function runtimeForState(state: StoredComvenioCliState): OAuthRuntime {
  const connectorOrigin = state.connector?.resource
    ? new URL(state.connector.resource).origin
    : undefined;
  const runtime = oauthRuntime(
    state.gatewayBaseUrl,
    connectorOrigin,
    state.connector?.scopes as OAuthRuntime["scopes"],
  );
  if (
    state.connector?.clientId !== runtime.clientId
    || state.connector?.resource !== runtime.resource
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

/**
 * Der Zustand für den aufrufenden Befehl.
 *
 * Beide Wege stehen nebeneinander: `token` trägt den Geräte-Token, solange
 * einer vorliegt, `connectorToken` den OAuth-Access-Token. Das verletzt
 * `03-oauth-connection-lifecycle.md` §11 nicht — der verbietet, aus OAuth
 * einen Aktor-Token FÜRS CLI abzuleiten, nicht, einen unabhängig erworbenen
 * Geräte-Token zu behalten.
 */
export async function loadState(): Promise<ComvenioCliState> {
  const state = parseStoredState();
  const deviceToken = state.device?.token ?? null;
  const gemeinsam = {
    schemaVersion: 3 as const,
    gatewayBaseUrl: state.gatewayBaseUrl,
    environment: state.environment,
    ...(state.clubId ? { clubId: state.clubId } : {}),
    ...(state.userId ? { userId: state.userId } : {}),
    ...(state.userEmail ? { userEmail: state.userEmail } : {}),
    ...(state.connector ? { oauth: state.connector } : {}),
    authMode: (state.connector ? "oauth" : "device_token") as "oauth" | "device_token",
  };

  if (!state.connector) {
    return { ...gemeinsam, token: deviceToken as string, hasDeviceToken: true };
  }

  let credentials: OAuthCredentials | null = null;
  try {
    credentials = await resolveOAuthCredentials(state);
  } catch (error) {
    // Ein abgelaufener oder widerrufener Grant reisst die klassischen Befehle
    // nicht mit. Ohne Geräte-Token gibt es dagegen nichts zu retten.
    if (!deviceToken) throw error;
  }
  return {
    ...gemeinsam,
    token: deviceToken ?? credentials!.accessToken,
    ...(credentials ? { connectorToken: credentials.accessToken } : {}),
    hasDeviceToken: deviceToken !== null,
  };
}

/** Was in der Datei stehen darf — alles andere wird beim Schreiben abgelehnt. */
const ERLAUBTE_WURZELFELDER = new Set([
  "schemaVersion", "gatewayBaseUrl", "environment", "device", "connector",
  "clubId", "userId", "userEmail",
]);

/**
 * Schreibt die Datei und prüft vorher die STRUKTUR, nicht den Text.
 *
 * Die frühere Prüfung suchte Feldnamen per Regex und liess `AccessToken`,
 * `bearerToken` oder ein Secret unter einem erlaubten Namen durch. Hier ist
 * die Form geschlossen: Nur bekannte Felder, nur bekannte Typen. Der einzige
 * Ort für ein Geheimnis ist `device.token`, und der ist der Geräte-Token —
 * OAuth-Access- und Refresh-Tokens gehören in den Credential-Store des
 * Betriebssystems und kommen hier nie an.
 */
function schreibeZustand(state: StoredComvenioCliState): void {
  for (const name of Object.keys(state)) {
    if (!ERLAUBTE_WURZELFELDER.has(name)) {
      throw new AuthError(`Unbekanntes Feld „${name}“ im CLI-State — es könnte ein Geheimnis tragen.`);
    }
  }
  if (state.device && (typeof state.device.token !== "string" || !state.device.token.startsWith("cvn_"))) {
    throw new AuthError("Im Feld „device.token“ steht kein Geräte-Token.");
  }
  if (state.device && Object.keys(state.device).length !== 1) {
    throw new AuthError("Der Block „device“ trägt nur „token“.");
  }
  if (state.connector) {
    const erlaubt = new Set(["clientId", "resource", "scopes"]);
    for (const name of Object.keys(state.connector)) {
      if (!erlaubt.has(name)) {
        throw new AuthError(`Unbekanntes Feld „connector.${name}“ — Tokens gehören in den Credential-Store.`);
      }
    }
    const { clientId, resource, scopes } = state.connector;
    if (typeof clientId !== "string" || typeof resource !== "string"
      || !Array.isArray(scopes) || !scopes.every((s) => typeof s === "string")) {
      throw new AuthError("Der Block „connector“ hat nicht die erwartete Form.");
    }
  }
  // Letzter Riegel: Ein `cvn_` darf nur in `device.token` stehen.
  const encoded = JSON.stringify({ ...state, device: undefined });
  if (/cvn_/u.test(encoded)) {
    throw new AuthError("Ein Geräte-Token darf nur in „device.token“ stehen.");
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(STATE_FILE, 0o600);
}

/** Der gespeicherte Stand, ohne zu werfen — für die beiden Schreibwege. */
function bestehenderStand(): StoredComvenioCliState | null {
  try {
    return parseStoredState();
  } catch {
    return null;
  }
}

export function readStoredState(): StoredComvenioCliState {
  return parseStoredState();
}

/**
 * Setzt den Geräte-Block — und lässt `connector` unangetastet.
 *
 * Vorher löschte ein Geräte-Login die OAuth-Verbindung mit
 * (`clearOAuthCredentials` plus `oauth: undefined`). Dass beide Wege einander
 * nicht mehr überschreiben, ist der ganze Sinn dieser Form.
 */
export function writeDeviceLogin(input: {
  token: string;
  gatewayBaseUrl: string;
  environment: string;
  clubId?: string;
  userId?: string;
  userEmail?: string;
}): { connectorBleibt: boolean } {
  const alt = bestehenderStand();
  // Der Connector bleibt nur, wenn er zum selben Gateway gehört — sonst wäre
  // er nach dem Wechsel eine Karteileiche, die `runtimeForState` später
  // verwirft und damit jeden Befehl blockiert.
  const connector = alt?.connector && gleichesGateway(alt.gatewayBaseUrl, input.gatewayBaseUrl)
    ? alt.connector
    : undefined;
  schreibeZustand({
    schemaVersion: 3,
    gatewayBaseUrl: input.gatewayBaseUrl.replace(/\/+$/u, ""),
    environment: input.environment,
    device: { token: input.token },
    ...(connector ? { connector } : {}),
    ...(input.clubId ? { clubId: input.clubId } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.userEmail ? { userEmail: input.userEmail } : {}),
  });
  return { connectorBleibt: Boolean(connector) };
}

/**
 * Setzt den Connector-Block — und lässt `device` unangetastet.
 *
 * Der Geräte-Token wird nur übernommen, wenn er zum selben Gateway gehört:
 * Sonst ginge er nach einem `--gateway`-Wechsel im Authorization-Header an
 * einen fremden Ursprung.
 */
export function writeConnectorLogin(input: {
  gatewayBaseUrl: string;
  environment: string;
  clubId?: string;
  connector: { clientId: string; resource: string; scopes: string[] };
}): { geraetBleibt: boolean } {
  const alt = bestehenderStand();
  const device = alt?.device && gleichesGateway(alt.gatewayBaseUrl, input.gatewayBaseUrl)
    ? alt.device
    : undefined;
  schreibeZustand({
    schemaVersion: 3,
    gatewayBaseUrl: input.gatewayBaseUrl.replace(/\/+$/u, ""),
    environment: input.environment,
    ...(device ? { device } : {}),
    connector: input.connector,
    ...(input.clubId ? { clubId: input.clubId } : {}),
    ...(alt?.userId ? { userId: alt.userId } : {}),
    ...(alt?.userEmail ? { userEmail: alt.userEmail } : {}),
  });
  return { geraetBleibt: Boolean(device) };
}

/**
 * Entfernt NUR den Connector-Block.
 *
 * Für den Fehlerfall eines OAuth-Anmeldeversuchs: Was vorher da war, bleibt.
 * Vorher löschte der Catch die ganze Datei und nahm einen gültigen
 * Geräte-Login mit.
 */
export function clearConnectorState(): void {
  const alt = bestehenderStand();
  if (!alt) return;
  if (!alt.device) {
    clearState();
    return;
  }
  schreibeZustand({
    schemaVersion: 3,
    gatewayBaseUrl: alt.gatewayBaseUrl,
    environment: alt.environment,
    device: alt.device,
    ...(alt.clubId ? { clubId: alt.clubId } : {}),
    ...(alt.userId ? { userId: alt.userId } : {}),
    ...(alt.userEmail ? { userEmail: alt.userEmail } : {}),
  });
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
