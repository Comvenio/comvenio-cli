/**
 * Typdeklaration für den Text-Import von `audit-farben.js`.
 *
 * `commands/verify.ts` importiert die Datei mit `with { type: "text" }` —
 * Bun liefert dann ihren Inhalt als String. TypeScript kennt diesen Loader
 * nicht und würde die `.js` sonst als Modul auflösen wollen (`TS7016`).
 *
 * **Der Pfad steht ausdrücklich einzeln da, nicht als `*.js`.** Eine
 * Wildcard-Deklaration würde jede JavaScript-Datei im Baum zu einem String
 * erklären, und ein echter Modulimport fiele dann still auf `string` zurück
 * statt einen Typfehler zu melden.
 */
declare module "*/verify/audit-farben.js" {
  const text: string;
  export default text;
}
