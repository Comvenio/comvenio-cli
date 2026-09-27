import { describe, expect, test } from "bun:test";

import { callFinance, checkClubChoice, FINANCE_AREAS, findConfirmation, mapClassic } from "../src/commands/finance-connector.ts";
import type { CliConnectorClient } from "../src/mcp/client.ts";

// `comvenio finance` über die OAuth-Anmeldung: die klassischen Befehle auf
// die Connector-Aktionen, der Verein nie in der Eingabe, kritische Schritte
// bestätigt der Befehl selbst.

describe("finance über OAuth: Zuordnung", () => {
  test("entry-create bucht über den Hub, mit Geldkonto und Eigenbeleg-Begründung", () => {
    const call = mapClassic("entry-create", "22222222-2222-4222-8222-222222222222", {
      description: "Getränke Sommerfest", expense: "4550", date: "2026-07-01",
      account: "99999999-9999-4999-8999-999999999999", receiptReason: "Kassenbon verloren, Betrag laut Liste",
    });
    expect(call.actionId).toBe("cai.finance.25.entry_correction");
    expect(call.input).toEqual({
      operation: "entry_create",
      position_id: "22222222-2222-4222-8222-222222222222",
      data: {
        description: "Getränke Sommerfest", expense_cents: 4550, booking_date: "2026-07-01",
        money_account_id: "99999999-9999-4999-8999-999999999999", receipt_exemption_reason: "Kassenbon verloren, Betrag laut Liste",
      },
    });
    expect(call.write).toBe(true);
  });

  test("keine Eingabe trägt den Verein — er kommt aus dem OAuth-Grant", () => {
    for (const [action, id] of [["plan-list", undefined], ["plan-show", undefined], ["summary", undefined], ["position-show", "x"], ["entry-show", "x"]] as const) {
      const call = mapClassic(action, id, { year: "2026" });
      expect(JSON.stringify(call.input)).not.toContain("club_id");
    }
  });

  test("eine Buchung braucht genau eine Richtung", () => {
    expect(() => mapClassic("entry-create", "p", { description: "x", date: "2026-01-01" })).toThrow(/Genau eines/);
  });

  test("plan-reopen nennt den Weg statt still zu scheitern", () => {
    expect(() => mapClassic("plan-reopen", undefined, { year: "2026", reason: "Nachtrag" })).toThrow(/Plattformrolle/);
  });

  test("unbekannte Aktion verweist auf finance run", () => {
    expect(() => mapClassic("kassenbuch", undefined, {})).toThrow(/finance run/);
    expect(Object.keys(FINANCE_AREAS)).toContain("audit-export");
  });
});

describe("finance über OAuth: Vereinswahl", () => {
  const grant = "0ec34e70-999a-47c4-a1b1-bdb293110fa5";

  test("--club eines anderen Vereins scheitert, statt still den Verein der Anmeldung zu lesen", () => {
    expect(() => checkClubChoice("9ea9d95a-0c79-4efb-b873-696fc07cfd96", grant)).toThrow(/wirkt unter der OAuth-Anmeldung nicht/);
  });

  test("ohne bekannten Verein der Anmeldung zählt --club nie als bestätigt", () => {
    expect(() => checkClubChoice(grant, undefined)).toThrow(/unbekannt/);
  });

  test("ohne --club oder mit dem Verein der Anmeldung läuft der Befehl", () => {
    expect(() => checkClubChoice(undefined, grant)).not.toThrow();
    expect(() => checkClubChoice(grant, grant)).not.toThrow();
  });
});

