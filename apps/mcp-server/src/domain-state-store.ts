import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

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

function encryptionKey(value: Uint8Array): Buffer {
  const key = Buffer.from(value);
  if (key.length !== 32) {
    throw new Error("Der Shared-State-Verschlüsselungsschlüssel ist ungültig.");
  }
  return key;
}

function sealJson(value: JsonValue, key: Buffer, aad: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    nonce.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function openJson(value: unknown, key: Buffer, aad: string): JsonValue {
  if (typeof value !== "string") {
    throw new Error("Der verschlüsselte Shared State ist beschädigt.");
  }
  const [version, nonceValue, tagValue, ciphertextValue, extra] =
    value.split(".");
  if (
    version !== "v1"
    || !nonceValue
    || !tagValue
    || ciphertextValue === undefined
    || extra !== undefined
  ) {
    throw new Error("Der verschlüsselte Shared State ist beschädigt.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(nonceValue, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as JsonValue;
  } catch {
    throw new Error("Der verschlüsselte Shared State konnte nicht geöffnet werden.");
  }
}

function parseRecord(
  value: unknown,
  key: Buffer,
  aad: string,
): ConfirmationStateRecord | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const record = parsed as Record<string, unknown>;
    const matchHash = record?.match_hash;
    const sealedPayload = record?.sealed_payload;
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || typeof matchHash !== "string"
      || typeof sealedPayload !== "string"
    ) {
      throw new Error("shape");
    }
    const payload = openJson(
      sealedPayload,
      key,
      aad,
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("shape");
    }
    return {
      ...(payload as Record<string, JsonValue>),
      match_hash: matchHash,
    };
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
if record.state == 'running' or record.result_ciphertext == cjson.null then
  return {'running'}
end
return {'completed', record.result_ciphertext}
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
  readonly #encryptionKey: Buffer;

  constructor(
    private readonly redis: IORedis,
    stateEncryptionKey: Uint8Array,
    private readonly prefix = "comvenio:mcp",
  ) {
    this.#encryptionKey = encryptionKey(stateEncryptionKey);
  }

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
    const key = redisKey(this.prefix, namespace, previewId);
    const { match_hash: matchHash, ...payload } = record;
    const result = await this.redis.set(
      key,
      JSON.stringify({
        match_hash: matchHash,
        sealed_payload: sealJson(payload, this.#encryptionKey, key),
      }),
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
    const key = redisKey(this.prefix, namespace, previewId);
    const value = await this.redis.eval(
      CONSUME_CONFIRMATION_LUA,
      1,
      key,
      matchHash,
    );
    return parseRecord(value, this.#encryptionKey, key);
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
      result_ciphertext: null,
    });
    const storageKey = redisKey(this.prefix, "write", key);
    const value = await this.redis.eval(
      ACQUIRE_WRITE_LUA,
      1,
      storageKey,
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
      return {
        status: "completed",
        result: openJson(
          value[1],
          this.#encryptionKey,
          storageKey,
        ),
      };
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
      result_ciphertext: sealJson(
        result,
        this.#encryptionKey,
        redisKey(this.prefix, "write", key),
      ),
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
  stateEncryptionKey: Uint8Array,
  prefix = "comvenio:mcp",
): DomainStateStore {
  return new RedisDomainStateStore(redis, stateEncryptionKey, prefix);
}

export const DOMAIN_STATE_TTL_SECONDS = Object.freeze({
  confirmation: ttlSeconds(10 * 60 * 1_000),
  idempotency: ttlSeconds(24 * 60 * 60 * 1_000),
});
