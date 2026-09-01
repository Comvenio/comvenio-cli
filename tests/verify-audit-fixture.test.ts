/**
 * Die DOM-Regeln aus §4.1 — gegen einen echten Browser.
 *
 * **Was hier möglich wurde und vorher nicht ging.** `empty_main`,
 * `horizontal_overflow`, `invisible_text` und die Hintergrund-Traversierung
 * brauchen ein Layout: `getBoundingClientRect` und `getComputedStyle` liefern
 * ohne Rendering-Engine nichts Brauchbares. Sie waren deshalb der einzige
 * Teil von TC-11-05, den kein Test erreichte — und genau dort sassen zwei der
 * vier Fehler, die zwei Fremdvalidierungsrunden fanden:
 *
 *   - Ein Verlauf auf `<html>` wurde nie gesehen; weisser Text darauf ergab
 *     einen falschen `contrast`-Fail statt `unverifiable_background`.
 *   - `empty_main` zählte unsichtbaren Text als Inhalt.
 *
 * Möglich wurde es, weil der Audit seit dem 2026-08-31 als TEXT ausgeliefert
 * wird (`src/verify/audit-farben.js` per Text-Loader). **Es gibt jetzt EINEN
 * Text** — vorher bekam der Browser serialisierten Code und der Test
 * importierte Funktionen, und beide konnten auseinanderlaufen.
 *
 * **Der Weg ist der Produktionsweg:** dasselbe `playwright-cli`, dasselbe
 * `eval`, derselbe zusammengesetzte Skripttext. Die Fixture kommt als
 * `data:`-URL — `file:` ist im Werkzeug gesperrt (gemessen: „Access to
 * 'file:' URL is blocked. Allowed protocols: http:, https:, about:, data:").
 *
 * **Wenn `playwright-cli` fehlt, wird sichtbar UEBERSPRUNGEN** (`skipIf`),
 * nicht still bestanden. Das Werkzeug ist bewusst eine Systemabhaengigkeit
 * und kein npm-Paket (`verify.ts:40`: "NOT embedded") — die Anwendung ruft
 * es ueber den PATH auf, und ein Test soll dieselbe Annahme pruefen.
 *
 * **Offen und ausdruecklich benannt:** In CI laeuft diese Datei damit nicht.
 * Wer sie dort will, braucht einen Schritt, der `@playwright/cli` und einen
 * Browser installiert; das ist eine Betreiberentscheidung ueber Laufzeit und
 * Kosten, keine des Tests. Bis dahin ist die Abdeckung lokal.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const SITZUNG = "k11-fixture";

/**
 * **Fehlt das Werkzeug, wird UEBERSPRUNGEN — nicht bestanden.**
 *
 * Die erste Fassung stieg mit `if (!da) return` aus. Damit meldete der Lauf
 * sechs gruene Faelle, obwohl kein Browser lief: ein uebersprungener Test,
 * der aussieht wie ein bestandener. `skipIf` sagt es in der Ausgabe.
 */
const WERKZEUG_DA = werkzeugDa();
const fall = test.skipIf(!WERKZEUG_DA);

/**
 * Ist das Werkzeug da? Ohne es prüft diese Datei nichts.
 *
 * **`Bun.spawnSync` WIRFT, wenn die Datei fehlt** — es liefert dann keinen
 * Exit-Code ungleich null, sondern eine Ausnahme. Ohne `try` liefe die
 * vorgesehene Meldung nie, und der Testlauf bräche mit einem Fehler ab, der
 * nach einem kaputten Test aussieht statt nach einem fehlenden Werkzeug.
 */
