// Die Farbrechnung der DOM-Audits — als TEXT ausgeliefert, nicht als Code.
//
// Diese Datei wird von `commands/verify.ts` per Buns Text-Loader importiert
// (`with { type: "text" }`) und in beide Audit-Skripttexte eingesetzt. Der
// Browser bekommt damit genau diese Bytes.
//
// **Warum nicht `fn.toString()`, wie es hier bis zum 2026-08-31 stand.**
// `bun build --compile` minifiziert. Eine Funktion, die eine andere des
// Moduls rief, kam als `n(...)` im Browser an, und `n` gab es dort nicht —
// der Test war gruen, die ausgelieferte Binary gebrochen. Reproduziert:
// unminifiziert 5100.99, minifiziert `ReferenceError: n is not defined`.
//
// Gegen einen TEXT kann die Minifizierung nichts ausrichten. Gemessen: Der
// Import liefert vor und nach `bun build --minify` dieselbe Laenge.
//
// **Zwei Bedingungen bleiben, und beide gelten fuer diese Datei:**
//
//   1. Kein `//`-Kommentar unterhalb der Marke. Der zusammengesetzte
//      Skripttext wird mit `.replace(/\s+/g, " ")` komprimiert, und ein
//      Zeilenkommentar verschluckt dabei den Rest der Zeile. Die Kommentare
//      hier oben stehen ausserhalb: `verify.ts` schneidet ab der Marke.
//
//   2. Kein Import, keine Referenz nach draussen. Im Browser gibt es weder
//      das eine noch das andere.
//
// Beides haelt `tests/verify-audit-regeln.test.ts` fest.

/* AUDIT-FARBEN */
const toRGB = (value) => {
  if (!value || !value.startsWith("rgb")) return null;
  const values = value.slice(value.indexOf("(") + 1, value.indexOf(")")).split(",").map(Number);
  if (values.length < 3 || values.some((item) => Number.isNaN(item))) return null;
  return { r: values[0], g: values[1], b: values[2], a: values[3] ?? 1 };
};

const contrastRatio = (foreground, background) => {
  const leuchtdichte = (color) => {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const a = leuchtdichte(foreground);
  const b = leuchtdichte(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const istGrosseSchrift = (fontSize, fontWeight) =>
  fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);

const kontrastSchwelle = (gross) => (gross ? 3 : 4.5);
