import { createHash } from "node:crypto";

import type { JsonValue } from "@comvenio/connector-contracts";
import type IORedis from "ioredis";

export interface ConfirmationStateRecord extends Record<string, JsonValue> {
  match_hash: string;
}

export type WriteAcquireResult =
  | { status: "acquired" }
  | { status: "running" }
  | { status: "conflict" }
  | { status: "completed"; result: JsonValue };

export interface DomainStateStore {
  ready(): Promise<boolean>;
  close(): Promise<void>;
  putConfirmation(
    namespace: string,
    previewId: string,
    record: ConfirmationStateRecord,
    ttlMs: number,
  ): Promise<boolean>;
  consumeConfirmation(
    namespace: string,
    previewId: string,
    matchHash: string,
  ): Promise<ConfirmationStateRecord | null>;
  acquireWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
    ttlMs: number,
  ): Promise<WriteAcquireResult>;
  completeWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
    result: JsonValue,
    ttlMs: number,
  ): Promise<boolean>;
  abortWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
  ): Promise<void>;
}

interface MemoryEntry {
  value: ConfirmationStateRecord;
  expires_at: number;
}

interface MemoryWrite {
  payload_hash: string;
  owner_token: string;
  state: "running" | "completed";
  result: JsonValue | null;
  expires_at: number;
}

function safeClone<T>(value: T): T {
  return structuredClone(value);
}

function redisKey(prefix: string, namespace: string, value: string): string {
  const digest = createHash("sha256")
    .update(`${namespace}\u0000${value}`)
    .digest("hex");
  return `${prefix}:domain-state:${namespace}:${digest}`;
}

function ttlMilliseconds(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs < 1) {
    throw new Error("Die Shared-State-TTL ist ungültig.");
  }
  return Math.ceil(ttlMs);
}

function ttlSeconds(ttlMs: number): number {
  ttlMilliseconds(ttlMs);
  return Math.max(1, Math.ceil(ttlMs / 1_000));
}

function parseRecord(value: unknown): ConfirmationStateRecord | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || typeof (parsed as Record<string, unknown>).match_hash !== "string"
    ) {
      throw new Error("shape");
    }
    return parsed as ConfirmationStateRecord;
  } catch {
    throw new Error("Der persistierte Bestätigungszustand ist beschädigt.");
  }
}

export function confirmationMatchHash(...values: string[]): string {
  const framed = values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`)
    .join("|");
  return createHash("sha256").update(framed).digest("hex");
}

export class InMemoryDomainStateStore implements DomainStateStore {
  readonly #confirmations = new Map<string, MemoryEntry>();
  readonly #writes = new Map<string, MemoryWrite>();

  constructor(private readonly now: () => number = Date.now) {}

  async ready(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.#confirmations.clear();
    this.#writes.clear();
  }

  async putConfirmation(
    namespace: string,
    previewId: string,
    record: ConfirmationStateRecord,
    ttlMs: number,
  ): Promise<boolean> {
    this.#prune();
    const ttl = ttlMilliseconds(ttlMs);
    const key = `${namespace}\u0000${previewId}`;
    if (this.#confirmations.has(key)) return false;
    this.#confirmations.set(key, {
      value: safeClone(record),
      expires_at: this.now() + ttl,
    });
    return true;
  }

  async consumeConfirmation(
    namespace: string,
    previewId: string,
    matchHash: string,
  ): Promise<ConfirmationStateRecord | null> {
    this.#prune();
    const key = `${namespace}\u0000${previewId}`;
    const entry = this.#confirmations.get(key);
    if (!entry || entry.value.match_hash !== matchHash) return null;
    this.#confirmations.delete(key);
    return safeClone(entry.value);
  }

  async acquireWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
    ttlMs: number,
  ): Promise<WriteAcquireResult> {
    this.#prune();
    const ttl = ttlMilliseconds(ttlMs);
    const existing = this.#writes.get(key);
    if (!existing) {
      this.#writes.set(key, {
        payload_hash: payloadHash,
        owner_token: ownerToken,
        state: "running",
        result: null,
        expires_at: this.now() + ttl,
      });
      return { status: "acquired" };
    }
    if (existing.payload_hash !== payloadHash) return { status: "conflict" };
    if (existing.state === "running" || existing.result === null) {
      return { status: "running" };
    }
    return { status: "completed", result: safeClone(existing.result) };
  }

  async completeWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
    result: JsonValue,
    ttlMs: number,
  ): Promise<boolean> {
    this.#prune();
    const ttl = ttlMilliseconds(ttlMs);
    const existing = this.#writes.get(key);
    if (
      !existing
      || existing.payload_hash !== payloadHash
      || existing.owner_token !== ownerToken
      || existing.state !== "running"
    ) {
      return false;
    }
    this.#writes.set(key, {
      payload_hash: payloadHash,
      owner_token: ownerToken,
      state: "completed",
      result: safeClone(result),
      expires_at: this.now() + ttl,
    });
    return true;
  }

  async abortWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
  ): Promise<void> {
    const existing = this.#writes.get(key);
    if (
      existing?.state === "running"
      && existing.payload_hash === payloadHash
      && existing.owner_token === ownerToken
    ) {
      this.#writes.delete(key);
    }
  }

  #prune(): void {
    const now = this.now();
    for (const [key, value] of this.#confirmations) {
      if (value.expires_at <= now) this.#confirmations.delete(key);
    }
    for (const [key, value] of this.#writes) {
      if (value.expires_at <= now) this.#writes.delete(key);
    }
  }
}

const CONSUME_CONFIRMATION_LUA = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return nil end
local record = cjson.decode(encoded)
if record.match_hash ~= ARGV[1] then return nil end
redis.call('DEL', KEYS[1])
return encoded
`;

const ACQUIRE_WRITE_LUA = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then
  redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4], 'NX')
  return {'acquired'}
