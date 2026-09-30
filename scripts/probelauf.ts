/**
 * Probelauf (comvenio-cli-doku 09): a foreign AI session with only the public
 * sources — the comvenio CLI, the help center and comvenio_hilfe — solves a
 * fixed catalog of tasks; this library builds the catalog from the customer
 * articles, defines the sandbox, scores a session transcript and renders the
 * report. It measures the documentation of 01-08, never the session: a task
 * the session cannot solve is a finding against the documentation (09 §0).
 *
 * Measurement language follows the harness engineering-measurement contract:
 * every value carries DERIVED / PARTIAL / NOT_MEASURED / NOT_APPLICABLE — a
 * missing value is never 0 or "solved", and the session's own claim of success
 * is never read (no self-attestation).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FACHWISSEN_SECTIONS, sectionBody } from "./docs-lib.ts";
import type { Aktion, WebAppFuehrung } from "./web-app-fuehrung.ts";

// ── Catalog ──────────────────────────────────────────────────────────────

/** Order of the areas (D-DOK-16). */
export const BEREICHE = ["homepage", "finance", "event", "tournament", "meeting"] as const;
export type Bereich = (typeof BEREICHE)[number];

export const KLASSEN = ["bau", "fachfrage", "web-app"] as const;
export type Klasse = (typeof KLASSEN)[number];

/** The German hub article each area is measured against. */
export const ARTIKEL: Readonly<Record<Bereich, string>> = {
  homepage: "homepage.md",
  finance: "finanzen.md",
  event: "veranstaltungen.md",
  tournament: "turniere.md",
  meeting: "meetings.md",
};

/** Strand of the documentation that has to close a gap of this kind (09 §4.4). */
export function strangFuer(bereich: Bereich, klasse: Klasse): string {
  if (klasse === "web-app") return "08";
  if (klasse === "fachfrage") return bereich === "homepage" ? "06" : "07";
  return bereich === "homepage" ? "06" : "01-05";
}

export interface Aufgabe {
  id: string;
  bereich: Bereich;
  klasse: Klasse;
  /** What the session is asked — never the answer. */
  frage: string;
  /** Checkable statements of the correct answer; empty → not scoreable. */
  kernaussagen: string[];
  /** Where the answer stands in the documentation. */
  fundstelle: string;
  /** bau only: command patterns (regex source) of which one must succeed. */
  befehle?: string[];
  /** bau only: the task may change club data (only on the DEV stage). */
  schreibt?: boolean;
}

export interface NichtAnwendbar {
  bereich: Bereich;
  klasse: Klasse;
  grund: string;
}

export interface Katalog {
  version: 1;
  /** sha256 over the tasks — two reports are comparable only on the same catalog. */
  hash: string;
  aufgaben: Aufgabe[];
  nicht_anwendbar: NichtAnwendbar[];
  /** Gaps visible before any run, e.g. a web-app guide without a menu path. */
  luecken_vorab: string[];
}

export interface BauAufgabe {
  id: string;
  bereich: Bereich;
  frage: string;
  befehle: string[];
  fundstelle: string;
  schreibt?: boolean;
}

export interface FaqPaar {
  frage: string;
  antwort: string;
}

/** Question/answer pairs under "Häufige Fragen" (07 §4.2 layout: bold question line, answer paragraph). */
export function faqPaare(body: string): FaqPaar[] {
  const text = sectionBody(body, FACHWISSEN_SECTIONS.de[1]!);
  if (!text) return [];
  const paare: FaqPaar[] = [];
  let aktuell: FaqPaar | null = null;
  for (const line of text.split("\n")) {
    const frage = /^\*\*(.+)\*\*\s*$/u.exec(line.trim());
    if (frage) {
      if (aktuell) paare.push(aktuell);
      aktuell = { frage: frage[1]!.trim(), antwort: "" };
    } else if (aktuell) {
      aktuell.antwort = `${aktuell.antwort}\n${line}`.trim();
    }
  }
  if (aktuell) paare.push(aktuell);
  return paare.filter((paar) => paar.antwort.length > 0);
}

function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/gu)].map((match) => match[1]!.trim());
}

/**
 * Checkable statements of an answer: its code spans and a leading Ja/Nein.
 * Whatever the question already names is dropped — echoing it proves nothing.
 */
export function kernaussagen(frage: string, antwort: string): string[] {
  const inFrage = new Set(codeSpans(frage).map((span) => span.toLowerCase()));
  const aussagen: string[] = [];
  const janein = /^(Ja|Nein)\b/u.exec(antwort.trim());
  if (janein) aussagen.push(janein[1]!);
  for (const span of codeSpans(antwort)) {
    if (inFrage.has(span.toLowerCase()) || aussagen.includes(span)) continue;
    aussagen.push(span);
  }
  return aussagen;
}

const WIDGET_ZEILE = /^- `([a-z0-9_]+)` — (.+?)(?: Datenquelle:| Macht öffentlich:| Passt zu:|$)/u;

/** Homepage questions from the generated widget block (06): purpose → widget id. */
export function widgetFragen(body: string): Aufgabe[] {
  const start = body.indexOf("<!-- gen:docs widgets -->");
  const end = body.indexOf("<!-- /gen:docs widgets -->");
  if (start < 0 || end < start) return [];
  const aufgaben: Aufgabe[] = [];
  for (const line of body.slice(start, end).split("\n")) {
    const match = WIDGET_ZEILE.exec(line.trim());
    if (!match) continue;
    const [, id, zweck] = match;
    // An open spot is an undocumented widget, not a question with an answer (06 §4.2).
    if (!zweck || /offene Stelle/u.test(zweck) || zweck.includes(id!)) continue;
    aufgaben.push({
      id: `homepage.fachfrage.widget-${id}`,
      bereich: "homepage",
      klasse: "fachfrage",
      frage: `Auf der Vereins-Homepage soll Folgendes erscheinen: „${zweck.trim().replace(/\.$/u, "")}“. Welches Widget (Kennung) nimmt man dafür, und was macht es öffentlich?`,
      kernaussagen: [id!],
      fundstelle: "docs/homepage.md#widgets",
    });
  }
  return aufgaben;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/ß/gu, "ss")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
}

