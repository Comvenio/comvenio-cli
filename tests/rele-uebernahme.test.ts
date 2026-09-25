import { describe, expect, test } from "bun:test";

import { type Cli, LaufFehler, laufen, planen, pruefeGate, type Uebernahme } from "../scripts/rele/uebernahme.ts";

// buchhaltung-14-04 §4.2: the run over a finance service kept in memory —
// synthetic years 2031/2032, no club data.

const SVM = "9ea9d95a-0c79-4efb-b873-696fc07cfd96";
const DEV = "476bc619-ddb4-4693-bbe6-45936fa4f47e";

const JAHR_1: Uebernahme = {
  jahr: 2031,
  konten: [
    { name: "Barkasse", art: "CASH", standard: false, anfang_cents: 10000, ende_cents: 12000 },
    { name: "Girokonto", art: "BANK", standard: true, anfang_cents: 200000, ende_cents: 331000 },
    { name: "Sachwerte", art: "IN_KIND", standard: false, anfang_cents: 0, ende_cents: null },
  ],
  kategorien: [
    { zeile: 3, text: "Mitgliedsbeiträge", seite: "E", rubrik: "Mitglieder", sphaere: "IDEELL", betraege: { Girokonto: 100000 } },
    { zeile: 4, text: "Sommerfest", seite: "E", rubrik: "Veranstaltungen", sphaere: "WIRTSCHAFTLICH", betraege: { Barkasse: 50000 } },
    { zeile: 7, text: "Sachspenden", seite: "E", rubrik: "Sachspenden", sphaere: "IDEELL", betraege: { Sachwerte: 5000 } },
    { zeile: 11, text: "Wareneinkauf", seite: "A", rubrik: "Veranstaltungen", sphaere: "WIRTSCHAFTLICH", betraege: { Barkasse: 15000, Girokonto: 5000 } },
    { zeile: 12, text: "Rückerstattung Verband", seite: "A", rubrik: "Verwaltung", sphaere: "IDEELL", betraege: { Girokonto: -3000 } },
    { zeile: 13, text: "Verbrauch Sachspenden", seite: "A", rubrik: "Sportbetrieb", sphaere: "IDEELL", betraege: { Sachwerte: 5000 } },
  ],
  transit: [{ von: "Barkasse", nach: "Girokonto", betrag_cents: 30000 }],
  wechselgeld: [],
  korrektur: { abweichung: { Barkasse: -3000, Girokonto: 3000 }, uebertraege: [{ von: "Barkasse", nach: "Girokonto", betrag_cents: 3000 }] },
  stichtagsdifferenzen: [],
  einnahmen_cents: 155000, ausgaben_cents: 22000, ergebnis_cents: 100000,
};
// 2032 starts 0,86 € below the end of 2031 on the bank account (§4.2b).
const JAHR_2: Uebernahme = {
  jahr: 2032,
  konten: [
    { name: "Barkasse", art: "CASH", standard: false, anfang_cents: 12000, ende_cents: 12000 },
    { name: "Girokonto", art: "BANK", standard: true, anfang_cents: 330914, ende_cents: 340914 },
    { name: "Sachwerte", art: "IN_KIND", standard: false, anfang_cents: 0, ende_cents: null },
  ],
  kategorien: [
    { zeile: 3, text: "Mitgliedsbeiträge", seite: "E", rubrik: "Mitglieder", sphaere: "IDEELL", betraege: { Girokonto: 10000 } },
  ],
  transit: [], wechselgeld: [],
  korrektur: { abweichung: {}, uebertraege: [] },
  stichtagsdifferenzen: [{ konto: "Girokonto", betrag_cents: -86 }],
  einnahmen_cents: 10000, ausgaben_cents: 0, ergebnis_cents: 10000,
};

