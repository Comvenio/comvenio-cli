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
 * **Was diese Datei NICHT prüft, ausdrücklich:** die DOM-Regeln
 * (`empty_main`, `horizontal_overflow`, `invisible_text`) und die
 * Baum-Traversierung von `effectiveBackground`. Sie brauchen ein Layout;
 * `getBoundingClientRect` und `getComputedStyle` liefern ohne
 * Rendering-Engine nichts Brauchbares, und ein nachgebautes DOM-Double wäre
 * genau der Nachbau, den es zu vermeiden gilt. Sie bleiben dem Browserlauf
 * überlassen — die tragende Fassung dafür wäre eine Chromium-Fixture gegen
 * denselben Text, den diese Datei lädt.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  test("traegt keinen Zeilenkommentar unterhalb der Marke", () => {
    // Der Skripttext wird mit `.replace(/\s+/g, " ")` komprimiert; ein
    // `//`-Kommentar verschluckt dabei den Rest der Zeile. Die Kommentare
    // der Datei stehen oberhalb der Marke und werden nicht mitgenommen.
    expect(farbtext()).not.toContain("//");
  });

  test("referenziert nichts von aussen", () => {
    // Der Kern der Bauform: Der Text muss allein laufen. Genau hier brach
    // die alte `toString()`-Fassung nach Minifizierung — `auditContrastRatio`
    // rief ein Modul-`auditLuminance`, das im Browser nicht existierte.
    expect(() => ausDemText()).not.toThrow();
    const { contrastRatio } = ausDemText();
    expect(contrastRatio(SCHWARZ, WEISS)).toBeCloseTo(21, 4);
  });

  test("ueberlebt den Build unveraendert (Byte-Paritaet)", async () => {
    // Die Zusicherung, die `fn.toString()` nicht geben konnte: Ein TEXT
    // bleibt ein TEXT, auch wenn das Bundle minifiziert wird. Gemessen am
    // echten Werkzeug, nicht behauptet.
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const bau = mkdtempSync(join(tmpdir(), "audit-text-"));
    try {
      const eintritt = join(bau, "eintritt.ts");
      const ziel = join(bau, "gebaut.js");
      const quellPfad = join(HIER, "../src/verify/audit-farben.js").replace(/\\/g, "/");
      writeFileSync(
        eintritt,
        `import t from "${quellPfad}" with { type: "text" };\nconsole.log(t.length);\n`,
      );

      const direkt = Bun.spawnSync(["bun", "run", eintritt]);
      expect(direkt.exitCode, `bun run: ${direkt.stderr.toString()}`).toBe(0);

      const gebaut = Bun.spawnSync(["bun", "build", eintritt, "--minify", "--outfile", ziel]);
      expect(gebaut.exitCode, `bun build: ${gebaut.stderr.toString()}`).toBe(0);
      const lauf = Bun.spawnSync(["bun", ziel]);
      expect(lauf.exitCode, `Lauf: ${lauf.stderr.toString()}`).toBe(0);

      expect(lauf.stdout.toString().trim()).toBe(direkt.stdout.toString().trim());
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
  test.each(["AUDIT_JS", "HOMEPAGE_AUDIT_JS"])(
    "%s ist nach Einsetzen und Komprimieren gueltiges JavaScript",
    (name) => {
      const quelle = readFileSync(join(HIER, "../src/commands/verify.ts"), "utf8");
      const marke = `const ${name} = \``;
      const anfang = quelle.indexOf(marke);
      expect(anfang, `${name} steht nicht mehr in verify.ts`).toBeGreaterThan(-1);
      const ende = quelle.indexOf("`;", anfang);
      const text = quelle.slice(anfang + marke.length, ende).replace("${AUDIT_FARBEN}", farbtext());

      expect(text, "ein Platzhalter wurde nicht aufgeloest").not.toContain("${");

      const komprimiert = text.replace(/\s+/g, " ");
      expect(komprimiert.length).toBeGreaterThan(1000);
      expect(() => new Function(`return ${komprimiert}`)()).not.toThrow();
    },
  );
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
   * in einem eigenen Aufruf an die Seite (`AUDIT_FARBEN_SETZEN`), und beide
   * Audits holen sie aus `window.__auditFarben`.
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

  test.each(["AUDIT_JS", "HOMEPAGE_AUDIT_JS", "AUDIT_FARBEN_SETZEN"])(
    "%s bleibt unter der Kommandozeilengrenze",
    (name) => {
      const quelle = readFileSync(join(HIER, "../src/commands/verify.ts"), "utf8");
      const marke = `const ${name} = \``;
      const anfang = quelle.indexOf(marke);
      expect(anfang, `${name} steht nicht mehr in verify.ts`).toBeGreaterThan(-1);
      const ende = quelle.indexOf("`;", anfang);
      const text = quelle
        .slice(anfang + marke.length, ende)
        .replace("${AUDIT_FARBEN}", farbtext())
        .replace(/\s+/g, " ");

      expect(text, "ein Platzhalter wurde nicht aufgeloest").not.toContain("${");
      expect(
        text.length,
        `${name} ist ${text.length} Zeichen lang. Ueber ~7950 bricht der Aufruf ` +
          `unter Windows mit "Die Befehlszeile ist zu lang" ab. Nicht kuerzen, ` +
          `sondern teilen: einen weiteren eval-Aufruf davorsetzen.`,
      ).toBeLessThan(GRENZE);
    },
  );
});
