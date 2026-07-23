import { describe, expect, test } from "bun:test";

import { normalizeFutureReminderAt } from "../src/commands/task.ts";


describe("task reminder CLI contract", () => {
  test("normalizes a future RFC-3339 timestamp", () => {
    expect(
      normalizeFutureReminderAt(
        "2026-08-01T12:30:00+02:00",
        Date.parse("2026-07-23T00:00:00Z"),
      ),
    ).toBe("2026-08-01T10:30:00.000Z");
  });

  test("rejects invalid and past timestamps before an API call", () => {
    expect(() => normalizeFutureReminderAt("invalid", 0)).toThrow(
      "RFC-3339",
    );
    expect(() => normalizeFutureReminderAt("2026-08-01", 0)).toThrow(
      "mit Zeitzone",
    );
    expect(() =>
      normalizeFutureReminderAt(
        "2026-07-22T12:00:00Z",
        Date.parse("2026-07-23T00:00:00Z"),
      ),
    ).toThrow("in der Zukunft");
  });
});