describe("finance über OAuth: Bestätigung", () => {
  test("findet preview_id und confirmation_token im Widget", () => {
    const widget = { confirmation: { confirm_action: { input: { preview_id: "p-1", confirmation_token: "t".repeat(43), idempotency_key: "k" } } } };
    expect(findConfirmation(widget)).toEqual({ preview_id: "p-1", confirmation_token: "t".repeat(43) });
    expect(findConfirmation({ status: "completed", result: {} })).toBeNull();
  });

  test("ein kritischer Schritt wird mit demselben Idempotenz-Schlüssel bestätigt", async () => {
    const calls: Array<{ kind: string; key?: string }> = [];
    const client = {
      async callAction(input: { idempotency_key?: string }) {
        calls.push({ kind: "call", key: input.idempotency_key });
        return { widget: { preview_id: "p-1", confirmation_token: "t".repeat(43) } };
      },
      async confirm(input: { idempotency_key: string }) {
        calls.push({ kind: "confirm", key: input.idempotency_key });
        return { status: "completed" };
      },
    } as unknown as CliConnectorClient;
    const result = await callFinance(client, "cai.finance.22.plan_lifecycle", { operation: "close", plan_id: "x" }, { write: true });
    expect(result).toEqual({ status: "completed" });
    expect(calls.map((call) => call.kind)).toEqual(["call", "confirm"]);
    expect(calls[0]?.key).toBe(calls[1]?.key!);
  });

  test("ein mitgegebener Schlüssel gilt für Aufruf und Bestätigung — ein Wiederholungslauf wirkt nicht doppelt", async () => {
    const keys: Array<string | undefined> = [];
    const client = {
      async callAction(input: { idempotency_key?: string }) {
        keys.push(input.idempotency_key);
        return { widget: { preview_id: "p-1", confirmation_token: "t".repeat(43) } };
      },
      async confirm(input: { idempotency_key: string }) {
        keys.push(input.idempotency_key);
        return { status: "completed" };
      },
    } as unknown as CliConnectorClient;
    const key = "5f0c1a2b-3c4d-5e6f-8a9b-0c1d2e3f4a5b";
    await callFinance(client, "cai.finance.24.money_account", { operation: "transfer_create" }, { write: true, key });
    expect(keys).toEqual([key, key]);
    // Reads never carry one.
    await callFinance(client, "cai.finance.24.money_account", { operation: "list" }, { write: false, key });
    expect(keys[2]).toBeUndefined();
  });

  test("das Token aus _meta (comvenio/confirmation) wird zur Bestätigung benutzt", async () => {
    // Shape of the PROD answer on 2026-09-23: the widget itself carries no token.
    const calls: string[] = [];
    const client = {
      async callAction() {
        calls.push("call");
        return { widget: "confirmation", data: { preview: { preview_id: "p-1" } }, confirmation: { preview_id: "p-1", confirmation_token: "t".repeat(43), idempotency_key: "k" } };
      },
      async confirm(input: { preview_id: string; confirmation_token: string }) {
        calls.push(`confirm ${input.preview_id}`);
        return { status: "completed" };
      },
    } as unknown as CliConnectorClient;
    expect(await callFinance(client, "cai.finance.22.plan_lifecycle", { operation: "close" }, { write: true })).toEqual({ status: "completed" });
    expect(calls).toEqual(["call", "confirm p-1"]);
  });

  test("ein Bestätigungs-Widget ohne Token gilt nie als erledigt", async () => {
    const client = {
      async callAction() { return { widget: "confirmation", data: { preview: { preview_id: "p-1" } } }; },
      async confirm() { throw new Error("darf nicht bestätigt werden"); },
    } as unknown as CliConnectorClient;
    await expect(callFinance(client, "cai.finance.22.plan_lifecycle", { operation: "close" }, { write: true })).rejects.toThrow(/Bestätigungs-Token/);
  });

  test("--no-confirm hält vor der Bestätigung an", async () => {
    const client = {
      async callAction() { return { widget: { preview_id: "p-1", confirmation_token: "t".repeat(43) } }; },
      async confirm() { throw new Error("darf nicht bestätigt werden"); },
    } as unknown as CliConnectorClient;
    const result = await callFinance(client, "cai.finance.22.plan_lifecycle", { operation: "close" }, { write: true, confirm: false });
    expect(result.confirmation_required).toBe(true);
  });
});

describe("Beleg-Eingang über das CLI (belegerfassung-01/-03)", () => {
  const scan = "33333333-3333-4333-8333-333333333333";
  test("liste, anzeigen und Kandidaten lesen über finance_views", () => {
    expect(mapClassic("beleg-liste", undefined, { status: "all" })).toEqual({
      actionId: "cai.finance.31.finance_views", input: { operation: "receipt_inbox", status: "all" }, write: false });
    expect(mapClassic("beleg-kandidaten", scan, {}).input).toEqual({ operation: "receipt_candidates", scan_id: scan });
  });

  test("buchen verlangt Posten, Datum und genau einen Betrag", () => {
    const call = mapClassic("beleg-buchen", scan, {
      position: "22222222-2222-4222-8222-222222222222", expense: "45900", date: "2026-07-01",
      account: "99999999-9999-4999-8999-999999999999", description: "Getränke Maifest",
    });
    expect(call).toEqual({ actionId: "cai.finance.25.entry_correction", write: true, input: {
      operation: "receipt_book", scan_id: scan, data: {
        position_id: "22222222-2222-4222-8222-222222222222", money_account_id: "99999999-9999-4999-8999-999999999999",
        booking_date: "2026-07-01", amount_cents: 45900, direction: "EXPENSE", description: "Getränke Maifest" } } });
    expect(() => mapClassic("beleg-buchen", scan, { date: "2026-07-01", expense: "1" })).toThrow("--position");
    expect(() => mapClassic("beleg-buchen", scan, { position: "p", date: "2026-07-01", expense: "1", revenue: "1" })).toThrow("Genau eines");
    expect(mapClassic("beleg-buchen", scan, { position: "p", date: "2026-07-01", revenue: "500" }).input.data).toMatchObject({ direction: "REVENUE", amount_cents: 500 });
  });

  test("anhängen braucht die Buchung, ablehnen trägt den Grund", () => {
    expect(() => mapClassic("beleg-anhaengen", scan, {})).toThrow("--entry");
    expect(mapClassic("beleg-anhaengen", scan, { entry: "e" }).input).toEqual({ operation: "receipt_attach", scan_id: scan, data: { entry_id: "e" } });
    expect(mapClassic("beleg-ablehnen", scan, { reason: "doppelt" }).input).toEqual({ operation: "receipt_reject", scan_id: scan, data: { reason: "doppelt" } });
  });
});
