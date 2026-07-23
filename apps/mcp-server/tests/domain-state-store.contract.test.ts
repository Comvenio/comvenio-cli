import { describe, expect, test } from "bun:test";
import type IORedis from "ioredis";

import {
  confirmationMatchHash,
  InMemoryDomainStateStore,
  RedisDomainStateStore,
} from "../src/domain-state-store.ts";

describe("shared MCP domain state contract", () => {
  test("consumes a matching confirmation exactly once", async () => {
    const store = new InMemoryDomainStateStore();
    const matchHash = confirmationMatchHash(
      "actor-1",
      "club-1",
      "capability-v1",
      "token-1",
    );

    expect(await store.putConfirmation(
      "event",
      "preview-1",
      { match_hash: matchHash, action_id: "events.update" },
      60_000,
    )).toBe(true);
    expect(await store.consumeConfirmation(
      "event",
      "preview-1",
      confirmationMatchHash("wrong"),
    )).toBeNull();
    expect(await store.consumeConfirmation(
      "event",
      "preview-1",
      matchHash,
    )).toEqual({
      match_hash: matchHash,
      action_id: "events.update",
    });
    expect(await store.consumeConfirmation(
      "event",
      "preview-1",
      matchHash,
    )).toBeNull();
  });

  test("expires confirmations without consuming unrelated state", async () => {
    let now = 1_000;
    const store = new InMemoryDomainStateStore(() => now);
    const first = confirmationMatchHash("first");
    const second = confirmationMatchHash("second");

    await store.putConfirmation(
      "event",
      "preview-expired",
      { match_hash: first },
      10,
    );
    await store.putConfirmation(
      "event",
      "preview-current",
      { match_hash: second },
      100,
    );
    now = 1_011;

    expect(await store.consumeConfirmation(
      "event",
      "preview-expired",
      first,
    )).toBeNull();
    expect(await store.consumeConfirmation(
      "event",
      "preview-current",
      second,
    )).not.toBeNull();
  });

  test("replays completed writes and rejects payload drift", async () => {
    const store = new InMemoryDomainStateStore();
    const key = "actor-club-action-idempotency";

    expect(await store.acquireWrite(
      key,
      "payload-a",
      "worker-a",
      60_000,
    )).toEqual({ status: "acquired" });
    expect(await store.acquireWrite(
      key,
      "payload-a",
      "worker-b",
      60_000,
    )).toEqual({ status: "running" });
    expect(await store.acquireWrite(
      key,
      "payload-b",
      "worker-c",
      60_000,
    )).toEqual({ status: "conflict" });
    expect(await store.completeWrite(
      key,
      "payload-a",
      "worker-a",
      { event_id: "event-1" },
      60_000,
    )).toBe(true);
    expect(await store.acquireWrite(
      key,
      "payload-a",
      "worker-d",
      60_000,
    )).toEqual({
      status: "completed",
      result: { event_id: "event-1" },
    });
  });

  test("prevents an expired worker from completing or aborting a new lease", async () => {
    let now = 1_000;
    const store = new InMemoryDomainStateStore(() => now);
    const key = "lease-key";

    expect(await store.acquireWrite(
      key,
      "payload",
      "old-worker",
      10,
    )).toEqual({ status: "acquired" });
    now = 1_011;
    expect(await store.acquireWrite(
      key,
      "payload",
      "new-worker",
      100,
    )).toEqual({ status: "acquired" });

    expect(await store.completeWrite(
      key,
      "payload",
      "old-worker",
      { stale: true },
      100,
    )).toBe(false);
    await store.abortWrite(key, "payload", "old-worker");
    expect(await store.acquireWrite(
      key,
      "payload",
      "third-worker",
      100,
    )).toEqual({ status: "running" });
    expect(await store.completeWrite(
      key,
      "payload",
      "new-worker",
      { stale: false },
      100,
    )).toBe(true);
  });

  test("encrypts confirmation payloads before writing them to Redis", async () => {
    let storedKey = "";
    let storedValue = "";
    const redis = {
      status: "ready",
      async ping() {
        return "PONG";
      },
      async quit() {
        return "OK";
      },
      async set(key: string, value: string) {
        storedKey = key;
        storedValue = value;
        return "OK";
      },
      async eval(
        _script: string,
        _numberOfKeys: number,
        key: string,
        matchHash: string,
      ) {
        if (key !== storedKey) return null;
        const parsed = JSON.parse(storedValue) as {
          match_hash: string;
        };
        if (parsed.match_hash !== matchHash) return null;
        const consumed = storedValue;
        storedValue = "";
        return consumed;
      },
    } as unknown as IORedis;
    const store = new RedisDomainStateStore(
      redis,
      Buffer.alloc(32, 7),
      "test:mcp",
    );
    const matchHash = confirmationMatchHash("actor", "token");

    expect(await store.putConfirmation(
      "domain-router",
      "preview-encrypted",
      {
        match_hash: matchHash,
        input: {
          title: "Vertraulicher Vorstandstermin",
          member_id: "member-sensitive",
        },
      },
      60_000,
    )).toBe(true);
    expect(storedValue).not.toContain("Vertraulicher Vorstandstermin");
    expect(storedValue).not.toContain("member-sensitive");
    expect(storedKey).not.toContain("preview-encrypted");

    expect(await store.consumeConfirmation(
      "domain-router",
      "preview-encrypted",
      matchHash,
    )).toEqual({
      match_hash: matchHash,
      input: {
        title: "Vertraulicher Vorstandstermin",
        member_id: "member-sensitive",
      },
    });
  });
});