end
local record = cjson.decode(encoded)
if record.payload_hash ~= ARGV[1] then return {'conflict'} end
if record.state == 'running' or record.result == cjson.null then
  return {'running'}
end
return {'completed', cjson.encode(record.result)}
`;

const COMPLETE_WRITE_LUA = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return 0 end
local record = cjson.decode(encoded)
if record.payload_hash ~= ARGV[1] or record.owner_token ~= ARGV[2]
  or record.state ~= 'running' then
  return 0
end
redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4], 'XX')
return 1
`;

const ABORT_WRITE_LUA = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return 0 end
local record = cjson.decode(encoded)
if record.payload_hash == ARGV[1] and record.owner_token == ARGV[2]
  and record.state == 'running' then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisDomainStateStore implements DomainStateStore {
  constructor(
    private readonly redis: IORedis,
    private readonly prefix = "comvenio:mcp",
  ) {}

  async ready(): Promise<boolean> {
    if (this.redis.status === "wait") await this.redis.connect();
    return await this.redis.ping() === "PONG";
  }

  async close(): Promise<void> {
    if (this.redis.status !== "end") await this.redis.quit();
  }

  async putConfirmation(
    namespace: string,
    previewId: string,
    record: ConfirmationStateRecord,
    ttlMs: number,
  ): Promise<boolean> {
    const ttl = ttlMilliseconds(ttlMs);
    const result = await this.redis.set(
      redisKey(this.prefix, namespace, previewId),
      JSON.stringify(record),
      "PX",
      ttl,
      "NX",
    );
    return result === "OK";
  }

  async consumeConfirmation(
    namespace: string,
    previewId: string,
    matchHash: string,
  ): Promise<ConfirmationStateRecord | null> {
    const value = await this.redis.eval(
      CONSUME_CONFIRMATION_LUA,
      1,
      redisKey(this.prefix, namespace, previewId),
      matchHash,
    );
    return parseRecord(value);
  }

  async acquireWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
    ttlMs: number,
  ): Promise<WriteAcquireResult> {
    const ttl = ttlMilliseconds(ttlMs);
    const running = JSON.stringify({
      payload_hash: payloadHash,
      owner_token: ownerToken,
      state: "running",
      result: null,
    });
    const value = await this.redis.eval(
      ACQUIRE_WRITE_LUA,
      1,
      redisKey(this.prefix, "write", key),
      payloadHash,
      ownerToken,
      running,
      ttl,
    );
    if (!Array.isArray(value) || typeof value[0] !== "string") {
      throw new Error("Redis lieferte keinen gültigen Schreibzustand.");
    }
    if (value[0] === "acquired") return { status: "acquired" };
    if (value[0] === "conflict") return { status: "conflict" };
    if (value[0] === "running") return { status: "running" };
    if (value[0] === "completed" && typeof value[1] === "string") {
      return { status: "completed", result: JSON.parse(value[1]) as JsonValue };
    }
    throw new Error("Redis lieferte einen unbekannten Schreibzustand.");
  }

  async completeWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
    result: JsonValue,
    ttlMs: number,
  ): Promise<boolean> {
    const ttl = ttlMilliseconds(ttlMs);
    const completed = JSON.stringify({
      payload_hash: payloadHash,
      owner_token: ownerToken,
      state: "completed",
      result,
    });
    const value = await this.redis.eval(
      COMPLETE_WRITE_LUA,
      1,
      redisKey(this.prefix, "write", key),
      payloadHash,
      ownerToken,
      completed,
      ttl,
    );
    return value === 1;
  }

  async abortWrite(
    key: string,
    payloadHash: string,
    ownerToken: string,
  ): Promise<void> {
    await this.redis.eval(
      ABORT_WRITE_LUA,
      1,
      redisKey(this.prefix, "write", key),
      payloadHash,
      ownerToken,
    );
  }
}

export function redisDomainStateStore(
  redis: IORedis,
  prefix = "comvenio:mcp",
): DomainStateStore {
  return new RedisDomainStateStore(redis, prefix);
}

export const DOMAIN_STATE_TTL_SECONDS = Object.freeze({
  confirmation: ttlSeconds(10 * 60 * 1_000),
  idempotency: ttlSeconds(24 * 60 * 60 * 1_000),
});