function werkzeugDa(): boolean {
  try {
    return Bun.spawnSync(["playwright-cli", "--version"]).exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Der Skripttext, genau wie `verify.ts` ihn zusammensetzt.
 *
 * Kein Nachbau: Beide Bausteine werden aus denselben Dateien gelesen, die
 * die Produktion verwendet, und mit derselben Marke verbunden.
 */
import {
  AUDIT_HELFER_SETZEN,
  AUDIT_JS,
  HOMEPAGE_AUDIT_JS,
  pw,
} from "../src/commands/verify.ts";

/**
 * **Die Texte werden IMPORTIERT, nicht nachgebaut.**
 *
 * Die erste Fassung dieser Datei schnitt sie per `indexOf` aus dem Quelltext
 * von `verify.ts`. Das ergab einen ANDEREN Text als den gesendeten: Das
 * aeussere Template-Literal wertet Escapes aus, und `HOMEPAGE_AUDIT_JS` trug
 * sechs (`\\s`, `\\/`). Gemessen: 7424 Zeichen gueltiges JavaScript gegen
 * 7418 Zeichen ungueltiges. Die Fixture prueft also einen Text, den die
 * Anwendung nie sendet — und war gruen, waehrend der Produktivlauf mit
 * "Passed function is not well-serializable!" scheiterte.
 *
 * Gefunden von der dritten Fremdvalidierung, belegt am echten Browser.
 */
const komp = (t: string) => t.replace(/\s+/g, " ");
const SKRIPT = {
  AUDIT_JS: komp(AUDIT_JS),
  HOMEPAGE_AUDIT_JS: komp(HOMEPAGE_AUDIT_JS),
} as const;

/** Eine HTML-Fixture in den Browser laden und den Audit darauf fahren. */
function audit(html: string, welcher: keyof typeof SKRIPT = "HOMEPAGE_AUDIT_JS") {
  const url = "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");
  const geladen = Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "goto", url]);
  expect(geladen.exitCode, `goto: ${geladen.stderr.toString()}`).toBe(0);


  // **Der Farbtext geht in einem EIGENEN Aufruf.** Zusammen mit dem Audit
  // waere der Skripttext 8406 Zeichen lang, und unter Windows laeuft jeder
  // `playwright-cli`-Aufruf durch `cmd.exe`: ueber rund 7950 Zeichen endet er
  // mit "Die Befehlszeile ist zu lang". `verify.ts` macht es genauso — dass
  // dieser Test denselben Weg geht, ist der Punkt.
  //
  // Und er gehoert HINTER das `goto`: `window.__auditHelfer` haengt am
  // Dokument und ueberlebt keine Navigation.
  const farben = Bun.spawnSync([
    "playwright-cli",
    `-s=${SITZUNG}`,
    "eval",
    komp(AUDIT_HELFER_SETZEN),
  ]);
  expect(farben.exitCode, `Farben setzen: ${farben.stderr.toString()}`).toBe(0);

  const lauf = Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "eval", SKRIPT[welcher]]);
  expect(lauf.exitCode, `eval: ${lauf.stderr.toString()}`).toBe(0);

  // Das Werkzeug rahmt das Ergebnis in Markdown; die Nutzlast ist der
  // JSON-String hinter "### Result".
  const roh = lauf.stdout.toString();
  const i = roh.indexOf("### Result");
  expect(i, `keine Ergebniszeile im Werkzeugausgang:\n${roh.slice(0, 300)}`).toBeGreaterThan(-1);
  const zeile = roh.slice(i).split("\n")[1]?.trim() ?? "";
  return JSON.parse(JSON.parse(zeile)) as {
    checked_texts: number;
    failures: { kind: string }[];
    unverifiable: { kind: string }[];
  };
}

const arten = (liste: { kind: string }[]) => liste.map((f) => f.kind);

