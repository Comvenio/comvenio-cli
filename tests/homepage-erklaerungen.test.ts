// Generator-Test mit Fixture (comvenio-cli-doku 06 §4.1/§4.2): prüft die
// Lese-/Validierungslogik, die `gen:schema` auf `widget-erklaerungen.json`
// anwendet, sobald die Quelldatei aus Frontend/web-page existiert. Die
// Fixture ist eine kleine, gültige Auszugsdatei (zwei Widgets, zwei
// Vorlagen), keine echte Registry — die vollen 75/8 prüft TC-01 später gegen
// den echten Baum.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseErklaerungenJson } from "../scripts/homepage-erklaerungen.ts";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "widget-erklaerungen.json");
const fixture = () => readFileSync(FIXTURE_PATH, "utf8");

describe("widget-erklaerungen.json — Parsing (§4.1/§4.2)", () => {
  test("liest Widget- und Vorlagen-Erklärungen aus der Fixture", () => {
    const geparst = parseErklaerungenJson(fixture());
    expect(Object.keys(geparst.widgets).sort()).toEqual(["hero", "news"]);
    expect(geparst.widgets.hero?.kategorie).toBe("inhalt");
    expect(geparst.widgets.hero?.zweck.de).toContain("Aufmacher");
    expect(geparst.widgets.hero?.zweck.en).toContain("opening area");
    expect(geparst.widgets.news?.passt_zu.de).toEqual(["Startseite", "Nachrichtenseite"]);
    expect(Object.keys(geparst.vorlagen).sort()).toEqual(["flex", "modern"]);
    expect(geparst.vorlagen.modern?.zweck.en).toContain("modern surfaces");
  });

  test("echte Umlaute kommen unverändert durch (kein oe/ae/ue-Ersatz)", () => {
    const geparst = parseErklaerungenJson(fixture());
    expect(geparst.widgets.hero?.zweck.de).toMatch(/Überschrift/);
    expect(geparst.widgets.news?.macht_oeffentlich.de).toMatch(/öffentlichen/);
  });

  test("kein widgets-Objekt wird abgelehnt, nicht still als leer gelesen", () => {
    expect(() => parseErklaerungenJson(JSON.stringify({ vorlagen: {} }))).toThrow("kein widgets-Objekt");
  });

  test("kein vorlagen-Objekt wird abgelehnt", () => {
    expect(() => parseErklaerungenJson(JSON.stringify({ widgets: {} }))).toThrow("kein vorlagen-Objekt");
  });

  test("ein Widget ohne kategorie wird mit Feldname benannt, nicht pauschal verworfen", () => {
    const roh = JSON.stringify({
      widgets: { hero: { zweck: { de: "x", en: "x" }, datenquelle: { de: "x", en: "x" }, macht_oeffentlich: { de: "x", en: "x" }, passt_zu: { de: [], en: [] } } },
      vorlagen: {},
    });
    expect(() => parseErklaerungenJson(roh)).toThrow("hero.kategorie fehlt");
  });

  test("passt_zu ohne de/en-Listenpaar wird abgelehnt", () => {
    const roh = JSON.stringify({
      widgets: { hero: { kategorie: "inhalt", zweck: { de: "x", en: "x" }, datenquelle: { de: "x", en: "x" }, macht_oeffentlich: { de: "x", en: "x" }, passt_zu: ["Startseite"] } },
      vorlagen: {},
    });
    expect(() => parseErklaerungenJson(roh)).toThrow("hero.passt_zu");
  });

  test("ein Text ohne de ODER en wird abgelehnt (keine halbe Übersetzung)", () => {
    const roh = JSON.stringify({
      widgets: { hero: { kategorie: "inhalt", zweck: { de: "nur deutsch" }, datenquelle: { de: "x", en: "x" }, macht_oeffentlich: { de: "x", en: "x" }, passt_zu: { de: [], en: [] } } },
      vorlagen: {},
    });
    expect(() => parseErklaerungenJson(roh)).toThrow("hero.zweck");
  });

  test("kaputtes JSON wirft statt leer zurückzukommen", () => {
    expect(() => parseErklaerungenJson("{ das ist kein JSON")).toThrow();
  });

  test("eine Vorlage ohne zweck wird benannt abgelehnt", () => {
    const roh = JSON.stringify({ widgets: {}, vorlagen: { modern: {} } });
    expect(() => parseErklaerungenJson(roh)).toThrow("vorlagen.modern.zweck");
  });
});
