import type { CAC } from "cac";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// Der Browser bekommt genau diese Bytes. Byte-Paritaet statt
// `Function.toString()`: Gegen einen TEXT kann die Minifizierung nichts
// ausrichten, gegen serialisierten Code schon (siehe Kopf der Datei).
import auditFarbenQuelle from "../verify/audit-farben.js" with { type: "text" };
import homepageAuditQuelle from "../verify/audit-homepage.js" with { type: "text" };
import auditDomQuelle from "../verify/audit-dom.js" with { type: "text" };
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";
import {
  actionableConsoleErrors,
  applyFrontendBase,
  artifactSegment,
  classifyVerificationExit,
  failedSameOriginRequests,
  normalizeHomepageTabs,
  resolveLiveHomepageUrl,
  sanitizeArtifactUrl,
  selectHomepageViewports,
  withImprintRoute,
  withTabQuery,
  type HomepageTab,
  type VerifyFinding,
  type UnverifiableFinding,
} from "../verify/homepage.ts";

// K11 — `comvenio verify <action>`: render a Comvenio web page headless and drop
// screenshots so the operating agent can SEE the result (Lastenheft Sub-File 11).
//   verify url <url>
//   verify event <event-id> [--child <id>] [--area <id>] [--token <t>]
//   verify menu <menu-id> [--print]
//   verify homepage [--file home.json]      (default: live {subdomain}.web.comvenio.app)
//   verify news <news-id>
//   verify certificate <honor-id>           (fetch-then-render HTML, RBAC manage_honors)
//
// Render tool = the systemwide `playwright-cli` (NOT embedded; called via Bun.spawn,
// same pattern as homepage.ts::openInBrowser). Targets are public; certificate +
// homepage --file fetch token-guarded in the CLI (the token works in the CLI, not
// the browser). gateway keys: "club" → club-service, "member" → member-service.

const OUT_DIR = ".comvenio-verify";
const PW_SESSION = "-s=cvn-verify";
const DEFAULT_WAIT_MS = 1500; // SPA settle time between open and screenshot

// Frontend base ≠ gateway base (Architektur-Anker 1). The HTTP client speaks the
// gateway (api.comvenio.app); verify RENDERS the frontend (web.comvenio.app).
function frontendBase(env: string, override?: string): string {
  if (override) return override.replace(/\/+$/, "");
  return env === "dev" ? "https://web.dev.comvenio.app" : "https://web.comvenio.app";
}

type PwResult = { code: number; stdout: string; stderr: string };

/**
 * Wie lange ein einzelner `playwright-cli`-Aufruf laufen darf.
 *
 * **Ohne Frist haengt der ganze Verify-Lauf unbegrenzt.** Die vierte
 * Pruefrunde hat den Fall benannt: Eine untersuchte Seite kann
 * `window.__auditHelfer` als Getter definieren, der nie zurueckkehrt
 * (`get() { for (;;) {} }`). Das `eval` kehrt dann nicht zurueck, `proc.exited`
 * loest nie auf, und auch das `finally`, das die Browsersitzung schliesst,
 * wird nie erreicht. `verify url` nimmt beliebige Adressen entgegen.
 *
 * **Ueber `COMVENIO_PW_FRIST_MS` einstellbar — damit ein Test sie pruefen
 * kann.** Eine Frist, die niemand herabsetzen kann, ist nicht belegbar: Der
 * Testfall muesste zwei Minuten warten. Die Mutationsprobe vom 2026-09-01
 * meldete GRUEN, als die Frist entfernt wurde — sie war unbelegt.
 *
 * 120 s liegen deutlich ueber dem, was ein Audit braucht (gemessen: die
 * Chromium-Fixture faehrt neun Faelle inklusive Browserstart in rund 20 s)
 * und deutlich unter dem, was ein Mensch als "haengt" empfindet.
 */
const pwFrist = () => Number(process.env.COMVENIO_PW_FRIST_MS) || 120_000;

