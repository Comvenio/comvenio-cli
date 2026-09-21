// Die beiden Anmeldewege des CLI — und dass sie einander nicht anfassen.
//
// WAS HIER GEPRÜFT WIRD UND WARUM DIE FORM SICH GEÄNDERT HAT:
// Bis zum 2026-09-21 trug die Zustandsdatei ein gemeinsames `authMode`, und
// das Feld `token` bedeutete je nach Modus zwei verschiedene Dinge. Zwei
// Fremdvalidierungsrunden fanden sieben und dann neun Befunde — mindestens
// fünf davon entstanden aus den Reparaturen der jeweils vorigen Runde.
// Darunter ein Bruch, bei dem der Geräte-Token an den Connector ging.
//
// Jetzt trägt die Datei zwei unabhängige Blöcke (`device`, `connector`), und
// jeder Schreibweg fasst nur seinen eigenen an. Diese Datei hält beides fest:
// die Unabhängigkeit und die Token-Grenze in BEIDE Richtungen.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "../packages/comvenio-client/src/legacy.ts";

const GERAETE_TOKEN = "cvn_beispiel_nur_fuer_den_test";
const GATEWAY = "https://api.example.org";
const FREMDES_GATEWAY = "https://fremd.example.org";
const CONNECTOR = { clientId: "client-1", resource: `${GATEWAY}/cli`, scopes: ["club.read"] };

describe("createClient: die Sperre trifft den echten Fall, nicht jede OAuth-Anmeldung", () => {
  test("mit Geräte-Token läuft ein klassischer Befehl auch nach OAuth", () => {
    const client = createClient({ token: GERAETE_TOKEN, gatewayBaseUrl: GATEWAY, authMode: "oauth", hasDeviceToken: true });
    expect(typeof client.get).toBe("function");
  });

  test("ohne Geräte-Token wird abgelehnt — mit dem Weg in der Meldung", () => {
    expect(() => createClient({ token: "oauth-access-token", gatewayBaseUrl: GATEWAY, authMode: "oauth", hasDeviceToken: false }))
      .toThrow(/--device-token/u);
  });

  // `hasDeviceToken` ist optional; ein alter Aufrufer, der es nicht setzt,
  // darf nicht versehentlich durchrutschen.
  test("ein fehlendes hasDeviceToken zählt als „keiner da“", () => {
    expect(() => createClient({ token: "oauth-access-token", gatewayBaseUrl: GATEWAY, authMode: "oauth" }))
      .toThrow(/Geräte-Token/u);
  });

  test("der reine Geräte-Weg bleibt unverändert", () => {
    const client = createClient({ token: GERAETE_TOKEN, gatewayBaseUrl: GATEWAY, authMode: "device_token" });
    expect(typeof client.post).toBe("function");
  });
});

// Die Zustandsdatei liegt in `homedir()`, der Credential-Store folgt
// `APPDATA ?? USERPROFILE` (src/oauth/credential-store.ts:71) — ZWEI Wurzeln
// für eine Anmeldung. Der erste Testlauf bog nur HOME und USERPROFILE um und
// las dadurch die ECHTEN Credentials; er wurde grün, wo er rot sein sollte.
// Deshalb immer alle drei.
function mitEigenemHeim(name: string) {
  const zustand: { heim: string } = { heim: "" };
  const gesichert: Record<string, string | undefined> = {};
  const umgebogen = ["HOME", "USERPROFILE", "APPDATA"] as const;

  beforeEach(() => {
    zustand.heim = mkdtempSync(join(tmpdir(), `comvenio-${name}-`));
    for (const key of umgebogen) { gesichert[key] = process.env[key]; process.env[key] = zustand.heim; }
  });
  afterEach(() => {
    for (const key of umgebogen) {
      if (gesichert[key] === undefined) delete process.env[key]; else process.env[key] = gesichert[key];
    }
    rmSync(zustand.heim, { recursive: true, force: true });
  });
  return zustand;
}

const pfadIn = (heim: string) => join(heim, ".comvenio-cli-state.json");
const schreibe = (heim: string, inhalt: unknown) =>
  writeFileSync(pfadIn(heim), JSON.stringify(inhalt, null, 2), "utf8");