describe("§4.1 im echten Browser", () => {
  beforeAll(() => {
    if (!WERKZEUG_DA) {
      // Laut und sichtbar: Diese Datei prueft gerade nichts.
      console.error(
        "\n  playwright-cli fehlt — die DOM-Regeln aus §4.1 werden NICHT geprueft.\n" +
          "  Installation: npm i -g playwright-cli (das CLI nutzt es auch produktiv).\n",
      );
      return;
    }
    // **Zuerst schliessen, dann oeffnen.**
    //
    // `open` auf eine BEREITS offene Sitzung scheitert mit Exit 1 und leerem
    // stderr — und offen bleibt sie, wenn ein vorheriger Lauf abgebrochen
    // wurde, bevor sein `afterAll` lief. Am 2026-09-01 lagen zwei Sitzungen
    // aus früheren Läufen herum, und die ganze Datei fiel mit „open: " ohne
    // weitere Angabe.
    //
    // Ein Test, der von einem Vorzustand abhängt, ist fragil; das `close`
    // davor kostet nichts und macht ihn wiederholbar. Sein Exit-Code wird
    // bewusst NICHT geprüft: Beim ersten Lauf gibt es nichts zu schliessen,
    // und das ist kein Fehler.
    Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "close"]);

    // `goto` verlangt ein offenes Fenster; ohne `open` endet es mit 1 und
    // leerem stderr. Gemessen beim ersten Lauf dieser Datei.
    const auf = Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "open"]);
    expect(
      auf.exitCode,
      `open: ${auf.stderr.toString()}${auf.stderr.length === 0 ? "(kein stderr — laeuft die Sitzung noch? `playwright-cli list` zeigt es)" : ""}`,
    ).toBe(0);
  });

  afterAll(() => {
    // Der Browser laeuft sonst weiter — eine Sitzung je Testlauf, und keine
    // raeumt sich selbst auf.
    if (WERKZEUG_DA) Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "close"]);
  });

  fall("ein Verlauf auf <html> ist unverifiable, niemals contrast", () => {
    // **Der Fehler, den Runde 1 fand.** `effectiveBackground` endete vor
    // `document.documentElement` und nahm danach Weiss an — weisser Text auf
    // einem Verlauf ergab damit Weiss-gegen-Weiss und einen contrast-Fail.
    const ergebnis = audit(`<!doctype html>
      <html style="background-image: linear-gradient(90deg, #ffffff, #f0f0f0)">
        <body style="background: transparent; margin: 0">
          <main style="background: transparent; padding: 40px">
            <p style="color: #ffffff; font-size: 16px">
              Weisser Text auf einem Verlauf, der auf dem html-Element liegt.
            </p>
          </main>
        </body>
      </html>`);

    expect(arten(ergebnis.unverifiable)).toContain("unverifiable_background");
    expect(arten(ergebnis.failures)).not.toContain("contrast");
    // Und die Gegenrichtung: Der Text wurde NICHT als geprueft gezaehlt.
    expect(ergebnis.checked_texts).toBe(0);
  });

  fall("nur versteckter Text laesst main leer", () => {
    // **Der Fehler, den Runde 2 fand.** `empty_main` nahm `textContent`
    // ungefiltert — ein `<main>`, dessen einziger langer Text `[hidden]`
    // trug, bestand die Pruefung.
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff">
        <main>
          <span hidden>Dieser unsichtbare Text ist deutlich laenger als zwanzig Zeichen.</span>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).toContain("empty_main");
  });

  fall("sichtbarer Text laesst main NICHT leer", () => {
    // Die Gegenprobe. Ohne sie wuerde ein `empty_main`, das immer meldet,
    // den Fall darueber ebenfalls bestehen.
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff">
        <main>
          <p style="color: #111111">Dieser sichtbare Text ist deutlich laenger als zwanzig Zeichen.</p>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).not.toContain("empty_main");
    expect(ergebnis.checked_texts).toBeGreaterThan(0);
  });

  fall("ein zu schwacher Kontrast wird gemeldet", () => {
    // Belegt, dass die Regel ueberhaupt anschlaegt — sonst waere „kein
    // contrast-Fail" im ersten Fall keine Aussage.
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff">
        <main>
          <p style="color: #cccccc; font-size: 16px">Hellgrauer Text auf Weiss, deutlich unter 4.5 zu 1.</p>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).toContain("contrast");
  });

  fall("horizontaler Ueberlauf wird gemeldet", () => {
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff; margin: 0">
        <main>
          <p style="color: #111111">Ein Text, und daneben etwas viel zu Breites.</p>
          <div style="width: 5000px; height: 10px; background: #eeeeee"></div>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).toContain("horizontal_overflow");
  });

  fall("der generische Audit sieht denselben Verlauf auf <html>", () => {
    // `verify.ts` fuehrt ZWEI Audits. Der generische trug bis zum
    // 2026-08-31 eigene Kopien samt derselben Luecke, und zwei Pruefrunden
    // uebersahen ihn. Dieser Fall haelt beide zusammen.
    const ergebnis = audit(
      `<!doctype html>
      <html style="background-image: linear-gradient(90deg, #ffffff, #f0f0f0)">
        <body style="background: transparent">
          <p style="color: #ffffff; font-size: 16px">Weisser Text auf dem Root-Verlauf.</p>
        </body>
      </html>`,
      "AUDIT_JS",
    ) as unknown as { checked: number; fail_count: number; gradient_skipped: number };

    expect(ergebnis.gradient_skipped).toBeGreaterThan(0);
    expect(ergebnis.fail_count).toBe(0);
  });

  fall("visibility-hidden Text laesst main leer", () => {
    // **Befund der dritten Fremdvalidierung.** `isExcluded` kannte nur
    // `display:none`. `visibility:hidden` nimmt einem Element ebenso jede
    // Sichtbarkeit, waehrend seine Geometrie positiv bleibt — `hasBox` liess
    // den Text durch, und `empty_main` sah ein gefuelltes `<main>`.
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff">
        <main>
          <span style="visibility: hidden">Dieser unsichtbare Text ist deutlich laenger als zwanzig Zeichen.</span>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).toContain("empty_main");
  });

  fall("opacity-0 Text laesst main leer", () => {
    // Die dritte Form derselben Unsichtbarkeit. Sie steht hier, weil eine
    // Reparatur, die nur den gemeldeten Fall trifft, die Klasse verfehlt.
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff">
        <main>
          <span style="opacity: 0">Dieser unsichtbare Text ist deutlich laenger als zwanzig Zeichen.</span>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).toContain("empty_main");
  });

  fall("eine Seite kann die Audit-Helfer nicht kapern", () => {
    // **Befund der dritten Fremdvalidierung.** Der geteilte `eval`-Aufruf
    // legt die Helfer auf `window`. `verify url` nimmt beliebige Adressen
    // entgegen — eine Seite kann die Eigenschaft also besetzen und
    // einfrieren. Ohne Formpruefung rechnete der Audit danach mit fremden
    // Funktionen und meldete still falsche Ergebnisse.
    //
    // Erwartet wird kein Ergebnis, sondern ein FEHLER: Ein Audit, der seine
    // Helfer nicht hat, darf nicht "keine Befunde" melden.
    const html = `<!doctype html><html><body style="background:#fff">
      <script>
        Object.defineProperty(window, "__auditHelfer", {
          value: Object.freeze({}), writable: false, configurable: false
        });
      </script>
      <main><p style="color:#111">Ein sichtbarer Text, lang genug fuer die Pruefung.</p></main>
    </body></html>`;
    const url = "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");

    const geladen = Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "goto", url]);
    expect(geladen.exitCode).toBe(0);
    Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "eval", komp(AUDIT_HELFER_SETZEN)]);

    const lauf = Bun.spawnSync([
      "playwright-cli", `-s=${SITZUNG}`, "eval", SKRIPT.HOMEPAGE_AUDIT_JS,
    ]);
    const aus = lauf.stdout.toString() + lauf.stderr.toString();

    expect(
      aus,
      "Der Audit lieferte ein Ergebnis, obwohl die Seite seine Helfer besetzt hat.",
    ).not.toContain("checked_texts");
    expect(aus).toContain("__auditHelfer");
  });

  fall("halbdurchsichtiger Text wird als Kontrastfehler gemeldet", () => {
    // **Der schwerste Befund der vierten Prüfrunde, am echten Browser.**
    // `rgba(0,0,0,0.1)` auf Weiss wurde als deckendes Schwarz gerechnet —
    // 21:1 statt nahezu 1:1. Der Audit liess unlesbaren Text bestehen.
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff">
        <main>
          <p style="color: rgba(0,0,0,0.1); font-size: 16px">Dieser Text ist auf Weiss praktisch unlesbar.</p>
        </main>
      </body></html>`);

    expect(
      arten(ergebnis.failures),
      "Text mit Alpha 0.1 auf Weiss muss als Kontrastfehler gelten.",
    ).toContain("contrast");
  });

  fall("Element-Opazitaet senkt den Kontrast am echten Element", () => {
    // Dieselbe Klasse, andere Ursache: voll deckendes Schwarz, aber das
    // Element steht auf `opacity: 0.15`. Die kumulierte Opazitaet floss
    // bisher nur in die Unsichtbarkeits-Schwelle, nicht in die Farbrechnung.
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff">
        <main>
          <div style="opacity: 0.15">
            <p style="color: #000000; font-size: 16px">Voll deckendes Schwarz, aber das Element ist fast durchsichtig.</p>
          </div>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).toContain("contrast");
  });

  fall("deckender Text bleibt fehlerfrei", () => {
    // Die Gegenprobe. Ohne sie wuerden die zwei Faelle darueber auch dann
    // bestehen, wenn der Audit JEDEN Text als Kontrastfehler meldete.
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff">
        <main>
          <p style="color: #111111; font-size: 16px">Dieser Text ist auf Weiss gut lesbar und ausreichend lang.</p>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).not.toContain("contrast");
    expect(ergebnis.checked_texts).toBeGreaterThan(0);
  });

  fall("eine Seite kann die Helfer nicht durch gefaelschte ersetzen", () => {
    // **Der Provenienz-Angriff, den die vierte Prüfrunde vorgeführt hat.**
    //
    // Eine Formprüfung sieht neun Funktionen und ist zufrieden. Eine Seite
    // kann deshalb einen Accessor vorgeben: Der Setter schluckt den echten
    // Helfersatz, der Getter liefert neun gleichnamige, aber gefälschte —
    // `contrastRatio: () => 21` unterdrückt jeden Kontrastfehler.
    //
    // Was das fängt, ist der Identitätsvergleich im Setzer: gelesen muss
    // dasselbe Objekt sein wie geschrieben. Erwartet wird deshalb ein
    // FEHLER des Setzers, kein Auditergebnis.
    const html = `<!doctype html><html><body style="background:#fff">
      <script>
        var falsch = {
          toRGB: function () { return { r: 0, g: 0, b: 0, a: 1 }; },
          contrastRatio: function () { return 21; },
          istGrosseSchrift: function () { return false; },
          kontrastSchwelle: function () { return 4.5; },
          ueberlagern: function (v) { return v; },
          hasBox: function () { return true; },
          isExcluded: function () { return false; },
          sichtbarerText: function () { return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; },
          effectiveBackground: function () { return { r: 255, g: 255, b: 255, a: 1 }; },
          excludedSelector: "[hidden]"
        };
        Object.defineProperty(window, "__auditHelfer", {
          get: function () { return falsch; },
          set: function () {},
          configurable: false
        });
      </script>
      <main><p style="color:#fefefe">Unlesbarer Text, den ein gefaelschter Audit bestehen liesse.</p></main>
    </body></html>`;
    const url = "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");

    const geladen = Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "goto", url]);
    expect(geladen.exitCode).toBe(0);

    const setzer = Bun.spawnSync([
      "playwright-cli", `-s=${SITZUNG}`, "eval", komp(AUDIT_HELFER_SETZEN),
    ]);
    const aus = setzer.stdout.toString() + setzer.stderr.toString();

    expect(
      aus,
      "Der Setzer hat die Uebernahme nicht bemerkt — eine Seite kann die " +
        "Helfer damit vollstaendig ersetzen, ohne dass ein Fehler entsteht.",
    ).toContain("besetzt");
    expect(aus).not.toContain('"ok"');
  });

  fall("ein nicht zurueckkehrender Getter haengt den Lauf nicht auf", async () => {
    // **Der Bestandsbefund der vierten Prüfrunde.** `pw` wartete ohne Frist
    // auf `proc.exited`. Eine Seite mit `get() { for (;;) {} }` liess das
    // `eval` nie zurückkehren — und damit auch nicht das `finally`, das die
    // Browsersitzung schliesst. `verify url` nimmt beliebige Adressen.
    //
    // **Dieser Fall fährt `pw` selbst**, nicht `playwright-cli` daneben:
    // Die Frist sitzt in `pw`, und ein Test, der sie umgeht, prüft sie nicht.
    // Die erste Fassung dieses Falls tat genau das und hätte den Riegel nie
    // gefangen — sie mass nur den eigenen `spawnSync`-Timeout.
    const html = `<!doctype html><html><body style="background:#fff">
      <script>
        Object.defineProperty(window, "__auditHelfer", {
          get: function () { for (;;) {} },
          configurable: false
        });
      </script>
      <main><p style="color:#111">Ein Text, den der Audit nie erreicht.</p></main>
    </body></html>`;
    const url = "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");

    const vorher = process.env.COMVENIO_PW_FRIST_MS;
    process.env.COMVENIO_PW_FRIST_MS = "4000";
    try {
      await pw(["close"]);
      expect((await pw(["open"])).code, "eigene Sitzung fuer diesen Fall").toBe(0);
      expect((await pw(["goto", url])).code).toBe(0);

      const beginn = Date.now();
      const r = await pw(["eval", SKRIPT.HOMEPAGE_AUDIT_JS]);
      const dauer = Date.now() - beginn;

      expect(
        dauer,
        `Der Aufruf lief ${Math.round(dauer / 1000)} s trotz 4-s-Frist. Ohne ` +
          `Frist haengt er unbegrenzt — das war der Zustand vor dem 2026-09-01.`,
      ).toBeLessThan(20_000);
      expect(r.code, "ein haengender Aufruf darf nicht als Erfolg gelten").not.toBe(0);
      expect(r.stderr).toContain("abgebrochen nach");
    } finally {
      if (vorher === undefined) delete process.env.COMVENIO_PW_FRIST_MS;
      else process.env.COMVENIO_PW_FRIST_MS = vorher;
      await pw(["close"]);
    }
  }, 60_000);
});
