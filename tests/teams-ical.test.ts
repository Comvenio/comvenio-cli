import { describe, expect, test } from "bun:test";

import { icalAction } from "../src/commands/teams.ts";
import type { ComvenioClient } from "../src/http.ts";

type Call = { method: string; service: string; path: string; body?: unknown };

function recordingClient(result: unknown = { masked_url: "https://neu.example.org/…", status: "INACTIVE" }) {
  const calls: Call[] = [];
  const record = (method: string, service: string, path: string, body?: unknown) => {
    calls.push({ method, service, path, body });
    return Promise.resolve(result as never);
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

describe("teams ical update (Bug 00ca7f53)", () => {
  test("patches the subscription URL after confirmation", async () => {
    const { client, calls } = recordingClient();
    await icalAction(client, "update", "sub-1", { url: "https://neu.example.org/team.ics", yes: true, json: true });
    expect(calls).toEqual([
      { method: "PATCH", service: "event", path: "/calendar-subscriptions/sub-1", body: { url: "https://neu.example.org/team.ics" } },
    ]);
  });

  test("writes nothing without --yes", async () => {
    const { client, calls } = recordingClient();
    await icalAction(client, "update", "sub-1", { url: "https://neu.example.org/team.ics", json: true });
    expect(calls).toEqual([]);
  });

  test("needs --url", async () => {
    const { client } = recordingClient();
    await expect(icalAction(client, "update", "sub-1", { yes: true })).rejects.toThrow("--url");
  });
});
