/**
 * TC-11-05 — die Finding-Regeln aus §4.1 des Lastenhefts K11.
 *
 * **Was hier geprüft wird, sind die ausgelieferten BYTES.** Die Farbrechnung
 * steht in `src/verify/audit-farben.js` und wird von `commands/verify.ts` per
 * Buns Text-Loader importiert (`with { type: "text" }`) und in beide
 * Audit-Skripttexte eingesetzt. Dieser Test lädt dieselbe Datei, schneidet
 * denselben Abschnitt heraus und wertet ihn aus.
 *
 * **Warum nicht mehr `fn.toString()`,** wie es bis zum 2026-08-31 hier stand:
 * `bun build --compile` minifiziert. Eine Funktion, die eine andere des
 * Moduls rief, kam als `n(...)` im Browser an — der Test war grün, die
 * ausgelieferte Binary gebrochen. Gegen einen TEXT kann die Minifizierung
 * nichts ausrichten; gemessen liefert der Import vor und nach
 * `bun build --minify` dieselbe Länge.
 *
 * Die Bauform stammt aus der Fremdvalidierung, die auch den Fehler fand.
 *
 * **Was diese Datei NICHT prüft:** die DOM-Regeln (`empty_main`,
 * `horizontal_overflow`, `invisible_text`) und die Baum-Traversierung von
 * `effectiveBackground`. Sie brauchen ein Layout — das macht seit dem
 * 2026-08-31 `verify-audit-fixture.test.ts` gegen einen echten Chromium,
 * über denselben Weg wie die Produktion.
 *
 * **Und was sie seither zusätzlich prüft:** dass der Text, den die Anwendung
 * SENDET, gültiges JavaScript ist. Der Homepage-Audit stand bis dahin als
 * Template-Literal in `verify.ts`; das wertet Escapes aus, machte aus
 * `/\s+/g` ein `/s+/g` und aus `/\/+$/` ein `//+$/` — einen
 * Zeilenkommentar. Der gesendete Text war damit ungültig, `playwright-cli`
 * meldete "Passed function is not well-serializable!" und dabei **Exit 0**.
 * Der Homepage-Audit hat nie funktioniert, und drei Prüfrunden sahen es
 * nicht, weil alle Tests den Quelltext rekonstruierten statt ihn zu
 * importieren.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// **Die Skripttexte werden IMPORTIERT, nicht aus dem Quelltext gelesen.**
// Am 2026-08-31 lagen beide Wege 6 Zeichen auseinander: Das aeussere
// Template-Literal frass `\\s` und `\\/`, und nur der rekonstruierte Text war
// gueltiges JavaScript — der gesendete nicht. Ein Test, der rekonstruiert,
// prueft einen Text, den niemand ausfuehrt.
import {
  AUDIT_HELFER_SETZEN,
  AUDIT_JS,
  HOMEPAGE_AUDIT_JS,
} from "../src/commands/verify.ts";

const HIER = dirname(fileURLToPath(import.meta.url));
const MARKE = "/* AUDIT-FARBEN */";

/** Genau der Abschnitt, den `verify.ts` in die Skripttexte einsetzt. */
function farbtext(): string {
  const quelle = readFileSync(join(HIER, "../src/verify/audit-farben.js"), "utf8");
  const i = quelle.indexOf(MARKE);
  expect(i, "die Marke steht nicht mehr in audit-farben.js").toBeGreaterThan(-1);
  return quelle.slice(i + MARKE.length);
}

/**
 * Die Funktionen aus dem Text — genau so, wie der Browser sie bekommt:
 * eingesetzt, komprimiert, ohne jede Vorbereitung von aussen.
 */
function ausDemText() {
  const komprimiert = farbtext().replace(/\s+/g, " ");
  const bauen = new Function(`${komprimiert} return { toRGB, contrastRatio, istGrosseSchrift, kontrastSchwelle };`);
  return bauen() as {
    toRGB: (v: string | null | undefined) => { r: number; g: number; b: number; a: number } | null;
    contrastRatio: (a: Farbe, b: Farbe) => number;
    istGrosseSchrift: (size: number, weight: number) => boolean;
    kontrastSchwelle: (gross: boolean) => number;
  };
}

