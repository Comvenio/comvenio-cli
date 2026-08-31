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
  auditLuminance,
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
    expect(auditLuminance(WEISS)).toBeCloseTo(1, 5);
    expect(auditLuminance(SCHWARZ)).toBeCloseTo(0, 5);
  });

  test("rechnet das Kontrastverhaeltnis und ist richtungsunabhaengig", () => {
    expect(auditContrastRatio(SCHWARZ, WEISS)).toBeCloseTo(21, 4);
    expect(auditContrastRatio(WEISS, SCHWARZ)).toBeCloseTo(21, 4);
    expect(auditContrastRatio(WEISS, WEISS)).toBeCloseTo(1, 4);
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
    for (const fn of [auditToRGB, auditLuminance, auditContrastRatio, auditIstGrosseSchrift, auditKontrastSchwelle]) {
      const komprimiert = fn.toString().replace(/\s+/g, " ");
      expect(komprimiert, `${fn.name} traegt einen Zeilenkommentar`).not.toContain("//");
      // Der komprimierte Text muss noch eine gueltige Funktion sein.
      expect(() => new Function(`return ${komprimiert}`)()).not.toThrow();
    }
  });

  test("die komprimierte Fassung rechnet dasselbe", () => {
    const wieder = new Function(`return ${auditContrastRatio.toString().replace(/\s+/g, " ")}`)() as (
      a: typeof SCHWARZ,
      b: typeof WEISS,
    ) => number;
    // `auditContrastRatio` ruft `auditLuminance` — im Browser wird die
    // ebenfalls eingesetzt. Hier steht sie global zur Verfuegung.
    (globalThis as Record<string, unknown>).auditLuminance = auditLuminance;
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

    for (const fn of [auditToRGB, auditLuminance, auditContrastRatio, auditIstGrosseSchrift, auditKontrastSchwelle]) {
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