const lies = (heim: string) => JSON.parse(readFileSync(pfadIn(heim), "utf8"));

describe("die beiden Blöcke fassen einander nicht an", () => {
  const z = mitEigenemHeim("bloecke");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  test("eine OAuth-Anmeldung lässt den Geräte-Block stehen", async () => {
    const { writeConnectorLogin } = await modul("a1");
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", device: { token: GERAETE_TOKEN } });

    const { geraetBleibt } = writeConnectorLogin({ gatewayBaseUrl: GATEWAY, environment: "prod", connector: CONNECTOR });

    expect(geraetBleibt).toBe(true);
    const danach = lies(z.heim);
    expect(danach.device.token).toBe(GERAETE_TOKEN);
    expect(danach.connector.resource).toBe(CONNECTOR.resource);
    expect(danach.authMode).toBeUndefined();
  });

  test("ein Geräte-Login lässt den Connector-Block stehen", async () => {
    const { writeDeviceLogin } = await modul("a2");
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", connector: CONNECTOR });

    const { connectorBleibt } = writeDeviceLogin({ token: GERAETE_TOKEN, gatewayBaseUrl: GATEWAY, environment: "prod" });

    expect(connectorBleibt).toBe(true);
    const danach = lies(z.heim);
    expect(danach.connector.clientId).toBe(CONNECTOR.clientId);
    expect(danach.device.token).toBe(GERAETE_TOKEN);
  });

  // Der Fall aus Runde 2, Befund 2: Ein abgebrochener OAuth-Versuch zerstörte
  // die bestehende Anmeldung — auch eine vorher funktionierende.
  test("ein abgebrochener OAuth-Versuch nimmt nur den Connector zurück", async () => {
    const { clearConnectorState } = await modul("a3");
    schreibe(z.heim, {
      schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod",
      device: { token: GERAETE_TOKEN }, connector: CONNECTOR, clubId: "verein-1",
    });

    clearConnectorState();

    const danach = lies(z.heim);
    expect(danach.device.token).toBe(GERAETE_TOKEN);
    expect(danach.connector).toBeUndefined();
    expect(danach.clubId).toBe("verein-1");
  });

  test("ohne Geräte-Block räumt er die Datei ganz ab", async () => {
    const { clearConnectorState } = await modul("a4");
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", connector: CONNECTOR });
    clearConnectorState();
    expect(existsSync(pfadIn(z.heim))).toBe(false);
  });
});

describe("jeder Token gehört zu seinem Gateway", () => {
  const z = mitEigenemHeim("gateway");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  // Ohne diese Bindung ginge der Geräte-Token nach einem `--gateway`-Wechsel
  // im Authorization-Header an einen fremden Ursprung.
  test("ein Gateway-Wechsel lässt den Geräte-Token fallen", async () => {
    const { writeConnectorLogin } = await modul("g1");
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", device: { token: GERAETE_TOKEN } });

    const { geraetBleibt } = writeConnectorLogin({
      gatewayBaseUrl: FREMDES_GATEWAY, environment: "prod",
      connector: { ...CONNECTOR, resource: `${FREMDES_GATEWAY}/cli` },
    });

    expect(geraetBleibt).toBe(false);
    expect(lies(z.heim).device).toBeUndefined();
  });

  test("und umgekehrt: ein Gateway-Wechsel lässt die Connector-Metadaten fallen", async () => {
    const { writeDeviceLogin } = await modul("g2");
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", connector: CONNECTOR });

    const { connectorBleibt } = writeDeviceLogin({ token: GERAETE_TOKEN, gatewayBaseUrl: FREMDES_GATEWAY, environment: "prod" });

    expect(connectorBleibt).toBe(false);
    expect(lies(z.heim).connector).toBeUndefined();
  });

  // Runde 2, Befund 7: Der Vergleich entfernte nur Schrägstriche. Semantisch
  // gleiche Adressen galten als verschieden — und ein gültiger Token ging
  // dabei verloren.
  test("dasselbe Gateway in anderer Schreibweise zählt als dasselbe", async () => {
    const { gleichesGateway } = await modul("g3");
    expect(gleichesGateway("https://api.example.org", "https://API.example.org/")).toBe(true);
    expect(gleichesGateway("https://api.example.org", "https://api.example.org:443")).toBe(true);
    expect(gleichesGateway("http://localhost", "http://localhost:80/")).toBe(true);
    // Der Pfad bleibt bedeutsam — das sind verschiedene Ziele.
    expect(gleichesGateway("https://api.example.org/a", "https://api.example.org/b")).toBe(false);
    expect(gleichesGateway("https://api.example.org", "https://fremd.example.org")).toBe(false);
  });

  test("ein Token überlebt den Wechsel der Schreibweise", async () => {
    const { writeConnectorLogin } = await modul("g4");
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: `${GATEWAY}/`, environment: "prod", device: { token: GERAETE_TOKEN } });
    const { geraetBleibt } = writeConnectorLogin({ gatewayBaseUrl: GATEWAY.toUpperCase().replace("HTTPS", "https"), environment: "prod", connector: CONNECTOR });
    expect(geraetBleibt).toBe(true);
  });
});