/** Whatever the question already names proves nothing when the answer repeats it. */
function imTitel(aussage: string, titel: string): boolean {
  return titel.toLowerCase().includes(aussage.toLowerCase());
}

/** Menu-path steps a correct answer has to name; "Web-App" and what the surface title contains are no evidence. */
export function menueSchritte(menuepfad: string, titel: string): string[] {
  return menuepfad
    .split("→")
    .map((schritt) => schritt.trim())
    .filter((schritt) => schritt && schritt !== "Web-App" && !imTitel(schritt, titel));
}

const KLICK_VORSPANN = /^(?:Klick|Tippen|Wahl|Auswahl|Ändern|Umschalten|Ziehen)\s+(?:(?:auf|von|der|des|im|in)\s+)?(?:(?:einen|eine|ein|den|dem|der|die|das)\s+)?/iu;

/**
 * The clicks a correct answer has to name (08: "benötigte Klicks"): the quoted
 * button labels of the first actions, else the trigger without its verb.
 * Placeholders like „<Jahr>“ are no label a session could repeat.
 */
export function klickAussagen(aktionen: readonly Aktion[], titel: string, anzahl = 2): string[] {
  const aussagen: string[] = [];
  for (const aktion of aktionen) {
    const zitiert = [...aktion.ausloeser.matchAll(/„([^“]+)“/gu)].map((match) => match[1]!.trim());
    const labels = zitiert.filter((label) => !/[<>]/u.test(label));
    // Quoted but only placeholders: the trigger text would carry the placeholder along.
    if (zitiert.length > 0 && labels.length === 0) continue;
    const kandidaten = labels.length > 0 ? labels.slice(0, 1) : [aktion.ausloeser.replace(KLICK_VORSPANN, "").trim()];
    for (const kandidat of kandidaten) {
      if (!/\p{L}{4,}/u.test(kandidat) || imTitel(kandidat, titel) || aussagen.includes(kandidat)) continue;
      aussagen.push(kandidat);
    }
    if (aussagen.length >= anzahl) break;
  }
  return aussagen.slice(0, anzahl);
}

export function webAppAufgaben(fuehrung: WebAppFuehrung, bereich: Bereich): { aufgaben: Aufgabe[]; offen: number; ohneAussage: number } {
  const flaechen = fuehrung.hubs[bereich] ?? [];
  const aufgaben: Aufgabe[] = [];
  let offen = 0;
  let ohneAussage = 0;
  for (const flaeche of flaechen) {
    const aufgabe = {
      id: `${bereich}.web-app.${slug(flaeche.titel)}`,
      bereich,
      klasse: "web-app" as const,
      frage: `Ich bin in der Comvenio-Web-App angemeldet. Wie komme ich zur Fläche „${flaeche.titel}“ (Menüpfad), und was kann ich dort mit welchem Klick tun?`,
      fundstelle: `docs/${ARTIKEL[bereich]}#so-gehts-in-der-web-app`,
    };
    // 09 §4.2 asks for the menu path. Without a closed one the answer cannot be
    // checked — the task stays in the catalog without key statements, so it is
    // NOT_MEASURED and never replaced by a question about clicks alone.
    if (flaeche.menuepfad_offen) {
      offen += 1;
      aufgaben.push({ ...aufgabe, kernaussagen: [] });
      continue;
    }
    const schritte = menueSchritte(flaeche.menuepfad, flaeche.titel);
    const klicks = klickAussagen(flaeche.aktionen, flaeche.titel);
    // Neither a path step nor a nameable click: the guide gives a session nothing to check against.
    if (schritte.length + klicks.length === 0) {
      ohneAussage += 1;
      continue;
    }
    aufgaben.push({ ...aufgabe, kernaussagen: [...schritte, ...klicks] });
  }
  return { aufgaben, offen, ohneAussage };
}

function hashAufgaben(aufgaben: readonly Aufgabe[]): string {
  return createHash("sha256").update(JSON.stringify(aufgaben)).digest("hex");
}

/** The catalog from the committed customer articles, the web-app guide and the hand-written build tasks. */
export function baueKatalog(root: string): Katalog {
  const fuehrungPfad = join(root, "src", "schema", "web-app-fuehrung.json");
  const fuehrung: WebAppFuehrung | null = existsSync(fuehrungPfad) ? JSON.parse(readFileSync(fuehrungPfad, "utf8")) : null;
  const bau: BauAufgabe[] = JSON.parse(readFileSync(join(root, "probelauf", "bau-aufgaben.json"), "utf8"));
  const aufgaben: Aufgabe[] = [];
  const nichtAnwendbar: NichtAnwendbar[] = [];
  const luecken: string[] = [];

  for (const bereich of BEREICHE) {
    const body = readFileSync(join(root, "docs", ARTIKEL[bereich]), "utf8");

    const eigene = bau.filter((aufgabe) => aufgabe.bereich === bereich);
    if (eigene.length === 0) luecken.push(`${bereich}: keine Bauaufgabe definiert`);
    for (const aufgabe of eigene) {
      aufgaben.push({
        id: aufgabe.id,
        bereich,
        klasse: "bau",
        frage: aufgabe.frage,
        kernaussagen: [],
        fundstelle: aufgabe.fundstelle,
        befehle: aufgabe.befehle,
        ...(aufgabe.schreibt ? { schreibt: true } : {}),
      });
    }

    const fragen =
      bereich === "homepage"
        ? widgetFragen(body)
        : faqPaare(body).map((paar, index) => ({
            id: `${bereich}.fachfrage.${index + 1}-${slug(paar.frage)}`,
            bereich,
            klasse: "fachfrage" as const,
            frage: paar.frage,
            kernaussagen: kernaussagen(paar.frage, paar.antwort),
            fundstelle: `docs/${ARTIKEL[bereich]}#häufige-fragen`,
          }));
    if (fragen.length === 0) luecken.push(`${bereich}: keine Fachfrage in docs/${ARTIKEL[bereich]}`);
    aufgaben.push(...fragen);

    const web = fuehrung ? webAppAufgaben(fuehrung, bereich) : { aufgaben: [], offen: 0, ohneAussage: 0 };
    if (web.offen > 0) luecken.push(`${bereich}: ${web.offen} Fläche(n) der Web-App-Führung ohne Menüpfad — ihre Aufgaben sind NOT_MEASURED (08)`);
    if (web.ohneAussage > 0) luecken.push(`${bereich}: ${web.ohneAussage} Fläche(n) ohne Menüpfad und ohne benennbaren Klick — nicht prüfbar (08)`);
    if (web.aufgaben.length === 0) {
      // 09 DC-5 / TC-05: no guide → the class is left out, a known gap, not a failed session.
      nichtAnwendbar.push({
        bereich,
        klasse: "web-app",
        grund: fuehrung
          ? `08 liefert für ${bereich} keine Führung mit Menüpfad`
          : "src/schema/web-app-fuehrung.json fehlt (08 nicht erzeugt)",
      });
    }
    aufgaben.push(...web.aufgaben);
  }

  return { version: 1, hash: hashAufgaben(aufgaben), aufgaben, nicht_anwendbar: nichtAnwendbar, luecken_vorab: luecken };
}

