/**
 * Typdeklarationen für Text-Importe (`with { type: "text" }`): Bun liefert
 * den Inhalt als String, TypeScript kennt diesen Loader nicht.
 */

// Customer articles, embedded by packages/kundendoku/src/artikel.generated.ts (03-programm-hilfe).
// Markdown is never a module, so the wildcard cannot hide a wrong import.
declare module "*.md" {
  const text: string;
  export default text;
}
