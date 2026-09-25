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
import { createHash } from "node:crypto";
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
  | { art: "startkapital_pruefen"; key: string; cents: number }
  | { art: "anfang"; key: string; konto: string; cents: number }
  | { art: "anfang_pruefen"; key: string; konto: string; datei_cents: number; erlaubt_cents: number }
  | { art: "aktivieren"; key: string }
  | { art: "posten"; key: string; name: string; rubrik: string; sphaere: string | null; nummer: number }
  | { art: "buchung"; key: string; posten: string; konto: string; richtung: "revenue" | "expense"; cents: number; datum: string; text: string; grund: string }
  | { art: "uebertrag"; key: string; von: string; nach: string; cents: number; datum: string; grund: string }
  | { art: "probe"; key: string }
  | { art: "auszug"; key: string; konto: string; cents: number }
  | { art: "bericht"; key: string; konto: string }
  | { art: "einreichen"; key: string; konto: string }
  | { art: "freigabe"; key: string }
  | { art: "pruefung"; key: string }
  | { art: "abschluss"; key: string }
  | { art: "pruefung_nach"; key: string };

export class LaufFehler extends Error {}

/**
 * Not an error: the run stops at a point only a person can pass — the
 * second person's approval, a missing procedure documentation. A rerun
 * continues there.
 */
export class LaufWartet extends Error {}

/** The audit rules that hold a year open: every error, and the notes an import can and must fulfil. */
export const PRUEFTOR_HINWEISE = new Set(["ENTRY_NOT_APPROVED", "RECONCILIATION_OPEN", "ENTRY_WITHOUT_ACCOUNT"]);

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
    // Per account first — its message names the account —, then the sum.
    if (i > 0) {
      const erlaubt = j.stichtagsdifferenzen.reduce((sum, d) => sum + d.betrag_cents, 0);
      schritte.push({ art: "startkapital_pruefen", key: `${y}:startkapital`, cents: geld.reduce((sum, k) => sum + k.anfang_cents, 0) - erlaubt });
    }
    schritte.push({ art: "aktivieren", key: `${y}:aktiv` });

    const posten = j.kategorien.map((k, n) => ({ art: "posten" as const, key: `${y}:posten:${k.zeile}`, name: k.text, rubrik: k.rubrik, sphaere: k.sphaere, nummer: n + 1 }));
    if (i > 0 && j.stichtagsdifferenzen.length) {
      posten.push({ art: "posten", key: `${y}:posten:differenz`, name: DIFFERENZ, rubrik: "Übernahme", sphaere: "IDEELL", nummer: posten.length + 1 });
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
          // The report line is the entry's durable import id (review R2-1):
          // the cash book shows it, and an auditor finds the collective receipt by it.
          text: `Rechenschaftsbericht ${y}, Zeile ${k.zeile}: ${k.text}`, grund: SAMMEL(y),
        });
      }
    }
    schritte.push(...buchungen.filter((b) => b.art === "buchung" && b.richtung === "revenue"));
    schritte.push(...buchungen.filter((b) => b.art === "buchung" && b.richtung === "expense"));
    // Numbered, so two alike transfers never share a reason (review R2-8).
    j.transit.forEach((u, n) => schritte.push({ art: "uebertrag", key: `${y}:transit:${n}`, von: u.von, nach: u.nach, cents: u.betrag_cents, datum: `${y}-12-31`,
      grund: `Geldtransit laut Rechenschaftsbericht ${y} (${n + 1} von ${j.transit.length})` }));
    j.korrektur.uebertraege.forEach((u, n) => schritte.push({ art: "uebertrag", key: `${y}:korrektur:${n}`, von: u.von, nach: u.nach, cents: u.betrag_cents, datum: `${y}-12-31`,
      grund: `Übernahmekorrektur ${y} (${n + 1} von ${j.korrektur.uebertraege.length}): Bestand laut Vermögensübersicht` }));
    schritte.push({ art: "probe", key: `${y}:probe` });
    for (const k of geld) schritte.push({ art: "auszug", key: `${y}:auszug:${k.name}`, konto: k.name, cents: k.ende_cents as number });
    // The cash audit of the year: one report per money account, submitted;
    // the second person approves its entries (four eyes) — then the audit
    // gate, the close without force, and the audit of the closed year.
    for (const k of geld) {
      schritte.push({ art: "bericht", key: `${y}:bericht:${k.name}`, konto: k.name });
      schritte.push({ art: "einreichen", key: `${y}:eingereicht:${k.name}`, konto: k.name });
    }
    schritte.push({ art: "freigabe", key: `${y}:freigabe` });
    schritte.push({ art: "pruefung", key: `${y}:pruefung` });
    schritte.push({ art: "abschluss", key: `${y}:abschluss` });
    schritte.push({ art: "pruefung_nach", key: `${y}:pruefung_nach` });
  });
  return schritte;
}

