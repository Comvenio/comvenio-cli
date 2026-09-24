// Structural check of a home.json before any browser runs (Lastenheft
// homepage-generator/17-designer-struktur 06 §4.4): R1–R6 per tab. Errors in
// new-format skeletons are actionable — the service would refuse the file.
import { befundeDesReiters, type GeruestBefund, type WidgetRead } from "../homepage/geruest.ts";

type Datei = { slug?: string; sections?: { widgets?: { kind?: string; config?: Record<string, unknown> }[] }[] };

export interface StrukturBefund extends GeruestBefund {
  tab: string;
}

export function strukturBefunde(tabs: readonly Datei[], styles?: readonly { id?: unknown; class?: unknown }[] | null): StrukturBefund[] {
  const ergebnis: StrukturBefund[] = [];
  tabs.forEach((tab, i) => {
    const widgets: WidgetRead[] = (tab.sections ?? []).flatMap((s, j) =>
      (s.widgets ?? []).map((w, k) => ({ id: `${i}.${j}.${k}`, kind: w.kind ?? "", config: w.config ?? {} })),
    );
    for (const b of [...befundeDesReiters(widgets, styles).values()].flat()) ergebnis.push({ ...b, tab: tab.slug ?? String(i) });
  });
  return ergebnis;
}

export function strukturBefundeAlsText(befunde: StrukturBefund[]): string {
  if (!befunde.length) return "Gerüstregeln R1–R6: keine Befunde.";
  return [
    `Gerüstregeln R1–R6: ${befunde.filter((b) => b.schwere === "fehler").length} Fehler, ${befunde.filter((b) => b.schwere === "warnung").length} Warnungen`,
    ...befunde.map((b) => `  ${b.schwere.padEnd(7)} ${b.tab} ${b.regel} ${b.klasse}${b.slot ? ` (${b.slot})` : ""}${b.zeile ? ` Zeile ${b.zeile}` : ""}${b.text ? ` — ${b.text}` : ""}`),
  ].join("\n");
}
