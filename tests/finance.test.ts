// Routenvertrag des finance-Befehls.
//
// Die Pfade hier sind aus den Routern des finance-service gelesen, nicht
// geraten — und genau das prüft diese Datei: dass jede Aktion den Pfad trifft,
// den der Dienst wirklich anbietet. Die Prefixe sind uneinheitlich
// (`finance_plans` hängt unter `/clubs`, `booking_entries` hat gar keinen),
// und ein falscher Pfad fällt sonst erst im Betrieb als 404 auf.
import { describe, expect, test } from "bun:test";

import {
  handleFinanceOperation,
  renderHuman,
  type FinanceCommandOpts,
} from "../src/commands/finance.ts";
import type { ComvenioClient } from "../src/http.ts";

type Call = { method: string; service: string; path: string; body?: unknown };

function recordingClient(result: unknown = {}): { client: ComvenioClient; calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string, service: string, path: string, body?: unknown) => {
    calls.push({ method, service, path, body });
    return Promise.resolve(result as never);
  };
  return {
    calls,
    client: {
      get: (service, path) => record("GET", service, path),
      post: (service, path, body) => record("POST", service, path, body),
      patch: (service, path, body) => record("PATCH", service, path, body),
      put: (service, path, body) => record("PUT", service, path, body),
      del: (service, path) => record("DELETE", service, path),
      postForm: (service, path, body) => record("POST_FORM", service, path, body),
      service: (service, path) => record("GET", service, path),
    },
  };
}

async function run(
  action: string,
  id: string | undefined,
  opts: FinanceCommandOpts = {},
): Promise<Call[]> {
  const { client, calls } = recordingClient();
  await handleFinanceOperation({ action, id, opts, client, clubId: "club-1" });
  return calls;
}

async function fehler(
  action: string,
  id: string | undefined,
  opts: FinanceCommandOpts = {},
): Promise<string> {
  try {
    await run(action, id, opts);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`${action} hätte einen Fehler werfen müssen.`);
}

describe("finance CLI route contracts", () => {
  test("der Jahresplan hängt unter /clubs, die Buchungen nicht", async () => {
    expect(await run("plan-list", undefined)).toEqual([
      { method: "GET", service: "finance", path: "/clubs/club-1/finance-plans", body: undefined },
    ]);
    expect(await run("plan-show", undefined, { year: "2026" })).toEqual([
      { method: "GET", service: "finance", path: "/clubs/club-1/finance-plans/2026", body: undefined },
    ]);
    // Kein /clubs davor — booking_entries hat keinen Router-Prefix.
    expect(await run("entry-show", "entry-1")).toEqual([
      { method: "GET", service: "finance", path: "/entries/entry-1", body: undefined },
    ]);
    expect(await run("position-show", "pos-1")).toEqual([
      { method: "GET", service: "finance", path: "/positions/pos-1", body: undefined },
    ]);
  });

  test("Lebenszyklus des Plans trifft die eigenen Endpunkte", async () => {
    expect(await run("plan-close", undefined, { year: "2026" })).toEqual([
      { method: "POST", service: "finance", path: "/clubs/club-1/finance-plans/2026/close", body: undefined },
    ]);
    expect(await run("plan-reopen", undefined, { year: "2026" })).toEqual([
      { method: "POST", service: "finance", path: "/clubs/club-1/finance-plans/2026/reopen", body: undefined },
    ]);
    // Die Quelle ist das Argument, das Ziel steht in --year.
    expect(await run("plan-copy", "2025", { year: "2026" })).toEqual([
      { method: "POST", service: "finance", path: "/clubs/club-1/finance-plans/2026/copy-from/2025", body: undefined },
    ]);
  });

  test("Positionen hängen am Plan, die Zusammenfassung optional an der Abteilung", async () => {
    expect(await run("position-list", undefined, { year: "2026" })).toEqual([
      { method: "GET", service: "finance", path: "/clubs/club-1/finance-plans/2026/positions", body: undefined },
    ]);
    expect(await run("position-list", undefined, { year: "2026", department: "dep-1" })).toEqual([
      {
        method: "GET",
        service: "finance",
        path: "/clubs/club-1/finance-plans/2026/positions?department_id=dep-1",
        body: undefined,
      },
    ]);
    expect(await run("summary", undefined, { year: "2026" })).toEqual([
      { method: "GET", service: "finance", path: "/clubs/club-1/finance-plans/2026/summary", body: undefined },
    ]);
    // Mit Abteilung ist es ein ANDERER Endpunkt, kein Filter.
    expect(await run("summary", undefined, { year: "2026", department: "dep-1" })).toEqual([
      { method: "GET", service: "finance", path: "/clubs/club-1/finance-plans/2026/summary/dep-1", body: undefined },
    ]);
  });

  test("Buchungen hängen an der Position, die Freigabe an der Buchung", async () => {
    expect(await run("entry-list", "pos-1")).toEqual([
      { method: "GET", service: "finance", path: "/positions/pos-1/entries", body: undefined },
    ]);
    expect(await run("entry-list", "pos-1", { sourceType: "supply" })).toEqual([
      { method: "GET", service: "finance", path: "/positions/pos-1/entries?source_type=supply", body: undefined },
    ]);
    expect(await run("entry-approve", "entry-1")).toEqual([
      { method: "POST", service: "finance", path: "/entries/entry-1/approve", body: undefined },
    ]);
    expect(await run("entry-delete", "entry-1")).toEqual([
      { method: "DELETE", service: "finance", path: "/entries/entry-1", body: undefined },
    ]);
  });
});

