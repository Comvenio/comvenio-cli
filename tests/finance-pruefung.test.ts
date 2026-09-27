import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderPruefbericht, runPruefung } from "../src/commands/finance-connector.ts";
import type { CliConnectorClient } from "../src/mcp/client.ts";

// buchhaltung-16-03 TC-08: `comvenio finance pruefung` schreibt den Bericht
// aus der Antwort des Dienstes — Regeln rechnet das CLI nicht nach.

const PLAN_2025 = "55555555-5555-4555-8555-555555555555";
const ERGEBNIS = {
  plan_id: PLAN_2025, year: 2025, status: "CLOSED", period_start: "2025-01-01", period_end: "2025-12-31",
  checked_at: "2026-09-25T15:00:00Z", checked_by: "11111111-1111-4111-8111-111111111111", entry_count: 3,
  rules: [
    { code: "JOURNAL_GAP", requirement: "B-04", severity: "ERROR", fulfilled: false, count: 1, detail: null,
      findings: [{ journal_number: 2, date: null, detail: "Journalnummer fehlt" }] },
    { code: "CASH_NEGATIVE", requirement: "B-12", severity: "ERROR", fulfilled: true, count: 0, detail: "keine Kasse geführt", findings: [] },
    { code: "SPHERE_MISSING", requirement: "B-11", severity: "CHECK_FAILED", fulfilled: true, count: 0, detail: "Quelle nicht verfügbar: club_service_unavailable", findings: [] },
  ],
  summary: { errors: 1, notes: 0, check_failed: 1 },
};

function client(calls: unknown[]): CliConnectorClient {
  return {
    async callAction(input: { input: { operation: string } }) {
      calls.push(input);
      if (input.input.operation === "list") {
        return { result: [
          { id: "department-plan", year: 2025, department_id: "dept" },
          { id: PLAN_2025, year: 2025, department_id: null },
        ] };
      }
      return { result: ERGEBNIS };
    },
  } as unknown as CliConnectorClient;
}

