#!/usr/bin/env bun
/**
 * probelauf — runs the Probelauf (comvenio-cli-doku 09): one sandboxed claude
 * session per task, scored from its transcript, written as a report.
 *
 *   bun run probelauf                          # standard set, DEV, sonnet
 *   bun run probelauf -- --klasse fachfrage    # only one task class
 *   bun run probelauf -- --aufgabe <id> …      # chosen tasks; --alle for the whole catalog
 *   bun run probelauf -- --cli <binary>        # candidate CLI before a release (09 §4.5)
 *   bun run probelauf katalog                  # print the catalog, no session
 *   bun run probelauf vergleich <a.json> <b.json>   # repeatability (TC-06)
 *
 * Triggered by hand after a material documentation update (06-08) and before
 * a new customer documentation stand is published — never by CI (09 DC-7): a
 * session run costs money and scatters. Build tasks need `comvenio login` in
 * the Comvenio club; without it they are NOT_MEASURED, the rest still runs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type Aufgabe,
  type Bericht,
  type Ergebnis,
  type Katalog,
  type Transkript,
  type Umgebung,
  baueKatalog,
  bekannteActions,
  berichtMarkdown,
  claudeArgumente,
  cliHuelle,
  ERLAUBTE_BEFEHLE,
  gruppiere,
  istStabil,
  KLASSEN,
  leseTranskript,
  luecken,
  MCP_URL,
  mcpKonfiguration,
  prompt,
  standardSatz,
  UMGEBUNGEN,
  vergleiche,
  WEB_DOMAINS,
  werteAus,
} from "./probelauf.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function optionen(name: string): string[] {
  return args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]!] : []));
}

function fehler(text: string): never {
  console.error(`probelauf: ${text}`);
  process.exit(2);
}

if (args[0] === "vergleich") {
  const [a, b] = args.slice(1);
  if (!a || !b) fehler("vergleich <bericht-a.json> <bericht-b.json>");
  const ergebnis = vergleiche(JSON.parse(readFileSync(a, "utf8")), JSON.parse(readFileSync(b, "utf8")));
  console.log(JSON.stringify(ergebnis, null, 2));
  process.exit(istStabil(ergebnis) ? 0 : 1);
}

const katalog: Katalog = baueKatalog(ROOT);

if (args[0] === "katalog") {
  const satz = new Set(standardSatz(katalog).map((aufgabe) => aufgabe.id));
  for (const aufgabe of katalog.aufgaben) console.log(`${satz.has(aufgabe.id) ? "*" : " "} ${aufgabe.id}`);
  for (const eintrag of katalog.nicht_anwendbar) console.log(`  ${eintrag.bereich}/${eintrag.klasse}: NOT_APPLICABLE — ${eintrag.grund}`);
  for (const luecke of katalog.luecken_vorab) console.log(`  Lücke: ${luecke}`);
  console.log(`${katalog.aufgaben.length} Aufgaben, Standardsatz ${satz.size} (*), Katalog ${katalog.hash.slice(0, 12)}`);
  process.exit(0);
}

const umgebung = (option("--umgebung") ?? "dev") as Umgebung;
if (!(umgebung in UMGEBUNGEN)) fehler('--umgebung muss "dev" oder "prod" sein');
const modell = option("--modell") ?? "sonnet";
const maxTurns = Number(option("--max-turns") ?? "20");
const timeoutMs = Number(option("--timeout-s") ?? "600") * 1000;
const cli = option("--cli");
const klasse = option("--klasse");
if (klasse && !(KLASSEN as readonly string[]).includes(klasse)) fehler(`--klasse muss eine von ${KLASSEN.join(", ")} sein`);

let auswahl: Aufgabe[] = args.includes("--alle") ? katalog.aufgaben : standardSatz(katalog);
const gewuenscht = optionen("--aufgabe");
if (gewuenscht.length > 0) {
  auswahl = katalog.aufgaben.filter((aufgabe) => gewuenscht.includes(aufgabe.id));
  const fehlend = gewuenscht.filter((id) => !auswahl.some((aufgabe) => aufgabe.id === id));
  if (fehlend.length > 0) fehler(`unbekannte Aufgabe(n): ${fehlend.join(", ")} — bun run probelauf katalog`);
}
if (klasse) auswahl = auswahl.filter((aufgabe) => aufgabe.klasse === klasse);

// The CLI under test: the public binary on PATH, or a candidate build handed in
// with --cli — either way behind the wrapper that refuses --file (cliHuelle).
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
if (cli && !existsSync(cli)) fehler(`--cli ${cli} existiert nicht`);
const echteCli = cli ? resolve(cli) : (env.PATH ?? "").split(":").map((dir) => join(dir, "comvenio")).find((pfad) => existsSync(pfad));
if (!echteCli) fehler("comvenio nicht im PATH — installieren oder --cli <pfad> angeben");
const binDir = mkdtempSync(join(tmpdir(), "probelauf-bin-"));
writeFileSync(join(binDir, "comvenio"), cliHuelle(echteCli!), { mode: 0o755 });
env.PATH = `${binDir}:${env.PATH ?? ""}`;

function comvenio(...cliArgs: string[]): { ok: boolean; stdout: string } {
  const lauf = spawnSync("comvenio", cliArgs, { env, encoding: "utf8", timeout: 30_000 });
  return { ok: lauf.status === 0, stdout: `${lauf.stdout ?? ""}` };
}

const version = comvenio("--version");
const cliVersion = version.ok ? version.stdout.trim().split("\n")[0]! : null;
const cliCommit = cliVersion ? (/\.([0-9a-f]{7,40})\b/u.exec(cliVersion)?.[1] ?? null) : null;

// Club restriction (no exception): a sign-in outside the Comvenio club stops the run.
const whoami = comvenio("whoami", "--json");
let angemeldet = false;
if (whoami.ok) {
  const identitaet = JSON.parse(whoami.stdout) as { clubId?: string | null; environment?: string };
  if (identitaet.environment !== umgebung) fehler(`angemeldet in ${identitaet.environment}, verlangt ${umgebung} — comvenio login --env ${umgebung}`);
  if (identitaet.clubId !== UMGEBUNGEN[umgebung].club) fehler(`angemeldeter Verein ${identitaet.clubId} ist nicht der Comvenio-Verein — Lauf abgebrochen`);
  angemeldet = true;
}

const lauf = new Date().toISOString().replace(/[:.]/gu, "-");
const ziel = resolve(option("--ziel") ?? join(ROOT, "probelauf", "berichte"), lauf);
mkdirSync(ziel, { recursive: true });
writeFileSync(join(ziel, "katalog.json"), `${JSON.stringify(katalog, null, 2)}\n`);

const actions = bekannteActions(ROOT);
const ergebnisse: Ergebnis[] = [];
const mcpStati: boolean[] = [];

function fuehreAus(aufgabe: Aufgabe): Transkript | string {
  if (aufgabe.klasse === "bau" && !angemeldet) return "keine comvenio-Anmeldung — comvenio login --env " + umgebung;
  // 09 DC-5: writing below the confirmation stage only on DEV; PROD stays read-only.
  if (aufgabe.schreibt && umgebung !== "dev") return "schreibende Bauaufgabe nur auf DEV";
  const sandbox = mkdtempSync(join(tmpdir(), "probelauf-"));
  try {
    const mcpDatei = join(sandbox, "mcp.json");
    writeFileSync(mcpDatei, mcpKonfiguration());
    const ausfuehrung = spawnSync(
      "claude",
      claudeArgumente({ prompt: prompt(aufgabe, umgebung), modell, mcpConfig: mcpDatei, maxTurns }),
      { cwd: sandbox, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
    );
    const roh = ausfuehrung.stdout ?? "";
    writeFileSync(join(ziel, `${aufgabe.id}.jsonl`), roh);
    if (ausfuehrung.error) return `Provider-Aufruf gescheitert: ${ausfuehrung.error.message}`;
    if (!roh.includes('"type":"result"')) return `Provider ohne Ergebnis (Exit ${ausfuehrung.status}): ${(ausfuehrung.stderr ?? "").slice(0, 200)}`;
    return leseTranskript(roh);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  for (const aufgabe of auswahl) {
    process.stdout.write(`probelauf: ${aufgabe.id} … `);
    const transkript = fuehreAus(aufgabe);
    if (typeof transkript === "string") {
      ergebnisse.push(werteAus(aufgabe, null, actions, transkript));
      console.log(`NOT_MEASURED (${transkript})`);
      continue;
    }
    if (transkript.mcp.length > 0) mcpStati.push(transkript.mcp.some((server) => server.status === "connected"));
    const ergebnis = werteAus(aufgabe, transkript, actions);
    ergebnisse.push(ergebnis);
    console.log(`${ergebnis.geloest.wert ?? ergebnis.geloest.status} (${ergebnis.begruendung})`);
  }
} finally {
  rmSync(binDir, { recursive: true, force: true });
}

const bericht: Bericht = {
  version: 1,
  lauf,
  datum: new Date().toISOString().slice(0, 10),
  umgebung,
  doku_stand: {
    cli_version: cliVersion,
    cli_commit: cliCommit,
    hilfe_center: option("--homepage-commit") ?? "NOT_MEASURED (öffentlicher Stand, Commit nicht abrufbar)",
  },
  provider: { name: "claude-cli", modell },
  sandbox: {
    befehle: ERLAUBTE_BEFEHLE,
    web: WEB_DOMAINS,
    mcp: MCP_URL,
    mcp_verbunden:
      mcpStati.length === 0
        ? { status: "NOT_MEASURED", wert: null, grund: "keine Sitzung gelaufen" }
        : { status: "DERIVED", wert: mcpStati.every(Boolean) },
  },
  katalog_hash: katalog.hash,
  ergebnisse,
  gruppen: gruppiere(ergebnisse, katalog),
  luecken: luecken(ergebnisse, katalog),
  luecken_vorab: katalog.luecken_vorab,
  verstoesse: {
    confirm: ergebnisse.reduce((summe, ergebnis) => summe + (ergebnis.confirm_versuche.wert ?? 0), 0),
    sandbox: ergebnisse.flatMap((ergebnis) => (ergebnis.sandbox_verstoesse.wert ?? []).map((verstoss) => `${ergebnis.aufgabe} — ${verstoss}`)),
  },
};

writeFileSync(join(ziel, "bericht.json"), `${JSON.stringify(bericht, null, 2)}\n`);
writeFileSync(join(ziel, "bericht.md"), berichtMarkdown(bericht));
console.log(`probelauf: Bericht ${join(ziel, "bericht.md")}`);

const vorher = option("--vergleich-mit");
if (vorher) {
  const vergleich = vergleiche(JSON.parse(readFileSync(vorher, "utf8")), bericht);
  console.log(`probelauf: Vergleich — ${JSON.stringify(vergleich)}`);
  // Same verdict as `probelauf vergleich` (TC-06): not comparable or below STABIL_AB fails the run.
  if (!istStabil(vergleich)) process.exit(1);
}