/** A finance service with just what the run needs. */
function dienst(club = DEV) {
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const plaene: any[] = [];
  const konten: any[] = [];
  const posten: Record<string, string> = {};
  const buchungen: Array<{ plan: string; konto: string; rev: number; exp: number; datum: string; text: string }> = [];
  const anfang: Record<string, any> = {};
  const aufrufe: string[][] = [];
  const planVon = (jahr: number) => plaene.find((p) => p.year === jahr)?.id as string;
  const abgleich = (plan: string) => ({
    accounts: konten.map((k) => {
      const o = anfang[`${plan}:${k.id}`] ?? { opening_balance_cents: 0 };
      const eigene = buchungen.filter((b) => b.plan === plan && b.konto === k.id);
      const rev = eigene.reduce((s, b) => s + b.rev, 0);
      const exp = eigene.reduce((s, b) => s + b.exp, 0);
      return { account: k, opening_date: o.opening_date, opening_balance_cents: o.opening_balance_cents, revenue_cents: rev, expense_cents: exp,
        period_end_balance_cents: k.kind === "IN_KIND" ? null : o.opening_balance_cents + rev - exp };
    }),
  });
  const cli: Cli = (args) => {
    aufrufe.push(args);
    if (args[0] === "whoami") return { clubId: club };
    const [, , area, op, , roh] = args;
    const i = JSON.parse(roh ?? "{}");
    const r = (result: unknown) => ({ status: "completed", result });
    switch (`${area} ${op}`) {
      case "plan-period list": return r(plaene);
      case "plan-period create": { const p = { id: id("plan"), year: i.data.year, status: "DRAFT", department_id: null }; plaene.push(p); return r(p); }
      case "plan-period update": { const p = plaene.find((x) => x.id === i.plan_id); Object.assign(p, i.data); return r(p); }
      case "plan-lifecycle next_period": {
        const alt = plaene.find((x) => x.id === i.plan_id);
        const p = { id: id("plan"), year: alt.year + 1, status: "DRAFT", department_id: null };
        plaene.push(p);
        // D20: the new plan starts where the old one ended.
        for (const z of abgleich(alt.id).accounts) if (z.account.kind !== "IN_KIND") anfang[`${p.id}:${z.account.id}`] = { opening_date: `${p.year}-01-01`, opening_balance_cents: z.period_end_balance_cents };
        return r(p);
      }
      case "plan-lifecycle close": { const p = plaene.find((x) => x.id === i.plan_id); p.status = "CLOSED"; p.force = i.force; return r(p); }
      case "plan-period position_create": { const pid = id("pos"); posten[pid] = i.plan_id; return r({ id: pid }); }
      case "money-account list": return r(konten);
      case "money-account create": { const k = { id: id("konto"), name: i.data.name, kind: i.data.kind }; konten.push(k); return r(k); }
      case "money-account opening": anfang[`${i.plan_id}:${i.account_id}`] = i.data; return r(i.data);
      case "money-account reconciliation": return r(abgleich(i.plan_id));
      case "money-account transfer_create": {
        const plan = planVon(Number(i.data.transfer_date.slice(0, 4)));
        buchungen.push({ plan, konto: i.data.from_account_id, rev: 0, exp: i.data.amount_cents, datum: i.data.transfer_date, text: i.data.reason });
        buchungen.push({ plan, konto: i.data.to_account_id, rev: i.data.amount_cents, exp: 0, datum: i.data.transfer_date, text: i.data.reason });
        return r({ id: id("uebertrag") });
      }
      case "entry entry_create":
        buchungen.push({ plan: posten[i.position_id] as string, konto: i.data.money_account_id, rev: i.data.revenue_cents ?? 0, exp: i.data.expense_cents ?? 0, datum: i.data.booking_date, text: i.data.description });
        return r({ id: id("buchung") });
      default: throw new Error(`Unbekannt im Testdienst: ${area} ${op}`);
    }
  };
  return { cli, plaene, buchungen, aufrufe, konten };
}

const neu = (verein = DEV) => ({ verein, schritte: {} as Record<string, unknown>, ereignisse: [] as Array<Record<string, unknown>> });

describe("Übernahme: Vorschau", () => {
  test("TC-04 die Vorschau plant alles aus den Dateien und ruft nichts auf", () => {
    const schritte = planen([JAHR_2, JAHR_1]);
    expect(schritte.filter((s) => s.art === "konto").map((s) => (s as any).konto)).toEqual(["Barkasse", "Girokonto", "Sachwerte"]);
    // 2031: seven entries (one line on two accounts); 2032: one plus the balance-day difference.
    expect(schritte.filter((s) => s.art === "buchung").length).toBe(9);
    expect(schritte.filter((s) => s.art === "uebertrag").map((s) => (s as any).grund)).toEqual([
      "Geldtransit laut Rechenschaftsbericht 2031", "Übernahmekorrektur 2031: Bestand laut Vermögensübersicht",
    ]);
    // Income before expenses before transfers, within a year.
    const arten = schritte.filter((s) => s.key.startsWith("2031:") && (s.art === "buchung" || s.art === "uebertrag"))
      .map((s) => (s.art === "buchung" ? s.richtung : "uebertrag"));
    expect(arten.join(" ")).toMatch(/^(revenue )+(expense )+(uebertrag ?)+$/);
  });

  test("eine Gutschrift in einer Ausgabenzeile wird Einnahme desselben Postens", () => {
    const gutschrift = planen([JAHR_1]).find((s) => s.key === "2031:buchung:12:Girokonto") as any;
    expect([gutschrift.richtung, gutschrift.cents, gutschrift.posten]).toEqual(["revenue", 3000, "2031:posten:12"]);
  });

  test("Jahre mit Lücke brechen ab", () => {
    expect(() => planen([JAHR_1, { ...JAHR_2, jahr: 2033 }])).toThrow(/folgen nicht aufeinander/);
  });
});

