// Warning line for device tokens during the deadline (geraetetoken-abbau-05 §4.6).
import { describe, expect, test } from "bun:test";

import type { StoredComvenioCliState } from "../src/auth.ts";
import { formatSunsetDate, sunsetWarningLine, warnDeviceTokenSunset } from "../src/device-sunset.ts";

const NOW = new Date("2026-10-10T12:00:00Z");
const SUNSET = "2026-10-29T00:00:00Z";

function state(device?: Partial<NonNullable<StoredComvenioCliState["device"]>>): StoredComvenioCliState {
  return {
    schemaVersion: 3,
    gatewayBaseUrl: "https://gateway.example",
    environment: "prod",
    ...(device ? { device: { token: "cvn_test", ...device } } : {}),
  };
}

function run(stored: StoredComvenioCliState, opts: { command?: string; fetched?: string | null; env?: NodeJS.ProcessEnv } = {}) {
  const lines: string[] = [];
  const remembered: Array<[string, string]> = [];
  let fetches = 0;
  const done = warnDeviceTokenSunset(opts.command ?? "event list", "de", {
    now: () => NOW,
    env: opts.env ?? {},
    readState: () => stored,
    remember: (s, c) => remembered.push([s, c]),
    fetchSunset: async () => {
      fetches += 1;
      return opts.fetched === undefined ? SUNSET : opts.fetched;
    },
    write: (line) => lines.push(line),
  });
  return done.then(() => ({ lines, remembered, fetches }));
}

describe("device token warning line", () => {
  test("formats the date as TT.MM.JJJJ in UTC", () => {
    expect(formatSunsetDate("2026-10-29T00:00:00Z")).toBe("29.10.2026");
    expect(sunsetWarningLine(SUNSET, "de")).toBe("Dein Geräte-Token läuft am 29.10.2026 aus — stell auf comvenio login um.");
    expect(sunsetWarningLine(SUNSET, "en")).toBe("Your device token expires on 29.10.2026 — switch to comvenio login.");
  });

  test("reads the deadline once and keeps it for a day", async () => {
    const first = await run(state({}));
    expect(first.fetches).toBe(1);
    expect(first.remembered).toEqual([[SUNSET, NOW.toISOString()]]);
    expect(first.lines).toEqual(["Dein Geräte-Token läuft am 29.10.2026 aus — stell auf comvenio login um.\n"]);

    const cached = await run(state({ sunsetAt: SUNSET, sunsetCheckedAt: "2026-10-10T00:00:00Z" }));
    expect(cached.fetches).toBe(0);
    expect(cached.lines.length).toBe(1);
  });

  test("asks again after a day and falls back to the cached date when the status fails", async () => {
    const stale = await run(state({ sunsetAt: SUNSET, sunsetCheckedAt: "2026-10-08T00:00:00Z" }), { fetched: null });
    expect(stale.fetches).toBe(1);
    expect(stale.remembered).toEqual([]);
    expect(stale.lines.length).toBe(1);
  });

  test("no line without a device token, with a machine grant, for login or without a date", async () => {
    expect((await run(state())).lines).toEqual([]);
    expect((await run(state({}), { env: { COMVENIO_CLIENT_ID: "cvg_client_x" } })).lines).toEqual([]);
    expect((await run(state({}), { command: "login" })).lines).toEqual([]);
    expect((await run(state({}), { fetched: null })).lines).toEqual([]);
  });

  test("a broken state never turns into an error", async () => {
    await warnDeviceTokenSunset("event list", "de", {
      readState: () => { throw new Error("no state"); },
      write: () => { throw new Error("must not write"); },
    });
  });
});
