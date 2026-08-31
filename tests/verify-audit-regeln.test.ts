/**
 * TC-11-05 — die Finding-Regeln aus §4.1 des Lastenhefts K11.
 *
 * **Warum es diese Datei bis zum 2026-08-31 nicht gab.** Die Regeln liefen
 * ausschliesslich als TEXT: `HOMEPAGE_AUDIT_JS` in `commands/verify.ts` ist
 * ein Template-Literal, das als Kommandozeilen-Argument an das
 * Playwright-CLI geht. Was nur als String existiert, kann kein Test aufrufen —
 * und AK-B-02 blieb als einzige Zeile der Definition of Done offen, waehrend
 * die anderen sieben erfuellt waren.
 *
 * Die Rechnung steht jetzt in `verify/homepage.ts` und wird dort per
 * `.toString()` in den Skripttext eingesetzt. **Eine Quelle:** Was hier
 * geprueft wird, ist derselbe Code, den der Browser ausfuehrt.
 *
 * **Was diese Datei NICHT prueft, ausdruecklich:** die DOM-Regeln
 * (`empty_main`, `horizontal_overflow`, `invisible_text`) und die
 * Baum-Traversierung von `effectiveBackground`. Sie brauchen ein Layout —
 * `getBoundingClientRect` und `getComputedStyle` liefern ohne echte
 * Rendering-Engine nichts Brauchbares, und ein nachgebautes DOM-Double waere
 * genau der Nachbau, den es zu vermeiden gilt. Sie bleiben dem Browserlauf
 * ueberlassen.
 *
 * Geprueft wird hier die Farbentscheidung — und die ist der Kern der Regel:
 * §4.1 verlangt, dass Bild- und Gradient-Hintergruende **nie** als Pass oder
 * Fail zaehlen, sondern als `unverifiable_background`. Diese Weiche haengt
 * allein an `auditToRGB`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditContrastRatio,
  auditIstGrosseSchrift,
  auditKontrastSchwelle,
  auditToRGB,
} from "../src/verify/homepage.ts";

const SCHWARZ = { r: 0, g: 0, b: 0, a: 1 };
const WEISS = { r: 255, g: 255, b: 255, a: 1 };

describe("§4.1 — Farbentscheidung des DOM-Audits", () => {
  test("liest eine CSS-Farbe in Kanaele", () => {
    expect(auditToRGB("rgb(255, 128, 0)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(auditToRGB("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  test("meldet alles, was keine Vollfarbe ist, als nicht lesbar", () => {
    // Das ist die Weiche zu `unverifiable_background`. Jeder dieser Werte
    // erscheint im Browser als `backgroundColor` oder `backgroundImage`, und
    // keiner davon erlaubt ein Kontrasturteil.
    for (const wert of [
      "none",
      "url(\"/bild.png\")",
      "linear-gradient(90deg, #fff, #000)",
      "transparent",
      "var(--club-bg)",
      "",
      null,
      undefined,
    ]) {
      expect(auditToRGB(wert), `"${String(wert)}" darf nicht als Farbe gelten`).toBeNull();
    }
  });

  test("meldet eine kaputte rgb-Angabe als nicht lesbar", () => {
    expect(auditToRGB("rgb(a, b, c)")).toBeNull();
    expect(auditToRGB("rgb(1, 2)")).toBeNull();
  });

  test("rechnet die Leuchtdichte nach WCAG", () => {
    // Die Leuchtdichte steht seit dem 2026-08-31 LOKAL in
    // `auditContrastRatio` und ist von aussen nicht mehr erreichbar — sie
    // duerfte es nicht sein, sonst bricht der eingesetzte Skripttext nach
    // Minifizierung. Geprueft wird sie ueber ihre Wirkung: Weiss gegen
    // Weiss ist 1, Schwarz gegen Weiss ist 21.
    expect(auditContrastRatio(WEISS, WEISS)).toBeCloseTo(1, 4);
    expect(auditContrastRatio(SCHWARZ, SCHWARZ)).toBeCloseTo(1, 4);
    expect(auditContrastRatio(SCHWARZ, WEISS)).toBeCloseTo(21, 4);
  });

  test("rechnet das Kontrastverhaeltnis und ist richtungsunabhaengig", () => {
    expect(auditContrastRatio(SCHWARZ, WEISS)).toBeCloseTo(21, 4);
    expect(auditContrastRatio(WEISS, SCHWARZ)).toBeCloseTo(21, 4);
    expect(auditContrastRatio(WEISS, WEISS)).toBeCloseTo(1, 4);
  });

  test("faengt vertauschte Luminanzkoeffizienten", () => {
    // **Alle bisherigen Proben waren achromatisch** — Weiss, Schwarz, Grau.
    // Bei denen sind R, G und B gleich, also merkt keine von ihnen, wenn die
    // WCAG-Koeffizienten (0.2126 / 0.7152 / 0.0722) vertauscht werden.
    // Gemessen: weiss/schwarz und grau/weiss liefern mit vertauschten
    // Koeffizienten exakt dasselbe Verhaeltnis.
    //
    // Rot und Blau trennen sie: Rot gegen Weiss ist 5.06, mit vertauschten
    // Koeffizienten 9.71 — und umgekehrt. Gefunden von einer Fremdpruefung.
    const ROT = { r: 220, g: 20, b: 20, a: 1 };
    const BLAU = { r: 20, g: 20, b: 220, a: 1 };
    expect(auditContrastRatio(ROT, WEISS)).toBeCloseTo(5.06, 1);
    expect(auditContrastRatio(BLAU, WEISS)).toBeCloseTo(9.71, 1);
    // Und die Ordnung: Rot ist heller als Blau, also naeher an Weiss.
    expect(auditContrastRatio(ROT, WEISS)).toBeLessThan(auditContrastRatio(BLAU, WEISS));
  });

  test("kennt die Schwellen 4.5 und 3", () => {
    // §4.1: "normale Schrift 4.5:1, grosse Schrift/UI 3:1"
    expect(auditKontrastSchwelle(false)).toBe(4.5);
    expect(auditKontrastSchwelle(true)).toBe(3);
  });

  test("erkennt grosse Schrift nach Groesse UND Gewicht", () => {
    expect(auditIstGrosseSchrift(24, 400)).toBe(true);
    expect(auditIstGrosseSchrift(18.66, 700)).toBe(true);
    // Knapp darunter, und ohne Fettung zaehlt die kleinere Schwelle nicht.
    expect(auditIstGrosseSchrift(18.66, 400)).toBe(false);
    expect(auditIstGrosseSchrift(23.9, 400)).toBe(false);
    expect(auditIstGrosseSchrift(18.65, 700)).toBe(false);
  });

  test("ein grenzwertiges Grau faellt bei normaler Schrift und besteht bei grosser", () => {
    // 3.84:1 — der Bereich, in dem die beiden Schwellen auseinandergehen.
    // Gemessen, nicht geschaetzt: rgb(117) ergibt 4.65 und liegt damit ueber
    // beiden. Der Bereich zwischen 3 und 4.5 liegt bei rgb(120) bis rgb(145).
    const grau = { r: 130, g: 130, b: 130, a: 1 };
    const ratio = auditContrastRatio(grau, WEISS);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(4.5);
    expect(ratio < auditKontrastSchwelle(auditIstGrosseSchrift(16, 400))).toBe(true);
    expect(ratio < auditKontrastSchwelle(auditIstGrosseSchrift(28, 400))).toBe(false);
  });
});

describe("§4.1 — der eingebettete Skripttext", () => {
  /**
   * Der Beleg, dass hier nicht etwas anderes geprueft wird als im Browser
   * laeuft: Der Quelltext der Funktionen ueberlebt die Komprimierung, mit der
   * `verify.ts` das Skript an das Playwright-CLI uebergibt
   * (`.replace(/\s+/g, " ")`).
   *
   * Ein `//`-Kommentar im eingesetzten Code wuerde dabei den Rest der Zeile
   * verschlucken. Bun entfernt Kommentare beim Transpilieren — das ist
   * gemessen, aber es ist eine Eigenschaft des Werkzeugs, keine Zusicherung.
   * Deshalb steht es hier als Fall.
   */
  test("die Funktionen ueberleben die Komprimierung des Skripttexts", () => {
    for (const fn of [auditToRGB, auditContrastRatio, auditIstGrosseSchrift, auditKontrastSchwelle]) {
      const komprimiert = fn.toString().replace(/\s+/g, " ");
      expect(komprimiert, `${fn.name} traegt einen Zeilenkommentar`).not.toContain("//");
      // Der komprimierte Text muss noch eine gueltige Funktion sein.
      expect(() => new Function(`return ${komprimiert}`)()).not.toThrow();
    }
  });

  test("die komprimierte Fassung rechnet dasselbe — ohne Hilfe von aussen", () => {
    const wieder = new Function(`return ${auditContrastRatio.toString().replace(/\s+/g, " ")}`)() as (
      a: typeof SCHWARZ,
      b: typeof WEISS,
    ) => number;
    // KEINE Vorbereitung, kein Eintrag in `globalThis`: Die Funktion muss
    // allein laufen. Die erste Fassung setzte hier `auditLuminance` global —
    // und verdeckte damit genau den Fehler, der die EXE brach.
    expect(wieder(SCHWARZ, WEISS)).toBeCloseTo(21, 4);
  });
});

