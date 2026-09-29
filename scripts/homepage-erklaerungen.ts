/**
 * Shape and parsing of `widget-erklaerungen.json` (comvenio-cli-doku 06
 * §4.1/§4.2 — Widget- und Vorlagen-Erklärungen fürs Kundendokument). Split out
 * of `gen-schema.ts` on purpose: that script runs `process.exit(main())` at
 * import time (see its own end-of-file), so anything a test needs to import
 * directly has to live in a module without that side effect.
 */

export interface ErklaerungsText { de: string; en: string; }
export interface WidgetErklaerung {
  kategorie: string;
  zweck: ErklaerungsText;
  datenquelle: ErklaerungsText;
  macht_oeffentlich: ErklaerungsText;
  passt_zu: { de: string[]; en: string[] };
}
export interface VorlagenErklaerung { zweck: ErklaerungsText; }
export interface ErklaerungenDeklaration {
  widgets: Record<string, WidgetErklaerung>;
  vorlagen: Record<string, VorlagenErklaerung>;
}

/**
 * Parses and validates the CONTENT of `widget-erklaerungen.json` (pure — no
 * filesystem, no `COMVENIO_WEBPAGE_ROOT` indirection), so it is directly
 * testable with a small fixture string. Throws with a field-level message on
 * the first structural problem; `gen-schema.ts`'s `leseErklaerungenDeklaration()`
 * is the only caller in the generator itself and turns that throw into the
 * tolerant `null` fallback — a missing or malformed source is a HINWEIS, not
 * an aborted run, because the source lives in a separate strand (Frontend/web-page)
 * that may not have delivered it yet.
 */
export function parseErklaerungenJson(roh: string): ErklaerungenDeklaration {
  const daten = JSON.parse(roh) as { widgets?: unknown; vorlagen?: unknown };
  if (!daten.widgets || typeof daten.widgets !== "object" || Array.isArray(daten.widgets)) {
    throw new Error("kein widgets-Objekt");
  }
  if (!daten.vorlagen || typeof daten.vorlagen !== "object" || Array.isArray(daten.vorlagen)) {
    throw new Error("kein vorlagen-Objekt");
  }
  const text = (value: unknown, wo: string): ErklaerungsText => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${wo}: kein {de,en}-Objekt`);
    const v = value as Record<string, unknown>;
    if (typeof v.de !== "string" || typeof v.en !== "string") throw new Error(`${wo}: de/en fehlt oder ist kein Text`);
    return { de: v.de, en: v.en };
  };
  const widgets: Record<string, WidgetErklaerung> = {};
  for (const [kind, eintrag] of Object.entries(daten.widgets as Record<string, unknown>)) {
    if (!eintrag || typeof eintrag !== "object" || Array.isArray(eintrag)) throw new Error(`${kind}: kein Objekt`);
    const w = eintrag as Record<string, unknown>;
    if (typeof w.kategorie !== "string") throw new Error(`${kind}.kategorie fehlt`);
    const passtZu = w.passt_zu as Record<string, unknown> | undefined;
    if (!passtZu || !Array.isArray(passtZu.de) || !Array.isArray(passtZu.en)) throw new Error(`${kind}.passt_zu: kein {de,en}-Listenpaar`);
    widgets[kind] = {
      kategorie: w.kategorie,
      zweck: text(w.zweck, `${kind}.zweck`),
      datenquelle: text(w.datenquelle, `${kind}.datenquelle`),
      macht_oeffentlich: text(w.macht_oeffentlich, `${kind}.macht_oeffentlich`),
      passt_zu: { de: passtZu.de as string[], en: passtZu.en as string[] },
    };
  }
  const vorlagen: Record<string, VorlagenErklaerung> = {};
  for (const [id, eintrag] of Object.entries(daten.vorlagen as Record<string, unknown>)) {
    if (!eintrag || typeof eintrag !== "object" || Array.isArray(eintrag)) throw new Error(`vorlagen.${id}: kein Objekt`);
    vorlagen[id] = { zweck: text((eintrag as Record<string, unknown>).zweck, `vorlagen.${id}.zweck`) };
  }
  return { widgets, vorlagen };
}
