// Mannschaftstermine 05 (3bf8c01d): comvenio teams termin.
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import {
  buildTerminCreateBody,
  explainTerminError,
  parseWeekdays,
  teamsExitCode,
  terminAction,
} from "../src/commands/teams.ts";
import { HttpError, type ComvenioClient } from "../src/http.ts";

type Call = { method: string; service: string; path: string; body?: unknown };

function recordingClient(result: unknown = {}, fail?: HttpError) {
  const calls: Call[] = [];
  const record = (method: string, service: string, path: string, body?: unknown) => {
    calls.push({ method, service, path, body });
    return fail ? Promise.reject(fail) : Promise.resolve(result as never);
  };
  const client: ComvenioClient = {
    get: (service, path) => record("GET", service, path),
    post: (service, path, body) => record("POST", service, path, body),
    patch: (service, path, body) => record("PATCH", service, path, body),
    put: (service, path, body) => record("PUT", service, path, body),
    del: (service, path) => record("DELETE", service, path),
    postForm: (service, path, body) => record("POST_FORM", service, path, body),
    service: (service, path) => record("GET", service, path),
  };
  return { client, calls };
}

const serviceError = (status: number, code: string) =>
  new HttpError(status, JSON.stringify({ detail: code }), "https://apidev.example/event/team-seasons/s-1/termine");

let printed = "";
const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
  printed += args.map(String).join(" ");
});
const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
afterEach(() => {
  printed = "";
  logSpy.mockClear();
  errSpy.mockClear();
});

describe("teams termin create (TC-01)", () => {
  test("a training series on Tuesday and Thursday posts one create with the weekdays", async () => {
    const { client, calls } = recordingClient({ event_id: "e-1", series_id: "ser-1", title: "Training" });
    await terminAction(client, "create", "s-1", undefined, {
      kind: "training", start: "2026-10-06T19:00", repeat: "di,do", location: "Platz 1", yes: true, json: true,
    });
    expect(calls).toEqual([{
      method: "POST", service: "event", path: "/team-seasons/s-1/termine",
      body: { kind: "TRAINING", start_time: "2026-10-06T19:00", location: "Platz 1", repeat: { weekdays: ["TU", "TH"] } },
    }]);
  });

  test("defaults to training and passes until, visibility and the general announcement", () => {
    expect(buildTerminCreateBody({ start: "2026-10-06T19:00", repeat: "mo", until: "2026-12-20", visibility: "PUBLIC", announce: true }))
      .toEqual({
        kind: "TRAINING", start_time: "2026-10-06T19:00", visibility: "public", announce_general: true,
        repeat: { weekdays: ["MO"], until: "2026-12-20" },
      });
    expect(buildTerminCreateBody({ start: "2026-10-06T19:00", announce: "nein" }).announce_general).toBe(false);
  });

  test("a match carries opponent and home role", () => {
    expect(buildTerminCreateBody({ kind: "spiel", start: "2026-10-10T15:00", opponent: "FC Muster", away: true }))
      .toEqual({ kind: "MATCH", start_time: "2026-10-10T15:00", opponent: "FC Muster", home_state: "AWAY" });
  });

  test("writes nothing without --yes", async () => {
    const { client, calls } = recordingClient();
    await terminAction(client, "create", "s-1", undefined, { start: "2026-10-06T19:00", json: true });
    expect(calls).toEqual([]);
    expect(printed).toContain("confirmation_required");
  });

  test("local input errors end with exit 2 before any request", async () => {
    const { client, calls } = recordingClient();
    for (const opts of [{}, { start: "x", kind: "turnier" }, { start: "x", repeat: "mo,xx" }, { start: "x", until: "2026-12-01" },
      { start: "x", home: true, away: true }, { start: "x", visibility: "MEMBERS" }]) {
      const err = await terminAction(client, "create", "s-1", undefined, { ...opts, yes: true }).catch((e) => e);
      expect(teamsExitCode(err)).toBe(2);
    }
    expect(calls).toEqual([]);
    expect(parseWeekdays("Di, do, di")).toEqual(["TU", "TH"]);
  });
});

