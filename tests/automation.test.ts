import { describe, expect, test } from "bun:test";
import cac from "cac";

import {
  buildCreateBody,
  buildUpdateBody,
  explainAutomationError,
  formatAutomationList,
  formatRunLine,
  parseTrigger,
  registerAutomationCommands,
  resolveAutomationCommand,
} from "../src/commands/automation.ts";
import { HttpError } from "../src/http.ts";

const ID = "3f2b9c1e-8d4a-4b6f-9a1c-2e7d5f0b8a61";
const DEPT = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

describe("comvenio automation (Automatisierungen 04 §4)", () => {
  test("`automation create` with its options reaches the command", () => {
    const cli = cac("comvenio");
    registerAutomationCommands(cli);
    cli.parse(["bun", "comvenio", "automation", "create", "--function", "weekly_preview.create", "--schedule", "weekly:FR:17:00"], { run: false });
    expect(cli.matchedCommandName).toBe("automation");
    expect(cli.args).toEqual(["create"]);
    expect(cli.options.function).toBe("weekly_preview.create");
  });

  test("actions and ids are checked before any API call", () => {
    expect(resolveAutomationCommand("list", undefined)).toEqual({ action: "list" });
    expect(resolveAutomationCommand("run", ID)).toEqual({ action: "run", target: ID });
    expect(() => resolveAutomationCommand("run", "abc")).toThrow("UUID");
    expect(() => resolveAutomationCommand("list", ID)).toThrow("kein Ziel");
    expect(() => resolveAutomationCommand("start", ID)).toThrow("list, show, create");
  });

  test("schedules read like the web dialog", () => {
    expect(parseTrigger("weekly:fr:17:00", undefined, undefined)).toEqual({
      type: "schedule", rrule: "FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0", timezone: "Europe/Berlin",
    });
    expect(parseTrigger("daily:07:05", undefined, "Europe/Vienna")).toEqual({
      type: "schedule", rrule: "FREQ=DAILY;BYHOUR=7;BYMINUTE=5", timezone: "Europe/Vienna",
    });
    expect(parseTrigger("manual", undefined, undefined)).toEqual({ type: "manual" });
    expect(parseTrigger(undefined, "FREQ=WEEKLY;BYDAY=MO;BYHOUR=7", undefined)).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=7" });
    expect(parseTrigger(undefined, undefined, undefined)).toBeUndefined();
    expect(() => parseTrigger("weekly:XX:17:00", undefined, undefined)).toThrow("Wochentag");
    expect(() => parseTrigger("daily:25:00", undefined, undefined)).toThrow("Uhrzeit");
    expect(() => parseTrigger("monthly", undefined, undefined)).toThrow("weekly:FR:17:00");
  });

  test("TC-06: create builds the body the route takes", () => {
    expect(buildCreateBody({
      function: "weekly_preview.create", name: " Wochenvorschau Fußball ", schedule: "weekly:FR:17:00",
      department: DEPT, args: `{"department_id":"${DEPT}"}`, approval: "objection_window", objectionHours: "4",
    })).toEqual({
      kind: "club", name: "Wochenvorschau Fußball", capability_id: "weekly_preview.create",
      args: { department_id: DEPT },
      trigger: { type: "schedule", rrule: "FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0", timezone: "Europe/Berlin" },
      department_id: DEPT, approval_mode: "objection_window", objection_hours: 4,
    });
    expect(() => buildCreateBody({ name: "x", schedule: "manual" })).toThrow("--function");
    expect(() => buildCreateBody({ function: "task.create", schedule: "manual" })).toThrow("--name");
    expect(() => buildCreateBody({ function: "task.create", name: "x" })).toThrow("--schedule");
    expect(() => buildCreateBody({ function: "task.create", name: "x", schedule: "manual", kind: "team" })).toThrow("--kind");
    expect(() => buildCreateBody({ function: "task.create", name: "x", schedule: "manual", approval: "maybe" })).toThrow("--approval");
    expect(() => buildCreateBody({ function: "task.create", name: "x", schedule: "manual", objectionHours: 72 })).toThrow("1–48");
  });

  test("update sends only the changes with the server's version", () => {
    expect(buildUpdateBody({ schedule: "daily:06:30" }, 7)).toEqual({
      expected_version: 7, trigger: { type: "schedule", rrule: "FREQ=DAILY;BYHOUR=6;BYMINUTE=30", timezone: "Europe/Berlin" },
    });
    expect(() => buildUpdateBody({}, 7)).toThrow("mindestens eine Änderung");
  });

  test("TC-06: a refusal of the service reads as a sentence and fails the command", () => {
    const forbidden = new HttpError(403, JSON.stringify({ detail: "automation_forbidden" }), "https://x/automations/c");
    const explained = explainAutomationError(forbidden) as Error;
    expect(explained).toBeInstanceOf(Error);
    expect(explained.message).toContain("Nur Verwalter dieses Bereichs");
    expect(explained.message).toContain("HTTP 403 automation_forbidden");
    const invalid = explainAutomationError(new HttpError(422, JSON.stringify({ detail: "invalid_args", field: "range" }), "u")) as Error;
    expect(invalid.message).toContain("Feld: range");
    // Anything unknown stays the original error (exit code 3 with its body).
    const other = new HttpError(500, "boom", "u");
    expect(explainAutomationError(other)).toBe(other);
  });

  test("TC-07: list and run read like the web", () => {
    expect(formatAutomationList([])).toBe("Keine Automatisierungen.");
    const text = formatAutomationList([{
      id: ID, kind: "club", name: "Wochenvorschau Verein", capability_id: "weekly_preview.create", args: {},
      trigger: { type: "schedule", rrule: "FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0", timezone: "Europe/Berlin" },
      output: {}, approval_mode: "click", enabled: true, paused_reason: null, next_run_at: "2026-10-02T15:00:00+00:00", version: 1,
    }]);
    expect(text).toContain("Wochenvorschau Verein [Verein]");
    expect(text).toContain("nächster Lauf 2026-10-02 15:00 · aktiv");
    expect(formatRunLine({ id: "r1", automation_id: ID, trigger_type: "manual", state: "running", created_at: "2026-09-27T14:00:00Z" }))
      .toBe("2026-09-27 14:00  manual: läuft  r1");
  });
});
