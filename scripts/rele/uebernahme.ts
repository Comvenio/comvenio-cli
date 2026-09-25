// Takeover of a club's annual reports into the Finance Hub — buchhaltung-14-04 §4.2.
//
//   bun scripts/rele/uebernahme.ts --verein <club-id> --datei <2024.json> --datei <2025.json> [--nur-vorschau] [--protokoll <pfad>]
//
// Books the transfer files written by lesen.py, year by year and only through
// `comvenio finance run` (CLI-only). --nur-vorschau plans every step from the
// files and calls the CLI not once. A run against a club other than the
// Comvenio club needs its exception in the gate manifest with `schreiben`;
// the run checks that before the first CLI call — and that the CLI login
// names that club (`--club` does not work under OAuth, comvenio-cli #135).
//
// The protocol (JSON) holds club data and every created id: it lies next to
// the transfer files at the club, never in a repository. A rerun continues
// from it; a plan of the year that the protocol does not know stops the run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const COMVENIO = new Set(["0ec34e70-999a-47c4-a1b1-bdb293110fa5", "476bc619-ddb4-4693-bbe6-45936fa4f47e"]);

export type Konto = { name: string; art: "BANK" | "CASH" | "IN_KIND"; standard: boolean; anfang_cents: number; ende_cents: number | null };
export type Kategorie = { zeile: number; text: string; seite: "E" | "A"; rubrik: string; sphaere: string | null; betraege: Record<string, number> };
export type Uebertrag = { von: string; nach: string; betrag_cents: number };
export type Uebernahme = {
  jahr: number;
  konten: Konto[];
  kategorien: Kategorie[];
  transit: Uebertrag[];
  wechselgeld: Array<{ konto: string; zeile: number; betrag_cents: number }>;
  korrektur: { abweichung: Record<string, number>; uebertraege: Uebertrag[] };
  stichtagsdifferenzen: Array<{ konto: string; betrag_cents: number }>;
  einnahmen_cents: number;
  ausgaben_cents: number;
  ergebnis_cents: number;
};

export type Schritt =
  | { art: "konto"; key: string; konto: string; kind: Konto["art"]; standard: boolean }
  | { art: "haushalt"; key: string; jahr: number; startkapital_cents: number | null }
  | { art: "anfang"; key: string; konto: string; cents: number }
  | { art: "anfang_pruefen"; key: string; konto: string; datei_cents: number; erlaubt_cents: number }
  | { art: "aktivieren"; key: string }
  | { art: "posten"; key: string; name: string; rubrik: string; sphaere: string | null; nummer: number }
  | { art: "buchung"; key: string; posten: string; konto: string; richtung: "revenue" | "expense"; cents: number; datum: string; text: string; grund: string }
  | { art: "uebertrag"; key: string; von: string; nach: string; cents: number; datum: string; grund: string }
  | { art: "probe"; key: string }
  | { art: "auszug"; key: string; konto: string; cents: number }
  | { art: "abschluss"; key: string };

export class LaufFehler extends Error {}

const SAMMEL = (jahr: number) => `Übernahme aus Rechenschaftsbericht ${jahr} (Sammelbuchung, Belege beim Verein)`;
const DIFFERENZ = "Übernahmedifferenz";