describe("die Schreibprüfung kennt die Form, nicht nur Textmuster", () => {
  const z = mitEigenemHeim("form");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  // Runde 2, Befund 4: Die alte Prüfung achtete nur auf `cvn_` und erlaubte
  // das Wurzelfeld `token` — ein `token: "opaque-oauth-access-token"` ging
  // durch, ebenso ein Secret in einem verschachtelten Feld.
  // Die Schreibwege nehmen nur bekannte Felder entgegen und bauen den Stand
  // daraus neu — ein Fremdfeld kommt gar nicht bis zur Formpruefung. Genau
  // das ist die Zusicherung: Was der Aufrufer danebenlegt, landet nicht in
  // der Datei. (Die Formpruefung dahinter ist der zweite Riegel fuer den
  // Fall, dass jemand `schreibeZustand` spaeter direkt benutzt.)
  test("ein Fremdfeld des Aufrufers landet nicht in der Datei", async () => {
    const { writeConnectorLogin } = await modul("f1");
    writeConnectorLogin({
      gatewayBaseUrl: GATEWAY, environment: "prod", connector: CONNECTOR,
      // @ts-expect-error — der Aufrufer legt etwas daneben
      accessToken: "geheim",
    });
    const roh = readFileSync(pfadIn(z.heim), "utf8");
    expect(roh).not.toContain("geheim");
    expect(roh).not.toContain("accessToken");
    expect(Object.keys(lies(z.heim)).sort()).toEqual(
      ["connector", "environment", "gatewayBaseUrl", "schemaVersion"],
    );
  });

  test("ein unbekanntes Feld IM Connector wird abgelehnt", async () => {
    const { writeConnectorLogin } = await modul("f2");
    expect(() => writeConnectorLogin({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      // @ts-expect-error — Tokens gehören in den Credential-Store
      connector: { ...CONNECTOR, token: "opaque-oauth-access-token" },
    })).toThrow(/connector\.token/u);
  });

  test("ein Geräte-Token darf nur in device.token stehen", async () => {
    const { writeConnectorLogin } = await modul("f3");
    expect(() => writeConnectorLogin({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      // @ts-expect-error — ein cvn_ an falscher Stelle
      connector: { ...CONNECTOR, clientId: `client ${GERAETE_TOKEN}` },
    })).toThrow(/device\.token/u);
  });

  test("etwas anderes als ein cvn_ ist kein Geräte-Token", async () => {
    const { writeDeviceLogin } = await modul("f4");
    expect(() => writeDeviceLogin({ token: "opaque-oauth-access-token", gatewayBaseUrl: GATEWAY, environment: "prod" }))
      .toThrow(/kein Geräte-Token/u);
  });

  test("ein falsch geformter Connector wird abgelehnt", async () => {
    const { writeConnectorLogin } = await modul("f5");
    expect(() => writeConnectorLogin({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      // @ts-expect-error — scopes muss eine Liste von Strings sein
      connector: { clientId: "c", resource: "r", scopes: [{}] },
    })).toThrow(/erwartete Form/u);
  });
});

