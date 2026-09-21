// Die beiden Anmeldewege des CLI — und dass sie einander nicht mehr löschen.
//
// Bis zum 2026-09-21 schlossen sie sich aus: Wer sich per OAuth verband,
// verlor seinen Geräte-Token und damit ALLE klassischen Befehle; wer sich mit
// Geräte-Token anmeldete, verlor die Connector-Verbindung. Ursache war keine
// Sicherheitsregel, sondern eine gemeinsame Zustandsdatei mit einem einzigen
// `authMode`.
//
// Diese Datei prüft beide Richtungen und die Grenze, die BLEIBT: Der
// OAuth-Access-Token ist kein Ersatz für einen Geräte-Token und geht nie an
// die Fachdienste (`03-oauth-connection-lifecycle.md` §11).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "../packages/comvenio-client/src/legacy.ts";

const GERAETE_TOKEN = "cvn_beispiel_nur_fuer_den_test";
const GATEWAY = "https://api.example.org";

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

// Die Zustandsdatei liegt fest in `homedir()`, deshalb wird das Modul hier
// mit einem eigenen HOME frisch geladen — sonst schriebe der Test in die
// echte Anmeldung des Menschen.
//
// `APPDATA` gehört ausdrücklich dazu: Der Credential-Store folgt einer
// ANDEREN Wurzel als die Zustandsdatei (`APPDATA ?? USERPROFILE` in
// `src/oauth/credential-store.ts:71` gegen `homedir()` in `src/auth.ts`).
// Ohne diese Zeile las der Test die echten OAuth-Credentials des Menschen
// und wurde dadurch grün, wo er rot sein sollte. Zwei Wurzeln für eine
// Anmeldung sind auch ausserhalb von Tests ein Fallstrick — etwa bei einer
// portablen Installation.
describe("der Zustand trägt beide Wege", () => {
  let heim: string;
  const gesichert: Record<string, string | undefined> = {};
  const umgebogen = ["HOME", "USERPROFILE", "APPDATA"] as const;

  beforeEach(() => {
    heim = mkdtempSync(join(tmpdir(), "comvenio-anmeldung-"));
    for (const name of umgebogen) {
      gesichert[name] = process.env[name];
      process.env[name] = heim;
    }
  });

  afterEach(() => {
    for (const name of umgebogen) {
      if (gesichert[name] === undefined) delete process.env[name];
      else process.env[name] = gesichert[name];
    }
    rmSync(heim, { recursive: true, force: true });
  });

  async function frischesModul() {
    // Query-Anhang erzwingt einen neuen Modul-Zustand je Fall; `STATE_FILE`
    // wird beim Laden aus `homedir()` gebildet.
    return import(`../src/auth.ts?heim=${encodeURIComponent(heim)}`);
  }

  function zustandSchreiben(inhalt: Record<string, unknown>): string {
    const pfad = join(heim, ".comvenio-cli-state.json");
    writeFileSync(pfad, JSON.stringify(inhalt, null, 2), "utf8");
    return pfad;
  }

  test("eine OAuth-Anmeldung erhält den vorhandenen Geräte-Token", async () => {
    const { writeOAuthState } = await frischesModul();
    const pfad = zustandSchreiben({
      schemaVersion: 1, authMode: "device_token", token: GERAETE_TOKEN,
      gatewayBaseUrl: GATEWAY, environment: "prod",
    });

    writeOAuthState({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      oauth: { clientId: "client-1", resource: `${GATEWAY}/cli`, scopes: ["club.read"] },
    });

    const danach = JSON.parse(readFileSync(pfad, "utf8"));
    expect(danach.authMode).toBe("oauth");
    expect(danach.token).toBe(GERAETE_TOKEN);
    expect(danach.oauth.resource).toBe(`${GATEWAY}/cli`);
  });

  test("ohne vorhandenen Geräte-Token bleibt die Datei ohne token-Feld", async () => {
    const { writeOAuthState } = await frischesModul();
    const pfad = join(heim, ".comvenio-cli-state.json");

    writeOAuthState({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      oauth: { clientId: "client-1", resource: `${GATEWAY}/cli`, scopes: ["club.read"] },
    });

    const danach = JSON.parse(readFileSync(pfad, "utf8"));
    expect(danach.token).toBeUndefined();
    expect(existsSync(pfad)).toBe(true);
  });

  // Die Grenze, die bleibt: OAuth-Tokens gehören in den Credential-Store des
  // Betriebssystems, nie in diese Datei.
  test("ein OAuth-Secret im Zustand wird weiterhin abgelehnt", async () => {
    const { writeOAuthState, AuthError } = await frischesModul();
    expect(() => writeOAuthState({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      oauth: { clientId: "client-1", resource: `${GATEWAY}/cli`, scopes: ["club.read"] },
      // @ts-expect-error — genau das soll die Prüfung fangen
      accessToken: "geheim",
    })).toThrow(AuthError);
  });

  test("ein Geräte-Token darf nur im Feld token stehen", async () => {
    const { writeOAuthState } = await frischesModul();
    expect(() => writeOAuthState({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      oauth: { clientId: "client-1", resource: `${GATEWAY}/cli`, scopes: ["club.read"] },
      // @ts-expect-error — ein cvn_ an falscher Stelle
      notiz: `mein ${GERAETE_TOKEN}`,
    })).toThrow(/Feld/u);
  });

  test("readOAuthConnectorState liefert nichts ohne Credentials im Store", async () => {
    const { readOAuthConnectorState } = await frischesModul();
    zustandSchreiben({
      schemaVersion: 2, authMode: "oauth", gatewayBaseUrl: GATEWAY, environment: "prod",
      oauth: { clientId: "client-1", resource: `${GATEWAY}/cli`, scopes: ["club.read"] },
    });
    // Eine Verbindung ohne gültige Tokens ist eine Karteileiche und wird
    // nicht künstlich am Leben gehalten.
    expect(readOAuthConnectorState()).toBeUndefined();
  });

  test("readOAuthConnectorState liefert nichts bei reinem Geräte-Login", async () => {
    const { readOAuthConnectorState } = await frischesModul();
    zustandSchreiben({
      schemaVersion: 1, authMode: "device_token", token: GERAETE_TOKEN,
      gatewayBaseUrl: GATEWAY, environment: "prod",
    });
    expect(readOAuthConnectorState()).toBeUndefined();
  });

  test("eine unlesbare Zustandsdatei hält das OAuth-Schreiben nicht auf", async () => {
    const { writeOAuthState } = await frischesModul();
    const pfad = join(heim, ".comvenio-cli-state.json");
    writeFileSync(pfad, "{kein json", "utf8");

    writeOAuthState({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      oauth: { clientId: "client-1", resource: `${GATEWAY}/cli`, scopes: ["club.read"] },
    });

    expect(JSON.parse(readFileSync(pfad, "utf8")).authMode).toBe("oauth");
  });
});