// Run one playwright-cli subcommand in the shared verify session.
export async function pw(args: string[]): Promise<PwResult> {
  const proc = Bun.spawn(["playwright-cli", PW_SESSION, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const frist = pwFrist();

  // **Das Ergebnis wird gegen die Frist gerennt, nicht nur der Prozess
  // gekillt.**
  //
  // Die erste Fassung setzte einen Wecker, rief `proc.kill()` und wartete
  // danach weiter auf `proc.exited` und die Streams. Gemessen am 2026-09-01:
  // Der Aufruf kehrte trotzdem nicht zurueck — `playwright-cli` ist unter
  // Windows ein `.cmd`-Shim, `kill` trifft die Huelle und nicht den
  // Node-Prozess darunter, und die Pipes bleiben offen.
  //
  // `Promise.race` loest das an der richtigen Stelle: Der Aufrufer wartet
  // nicht laenger als die Frist, unabhaengig davon, ob der Prozess sich
  // beenden laesst. Der `kill`-Versuch bleibt — er raeumt auf, wo er kann.
  const ergebnis = (async (): Promise<PwResult> => {
    const code = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { code, stdout, stderr };
  })();

  let wecker: ReturnType<typeof setTimeout> | undefined;
  const abbruch = new Promise<PwResult>((loese) => {
    wecker = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Der Prozess laesst sich nicht beenden — der Aufrufer kehrt
        // trotzdem zurueck, und das ist der Zweck dieser Frist.
      }
      loese({
        code: 1,
        stdout: "",
        stderr:
          `[abgebrochen nach ${frist / 1000} s: "${args[0]}" kehrte nicht ` +
          `zurueck. Die untersuchte Seite kann das ausloesen — etwa mit einem ` +
          `Getter, der nicht zurueckkehrt.]`,
      });
    }, frist);
  });

  try {
    return await Promise.race([ergebnis, abbruch]);
  } finally {
    if (wecker !== undefined) clearTimeout(wecker);
  }
}


