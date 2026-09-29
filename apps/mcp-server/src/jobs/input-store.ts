import { createHash } from "node:crypto";

import type { JsonValue, RequestContext, UUID } from "@comvenio/connector-contracts";
import type IORedis from "ioredis";

import { openJson, sealJson } from "../domain-state-store.ts";

/**
 * The one piece of action input a job carries to its worker (D-CAI-023).
 * It lives encrypted in the shared state with the TTL of the job metadata and
 * never contains a token: the worker obtains its actor through the job actor
 * exchange.
 */
export interface JobInputEnvelope {
  job_id: UUID;
  action_id: string;
  operation: string;
  input: JsonValue;
  context: RequestContext;
  /**
   * Expiry of the signed job binding, fixed once at job start. Every actor
   * exchange of every attempt uses exactly this value, so a retry can never
   * extend the job's authorization.
   */
  binding_expires_at: string;
}

export interface JobInputStore {
  /** Stores the envelope unless one exists for the job; returns false if it already existed. */
  put(envelope: JobInputEnvelope, ttlMs: number): Promise<boolean>;
  get(jobId: UUID): Promise<JobInputEnvelope | null>;
  delete(jobId: UUID): Promise<void>;
}

function ttl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new Error("Die TTL der Jobeingabe ist ungültig.");
  return Math.ceil(ttlMs);
}

function envelopeFrom(value: JsonValue, jobId: UUID): JobInputEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Die gespeicherte Jobeingabe ist beschädigt.");
  }
  const record = value as Record<string, JsonValue>;
  if (record.job_id !== jobId
    || typeof record.action_id !== "string"
    || typeof record.operation !== "string"
    || !("input" in record)
    || typeof record.binding_expires_at !== "string"
    || !Number.isFinite(Date.parse(record.binding_expires_at))
    || record.context === null
    || typeof record.context !== "object"
    || Array.isArray(record.context)) {
    throw new Error("Die gespeicherte Jobeingabe ist beschädigt.");
  }
  return structuredClone(record) as unknown as JobInputEnvelope;
}

export class MemoryJobInputStore implements JobInputStore {
  readonly #entries = new Map<UUID, { value: JobInputEnvelope; expires_at: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async put(envelope: JobInputEnvelope, ttlMs: number): Promise<boolean> {
    const existing = this.#entries.get(envelope.job_id);
    if (existing && existing.expires_at > this.now()) return false;
    this.#entries.set(envelope.job_id, { value: structuredClone(envelope), expires_at: this.now() + ttl(ttlMs) });
    return true;
  }

  async get(jobId: UUID): Promise<JobInputEnvelope | null> {
    const entry = this.#entries.get(jobId);
    if (!entry || entry.expires_at <= this.now()) return null;
    return structuredClone(entry.value);
  }

  async delete(jobId: UUID): Promise<void> {
    this.#entries.delete(jobId);
  }
}

export class RedisJobInputStore implements JobInputStore {
  readonly #key: Buffer;

  constructor(
    private readonly redis: IORedis,
    encryptionKey: Uint8Array,
    private readonly prefix = "comvenio:mcp",
  ) {
    this.#key = Buffer.from(encryptionKey);
    if (this.#key.length !== 32) throw new Error("Der Shared-State-Verschlüsselungsschlüssel ist ungültig.");
  }

  #storageKey(jobId: UUID): string {
    const digest = createHash("sha256").update(`job-input\u0000${jobId}`).digest("hex");
    return `${this.prefix}:domain-state:job-input:${digest}`;
  }

  async put(envelope: JobInputEnvelope, ttlMs: number): Promise<boolean> {
    const key = this.#storageKey(envelope.job_id);
    const sealed = sealJson(envelope as unknown as JsonValue, this.#key, key);
    return await this.redis.set(key, sealed, "PX", ttl(ttlMs), "NX") === "OK";
  }

  async get(jobId: UUID): Promise<JobInputEnvelope | null> {
    const key = this.#storageKey(jobId);
    const value = await this.redis.get(key);
    if (value === null) return null;
    return envelopeFrom(openJson(value, this.#key, key), jobId);
  }

  async delete(jobId: UUID): Promise<void> {
    await this.redis.del(this.#storageKey(jobId));
  }
}