/** Every step of every year, in booking order — the preview IS this list. */
export function planen(jahre: Uebernahme[]): Schritt[] {
  const sortiert = [...jahre].sort((a, b) => a.jahr - b.jahr);
  sortiert.forEach((j, i) => {
    const vorher = sortiert[i - 1];
    if (vorher && j.jahr !== vorher.jahr + 1) throw new LaufFehler(`Die Jahre folgen nicht aufeinander: ${vorher.jahr} → ${j.jahr}.`);
  });
  const schritte: Schritt[] = [];
  sortiert.forEach((j, i) => {
    const y = j.jahr;
    const geld = j.konten.filter((k) => k.art !== "IN_KIND");
    if (i === 0) {
      for (const k of j.konten) schritte.push({ art: "konto", key: `konto:${k.name}`, konto: k.name, kind: k.art, standard: k.standard });
    }
    schritte.push({ art: "haushalt", key: `${y}:haushalt`, jahr: y, startkapital_cents: i === 0 ? geld.reduce((s, k) => s + k.anfang_cents, 0) : null });
    for (const k of geld) {
      if (i === 0) schritte.push({ art: "anfang", key: `${y}:anfang:${k.name}`, konto: k.name, cents: k.anfang_cents });
      else {
        const erlaubt = j.stichtagsdifferenzen.filter((d) => d.konto === k.name).reduce((s, d) => s + d.betrag_cents, 0);
        schritte.push({ art: "anfang_pruefen", key: `${y}:anfang_pruefen:${k.name}`, konto: k.name, datei_cents: k.anfang_cents, erlaubt_cents: erlaubt });
      }
    }
    schritte.push({ art: "aktivieren", key: `${y}:aktiv` });

    const posten = j.kategorien.map((k, n) => ({ art: "posten" as const, key: `${y}:posten:${k.zeile}`, name: k.text, rubrik: k.rubrik, sphaere: k.sphaere, nummer: n + 1 }));
    if (i > 0 && j.stichtagsdifferenzen.length) {
      posten.push({ art: "posten", key: `${y}:posten:differenz`, name: DIFFERENZ, rubrik: "Übernahme", sphaere: null, nummer: posten.length + 1 });
    }
    schritte.push(...posten);

    // A stated difference of the balance day: booked on 1 January (§4.2b).
    if (i > 0) {
      for (const d of j.stichtagsdifferenzen) {
        schritte.push({
          art: "buchung", key: `${y}:differenz:${d.konto}`, posten: `${y}:posten:differenz`, konto: d.konto,
          richtung: d.betrag_cents < 0 ? "expense" : "revenue", cents: Math.abs(d.betrag_cents), datum: `${y}-01-01`,
          text: `${DIFFERENZ} ${y}: Bestand 31.12.${y - 1} laut Rechenschaftsbericht ${y}`,
          grund: `Bestand 31.12.${y - 1} laut Rechenschaftsbericht ${y} weicht vom Bericht ${y - 1} ab (${(d.betrag_cents / 100).toFixed(2).replace(".", ",")} €)`,
        });
      }
    }
    // Income before expenses before transfers: the cash box counts only the evening.
    const buchungen: Schritt[] = [];
    for (const k of j.kategorien) {
      for (const [konto, betrag] of Object.entries(k.betraege)) {
        if (!betrag) continue;
        // A negative amount turns the side: a credit on an expense line is income.
        const einnahme = (k.seite === "E") === (betrag > 0);
        buchungen.push({
          art: "buchung", key: `${y}:buchung:${k.zeile}:${konto}`, posten: `${y}:posten:${k.zeile}`, konto,
          richtung: einnahme ? "revenue" : "expense", cents: Math.abs(betrag), datum: `${y}-12-31`,
          text: `Rechenschaftsbericht ${y}: ${k.text}`, grund: SAMMEL(y),
        });
      }
    }
    schritte.push(...buchungen.filter((b) => b.art === "buchung" && b.richtung === "revenue"));
    schritte.push(...buchungen.filter((b) => b.art === "buchung" && b.richtung === "expense"));
    j.transit.forEach((u, n) => schritte.push({ art: "uebertrag", key: `${y}:transit:${n}`, von: u.von, nach: u.nach, cents: u.betrag_cents, datum: `${y}-12-31`, grund: `Geldtransit laut Rechenschaftsbericht ${y}` }));
    j.korrektur.uebertraege.forEach((u, n) => schritte.push({ art: "uebertrag", key: `${y}:korrektur:${n}`, von: u.von, nach: u.nach, cents: u.betrag_cents, datum: `${y}-12-31`, grund: `Übernahmekorrektur ${y}: Bestand laut Vermögensübersicht` }));
    schritte.push({ art: "probe", key: `${y}:probe` });
    for (const k of geld) schritte.push({ art: "auszug", key: `${y}:auszug:${k.name}`, konto: k.name, cents: k.ende_cents as number });
    schritte.push({ art: "abschluss", key: `${y}:abschluss` });
  });
  return schritte;
}

/**
 * The gate `club-restriction` (core-gates-comvenio.md): a club other than the
 * Comvenio club needs its exception entry, for a booking run with `schreiben`.
 */