// Pre-flight: is playwright-cli on PATH? (External dependency, no embed.)
async function hasPlaywrightCli(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["playwright-cli", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type VerifyOpts = {
  json?: boolean;
  club?: string;
  out?: string;
  desktopOnly?: boolean;
  mobileOnly?: boolean;
  snapshot?: boolean; // cac: --no-snapshot → false
  console?: boolean; // cac: --no-console → false
  wait?: string;
  child?: string;
  area?: string;
  token?: string;
  print?: boolean;
  file?: string;
  designFile?: string;
  frontendBase?: string;
  audit?: boolean;
};

type AuditResult = {
  checked: number;
  fail_count: number;
  invisible_texts: number;
  gradient_skipped?: number;
  worst: Array<{ text: string; ratio: number; fg: string; bg: string; size: number }>;
};

type VerifyResult = {
  url: string;
  screenshots: { desktop?: string; mobile?: string };
  console_errors: string[];
  snapshot_taken: boolean;
  render_ms: number;
  audit?: AuditResult;
};

type DomAuditFinding = {
  kind: "horizontal_overflow" | "empty_main" | "invisible_text" | "contrast";
  message: string;
  details?: Record<string, unknown>;
};

type DomAuditResult = {
  checked_texts: number;
  failures: DomAuditFinding[];
  unverifiable: Array<{
    kind: "unverifiable_background";
    message: string;
    details?: Record<string, unknown>;
  }>;
};

type HomepageMatrixPoint = {
  tab: string;
  viewport: string;
  width: number;
  height: number;
  url: string;
  screenshot?: string;
  snapshot?: string;
  render_ms: number;
  completed: boolean;
};

type HomepageVerifyReport = {
  passed: boolean;
  incomplete: boolean;
  exit_code: 0 | 2 | 4;
  url: string;
  tabs: string[];
  viewports: Array<{ name: string; width: number; height: number }>;
  matrix: HomepageMatrixPoint[];
  failures: VerifyFinding[];
  unverifiable: UnverifiableFinding[];
  infrastructure_errors: string[];
  report_file: string;
};

// Die Farbrechnung kommt aus `verify/audit-farben.js` und wird ab der
// Marke uebernommen. Alles davor sind Kommentare der Datei und gehoert
// nicht in den Browser.
// Exportiert, damit Tests GENAU diesen Wert pruefen statt ihn aus dem
// Quelltext zu rekonstruieren. Am 2026-08-31 lagen beide Wege 6 Zeichen
// auseinander, und nur der rekonstruierte war gueltiges JavaScript.
export const AUDIT_FARBEN = auditFarbenQuelle.slice(
  auditFarbenQuelle.indexOf("/* AUDIT-FARBEN */") + "/* AUDIT-FARBEN */".length,
);

// **Der Homepage-Audit kommt aus einer DATEI, nicht aus einem Literal.**
//
// Ein Template-Literal wertet Escape-Sequenzen aus. Der Rumpf traegt Regexe
// mit Backslash; bis zum 2026-08-31 wurde daraus im gesendeten Text
// `/s+/g` statt `/\s+/g` und `//+$/` statt `/\/+$/` — letzteres ein
// Zeilenkommentar, der den Rest der Zeile frass. Der Text war damit KEIN
// gueltiges JavaScript, `playwright-cli` meldete
// "Passed function is not well-serializable!" und dabei Exit 0.
//
// Ein Dateiinhalt durchlaeuft diese Auswertung nicht. `verify-audit-regeln`
// haelt fest, dass in keinem Skripttext-Literal ein Backslash steht.
const DOM_MARKE = "/* AUDIT-DOM */";
export const AUDIT_DOM = auditDomQuelle.slice(
  auditDomQuelle.indexOf(DOM_MARKE) + DOM_MARKE.length,
);

const HOMEPAGE_MARKE = "/* AUDIT-HOMEPAGE */";
export const HOMEPAGE_AUDIT_JS = homepageAuditQuelle.slice(
  homepageAuditQuelle.indexOf(HOMEPAGE_MARKE) + HOMEPAGE_MARKE.length,
);

// **Die Farbrechnung geht in einem EIGENEN Aufruf an die Seite.**
//
// Der Skripttext ist ein Kommandozeilen-Argument, und `playwright-cli` ist
// ein `.cmd`-Shim: Jeder Aufruf laeuft durch `cmd.exe`. Gemessen auf dem
// Produktionsweg (`Bun.spawn`) liegt die Grenze bei rund 7950 Zeichen —
// darueber endet der Aufruf mit "Die Befehlszeile ist zu lang", und der
// Verify-Lauf bricht mit Exit 2 ab.
//
// Der Homepage-Audit lag am 2026-08-31 bei 8406 Zeichen und war damit
// gebrochen; vor dem Umbau waren es 7920, also 30 Zeichen unter der Grenze.
// Die Farben in einem eigenen Aufruf zu setzen nimmt beiden Skripttexten
// rund 660 Zeichen ab — und die naechste Regel sprengt sie dann nicht sofort.
//
// **Der Setzer prueft, ob er wirklich geschrieben hat.** Eine untersuchte
// Seite kann die Eigenschaft mit einem Accessor besetzen, dessen Setter den
// echten Helfersatz verwirft und dessen Getter neun gleichnamige, aber
// gefaelschte Funktionen liefert (`contrastRatio: () => 21` unterdrueckt
// jeden Kontrastfehler). Eine Formpruefung faellt darauf herein — sie sieht
// neun Funktionen. Der Identitaetsvergleich nicht: Gelesen muss dasselbe
// Objekt sein wie geschrieben.
//
// **Was das NICHT loest, ausdruecklich:** Eine Seite, die die Eigenschaft
// ZWISCHEN Setzer und Audit austauscht, bleibt unentdeckt — es sind zwei
// getrennte Prozessaufrufe. Und im Main World kontrolliert die Seite ohnehin
// `getComputedStyle` und die DOM-Prototypen; gegen eine absichtlich
// feindliche Seite ist der Audit dort grundsaetzlich nicht abzusichern. Die
// Pruefung faengt Kollisionen und unvollstaendige Manipulation, nicht
// Provenienz. Belegt in der vierten Pruefrunde (2026-09-01).
//
// `window.__auditHelfer` ueberlebt keine Navigation; der Aufruf gehoert
// deshalb hinter jedes `goto`, nicht einmal an den Anfang.
export const AUDIT_HELFER_SETZEN = `() => { const helfer = (() => {${AUDIT_FARBEN}${AUDIT_DOM}
  return { toRGB, contrastRatio, istGrosseSchrift, kontrastSchwelle, ueberlagern,
    excludedSelector, hasBox, isExcluded, sichtbarerText, effectiveBackground };
})();
  window.__auditHelfer = helfer;
  if (window.__auditHelfer !== helfer) {
    throw new Error('Die Seite hat __auditHelfer besetzt: gelesen wird ein anderes Objekt als geschrieben.');
  }
  return "ok"; }`;

// WCAG contrast + visibility audit (Lastenheft 08 G6 / AK-06): walks every
// text node, computes contrast vs. effective background and counts texts
// stuck at opacity<0.15 (broken reveal animations). Runs inside the page.
export const AUDIT_JS = `() => {
  /* Die Helfer werden geprueft, nicht angenommen: Die untersuchte Seite kann
     window.__auditHelfer definieren, einfrieren oder ueberschreiben. Ein Wurf
     landet als Infrastrukturfehler im Aufrufer, nicht als Befund ueber die
     Seite. Kein Zeilenkommentar hier — der Text wird zu EINER Zeile
     komprimiert, ein // frisst alles dahinter. */
  const h = window.__auditHelfer;
  const NAMEN = ['toRGB', 'contrastRatio', 'istGrosseSchrift', 'kontrastSchwelle',
    'ueberlagern', 'effectiveBackground'];
  if (!h || typeof h !== 'object' || NAMEN.some((n) => typeof h[n] !== 'function')) {
    throw new Error('__auditHelfer fehlt oder wurde von der Seite ueberschrieben');
  }
  const { toRGB, contrastRatio, istGrosseSchrift, kontrastSchwelle, ueberlagern,
    effectiveBackground } = h;
  const ratio = contrastRatio;
  /* Die eigene effBg-Kopie ist am 2026-09-01 entfallen. Sie akzeptierte
     Alpha ueber 0.5 als Vollfarbe, waehrend der Homepage-Helfer erst ab 0.95
     akzeptierte — dieselbe Seite bekam je nach Verify-Pfad gegenteilige
     Kontrastbefunde. Beide nehmen jetzt denselben Helfer, der teiltransparente
     Schichten komponiert statt sie an einer Schwelle zu verwerfen. */
  const effBg = effectiveBackground;
  const fails = []; let invisible = 0; let checked = 0; let gradientSkipped = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; const txt = t.textContent.trim(); if (txt.length < 3) continue;
    const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    let op = 1, e = el; while (e) { op *= parseFloat(getComputedStyle(e).opacity || '1'); e = e.parentElement; }
    if (op < 0.15) { invisible++; continue; }
    const fg = toRGB(st.color); if (!fg) continue;
    const bg = effBg(el);
    if (!bg) { gradientSkipped++; continue; }
    const rt = ratio(ueberlagern(fg, bg, op), bg); checked++;
    const size = parseFloat(st.fontSize);
    const isLarge = istGrosseSchrift(size, parseInt(st.fontWeight) || 400);
    if (rt < kontrastSchwelle(isLarge)) fails.push({ text: txt.slice(0, 40), ratio: Math.round(rt * 10) / 10, fg: st.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', size: Math.round(size) });
  }
  fails.sort((a, b) => a.ratio - b.ratio);
  return JSON.stringify({ checked: checked, fail_count: fails.length, invisible_texts: invisible, gradient_skipped: gradientSkipped, worst: fails.slice(0, 15) });
}`;

export const SCROLL_SETTLE_JS = `async () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const step = Math.max(320, Math.floor(window.innerHeight * 0.75));
  let lastHeight = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += step) {
      window.scrollTo(0, y);
      await delay(250);
    }
    window.scrollTo(0, height);
    await delay(250);
    const nextHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    if (nextHeight === lastHeight || nextHeight === height) break;
    lastHeight = nextHeight;
  }
  window.scrollTo(0, 0);
  await delay(500);
  return JSON.stringify({ height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) });
}`;

// **In diesem Template-Literal steht kein `//`-Kommentar.** Der Text wird
// mit `.replace(/\s+/g, " ")` komprimiert; ein Zeilenkommentar verschluckt
// dabei den Rest der Zeile. Der Riegel dagegen steht in
// `tests/verify-audit-regeln.test.ts` — er setzt den Text zusammen,
// komprimiert ihn und uebersetzt ihn. Am 2026-08-31 hat er genau diesen
// Fehler gefangen, zwei Minuten nachdem er gebaut war.
//
// **`empty_main` zaehlt nur SICHTBAREN Text.** Bis zum 2026-08-31 nahm die
// Regel `root.textContent` ungefiltert — ein `<main>`, dessen einziger
// langer Text `[hidden]` oder `aria-hidden` trug, bestand damit die
// Pruefung. Das Lastenheft verlangt in §4.1 ausdruecklich die sichtbare
// Textlaenge. Gefunden von einer Fremdpruefung; die Filterung nutzt
// dasselbe `isExcluded` wie die uebrigen Regeln.
//
// **`effectiveBackground` durchsucht die Kette einschliesslich `<html>`.**
// Bis zum 2026-08-31 endete sie davor und nahm danach Weiss an; ein
// Verlauf auf `<html>` wurde nie gesehen, und weisser Text darauf ergab
// Weiss-gegen-Weiss — einen falschen `contrast`-Fail statt
// `unverifiable_background`. Genau der Fall, den §4.1 des Lastenhefts
// ausschliessen soll. Gefunden von einer Fremdpruefung; nicht als
// Unit-Test pruefbar, weil die Traversierung ein echtes Layout braucht.


function parseEvalJson<T>(stdout: string): T | undefined {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      return (typeof parsed === "string" ? JSON.parse(parsed) : parsed) as T;
    } catch {
      // playwright-cli adds headings around the JSON result.
    }
  }
  const quoted = stdout.match(/"\{.*\}"/s)?.[0];
  if (!quoted) return undefined;
  try {
    return JSON.parse(JSON.parse(quoted)) as T;
  } catch {
    return undefined;
  }
}

