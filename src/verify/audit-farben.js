// Die Farbrechnung der DOM-Audits — als TEXT ausgeliefert, nicht als Code.
//
// Diese Datei wird von `commands/verify.ts` per Buns Text-Loader importiert
// (`with { type: "text" }`) und in beide Audit-Skripttexte eingesetzt. Der
// Browser bekommt genau diese Bytes.
//
// **Warum nicht `fn.toString()`, wie es hier bis zum 2026-08-31 stand.**
// `bun build --compile` minifiziert. Eine Funktion, die eine andere des
// Moduls rief, kam als `n(...)` im Browser an, und `n` gab es dort nicht —
// der Test war gruen, die ausgelieferte Binary gebrochen. Gegen einen TEXT
// kann die Minifizierung nichts ausrichten.
//
// **Warum die Bezeichner kurz sind.** Der zusammengesetzte Skripttext geht
// als KOMMANDOZEILEN-ARGUMENT an `playwright-cli eval`, und das Werkzeug ist
// ein `.cmd`-Shim: Jeder Aufruf laeuft durch `cmd.exe`. Gemessen auf dem
// Produktionsweg (`Bun.spawn`) liegt die Grenze bei **rund 7950 Zeichen** —
// darueber endet der Aufruf mit "Die Befehlszeile ist zu lang", und der
// Verify-Lauf bricht mit Exit 2 ab.
//
// Der Text lag am 2026-08-31 bei 8406 Zeichen und war damit gebrochen; vor
// dem Umbau waren es 7920, also 30 Zeichen unter der Grenze. Jedes Zeichen
// hier zaehlt doppelt, weil dieser Block in BEIDE Skripttexte geht.
// `tests/verify-audit-regeln.test.ts` haelt die Laenge fest.
//
// **Zwei Bedingungen bleiben:** kein `//`-Kommentar unterhalb der Marke (der
// Text wird komprimiert, ein Zeilenkommentar verschluckt den Rest der Zeile),
// und keine Referenz nach draussen — im Browser gibt es sie nicht.

/* AUDIT-FARBEN */
const toRGB = (v) => {
  if (!v || !v.startsWith("rgb")) return null;
  const p = v.slice(v.indexOf("(") + 1, v.indexOf(")")).split(",").map(Number);
  if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
};
const contrastRatio = (fg, bg) => {
  const L = (c) => {
    const f = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const a = L(fg), b = L(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const istGrosseSchrift = (s, w) => s >= 24 || (s >= 18.66 && w >= 700);
const kontrastSchwelle = (g) => (g ? 3 : 4.5);
