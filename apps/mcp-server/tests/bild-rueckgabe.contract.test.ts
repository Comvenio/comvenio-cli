/**
 * Vertragstest der Bild-Rueckgabe.
 *
 * Anlass 2026-08-29: Kunden sollen ihre Homepage ueber ChatGPT bauen koennen.
 * Der Mensch kann die Vorschau im Browser pruefen — das Modell nicht. Bis
 * hierher trug jede Tool-Antwort ausschliesslich Text.
 *
 * Der heikle Teil ist nicht das Anhaengen, sondern das HERAUSLOESEN: Die
 * Antwort schickt das ganze Ergebnis als JSON-Text und kuerzt bei 80.000
 * Zeichen. Ein base64-Bild reisst diese Grenze allein — bliebe es im JSON,
 * fiele die Antwort in den Kuerzungszweig und traege am Ende NICHTS, waehrend
 * sie erfolgreich aussieht.
 */
import { describe, expect, test } from "bun:test";

import { bilderHerausloesen } from "../src/domain-runtime.ts";

function ergebnis(screenshots: unknown): Record<string, any> {
  return {
    action_id: "cai.homepage.04.screenshot",
    status: "completed",
    result: { preview_id: "p-1", preview_url: "https://x.test/p", screenshots },
  };
}

describe("Bild-Rueckgabe", () => {
  test("zieht die Bilder heraus und laesst ihre Kenndaten stehen", () => {
    const { rest, bilder } = bilderHerausloesen(
      ergebnis([
        { viewport: "desktop", width: 1280, height: 800, mime_type: "image/jpeg", data_base64: "AAAA", bytes: 3 },
        { viewport: "mobile", width: 390, height: 844, mime_type: "image/jpeg", data_base64: "BBBB", bytes: 3 },
      ]),
    );

    expect(bilder).toEqual([
      { type: "image", data: "AAAA", mimeType: "image/jpeg" },
      { type: "image", data: "BBBB", mimeType: "image/jpeg" },
    ]);

    // Die Kenndaten bleiben — ein Modell soll sagen koennen, welches Bild es
    // beschreibt, ohne die Reihenfolge zu raten.
    const liste = (rest.result as any).screenshots;
    expect(liste[0]).toMatchObject({ viewport: "desktop", width: 1280, data_in_content: true });
    expect(liste[1]).toMatchObject({ viewport: "mobile", height: 844 });
  });

  test("die base64-Daten stehen NICHT mehr im JSON", () => {
    // Der eigentliche Zweck: Sonst faehrt das Bild zweimal mit und reisst die
    // 80.000-Zeichen-Grenze, hinter der die Antwort auf einen Stummel kuerzt.
    const gross = "Z".repeat(120_000);
    const { rest } = bilderHerausloesen(
      ergebnis([{ viewport: "desktop", width: 1280, height: 800, mime_type: "image/jpeg", data_base64: gross, bytes: 90_000 }]),
    );
    const kodiert = JSON.stringify(rest);
    expect(kodiert).not.toContain(gross);
    expect(kodiert.length).toBeLessThan(80_000);
  });

  // ── Gegenrichtung ────────────────────────────────────────────────────────
  // Ohne diese Faelle pruefte der Test nur, dass die Funktion etwas tut — nicht,
  // dass sie die uebrigen 309 Aktionen unangetastet laesst.

  test("ein Ergebnis ohne Bilder bleibt unveraendert", () => {
    const eingang = { action_id: "cai.homepage.03.show", status: "completed", result: { tabs: [1, 2] } };
    const { rest, bilder } = bilderHerausloesen(eingang as any);
    expect(bilder).toEqual([]);
    expect(rest).toBe(eingang as any);
  });

  test("ein result, das kein Objekt ist, wird nicht angefasst", () => {
    const eingang = { action_id: "x", result: "nur ein Text" };
    const { rest, bilder } = bilderHerausloesen(eingang as any);
    expect(bilder).toEqual([]);
    expect(rest).toBe(eingang as any);
  });

  test("ein Eintrag ohne data_base64 bleibt stehen, statt verworfen zu werden", () => {
    // Ein halb gefuellter Eintrag darf nicht lautlos verschwinden — sonst
    // meldet die Antwort weniger Bilder, als der Dienst geliefert hat.
    const { rest, bilder } = bilderHerausloesen(
      ergebnis([
        { viewport: "desktop", mime_type: "image/jpeg", data_base64: "AAAA" },
        { viewport: "mobile", mime_type: "image/jpeg" },
      ]),
    );
    expect(bilder).toHaveLength(1);
    expect((rest.result as any).screenshots).toHaveLength(2);
    expect((rest.result as any).screenshots[1]).toMatchObject({ viewport: "mobile" });
  });

  test("eine leere Screenshot-Liste aendert nichts", () => {
    const eingang = ergebnis([]);
    const { rest, bilder } = bilderHerausloesen(eingang);
    expect(bilder).toEqual([]);
    expect(rest).toBe(eingang);
  });
});