describe("finance CLI: was der Mensch eingibt", () => {
  test("Optionen bauen den Rumpf, ohne dass eine Datei nötig wäre", async () => {
    expect(await run("plan-create", undefined, { year: "2026", capital: "500000", notes: "Haushalt" })).toEqual([
      {
        method: "POST",
        service: "finance",
        path: "/clubs/club-1/finance-plans",
        body: { year: 2026, available_capital_cents: 500000, notes: "Haushalt" },
      },
    ]);
    expect(await run("position-create", undefined, { year: "2026", name: "Sommerfest", expense: "120000" })).toEqual([
      {
        method: "POST",
        service: "finance",
        path: "/clubs/club-1/finance-plans/2026/positions",
        body: { name: "Sommerfest", expense_planned_cents: 120000 },
      },
    ]);
  });

  test("eine Buchung ist Einnahme ODER Ausgabe — beides und keines wird abgelehnt", async () => {
    // Das XOR steht im Dienst (BookingEntryCreate.xor_amount). Hier vorher zu
    // prüfen heisst: ein Satz statt eines 422 aus dem Netz.
    expect(await fehler("entry-create", "pos-1", { description: "x", date: "2026-07-01" }))
      .toContain("Genau eines von --revenue und --expense");
    expect(await fehler("entry-create", "pos-1", { description: "x", revenue: "100", expense: "200", date: "2026-07-01" }))
      .toContain("Genau eines von --revenue und --expense");
    expect(await fehler("entry-create", "pos-1", { description: "x", expense: "0", date: "2026-07-01" }))
      .toContain("grösser als null");

    expect(await run("entry-create", "pos-1", { description: "Getränke", expense: "4550", date: "2026-07-01" })).toEqual([
      {
        method: "POST",
        service: "finance",
        path: "/positions/pos-1/entries",
        body: { description: "Getränke", expense_cents: 4550, booking_date: "2026-07-01" },
      },
    ]);
  });

  test("Cent-Angaben müssen ganze Zahlen sein", async () => {
    // 45,50 € sind 4550 — wer 45.50 tippt, meint Euro und bekäme sonst
    // klaglos eine Buchung über 45 Cent.
    expect(await fehler("entry-create", "pos-1", { description: "x", expense: "45.50", date: "2026-07-01" }))
      .toContain("ganze Zahl in Cent");
  });

  test("das Jahr wird geprüft, nicht durchgereicht", async () => {
    expect(await fehler("plan-show", undefined)).toContain("--year");
    expect(await fehler("plan-show", undefined, { year: "26" })).toContain("Jahreszahl zwischen 1900 und 2200");
    expect(await fehler("plan-show", undefined, { year: "zweitausend" })).toContain("Jahreszahl");
  });

  test("fehlende Kennungen nennen, worum es geht", async () => {
    expect(await fehler("entry-approve", undefined)).toContain("Buchungs-ID");
    expect(await fehler("position-show", undefined)).toContain("Positions-ID");
    expect(await fehler("entry-list", undefined)).toContain("Positions-ID");
  });

  test("eine unbekannte Aktion zählt auf, was es gibt", async () => {
    const meldung = await fehler("plan-loeschen", undefined);
    expect(meldung).toContain("Unbekannte finance-Aktion");
    expect(meldung).toContain("plan-close");
    expect(meldung).toContain("entry-approve");
  });
});

describe("finance CLI: Ausgabe für Menschen", () => {
  test("Cent werden zu Euro, fehlende Werte zu einem Strich", () => {
    const text = renderHuman("plan-show", {
      year: 2026,
      status: "OPEN",
      available_capital_cents: 500000,
      notes: null,
      id: "plan-1",
    });
    expect(text).toContain("5.000,00");
    expect(text).toContain("Finanzplan 2026 [OPEN]");
    expect(text).toContain("Notiz: —");
  });

  test("eine Buchung zeigt Einnahme oder Ausgabe, nicht beides", () => {
    const ausgabe = renderHuman("entry-show", {
      booking_date: "2026-07-01",
      description: "Getränke",
      status: "PENDING",
      expense_cents: 4550,
      revenue_cents: null,
      id: "e1",
    });
    expect(ausgabe).toContain("Ausgabe: ");
    expect(ausgabe).not.toContain("Einnahme: ");

    const einnahme = renderHuman("entry-show", {
      booking_date: "2026-07-01",
      description: "Spende",
      status: "APPROVED",
      revenue_cents: 10000,
      expense_cents: null,
      id: "e2",
    });
    expect(einnahme).toContain("Einnahme: ");
  });
});
