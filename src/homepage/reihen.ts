// Rows and their column widths (Lastenheft homepage-generator/17-designer-struktur
// 10 §4.2/§4.3, D19/D24). The same rules as club-service sanitize_design.py
// (breiten_form_ok, breiten_aus_text) and web-page reihenRegeln.ts: all three
// must agree, or a width the CLI accepts would vanish on the service.

/** 2–4 whole percentages, multiples of 5, each at least 20, summing to 100. */
export function breitenFormOk(werte: unknown): werte is number[] {
  return (
    Array.isArray(werte) &&
    werte.length >= 2 &&
    werte.length <= 4 &&
    werte.every((w) => Number.isInteger(w) && w >= 20 && w % 5 === 0) &&
    werte.reduce((a: number, b: number) => a + b, 0) === 100
  );
}

/** "65 35" → [65, 35] when the form is valid, else null — ASCII digits and HTML whitespace only. */
export function breitenAusText(text: string): number[] | null {
  const teile = text.split(/[ \t\n\f\r]+/).filter(Boolean);
  if (!teile.length || !teile.every((t) => /^[0-9]{1,3}$/.test(t))) return null;
  const werte = teile.map(Number);
  return breitenFormOk(werte) ? werte : null;
}

/** Widths that take effect: valid form and exactly as many as columns. */
export function wirksameBreiten(werte: unknown, spalten: number): number[] | null {
  return breitenFormOk(werte) && werte.length === spalten ? werte : null;
}

/** Columns of a section layout; the fixed-ratio layouts are two columns. */
export function spaltenDesLayouts(layout: string): number {
  if (layout === "full") return 1;
  if (layout === "three-col") return 3;
  if (layout === "four-col") return 4;
  return 2;
}