describe("alte Zustandsdateien funktionieren weiter", () => {
  const z = mitEigenemHeim("migration");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  // Niemand soll sich nach einem Update neu anmelden müssen.
  test("Schema 1 (nur Gerät) wird übersetzt", async () => {
    const { readStoredState } = await modul("m1");
    schreibe(z.heim, {
      schemaVersion: 1, authMode: "device_token", token: GERAETE_TOKEN,
      gatewayBaseUrl: GATEWAY, environment: "prod", clubId: "verein-1",
    });
    const stand = readStoredState();
    expect(stand.device?.token).toBe(GERAETE_TOKEN);
    expect(stand.connector).toBeUndefined();
    expect(stand.clubId).toBe("verein-1");
  });

  test("Schema 2 (nur OAuth) wird übersetzt", async () => {
    const { readStoredState } = await modul("m2");
    schreibe(z.heim, {
      schemaVersion: 2, authMode: "oauth", gatewayBaseUrl: GATEWAY,
      environment: "prod", oauth: CONNECTOR,
    });
    const stand = readStoredState();
    expect(stand.connector?.resource).toBe(CONNECTOR.resource);
    expect(stand.device).toBeUndefined();
  });

  test("eine Datei ohne jeden Weg gilt als nicht angemeldet", async () => {
    const { readStoredState } = await modul("m3");
    schreibe(z.heim, { schemaVersion: 2, authMode: "oauth", gatewayBaseUrl: GATEWAY, environment: "prod" });
    expect(() => readStoredState()).toThrow(/Nicht eingeloggt/u);
  });

  // Runde 2, Befund 9: Nicht-Strings in `scopes` blieben unbeanstandet und
  // wanderten in den Runtime-Vergleich.
  test("ein Connector mit kaputten Scopes zählt nicht als Verbindung", async () => {
    const { readStoredState } = await modul("m4");
    schreibe(z.heim, {
      schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod",
      device: { token: GERAETE_TOKEN },
      connector: { clientId: "c", resource: "r", scopes: ["gut", 42] },
    });
    expect(readStoredState().connector).toBeUndefined();
  });
});

describe("ein abgelaufener Grant reisst die klassischen Befehle nicht mit", () => {
  const z = mitEigenemHeim("grant");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  test("loadState liefert den Geräte-Token, auch wenn OAuth nicht mehr trägt", async () => {
    const { loadState } = await modul("k1");
    schreibe(z.heim, {
      schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod",
      device: { token: GERAETE_TOKEN }, connector: CONNECTOR,
    });

    const state = await loadState();
    expect(state.token).toBe(GERAETE_TOKEN);
    expect(state.hasDeviceToken).toBe(true);
    // Und der Geräte-Token steht NICHT als Connector-Token bereit: Der
    // Fallback `?? state.token` schickte ihn sonst an den Connector.
    expect(state.connectorToken).toBeUndefined();
    expect(typeof createClient(state).get).toBe("function");
  });

  test("ohne Geräte-Token wirft loadState weiterhin — der Fehler gehört gemeldet", async () => {
    const { loadState } = await modul("k2");
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", connector: CONNECTOR });
    await expect(loadState()).rejects.toThrow();
  });

  // Die Gegenprobe im Quelltext: Ein `?? state.token` neben `access_token`
  // wäre genau der Bruch aus Runde 2 — und er stand schon einmal da, mit
  // einem Kommentar darüber, der das Gegenteil behauptete.
  test("kein Aufrufer fällt auf state.token zurück", () => {
    for (const datei of ["src/commands/action.ts", "src/commands/whoami.ts"]) {
      const quelle = readFileSync(join(process.cwd(), datei), "utf8");
      expect(quelle, datei).not.toMatch(/access_token:\s*state\.connectorToken\s*\?\?/u);
      expect(quelle, datei).not.toMatch(/access_token:\s*state\.token/u);
    }
  });
});

describe("Abmelden hinterlässt keinen unverwaltbaren Rest", () => {
  const z = mitEigenemHeim("logout");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  test("ohne Credentials im Store räumt der Logout die Datei ab", async () => {
    const { clearAllAuthState } = await modul("l1");
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", device: { token: GERAETE_TOKEN } });
    clearAllAuthState();
    expect(existsSync(pfadIn(z.heim))).toBe(false);
  });
});