/**
 * The standard set of a run: per area and class the task with the smallest
 * id hash — deterministic, so a second run on the same catalog asks the same
 * questions (TC-06), and it only moves when the catalog changes. Only
 * scoreable tasks: a question without key statements would cost a session
 * and still end NOT_MEASURED.
 */
export function bewertbar(aufgabe: Aufgabe): boolean {
  // Mirrors bewerteLoesung: bau is scored by its commands, everything else by key statements.
  return aufgabe.klasse === "bau" ? (aufgabe.befehle ?? []).length > 0 : aufgabe.kernaussagen.length > 0;
}

export function standardSatz(katalog: Katalog): Aufgabe[] {
  const wahl = new Map<string, { aufgabe: Aufgabe; schluessel: string }>();
  for (const aufgabe of katalog.aufgaben.filter(bewertbar)) {
    const gruppe = `${aufgabe.bereich}/${aufgabe.klasse}`;
    const schluessel = createHash("sha256").update(aufgabe.id).digest("hex");
    const bisher = wahl.get(gruppe);
    if (!bisher || schluessel < bisher.schluessel) wahl.set(gruppe, { aufgabe, schluessel });
  }
  return katalog.aufgaben.filter((aufgabe) => wahl.get(`${aufgabe.bereich}/${aufgabe.klasse}`)?.aufgabe === aufgabe);
}

// ── Sandbox ──────────────────────────────────────────────────────────────

export const UMGEBUNGEN = {
  // Club restriction (CLAUDE.md, no exception): the Comvenio club only.
  dev: { api: "https://apidev.comvenio.app", club: "476bc619-ddb4-4693-bbe6-45936fa4f47e" },
  prod: { api: "https://api.comvenio.app", club: "0ec34e70-999a-47c4-a1b1-bdb293110fa5" },
} as const;
export type Umgebung = keyof typeof UMGEBUNGEN;

/** Public MCP endpoint that serves comvenio_hilfe without sign-in (05). */
export const MCP_URL = "https://mcp.comvenio.app/mcp";
export const WEB_DOMAINS = ["www.comvenio.app", "comvenio.app"] as const;

/** CLI calls the sandbox allows (09 §0/§4.1) — everything else is denied by the provider. */
export const ERLAUBTE_BEFEHLE = [
  "comvenio help",
  "comvenio --help",
  "comvenio --version",
  "comvenio whoami",
  "comvenio schema",
  "comvenio action list",
  "comvenio action call",
] as const;

/** Provider arguments of one sandboxed claude session. */
export function claudeArgumente(options: { prompt: string; modell: string; mcpConfig: string; maxTurns: number }): string[] {
  return [
    "-p",
    options.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    options.modell,
    "--max-turns",
    String(options.maxTurns),
    // No user/project settings: no hooks, no CLAUDE.md of this workspace, no memory.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    options.mcpConfig,
    "--tools",
    "Bash,WebFetch",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...ERLAUBTE_BEFEHLE.map((befehl) => `Bash(${befehl}:*)`),
    ...WEB_DOMAINS.map((domain) => `WebFetch(domain:${domain})`),
    "mcp__comvenio__comvenio_hilfe",
    "--disallowedTools",
    "Bash(comvenio action confirm:*)",
    "--no-session-persistence",
  ];
}

/**
 * Shell wrapper placed as `comvenio` on the sandbox PATH: it refuses `--file`
 * before the CLI starts, because `action call cai.data.06.upload --file <path>`
 * would read any local file and store it in the club — the provider's prefix
 * rule `Bash(comvenio action call:*)` cannot tell that apart.
 */