function pwFailure(result: PwResult, operation: string): string | undefined {
  if (result.code === 0) return undefined;
  return `${operation}: ${(result.stderr || result.stdout).trim().slice(0, 300) || `Exit ${result.code}`}`;
}

// Open the URL, capture Desktop + Mobile screenshots (full-page), console errors,
// and an ARIA snapshot. Returns the bundle; throws on a hard render failure.
async function renderBundle(
  url: string,
  name: string,
  opts: VerifyOpts,
): Promise<VerifyResult> {
  if (!(await hasPlaywrightCli())) {
    throw new Error(
      "playwright-cli nicht auf dem PATH gefunden. Installiere @playwright/cli " +
        "(npm i -g @playwright/cli) und einmalig `playwright-cli install`.",
    );
  }
  const outDir = opts.out ?? OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const waitMs = opts.wait ? Math.max(0, parseInt(opts.wait, 10) || 0) : DEFAULT_WAIT_MS;
  const started = Date.now();

  const open = await pw(["open", url]);
  if (open.code !== 0) {
    await pw(["close"]);
    throw new Error(`Render fehlgeschlagen (open ${url}): ${open.stderr.trim().slice(0, 200)}`);
  }
  await sleep(waitMs); // let the SPA fetch + paint before the shot

  const screenshots: VerifyResult["screenshots"] = {};
  if (!opts.mobileOnly) {
    await pw(["resize", "1440", "900"]);
    const f = `${outDir}/${name}-desktop.png`;
    await pw(["screenshot", "--full-page", "--filename", f]);
    screenshots.desktop = f;
  }
  if (!opts.desktopOnly) {
    await pw(["resize", "390", "844"]);
    const f = `${outDir}/${name}-mobile.png`;
    await pw(["screenshot", "--full-page", "--filename", f]);
    screenshots.mobile = f;
  }

  let consoleErrors: string[] = [];
  if (opts.console !== false) {
    const c = await pw(["console", "error"]);
    consoleErrors = c.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  let snapshotTaken = false;
  if (opts.snapshot !== false) {
    const s = await pw(["snapshot"]);
    snapshotTaken = s.code === 0;
  }
  let audit: AuditResult | undefined;
  try {
    if (opts.audit) {
      // Windows argv mangles multi-line args — pass as a single line.
      const farbenGesetzt = await pw(["eval", AUDIT_HELFER_SETZEN.replace(/\s+/g, " ")]);
      const farbFehler = pwFailure(farbenGesetzt, "Farbrechnung setzen");
      if (farbFehler) throw new Error(farbFehler);

      const a = await pw(["eval", AUDIT_JS.replace(/\s+/g, " ")]);

      // **Der Exit-Code wird geprueft, bevor nach JSON gesucht wird.**
      // Bis zum 2026-08-31 stand hier nur die Suche: Ein gescheiterter Audit
      // liess `audit` undefiniert, und der Datensatz ging trotzdem als
      // normales Ergebnis zurueck — "kein Befund" und "Audit kaputt" sahen
      // gleich aus. Die Homepage-Matrix machte es ueber `pwFailure` schon
      // richtig; nur dieser Pfad nicht.
      const auditFehler = pwFailure(a, "Audit ausfuehren");
      if (auditFehler) throw new Error(auditFehler);

      const m = a.stdout.match(/"\{.*\}"/s);
      if (!m) {
        throw new Error(
          "Audit lieferte kein JSON-Ergebnis. Ausgabe: " +
            a.stdout.replace(/\s+/g, " ").slice(0, 300),
        );
      }
      try {
        audit = JSON.parse(JSON.parse(m[0])) as AuditResult;
      } catch (e) {
        throw new Error(
          "Audit-Ergebnis ist kein gueltiges JSON: " + (e as Error).message,
        );
      }
    }
  } finally {
    // **`close` gehoert in `finally`.** Ein Fehler beim Setzer oder beim
    // Audit liesse die geteilte Browsersitzung sonst offen — der naechste
    // Lauf trifft dann auf ein Fenster, das ihm nicht gehoert.
    await pw(["close"]);
  }

  return {
    url,
    audit,
    screenshots,
    console_errors: consoleErrors,
    snapshot_taken: snapshotTaken,
    render_ms: Date.now() - started,
  };
}

async function renderAndOutput(
  url: string,
  name: string,
  opts: VerifyOpts,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const result = await renderBundle(url, name, opts);
  output({ ...result, ...extra }, opts.json, () => {
    const lines = [`Gerendert: ${url} (${result.render_ms} ms)`];
    if (result.screenshots.desktop) lines.push(`  Desktop: ${result.screenshots.desktop}`);
    if (result.screenshots.mobile) lines.push(`  Mobile:  ${result.screenshots.mobile}`);
    lines.push(`  Console-Errors: ${result.console_errors.length}`);
    if (result.console_errors.length > 0) {
      lines.push(...result.console_errors.slice(0, 5).map((e) => `    • ${e.slice(0, 160)}`));
    }
    if (result.audit) {
      lines.push(
        `  Audit: ${result.audit.fail_count} Kontrast-Fails, ` +
        `${result.audit.invisible_texts} unsichtbare Texte ` +
        `(${result.audit.checked} geprueft, ${result.audit.gradient_skipped ?? 0} Gradient uebersprungen)`,
      );
      for (const f of result.audit.worst.slice(0, 5)) {
        lines.push(`    x "${f.text}" ratio=${f.ratio} (${f.fg} auf ${f.bg}, ${f.size}px)`);
      }
    }
    return lines.join("\n");
  });
}

async function verifyHomepageMatrix(
  baseUrl: string,
  rawTabs: readonly HomepageTab[],
  name: string,
  opts: VerifyOpts,
): Promise<void> {
  const outDir = resolve(opts.out ?? OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  const reportFile = resolve(outDir, `${name}-report.json`);
  const tabs = normalizeHomepageTabs(rawTabs);
  const viewports = selectHomepageViewports(opts.desktopOnly, opts.mobileOnly);
  const failures: VerifyFinding[] = [];
  const unverifiable: UnverifiableFinding[] = [];
  const infrastructureErrors: string[] = [];
  const matrix: HomepageMatrixPoint[] = [];
  const waitMs = opts.wait ? Math.max(0, Number.parseInt(opts.wait, 10) || 0) : DEFAULT_WAIT_MS;

  if (tabs.length === 0) {
    infrastructureErrors.push("Keine aktiven oeffentlichen Homepage-Tabs gefunden.");
  }
  if (!(await hasPlaywrightCli())) {
    infrastructureErrors.push("playwright-cli ist nicht auf dem PATH verfuegbar.");
  }

  const verificationPages = [
    ...tabs.map((tab) => ({ ...tab, url: withTabQuery(baseUrl, tab.slug) })),
    { label: "Impressum", slug: "impressum", url: withImprintRoute(baseUrl) },
  ];

  for (const tab of verificationPages) {
    for (const viewport of viewports) {
      const pointStarted = Date.now();
      const pageUrl = tab.url;
      const prefix = `${name}-${artifactSegment(tab.slug)}-${viewport.name}`;
      const screenshotFile = resolve(outDir, `${prefix}.png`);
      const snapshotFile = resolve(outDir, `${prefix}-aria.md`);
      const point: HomepageMatrixPoint = {
        tab: tab.slug,
        viewport: viewport.name,
        width: viewport.width,
        height: viewport.height,
        url: sanitizeArtifactUrl(pageUrl),
        render_ms: 0,
        completed: false,
      };
      let sessionOpened = false;

      try {
        const open = await pw(["open", "about:blank"]);
        const openFailure = pwFailure(open, "Browser-Start");
        if (openFailure) throw new Error(openFailure);
        sessionOpened = true;

        const resizeResult = await pw(["resize", String(viewport.width), String(viewport.height)]);
        const resizeFailure = pwFailure(resizeResult, "Viewport");
        if (resizeFailure) throw new Error(resizeFailure);

        const navigation = await pw(["goto", pageUrl]);
        const navigationFailure = pwFailure(navigation, "Navigation");
        if (navigationFailure) throw new Error(navigationFailure);
        await sleep(waitMs);

        const scroll = await pw(["eval", SCROLL_SETTLE_JS.replace(/\s+/g, " ")]);
        const scrollFailure = pwFailure(scroll, "Scroll-Settling");
        if (scrollFailure) throw new Error(scrollFailure);

        const screenshot = await pw(["screenshot", "--full-page", "--filename", screenshotFile]);
        const screenshotFailure = pwFailure(screenshot, "Screenshot");
        if (screenshotFailure) throw new Error(screenshotFailure);
        point.screenshot = screenshotFile;

        if (opts.snapshot !== false) {
          const snapshot = await pw(["snapshot", "--filename", snapshotFile]);
          const snapshotFailure = pwFailure(snapshot, "ARIA-Snapshot");
          if (snapshotFailure) throw new Error(snapshotFailure);
          point.snapshot = snapshotFile;
        }

        if (opts.audit) {
          const farbenGesetzt = await pw(["eval", AUDIT_HELFER_SETZEN.replace(/\s+/g, " ")]);
          const farbFehler = pwFailure(farbenGesetzt, "Farbrechnung setzen");
          if (farbFehler) throw new Error(farbFehler);
          const auditResult = await pw(["eval", HOMEPAGE_AUDIT_JS.replace(/\s+/g, " ")]);
          const auditFailure = pwFailure(auditResult, "DOM-Audit");
          if (auditFailure) throw new Error(auditFailure);
          const audit = parseEvalJson<DomAuditResult>(auditResult.stdout);
          if (!audit) throw new Error("DOM-Audit: Ergebnis war nicht parsebar.");
          failures.push(...audit.failures.map((finding) => ({
            ...finding,
            tab: tab.slug,
            viewport: viewport.name,
          })));
          unverifiable.push(...audit.unverifiable.map((finding) => ({
            ...finding,
            tab: tab.slug,
            viewport: viewport.name,
          })));
        }

        if (opts.console !== false) {
          const consoleResult = await pw(["console", "error"]);
          const consoleFailure = pwFailure(consoleResult, "Console-Auswertung");
          if (consoleFailure) throw new Error(consoleFailure);
          for (const message of actionableConsoleErrors(consoleResult.stdout)) {
            failures.push({
              kind: "console_error",
              message: message.slice(0, 500),
              tab: tab.slug,
              viewport: viewport.name,
            });
          }

          const networkResult = await pw(["network"]);
          const networkFailure = pwFailure(networkResult, "Network-Auswertung");
          if (networkFailure) throw new Error(networkFailure);
          for (const message of failedSameOriginRequests(networkResult.stdout, pageUrl)) {
            failures.push({
              kind: "same_origin_request",
              message: message.slice(0, 500),
              tab: tab.slug,
              viewport: viewport.name,
            });
          }
        }

        point.completed = true;
      } catch (error) {
        infrastructureErrors.push(
          `${tab.slug}/${viewport.name}: ${(error as Error).message}`,
        );
      } finally {
        point.render_ms = Date.now() - pointStarted;
        matrix.push(point);
        if (sessionOpened) {
          const close = await pw(["close"]);
          const closeFailure = pwFailure(close, "Browser-Close");
          if (closeFailure) infrastructureErrors.push(`${tab.slug}/${viewport.name}: ${closeFailure}`);
        }
      }
    }
  }

  const incomplete = infrastructureErrors.length > 0 || matrix.some((point) => !point.completed);
  const exitCode = classifyVerificationExit(incomplete, failures.length);
  const report: HomepageVerifyReport = {
    passed: exitCode === 0,
    incomplete,
    exit_code: exitCode,
    url: sanitizeArtifactUrl(baseUrl),
    tabs: tabs.map((tab) => tab.slug),
    viewports: viewports.map(({ name: viewportName, width, height }) => ({
      name: viewportName,
      width,
      height,
    })),
    matrix,
    failures,
    unverifiable,
    infrastructure_errors: infrastructureErrors,
    report_file: reportFile,
  };
  writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");
  output(report, opts.json, () => [
    `Homepage-Verifier: ${tabs.length} Tabs + Impressum x ${viewports.length} Viewports`,
    `  Ergebnis: Exit ${exitCode} (${failures.length} Findings, ${unverifiable.length} unverifiable, ${infrastructureErrors.length} Infrastrukturfehler)`,
    `  Bericht: ${reportFile}`,
  ].join("\n"));
  process.exitCode = exitCode;
}

export function registerVerifyCommands(cli: CAC): void {
  cli
    .command(
      "verify <action> [arg]",
      "Seite headless rendern + Screenshots: url | event | menu | homepage | news | certificate",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--out <dir>", "Zielordner fuer Screenshots", { default: OUT_DIR })
    .option("--desktop-only", "Nur Desktop-Screenshot (1440x900)")
    .option("--mobile-only", "Nur Mobile-Screenshot (390x844)")
    .option("--no-snapshot", "ARIA-Snapshot weglassen")
    .option("--no-console", "Console-Errors nicht einsammeln")
    .option("--wait <ms>", "Wartezeit nach Laden vor dem Screenshot (SPA-Settle)", { default: String(DEFAULT_WAIT_MS) })
    .option("--child <id>", "event: Festtag-/Child-Event-ID")
    .option("--area <id>", "event: Bereich-ID")
    .option("--token <t>", "event: Hub-Token (?token=...)")
    .option("--print", "menu: Druck-Ansicht (/print)")
    .option("--file <path>", "homepage: home.json fuer Entwurfs-Vorschau (statt Live)")
    .option("--design-file <path>", "homepage: design_settings-JSON fuer den Preview-Snapshot")
    .option("--frontend-base <url>", "Frontend-Basis ueberschreiben (z.B. http://localhost:5173)")
    .option("--audit", "Kontrast-/Sichtbarkeits-Audit (WCAG-Ratios + opacity-0-Texte) mit ausgeben")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, arg: string | undefined, opts: VerifyOpts) => {
      const state = await loadState();
      const client = createClient(state);
      const fb = frontendBase(state.environment, opts.frontendBase);

      switch (action) {
        case "url": {
          if (!arg) throw new Error("verify url <url> benoetigt eine URL.");
          await renderAndOutput(arg, "url", opts);
          break;
        }

        case "event": {
          if (!arg) throw new Error("verify event <event-id> benoetigt eine Event-ID.");
          const clubId = requireClubId(state, opts.club);
          let path = `/club/${clubId}/event/${arg}/public`;
          if (opts.child) path += `/${opts.child}`;
          if (opts.area) path += `/area/${opts.area}`;
          let url = `${fb}${path}`;
          if (opts.token) url += `?token=${encodeURIComponent(opts.token)}`;
          await renderAndOutput(url, `event-${arg}`, opts);
          break;
        }

        case "menu": {
          if (!arg) throw new Error("verify menu <menu-id> benoetigt eine Menu-ID.");
          const clubId = requireClubId(state, opts.club);
          const url = `${fb}/clubs/${clubId}/menu/${arg}${opts.print ? "/print" : ""}`;
          await renderAndOutput(url, `menu-${arg}`, opts);
          break;
        }

        case "homepage": {
          const clubId = requireClubId(state, opts.club);
          if (opts.file) {
            // Draft preview: POST composed structure → preview_url (no live mutation).
            const struct = readJsonFile<{
              tabs?: HomepageTab[];
              design_settings?: Record<string, unknown>;
            } | HomepageTab[]>(opts.file);
            const tabs = Array.isArray(struct) ? struct : (struct.tabs ?? []);
            if (!Array.isArray(tabs) || tabs.length === 0) {
              throw new Error("home.json braucht mindestens einen Tab (tabs[]).");
            }
            const designSettings = opts.designFile
              ? readJsonFile<Record<string, unknown>>(opts.designFile)
              : !Array.isArray(struct)
                ? struct.design_settings
                : undefined;
            const body: Record<string, unknown> = { tabs };
            if (designSettings) {
              body.design_snapshot_version = 1;
              body.design_settings = designSettings;
            }
            const res = await client.post<{ preview_url?: string }>(
              "club",
              `/home-config/${clubId}/preview`,
              body,
            );
            if (!res.preview_url) throw new Error("Keine preview_url vom club-service erhalten.");
            // Die preview_url zeigt immer auf den gehosteten Renderer. Ohne diese
            // Zeile lief --frontend-base ins Leere: Der Lauf rendert dann die
            // DEPLOYTE App, waehrend man glaubt, den lokalen Stand zu pruefen —
            // und schliesst aus dem Ergebnis, der eigene Code funktioniere nicht.
            const previewUrl = opts.frontendBase
              ? applyFrontendBase(res.preview_url, fb)
              : res.preview_url;
            await verifyHomepageMatrix(previewUrl, tabs, "homepage-preview", opts);
            break;
          }
          // Live homepage: the managed public host comes exclusively from Club.subdomain.
          // A flag that does nothing for the chosen action is rejected, not
          // swallowed — the club's address is the whole point of this path, and
          // a local renderer has no subdomain routing to answer it with.
          if (opts.frontendBase) {
            throw new Error(
              "--frontend-base wirkt bei `verify homepage` ohne --file nicht: Dieser Weg rendert " +
                "die veroeffentlichte Vereinsadresse (<subdomain>.comvenio.app), und ein lokaler " +
                "Renderer kennt diese Zuordnung nicht.\n" +
                "Fuer lokalen Code den Entwurfsweg nehmen:\n" +
                "  comvenio verify homepage --file home.json --frontend-base http://localhost:5173",
            );
          }
          const club = await client.get<Record<string, unknown>>("club", `/clubs/${clubId}`);
          const liveUrl = resolveLiveHomepageUrl(state.environment, club);
          const tabs = await client.get<HomepageTab[]>(
            "club",
            `/public/clubs/${clubId}/home`,
          );
          await verifyHomepageMatrix(
            liveUrl,
            tabs,
            "homepage",
            opts,
          );
          break;
        }

        case "news": {
          if (!arg) throw new Error("verify news <news-id> benoetigt eine News-ID.");
          const clubId = requireClubId(state, opts.club);
          await renderAndOutput(`${fb}/club/${clubId}/news/${arg}`, `news-${arg}`, opts);
          break;
        }

        case "certificate": {
          if (!arg) throw new Error("verify certificate <honor-id> benoetigt eine MemberHonor-ID.");
          // No public route → fetch the HTML token-guarded (RBAC manage_honors),
          // write it locally, render the local file.
          const res = await client.post<{ certificate_html?: string }>(
            "member",
            `/honors/${arg}/generate-certificate`,
            {},
          );
          if (!res.certificate_html) {
            throw new Error("Keine certificate_html vom member-service erhalten.");
          }
          const outDir = opts.out ?? OUT_DIR;
          mkdirSync(outDir, { recursive: true });
          const htmlFile = resolve(`${outDir}/certificate-${arg}.html`);
          writeFileSync(htmlFile, res.certificate_html, "utf8");
          await renderAndOutput(pathToFileURL(htmlFile).href, `certificate-${arg}`, opts, {
            source_html: htmlFile,
          });
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: url, event, menu, homepage, news, certificate`,
          );
      }
    });
}
