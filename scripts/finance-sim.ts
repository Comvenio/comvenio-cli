// Two-year finance simulation for the Comvenio club — CLI only (comvenio finance run / action call).
// Every created id is stored in state.json; a rerun skips finished steps.
// Runs: (none) 2024+2025 · 2026 · saison · korrektur · abteilungen · invest · export <jahr> · bereich-als-sicht
// State, log and audit exports live in FINANCE_SIM_DIR (default scripts/finance-sim/, not versioned);
// the report of the run bereich-als-sicht lies in scripts/finance-sim/berichte/ (bereich-als-sicht-05 §4.3).
// Only the Comvenio club — `comvenio whoami` must name 0ec34e70-999a-47c4-a1b1-bdb293110fa5.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CLI_DIR = join(import.meta.dir, "..");
const HERE = process.env.FINANCE_SIM_DIR ?? join(import.meta.dir, "finance-sim");
mkdirSync(HERE, { recursive: true });
const STATE_FILE = join(HERE, "state.json");
const LOG_FILE = join(HERE, "log.jsonl");
const state: Record<string, any> = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

function cli(args: string[], profile?: string): any {
  const env = { ...process.env, ...(profile ? { COMVENIO_CLI_PROFILE: profile } : {}) };
  const proc = Bun.spawnSync(["bun", "run", "src/index.ts", ...args], { cwd: CLI_DIR, stdout: "pipe", stderr: "pipe", env });
  const out = proc.stdout.toString().trim();
  const err = proc.stderr.toString().trim();
  writeFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), args, exit: proc.exitCode, out: out.slice(0, 4000), err: err.slice(0, 2000) }) + "\n", { flag: "a" });
  if (proc.exitCode !== 0) throw new Error(`CLI ${args.slice(0, 4).join(" ")} → exit ${proc.exitCode}: ${(err || out).slice(0, 800)}`);
  try { return JSON.parse(out); } catch { throw new Error(`Keine JSON-Antwort: ${out.slice(0, 400)}`); }
}
const fin = (area: string, op: string, input: object = {}, profile?: string) => {
  const res = cli(["finance", "run", area, op, "--input", JSON.stringify(input)], profile);
  if (res.widget === "confirmation" || res.confirmation_required) throw new Error(`${area} ${op}: nur Vorschau, nicht ausgeführt`);
  if (res.status && res.status !== "completed") throw new Error(`${area} ${op}: ${JSON.stringify(res).slice(0, 600)}`);
  return res.result ?? res;
};
const act = (id: string, input: object) => {
  // A critical action answers with a preview first; the terminal call confirms it
  // (preview_id + confirmation_token) under the same idempotency key.
  const key = crypto.randomUUID();
  const res = cli(["action", "call", id, "--input", JSON.stringify(input), "--idempotency-key", key, "--json"]);
  const preview = res?.confirmation ?? res?.data?.preview;
  if (res?.widget === "confirmation" && preview?.preview_id && preview?.confirmation_token) {
    const done = cli(["action", "confirm", id, "--preview-id", preview.preview_id, "--confirmation-token", preview.confirmation_token, "--idempotency-key", preview.idempotency_key ?? key, "--json"]);
    return done.result ?? done;
  }
  if (res?.widget === "confirmation") throw new Error(`${id}: nur Vorschau, kein Bestätigungstoken`);
  return res.result ?? res;
};
async function step<T>(key: string, fn: () => T): Promise<T> {
  if (key in state) return state[key];
  const value = fn();
  state[key] = value;
  save();
  console.log(`✓ ${key}`);
  return value;
}

// ── Stammdaten ──────────────────────────────────────────────────────────
const DEFAULT_DEPARTMENT = "9b66e0e9-2ed9-4d2b-80ab-b38a779aea7a"; // "Verein"
const YEARS = [2024, 2025] as const;
const PREFIX = "[Finanz-Simulation]";