describe("Übernahme: Gate", () => {
  const manifest = `gates:\n  - id: club-restriction\n    exceptions:\n      - id: sv-motzing-finanz-uebernahme-lesen\n        club_id: ${SVM}   # SV Motzing\n        allow: [lesen]\n`;

  test("TC-08 ohne Ausnahme kein Aufruf", () => {
    expect(() => pruefeGate(SVM, "gates: []", false)).toThrow(/keine Ausnahme/);
  });

  test("TC-08 eine Leseausnahme trägt keinen Buchungslauf", () => {
    expect(() => pruefeGate(SVM, manifest, false)).not.toThrow();
    expect(() => pruefeGate(SVM, manifest, true)).toThrow(/fehlt „schreiben“/);
    expect(() => pruefeGate(SVM, manifest.replace("[lesen]", "[lesen, schreiben]"), true)).not.toThrow();
  });

  test("der Comvenio-Verein braucht keine Ausnahme", () => {
    expect(() => pruefeGate(DEV, "", true)).not.toThrow();
  });
});

describe("Übernahme: Lauf", () => {
  test("TC-05 zwei Jahre: Probe je Geldkonto, Sachwerte nach Summen, beide Haushalte geschlossen", () => {
    const d = dienst();
    const p = laufen([JAHR_1, JAHR_2], DEV, d.cli, neu(), () => {});
    expect(d.plaene.map((x) => [x.year, x.status, x.force])).toEqual([[2031, "CLOSED", true], [2032, "CLOSED", true]]);
    expect(p.schritte["2031:probe"]).toBe("bestanden");
    expect(p.schritte["2032:probe"]).toBe("bestanden");
  });

  test("TC-11 eine benannte Stichtagsdifferenz wird zum 1.1. als Übernahmedifferenz gebucht", () => {
    const d = dienst();
    laufen([JAHR_1, JAHR_2], DEV, d.cli, neu(), () => {});
    const diff = d.buchungen.filter((b) => b.text.startsWith("Übernahmedifferenz"));
    expect(diff.map((b) => [b.datum, b.exp])).toEqual([["2032-01-01", 86]]);
  });

  test("TC-11 dieselbe Differenz ohne Eintrag bricht vor der ersten Buchung des Jahres ab", () => {
    const d = dienst();
    expect(() => laufen([JAHR_1, { ...JAHR_2, stichtagsdifferenzen: [] }], DEV, d.cli, neu(), () => {}))
      .toThrow(/Girokonto: abgeleiteter Anfangsbestand 331000 ct, laut Bericht 330914 ct/);
    expect(d.buchungen.some((b) => b.datum.startsWith("2032"))).toBe(false);
  });

  test("TC-06 ein fremder Haushalt des Jahres bricht ab, bevor etwas gebucht wird", () => {
    const d = dienst();
    d.plaene.push({ id: "fremd", year: 2031, status: "ACTIVE", department_id: null });
    expect(() => laufen([JAHR_1], DEV, d.cli, neu(), () => {})).toThrow(/schon ein Haushalt \(fremd\)/);
    expect(d.buchungen).toEqual([]);
  });

  test("ein zweiter Lauf mit dem eigenen Protokoll setzt fort und bucht nichts doppelt", () => {
    const d = dienst();
    const p = neu();
    laufen([JAHR_1], DEV, d.cli, p, () => {});
    const anzahl = d.buchungen.length;
    laufen([JAHR_1], DEV, d.cli, p, () => {});
    expect(d.buchungen.length).toBe(anzahl);
  });

  test("die Anmeldung muss auf dem Verein stehen", () => {
    const d = dienst("0ec34e70-999a-47c4-a1b1-bdb293110fa5");
    expect(() => laufen([JAHR_1], DEV, d.cli, neu(), () => {})).toThrow(/Anmeldung steht auf 0ec34e70/);
    expect(d.aufrufe).toEqual([["whoami", "--json"]]);
  });

  test("eine nicht bestandene Probe lässt den Haushalt aktiv", () => {
    const d = dienst();
    const falsch = { ...JAHR_1, korrektur: { abweichung: {}, uebertraege: [] } };
    expect(() => laufen([falsch], DEV, d.cli, neu(), () => {})).toThrow(/Probe 2031 nicht bestanden .* Barkasse: Endbestand 15000 ct, laut Vermögensübersicht 12000 ct/);
    expect(d.plaene[0].status).toBe("ACTIVE");
  });
});