export function cliHuelle(echt: string): string {
  const zitiert = `'${echt.replace(/'/gu, `'\\''`)}'`;
  return [
    "#!/bin/sh",
    "# probelauf sandbox (comvenio-cli-doku 09 §4.1): no local file leaves the machine.",
    'for arg in "$@"; do',
    '  case "$arg" in --file|--file=*) echo "--file ist im Probelauf gesperrt (Sandbox)." >&2; exit 2;; esac',
    "done",
    `exec ${zitiert} "$@"`,
    "",
  ].join("\n");
}

export function mcpKonfiguration(): string {
  return JSON.stringify({ mcpServers: { comvenio: { type: "http", url: MCP_URL } } });
}

/** The prompt: role, sandbox rules, the task — never the answer. */
export function prompt(aufgabe: Aufgabe, umgebung: Umgebung): string {
  const regeln = [
    "Du bist der KI-Assistent eines Mitglieds im Comvenio-Verein und arbeitest nur mit öffentlichen Quellen:",
    "dem Kommandozeilenprogramm `comvenio` (help, action list, action call, schema, whoami),",
    "dem Hilfe-Center unter https://www.comvenio.app/hilfe und dem Werkzeug comvenio_hilfe.",
    "Es gibt kein Repository und keinen Quellcode für dich; lies keine lokalen Dateien.",
    "Rufe niemals `comvenio action confirm` auf — Änderungen bleiben auf der Vorschaustufe.",
    `Die Anmeldung ist die Umgebung ${umgebung}; arbeite nur im angemeldeten Verein.`,
    "Antworte am Ende knapp auf Deutsch und nenne unter „Quellen:“ die Stellen, auf die du dich stützt.",
  ];
  return `${regeln.join("\n")}\n\nAufgabe:\n${aufgabe.frage}`;
}

// ── Scoring ──────────────────────────────────────────────────────────────

export type Messstatus = "DERIVED" | "PARTIAL" | "NOT_MEASURED" | "NOT_APPLICABLE";
export type Geloest = "ja" | "teilweise" | "nein";

export interface Messwert<T> {
  status: Messstatus;
  wert: T | null;
  grund?: string;
}

export interface ToolAufruf {
  id: string;
  name: string;
  befehl: string;
  ergebnis: string;
  fehler: boolean;
  abgelehnt: boolean;
  /** A tool_result arrived; without one, success and failure are both unknown. */
  beantwortet: boolean;
}

export interface Transkript {
  aufrufe: ToolAufruf[];
  antwort: string | null;
  dauer_ms: number | null;
  kosten_usd: number | null;
  mcp: { name: string; status: string }[];
  modell: string | null;
}

function befehlVon(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") return String(input.command ?? "");
  if (name === "WebFetch") return String(input.url ?? "");
  return JSON.stringify(input);
}

/** Parses the stream-json output of `claude -p`. */
export function leseTranskript(jsonl: string): Transkript {
  const aufrufe = new Map<string, ToolAufruf>();
  const transkript: Transkript = { aufrufe: [], antwort: null, dauer_ms: null, kosten_usd: null, mcp: [], modell: null };
  const abgelehnt = new Set<string>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") {
      transkript.mcp = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
      transkript.modell = event.model ?? null;
    } else if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block.type !== "tool_use") continue;
        aufrufe.set(block.id, {
          id: block.id,
          name: block.name,
          befehl: befehlVon(block.name, block.input ?? {}),
          ergebnis: "",
          fehler: false,
          abgelehnt: false,
          beantwortet: false,
        });
      }
    } else if (event.type === "user") {
      for (const block of event.message?.content ?? []) {
        if (block.type !== "tool_result") continue;
        const aufruf = aufrufe.get(block.tool_use_id);
        if (!aufruf) continue;
        const inhalt = Array.isArray(block.content)
          ? block.content.map((teil: { text?: string }) => teil.text ?? "").join("\n")
          : String(block.content ?? "");
        aufruf.ergebnis = inhalt;
        aufruf.fehler = block.is_error === true;
        aufruf.beantwortet = true;
      }
    } else if (event.type === "result") {
      transkript.antwort = typeof event.result === "string" ? event.result : null;
      transkript.dauer_ms = typeof event.duration_ms === "number" ? event.duration_ms : null;
      transkript.kosten_usd = typeof event.total_cost_usd === "number" ? event.total_cost_usd : null;
      for (const denial of event.permission_denials ?? []) abgelehnt.add(denial.tool_use_id);
    }
  }
  for (const aufruf of aufrufe.values()) {
    aufruf.abgelehnt = abgelehnt.has(aufruf.id);
    transkript.aufrufe.push(aufruf);
  }
  return transkript;
}

export function istNachschlag(aufruf: ToolAufruf): boolean {
  if (aufruf.name === "WebFetch") return true;
  if (aufruf.name.endsWith("comvenio_hilfe")) return true;
  if (aufruf.name !== "Bash") return false;
  const befehl = aufruf.befehl.trim();
  return /^comvenio (help|schema|action list)\b/u.test(befehl) || /^comvenio\b.*(--help|-h)\b/u.test(befehl);
}

/**
 * Read-only text filters a session may pipe CLI output through. The provider
 * lets them read files only inside the empty sandbox directory (pilot
 * 2026-09-30: `jq`, `grep`, `head`, `sed`, `wc`, `cat` on /etc/hosts denied,
 * `head` on a sandbox file and `… | head` allowed). The count below does not
 * rely on that: only listed options pass, so no filter can read a script or
 * pattern file, write a file or execute anything.
 */
interface FilterRegel {
  /** Single-letter switches without value, combinable (`-inE`). */
  schalter: string;
  /** Single-letter options with one value, attached (`-n5`) or as next token. */
  mitWert: string;
  /** Long options with the number of values they take. */
  lang?: Readonly<Record<string, number>>;
  /** Leading operands that are expressions, not files (grep pattern, jq filter, sed script, tr sets). */
  ausdruecke: number;
  /** The option that carries the expression instead (`grep -e`, `sed -e`). */
  ausdruckOption?: string;
  /** `head -50` style counts. */
  zahl?: boolean;
}

const GREP: FilterRegel = { schalter: "inEvcowFhHlxsqIz", mitWert: "ABCme", ausdruecke: 1, ausdruckOption: "e" };
export const TEXTFILTER: Readonly<Record<string, FilterRegel>> = {
  head: { schalter: "q", mitWert: "nc", ausdruecke: 0, zahl: true },
  tail: { schalter: "qr", mitWert: "nc", ausdruecke: 0, zahl: true },
  grep: GREP,
  egrep: GREP,
  jq: {
    schalter: "rcjnseSaC",
    mitWert: "",
    lang: { "--raw-output": 0, "--compact-output": 0, "--slurp": 0, "--null-input": 0, "--sort-keys": 0, "--exit-status": 0, "--join-output": 0, "--arg": 2, "--argjson": 2 },
    ausdruecke: 1,
  },
  sed: { schalter: "nE", mitWert: "e", ausdruecke: 1, ausdruckOption: "e" },
  wc: { schalter: "lwcm", mitWert: "", ausdruecke: 0 },
  sort: { schalter: "nrufhbdV", mitWert: "kt", ausdruecke: 0 },
  uniq: { schalter: "cdui", mitWert: "fs", ausdruecke: 0 },
  cut: { schalter: "s", mitWert: "dfcb", ausdruecke: 0 },
  tr: { schalter: "dsc", mitWert: "", ausdruecke: Number.POSITIVE_INFINITY },
};

// sed: line ranges with p/d/q/= and s/…/…/ without the w or e flag — no r, w, e commands.
const SED_TEIL = /^(?:(?:\d+|\$)(?:,(?:\d+|\$))?)?[pdq=]?$|^s\/(?:[^/\\]|\\.)*\/(?:[^/\\]|\\.)*\/[gIip0-9]*$/u;
// jq: the environment and module loading reach beyond the piped text.
const JQ_AUSSERHALB = /\benv\b|\$ENV|\binput_filename\b|\bimport\b|\binclude\b/u;

// Large tool results are stored by the provider under
// ~/.claude/projects/<encoded sandbox cwd>/ — reading them back is the
// session's own output, not a foreign file.
const EIGENE_AUSGABE = /^(?:~|\/[^\s]*?)\/\.claude\/projects\/[^/]*-probelauf-[A-Za-z0-9]{6}\//u;

/** Splits a shell command at `|`, `||`, `&&`, `;`, `&` outside quotes; tokens without quotes. */
function segmente(befehl: string): string[][] | null {
  const ergebnis: string[][] = [[]];
  let token = "";
  let hatToken = false;
  let quote: string | null = null;
  const schliesseToken = () => {
    if (hatToken) ergebnis[ergebnis.length - 1].push(token);
    token = "";
    hatToken = false;
  };
  for (let i = 0; i < befehl.length; i += 1) {
    const zeichen = befehl[i];
    if (quote) {
      // Double quotes still expand `$(…)`, `$VAR` and backticks.
      if (quote === '"' && (zeichen === "$" || zeichen === "`")) return null;
      if (quote === '"' && zeichen === "\\") {
        // As bash reads it: `\` escapes only $ ` " \ and newline; before any
        // other character both stay literal (`grep -E "finance\.(31|25)"`).
        // Either way nothing is expanded.
        const naechstes = befehl[i + 1];
        if (naechstes === undefined) return null;
        if (naechstes !== "\n") token += "$`\"\\".includes(naechstes) ? naechstes : `\\${naechstes}`;
        i += 1;
        continue;
      }
      if (zeichen === quote) quote = null;
      else token += zeichen;
      continue;
    }
    if (zeichen === "'" || zeichen === '"') {
      quote = zeichen;
      hatToken = true;
    } else if (zeichen === " " || zeichen === "\t") {
      schliesseToken();
    } else if (/\s/u.test(zeichen) || "(){}!".includes(zeichen) || (zeichen === "#" && !hatToken)) {
      // Fail-closed: an unquoted newline ends a command, parentheses and braces
      // group, `!` negates, a leading `#` comments — syntax this reader does not
      // model counts as outside the sandbox instead of being read as a word.
      return null;
    } else if (zeichen === "|" || zeichen === "&" || zeichen === ";") {
      schliesseToken();
      if (befehl[i + 1] === zeichen) i += 1;
      ergebnis.push([]);
    } else if (zeichen === "`" || zeichen === "$" || zeichen === "<" || zeichen === ">" || zeichen === "\\") {
      // Substitution, redirection or escapes: not evaluated, so not in the sandbox.
      return null;
    } else {
      token += zeichen;
      hatToken = true;
    }
  }
  if (quote) return null;
  schliesseToken();
  return ergebnis;
}