describe("teams termin list (TC-01, DC-8)", () => {
  const rows = [
    { event_id: "m-1", title: "SV - FC", status: "confirmed", kind: "MATCH", source: "SYNC" },
    { event_id: "t-1", title: "Training", status: "confirmed", kind: "TRAINING", source: "MANUAL", series_id: "ser-1" },
  ];

  test("reads the season list and filters by kind", async () => {
    const { client, calls } = recordingClient(rows);
    await terminAction(client, "list", "s-1", undefined, { kind: "training", json: true });
    expect(calls).toEqual([{ method: "GET", service: "event", path: "/team-seasons/s-1/events", body: undefined }]);
    expect(JSON.parse(printed)).toEqual([rows[1]]);
  });

  test("an empty season prints a sentence and does not fail", async () => {
    const { client } = recordingClient([]);
    await terminAction(client, "list", "s-1", undefined, {});
    expect(printed).toContain("Keine Termine in dieser Saison.");
  });
});

describe("teams termin update, cancel, delete", () => {
  test("update sends only the changed fields and the scope", async () => {
    const { client, calls } = recordingClient({ event_id: "e-1", title: "Training" });
    await terminAction(client, "update", "s-1", "e-1", { start: "2026-10-07T19:00", scope: "following", yes: true, json: true });
    expect(calls).toEqual([{
      method: "PATCH", service: "event", path: "/team-seasons/s-1/termine/e-1",
      body: { start_time: "2026-10-07T19:00", scope: "FOLLOWING" },
    }]);
  });

  test("update refuses kind and repetition changes", async () => {
    const { client, calls } = recordingClient();
    const err = await terminAction(client, "update", "s-1", "e-1", { kind: "spiel", yes: true }).catch((e) => e);
    expect(teamsExitCode(err)).toBe(2);
    expect(calls).toEqual([]);
  });

  test("cancel posts scope and reason", async () => {
    const { client, calls } = recordingClient({ event_id: "e-1", title: "Training" });
    await terminAction(client, "cancel", "s-1", "e-1", { reason: "Platz gesperrt", yes: true, json: true });
    expect(calls[0]).toEqual({
      method: "POST", service: "event", path: "/team-seasons/s-1/termine/e-1/cancel",
      body: { scope: "THIS", reason: "Platz gesperrt" },
    });
  });

  test("delete names the scope in the query", async () => {
    const { client, calls } = recordingClient();
    await terminAction(client, "delete", "s-1", "e-1", { scope: "series", yes: true, json: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/team-seasons/s-1/termine/e-1?scope=SERIES" });
    const err = await terminAction(client, "delete", "s-1", "e-1", { scope: "following", yes: true }).catch((e) => e);
    expect(teamsExitCode(err)).toBe(2);
  });
});

describe("service errors become sentences (TC-02, TC-03)", () => {
  test("a match without opponent: sentence with code, exit 2", async () => {
    const { client } = recordingClient(undefined, serviceError(422, "TERMIN_MATCH_NEEDS_OPPONENT"));
    const err = await terminAction(client, "create", "s-1", undefined, { kind: "spiel", start: "2026-10-10T15:00", yes: true })
      .catch((e) => e);
    expect(err.message).toContain("Ein Spiel braucht einen Gegner");
    expect(err.message).toContain("(TERMIN_MATCH_NEEDS_OPPONENT)");
    expect(teamsExitCode(err)).toBe(2);
  });

  test("without season right: sentence with code, exit 3", async () => {
    const { client } = recordingClient(undefined, serviceError(403, "SEASON_MANAGER_REQUIRED"));
    const err = await terminAction(client, "create", "s-1", undefined, { start: "2026-10-06T19:00", yes: true }).catch((e) => e);
    expect(err.message).toContain("Saisonrecht");
    expect(teamsExitCode(err)).toBe(3);
  });

  test("started termin and taken slot keep their exit code 4", () => {
    for (const code of ["TERMIN_ALREADY_STARTED", "TERMIN_SLOT_TAKEN"]) {
      const err = explainTerminError(serviceError(409, code)) as Error;
      expect(err.message).toContain(`(${code})`);
      expect(teamsExitCode(err)).toBe(4);
    }
  });

  test("unknown bodies pass unchanged", () => {
    const raw = new HttpError(500, "<html>oops</html>", "u");
    expect(explainTerminError(raw)).toBe(raw);
    const pydantic = new HttpError(422, JSON.stringify({ detail: [{ loc: ["body", "start_time"] }] }), "u");
    expect(explainTerminError(pydantic)).toBe(pydantic);
  });
});
