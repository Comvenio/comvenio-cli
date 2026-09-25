import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBelege } from "../src/commands/finance-connector.ts";
import type { CliConnectorClient } from "../src/mcp/client.ts";

// buchhaltung-16-02 TC-05: `comvenio finance belege` lädt Belege über den
// Connector, prüft die Prüfsumme und nennt jede Buchung ohne Datei.

const PLAN = "55555555-5555-4555-8555-555555555555";
const PDF = Buffer.from("%PDF-1.7 Beleg");

function datei(bytes: Buffer, content_type = "application/pdf") {
  return { content_type, size_bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), content_base64: bytes.toString("base64") };
}

const SEITE_1 = { rows: [
  { journal_number: 1, booking_date: "2025-03-01", entry_id: "e1", has_receipt: true },
  { journal_number: 2, booking_date: "2025-03-02", entry_id: "e2", has_receipt: false, receipt_exemption_reason: "Kassenbon verloren", receipt_state: "SELF_ISSUED" },
], next_after: 2 };
const SEITE_2 = { rows: [
  { journal_number: 3, booking_date: "2025-03-03", entry_id: "e3", has_receipt: true },
  { journal_number: 4, booking_date: "2025-03-04", entry_id: "e4", has_receipt: false, reversal_of_journal_number: 1 },
], next_after: null };

function client(aufrufe: JsonLike[], kaputt = new Set<string>()): CliConnectorClient {
  return {
    async callAction(input: { input: JsonLike; idempotency_key?: string }) {
      aufrufe.push(input.input);
      const op = input.input.operation;
      if (op === "list") return { result: [{ id: PLAN, year: 2025, department_id: null }] };
      if (op === "journal") return { result: input.input.after_journal_number === 2 ? SEITE_2 : SEITE_1 };
      if (op === "receipt_file") {
        if (kaputt.has(input.input.entry_id as string)) throw new Error("receipt_forbidden: refused");
        return { result: input.input.entry_id === "e3" ? datei(Buffer.from("JPEG"), "image/jpeg") : datei(PDF) };
      }
      throw new Error(`unerwartet: ${String(op)}`);
    },
  } as unknown as CliConnectorClient;
}

describe("finance belege", () => {
  test("ein Beleg: Datei mit geprüfter Prüfsumme, nie überschrieben", async () => {
    const ordner = mkdtempSync(join(tmpdir(), "belege-"));
    try {
      const pfad = join(ordner, "beleg.pdf");
      const antwort = await runBelege(client([]), { out: pfad }, "e1");
      expect(readFileSync(pfad).equals(PDF)).toBe(true);
      expect(antwort.sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
      await expect(runBelege(client([]), { out: pfad }, "e1")).rejects.toThrow(/nichts überschrieben/);
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
  });

  test("ein Jahr: alle Seiten, jede Buchung mit Zustand in belege.csv, nur lesend", async () => {
    const ordner = mkdtempSync(join(tmpdir(), "belege-"));
    const aufrufe: JsonLike[] = [];
    try {
      const antwort = await runBelege(client(aufrufe), { year: "2025", out: ordner });
      expect(antwort).toMatchObject({ plan_id: PLAN, entries: 4, downloaded: 2, failed: 0 });
      expect(existsSync(join(ordner, "1_2025-03-01.pdf")) && existsSync(join(ordner, "3_2025-03-03.jpg"))).toBe(true);
      const csv = readFileSync(join(ordner, "belege.csv"), "utf-8").trim().split("\n");
      expect(csv[0]).toBe("journal;datum;buchung;datei;sha256;zustand");
      expect(csv[2]).toBe("2;2025-03-02;e2;;;Eigenbeleg: Kassenbon verloren");
      expect(csv[4]).toBe("4;2025-03-04;e4;;;Storno von 1");
      expect(aufrufe.filter((a) => a.operation === "journal").map((a) => a.after_journal_number)).toEqual([undefined, 2]);
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
  });

  test("vorhandene Dateien bleiben, ein Fehler steht im Verzeichnis und setzt Exit 1", async () => {
    const ordner = mkdtempSync(join(tmpdir(), "belege-"));
    const vorher = process.exitCode;
    try {
      writeFileSync(join(ordner, "1_2025-03-01.pdf"), "alt");
      const antwort = await runBelege(client([], new Set(["e3"])), { year: "2025", out: ordner });
      expect(readFileSync(join(ordner, "1_2025-03-01.pdf"), "utf-8")).toBe("alt");
      expect(antwort).toMatchObject({ downloaded: 0, failed: 1 });
      const csv = readFileSync(join(ordner, "belege.csv"), "utf-8");
      expect(csv).toContain("vorhanden, abweichend von der Quelle");
      expect(csv).toContain(createHash("sha256").update("alt").digest("hex"));
      expect(csv).toContain("Fehler: receipt_forbidden: refused");
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(ordner, { recursive: true, force: true });
      process.exitCode = vorher;
    }
  });

  test("ein vorhandenes belege.csv wird nicht überschrieben", async () => {
    const ordner = mkdtempSync(join(tmpdir(), "belege-"));
    try {
      writeFileSync(join(ordner, "belege.csv"), "alt");
      await expect(runBelege(client([]), { year: "2025", out: ordner })).rejects.toThrow(/nichts überschrieben/);
      expect(readFileSync(join(ordner, "belege.csv"), "utf-8")).toBe("alt");
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
  });

  test("ohne --out nennt der Befehl, was fehlt", async () => {
    await expect(runBelege(client([]), { year: "2025" })).rejects.toThrow(/--out/);
  });
});

type JsonLike = Record<string, unknown>;