/** A file operand stays inside: relative within the sandbox, or the session's own stored output. */
function dateiImSandbox(pfad: string): boolean {
  if (pfad.split("/").includes("..")) return false;
  if (pfad.startsWith("/") || pfad.startsWith("~")) return EIGENE_AUSGABE.test(pfad);
  return true;
}

function filterImSandbox(tokens: readonly string[]): boolean {
  const [name, ...rest] = tokens;
  // `echo ----` as a separator reads nothing (substitutions are rejected before).
  if (name === "echo") return true;
  const regel = TEXTFILTER[name];
  if (!regel) return false;
  const ausdruecke: string[] = [];
  const operanden: string[] = [];
  let nurOperanden = false;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (nurOperanden || token === "-" || !token.startsWith("-")) {
      operanden.push(token);
    } else if (token === "--") {
      nurOperanden = true;
    } else if (token.startsWith("--")) {
      const [option, angehaengt] = token.split(/=(.*)/su);
      const werte = regel.lang?.[option!];
      if (werte === undefined) return false;
      if (angehaengt !== undefined && werte !== 1) return false;
      i += angehaengt !== undefined ? 0 : werte;
      if (i >= rest.length) return false;
    } else if (regel.zahl && /^-\d+$/u.test(token)) {
      continue;
    } else {
      for (let j = 1; j < token.length; j += 1) {
        const zeichen = token[j]!;
        if (regel.schalter.includes(zeichen)) continue;
        if (!regel.mitWert.includes(zeichen)) return false;
        const wert = token.length > j + 1 ? token.slice(j + 1) : rest[++i];
        if (wert === undefined) return false;
        if (zeichen === regel.ausdruckOption) ausdruecke.push(wert);
        break;
      }
    }
  }
  const anzahl = ausdruecke.length > 0 ? 0 : regel.ausdruecke;
  ausdruecke.push(...operanden.slice(0, anzahl));
  if (name === "sed" && !ausdruecke.every((skript) => skript.split(/[;\n]/u).every((teil) => SED_TEIL.test(teil.trim())))) return false;
  if (name === "jq" && ausdruecke.some((filter) => JQ_AUSSERHALB.test(filter))) return false;
  return operanden.slice(anzahl).every(dateiImSandbox);
}

export function imSandbox(aufruf: ToolAufruf): boolean {
  if (aufruf.name.endsWith("comvenio_hilfe")) return true;
  if (aufruf.name === "WebFetch") {
    try {
      return (WEB_DOMAINS as readonly string[]).includes(new URL(aufruf.befehl).hostname);
    } catch {
      return false;
    }
  }
  if (aufruf.name !== "Bash") return false;
  // A line break is a command boundary in bash; no cleanup below may erase it
  // ("comvenio help\n2>&1 cat …" ran cat). Fail closed before touching the text.
  if (/[\n\r]/u.test(aufruf.befehl)) return false;
  // Merging or dropping stderr reads nothing; every other redirection does.
  // A trailing `;` ends the chain without a further command.
  const befehl = aufruf.befehl.replace(/[ \t]2>&1\b|[ \t]2>[ \t]*\/dev\/null\b/gu, " ").replace(/[ \t;]+$/u, "").trim();
  const teile = segmente(befehl);
  if (!teile || teile.some((tokens) => tokens.length === 0)) return false;
  // Every segment of a chain must stay inside: `comvenio help && cat …` does not.
  return teile.every((tokens) => {
    if (tokens[0] !== "comvenio") return filterImSandbox(tokens);
    // --file reads a local file and uploads it (cai.data.06.upload) — never part of the probe.
    if (tokens.some((token) => token === "--file" || token.startsWith("--file="))) return false;
    const segment = tokens.join(" ");
    return ERLAUBTE_BEFEHLE.some((erlaubt) => segment === erlaubt || segment.startsWith(`${erlaubt} `));
  });
}

