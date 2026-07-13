import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  handleMeetingOperation,
  humanDateTime,
  type MeetingCommandOpts,
} from "../src/commands/meeting.ts";
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
  opts: MeetingCommandOpts = {},
): Promise<Call[]> {
  const { client, calls } = recordingClient();
  await handleMeetingOperation({ action, id, opts, client, clubId: "club-1" });
  return calls;
}

describe("meeting CLI route contracts", () => {
  test("maps series and protocol lifecycle to their distinct backend routers", async () => {
    expect(await run("series-list", undefined)).toEqual([
      { method: "GET", service: "meeting", path: "/meetings/by_club/club-1", body: undefined },
    ]);
    expect(await run("protocol-advance", "protocol-1")).toEqual([
      { method: "POST", service: "meeting", path: "/protocol-management/protocol-1/advance-phase", body: undefined },
    ]);
    expect(await run("protocol-validation", "protocol-1")).toEqual([
      { method: "GET", service: "meeting", path: "/protocol-validation/protocols/protocol-1/validation-status", body: undefined },
    ]);
  });

  test("passes carry-over protocol context as a query for agenda status changes", async () => {
    expect(await run("agenda-complete", "top-1", { protocol: "protocol-2" })).toEqual([
      {
        method: "POST",
        service: "meeting",
        path: "/agenda-management/top-1/complete?protocol_id=protocol-2",
        body: undefined,
      },
    ]);
  });

  test("uses the canonical votes router for club-admin voting workflows", async () => {
    expect(await run("voting-results", "decision-1")).toEqual([
      { method: "GET", service: "meeting", path: "/votes/decision-1/results", body: undefined },
    ]);
    expect(await run("voting-close", "decision-1")).toEqual([
      { method: "POST", service: "meeting", path: "/votes/decision-1/close", body: undefined },
    ]);
    expect(await run("voting-tally", "decision-1", {
      option: "option-1",
      count: "-1",
      increment: true,
    })).toEqual([
      {
        method: "POST",
        service: "meeting",
        path: "/votes/decision-1/offline-tally/option-1?count=-1&increment=true",
        body: undefined,
      },
    ]);
    expect(await run("vote-option-retract", "decision-1", { option: "option-1" })).toEqual([
      {
        method: "DELETE",
        service: "meeting",
        path: "/votes/decision-1/option/option-1",
        body: undefined,
      },
    ]);
  });

  test("maps decision promotion and protocol update filters to query parameters", async () => {
    expect(await run("decision-promote", "decision-1", { number: "2026-007" })).toEqual([
      {
        method: "POST",
        service: "meeting",
        path: "/decisions/decision-1/promote-to-resolution?resolution_number=2026-007",
        body: undefined,
      },
    ]);
    expect(await run("protocol-updates", "protocol-1", {
      since: "2026-07-13T19:30:00+02:00",
    })).toEqual([
      {
        method: "GET",
        service: "meeting",
        path: "/protocol-management/protocol-1/updates?since=2026-07-13T19%3A30%3A00%2B02%3A00",
        body: undefined,
      },
    ]);
  });

  test("rejects an invalid offline tally before issuing a request", async () => {
    expect(run("voting-tally", "decision-1", {
      option: "option-1",
      count: "1.5",
    })).rejects.toThrow("ganze-zahl");
  });

  test("builds resolution filters with the backend parameter names", async () => {
    const calls = await run("resolution-list", undefined, {
      department: "department-1",
      category: "Finanzen",
      includeExpired: true,
    });
    expect(calls[0]?.path).toBe(
      "/resolutions/?club_id=club-1&department_id=department-1&category=Finanzen&valid_only=false",
    );
  });

  test("reads complex protocol-entry payloads from a JSON file and uses PUT", async () => {
    const file = join(import.meta.dir, "fixtures", "meeting-entry.json");
    expect(await run("entry-update", "entry-1", { file })).toEqual([
      {
        method: "PUT",
        service: "meeting",
        path: "/protocol-entries/entry-1",
        body: { content: "Finaler Protokolltext", is_ai_generated: false },
      },
    ]);
  });

  test("renders started_at as a human date and time", () => {
    const rendered = humanDateTime("2026-07-13T19:30:00");
    expect(rendered).toContain("13.07.26");
    expect(rendered).toContain("19:30");
    expect(humanDateTime(undefined)).toBe("—");
  });
});
