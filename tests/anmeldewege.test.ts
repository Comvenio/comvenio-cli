// Die Anmeldung des CLI in der Zustandsdatei.
//
// Bis zum Geräte-Token-Abbau (geraetetoken-abbau-04) trug die Datei zwei
// unabhängige Blöcke, `device` und `connector`. Seitdem gibt es nur noch die
// OAuth-Verbindung; einen alten Geräte-Block entfernt der erste Start
// (tests/geraetetoken-abbau.test.ts). Diese Datei hält fest, was von der
// Form bleibt: die geschlossene Schreibprüfung, die Altform 2, die
// Gateway-Kanonisierung und den Fehlerpfad des Logins.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const GERAETE_TOKEN = "cvn_beispiel_nur_fuer_den_test";
const GATEWAY = "https://api.example.org";
const CONNECTOR = { clientId: "client-1", resource: `${GATEWAY}/cli`, scopes: ["club.read"] };

// Die Zustandsdatei liegt in `homedir()`, der Credential-Store folgt
// `APPDATA ?? USERPROFILE` (src/oauth/credential-store.ts) — ZWEI Wurzeln
// für eine Anmeldung. Deshalb immer alle drei umbiegen.
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

describe("die Schreibprüfung kennt die Form, nicht nur Textmuster", () => {
  const z = mitEigenemHeim("form");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

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

  test("ein Fremdfeld im Connector landet nicht in der Datei", async () => {
    const { writeConnectorLogin } = await modul("f2");
    writeConnectorLogin({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      // @ts-expect-error — Tokens gehören in den Credential-Store
      connector: { ...CONNECTOR, token: "opaque-oauth-access-token" },
    });
    const roh = readFileSync(pfadIn(z.heim), "utf8");
    expect(roh).not.toContain("opaque-oauth-access-token");
    expect(Object.keys(lies(z.heim).connector).sort()).toEqual(["clientId", "resource", "scopes"]);
  });

  test("ein Geräte-Token kommt nicht mehr in die Datei", async () => {
    const { writeConnectorLogin } = await modul("f3");
    expect(() => writeConnectorLogin({
      gatewayBaseUrl: GATEWAY, environment: "prod",
      connector: { ...CONNECTOR, clientId: `client ${GERAETE_TOKEN}` },
    })).toThrow(/Geräte-Token/u);
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

describe("alte Zustandsdateien", () => {
  const z = mitEigenemHeim("migration");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  // Niemand soll sich nach einem Update neu anmelden müssen.
  test("Schema 2 (nur OAuth) wird übersetzt", async () => {
    const { readStoredState } = await modul("m2");
    schreibe(z.heim, {
      schemaVersion: 2, authMode: "oauth", gatewayBaseUrl: GATEWAY,
      environment: "prod", oauth: CONNECTOR, clubId: "verein-b",
    });
    const stand = readStoredState();
    expect(stand.connector.resource).toBe(CONNECTOR.resource);
    expect(stand.connector.clubId).toBe("verein-b");
    expect(stand).not.toHaveProperty("device");
  });

  test("Schema 1 (nur Gerät) gilt als nicht angemeldet", async () => {
    const { readStoredState } = await modul("m1");
    schreibe(z.heim, {
      schemaVersion: 1, authMode: "device_token", token: GERAETE_TOKEN,
      gatewayBaseUrl: GATEWAY, environment: "prod", clubId: "verein-1",
    });
    expect(() => readStoredState()).toThrow(/Nicht eingeloggt/u);
  });

  test("eine Datei ohne Verbindung gilt als nicht angemeldet", async () => {
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
      connector: { clientId: "c", resource: "r", scopes: ["gut", 42] },
    });
    expect(() => readStoredState()).toThrow(/Nicht eingeloggt/u);
  });

  // Die gemischte Altform: Die Vereinskennung an der Wurzel gehörte dem
  // Geräte-Token, nicht dem Connector.
  test("eine gemischte Altform behält den Connector, nicht den Verein des Geräts", async () => {
    const { readStoredState } = await modul("s3");
    schreibe(z.heim, {
      schemaVersion: 1, authMode: "device_token", token: GERAETE_TOKEN, clubId: "verein-a",
      gatewayBaseUrl: GATEWAY, environment: "prod", oauth: CONNECTOR,
    });
    const stand = readStoredState();
    expect(stand.connector.resource).toBe(CONNECTOR.resource);
    expect(stand.connector.clubId).toBeUndefined();
  });
});

describe("loadState kennt nur die OAuth-Verbindung", () => {
  const z = mitEigenemHeim("grant");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  test("ohne tragfähige OAuth-Credentials wirft loadState — auch mit altem Geräte-Block", async () => {
    const { loadState } = await modul("k1");
    schreibe(z.heim, {
      schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod",
      device: { token: GERAETE_TOKEN }, connector: CONNECTOR,
    });
    await expect(loadState()).rejects.toThrow();
  });

  // Die Gegenprobe im Quelltext: kein Aufrufer reicht etwas anderes als den
  // Connector-Token an den Connector.
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
    schreibe(z.heim, { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", connector: CONNECTOR });
    clearAllAuthState();
    expect(existsSync(pfadIn(z.heim))).toBe(false);
  });
});

describe("gleichesGateway ist konservativ", () => {
  const z = mitEigenemHeim("kanon");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  // Runde 2, Befund 7: Der Vergleich entfernte nur Schrägstriche.
  test("dasselbe Gateway in anderer Schreibweise zählt als dasselbe", async () => {
    const { gleichesGateway } = await modul("g3");
    expect(gleichesGateway("https://api.example.org", "https://API.example.org/")).toBe(true);
    expect(gleichesGateway("https://api.example.org", "https://api.example.org:443")).toBe(true);
    expect(gleichesGateway("http://localhost", "http://localhost:80/")).toBe(true);
    // Der Pfad bleibt bedeutsam — das sind verschiedene Ziele.
    expect(gleichesGateway("https://api.example.org/a", "https://api.example.org/b")).toBe(false);
    expect(gleichesGateway("https://api.example.org", "https://fremd.example.org")).toBe(false);
  });

  test("Userinfo, Query und Fragment machen eine Adresse unvergleichbar", async () => {
    const { gleichesGateway } = await modul("kg1");
    expect(gleichesGateway("https://user@api.example.org", "https://api.example.org")).toBe(false);
    expect(gleichesGateway("https://api.example.org?a=1", "https://api.example.org")).toBe(false);
    expect(gleichesGateway("https://api.example.org#x", "https://api.example.org")).toBe(false);
  });

  test("der abschliessende Punkt im Hostnamen zählt nicht", async () => {
    const { gleichesGateway } = await modul("kg2");
    expect(gleichesGateway("https://api.example.org.", "https://api.example.org")).toBe(true);
  });

  test("fremde Protokolle und unlesbare Werte sind nie gleich", async () => {
    const { gleichesGateway } = await modul("kg3");
    expect(gleichesGateway("file:///etc/passwd", "file:///etc/passwd")).toBe(false);
    expect(gleichesGateway("kein-url", "kein-url")).toBe(false);
  });
});

describe("was ein gescheiterter Login aufräumt", () => {
  const z = mitEigenemHeim("fehlschlag");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  test("ein abgebrochener Wiederholungsversuch lässt die Verbindung in Ruhe", async () => {
    const { aufraeumenNachFehlschlag } = await modul("x1");
    expect(aufraeumenNachFehlschlag(false, true)).toBe("nichts");
  });

  test("ein Versuch, der schon etwas gespeichert hat, räumt auf", async () => {
    const { aufraeumenNachFehlschlag } = await modul("x2");
    expect(aufraeumenNachFehlschlag(true, true)).toBe("alles");
    expect(aufraeumenNachFehlschlag(true, false)).toBe("alles");
  });

  test("ohne vorherige Verbindung bleibt kein halber Zustand", async () => {
    const { aufraeumenNachFehlschlag } = await modul("x3");
    expect(aufraeumenNachFehlschlag(false, false)).toBe("alles");
  });
});

// ── Die Isolation selbst (Bug 7aad5852, 2026-09-27) ─────────────────────────
// Unter Bun folgt os.homedir() einem umgebogenen HOME nicht. Dieser Test hält
// die Voraussetzung fest, auf der alle anderen in dieser Datei stehen.

describe("die Zustandsdatei liegt im umgebogenen Heim", () => {
  const z = mitEigenemHeim("isolation");

  test("STATE_FILE folgt HOME auch unter Bun", async () => {
    const { STATE_FILE } = await import(`../src/auth.ts?iso=${encodeURIComponent(z.heim)}`);
    expect(STATE_FILE).toBe(pfadIn(z.heim));
  });
});

describe("stateHome", () => {
  test("HOME vor USERPROFILE vor homedir()", async () => {
    const { stateHome } = await import("../src/auth.ts");
    expect(stateHome({ HOME: "/h", USERPROFILE: "C:\\u" })).toBe("/h");
    expect(stateHome({ USERPROFILE: "C:\\u" })).toBe("C:\\u");
    expect(stateHome({})).toBe(homedir());
  });
});

describe("Zustandsdatei wird atomar geschrieben", () => {
  const z = mitEigenemHeim("atomar");
  const modul = (marke: string) => import(`../src/auth.ts?${marke}=${encodeURIComponent(z.heim)}`);

  test("ein gescheitertes Schreiben lässt die Anmeldung unversehrt", async () => {
    const { writeConnectorLogin } = await modul("s2");
    const vorher = { schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", connector: CONNECTOR };
    schreibe(z.heim, vorher);
    // A directory where the temporary file would go makes the write fail.
    mkdirSync(`${pfadIn(z.heim)}.${process.pid}.tmp`);

    expect(() => writeConnectorLogin({
      gatewayBaseUrl: GATEWAY, environment: "prod", clubId: "verein-b", connector: CONNECTOR,
    })).toThrow();

    expect(lies(z.heim)).toEqual(vorher);
  });
});