describe("finance pruefung", () => {
  test("wählt den Vereinsplan des Jahres und fragt audit_check nur lesend", async () => {
    const calls: { input: JsonLike; idempotency_key?: string }[] = [];
    const vorher = process.exitCode;
    const ergebnis = await runPruefung(client(calls as unknown[]), { year: "2025" });
    expect(ergebnis.plan_id).toBe(PLAN_2025);
    expect(calls[1]!.input).toEqual({ operation: "audit_check", plan_id: PLAN_2025 });
    expect(calls.every((call) => call.idempotency_key === undefined)).toBe(true);
    expect(process.exitCode).toBe(1);  // one error, one rule not checkable
    process.exitCode = vorher;
  });

  test("schreibt Markdown und JSON mit Fundstellen", async () => {
    const ordner = mkdtempSync(join(tmpdir(), "pruefung-"));
    const vorher = process.exitCode;
    try {
      const basis = join(ordner, "pruefung-2025");
      const antwort = await runPruefung(client([]), { year: "2025", out: basis });
      expect(antwort.written).toEqual([`${basis}.md`, `${basis}.json`]);
      const md = readFileSync(`${basis}.md`, "utf-8");
      expect(md).toContain("# Prüfdurchlauf 2025");
      expect(md).toContain("| Journalnummern lückenlos | B-04 | ERROR | 1 Befund(e) |");
      expect(md).toContain("| Kasse nie unter null | B-12 | ERROR | erfüllt (keine Kasse geführt) |");
      expect(md).toContain("nicht prüfbar: Quelle nicht verfügbar: club_service_unavailable");
      expect(md).toContain("| 2 |  | Journalnummer fehlt |  |");
      expect(JSON.parse(readFileSync(`${basis}.json`, "utf-8")).summary.errors).toBe(1);
    } finally {
      rmSync(ordner, { recursive: true, force: true });
      process.exitCode = vorher;
    }
  });

  test("ohne Vereinsplan des Jahres nennt der Befehl das Jahr", async () => {
    await expect(runPruefung(client([]), { year: "2019" })).rejects.toThrow(/2019/);
  });

  test("mehrere Vereinspläne im Jahr: der Befehl wählt nicht still, eine Plan-ID entscheidet", async () => {
    const zwei = {
      async callAction(input: { input: { operation: string; plan_id?: string } }) {
        if (input.input.operation === "list") {
          return { result: [{ id: "a", year: 2025, department_id: null, period_start: "2025-01-01", period_end: "2025-06-30" },
                            { id: "b", year: 2025, department_id: null, period_start: "2025-07-01", period_end: "2026-06-30" }] };
        }
        return { result: { ...ERGEBNIS, plan_id: input.input.plan_id } };
      },
    } as unknown as CliConnectorClient;
    await expect(runPruefung(zwei, { year: "2025" })).rejects.toThrow(/2 Vereinspläne.*a \(2025-01-01/);
    const vorher = process.exitCode;
    expect((await runPruefung(zwei, {}, "b")).plan_id).toBe("b");
    process.exitCode = vorher;
  });

  test("Fundstellen und Zeilenumbrüche im Bericht", () => {
    const md = renderPruefbericht({ ...ERGEBNIS, rules: [{ ...ERGEBNIS.rules[0]!, findings: [
      { journal_number: null, detail: "zwei\nZeilen", position_id: "p-1", money_account_id: "k-1" }] }] }, 2025);
    expect(md).toContain("| zwei Zeilen | Posten p-1, Konto k-1 |");
  });

  test("ein senkrechter Strich im Detail bricht die Tabelle nicht", () => {
    const md = renderPruefbericht({ ...ERGEBNIS, rules: [{ ...ERGEBNIS.rules[0]!, findings: [{ journal_number: 1, detail: "A | B" }] }] }, 2025);
    expect(md).toContain(String.raw`A \| B`);
  });
});

// buchhaltung-16-04: „Haushaltsjahr geprüft“ im Kopf und --kennzeichnen.
describe("finance pruefung — Haushaltsjahr geprüft", () => {
  const SAUBER = { ...ERGEBNIS, rules: [], summary: { errors: 0, notes: 2, check_failed: 0 } };
  const LABEL = { id: "l-1", labeled_at: "2026-09-27T08:00:00Z", labeled_by: "11111111-1111-4111-8111-111111111111", note: "Kassenprüfung" };

  function mit(ergebnis: JsonLike, calls: { input: JsonLike; idempotency_key?: string }[], current: JsonLike | null = null) {
    return {
      async callAction(input: { input: JsonLike; idempotency_key?: string }) {
        calls.push(input);
        const op = input.input.operation;
        if (op === "list") return { result: [{ id: PLAN_2025, year: 2025, department_id: null }] };
        if (op === "audit_labels") return { result: { current, history: current ? [current] : [] } };
        if (op === "audit_label_set") return { result: LABEL };
        return { result: ergebnis };
      },
    } as unknown as CliConnectorClient;
  }

  test("der Kopf nennt ein gültiges Label, sonst „nein“", () => {
    expect(renderPruefbericht({ ...SAUBER, audit_label: LABEL }, 2025))
      .toContain("- Haushaltsjahr geprüft: ja, am 2026-09-27T08:00:00Z von 11111111-1111-4111-8111-111111111111 (Kassenprüfung)");
    expect(renderPruefbericht(SAUBER, 2025)).toContain("- Haushaltsjahr geprüft: nein");
  });

  test("ohne --kennzeichnen wird das Label nur gelesen", async () => {
    const calls: { input: JsonLike; idempotency_key?: string }[] = [];
    const ergebnis = await runPruefung(mit(SAUBER, calls, LABEL), { year: "2025" });
    expect(calls.map((c) => c.input.operation)).toEqual(["list", "audit_check", "audit_labels"]);
    expect(calls.every((c) => c.idempotency_key === undefined)).toBe(true);
    expect((ergebnis.audit_label as JsonLike).id).toBe("l-1");
  });

  test("--kennzeichnen setzt das Label schreibend mit Notiz", async () => {
    const calls: { input: JsonLike; idempotency_key?: string }[] = [];
    const ergebnis = await runPruefung(mit(SAUBER, calls), { year: "2025", kennzeichnen: true, notes: "Kassenprüfung", confirm: false });
    const setzen = calls.find((c) => c.input.operation === "audit_label_set")!;
    expect(setzen.input).toEqual({ operation: "audit_label_set", plan_id: PLAN_2025, note: "Kassenprüfung" });
    expect(typeof setzen.idempotency_key).toBe("string");
    expect((ergebnis.audit_label as JsonLike).id).toBe("l-1");
  });

  test("--kennzeichnen verweigert ein laufendes oder fehlerhaftes Jahr, ohne zu schreiben", async () => {
    const calls: { input: JsonLike; idempotency_key?: string }[] = [];
    const vorher = process.exitCode;
    await expect(runPruefung(mit({ ...SAUBER, status: "ACTIVE" }, calls), { year: "2025", kennzeichnen: true }))
      .rejects.toThrow(/abgeschlossenes Jahr/);
    await expect(runPruefung(mit(ERGEBNIS, calls), { year: "2025", kennzeichnen: true })).rejects.toThrow(/Fehler/);
    expect(calls.some((c) => c.input.operation === "audit_label_set")).toBe(false);
    process.exitCode = vorher;
  });

  test("ein nicht lesbares Label steht im Bericht, der Durchlauf bleibt", async () => {
    const kaputt = {
      async callAction(input: { input: JsonLike }) {
        if (input.input.operation === "list") return { result: [{ id: PLAN_2025, year: 2025, department_id: null }] };
        if (input.input.operation === "audit_labels") throw new Error("503");
        return { result: SAUBER };
      },
    } as unknown as CliConnectorClient;
    const ergebnis = await runPruefung(kaputt, { year: "2025" });
    expect(String(ergebnis.audit_label)).toContain("nicht lesbar (503)");
  });
});

type JsonLike = Record<string, unknown>;