/**
 * The gate `club-restriction` (core-gates-comvenio.md): a club other than the
 * Comvenio club needs its exception entry, for a booking run with `schreiben`.
 * Read as YAML — exactly the gate's own exception list and its `allow`, so a
 * comment or another gate's entry never counts (review R1-4).
 */
export function pruefeGate(verein: string, manifest: string, schreiben: boolean): void {
  if (COMVENIO.has(verein)) return;
  const bloecke = [...manifest.matchAll(/```yaml\r?\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  const gates = bloecke.flatMap((b) => {
    const doc = Bun.YAML.parse(b) as { gates?: unknown } | null;
    return Array.isArray(doc?.gates) ? doc.gates : [];
  }) as Array<{ id?: unknown; exceptions?: unknown }>;
  const gate = gates.find((g) => g?.id === "club-restriction");
  const ausnahmen = (Array.isArray(gate?.exceptions) ? gate.exceptions : []) as Array<{ club_id?: unknown; allow?: unknown }>;
  const eintrag = ausnahmen.find((e) => e?.club_id === verein);
  if (!eintrag) throw new LaufFehler(`Gate club-restriction: Für den Verein ${verein} steht keine Ausnahme im Gate-Manifest — kein Aufruf.`);
  const erlaubt = Array.isArray(eintrag.allow) ? eintrag.allow.map(String) : [];
  if (schreiben && !erlaubt.includes("schreiben")) {
    throw new LaufFehler(`Gate club-restriction: Die Ausnahme für ${verein} erlaubt nur ${erlaubt.join(", ") || "nichts"} — für den Lauf fehlt „schreiben“ (Stufe 2, eigene Freigabe des Betreibers).`);
  }
}

export type Cli = (args: string[]) => any;

/**
 * The key of one writing step: the same club and step always give the same
 * UUID, so a rerun after a crash between the call and the protocol replays
 * the first result instead of booking twice (the connector keeps it 24 h).
 */
export function schrittSchluessel(verein: string, key: string): string {
  const h = createHash("sha256").update(`rele-uebernahme:${verein}:${key}`).digest("hex");
  const variante = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** The fingerprint of the input a protocol belongs to (review R1-2). */
export function eingabeHash(jahre: Uebernahme[]): string {
  const sortiert = [...jahre].sort((a, b) => a.jahr - b.jahr);
  return createHash("sha256").update(JSON.stringify(sortiert)).digest("hex");
}

export type Protokoll = {
  verein: string;
  eingabe_hash?: string;
  schritte: Record<string, unknown>;
  ereignisse: Array<Record<string, unknown>>;
};

/** What a year should show per account: gross income and expenses including transfers. */
function bruttoSoll(schritte: Schritt[], jahr: number): Record<string, { ein: number; aus: number }> {
  const soll: Record<string, { ein: number; aus: number }> = {};
  const auf = (konto: string) => (soll[konto] ??= { ein: 0, aus: 0 });
  for (const x of schritte) {
    if (!x.key.startsWith(`${jahr}:`)) continue;
    if (x.art === "buchung") {
      if (x.richtung === "revenue") auf(x.konto).ein += x.cents;
      else auf(x.konto).aus += x.cents;
    } else if (x.art === "uebertrag") {
      auf(x.von).aus += x.cents;
      auf(x.nach).ein += x.cents;
    }
  }
  return soll;
}

/**
 * `freigabe` is the CLI of a second person, signed in under their own
 * profile: it approves the entries of the cash reports (four eyes). Without
 * it the run waits there.
 */
export function laufen(jahre: Uebernahme[], verein: string, cli: Cli, protokoll: Protokoll, speichern: () => void, freigabe?: Cli): Protokoll {
  const fin = (area: string, op: string, input: object = {}, schritt?: string): any => {
    const schluessel = schritt ? ["--idempotency-key", schrittSchluessel(verein, schritt)] : [];
    const res = cli(["finance", "run", area, op, "--input", JSON.stringify(input), ...schluessel]);
    if (res?.widget === "confirmation" || res?.confirmation_required) throw new LaufFehler(`${area} ${op}: nur Vorschau, nicht ausgeführt`);
    if (res?.status && res.status !== "completed") throw new LaufFehler(`${area} ${op}: ${JSON.stringify(res).slice(0, 600)}`);
    return res?.result ?? res;
  };
  const s = protokoll.schritte;
  const merke = (key: string, wert: unknown) => { s[key] = wert; speichern(); return wert; };
  const vermerke = (eintrag: Record<string, unknown>) => { protokoll.ereignisse.push({ zeit: new Date().toISOString(), ...eintrag }); speichern(); };
  const pruefen = (planId: string) => fin("plan-period", "audit_check", { plan_id: planId }) as { rules: Array<{ code: string; severity: string; fulfilled: boolean; count: number; findings: Array<{ entry_id?: string; detail?: string }> }>; summary: Record<string, number> };

  try {
    const wer = cli(["whoami", "--json"]);
    if (wer?.clubId !== verein) {
      throw new LaufFehler(`Die CLI-Anmeldung steht auf ${wer?.clubId ?? "keinem Verein"}, nicht auf ${verein} — mit „comvenio login“ im Verein anmelden.`);
    }
    const zweite = freigabe?.(["whoami", "--json"]);
    if (zweite && (zweite.clubId !== verein || !zweite.userId || zweite.userId === wer?.userId)) {
      throw new LaufFehler(`Die Freigabe-Anmeldung muss eine andere Person im selben Verein sein (steht auf ${zweite.clubId}, ${zweite.email ?? zweite.userId}).`);
    }
    // The protocol belongs to exactly this input: a changed file never
    // continues a half-booked year (review R1-2).
    const hash = eingabeHash(jahre);
    if (protokoll.eingabe_hash === undefined) {
      if (Object.keys(s).length) throw new LaufFehler("Das Protokoll trägt Schritte, aber keinen Eingabe-Hash — es gehört zu keinem prüfbaren Stand.");
      protokoll.eingabe_hash = hash;
      speichern();
    } else if (protokoll.eingabe_hash !== hash) {
      throw new LaufFehler(`Die Übernahmedateien haben sich seit dem ersten Lauf geändert (Hash ${hash.slice(0, 12)} statt ${protokoll.eingabe_hash.slice(0, 12)}) — nicht fortsetzen.`);
    }
    const schritte = planen(jahre);

    // A plan of one of these years that this protocol did not create stops
    // the run (TC-06) — unless the protocol noted that it was about to create
    // it and the plan is still untouched (review R1-3).
    const plaene: any[] = fin("plan-period", "list");
    for (const j of jahre) {
      const da = plaene.find((p) => p.year === j.jahr && !p.department_id);
      const key = `${j.jahr}:haushalt`;
      if (!da || s[key] === da.id) continue;
      const vorjahr = plaene.find((p) => p.year === j.jahr - 1 && !p.department_id);
      const herkunft = s[`${j.jahr - 1}:haushalt`] !== undefined
        ? vorjahr?.id === s[`${j.jahr - 1}:haushalt`] && vorjahr?.status === "CLOSED"
        : da.notes === `Übernahme aus Rechenschaftsbericht ${j.jahr}`;
      const ohneBuchung = () => (fin("money-account", "reconciliation", { plan_id: da.id }).accounts as any[])
        .every((a) => !(a.period_revenue_cents ?? a.revenue_cents) && !(a.period_expense_cents ?? a.expense_cents));
      if (s[key] === undefined && s[`${key}:begonnen`] && da.status === "DRAFT" && herkunft && ohneBuchung()) {
        merke(key, da.id);
        vermerke({ key, art: "haushalt", uebernommen: da.id });
        continue;
      }
      throw new LaufFehler(`Für ${j.jahr} besteht schon ein Haushalt (${da.id}), den dieses Protokoll nicht angelegt hat — kein zweiter Lauf.`);
    }

    const konten = (): Record<string, string> => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith("konto:")).map(([k, v]) => [k.slice(6), v as string]));
    const jahrDes = (key: string) => Number(key.split(":")[0]);
    const plan = (key: string) => s[`${jahrDes(key)}:haushalt`] as string;
    const jahrVon = (key: string) => jahre.find((j) => j.jahr === jahrDes(key)) as Uebernahme;

    // A year that already has its plan is a continuation: what the service
    // holds is taken over before anything is written again (review R1-1).
    const bestand = new Map<number, { posten: any[]; buchungen: any[]; uebertraege: any[]; belegt: Set<string> }>();
    const fortsetzung = new Set(jahre.filter((j) => s[`${j.jahr}:haushalt`] !== undefined).map((j) => j.jahr));
    const bestandVon = (jahr: number) => {
      let b = bestand.get(jahr);
      if (!b) {
        const planId = s[`${jahr}:haushalt`] as string;
        const buchungen = Object.values(konten()).flatMap((konto) => {
          const buch = fin("money-account", "cash_book", { plan_id: planId, money_account_id: konto });
          return ((buch?.days ?? []) as any[]).flatMap((d) => (d.rows ?? []) as any[]).map((r) => ({ ...r, konto, datum: r.booking_date }));
        });
        b = {
          posten: fin("plan-period", "positions", { plan_id: planId }) as any[],
          buchungen: buchungen.filter((r) => !r.transfer_id && r.reversal_of_journal_number == null),
          uebertraege: (fin("money-account", "transfers", { plan_id: planId }) as any[]).filter((t) => t.status !== "REVERSED"),
          belegt: new Set(Object.values(s).filter((v): v is string => typeof v === "string")),
        };
        bestand.set(jahr, b);
      }
      return b;
    };
    const uebernehmen = (x: Schritt): string | undefined => {
      const jahr = jahrDes(x.key);
      if (!fortsetzung.has(jahr) || x.key.startsWith("konto:")) return undefined;
      const b = bestandVon(jahr);
      const frei = <T extends { id?: string; entry_id?: string }>(liste: T[], passt: (e: T) => boolean) => {
        const e = liste.find((e) => !b.belegt.has(String(e.id ?? e.entry_id)) && passt(e));
        if (e) b.belegt.add(String(e.id ?? e.entry_id));
        return e ? String(e.id ?? e.entry_id) : undefined;
      };
      if (x.art === "posten") return frei(b.posten, (p) => p.name === x.name && p.position_number === x.nummer);
      if (x.art === "buchung") {
        return frei(b.buchungen, (r) => r.position_id === s[x.posten] && r.konto === konten()[x.konto] && r.description === x.text
          && r.datum === x.datum && (x.richtung === "revenue" ? r.revenue_cents : r.expense_cents) === x.cents);
      }
      if (x.art === "uebertrag") {
        return frei(b.uebertraege, (t) => t.from_account_id === konten()[x.von] && t.to_account_id === konten()[x.nach]
          && t.amount_cents === x.cents && t.reason === x.grund && t.transfer_date === x.datum);
      }
      return undefined;
    };

    for (const x of schritte) {
      if (x.key in s) continue;
      const vorhanden = uebernehmen(x);
      if (vorhanden) {
        merke(x.key, vorhanden);
        vermerke({ key: x.key, art: x.art, uebernommen: vorhanden });
        continue;
      }
      switch (x.art) {
        case "konto": {
          const da = (fin("money-account", "list") as any[]).find((a) => a.name === x.konto && !a.archived_at);
          merke(x.key, da?.id ?? fin("money-account", "create", { data: { name: x.konto, kind: x.kind, is_default: x.standard } }, x.key).id);
          break;
        }
        case "haushalt": {
          const wechsel = jahrVon(x.key).wechselgeld;
          if (wechsel.length) vermerke({ key: `${x.jahr}:wechselgeld`, art: "wechselgeld", eintraege: wechsel, hinweis: "zwischen den Teilspalten eines Kontos, nicht gebucht (§4.2b, DC-5)" });
          merke(`${x.key}:begonnen`, true);
          if (x.startkapital_cents !== null) {
            merke(x.key, fin("plan-period", "create", { data: { year: x.jahr, available_capital_cents: x.startkapital_cents, notes: `Übernahme aus Rechenschaftsbericht ${x.jahr}` } }, x.key).id);
          } else {
            fin("plan-lifecycle", "next_period", { plan_id: s[`${x.jahr - 1}:haushalt`], data: { include_non_recurring: false } }, x.key);
            const neu = (fin("plan-period", "list") as any[]).find((p) => p.year === x.jahr && !p.department_id);
            if (!neu) throw new LaufFehler(`next_period legte keinen Haushalt ${x.jahr} an.`);
            merke(x.key, neu.id);
          }
          break;
        }
        case "startkapital_pruefen": {
          // The capital next_period carries over must be the sum of the
          // derived openings — before the first booking (review R1-5).
          const p = (fin("plan-period", "list") as any[]).find((q) => q.id === plan(x.key));
          if (p?.available_capital_cents !== x.cents) {
            throw new LaufFehler(`Startkapital ${jahrDes(x.key)}: ${p?.available_capital_cents} ct, erwartet ${x.cents} ct (Summe der abgeleiteten Anfangsbestände).`);
          }
          fin("plan-period", "update", { plan_id: plan(x.key), data: { notes: `Übernahme aus Rechenschaftsbericht ${jahrDes(x.key)}` } }, x.key);
          merke(x.key, x.cents);
          break;
        }
        case "anfang":
          fin("money-account", "opening", { plan_id: plan(x.key), account_id: konten()[x.konto], data: {
            opening_date: `${jahrDes(x.key)}-01-01`, opening_balance_cents: x.cents, reason: `Übernahme aus Rechenschaftsbericht ${jahrDes(x.key)}` } }, x.key);
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
          merke(x.key, fin("plan-period", "update", { plan_id: plan(x.key), data: { status: "ACTIVE" } }, x.key).status);
          break;
        case "posten":
          merke(x.key, fin("plan-period", "position_create", { plan_id: plan(x.key), data: {
            name: x.name, category: x.rubrik, position_number: x.nummer, recurring: false,
            revenue_planned_cents: 0, expense_planned_cents: 0, context_type: "GENERAL",
            ...(x.sphaere ? { tax_sphere: x.sphaere, comment: "Sphäre: Vorschlag aus der Übernahme, vom Verein zu bestätigen" } : {}),
          } }, x.key).id);
          break;
        case "buchung":
          merke(x.key, fin("entry", "entry_create", { position_id: s[x.posten], data: {
            description: x.text, booking_date: x.datum, money_account_id: konten()[x.konto], notes: `Übernahme ${x.key}`,
            [x.richtung === "revenue" ? "revenue_cents" : "expense_cents"]: x.cents, receipt_exemption_reason: x.grund,
          } }, x.key).id);
          break;
        case "uebertrag":
          merke(x.key, fin("money-account", "transfer_create", { data: {
            from_account_id: konten()[x.von], to_account_id: konten()[x.nach], amount_cents: x.cents, transfer_date: x.datum, reason: x.grund } }, x.key).id);
          break;
        case "probe": {
          // End balance AND gross amounts per account: two duplicates that
          // cancel out still fail here (review R1-1).
          const j = jahrVon(x.key);
          const zeilen = fin("money-account", "reconciliation", { plan_id: plan(x.key) }).accounts as any[];
          const brutto = bruttoSoll(schritte, j.jahr);
          const werte: Array<Record<string, unknown>> = [];
          for (const k of j.konten) {
            const z = zeilen.find((a) => a.account.id === konten()[k.name]);
            const soll = brutto[k.name] ?? { ein: 0, aus: 0 };
            const ein = z?.period_revenue_cents ?? z?.revenue_cents ?? 0;
            const aus = z?.period_expense_cents ?? z?.expense_cents ?? 0;
            const ende = k.art === "IN_KIND" ? null : z?.period_end_balance_cents;
            const ok = ein === soll.ein && aus === soll.aus && (k.art === "IN_KIND" || ende === k.ende_cents);
            werte.push({ konto: k.name, ok, einnahmen: { soll: soll.ein, ist: ein }, ausgaben: { soll: soll.aus, ist: aus },
              ...(k.art === "IN_KIND" ? {} : { endbestand: { soll: k.ende_cents, ist: ende } }) });
          }
          vermerke({ key: x.key, art: "probe", werte });
          const falsch = werte.filter((w) => !w.ok);
          if (falsch.length) {
            throw new LaufFehler(`Probe ${j.jahr} nicht bestanden — der Haushalt bleibt ACTIVE: ${falsch.map((w) => `${w.konto} ${JSON.stringify({ einnahmen: w.einnahmen, ausgaben: w.ausgaben, endbestand: w.endbestand })}`).join("; ")}`);
          }
          merke(x.key, "bestanden");
          break;
        }
        case "auszug": {
          const y = jahrDes(x.key);
          const zeile = (fin("money-account", "reconciliation", { plan_id: plan(x.key) }).accounts as any[]).find((a) => a.account.id === konten()[x.konto]);
          // The opening goes along unchanged: only the statement is new.
          fin("money-account", "opening", { plan_id: plan(x.key), account_id: konten()[x.konto], data: {
            opening_date: zeile?.opening_date ?? `${y}-01-01`, opening_balance_cents: zeile?.opening_balance_cents ?? 0,
            statement_balance_cents: x.cents, statement_date: `${y}-12-31`, reason: `Auszug 31.12.${y} laut Vermögensübersicht` } }, x.key);
          merke(x.key, x.cents);
          break;
        }
        case "bericht": {
          const y = jahrDes(x.key);
          merke(x.key, fin("cash-report", "create", { data: { period_start: `${y}-01-01`, period_end: `${y}-12-31`, money_account_id: konten()[x.konto],
            notes: `Kassenprüfung ${y} laut Rechenschaftsbericht (Übernahme)` } }, x.key).id);
          break;
        }
        case "einreichen":
          fin("cash-report", "submit", { report_id: s[`${jahrDes(x.key)}:bericht:${x.konto}`] }, x.key);
          merke(x.key, true);
          break;
        case "freigabe": {
          // Four eyes: the booking person never approves — a second person
          // does, per cash report and for the few entries of the goods account.
          const y = jahrDes(x.key);
          const offen = () => pruefen(plan(x.key)).rules.find((r) => r.code === "ENTRY_NOT_APPROVED")?.findings ?? [];
          const berichte = jahrVon(x.key).konten.filter((k) => k.art !== "IN_KIND").map((k) => s[`${y}:bericht:${k.name}`] as string);
          if (offen().length && freigabe) {
            const fin2 = (area: string, op: string, input: object, schritt: string) => {
              const res = freigabe(["finance", "run", area, op, "--input", JSON.stringify(input), "--idempotency-key", schrittSchluessel(verein, schritt)]);
              if (res?.status && res.status !== "completed") throw new LaufFehler(`Freigabe ${area} ${op}: ${JSON.stringify(res).slice(0, 400)}`);
              return res?.result ?? res;
            };
            for (const bericht of berichte) {
              fin2("cash-report", "approve_entries", { report_id: bericht, data: { note: `Kassenprüfung ${y}` } }, `${x.key}:${bericht}:eintraege`);
              fin2("cash-report", "approve", { report_id: bericht, data: {} }, `${x.key}:${bericht}:bericht`);
            }
            for (const rest of offen()) {
              if (rest.entry_id) freigabe(["finance", "entry-approve", rest.entry_id, "--notes", `Kassenprüfung ${y}`, "--json"]);
            }
          }
          const bleibt = offen();
          if (bleibt.length) {
            throw new LaufWartet(`${y}: ${bleibt.length} Buchungen warten auf die Freigabe einer zweiten Person (Vier-Augen). `
              + `Kassenberichte ${berichte.join(", ")}: je „finance run cash-report approve_entries“, dann „approve“; `
              + `einzeln: ${bleibt.filter((b) => b.entry_id).slice(0, 5).map((b) => b.entry_id).join(", ")}${bleibt.length > 5 ? " …" : ""}. `
              + "Oder den Lauf mit --freigabe-profil <profil> einer angemeldeten zweiten Person fortsetzen.");
          }
          merke(x.key, "freigegeben");
          break;
        }
        case "pruefung": {
          // The audit gate before the close: every error and the notes an
          // import must fulfil hold the year open (a closed year changes no more).
          const bericht = pruefen(plan(x.key));
          const offen = bericht.rules.filter((r) => !r.fulfilled && (r.severity !== "NOTE" || PRUEFTOR_HINWEISE.has(r.code)));
          vermerke({ key: x.key, art: "pruefung", summary: bericht.summary, offen: offen.map((r) => ({ code: r.code, severity: r.severity, count: r.count, beispiel: r.findings[0]?.detail })) });
          if (offen.length) {
            throw new LaufWartet(`Prüfung ${jahrDes(x.key)} vor dem Abschluss: ${offen.map((r) => `${r.code} (${r.count || r.severity})`).join(", ")} — erst beheben, dann fortsetzen.`);
          }
          merke(x.key, bericht.summary);
          break;
        }
        case "abschluss": {
          const y = jahrDes(x.key);
          const p = (fin("plan-period", "list") as any[]).find((q) => q.id === plan(x.key));
          // Without force: every entry carries its approval, so the close needs none.
          if (p?.status !== "CLOSED") {
            fin("plan-lifecycle", "close", { plan_id: plan(x.key), force: false,
              note: `Übernahme aus Rechenschaftsbericht ${y}; Kassenprüfung und Freigabe erteilt` }, x.key);
          }
          merke(x.key, "geschlossen");
          break;
        }
        case "pruefung_nach": {
          const bericht = pruefen(plan(x.key));
          const fehler = bericht.rules.filter((r) => !r.fulfilled && r.severity !== "NOTE");
          vermerke({ key: x.key, art: "pruefung_nach", summary: bericht.summary, offen: fehler.map((r) => ({ code: r.code, count: r.count })) });
          if (fehler.length) throw new LaufFehler(`Prüfung des geschlossenen Jahres ${jahrDes(x.key)}: ${fehler.map((r) => r.code).join(", ")}`);
          merke(x.key, bericht.summary);
          break;
        }
      }
      vermerke({ key: x.key, art: x.art });
    }
    return protokoll;
  } catch (fehler) {
    // Every stop is on record before it propagates (review R1-6).
    vermerke(fehler instanceof LaufWartet ? { wartet: fehler.message } : { fehler: (fehler as Error).message });
    throw fehler;
  }
}

function argumente(argv: string[]): { dateien: string[]; verein?: string; vorschau: boolean; protokoll?: string; gates?: string; freigabeProfil?: string } {
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
    else if (a === "--freigabe-profil") out.freigabeProfil = wert(++i);
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
      const cliMit = (profil?: string): Cli => (a) => {
        const env = { ...process.env, ...(profil ? { COMVENIO_CLI_PROFILE: profil } : {}) };
        const p = Bun.spawnSync(["bun", "run", "src/index.ts", ...a], { cwd: cliDir, stdout: "pipe", stderr: "pipe", env });
        const out = p.stdout.toString().trim();
        if (p.exitCode !== 0) throw new LaufFehler(`CLI ${a.slice(0, 4).join(" ")} → exit ${p.exitCode}: ${(p.stderr.toString() || out).slice(0, 800)}`);
        return JSON.parse(out);
      };
      laufen(jahre, args.verein, cliMit(), protokoll, () => writeFileSync(ziel, JSON.stringify(protokoll, null, 2)),
        args.freigabeProfil ? cliMit(args.freigabeProfil) : undefined);
      console.log(`Übernahme abgeschlossen → ${ziel}`);
    }
  } catch (fehler) {
    if (fehler instanceof LaufWartet) {
      console.log(`Wartet: ${fehler.message}`);
      process.exit(3);
    }
    console.error(`Abbruch: ${(fehler as Error).message}`);
    process.exit(1);
  }
}