// Seeded random for reproducible amounts.
let seed = 20240101;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const vary = (cents: number, pct = 0.08) => Math.max(100, Math.round(cents * (1 - pct + 2 * pct * rnd()) / 100) * 100);
const d = (y: number, m: number, day: number) => `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

type Pos = { key: string; name: string; category: string; sphere: string; rev?: number; exp?: number; event?: string; recurring?: boolean; account: "bank" | "cash" };
const POSITIONS: Pos[] = [
  { key: "beitraege", name: "Mitgliedsbeiträge", category: "Mitglieder", sphere: "IDEELL", rev: 2_400_000, account: "bank" },
  { key: "spenden", name: "Spenden", category: "Mitglieder", sphere: "IDEELL", rev: 300_000, account: "bank" },
  { key: "zuschuss", name: "Zuschuss Übungsleiter (Landessportbund)", category: "Zuschüsse", sphere: "IDEELL", rev: 180_000, account: "bank" },
  { key: "uebungsleiter", name: "Übungsleiterpauschalen", category: "Sportbetrieb", sphere: "IDEELL", exp: 720_000, account: "bank" },
  { key: "verband", name: "Verbandsabgaben und Versicherung", category: "Verwaltung", sphere: "IDEELL", exp: 310_000, account: "bank" },
  { key: "spielbetrieb_ein", name: "Spielbetrieb Eintritt", category: "Sportbetrieb", sphere: "ZWECKBETRIEB", rev: 150_000, account: "cash" },
  { key: "spielbetrieb_aus", name: "Spielbetrieb Schiedsrichter und Fahrten", category: "Sportbetrieb", sphere: "ZWECKBETRIEB", exp: 220_000, account: "bank" },
  { key: "sommerfest_ein", name: "Sommerfest Einnahmen", category: "Veranstaltungen", sphere: "WIRTSCHAFTLICH", rev: 850_000, event: "sommerfest", account: "cash" },
  { key: "sommerfest_aus", name: "Sommerfest Ausgaben", category: "Veranstaltungen", sphere: "WIRTSCHAFTLICH", exp: 520_000, event: "sommerfest", account: "bank" },
  { key: "weihnacht_ein", name: "Weihnachtsfeier Eigenanteile", category: "Veranstaltungen", sphere: "IDEELL", rev: 60_000, event: "weihnacht", account: "cash" },
  { key: "weihnacht_aus", name: "Weihnachtsfeier Ausgaben", category: "Veranstaltungen", sphere: "IDEELL", exp: 180_000, event: "weihnacht", account: "bank" },
  { key: "sponsoring", name: "Sponsoring Trikotwerbung", category: "Sponsoring", sphere: "WIRTSCHAFTLICH", rev: 400_000, account: "bank" },
  { key: "zinsen", name: "Zinsen Tagesgeld", category: "Vermögen", sphere: "VERMOEGENSVERWALTUNG", rev: 12_000, account: "bank" },
  { key: "vereinsheim", name: "Vereinsheim Energie und Instandhaltung", category: "Vereinsheim", sphere: "IDEELL", exp: 450_000, account: "bank" },
  { key: "verwaltung", name: "Verwaltung und Software", category: "Verwaltung", sphere: "IDEELL", exp: 90_000, account: "bank" },
];
// Only in 2025: planning costs of the extension (from the investment plan).
const ANBAU_POS: Pos = { key: "anbau_planung", name: "Anbau Vereinsheim: Planung und Genehmigung", category: "Investitionen", sphere: "IDEELL", exp: 600_000, recurring: false, account: "bank" };

// How often a position is booked and on which days.
const SCHEDULE: Record<string, (y: number) => { date: string; share: number; text: string }[]> = {
  beitraege: (y) => [1, 4, 7, 10].map((m) => ({ date: d(y, m, 15), share: 0.25, text: `Beitragseinzug Q${(m + 2) / 3} ${y}` })),
  spenden: (y) => [3, 6, 11, 12].map((m, i) => ({ date: d(y, m, 8 + i), share: 0.25, text: `Spende Mitglied (Zuwendungsbestätigung ${y}-${String(i + 1).padStart(3, "0")})` })),
  zuschuss: (y) => [{ date: d(y, 9, 20), share: 1, text: `ÜL-Zuschuss Landessportbund ${y}` }],
  uebungsleiter: (y) => Array.from({ length: 12 }, (_, i) => ({ date: d(y, i + 1, 28), share: 1 / 12, text: `Übungsleiterpauschale ${String(i + 1).padStart(2, "0")}/${y}` })),
  verband: (y) => [{ date: d(y, 2, 10), share: 0.6, text: `Verbandsbeitrag ${y}` }, { date: d(y, 3, 1), share: 0.4, text: `Vereinshaftpflicht und Unfallversicherung ${y}` }],
  spielbetrieb_ein: (y) => [4, 5, 9, 10].map((m) => ({ date: d(y, m, 12), share: 0.25, text: `Eintritt Heimspiele ${String(m).padStart(2, "0")}/${y}` })),
  spielbetrieb_aus: (y) => [4, 5, 9, 10].map((m) => ({ date: d(y, m, 14), share: 0.25, text: `Schiedsrichterkosten ${String(m).padStart(2, "0")}/${y}` })),
  sommerfest_ein: (y) => [{ date: d(y, 7, 13), share: 0.55, text: `Sommerfest ${y}: Getränkeverkauf` }, { date: d(y, 7, 13), share: 0.45, text: `Sommerfest ${y}: Speisenverkauf` }],
  sommerfest_aus: (y) => [{ date: d(y, 7, 5), share: 0.6, text: `Sommerfest ${y}: Getränkelieferung` }, { date: d(y, 7, 8), share: 0.25, text: `Sommerfest ${y}: Zeltmiete` }, { date: d(y, 7, 16), share: 0.15, text: `Sommerfest ${y}: GEMA und Genehmigung` }],
  weihnacht_ein: (y) => [{ date: d(y, 12, 14), share: 1, text: `Weihnachtsfeier ${y}: Eigenanteile` }],
  weihnacht_aus: (y) => [{ date: d(y, 12, 10), share: 0.7, text: `Weihnachtsfeier ${y}: Catering` }, { date: d(y, 12, 15), share: 0.3, text: `Weihnachtsfeier ${y}: Saalmiete` }],
  sponsoring: (y) => [{ date: d(y, 3, 31), share: 0.5, text: `Trikotsponsoring ${y}, Rate 1` }, { date: d(y, 9, 30), share: 0.5, text: `Trikotsponsoring ${y}, Rate 2` }],
  zinsen: (y) => [{ date: d(y, 12, 30), share: 1, text: `Zinsgutschrift Tagesgeld ${y}` }],
  vereinsheim: (y) => [1, 3, 5, 7, 9, 11].map((m) => ({ date: d(y, m, 5), share: 1 / 6, text: `Abschlag Strom und Gas ${String(m).padStart(2, "0")}/${y}` })),
  verwaltung: (y) => [{ date: d(y, 1, 20), share: 1, text: `Vereinssoftware Jahreslizenz ${y}` }],
  anbau_planung: (y) => [{ date: d(y, 5, 20), share: 0.5, text: `Architekt Entwurfsplanung Anbau (Abschlag 1)` }, { date: d(y, 10, 20), share: 0.5, text: `Architekt Genehmigungsplanung Anbau (Abschlag 2)` }],
};

const EVENTS: Record<string, (y: number) => object> = {
  sommerfest: (y) => ({ title: `${PREFIX} Sommerfest ${y}`, start_time: `${y}-07-13T12:00:00+02:00`, end_time: `${y}-07-13T23:00:00+02:00`, event_type: "party", location: "Vereinsgelände" }),
  weihnacht: (y) => ({ title: `${PREFIX} Weihnachtsfeier ${y}`, start_time: `${y}-12-14T18:00:00+01:00`, end_time: `${y}-12-14T23:30:00+01:00`, event_type: "party", location: "Vereinsheim" }),
};

// ── Ablauf ──────────────────────────────────────────────────────────────
async function main() {
  // Verfahrensdokumentation (GoBD) — once, first.
  await step("procedure_doc", () => fin("procedure-doc", "save", { data: {
    base_version_no: 0,
    change_reason: "Ersterstellung",
    content: {
      verein_angaben: "Comvenio (Simulationsverein im Finanz-Hub). Gemeinnütziger Sportverein, Geschäftsjahr = Kalenderjahr. Buchführung als Einnahmen-Überschuss-Rechnung nach Sphären (ideeller Bereich, Vermögensverwaltung, Zweckbetrieb, wirtschaftlicher Geschäftsbetrieb).",
      verantwortliche: [{ rolle: "Kassier", name: "Kassier des Vereins", seit: "2024-01-01" }, { rolle: "Kassenprüfer", name: "Zwei gewählte Kassenprüfer", seit: "2024-01-01" }],
      buchungsablauf: "Jeder Geschäftsvorfall wird zeitnah im Finanz-Hub gebucht: Budgetposten, Geldkonto, Datum, Betrag, Beleg oder begründeter Eigenbeleg. Buchungen erhalten eine fortlaufende Journalnummer und sind nach Freigabe festgeschrieben; Korrekturen nur per Storno.",
      kassenfuehrung: "Barkasse im Vereinsheim mit Kassenbuch im Finanz-Hub; Kassensturz quartalsweise, Kassenbericht wird eingereicht und durch den Vorstand freigegeben.",
      belegablage: "Belege digital im DataShare, Papieroriginale im Ordner je Geschäftsjahr, Aufbewahrung 10 Jahre (§ 147 AO).",
      bankkonten: "Girokonto Sparkasse (Endziffern 4711) als Hauptkonto; Abgleich mit Kontoauszug über die Anfangsbestände und die Kontenabstimmung je Plan.",
      internes_kontrollsystem: "Vier-Augen-Prinzip: Kassenberichte reicht der Kassier ein, der Vorstand gibt frei. Jahresabschluss erst nach Kassenprüfung; der Abschluss prüft die Bilanzidentität der Geldkonten.",
      ablage_ausserhalb: "Keine Buchführung außerhalb des Finanz-Hubs; der Prüfexport je Geschäftsjahr wird zusätzlich revisionssicher abgelegt.",
    },
  } }));

  // Geldkonten
  const bank = await step("account_bank", () => fin("money-account", "create", { data: { name: `${PREFIX} Girokonto Sparkasse`, kind: "BANK", iban_last4: "4711", is_default: true } }).id);
  const cash = await step("account_cash", () => fin("money-account", "create", { data: { name: `${PREFIX} Barkasse Vereinsheim`, kind: "CASH" } }).id);
  const accounts = { bank, cash };

  // `bun run finance-sim.ts 2026`: the running year — club plan from the closed 2025.
  if (process.argv[2] === "2026") { await simulate2026(accounts); return; }
  // `bun run finance-sim.ts saison`: season (1 July to 30 April) against the
  // calendar-year club plans — budget-saison, Tom 2026-09-23.
  if (process.argv[2] === "saison") { await simulateSaison(); return; }
  // `bun run finance-sim.ts korrektur`: buchhaltung-13 — objection, open items, correction with reason, detail.
  if (process.argv[2] === "korrektur") { await simulateKorrektur(); return; }
  // `bun run finance-sim.ts bereich-als-sicht`: department plans closed, the year
  // again in the club plan — periods, grants, positions in the window (bereich-als-sicht-05).
  if (process.argv[2] === "bereich-als-sicht") { await simulateBereichAlsSicht(); return; }
  // `bun run finance-sim.ts abteilungen`: department budgets (budgetplanung) in
  // the club's own departments — Tom 2026-09-23: „Vorhandene Abteilungen“.
  if (process.argv[2] === "abteilungen") { await simulateAbteilungen(); return; }

  // `bun run finance-sim.ts invest` runs only the investment plan (independent of the years).
  // "export <year>": only the audit export of one closed year — the years are simulated already.
  if (process.argv[2] !== "invest" && process.argv[2] !== "export") for (const year of YEARS) await simulateYear(year, accounts);

  // Investitionsplan Anbau
  const inv = await step("invest_plan", () => fin("investment-plan", "create", { data: {
    title: `${PREFIX} Anbau Vereinsheim: Umkleiden und Mehrzweckraum`,
    description: "Anbau mit zwei Umkleiden, Sanitär und einem Mehrzweckraum (ca. 180 m²). Planung 2025, Bau 2026, Außenanlagen 2027.",
    start_year: 2025, end_year: 2027, available_capital_cents: 3_500_000, monthly_operating_surplus_cents: 150_000, safety_threshold_cents: 1_000_000,
  } }).id);
  const items = [
    { title: "Planung, Statik und Baugenehmigung", estimated_cost_cents: 600_000, planned_date: "2025-10-31", phase: 1, order_index: 1 },
    { title: "Rohbau", estimated_cost_cents: 9_500_000, planned_date: "2026-06-30", phase: 2, order_index: 2 },
    { title: "Innenausbau und Haustechnik", estimated_cost_cents: 4_200_000, planned_date: "2026-11-30", phase: 2, order_index: 3 },
    { title: "Außenanlagen und Zuwegung", estimated_cost_cents: 800_000, planned_date: "2027-05-31", phase: 3, order_index: 4 },
  ];
  for (const [i, item] of items.entries()) await step(`invest_item_${i}`, () => fin("investment-item", "create", { investment_plan_id: inv, data: item }).id);
  await step("invest_fund_grant", () => fin("investment-funding", "create", { investment_plan_id: inv, data: { title: "Zuschuss Landessportbund Vereinssportstättenbau", source_type: "GRANT", amount_cents: 4_000_000, expected_date: "2026-03-31", conditions: "Förderquote bis 30 %, Antrag vor Baubeginn" } }).id);
  await step("invest_fund_donation", () => fin("investment-funding", "create", { investment_plan_id: inv, data: { title: "Bausteinaktion Mitglieder", source_type: "DONATION", amount_cents: 1_200_000, expected_date: "2026-12-31" } }).id);
  const loan = await step("invest_fund_loan", () => fin("investment-funding", "create", { investment_plan_id: inv, data: { title: "Darlehen Sparkasse", source_type: "LOAN", amount_cents: 6_000_000, expected_date: "2026-04-15" } }).id);
  await step("invest_loan_detail", () => fin("investment-funding", "loan_create", { investment_plan_id: inv, source_id: loan, data: { lender: "Sparkasse", interest_rate_pct: 3.1, loan_term_months: 240, repayment_type: "ANNUITY" } }).id);
  const scen = await step("invest_scenario", () => fin("investment-scenario", "create", { investment_plan_id: inv, data: { title: "Basisszenario mit Zuschuss und Darlehen", is_preferred: true } }).id);
  await step("invest_scenario_generate", () => { fin("investment-scenario", "auto_generate", { scenario_id: scen }); return true; });

  if (process.argv[2] === "invest") { console.log("Investitionsplan vollständig."); return; }

  // Prüfexporte je Geschäftsjahr
  const onlyYear = process.argv[2] === "export" ? Number(process.argv[3]) : null;
  for (const year of YEARS.filter((y) => onlyYear === null || y === onlyYear)) {
    const planId = state[`plan_${year}`];
    const exp = await step(`export_${year}`, () => fin("audit-export", "create", { plan_id: planId }).id);
    await step(`export_${year}_file`, () => {
      const out = join(HERE, `pruefexport-${year}.zip`);
      cli(["finance", "run", "audit-export", "download", "--input", JSON.stringify({ plan_id: planId, export_id: exp }), "--out", out]);
      return out;
    });
  }
  console.log(onlyYear === null ? "Simulation vollständig." : `Prüfexport ${onlyYear} vollständig.`);
}

async function simulateYear(year: number, accounts: { bank: string; cash: string }) {
  // Events of the year
  const events: Record<string, string> = {};
  for (const [key, make] of Object.entries(EVENTS)) {
    events[key] = await step(`event_${key}_${year}`, () => act("cai.event.03.create", { event: { department_id: DEFAULT_DEPARTMENT, visibility_scope: "private", organizer_type: "member", status: "confirmed", description: "Simulierte Veranstaltung für die Auswertung im Finanz-Hub.", ...make(year) } }).id);
  }

  // Plan: 2024 new, 2025 as takeover of the closed 2024 plan.
  let planId: string;
  if (year === YEARS[0]) {
    planId = await step(`plan_${year}`, () => fin("plan-period", "create", { data: { year, available_capital_cents: 0, notes: `${PREFIX} Haushaltsplan ${year}` } }).id);
    await step(`opening_bank_${year}`, () => fin("money-account", "opening", { plan_id: planId, account_id: accounts.bank, data: { opening_date: d(year, 1, 1), opening_balance_cents: 1_850_000, statement_balance_cents: 1_850_000, statement_date: d(year - 1, 12, 31), reason: "Anfangsbestand laut Kontoauszug 31.12." } }));
    await step(`opening_cash_${year}`, () => fin("money-account", "opening", { plan_id: planId, account_id: accounts.cash, data: { opening_date: d(year, 1, 1), opening_balance_cents: 45_000, reason: "Kassenbestand laut Kassensturz 31.12." } }));
  } else {
    const prev = state[`plan_${year - 1}`];
    const next = await step(`next_period_${year}`, () => fin("plan-lifecycle", "next_period", { plan_id: prev, data: { include_non_recurring: false } }));
    planId = await step(`plan_${year}`, () => {
      const found = (fin("plan-period", "list") as any[]).find((p) => p.year === year && !p.department_id);
      if (!found) throw new Error(`Folgeplan ${year} nicht gefunden: ${JSON.stringify(next).slice(0, 400)}`);
      return found.id;
    });
    await step(`plan_${year}_notes`, () => fin("plan-period", "update", { plan_id: planId, data: { notes: `${PREFIX} Haushaltsplan ${year}` } }).id);
  }

  // Positions: create (first year) or pick up the copies and adjust them.
  const positions: Record<string, string> = {};
  const wanted = year === YEARS[0] ? POSITIONS : [...POSITIONS, ANBAU_POS];
  const existing: any[] = year === YEARS[0] ? [] : fin("plan-period", "positions", { plan_id: planId });
  for (const [i, p] of wanted.entries()) {
    const factor = year === YEARS[0] ? 1 : 1.03;
    const body = {
      name: p.name, category: p.category, position_number: i + 1, tax_sphere: p.sphere, recurring: p.recurring ?? true,
      revenue_planned_cents: Math.round((p.rev ?? 0) * factor), expense_planned_cents: Math.round((p.exp ?? 0) * factor),
      ...(p.event ? { context_type: "EVENT", context_id: events[p.event] } : { context_type: "GENERAL" }),
      comment: p.event ? `Verknüpft mit Veranstaltung ${p.event} ${year}` : undefined,
    };
    const copy = existing.find((row) => row.name === p.name);
    positions[p.key] = await step(`pos_${p.key}_${year}`, () => copy
      ? (() => {
          // The copy keeps its sphere field only via its own route (PUT /tax-sphere).
          const { tax_sphere, ...changes } = body as any;
          cli(["finance", "position-update", copy.id, "--year", String(year), "--file", writeTmp(changes), "--json"]);
          fin("entry", "tax_sphere", { position_id: copy.id, data: { tax_sphere } });
          return copy.id;
        })()
      : fin("plan-period", "position_create", { plan_id: planId, data: body }).id);
  }

  // Resolution: budget adopted by the general assembly.
  await step(`resolution_${year}`, () => fin("result", "resolution_create", { plan_id: planId, data: { question: `Genehmigung des Haushaltsplans ${year}`, order: 1, decision: "Einstimmig angenommen (Mitgliederversammlung)", decided_at: d(year, 3, 15) } }).id);

  // The adopted budget becomes active — only an ACTIVE plan takes bookings.
  await step(`plan_${year}_active`, () => fin("plan-period", "update", { plan_id: planId, data: { status: "ACTIVE" } }).status);

  // Bookings
  let n = 0;
  for (const p of wanted) {
    const planned = p.rev ?? p.exp ?? 0;
    for (const [i, b] of SCHEDULE[p.key](year).entries()) {
      n += 1;
      const amount = vary(planned * (year === YEARS[0] ? 1 : 1.03) * b.share);
      const sheet = n;
      await step(`entry_${p.key}_${year}_${i}`, () => fin("entry", "entry_create", { position_id: positions[p.key], data: {
        description: b.text, booking_date: b.date, money_account_id: accounts[p.account],
        ...(p.rev ? { revenue_cents: amount } : { expense_cents: amount }),
        receipt_exemption_reason: `Simulation: Originalbeleg in der Papierablage Ordner ${year}, Blatt ${sheet}.`,
      } }).id);
    }
  }

  // Quarterly cash reports per money account: create → submit → approve.
  for (const [name, account] of Object.entries(accounts)) {
    for (let q = 1; q <= 4; q += 1) {
      const start = d(year, 3 * q - 2, 1);
      const end = d(year, 3 * q, [31, 30, 30, 31][q - 1]);
      const report = await step(`report_${name}_${year}_q${q}`, () => fin("cash-report", "create", { data: { period_start: start, period_end: end, money_account_id: account, notes: `${PREFIX} Kassenbericht Q${q}/${year}` } }).id);
      await step(`report_${name}_${year}_q${q}_submit`, () => { fin("cash-report", "submit", { report_id: report }); return true; });
      // Approval by the second person — after the entries of the period (see below).
    }
  }

  // Four-eyes: approvals are a human's job (second person in the browser).
  // The script never approves; it only checks. A report is approvable only
  // once every entry of its period is approved, so all reports APPROVED
  // proves the entries as well.
  const reportIds = Object.keys(accounts).flatMap((name) => [1, 2, 3, 4].map((q) => state[`report_${name}_${year}_q${q}`]));
  const offen = reportIds.filter((id) => {
    const r = fin("cash-report", "show", { report_id: id }) as any;
    return (r.report_status ?? r.status) !== "APPROVED";
  });
  if (offen.length > 0) {
    throw new Error(`Freigaben ${year} fehlen: ${offen.length} von ${reportIds.length} Berichten — im Browser als zweite Person freigeben`);
  }

  // Close the year.
  await step(`close_${year}`, () => { fin("plan-lifecycle", "close", { plan_id: planId, note: `Jahresabschluss ${year} nach Kassenprüfung` }); return true; });
}

// ── 2026: the running year ──────────────────────────────────────────────
// Today is the last possible booking day; later bookings are planned only.
const HEUTE_2026 = new Date().toISOString().slice(0, 10);
// The construction of the extension (investment plan, phase 2) and its funding.
const BAU_POSITIONS: Pos[] = [
  { key: "anbau_rohbau", name: "Anbau Vereinsheim: Rohbau", category: "Investitionen", sphere: "IDEELL", exp: 9_500_000, recurring: false, account: "bank" },
  { key: "anbau_zuschuss", name: "Zuschuss Landessportbund Sportstättenbau", category: "Investitionen", sphere: "IDEELL", rev: 4_000_000, recurring: false, account: "bank" },
  { key: "anbau_bausteine", name: "Bausteinaktion Anbau (Spenden)", category: "Investitionen", sphere: "IDEELL", rev: 1_200_000, recurring: false, account: "bank" },
];
const BAU_SCHEDULE: Record<string, (y: number) => { date: string; share: number; text: string }[]> = {
  anbau_rohbau: (y) => [
    { date: d(y, 4, 30), share: 0.3, text: "Rohbau Anbau: Abschlag 1 (Erdarbeiten, Bodenplatte)" },
    { date: d(y, 6, 30), share: 0.35, text: "Rohbau Anbau: Abschlag 2 (Mauerwerk)" },
    { date: d(y, 9, 15), share: 0.2, text: "Rohbau Anbau: Abschlag 3 (Dachstuhl)" },
    { date: d(y, 11, 30), share: 0.15, text: "Rohbau Anbau: Schlussrechnung" },
  ],
  anbau_zuschuss: (y) => [{ date: d(y, 3, 31), share: 0.6, text: "Zuschuss LSB Sportstättenbau: 1. Rate" }, { date: d(y, 12, 15), share: 0.4, text: "Zuschuss LSB Sportstättenbau: Schlussrate" }],
  anbau_bausteine: (y) => [3, 5, 7, 9, 11].map((m, i) => ({ date: d(y, m, 25), share: 0.2, text: `Bausteinaktion Anbau: Sammelspende ${i + 1}` })),
};

async function simulate2026(accounts: { bank: string; cash: string }) {
  const year = 2026;
  const events: Record<string, string> = {};
  for (const [key, make] of Object.entries(EVENTS)) {
    events[key] = await step(`event_${key}_${year}`, () => act("cai.event.03.create", { event: { department_id: DEFAULT_DEPARTMENT, visibility_scope: "private", organizer_type: "member", status: "confirmed", description: "Simulierte Veranstaltung für die Auswertung im Finanz-Hub.", ...make(year) } }).id);
  }

  // The 2026 plan is the take-over of the closed 2025 plan: plan values,
  // previous-year actuals, carry-over and opening balances come from there.
  const next = await step(`next_period_${year}`, () => fin("plan-lifecycle", "next_period", { plan_id: state.plan_2025, data: { include_non_recurring: false } }));
  const planId: string = await step(`plan_${year}`, () => {
    const found = (fin("plan-period", "list") as any[]).find((p) => p.year === year && !p.department_id);
    if (!found) throw new Error(`Folgeplan ${year} nicht gefunden: ${JSON.stringify(next).slice(0, 400)}`);
    return found.id;
  });
  await step(`plan_${year}_notes`, () => fin("plan-period", "update", { plan_id: planId, data: { notes: `${PREFIX} Haushaltsplan ${year}` } }).id);

  const positions: Record<string, string> = {};
  const wanted = [...POSITIONS, ...BAU_POSITIONS];
  const existing: any[] = fin("plan-period", "positions", { plan_id: planId });
  const factor = 1.05;
  for (const [i, p] of wanted.entries()) {
    const body = {
      name: p.name, category: p.category, position_number: i + 1, tax_sphere: p.sphere, recurring: p.recurring ?? true,
      revenue_planned_cents: Math.round((p.rev ?? 0) * factor), expense_planned_cents: Math.round((p.exp ?? 0) * factor),
      ...(p.event ? { context_type: "EVENT", context_id: events[p.event] } : { context_type: "GENERAL" }),
      comment: p.event ? `Verknüpft mit Veranstaltung ${p.event} ${year}` : p.key.startsWith("anbau_") ? "Aus dem Investitionsplan Anbau Vereinsheim, Phase 2" : undefined,
    };
    const copy = existing.find((row) => row.name === p.name);
    positions[p.key] = await step(`pos_${p.key}_${year}`, () => copy
      ? (() => {
          const { tax_sphere, ...changes } = body as any;
          cli(["finance", "position-update", copy.id, "--year", String(year), "--file", writeTmp(changes), "--json"]);
          fin("entry", "tax_sphere", { position_id: copy.id, data: { tax_sphere } });
          return copy.id;
        })()
      : fin("plan-period", "position_create", { plan_id: planId, data: body }).id);
  }

  await step(`resolution_${year}`, () => fin("result", "resolution_create", { plan_id: planId, data: { question: `Genehmigung des Haushaltsplans ${year}`, order: 1, decision: "Einstimmig angenommen (Mitgliederversammlung)", decided_at: d(year, 3, 14) } }).id);
  await step(`resolution_${year}_bau`, () => fin("result", "resolution_create", { plan_id: planId, data: { question: "Freigabe Baubeginn Anbau Vereinsheim nach Zuschusszusage", order: 2, decision: "Angenommen mit 41 Ja, 3 Nein, 2 Enthaltungen (außerordentliche Mitgliederversammlung)", decided_at: d(year, 4, 11) } }).id);
  await step(`plan_${year}_active`, () => fin("plan-period", "update", { plan_id: planId, data: { status: "ACTIVE" } }).status);

  // Bookings up to today; everything later stays plan.
  const schedule = { ...SCHEDULE, ...BAU_SCHEDULE };
  let n = 0;
  for (const p of wanted) {
    const planned = (p.rev ?? p.exp ?? 0) * factor;
    for (const [i, b] of schedule[p.key](year).entries()) {
      n += 1;
      if (b.date > HEUTE_2026) continue;
      const amount = vary(planned * b.share);
      const sheet = n;
      await step(`entry_${p.key}_${year}_${i}`, () => fin("entry", "entry_create", { position_id: positions[p.key], data: {
        description: b.text, booking_date: b.date, money_account_id: accounts[p.account],
        ...(p.rev ? { revenue_cents: amount } : { expense_cents: amount }),
        receipt_exemption_reason: `Simulation: Originalbeleg in der Papierablage Ordner ${year}, Blatt ${sheet}.`,
      } }).id);
    }
  }

  // Cash reports of the finished quarters: create and submit. The approval
  // is the second person's (four-eyes) — the script never approves.
  for (const [name, account] of Object.entries(accounts)) {
    for (let q = 1; q <= 4; q += 1) {
      const end = d(year, 3 * q, [31, 30, 30, 31][q - 1]);
      if (end >= HEUTE_2026) continue;
      const start = d(year, 3 * q - 2, 1);
      const report = await step(`report_${name}_${year}_q${q}`, () => fin("cash-report", "create", { data: { period_start: start, period_end: end, money_account_id: account, notes: `${PREFIX} Kassenbericht Q${q}/${year}` } }).id);
      await step(`report_${name}_${year}_q${q}_submit`, () => { fin("cash-report", "submit", { report_id: report }); return true; });
    }
  }
  console.log(`Vereinsplan ${year} gebucht bis ${HEUTE_2026}.`);
}

// ── Department budgets (budgetplanung 01–03, 06) ─────────────────────────
type AbtPos = { key: string; name: string; category: string; rev?: number; exp?: number; recurring?: boolean; comment?: string;
  schedule: (y: number) => { date: string; share: number; text: string }[] };
type AbtPlan = {
  key: string; departmentId: string; label: string; periodType: "CALENDAR_YEAR" | "CUSTOM"; year?: number;
  periodStart?: string; periodEnd?: string; capital: number; opening: number; openingDate: string;
  positions: AbtPos[];
  openItems: { kind: "RECEIVABLE" | "OBLIGATION"; label: string; amount: number; due?: string; note?: string }[];
  resolutions: { question: string; decision?: string; decided_at?: string }[];
};
const monatlich = (y: number, von: number, bis: number, tag: number, text: string) =>
  Array.from({ length: bis - von + 1 }, (_, i) => ({ date: d(y, von + i, tag), share: 1 / 12, text: `${text} ${String(von + i).padStart(2, "0")}/${y}` }));
const quartal = (y: number, text: string) => [1, 4, 7, 10].map((m, i) => ({ date: d(y, m, 10), share: 0.25, text: `${text} Q${i + 1}/${y}` }));

const ABT = {
  webApp: "a7ee6dea-2718-40e5-82a7-6463307beb15",
  mobileApp: "8151f9d8-b238-4256-919a-9ec179e7d9d8",
  architektur: "c9df185b-476c-4073-95c4-7b10dada842a",
};

const WEB_APP_2026: AbtPlan = {
  key: "webapp_2026", departmentId: ABT.webApp, label: "Web-App 2026", periodType: "CALENDAR_YEAR", year: 2026,
  capital: 500_000, opening: 500_000, openingDate: "2026-01-01",
  positions: [
    { key: "hosting", name: "Hosting und Server", category: "Infrastruktur", exp: 360_000, comment: "Railway, zwei Umgebungen", schedule: (y) => monatlich(y, 1, 12, 3, "Hosting") },
    { key: "domains", name: "Domains und Zertifikate", category: "Infrastruktur", exp: 12_000, schedule: (y) => [{ date: d(y, 2, 1), share: 1, text: `Domainverlängerung ${y}` }] },
    { key: "monitoring", name: "Monitoring und Backups", category: "Infrastruktur", exp: 48_000, schedule: (y) => quartal(y, "Monitoring und Backups") },
    { key: "lizenzen", name: "Entwicklerwerkzeuge und Lizenzen", category: "Lizenzen", exp: 180_000, schedule: (y) => quartal(y, "Lizenzen") },
    { key: "entwicklung", name: "Freie Entwickler: Terminverwaltung", category: "Entwicklung", exp: 400_000, recurring: false,
      comment: "Einmalprojekt, Abnahme im Oktober", schedule: (y) => [{ date: d(y, 3, 31), share: 0.4, text: "Terminverwaltung: Abschlag 1" }, { date: d(y, 7, 15), share: 0.4, text: "Terminverwaltung: Abschlag 2" }, { date: d(y, 10, 30), share: 0.2, text: "Terminverwaltung: Schlussrate" }] },
    { key: "zuschuss", name: "Zuschuss Digitalisierung (Landesprogramm)", category: "Einnahmen", rev: 250_000, recurring: false,
      schedule: (y) => [{ date: d(y, 5, 20), share: 0.6, text: "Zuschuss Digitalisierung: 1. Rate" }, { date: d(y, 11, 30), share: 0.4, text: "Zuschuss Digitalisierung: 2. Rate" }] },
    { key: "spenden", name: "Spenden für die Vereins-App", category: "Einnahmen", rev: 60_000, schedule: (y) => [3, 6, 9, 12].map((m, i) => ({ date: d(y, m, 20), share: 0.25, text: `Spenden Vereins-App ${i + 1}/${y}` })) },
  ],
  openItems: [
    { kind: "RECEIVABLE", label: "Zuschuss Digitalisierung, 2. Rate", amount: 100_000, due: "2026-11-30", note: "Bescheid vom 12.05.2026" },
    { kind: "OBLIGATION", label: "Terminverwaltung, Schlussrate", amount: 80_000, due: "2026-10-30", note: "fällig nach Abnahme" },
  ],
  resolutions: [
    { question: "Hosting in eine Region innerhalb der EU umziehen?", decision: "Ja, bis Jahresende (Vorstandssitzung)", decided_at: "2026-02-12" },
    { question: "Budget für die Vereins-App 2027 erhöhen?" },
  ],
};

const MOBILE_APP: AbtPlan = {
  key: "mobile_2627", departmentId: ABT.mobileApp, label: "App-Jahr 26/27", periodType: "CUSTOM",
  periodStart: "2026-04-01", periodEnd: "2027-03-31", capital: 200_000, opening: 200_000, openingDate: "2026-04-01",
  positions: [
    { key: "apple", name: "Apple Developer Program", category: "Store-Gebühren", exp: 9_900, schedule: () => [{ date: "2026-04-02", share: 1, text: "Apple Developer Program 2026/27" }] },
    { key: "google", name: "Google Play Konsole", category: "Store-Gebühren", exp: 2_500, recurring: false, schedule: () => [{ date: "2026-04-03", share: 1, text: "Google Play Registrierung" }] },
    { key: "geraete", name: "Testgeräte", category: "Ausstattung", exp: 120_000, recurring: false, comment: "zwei Android-, ein iOS-Gerät", schedule: () => [{ date: "2026-05-12", share: 1, text: "Testgeräte (3 Stück)" }] },
    { key: "push", name: "Push-Dienst und Analyse", category: "Betrieb", exp: 36_000, schedule: () => monatlich(2026, 4, 12, 5, "Push-Dienst") },
    { key: "inapp", name: "In-App-Spenden", category: "Einnahmen", rev: 90_000, schedule: () => monatlich(2026, 4, 12, 25, "In-App-Spenden") },
  ],
  openItems: [{ kind: "OBLIGATION", label: "Store-Freigabe iOS: externe Prüfung", amount: 15_000, due: "2026-10-15" }],
  resolutions: [{ question: "Eigene App für Mitglieder oder Web-App als Progressive Web App?", decision: "Beides: PWA sofort, native App ab Sommer", decided_at: "2026-03-20" }],
};

const ARCHITEKTUR_2025: AbtPlan = {
  key: "arch_2025", departmentId: ABT.architektur, label: "Architektur 2025", periodType: "CALENDAR_YEAR", year: 2025,
  capital: 150_000, opening: 150_000, openingDate: "2025-01-01",
  positions: [
    { key: "beratung", name: "Architekturberatung (extern)", category: "Beratung", exp: 300_000, schedule: (y) => quartal(y, "Architekturberatung") },
    { key: "schulung", name: "Schulungen und Fachliteratur", category: "Weiterbildung", exp: 60_000, schedule: (y) => [{ date: d(y, 3, 14), share: 0.5, text: `Schulung Cloud-Architektur ${y}` }, { date: d(y, 9, 18), share: 0.5, text: `Fachliteratur ${y}` }] },
    { key: "zuschuss", name: "Zuschuss Weiterbildung", category: "Einnahmen", rev: 80_000, schedule: (y) => [{ date: d(y, 6, 30), share: 1, text: `Zuschuss Weiterbildung ${y}` }] },
  ],
  openItems: [
    { kind: "RECEIVABLE", label: "Zuschuss Weiterbildung, Restbetrag", amount: 20_000, due: "2026-02-28" },
    { kind: "OBLIGATION", label: "Architekturberatung Dezember", amount: 25_000, due: "2026-01-15", note: "Rechnung kam im Januar" },
  ],
  resolutions: [{ question: "Beratungsbudget 2026 halten?", decision: "Ja, mit Schwerpunkt Sicherheit", decided_at: "2025-11-20" }],
};

const KONTO_NAME: Record<string, string> = { [ABT.webApp]: "Web-App", [ABT.mobileApp]: "Mobile-App", [ABT.architektur]: "Architektur" };

async function abteilungsPlan(p: AbtPlan): Promise<string | null> {
  const k = (s: string) => `abt_${p.key}_${s}`;
  const konto = await step(`abt_konto_${p.departmentId}`, () => fin("money-account", "create", { data: {
    name: `${PREFIX} Unterkonto ${KONTO_NAME[p.departmentId]}`,
    kind: "BANK", department_id: p.departmentId } }).id);
  const planId: string = await step(k("plan"), () => fin("plan-period", "create", { data: {
    department_id: p.departmentId, period_type: p.periodType, label: p.label, available_capital_cents: p.capital,
    notes: `${PREFIX} Bereichsplan ${p.label}`,
    ...(p.periodType === "CUSTOM" ? { period_start: p.periodStart, period_end: p.periodEnd } : { year: p.year }),
  } }).id);
  await step(k("opening"), () => fin("money-account", "opening", { plan_id: planId, account_id: konto, data: {
    opening_date: p.openingDate, opening_balance_cents: p.opening, reason: "Anfangsbestand des Unterkontos" } }));
  const pos: Record<string, string> = {};
  for (const [i, x] of p.positions.entries()) {
    pos[x.key] = await step(k(`pos_${x.key}`), () => fin("plan-period", "position_create", { plan_id: planId, data: {
      name: x.name, category: x.category, position_number: i + 1, recurring: x.recurring ?? true, context_type: "GENERAL",
      revenue_planned_cents: x.rev ?? 0, expense_planned_cents: x.exp ?? 0, ...(x.comment ? { comment: x.comment } : {}),
    } }).id);
  }
  for (const [i, o] of p.openItems.entries()) {
    await step(k(`posten_${i}`), () => fin("result", "open_item_create", { plan_id: planId, data: {
      kind: o.kind, label: o.label, amount_cents: o.amount, ...(o.due ? { due_date: o.due } : {}), ...(o.note ? { note: o.note } : {}) } }).id);
  }
  for (const [i, r] of p.resolutions.entries()) {
    await step(k(`frage_${i}`), () => fin("result", "resolution_create", { plan_id: planId, data: {
      question: r.question, order: i + 1, ...(r.decision ? { decision: r.decision, decided_at: r.decided_at } : {}) } }).id);
  }
  await step(k("aktiv"), () => fin("plan-period", "update", { plan_id: planId, data: { status: "ACTIVE" } }).status);
  let n = 0;
  for (const x of p.positions) {
    const planned = x.rev ?? x.exp ?? 0;
    for (const [i, b] of x.schedule(p.year ?? 2026).entries()) {
      n += 1;
      if (b.date > HEUTE_2026) continue;
      const amount = vary(planned * b.share, 0.06);
      const sheet = n;
      await step(k(`buchung_${x.key}_${i}`), () => fin("entry", "entry_create", { position_id: pos[x.key], data: {
        description: b.text, booking_date: b.date, money_account_id: konto,
        ...(x.rev ? { revenue_cents: amount } : { expense_cents: amount }),
        receipt_exemption_reason: `Simulation: Beleg in der Ablage der Abteilung, Blatt ${sheet}.`,
      } }).id);
    }
  }
  return planId;
}

async function simulateAbteilungen() {
  for (const p of [WEB_APP_2026, MOBILE_APP, ARCHITEKTUR_2025]) {
    await abteilungsPlan(p);
    console.log(`Bereichsplan ${p.label} gebucht.`);
  }

  // Architektur: close 2025 and carry over into 2026 — only after the second
  // person approved the entries (four-eyes); the script never approves.
  const arch = state.abt_arch_2025_plan;
  if (!("abt_arch_2025_close" in state)) {
    try {
      fin("plan-lifecycle", "close", { plan_id: arch, note: "Abschluss Architektur 2025 nach Sitzung" });
      state.abt_arch_2025_close = true;
      save();
      console.log("✓ abt_arch_2025_close");
    } catch (error) {
      console.log(`… Architektur 2025 noch nicht abschließbar: ${(error as Error).message.slice(0, 300)}`);
      console.log("   Buchungen der Abteilung Architektur 2025 im Browser als zweite Person freigeben, dann erneut starten.");
      return;
    }
  }
  const next = await step("abt_arch_2026_next", () => fin("plan-lifecycle", "next_period", { plan_id: arch, data: {} }));
  const arch2026: string = await step("abt_arch_2026_plan", () => (next as any).plan?.id ?? (next as any).result?.plan?.id);
  await step("abt_arch_2026_label", () => fin("plan-period", "update", { plan_id: arch2026, data: { label: "Architektur 2026", notes: `${PREFIX} Bereichsplan Architektur 2026` } }).id);
  await step("abt_arch_2026_frage", () => fin("result", "resolution_create", { plan_id: arch2026, data: {
    question: "Schwerpunkt 2026: Sicherheitsprüfung der Plattform beauftragen?", order: 1, decision: "Ja, Angebot bis März einholen", decided_at: "2026-01-22" } }).id);
  await step("abt_arch_2026_aktiv", () => fin("plan-period", "update", { plan_id: arch2026, data: { status: "ACTIVE" } }).status);
  const kopien: any[] = fin("plan-period", "positions", { plan_id: arch2026 });
  const konto = state[`abt_konto_${ABT.architektur}`];
  let n = 100;
  for (const x of ARCHITEKTUR_2025.positions) {
    const kopie = kopien.find((r) => r.name === x.name);
    if (!kopie) continue;
    for (const [i, b] of x.schedule(2026).entries()) {
      n += 1;
      if (b.date > HEUTE_2026) continue;
      const amount = vary((x.rev ?? x.exp ?? 0) * 1.04 * b.share, 0.06);
      const sheet = n;
      await step(`abt_arch_2026_buchung_${x.key}_${i}`, () => fin("entry", "entry_create", { position_id: kopie.id, data: {
        description: b.text, booking_date: b.date, money_account_id: konto,
        ...(x.rev ? { revenue_cents: amount } : { expense_cents: amount }),
        receipt_exemption_reason: `Simulation: Beleg in der Ablage der Abteilung, Blatt ${sheet}.`,
      } }).id);
    }
  }
  console.log("Bereichsplan Architektur 2026 aus dem Übertrag gebucht.");
}

// ── Saison und Haushaltsjahr (budget-saison-01..03) ─────────────────────
// The club plans in calendar years, the departments in seasons from 1 July to
// 30 April. The season is a budget view over the plans (D30): season frames per
// node, positions with their months, the follow-up plan as a draft (D35), and
// the proposal of the 2027 frame from the season frames (D31).
const SAISON = "2026-07-01";
const eur = (cents: number | null | undefined) => (cents == null ? "—" : `${(cents / 100).toFixed(2)} €`);
const rund = (cents: number) => Math.max(100_00, Math.round(cents / 100_00) * 100_00);

function saisonBericht(titel: string) {
  const tree = fin("season", "season_tree", { season_start: SAISON });
  console.log(`\n${titel}: Saison ${tree.label} (${tree.season_start} – ${tree.season_end})`);
  for (const p of tree.plans) console.log(`  Haushalt ${p.label}${p.department_id ? " (Bereich)" : ""}: ${p.overlap_months} Monate`);
  for (const u of tree.uncovered) console.log(`  ohne Haushalt: ${u.from} – ${u.until}`);
  for (const n of tree.nodes.filter((x: any) => x.depth <= 1)) {
    console.log(`  ${n.name.padEnd(28)} Saisonrahmen ${eur(n.frame_cents).padStart(12)}  verplant ${eur(n.planned_cents).padStart(12)}  frei ${eur(n.free_cents).padStart(12)}  Ist ${eur(n.actual_cents).padStart(12)}  außerhalb ${eur(n.outside_planned_cents)}`);
  }
  return tree;
}

async function simulateSaison() {
  // 1. Season start and end — only the season fields; the calendar year stays (D37).
  await step("saison_einstellung", () => fin("settings", "update", { data: {
    season_start_month: 7, season_start_day: 1, season_end_month: 4, season_end_day: 30 } }));
  const saisons: any[] = fin("season", "seasons");
  console.log(`Saisons: ${saisons.map((x) => x.label).join(", ")}`);
  const vorher = saisonBericht("Vor den Saisonrahmen");

  // 2. Season frames: the club and the departments, from what the season plans (+10 %).
  const knoten = (kind: string, id: string | null) => vorher.nodes.find((n: any) => n.node_kind === kind && n.node_id === id);
  const club = knoten("CLUB", null);
  await step("saison_rahmen_verein", () => fin("season", "season_frame_set", { season_start: SAISON, node_kind: "CLUB", node_id: "club",
    data: { amount_cents: rund(club.planned_cents * 1.1), reason: "Vorstandsbeschluss Saison 2026/27", decided_at: "2026-06-20" } }).amount_cents);
  for (const [name, id] of Object.entries(ABT)) {
    const n = knoten("DEPARTMENT", id);
    if (!n) continue;
    await step(`saison_rahmen_${name}`, () => fin("season", "season_frame_set", { season_start: SAISON, node_kind: "DEPARTMENT", node_id: id,
      data: { amount_cents: rund(Math.max(n.planned_cents, 5_000_00) * 1.1), reason: `Saisonrahmen ${KONTO_NAME[id]} 2026/27`, decided_at: "2026-06-20" } }).amount_cents);
  }

  // 3. A position with its months in the running club plan: the winter hall, October to December.
  const plan2026 = state.plan_2026;
  await step("saison_pos_halle_2026", () => fin("plan-period", "position_create", { plan_id: plan2026, data: {
    name: "Hallenmiete Wintersaison (Okt–Dez)", category: "Sportbetrieb", context_type: "GENERAL", recurring: false,
    expense_planned_cents: 360_000, planned_from: "2026-10-01", planned_until: "2026-12-31",
    comment: `${PREFIX} Saisonposten mit Zeitraum` } }).id);

  // 4. January to April 2027 have no plan yet: the follow-up plan as a draft (D35).
  const folge = await step("saison_folgehaushalt_2027", () => {
    const r = fin("plan-lifecycle", "next_period", { plan_id: plan2026, data: {} });
    return { id: r.plan?.id ?? r.result?.plan?.id, start: r.plan?.period_start, end: r.plan?.period_end, copied: r.positions_copied };
  });
  console.log(`Folgehaushalt: ${folge.start} – ${folge.end}, ${folge.copied} Posten übernommen`);
  await step("saison_folgehaushalt_notiz", () => fin("plan-period", "update", { plan_id: folge.id, data: {
    notes: `${PREFIX} Haushaltsplan 2027 (Entwurf aus der Saisonsicht)` } }).id);
  await step("saison_pos_halle_2027", () => fin("plan-period", "position_create", { plan_id: folge.id, data: {
    name: "Hallenmiete Wintersaison (Jan–Apr)", category: "Sportbetrieb", context_type: "GENERAL", recurring: false,
    expense_planned_cents: 480_000, planned_from: "2027-01-01", planned_until: "2027-04-30",
    comment: `${PREFIX} Saisonposten mit Zeitraum` } }).id);

  // 5. The season again: no gap, both plans with their months, the winter hall in the season.
  const nachher = saisonBericht("Nach Folgehaushalt und Saisonposten");
  if (nachher.uncovered.length) throw new Error(`Saison hat noch Lücken: ${JSON.stringify(nachher.uncovered)}`);

  // 6. The proposal of the 2027 club frame from the season frames (D31) — read only.
  const vorschlag = fin("season", "frame_proposal", { plan_id: folge.id, node_kind: "CLUB", node_id: "club" });
  console.log(`\nVorschlag Vereinsrahmen 2027 aus den Saisons: ${eur(vorschlag.proposal_cents)} (Rahmen bisher ${eur(vorschlag.frame_cents)})`);
  for (const t of vorschlag.parts) console.log(`  ${t.label}: ${eur(t.season_frame_cents)} · ${t.months_in_plan} von ${t.season_months} Monaten → Anteil ${eur(t.share_cents)}`);

  // 7. The board raises the club's season frame after the winter season came in —
  //    a second version with reason; the history keeps both (SeasonFrameVersion).
  const vereinNachher = nachher.nodes.find((n: any) => n.node_kind === "CLUB");
  await step("saison_rahmen_verein_v2", () => fin("season", "season_frame_set", { season_start: SAISON, node_kind: "CLUB", node_id: "club",
    data: { amount_cents: rund(vereinNachher.planned_cents * 1.05), reason: "Nachbeschluss: Wintersaison 2027 und Hallenmiete aufgenommen", decided_at: "2026-09-24" } }).amount_cents);
  const verlauf: any[] = fin("season", "season_frame_versions", { season_start: SAISON, node_kind: "CLUB", node_id: "club" });
  console.log(`\nVerlauf Saisonrahmen Verein: ${verlauf.map((v) => `v${v.version_no} ${eur(v.amount_cents)} (${v.delta_cents >= 0 ? "+" : ""}${eur(v.delta_cents)}, ${v.reason ?? "—"})`).join(" · ")}`);
  const ende = saisonBericht("Nach dem Nachbeschluss");

  writeFileSync(join(HERE, "saison-bericht.json"), JSON.stringify({ saisons, vorher, nachher, folge, vorschlag, verlauf, ende }, null, 2));
  console.log("\nSaison 2026/27 durchgerechnet; Bericht in saison-bericht.json.");
}

// ── buchhaltung-13: Beanstandung beantworten und offene Punkte lesen (04 AK-1) ──
async function simulateKorrektur() {
  const plan = state.plan_2026;
  if (!plan) throw new Error("plan_2026 fehlt — erst `bun run finance-sim.ts 2026`");
  const bericht: Record<string, unknown> = { plan_id: plan };
  const kandidaten = fin("plan-period", "journal", { plan_id: plan, order: "desc", limit: 50 }).rows ?? [];
  let entryId: string | null = state.korrektur_entry ?? null;
  if (!entryId) {
    for (const row of kandidaten) {
      if (row.source_type !== "MANUAL") continue;
      const detail = fin("detail", "entry", { entry_id: row.entry_id });
      if (detail.allowed_actions?.correct && detail.allowed_actions?.object) { entryId = row.entry_id; break; }
    }
    if (!entryId) throw new Error("Keine korrigierbare Buchung im Plan 2026");
    state.korrektur_entry = entryId; save();
  }
  bericht.entry_id = entryId;
  await step("korrektur_beanstandet", () => fin("entry", "objection_create", { entry_id: entryId, data: { reason: `${PREFIX} Rechnungsbetrag bitte gegen den Beleg prüfen` } }).id);
  const offen = fin("detail", "open_items", {});
  bericht.offen_vorher = offen.counts;
  // Without a reason the service refuses (correction_reason_required, D-13-02).
  let ohneGrund = "angenommen";
  try { act("cai.finance.18.entry_update", { entry_id: entryId, changes: { notes: "Beleg geprüft" } }); } catch (e) { ohneGrund = String(e).includes("correction_reason_required") ? "abgelehnt: correction_reason_required" : String(e).slice(0, 200); }
  bericht.korrektur_ohne_grund = ohneGrund;
  await step("korrektur_mit_grund", () => { act("cai.finance.18.entry_update", { entry_id: entryId, changes: { notes: "Beleg geprüft: Betrag stimmt mit der Rechnung überein", reason: "Beleg nachgesehen, Betrag bestätigt" } }); return true; });
  const detail = fin("detail", "entry", { entry_id: entryId });
  bericht.zeitleiste = (detail.timeline ?? []).map((e: any) => [e.kind, e.action ?? e.resolution ?? null, e.reason ?? null]);
  bericht.kostenverlauf = detail.cost_trend;
  bericht.offen_nachher = fin("detail", "open_items", {}).counts;
  bericht.journal_verein = (fin("plan-period", "journal", { plan_id: plan, node_kind: "CLUB", node_id: "club", order: "desc", limit: 5 }).rows ?? []).map((r: any) => r.journal_number);
  writeFileSync(join(HERE, "korrektur-bericht.json"), JSON.stringify(bericht, null, 2));
  console.log(JSON.stringify(bericht, null, 2));
}

// ── Bereich als Sicht (bereich-als-sicht-05) ────────────────────────────
// `bun run scripts/finance-sim.ts bereich-als-sicht`: the department plans of
// the simulation are closed (D42) and the year is played again in the club
// plan — periods of the departments, grants on the club account, positions in
// the window of the Mobile-App (parts in 2026 and 2027), planned and unplanned
// entries. The report lies in the repository (05 §4.3). Four-eyes approvals
// are never given here; the report names what waits for the second person.
// „Webpage“ stands for the „Jugend“ of the contract: the Comvenio club has no
// youth — Webpage is the department without an own account that books on the
// club account only after its grant (TC-04).
const WEBPAGE = "4a57fad3-0b66-48c7-a2d2-ef70a31da9b2";
const APP_JAHR = "2026-04-01";
const D42 = "Umstellung Bereich als Sicht (D42)";
const BERICHTE = join(import.meta.dir, "finance-sim", "berichte");

/** The service's code in a refusal the CLI passed on. */
const dienstCode = (error: unknown): string => /abgelehnt: ([a-z]+(?:_[a-z]+)+):/.exec(String((error as Error)?.message ?? error))?.[1] ?? "";

const beleg = (n: number) => `Simulation Bereich als Sicht: Beleg in der Ablage, Blatt ${n}.`;

async function simulateBereichAlsSicht() {
  const heute = HEUTE_2026;
  const bericht: Record<string, any> = {
    lauf: "bereich-als-sicht", verein: "0ec34e70-999a-47c4-a1b1-bdb293110fa5", beginn: new Date().toISOString(), heute,
    abweichung_vom_vertrag: "Die „Jugend“ aus 05 DC-5 gibt es im Comvenio-Verein nicht; ihre Rolle übernimmt „Webpage“ (Abteilung ohne eigenes Konto, Vereinssaison, bucht auf dem Vereinskonto erst nach der Freigabe).",
    schritte: [] as Record<string, unknown>[],
  };
  const notiere = (schritt: string, daten: Record<string, unknown> = {}) => {
    bericht.schritte.push({ schritt, ...daten });
    console.log(`· ${schritt}`);
  };
  const datei = join(BERICHTE, `bereich-als-sicht-${heute}.json`);
  try {
    const plan2026: string = state.plan_2026;
    const bank: string = state.account_bank;
    const archKonto: string = state[`abt_konto_${ABT.architektur}`];
    let plaene: any[] = fin("plan-period", "list");
    const plan2027: string | null = plaene.find((p) => !p.department_id && p.period_start === "2027-01-01")?.id ?? null;
    notiere("ausgangslage", {
      haushalt_2026: plan2026, haushalt_2027: plan2027,
      bereichsplaene: plaene.filter((p) => p.department_id).map((p) => ({ id: p.id, label: p.label, status: p.status })),
    });

    // 4.1 — close the department plans (D42): nothing is deleted or moved.
    for (const p of plaene.filter((x) => x.department_id)) {
      if (p.status !== "CLOSED") await step(`bas_close_${p.id}`, () => { fin("plan-lifecycle", "close", { plan_id: p.id, force: true, note: D42 }); return true; });
      const ergebnis = fin("result", "result", { plan_id: p.id });
      const offen: any[] = fin("result", "open_items", { plan_id: p.id });
      notiere(`bereichsplan_geschlossen_${p.label}`, {
        plan_id: p.id, ergebnis_cents: ergebnis?.result_cents ?? ergebnis?.result?.result_cents ?? null,
        offene_punkte: (Array.isArray(offen) ? offen : offen?.items ?? []).map((o: any) => ({ art: o.kind, text: o.label, betrag_cents: o.amount_cents, status: o.status })),
      });
    }
    plaene = fin("plan-period", "list");
    notiere("tc01_keine_aktiven_bereichsplaene", {
      aktiv: plaene.filter((p) => p.department_id && p.status !== "CLOSED").map((p) => p.label),
      geschlossen_lesbar: plaene.filter((p) => p.department_id).map((p) => ({ label: p.label, posten: (fin("plan-period", "positions", { plan_id: p.id }) as any[]).length })),
    });

    // Periods (05 DC-5): Web-App the fiscal year, Mobile-App 1.4.–31.3., „Jugend“ (Webpage) the club season.
    await step("bas_zeitraum_mobile", () => fin("period", "set", { node_kind: "DEPARTMENT", node_id: ABT.mobileApp, data: { period_kind: "CUSTOM", start_month: 4, start_day: 1, end_month: 3, end_day: 31 } }).label);
    await step("bas_zeitraum_webpage", () => fin("period", "set", { node_kind: "DEPARTMENT", node_id: WEBPAGE, data: { period_kind: "CLUB_SEASON" } }).label);
    notiere("zeitraeume", Object.fromEntries([["Web-App", ABT.webApp], ["Mobile-App", ABT.mobileApp], ["Webpage", WEBPAGE]].map(([name, id]) => {
      const z = fin("period", "show", { node_kind: "DEPARTMENT", node_id: id });
      return [name, { art: z.period_kind, label: z.label, herkunft: z.source, laufend: z.start ? `${z.start} – ${z.end}` : null }];
    })));

    // TC-04: the youth (Webpage) books on the club account only after its grant.
    const kabel = { node_kind: "DEPARTMENT", node_id: WEBPAGE, category: "Material", description: "Ersatzkabel HDMI für den Vereinsraum",
      expense_cents: 1_299, booking_date: "2026-09-02", money_account_id: bank, receipt_exemption_reason: beleg(9001) };
    if (!("bas_webpage_freigabe" in state)) {
      let vorher = "gebucht (nicht erwartet)";
      try { fin("entry", "entry_create_unplanned", { plan_id: plan2026, data: kabel }); } catch (error) { vorher = dienstCode(error) || String((error as Error).message).slice(0, 200); }
      notiere("tc04_vor_der_freigabe", { antwort: vorher });
    }
    await step("bas_webpage_freigabe", () => fin("money-account", "grant_set", { account_id: bank, node_kind: "DEPARTMENT", node_id: WEBPAGE, data: { reason: "Webpage hat kein eigenes Konto; Ausgaben laufen über den Verein" } }).id);
    const kabelBuchung = await step("bas_webpage_kabel", () => fin("entry", "entry_create_unplanned", { plan_id: plan2026, data: kabel }));
    notiere("tc04_nach_der_freigabe", { buchung: kabelBuchung.id, posten_angelegt: kabelBuchung.position_created });
    await step("bas_webapp_freigabe", () => fin("money-account", "grant_set", { account_id: bank, node_kind: "DEPARTMENT", node_id: ABT.webApp, data: { reason: "Web-App und darunter buchen über das Vereinskonto" } }).id);
    notiere("freigaben_vereinskonto", { freigaben: (fin("money-account", "grants", { account_id: bank }) as any[]).map((g) => ({ knoten: g.node_name, seit: g.granted_at, zurueckgenommen: g.revoked_at })) });

    // Architektur books on its own account: its opening in the Haushalt 2026 takes it over (01 edge states).
    const rec = fin("money-account", "reconciliation", { plan_id: state.abt_arch_2025_plan });
    const archStand = (rec.accounts ?? []).find((a: any) => a.account?.id === archKonto)?.computed_balance_cents ?? 0;
    await step("bas_arch_anfangsbestand", () => { fin("money-account", "opening", { plan_id: plan2026, account_id: archKonto, data: {
      opening_date: "2026-01-01", opening_balance_cents: archStand, reason: `Übernahme aus dem Bereichsplan Architektur 2025 (${D42})` } }); return archStand; });
    const archPosten: Record<string, string> = {};
    for (const x of ARCHITEKTUR_2025.positions) {
      archPosten[x.key] = await step(`bas_arch_pos_${x.key}`, () => fin("plan-period", "position_create", { plan_id: plan2026, data: {
        name: x.name, category: x.category, department_id: ABT.architektur, recurring: true, context_type: "GENERAL",
        revenue_planned_cents: Math.round((x.rev ?? 0) * 1.04), expense_planned_cents: Math.round((x.exp ?? 0) * 1.04) } }).id);
    }
    let blatt = 9100;
    for (const x of ARCHITEKTUR_2025.positions) {
      for (const [i, b] of x.schedule(2026).entries()) {
        blatt += 1;
        if (b.date > heute) continue;
        const betrag = vary((x.rev ?? x.exp ?? 0) * 1.04 * b.share, 0.06);
        const n = blatt;
        await step(`bas_arch_buchung_${x.key}_${i}`, () => fin("entry", "entry_create", { position_id: archPosten[x.key], data: {
          description: b.text, booking_date: b.date, money_account_id: archKonto,
          ...(x.rev ? { revenue_cents: betrag } : { expense_cents: betrag }), receipt_exemption_reason: beleg(n) } }).id);
      }
    }
    notiere("architektur_im_haushalt", { anfangsbestand_cents: state.bas_arch_anfangsbestand, posten: Object.keys(archPosten).length });

    // The Haushalt 2027 exists for the parts of the App-Jahr (D35); else the run creates it as a draft.
    if (!plan2027) {
      const next = await step("bas_haushalt_2027", () => fin("plan-lifecycle", "next_period", { plan_id: plan2026, data: { include_non_recurring: false } }));
      notiere("haushalt_2027_angelegt", { plan: (next as any).plan?.id ?? null });
    }

    // Frame of the Mobile-App in the App-Jahr, set by the level above (D23).
    await step("bas_mobile_rahmen", () => fin("period", "frame_set", { node_kind: "DEPARTMENT", node_id: ABT.mobileApp, window_start: APP_JAHR,
      frame_kind: "DEPARTMENT", frame_id: ABT.mobileApp, data: { amount_cents: 200_000, reason: "Beschluss Vorstand zum App-Jahr 2026/27", decided_at: "2026-03-15" } }).amount_cents);

    // Positions of the Mobile-App in its window — one position, one part per touched Haushalt (D49).
    const teile: Record<string, string> = {};
    for (const x of MOBILE_APP.positions) {
      const gruppe = await step(`bas_mobile_pos_${x.key}`, () => fin("period", "window_position_create", { node_kind: "DEPARTMENT", node_id: ABT.mobileApp, window_start: APP_JAHR, data: {
        name: x.name, category: x.category, expense_planned_cents: x.exp ?? 0, revenue_planned_cents: x.rev ?? 0, ...(x.comment ? { comment: x.comment } : {}) } }));
      const teil2026 = (gruppe.parts ?? []).find((p: any) => p.finance_plan_id === plan2026);
      if (teil2026) teile[x.key] = teil2026.id;
      notiere(`posten_im_fenster_${x.key}`, { gruppe: gruppe.window_group_id, teile: (gruppe.parts ?? []).map((p: any) => ({ plan: p.finance_plan_id, von: p.planned_from, bis: p.planned_until, soll_cents: p.expense_planned_cents || p.revenue_planned_cents })) });
    }

    // Entries of the App-Jahr up to today, on the club account by the Web-App grant.
    blatt = 9200;
    for (const x of MOBILE_APP.positions) {
      for (const [i, b] of x.schedule(2026).entries()) {
        blatt += 1;
        if (b.date > heute || !teile[x.key]) continue;
        const betrag = vary((x.rev ?? x.exp ?? 0) * b.share, 0.06);
        const n = blatt;
        await step(`bas_mobile_buchung_${x.key}_${i}`, () => fin("entry", "entry_create", { position_id: teile[x.key], data: {
          description: b.text, booking_date: b.date, money_account_id: bank,
          ...(x.rev ? { revenue_cents: betrag } : { expense_cents: betrag }), receipt_exemption_reason: beleg(n) } }).id);
      }
    }
    // Unplanned: the exchange fee had no position (D46).
    const gebuehr = await step("bas_mobile_ungeplant", () => fin("entry", "entry_create_unplanned", { plan_id: plan2026, data: {
      node_kind: "DEPARTMENT", node_id: ABT.mobileApp, category: "Store-Gebühren", description: "Wechselkursgebühr Apple Developer",
      expense_cents: 420, booking_date: "2026-08-12", money_account_id: bank, receipt_exemption_reason: beleg(9299) } }));
    notiere("ungeplant_gebucht", { buchung: gebuehr.id, posten_angelegt: gebuehr.position_created });

    // Cash reports of the finished months — the second person approves (four-eyes).
    for (const [monat, von, bis] of [["07", "2026-07-01", "2026-07-31"], ["08", "2026-08-01", "2026-08-31"]]) {
      const id = await step(`bas_bericht_bank_${monat}`, () => fin("cash-report", "create", { data: { period_start: von, period_end: bis, money_account_id: bank, notes: `${PREFIX} Kassenbericht ${monat}/2026 (Bereich als Sicht)` } }).id);
      await step(`bas_bericht_bank_${monat}_submit`, () => { fin("cash-report", "submit", { report_id: id }); return true; });
    }

    // 4.3 — evidence.
    const baum = fin("period", "tree", { node_kind: "DEPARTMENT", node_id: ABT.mobileApp, window_start: APP_JAHR });
    const wurzel = (baum.nodes ?? []).find((n: any) => n.node_id === ABT.mobileApp) ?? {};
    notiere("tc02_sicht_mobile_app_app_jahr", {
      fenster: `${baum.season_start} – ${baum.season_end}`, haushalte: (baum.plans ?? []).map((p: any) => `${p.label}${p.department_id ? " (Bereich)" : ""}`),
      luecke: baum.uncovered, rahmen_cents: wurzel.frame_cents, verplant_cents: wurzel.planned_cents, frei_cents: wurzel.free_cents, ist_cents: wurzel.actual_cents,
      posten: (baum.positions ?? []).map((p: any) => ({ name: p.name, rubrik: p.category, quelle: p.plan_source, haushalte: p.plan_ids.length, soll: p.planned_cents, ist: p.actual_cents, einnahmen_soll: p.revenue_planned_cents, einnahmen_ist: p.revenue_actual_cents, buchungen: p.entry_count })),
    });
    const journal = fin("plan-period", "journal", { plan_id: plan2026, filter: "unplanned" });
    notiere("tc03_journal_ungeplant", { zeilen: (journal.rows ?? []).map((r: any) => ({ nr: r.journal_number, text: r.description, knoten: r.node_name, rubrik: r.category, posten: r.position_name, konto: r.money_account_name, ungeplant: r.unplanned })) });
    const knotenJournal = fin("plan-period", "journal", { plan_id: plan2026, node_kind: "DEPARTMENT", node_id: ABT.mobileApp, order: "desc", limit: 10 });
    notiere("tc03_journal_mobile_app", { zeilen: (knotenJournal.rows ?? []).map((r: any) => ({ nr: r.journal_number, text: r.description, knoten: r.node_name, rubrik: r.category, posten: r.position_name, konto: r.money_account_name, ungeplant: r.unplanned })) });
    const fensterAbrechnung = fin("period", "statement", { node_kind: "DEPARTMENT", node_id: ABT.mobileApp, window_start: APP_JAHR });
    notiere("tc05_abrechnung_app_jahr", { rahmen_cents: fensterAbrechnung.frame?.current_cents, verplant_cents: fensterAbrechnung.planned_cents, ist_cents: fensterAbrechnung.actual_cents,
      einnahmen_ist_cents: fensterAbrechnung.revenue_actual_cents, ergebnis_cents: fensterAbrechnung.result_cents, vorschlag_rahmen_cents: fensterAbrechnung.proposal_next_frame_cents, luecke: fensterAbrechnung.uncovered });
    for (const [name, id] of [["Mobile-App", ABT.mobileApp], ["Webpage", WEBPAGE], ["Architektur", ABT.architektur]]) {
      const s = fin("budget", "statement", { plan_id: plan2026, node_kind: "DEPARTMENT", node_id: id });
      notiere(`tc05_abrechnung_haushalt_2026_${name}`, { rahmen_cents: s.frame?.current_cents, verplant_cents: s.planned_cents, ist_cents: s.actual_cents, rest_cents: s.rest_cents, je_rubrik: s.by_rubric });
    }
    const offeneFreigaben = (fin("plan-period", "journal", { plan_id: plan2026, order: "desc", limit: 200 }).rows ?? []).filter((r: any) => !r.approved_at && !r.deleted_before_protocol).length;
    notiere("offen_fuer_tom", { freigaben_offen_haushalt_2026: offeneFreigaben, kassenberichte_eingereicht: [state.bas_bericht_bank_07, state.bas_bericht_bank_08] });
    bericht.ergebnis = "vollständig";
  } catch (error) {
    bericht.abbruch = { letzter_schritt: bericht.schritte.at(-1)?.schritt ?? null, code: dienstCode(error) || null, fehler: String((error as Error).message).slice(0, 600) };
    throw error;
  } finally {
    bericht.ende = new Date().toISOString();
    mkdirSync(BERICHTE, { recursive: true });
    writeFileSync(datei, JSON.stringify(bericht, null, 2) + "\n");
    console.log(`Bericht: ${datei}`);
  }
}

function writeTmp(body: object): string {
  const file = join(HERE, `tmp-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(body));
  return file;
}

main().catch((error) => { console.error(`✗ ${error.message}`); process.exit(1); });