type Farbe = { r: number; g: number; b: number; a: number };
const SCHWARZ: Farbe = { r: 0, g: 0, b: 0, a: 1 };
const WEISS: Farbe = { r: 255, g: 255, b: 255, a: 1 };

describe("§4.1 — Farbentscheidung des DOM-Audits", () => {
  const { toRGB, contrastRatio, istGrosseSchrift, kontrastSchwelle } = ausDemText();

  test("liest eine CSS-Farbe in Kanaele", () => {
    expect(toRGB("rgb(255, 128, 0)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(toRGB("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  test("meldet alles, was keine Vollfarbe ist, als nicht lesbar", () => {
    // Die Weiche zu `unverifiable_background`. Jeder dieser Werte erscheint
    // im Browser als `backgroundColor` oder `backgroundImage`, und keiner
    // erlaubt ein Kontrasturteil. §4.1: "nie als Pass oder Fail zaehlen".
    for (const wert of [
      "none",
      'url("/bild.png")',
      "linear-gradient(90deg, #fff, #000)",
      "transparent",
      "var(--club-bg)",
      "",
      null,
      undefined,
    ]) {
      expect(toRGB(wert), `"${String(wert)}" darf nicht als Farbe gelten`).toBeNull();
    }
  });

  test("meldet eine kaputte rgb-Angabe als nicht lesbar", () => {
    expect(toRGB("rgb(a, b, c)")).toBeNull();
    expect(toRGB("rgb(1, 2)")).toBeNull();
  });

  test("rechnet das Kontrastverhaeltnis und ist richtungsunabhaengig", () => {
    expect(contrastRatio(SCHWARZ, WEISS)).toBeCloseTo(21, 4);
    expect(contrastRatio(WEISS, SCHWARZ)).toBeCloseTo(21, 4);
    expect(contrastRatio(WEISS, WEISS)).toBeCloseTo(1, 4);
  });

  test("faengt vertauschte Luminanzkoeffizienten", () => {
    // Alle anderen Proben sind achromatisch — bei denen sind R, G und B
    // gleich, also merkt keine, wenn die WCAG-Koeffizienten vertauscht
    // werden. Gemessen: grau/weiss liefert vertauscht denselben Wert.
    const ROT: Farbe = { r: 220, g: 20, b: 20, a: 1 };
    const BLAU: Farbe = { r: 20, g: 20, b: 220, a: 1 };
    expect(contrastRatio(ROT, WEISS)).toBeCloseTo(5.06, 1);
    expect(contrastRatio(BLAU, WEISS)).toBeCloseTo(9.71, 1);
    expect(contrastRatio(ROT, WEISS)).toBeLessThan(contrastRatio(BLAU, WEISS));
  });

  test("kennt die Schwellen 4.5 und 3", () => {
    expect(kontrastSchwelle(false)).toBe(4.5);
    expect(kontrastSchwelle(true)).toBe(3);
  });

  test("erkennt grosse Schrift nach Groesse UND Gewicht", () => {
    expect(istGrosseSchrift(24, 400)).toBe(true);
    expect(istGrosseSchrift(18.66, 700)).toBe(true);
    expect(istGrosseSchrift(18.66, 400)).toBe(false);
    expect(istGrosseSchrift(23.9, 400)).toBe(false);
    expect(istGrosseSchrift(18.65, 700)).toBe(false);
  });

  test("ein grenzwertiges Grau faellt bei normaler Schrift und besteht bei grosser", () => {
    // 3.84:1 — gemessen, nicht geschaetzt. Der Bereich zwischen 3 und 4.5
    // liegt bei rgb(120) bis rgb(145).
    const grau: Farbe = { r: 130, g: 130, b: 130, a: 1 };
    const ratio = contrastRatio(grau, WEISS);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(4.5);
    expect(ratio < kontrastSchwelle(istGrosseSchrift(16, 400))).toBe(true);
    expect(ratio < kontrastSchwelle(istGrosseSchrift(28, 400))).toBe(false);
  });
});

describe("§4.1 — der ausgelieferte Text", () => {
  test.each([
    ["audit-farben.js", "/* AUDIT-FARBEN */"],
    ["audit-dom.js", "/* AUDIT-DOM */"],
  ])("%s traegt keinen Zeilenkommentar unterhalb der Marke", (datei, marke) => {
    // Der Skripttext wird mit `.replace(/\s+/g, " ")` komprimiert; ein
    // `//`-Kommentar verschluckt dabei den Rest der Zeile. Erklaerungen
    // gehoeren oberhalb der Marke — von dort faehrt nichts mit.
    //
    // `audit-homepage.js` fehlt hier bewusst: Sein Rumpf enthaelt URLs
    // (`https://...`), und die tragen ein `//`, das kein Kommentar ist. Fuer
    // ihn prueft der Syntax-Riegel weiter unten die Wirkung statt der
    // Schreibweise — die staerkere Fassung, nur hier nicht fuer alle
    // moeglich.
    const quelle = readFileSync(join(HIER, "../src/verify/", datei), "utf8");
    const rumpf = quelle.slice(quelle.indexOf(marke) + marke.length);
    expect(rumpf, `${datei} traegt einen Zeilenkommentar im Rumpf`).not.toContain("//");
  });

  test("referenziert nichts von aussen", () => {
    // Der Kern der Bauform: Der Text muss allein laufen. Genau hier brach
    // die alte `toString()`-Fassung nach Minifizierung — `auditContrastRatio`
    // rief ein Modul-`auditLuminance`, das im Browser nicht existierte.
    expect(() => ausDemText()).not.toThrow();
    const { contrastRatio } = ausDemText();
    expect(contrastRatio(SCHWARZ, WEISS)).toBeCloseTo(21, 4);
  });

  test.each([
    "audit-farben.js",
    "audit-dom.js",
    "audit-homepage.js",
  ])("%s ueberlebt den Build unveraendert (Byte-Paritaet)", async (datei) => {
    // Die Zusicherung, die `fn.toString()` nicht geben konnte: Ein TEXT
    // bleibt ein TEXT, auch wenn das Bundle minifiziert wird.
    //
    // **Verglichen wird ein HASH, nicht die Laenge.** Die dritte
    // Fremdvalidierung hat das benannt: Zwei Texte gleicher Laenge koennen
    // verschieden sein, und der alte Test verglich nur `t.length`.
    //
    // Und der Weg fuehrt durch den echten Interpreter, nicht durch einen
    // Vergleich gegen das Binary: Bun bettet den Text als String-Literal
    // ein, mit Escapes fuer Zeilenumbruch, CR, Anfuehrungszeichen,
    // Backslash UND Nicht-ASCII (`\\xFC` fuer `ue`). Wer die nachbaut,
    // baut Syntax nach, die die Sprache schon kennt — beim Messen am
    // 2026-08-31 kostete das drei falsche "ungleich"-Meldungen.
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const bau = mkdtempSync(join(tmpdir(), "audit-text-"));
    try {
      const eintritt = join(bau, "eintritt.ts");
      const ziel = join(bau, "gebaut.js");
      const quellPfad = join(HIER, "../src/verify/", datei).replace(/\\/g, "/");
      writeFileSync(
        eintritt,
        `import t from "${quellPfad}" with { type: "text" };\n` +
          `const h = new Bun.CryptoHasher("sha256"); h.update(t);\n` +
          `console.log(t.length + " " + h.digest("hex"));\n`,
      );

      const direkt = Bun.spawnSync(["bun", "run", eintritt]);
      expect(direkt.exitCode, `bun run: ${direkt.stderr.toString()}`).toBe(0);

      const gebaut = Bun.spawnSync(["bun", "build", eintritt, "--minify", "--outfile", ziel]);
      expect(gebaut.exitCode, `bun build: ${gebaut.stderr.toString()}`).toBe(0);
      const lauf = Bun.spawnSync(["bun", ziel]);
      expect(lauf.exitCode, `Lauf: ${lauf.stderr.toString()}`).toBe(0);

      const vorher = direkt.stdout.toString().trim();
      // Die Meldung nennt, WAS kam — nicht nur, dass es falsch war. Die
      // erste Fassung sagte "der Eintritt gab nichts aus", und tatsächlich
      // gab er das Richtige aus: Das Muster hieß `\\d` statt `\d` und suchte
      // damit einen literalen Backslash. Eine Meldung ohne den Istwert
      // schickt die Suche an die falsche Stelle.
      expect(
        vorher,
        `Der Eintritt gab "${vorher}" aus, erwartet war "<laenge> <sha256>".`,
      ).toMatch(/^[0-9]+ [0-9a-f]{64}$/);
      expect(
        lauf.stdout.toString().trim(),
        `${datei} kommt nach dem Build anders an als davor. Ein TEXT darf die ` +
          `Minifizierung unveraendert ueberstehen — laeuft er ueber einen ` +
          `anderen Loader?`,
      ).toBe(vorher);
    } finally {
      rmSync(bau, { recursive: true, force: true });
    }
  });
});

describe("§4.1 — die zusammengesetzten Skripttexte", () => {
  /**
   * `verify.ts` führt ZWEI Audits: `AUDIT_JS` (generischer Kontrast-Audit)
   * und `HOMEPAGE_AUDIT_JS` (die Matrix je Tab und Viewport). Beide setzen
   * denselben Farbtext ein.
   *
   * Ein Test, der nur einen prüft, lässt den anderen driften — genau das
   * ist passiert: Der generische Audit trug bis zum 2026-08-31 eigene Kopien
   * samt einer `<html>`-Lücke, und zwei Prüfrunden übersahen ihn.
   */
  const SKRIPTE: Record<string, string> = {
    AUDIT_JS,
    HOMEPAGE_AUDIT_JS,
    AUDIT_HELFER_SETZEN,
  };

  test.each(Object.keys(SKRIPTE))(
    "%s ist nach dem Komprimieren gueltiges JavaScript",
    (name) => {
      const text = SKRIPTE[name]!;
      expect(text, "ein Platzhalter wurde nicht aufgeloest").not.toContain("${");

      const komprimiert = text.replace(/\s+/g, " ");
      expect(komprimiert.length).toBeGreaterThan(700);
      expect(
        () => new Function(`return ${komprimiert}`)(),
        `${name} ist kein gueltiges JavaScript. playwright-cli meldet das als ` +
          `"Passed function is not well-serializable!" — MIT Exit 0, also ` +
          `unbemerkt. Steht der Text als Template-Literal in verify.ts? Dann ` +
          `gehoert er in eine eigene .js-Datei (siehe audit-homepage.js).`,
      ).not.toThrow();
    },
  );

  test("kein Skripttext-Literal in verify.ts traegt einen Backslash", () => {
    // **Der strukturelle Riegel.** Ein Template-Literal wertet Escapes aus;
    // ein Dateiinhalt nicht. Wo ein Skripttext einen Backslash braucht
    // (jeder nicht-triviale Regex), gehoert er in eine .js-Datei.
    const quelle = readFileSync(join(HIER, "../src/commands/verify.ts"), "utf8");
    const gefunden: string[] = [];

    for (const m of quelle.matchAll(/(?:export )?const (\w*(?:JS|SETZEN|AUDIT)\w*) = `/g)) {
      const ab = m.index! + m[0].length;
      const bis = quelle.indexOf("`;", ab);
      // Ein Backslash, nicht zwei. Die erste Fassung stand hier als
      // `includes("\\\\")` — geschrieben von einem Skript, das dabei eine
      // Escape-Schicht verlor, und damit suchte der Riegel etwas, das im
      // Bestand nicht vorkommt. Er schwieg zur Mutationsprobe, die genau
      // seinen Fall herstellte; gefunden hat es nicht das Lesen, sondern
      // die Frage, warum er nicht anschlug.
      if (quelle.slice(ab, bis).includes(String.fromCharCode(92))) {
        gefunden.push(m[1]!);
      }
    }

    expect(
      gefunden,
      `Diese Skripttexte stehen als Template-Literal in verify.ts und tragen ` +
        `einen Backslash. Das Literal frisst ihn: aus /\\s+/g wird /s+/g, aus ` +
        `/\\/+$/ wird //+$/ — ein Zeilenkommentar. Der gesendete Text ist dann ` +
        `kein gueltiges JavaScript. Ausweg: eigene .js-Datei per Text-Loader.`,
    ).toEqual([]);
  });
});

describe("§4.1 — die Laenge der Skripttexte", () => {
  /**
   * **Der Riegel, der am 2026-08-31 gefehlt hat.**
   *
   * Der Skripttext geht als KOMMANDOZEILEN-ARGUMENT an `playwright-cli
   * eval`, und das Werkzeug ist ein `.cmd`-Shim: Jeder Aufruf laeuft durch
   * `cmd.exe`. Gemessen auf dem Produktionsweg (`Bun.spawn`, binaere Suche)
   * liegt die Grenze bei **rund 7950 Zeichen** — darueber endet der Aufruf
   * mit "Die Befehlszeile ist zu lang", und der Verify-Lauf bricht mit
   * Exit 2 ab.
   *
   * **Der Text war gebrochen und niemand merkte es:** 8406 Zeichen nach dem
   * Umbau auf den Text-Loader; vor dem Umbau 7920, also 30 Zeichen unter der
   * Grenze. Keine Messung sprach darueber, und die Suite lief gruen, weil
   * kein Test den Browser bemueht.
   *
   * Die Reparatur war nicht Kuerzen, sondern Teilen: Die Farbrechnung geht
   * in einem eigenen Aufruf an die Seite (`AUDIT_HELFER_SETZEN`), und beide
   * Audits holen sie aus `window.__auditHelfer`.
   *
   * **Die Schwelle kommt aus der Messung, nicht aus dem Ist-Stand.**
   * Gemessene Untergrenze 7926, minus 400 Zeichen Sicherheitsabstand fuer
   * das, was neben dem Skript in der Kommandozeile steht: Programmpfad,
   * Sitzungsflag, `eval`. Der Pfad ist rechnerabhaengig — hier
   * `playwright-cli`, anderswo womoeglich ein langer `node_modules`-Pfad.
   *
   * **Der Ist-Stand liegt bei 7424, also 76 Zeichen unter der Schwelle.**
   * Das ist wenig, und es ist die ehrliche Lage: Die naechste Regel bringt
   * den Text darueber. Dann wird NICHT die Schwelle erhoeht, sondern
   * geteilt — der naechste Schnitt ist gemessen und liegt bereit:
   * `isExcluded` (241), `effectiveBackground` (473) und `sichtbarerText`
   * (289) stehen nur im Homepage-Audit und ergeben zusammen 1003 Zeichen.
   * Sie haengen an drei freien Referenzen (`excludedSelector`, `hasBox`,
   * `toRGB`), die mitwandern muessen — deshalb ein eigener Schnitt und
   * nicht einer fuer nebenbei.
   */
  const GRENZE = 7500;

  test.each([
    ["AUDIT_JS", AUDIT_JS],
    ["HOMEPAGE_AUDIT_JS", HOMEPAGE_AUDIT_JS],
    ["AUDIT_HELFER_SETZEN", AUDIT_HELFER_SETZEN],
  ] as const)("%s bleibt unter der Kommandozeilengrenze", (name, roh) => {
    // Gemessen wird der Wert, den die Anwendung SENDET — komprimiert, wie
    // `verify.ts` es vor jedem `eval` tut.
    const text = roh.replace(/\s+/g, " ");
    expect(text, "ein Platzhalter wurde nicht aufgeloest").not.toContain("${");
    expect(
      text.length,
      `${name} ist ${text.length} Zeichen lang. Ueber ~7950 bricht der Aufruf ` +
        `unter Windows mit "Die Befehlszeile ist zu lang" ab. Nicht kuerzen, ` +
        `sondern teilen: einen weiteren eval-Aufruf davorsetzen.`,
    ).toBeLessThan(GRENZE);
  });
});

describe("§4.1 — die Verdrahtung des Helfer-Aufrufs", () => {
  /**
   * **Was die Fixture NICHT prüfen kann.**
   *
   * Sie setzt die Helfer selbst, bevor sie den Audit fährt — sie muss das,
   * denn sie ruft `playwright-cli` direkt. Damit bliebe sie auch dann grün,
   * wenn der Produktionsaufruf aus `verify.ts` verschwände. Die dritte
   * Fremdvalidierung hat genau das benannt.
   *
   * Dieser Riegel prüft deshalb den Quelltext: In jedem Pfad, der einen
   * Audit fährt, muss davor ein `AUDIT_HELFER_SETZEN` stehen.
   *
   * Ein Quelltext-Riegel prüft einen Ort, keine Eigenschaft — das ist die
   * schwächere Bauform. Sie ist hier die einzig mögliche: Ob ein Aufruf
   * VORHER kam, ist zur Laufzeit nicht mehr sichtbar, wenn er fehlt. Dann
   * fehlen die Helfer, und seit der Formprüfung wirft der Audit — was aber
   * erst im Lauf gegen einen echten Browser auffiele.
   */
  const quelle = () => readFileSync(join(HIER, "../src/commands/verify.ts"), "utf8");

  test.each(["AUDIT_JS", "HOMEPAGE_AUDIT_JS"])(
    "vor jedem %s-Aufruf steht ein Helfer-Aufruf",
    (name) => {
      const q = quelle();

      // **Textsuche statt `new RegExp`.** Ein zusammengesetztes Muster mit
      // Escapes ist genau der unbegrenzte Randfallraum, vor dem der Vertrag
      // warnt — und die erste Fassung dieser Zeile fiel prompt darauf herein
      // (`missing terminating ] for character class`, weil der Backslash
      // beim Schreiben eine Schicht verlor). Gesucht wird eine feste
      // Zeichenfolge; die kann nicht falsch gemeint sein.
      const muster = `pw(["eval", ${name}.`;
      const aufrufe: number[] = [];
      for (let i = q.indexOf(muster); i >= 0; i = q.indexOf(muster, i + 1)) {
        aufrufe.push(i);
      }
      expect(
        aufrufe.length,
        `${name} wird nirgends per eval gefahren — ist der Aufruf umbenannt?`,
      ).toBeGreaterThan(0);

      for (const stelle of aufrufe) {
        // Der Setzer muss im selben Block unmittelbar davor stehen. 600
        // Zeichen decken den Aufruf samt Fehlerbehandlung; mehr waere kein
        // "unmittelbar davor" mehr.
        const davor = q.slice(Math.max(0, stelle - 600), stelle);
        expect(
          davor,
          `Vor diesem ${name}-Aufruf steht kein AUDIT_HELFER_SETZEN. Ohne ihn ` +
            `fehlt window.__auditHelfer, und der Audit wirft. Der Setzer gehoert ` +
            `HINTER jedes goto — die Eigenschaft haengt am Dokument.`,
        ).toContain("AUDIT_HELFER_SETZEN");
      }
    },
  );

  test("zwischen Setzer und Audit steht keine Navigation", () => {
    // `window.__auditHelfer` ueberlebt kein `goto`, `reload` oder `back`.
    const q = quelle();
    const setzer = "AUDIT_HELFER_SETZEN.replace";
    for (let i = q.indexOf(setzer); i >= 0; i = q.indexOf(setzer, i + 1)) {
      const kandidaten = ["AUDIT_JS.replace", "HOMEPAGE_AUDIT_JS.replace"]
        .map((k) => q.indexOf(k, i + setzer.length))
        .filter((n) => n > 0);
      if (kandidaten.length === 0) continue;
      const dazwischen = q.slice(i, Math.min(...kandidaten));
      for (const befehl of ['"goto"', '"reload"', '"back"', '"open"']) {
        expect(
          dazwischen,
          `Zwischen dem Helfer-Aufruf und dem Audit steht ${befehl}. Die ` +
            `Navigation loescht window.__auditHelfer.`,
        ).not.toContain(befehl);
      }
    }
  });
});