describe("§4.1 — der zusammengesetzte Skripttext", () => {
  /**
   * Der Skripttext geht als Kommandozeilen-Argument an das Playwright-CLI.
   * Ein Syntaxfehler darin zeigte sich bis zum 2026-08-31 erst im
   * Browserlauf — als "DOM-Audit: Ergebnis war nicht parsebar", also mit
   * einer Meldung, die auf das Ergebnis zeigt statt auf die Ursache.
   *
   * Dieser Fall setzt den Text so zusammen, wie `verify.ts` es tut, und
   * prueft ihn. Er faellt, sobald jemand eine der eingesetzten Funktionen
   * so aendert, dass der Text nicht mehr uebersetzt.
   */
  test("ist nach Einsetzen und Komprimieren gueltiges JavaScript", () => {
    const hier = dirname(fileURLToPath(import.meta.url));
    const quelle = readFileSync(join(hier, "../src/commands/verify.ts"), "utf8");
    const marke = "const HOMEPAGE_AUDIT_JS = `";
    const anfang = quelle.indexOf(marke);
    expect(anfang, "HOMEPAGE_AUDIT_JS steht nicht mehr in verify.ts").toBeGreaterThan(-1);
    const ende = quelle.indexOf("`;", anfang);
    let text = quelle.slice(anfang + marke.length, ende);

    for (const fn of [auditToRGB, auditContrastRatio, auditIstGrosseSchrift, auditKontrastSchwelle]) {
      text = text.replace("${" + fn.name + ".toString()}", fn.toString());
    }

    // Ohne diesen Fall wuerde ein umbenannter Platzhalter unbemerkt bleiben:
    // Der Rest uebersetzt, und im Browser stuende dann eine Template-Marke.
    expect(text, "ein Platzhalter wurde nicht aufgeloest").not.toContain("${");

    const komprimiert = text.replace(/\s+/g, " ");
    expect(komprimiert.length).toBeGreaterThan(3000);
    expect(() => new Function(`return ${komprimiert}`)()).not.toThrow();
  });
});

