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
      expect(md).toContain("| 2 |  | Journalnummer fehlt |");
      expect(JSON.parse(readFileSync(`${basis}.json`, "utf-8")).summary.errors).toBe(1);
    } finally {
      rmSync(ordner, { recursive: true, force: true });
      process.exitCode = vorher;
    }
  });

  test("ohne Vereinsplan des Jahres nennt der Befehl das Jahr", async () => {
    await expect(runPruefung(client([]), { year: "2019" })).rejects.toThrow(/2019/);
  });

  test("ein senkrechter Strich im Detail bricht die Tabelle nicht", () => {
    const md = renderPruefbericht({ ...ERGEBNIS, rules: [{ ...ERGEBNIS.rules[0]!, findings: [{ journal_number: 1, detail: "A | B" }] }] }, 2025);
    expect(md).toContain(String.raw`A \| B`);
  });
});

type JsonLike = Record<string, unknown>;