export function pruefeGate(verein: string, manifest: string, schreiben: boolean): void {
  if (COMVENIO.has(verein)) return;
  const eintraege = manifest.split(/\n\s*- id:/).slice(1);
  const eintrag = eintraege.find((e) => new RegExp(`club_id:\\s*${verein}\\b`).test(e));
  if (!eintrag) throw new LaufFehler(`Gate club-restriction: Für den Verein ${verein} steht keine Ausnahme im Gate-Manifest — kein Aufruf.`);
  const erlaubt = (eintrag.match(/allow:\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").map((s) => s.trim());
  if (schreiben && !erlaubt.includes("schreiben")) {
    throw new LaufFehler(`Gate club-restriction: Die Ausnahme für ${verein} erlaubt nur ${erlaubt.join(", ") || "nichts"} — für den Lauf fehlt „schreiben“ (Stufe 2, eigene Freigabe des Betreibers).`);
  }
}

export type Cli = (args: string[]) => any;

type Protokoll = { verein: string; schritte: Record<string, unknown>; ereignisse: Array<Record<string, unknown>>; vorschau?: Schritt[] };

export function laufen(jahre: Uebernahme[], verein: string, cli: Cli, protokoll: Protokoll, speichern: () => void): Protokoll {
  const fin = (area: string, op: string, input: object = {}): any => {
    const res = cli(["finance", "run", area, op, "--input", JSON.stringify(input)]);
    if (res?.widget === "confirmation" || res?.confirmation_required) throw new LaufFehler(`${area} ${op}: nur Vorschau, nicht ausgeführt`);
    if (res?.status && res.status !== "completed") throw new LaufFehler(`${area} ${op}: ${JSON.stringify(res).slice(0, 600)}`);
    return res?.result ?? res;
  };
  const wer = cli(["whoami", "--json"]);
  if (wer?.clubId !== verein) {
    throw new LaufFehler(`Die CLI-Anmeldung steht auf ${wer?.clubId ?? "keinem Verein"}, nicht auf ${verein} — mit „comvenio login“ im Verein anmelden.`);
  }
  const s = protokoll.schritte;
  const merke = (key: string, wert: unknown) => { s[key] = wert; speichern(); return wert; };
  const schritte = planen(jahre);

  // A plan of one of these years that this protocol did not create stops the run (TC-06).
  const plaene: any[] = fin("plan-period", "list");
  for (const j of jahre) {
    const da = plaene.find((p) => p.year === j.jahr && !p.department_id);
    if (da && s[`${j.jahr}:haushalt`] !== da.id) {
      throw new LaufFehler(`Für ${j.jahr} besteht schon ein Haushalt (${da.id}), den dieses Protokoll nicht angelegt hat — kein zweiter Lauf.`);
    }
  }

  const konten = (): Record<string, string> => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith("konto:")).map(([k, v]) => [k.slice(6), v as string]));
  const plan = (key: string) => s[`${key.split(":")[0]}:haushalt`] as string;
  const jahrVon = (key: string) => jahre.find((j) => String(j.jahr) === key.split(":")[0]) as Uebernahme;

  for (const x of schritte) {
    if (x.key in s) continue;
    switch (x.art) {
      case "konto": {
        const vorhanden = (fin("money-account", "list") as any[]).find((a) => a.name === x.konto && !a.archived_at);
        merke(x.key, vorhanden?.id ?? fin("money-account", "create", { data: { name: x.konto, kind: x.kind, is_default: x.standard } }).id);
        break;
      }
      case "haushalt": {
        if (x.startkapital_cents !== null) {
          merke(x.key, fin("plan-period", "create", { data: { year: x.jahr, available_capital_cents: x.startkapital_cents, notes: `Übernahme aus Rechenschaftsbericht ${x.jahr}` } }).id);
        } else {
          fin("plan-lifecycle", "next_period", { plan_id: s[`${x.jahr - 1}:haushalt`], data: { include_non_recurring: false } });
          const neu = (fin("plan-period", "list") as any[]).find((p) => p.year === x.jahr && !p.department_id);
          if (!neu) throw new LaufFehler(`next_period legte keinen Haushalt ${x.jahr} an.`);
          merke(x.key, neu.id);
          fin("plan-period", "update", { plan_id: neu.id, data: { notes: `Übernahme aus Rechenschaftsbericht ${x.jahr}` } });
        }
        break;
      }
      case "anfang":
        fin("money-account", "opening", { plan_id: plan(x.key), account_id: konten()[x.konto], data: {
          opening_date: `${x.key.split(":")[0]}-01-01`, opening_balance_cents: x.cents, reason: `Übernahme aus Rechenschaftsbericht ${x.key.split(":")[0]}` } });
        merke(x.key, x.cents);
        break;
      case "anfang_pruefen": {
        const zeile = (fin("money-account", "reconciliation", { plan_id: plan(x.key) }).accounts as any[]).find((a) => a.account.id === konten()[x.konto]);
        const abgeleitet = zeile?.opening_balance_cents ?? 0;
        if (x.datei_cents - abgeleitet !== x.erlaubt_cents) {
          throw new LaufFehler(`${x.konto}: abgeleiteter Anfangsbestand ${abgeleitet} ct, laut Bericht ${x.datei_cents} ct — die Differenz ${x.datei_cents - abgeleitet} ct steht nicht unter stichtagsdifferenzen.`);
        }
        merke(x.key, abgeleitet);
        break;
      }
      case "aktivieren":
        merke(x.key, fin("plan-period", "update", { plan_id: plan(x.key), data: { status: "ACTIVE" } }).status);
        break;
      case "posten":
        merke(x.key, fin("plan-period", "position_create", { plan_id: plan(x.key), data: {
          name: x.name, category: x.rubrik, position_number: x.nummer, recurring: false,
          revenue_planned_cents: 0, expense_planned_cents: 0, context_type: "GENERAL",
          ...(x.sphaere ? { tax_sphere: x.sphaere, comment: "Sphäre: Vorschlag aus der Übernahme, vom Verein zu bestätigen" } : {}),
        } }).id);
        break;
      case "buchung":
        merke(x.key, fin("entry", "entry_create", { position_id: s[x.posten], data: {
          description: x.text, booking_date: x.datum, money_account_id: konten()[x.konto],
          [x.richtung === "revenue" ? "revenue_cents" : "expense_cents"]: x.cents, receipt_exemption_reason: x.grund,
        } }).id);
        break;
      case "uebertrag":
        merke(x.key, fin("money-account", "transfer_create", { data: {
          from_account_id: konten()[x.von], to_account_id: konten()[x.nach], amount_cents: x.cents, transfer_date: x.datum, reason: x.grund } }).id);
        break;
      case "probe": {
        const j = jahrVon(x.key);
        const zeilen = fin("money-account", "reconciliation", { plan_id: plan(x.key) }).accounts as any[];
        const abweichung: string[] = [];
        for (const k of j.konten) {
          const z = zeilen.find((a) => a.account.id === konten()[k.name]);
          if (k.art === "IN_KIND") {
            const ein = j.kategorien.filter((c) => c.seite === "E").reduce((sum, c) => sum + (c.betraege[k.name] ?? 0), 0);
            const aus = j.kategorien.filter((c) => c.seite === "A").reduce((sum, c) => sum + (c.betraege[k.name] ?? 0), 0);
            if ((z?.revenue_cents ?? 0) !== ein || (z?.expense_cents ?? 0) !== aus) abweichung.push(`${k.name}: Einnahmen ${z?.revenue_cents} / Ausgaben ${z?.expense_cents} ct, laut Bericht ${ein} / ${aus} ct`);
          } else if (z?.period_end_balance_cents !== k.ende_cents) {
            abweichung.push(`${k.name}: Endbestand ${z?.period_end_balance_cents} ct, laut Vermögensübersicht ${k.ende_cents} ct`);
          }
        }
        if (abweichung.length) throw new LaufFehler(`Probe ${j.jahr} nicht bestanden — der Haushalt bleibt ACTIVE: ${abweichung.join("; ")}`);
        merke(x.key, "bestanden");
        break;
      }
      case "auszug": {
        const y = x.key.split(":")[0];
        const zeile = (fin("money-account", "reconciliation", { plan_id: plan(x.key) }).accounts as any[]).find((a) => a.account.id === konten()[x.konto]);
        // The opening goes along unchanged: only the statement is new.
        fin("money-account", "opening", { plan_id: plan(x.key), account_id: konten()[x.konto], data: {
          opening_date: zeile?.opening_date ?? `${y}-01-01`, opening_balance_cents: zeile?.opening_balance_cents ?? 0,
          statement_balance_cents: x.cents, statement_date: `${y}-12-31`, reason: `Auszug 31.12.${y} laut Vermögensübersicht` } });
        merke(x.key, x.cents);
        break;
      }
      case "abschluss": {
        const y = x.key.split(":")[0];
        // Collective entries of a report the general meeting discharged: no
        // second person approves them one by one — hence force, said in the note.
        fin("plan-lifecycle", "close", { plan_id: plan(x.key), force: true,
          note: `Übernahme aus Rechenschaftsbericht ${y}; Sammelbuchungen, von der Hauptversammlung entlastet` });
        merke(x.key, "geschlossen");
        break;
      }
    }
    protokoll.ereignisse.push({ key: x.key, art: x.art });
  }
  return protokoll;
}