describe("§4.1 — die eingesetzten Funktionen ueberleben die Minifizierung", () => {
  /**
   * **Der Fall, der am 2026-08-31 gefehlt hat.**
   *
   * Der Skripttext entsteht aus `fn.toString()`. Referenziert eine dieser
   * Funktionen etwas ausserhalb ihrer selbst, steht im eingesetzten Text der
   * NAME dieser Sache — und im Browser gibt es sie nicht. Unminifiziert faellt
   * das nicht auf, solange der Skripttext daneben zufaellig eine Bindung
   * gleichen Namens setzt.
   *
   * **Die ausgelieferte EXE wird minifiziert** (`bun build --compile`), und
   * dann heisst die Funktion `n`:
   *
   *     const contrastRatio = function s(t, c) { let e = n(t) ... }
   *     ReferenceError: n is not defined
   *
   * Der Test war gruen, die EXE gebrochen. Gefunden von einer Fremdpruefung.
   *
   * Dieser Fall baut jede eingesetzte Funktion minifiziert und ruft sie ohne
   * jede Vorbereitung auf. Er faellt, sobald eine von ihnen wieder etwas von
   * aussen braucht.
   */
  test("jede laeuft nach echter Minifizierung allein", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    // Ein eigener Ordner je Lauf: Ein fester Name in tmpdir waere eine
    // geteilte Ressource ohne Besitzer.
    const bau = mkdtempSync(join(tmpdir(), "audit-minify-"));
    try {
      const quelle = join(bau, "quelle.ts");
      const ziel = join(bau, "gebaut.js");
      writeFileSync(
        quelle,
        [
          readFileSync(new URL("../src/verify/homepage.ts", import.meta.url), "utf8"),
          "const proben = [auditToRGB, auditContrastRatio, auditIstGrosseSchrift, auditKontrastSchwelle];",
          "const texte = proben.map((f) => f.toString().replace(/\\s+/g, ' '));",
          "console.log(JSON.stringify(texte));",
        ].join("\n"),
      );

      const bauLauf = Bun.spawnSync(["bun", "build", quelle, "--minify", "--outfile", ziel]);
      expect(bauLauf.exitCode, `bun build: ${bauLauf.stderr.toString()}`).toBe(0);

      const lauf = Bun.spawnSync(["bun", ziel]);
      expect(lauf.exitCode, `Lauf: ${lauf.stderr.toString()}`).toBe(0);
      const texte = JSON.parse(lauf.stdout.toString().trim()) as string[];
      expect(texte).toHaveLength(4);

      // Der Kern: Jede Funktion wird aus ihrem MINIFIZIERTEN Quelltext neu
      // gebaut und aufgerufen — ohne dass irgendetwas anderes bereitsteht.
      const [toRGB, contrast, gross, schwelle] = texte.map(
        (t) => new Function(`return ${t}`)() as (...args: unknown[]) => unknown,
      );
      expect(toRGB!("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
      expect(contrast!({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(21, 4);
      expect(gross!(24, 400)).toBe(true);
      expect(schwelle!(true)).toBe(3);
    } finally {
      rmSync(bau, { recursive: true, force: true });
    }
  });
});
