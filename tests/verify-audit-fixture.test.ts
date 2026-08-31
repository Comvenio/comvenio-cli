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
 * **Wenn `playwright-cli` fehlt, meldet die Datei das und prüft nichts.** Ein
 * übersprungener Test, der so aussieht wie ein bestandener, wäre schlimmer
 * als keiner.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const SITZUNG = "k11-fixture";

/** Ist das Werkzeug da? Ohne es prüft diese Datei nichts. */
function werkzeugDa(): boolean {
  const p = Bun.spawnSync(["playwright-cli", "--version"]);
  return p.exitCode === 0;
}

/**
 * Der Skripttext, genau wie `verify.ts` ihn zusammensetzt.
 *
 * Kein Nachbau: Beide Bausteine werden aus denselben Dateien gelesen, die
 * die Produktion verwendet, und mit derselben Marke verbunden.
 */
type Skript = "AUDIT_JS" | "HOMEPAGE_AUDIT_JS" | "AUDIT_FARBEN_SETZEN";

function auditText(name: Skript): string {
  const MARKE = "/* AUDIT-FARBEN */";
  const farben = readFileSync(join(HIER, "../src/verify/audit-farben.js"), "utf8");
  const farbtext = farben.slice(farben.indexOf(MARKE) + MARKE.length);

  const quelle = readFileSync(join(HIER, "../src/commands/verify.ts"), "utf8");
  const marke = `const ${name} = \``;
  const anfang = quelle.indexOf(marke);
  const ende = quelle.indexOf("`;", anfang);
  const text = quelle.slice(anfang + marke.length, ende).replace("${AUDIT_FARBEN}", farbtext);
  expect(text, "ein Platzhalter wurde nicht aufgeloest").not.toContain("${");
  return text.replace(/\s+/g, " ");
}

/** Eine HTML-Fixture in den Browser laden und den Audit darauf fahren. */
function audit(html: string, welcher: Exclude<Skript, "AUDIT_FARBEN_SETZEN"> = "HOMEPAGE_AUDIT_JS") {
  const url = "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");
  const geladen = Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "goto", url]);
  expect(geladen.exitCode, `goto: ${geladen.stderr.toString()}`).toBe(0);

  // **Der Farbtext geht in einem EIGENEN Aufruf.** Zusammen mit dem Audit
  // waere der Skripttext 8406 Zeichen lang, und unter Windows laeuft jeder
  // `playwright-cli`-Aufruf durch `cmd.exe`: ueber rund 7950 Zeichen endet er
  // mit "Die Befehlszeile ist zu lang". `verify.ts` macht es genauso — dass
  // dieser Test denselben Weg geht, ist der Punkt.
  //
  // Und er gehoert HINTER das `goto`: `window.__auditFarben` haengt am
  // Dokument und ueberlebt keine Navigation.
  const farben = Bun.spawnSync([
    "playwright-cli",
    `-s=${SITZUNG}`,
    "eval",
    auditText("AUDIT_FARBEN_SETZEN"),
  ]);
  expect(farben.exitCode, `Farben setzen: ${farben.stderr.toString()}`).toBe(0);

  const lauf = Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "eval", auditText(welcher)]);
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
  let da = false;
  beforeAll(() => {
    da = werkzeugDa();
    if (!da) {
      // Laut und sichtbar: Diese Datei prueft gerade nichts.
      console.error(
        "\n  playwright-cli fehlt — die DOM-Regeln aus §4.1 werden NICHT geprueft.\n" +
          "  Installation: npm i -g playwright-cli (das CLI nutzt es auch produktiv).\n",
      );
      return;
    }
    // `goto` verlangt ein offenes Fenster; ohne `open` endet es mit 1 und
    // leerem stderr. Gemessen beim ersten Lauf dieser Datei.
    const auf = Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "open"]);
    expect(auf.exitCode, `open: ${auf.stderr.toString()}`).toBe(0);
  });

  afterAll(() => {
    // Der Browser laeuft sonst weiter — eine Sitzung je Testlauf, und keine
    // raeumt sich selbst auf.
    if (da) Bun.spawnSync(["playwright-cli", `-s=${SITZUNG}`, "close"]);
  });

  test("ein Verlauf auf <html> ist unverifiable, niemals contrast", () => {
    if (!da) return;
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

  test("nur versteckter Text laesst main leer", () => {
    if (!da) return;
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

  test("sichtbarer Text laesst main NICHT leer", () => {
    if (!da) return;
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

  test("ein zu schwacher Kontrast wird gemeldet", () => {
    if (!da) return;
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

  test("horizontaler Ueberlauf wird gemeldet", () => {
    if (!da) return;
    const ergebnis = audit(`<!doctype html>
      <html><body style="background: #ffffff; margin: 0">
        <main>
          <p style="color: #111111">Ein Text, und daneben etwas viel zu Breites.</p>
          <div style="width: 5000px; height: 10px; background: #eeeeee"></div>
        </main>
      </body></html>`);

    expect(arten(ergebnis.failures)).toContain("horizontal_overflow");
  });

  test("der generische Audit sieht denselben Verlauf auf <html>", () => {
    if (!da) return;
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
});