function argumente(argv: string[]): { dateien: string[]; verein?: string; vorschau: boolean; protokoll?: string; gates?: string } {
  const out = { dateien: [] as string[], vorschau: false } as ReturnType<typeof argumente>;
  const wert = (i: number): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new LaufFehler(`${argv[i - 1]} braucht einen Wert.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--datei") out.dateien.push(wert(++i));
    else if (a === "--verein") out.verein = wert(++i);
    else if (a === "--nur-vorschau") out.vorschau = true;
    else if (a === "--protokoll") out.protokoll = wert(++i);
    else if (a === "--gates") out.gates = wert(++i);
    else throw new LaufFehler(`Unbekanntes Argument: ${a}`);
  }
  return out;
}

if (import.meta.main) {
  try {
    const args = argumente(process.argv.slice(2));
    const erste = args.dateien[0];
    if (erste === undefined) throw new LaufFehler("Mindestens eine --datei <Übernahmedatei.json> angeben.");
    const jahre = args.dateien.map((d) => JSON.parse(readFileSync(d, "utf8")) as Uebernahme);
    // The preview never lies where the run keeps its state: a run would read it as its protocol.
    const jahreText = jahre.map((j) => j.jahr).sort().join("-");
    const ziel = args.protokoll ?? join(dirname(erste), `${args.vorschau ? "vorschau" : "protokoll"}-${jahreText}.json`);
    if (args.vorschau) {
      // Local files only — the CLI is never called (TC-04, TC-08).
      const schritte = planen(jahre);
      writeFileSync(ziel, JSON.stringify({ vorschau: schritte, jahre: jahre.map((j) => ({ jahr: j.jahr, ergebnis_cents: j.ergebnis_cents, wechselgeld: j.wechselgeld, korrektur: j.korrektur, stichtagsdifferenzen: j.stichtagsdifferenzen })) }, null, 2));
      const zahl = (art: string) => schritte.filter((x) => x.art === art).length;
      console.log(`Vorschau: ${zahl("posten")} Posten, ${zahl("buchung")} Buchungen, ${zahl("uebertrag")} Überträge → ${ziel}`);
    } else {
      if (!args.verein) throw new LaufFehler("--verein <club-id> angeben.");
      const cliDir = join(import.meta.dir, "..", "..");
      const gates = args.gates ?? join(cliDir, "..", "comvenio-tools", "workspace-config", "rules", "core-gates-comvenio.md");
      pruefeGate(args.verein, existsSync(gates) ? readFileSync(gates, "utf8") : "", true);
      const protokoll: Protokoll = existsSync(ziel) ? JSON.parse(readFileSync(ziel, "utf8")) : { verein: args.verein, schritte: {}, ereignisse: [] };
      if (protokoll.verein !== args.verein) throw new LaufFehler(`Das Protokoll ${ziel} gehört zum Verein ${protokoll.verein}.`);
      const cli: Cli = (a) => {
        const p = Bun.spawnSync(["bun", "run", "src/index.ts", ...a], { cwd: cliDir, stdout: "pipe", stderr: "pipe" });
        const out = p.stdout.toString().trim();
        if (p.exitCode !== 0) throw new LaufFehler(`CLI ${a.slice(0, 4).join(" ")} → exit ${p.exitCode}: ${(p.stderr.toString() || out).slice(0, 800)}`);
        return JSON.parse(out);
      };
      laufen(jahre, args.verein, cli, protokoll, () => writeFileSync(ziel, JSON.stringify(protokoll, null, 2)));
      console.log(`Übernahme abgeschlossen → ${ziel}`);
    }
  } catch (fehler) {
    console.error(`Abbruch: ${(fehler as Error).message}`);
    process.exit(1);
  }
}