export function istConfirm(aufruf: ToolAufruf): boolean {
  return aufruf.name === "Bash" && /\bcomvenio\s+action\s+confirm\b/u.test(aufruf.befehl);
}

const ACTION_ID = /\bcai\.[a-z_]+\.\d{2}\.[a-z0-9_]+/gu;

/** Action ids or CLI errors that point to something the documentation made the session invent. */
export function erfundenes(transkript: Transkript, bekannteActions: ReadonlySet<string>): string[] {
  const funde = new Set<string>();
  const texte = [transkript.antwort ?? "", ...transkript.aufrufe.map((aufruf) => aufruf.befehl)];
  for (const text of texte) {
    for (const match of text.matchAll(ACTION_ID)) if (!bekannteActions.has(match[0])) funde.add(match[0]);
  }
  for (const aufruf of transkript.aufrufe) {
    if (aufruf.name !== "Bash" || aufruf.abgelehnt) continue;
    if (/Unknown command|Unbekannte[rs]? (Befehl|Aktion|Option)|ACTION_NOT_LISTED|Unknown option/iu.test(aufruf.ergebnis)) {
      funde.add(aufruf.befehl.trim().split(/\s+/u).slice(0, 4).join(" "));
    }
  }
  return [...funde].sort();
}

function normal(text: string): string {
  return text.toLowerCase().normalize("NFKC").replace(/[`„“"'»«]/gu, "");
}

/** A statement counts when the answer names it; multi-word steps when at least half of their words appear. */
export function genannt(aussage: string, antwort: string): boolean {
  const text = normal(antwort);
  const ziel = normal(aussage);
  if (/^(ja|nein)$/u.test(ziel)) return new RegExp(`(^|[^\\p{L}])${ziel}([^\\p{L}]|$)`, "u").test(text.slice(0, 200));
  if (text.includes(ziel)) return true;
  const woerter = ziel.split(/[^\p{L}\p{N}_-]+/u).filter((wort) => wort.length >= 4);
  if (woerter.length < 2) return false;
  return woerter.filter((wort) => text.includes(wort)).length * 2 >= woerter.length;
}

export interface Ergebnis {
  aufgabe: string;
  bereich: Bereich;
  klasse: Klasse;
  geloest: Messwert<Geloest>;
  nachschlaege: Messwert<number>;
  erfunden: Messwert<string[]>;
  confirm_versuche: Messwert<number>;
  sandbox_verstoesse: Messwert<string[]>;
  abgelehnt: Messwert<number>;
  dauer_ms: Messwert<number>;
  kosten_usd: Messwert<number>;
  begruendung: string;
}

function gemessen<T>(wert: T): Messwert<T> {
  return { status: "DERIVED", wert };
}

function nichtGemessen<T>(grund: string): Messwert<T> {
  return { status: "NOT_MEASURED", wert: null, grund };
}

function bewerteLoesung(aufgabe: Aufgabe, transkript: Transkript): { geloest: Messwert<Geloest>; begruendung: string } {
  if (aufgabe.klasse === "bau") {
    const muster = (aufgabe.befehle ?? []).map((quelle) => new RegExp(quelle, "u"));
    if (muster.length === 0) return { geloest: nichtGemessen("Bauaufgabe ohne erwarteten Befehl"), begruendung: "kein Befehl definiert" };
    const treffer = transkript.aufrufe.filter((aufruf) => aufruf.name === "Bash" && muster.some((regex) => regex.test(aufruf.befehl)));
    const beantwortet = treffer.filter((aufruf) => aufruf.beantwortet);
    const erfolgreich = beantwortet.filter((aufruf) => !aufruf.fehler && !aufruf.abgelehnt);
    if (erfolgreich.length > 0) return { geloest: gemessen("ja"), begruendung: `erfolgreich: ${erfolgreich[0]!.befehl.slice(0, 120)}` };
    if (beantwortet.length > 0) return { geloest: gemessen("teilweise"), begruendung: `richtiger Befehl, aber Fehler: ${beantwortet[0]!.ergebnis.slice(0, 120)}` };
    if (treffer.length > 0) return { geloest: nichtGemessen("erwarteter Befehl ohne Antwort im Transkript"), begruendung: `ohne Antwort: ${treffer[0]!.befehl.slice(0, 120)}` };
    return { geloest: gemessen("nein"), begruendung: "erwarteter Befehl nicht aufgerufen" };
  }
  if (aufgabe.kernaussagen.length === 0) {
    return { geloest: nichtGemessen("keine prüfbare Kernaussage in der Doku-Antwort — Urteil braucht eine unabhängige Prüfung"), begruendung: "nicht automatisch bewertbar" };
  }
  if (transkript.antwort === null) return { geloest: gemessen("nein"), begruendung: "keine Antwort der Sitzung" };
  const getroffen = aufgabe.kernaussagen.filter((aussage) => genannt(aussage, transkript.antwort!));
  const fehlend = aufgabe.kernaussagen.filter((aussage) => !getroffen.includes(aussage));
  const geloest: Geloest = fehlend.length === 0 ? "ja" : getroffen.length > 0 ? "teilweise" : "nein";
  return { geloest: gemessen(geloest), begruendung: fehlend.length === 0 ? "alle Kernaussagen genannt" : `fehlt: ${fehlend.join(", ")}` };
}

/** Scores one task. `transkript` null means the session did not run — every value NOT_MEASURED. */
export function werteAus(aufgabe: Aufgabe, transkript: Transkript | null, bekannteActions: ReadonlySet<string>, grund = "kein Transkript"): Ergebnis {
  if (!transkript) {
    return {
      aufgabe: aufgabe.id,
      bereich: aufgabe.bereich,
      klasse: aufgabe.klasse,
      geloest: nichtGemessen(grund),
      nachschlaege: nichtGemessen(grund),
      erfunden: nichtGemessen(grund),
      confirm_versuche: nichtGemessen(grund),
      sandbox_verstoesse: nichtGemessen(grund),
      abgelehnt: nichtGemessen(grund),
      dauer_ms: nichtGemessen(grund),
      kosten_usd: nichtGemessen(grund),
      begruendung: grund,
    };
  }
  const { geloest, begruendung } = bewerteLoesung(aufgabe, transkript);
  // DC-3: a tool the provider actually ran outside the sandbox invalidates the
  // measurement regardless of the result; a denied attempt is counted apart.
  const verstoesse = transkript.aufrufe.filter((aufruf) => !aufruf.abgelehnt && !imSandbox(aufruf)).map((aufruf) => `${aufruf.name}: ${aufruf.befehl.slice(0, 120)}`);
  return {
    aufgabe: aufgabe.id,
    bereich: aufgabe.bereich,
    klasse: aufgabe.klasse,
    geloest,
    nachschlaege: gemessen(transkript.aufrufe.filter(istNachschlag).length),
    erfunden: gemessen(erfundenes(transkript, bekannteActions)),
    confirm_versuche: gemessen(transkript.aufrufe.filter(istConfirm).length),
    sandbox_verstoesse: gemessen(verstoesse),
    abgelehnt: gemessen(transkript.aufrufe.filter((aufruf) => aufruf.abgelehnt).length),
    dauer_ms: transkript.dauer_ms === null ? nichtGemessen("Provider meldete keine Dauer") : gemessen(transkript.dauer_ms),
    kosten_usd: transkript.kosten_usd === null ? nichtGemessen("Provider meldete keine Kosten") : gemessen(transkript.kosten_usd),
    begruendung,
  };
}

/** Every cai.* id the documentation publishes — the reference for invented ids. */
export function bekannteActions(root: string): Set<string> {
  const ids = new Set<string>();
  for (const datei of Object.values(ARTIKEL).concat(["cli-reference.md", "aufgaben.md", "auth-club.md", "buchungen-objekte.md", "dateien.md", "mitglieder-teams.md", "rollen-rechte.md", "speisekarten.md", "sponsoring.md", "vereinsnews.md", "wochenvorschau.md", "zonen.md", "club-agent.md"])) {
    const pfad = join(root, "docs", datei);
    if (!existsSync(pfad)) continue;
    for (const match of readFileSync(pfad, "utf8").matchAll(ACTION_ID)) ids.add(match[0]);
  }
  return ids;
}

// ── Report ───────────────────────────────────────────────────────────────

export interface Gruppe {
  bereich: Bereich;
  klasse: Klasse;
  status: Messstatus;
  aufgaben: number;
  ja: number;
  teilweise: number;
  nein: number;
  nicht_gemessen: number;
  nachschlaege_summe: number | null;
  grund?: string;
}

export interface Luecke {
  aufgabe: string;
  strang: string;
  fundstelle: string;
  befund: string;
}

export interface Bericht {
  version: 1;
  lauf: string;
  datum: string;
  umgebung: Umgebung;
  doku_stand: { cli_version: string | null; cli_commit: string | null; hilfe_center: string };
  provider: { name: string; modell: string };
  sandbox: { befehle: readonly string[]; web: readonly string[]; mcp: string; mcp_verbunden: Messwert<boolean> };
  katalog_hash: string;
  ergebnisse: Ergebnis[];
  gruppen: Gruppe[];
  luecken: Luecke[];
  luecken_vorab: string[];
  verstoesse: { confirm: number; sandbox: string[] };
}

export function gruppiere(ergebnisse: readonly Ergebnis[], katalog: Katalog): Gruppe[] {
  const gruppen: Gruppe[] = [];
  for (const bereich of BEREICHE) {
    for (const klasse of KLASSEN) {
      const na = katalog.nicht_anwendbar.find((eintrag) => eintrag.bereich === bereich && eintrag.klasse === klasse);
      const eigene = ergebnisse.filter((ergebnis) => ergebnis.bereich === bereich && ergebnis.klasse === klasse);
      const zaehle = (wert: Geloest) => eigene.filter((ergebnis) => ergebnis.geloest.wert === wert).length;
      const nichtGemessen = eigene.filter((ergebnis) => ergebnis.geloest.status === "NOT_MEASURED").length;
      let status: Messstatus;
      let grund: string | undefined;
      if (na) {
        status = "NOT_APPLICABLE";
        grund = na.grund;
      } else if (eigene.length === 0) {
        status = "NOT_MEASURED";
        grund = "keine Aufgabe dieser Gruppe im Lauf";
      } else if (nichtGemessen === eigene.length) {
        status = "NOT_MEASURED";
        grund = eigene[0]!.geloest.grund;
      } else {
        status = nichtGemessen > 0 ? "PARTIAL" : "DERIVED";
      }
      const nachschlaege = eigene.filter((ergebnis) => ergebnis.nachschlaege.wert !== null);
      gruppen.push({
        bereich,
        klasse,
        status,
        aufgaben: eigene.length,
        ja: zaehle("ja"),
        teilweise: zaehle("teilweise"),
        nein: zaehle("nein"),
        nicht_gemessen: nichtGemessen,
        nachschlaege_summe: nachschlaege.length === 0 ? null : nachschlaege.reduce((summe, ergebnis) => summe + ergebnis.nachschlaege.wert!, 0),
        ...(grund ? { grund } : {}),
      });
    }
  }
  return gruppen;
}

export function luecken(ergebnisse: readonly Ergebnis[], katalog: Katalog): Luecke[] {
  const nachId = new Map(katalog.aufgaben.map((aufgabe) => [aufgabe.id, aufgabe]));
  const liste: Luecke[] = [];
  for (const ergebnis of ergebnisse) {
    const aufgabe = nachId.get(ergebnis.aufgabe);
    if (!aufgabe || ergebnis.geloest.status !== "DERIVED" || ergebnis.geloest.wert === "ja") continue;
    liste.push({ aufgabe: aufgabe.id, strang: strangFuer(aufgabe.bereich, aufgabe.klasse), fundstelle: aufgabe.fundstelle, befund: ergebnis.begruendung });
  }
  for (const eintrag of katalog.nicht_anwendbar) {
    liste.push({ aufgabe: `${eintrag.bereich}/${eintrag.klasse}`, strang: strangFuer(eintrag.bereich, eintrag.klasse), fundstelle: "—", befund: `bekannte Lücke: ${eintrag.grund}` });
  }
  return liste;
}

function zelle(wert: Messwert<unknown>): string {
  if (wert.status === "NOT_MEASURED" || wert.status === "NOT_APPLICABLE") return wert.status;
  if (Array.isArray(wert.wert)) return wert.wert.length === 0 ? "0" : String(wert.wert.length);
  return String(wert.wert);
}

export function berichtMarkdown(bericht: Bericht): string {
  const zeilen = [
    `# Probelauf ${bericht.datum} (${bericht.lauf})`,
    "",
    `- Umgebung: ${bericht.umgebung} · Provider: ${bericht.provider.name} ${bericht.provider.modell}`,
    `- Doku-Stand: comvenio ${bericht.doku_stand.cli_version ?? "NOT_MEASURED"}${bericht.doku_stand.cli_commit ? ` (Commit ${bericht.doku_stand.cli_commit})` : ""} · Hilfe-Center ${bericht.doku_stand.hilfe_center}`,
    `- Katalog: ${bericht.katalog_hash.slice(0, 12)} · comvenio_hilfe verbunden: ${zelle(bericht.sandbox.mcp_verbunden)}`,
    `- Verstöße: action confirm ${bericht.verstoesse.confirm} · Sandbox ${bericht.verstoesse.sandbox.length}`,
    "",
    "## Ergebnis je Bereich und Aufgabenklasse",
    "",
    "| Bereich | Klasse | Status | Aufgaben | ja | teilweise | nein | nicht gemessen | Nachschläge |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|",
    ...bericht.gruppen.map((gruppe) => `| ${gruppe.bereich} | ${gruppe.klasse} | ${gruppe.status}${gruppe.grund ? ` — ${gruppe.grund}` : ""} | ${gruppe.aufgaben} | ${gruppe.ja} | ${gruppe.teilweise} | ${gruppe.nein} | ${gruppe.nicht_gemessen} | ${gruppe.nachschlaege_summe ?? "NOT_MEASURED"} |`),
    "",
    "## Ergebnis je Aufgabe",
    "",
    "| Aufgabe | gelöst | Nachschläge | erfunden | confirm | Sandbox | Dauer ms | Begründung |",
    "|---|---|---:|---:|---:|---:|---:|---|",
    ...bericht.ergebnisse.map((ergebnis) => `| ${ergebnis.aufgabe} | ${zelle(ergebnis.geloest)} | ${zelle(ergebnis.nachschlaege)} | ${zelle(ergebnis.erfunden)} | ${zelle(ergebnis.confirm_versuche)} | ${zelle(ergebnis.sandbox_verstoesse)} | ${zelle(ergebnis.dauer_ms)} | ${ergebnis.begruendung.replace(/\|/gu, "\\|").replace(/\n/gu, " ")} |`),
    "",
    "## Doku-Lücken",
    "",
    ...(bericht.luecken.length === 0 ? ["Keine."] : bericht.luecken.map((luecke) => `- **${luecke.aufgabe}** → Strang ${luecke.strang} (${luecke.fundstelle}): ${luecke.befund}`)),
    ...(bericht.luecken_vorab.length === 0 ? [] : ["", "Vor dem Lauf sichtbar:", "", ...bericht.luecken_vorab.map((luecke) => `- ${luecke}`)]),
    "",
  ];
  return zeilen.join("\n");
}

// ── Repeatability (TC-06) ────────────────────────────────────────────────

export interface Vergleich {
  vergleichbar: boolean;
  gruende: string[];
  paare: number;
  gleich: number;
  uebereinstimmung: Messwert<number>;
  abweichungen: { aufgabe: string; a: Geloest | null; b: Geloest | null }[];
}

/** Share of equal verdicts below which two runs on the same stand count as unstable. */
export const STABIL_AB = 0.8;

/** TC-06 verdict: comparable and at least STABIL_AB of the shared verdicts equal. */
export function istStabil(vergleich: Vergleich): boolean {
  return vergleich.vergleichbar && vergleich.uebereinstimmung.wert !== null && vergleich.uebereinstimmung.wert >= STABIL_AB;
}

/**
 * Compares two reports. Only runs on the same catalog, documentation stand,
 * environment and model are comparable — otherwise the difference could be
 * the documentation, which is exactly what a run is meant to detect.
 */
export function vergleiche(a: Bericht, b: Bericht): Vergleich {
  const gruende: string[] = [];
  if (a.katalog_hash !== b.katalog_hash) gruende.push("anderer Katalog");
  if (a.doku_stand.cli_version !== b.doku_stand.cli_version || a.doku_stand.cli_commit !== b.doku_stand.cli_commit) gruende.push("anderer Doku-Stand");
  if (a.umgebung !== b.umgebung) gruende.push("andere Umgebung");
  if (a.provider.modell !== b.provider.modell) gruende.push("anderes Modell");
  const inB = new Map(b.ergebnisse.map((ergebnis) => [ergebnis.aufgabe, ergebnis]));
  let paare = 0;
  let gleich = 0;
  const abweichungen: Vergleich["abweichungen"] = [];
  for (const ergebnisA of a.ergebnisse) {
    const ergebnisB = inB.get(ergebnisA.aufgabe);
    if (!ergebnisB || ergebnisA.geloest.status !== "DERIVED" || ergebnisB.geloest.status !== "DERIVED") continue;
    paare += 1;
    if (ergebnisA.geloest.wert === ergebnisB.geloest.wert) gleich += 1;
    else abweichungen.push({ aufgabe: ergebnisA.aufgabe, a: ergebnisA.geloest.wert, b: ergebnisB.geloest.wert });
  }
  const uebereinstimmung: Messwert<number> =
    paare === 0 ? { status: "NOT_MEASURED", wert: null, grund: "keine gemeinsam bewertete Aufgabe" } : { status: "DERIVED", wert: gleich / paare };
  return { vergleichbar: gruende.length === 0, gruende, paare, gleich, uebereinstimmung, abweichungen };
}
