import { createHash } from "node:crypto";

import fairUseConfigJson from "../../config/fair-use.v1.json";
import {
  RATE_LIMIT_CONFIG_SCHEMA,
  createConnectorError,
  type FairUseBucket,
  type FairUsePolicy,
  type RateLimitConfig,
} from "@comvenio/connector-contracts";

import type {
  FairUseCheck,
  FairUseDecision,
  FairUseDimensions,
  FairUseStore,
} from "./types.ts";

const REDIS_COUNTER_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if count > tonumber(ARGV[2]) then return {0, math.max(ttl, 1)} end
return {1, 0}
`;

const REDIS_HEAVY_ACQUIRE_SCRIPT = `
local added = redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
local count = redis.call('SCARD', KEYS[1])
if count > tonumber(ARGV[2]) then
  if added == 1 then redis.call('SREM', KEYS[1], ARGV[1]) end
  return {0, math.max(redis.call('TTL', KEYS[1]), 1)}
end
return {1, 0}
`;

export interface RedisEvalPort {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  srem(key: string, value: string): Promise<unknown>;
}

function opaqueKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function policyKey(policy: FairUsePolicy, dimensions: FairUseDimensions): string {
  const values = policy.key_dimensions.map((dimension) => {
    const value = dimensions[dimension];
    if (!value) throw new Error(`Die Fair-Use-Dimension ${dimension} fehlt.`);
    return `${dimension}=${value}`;
  });
  return `mcp:fair:${policy.bucket}:${opaqueKey(values)}`;
}

export function heavySlotKey(subjectId: string, clubId: string): string {
  return `mcp:heavy:${opaqueKey([subjectId, clubId])}`;
}

export function parseRateLimitConfig(value: unknown): RateLimitConfig {
  return RATE_LIMIT_CONFIG_SCHEMA.parse(value);
}

export function bundledRateLimitConfig(): RateLimitConfig {
  return parseRateLimitConfig(fairUseConfigJson);
}

export function fairUseConfigReadiness(value: unknown): { name: "fair-use"; required: true; check(): Promise<boolean> } {
  return {
    name: "fair-use",
    required: true,
    async check() { return RATE_LIMIT_CONFIG_SCHEMA.safeParse(value).success; },
  };
}

export class MemoryFairUseStore implements FairUseStore {
  readonly #counters = new Map<string, { count: number; expires_at: number }>();
  readonly #heavy = new Map<string, { jobs: Set<string>; expires_at: number }>();

  async consume(input: {
    key: string;
    limit: number;
    window_seconds: number;
    now_epoch_seconds: number;
  }): Promise<FairUseDecision> {
    const current = this.#counters.get(input.key);
    const entry = !current || current.expires_at <= input.now_epoch_seconds
      ? { count: 0, expires_at: input.now_epoch_seconds + input.window_seconds }
      : current;
    entry.count++;
    this.#counters.set(input.key, entry);
    return entry.count <= input.limit
      ? { allowed: true, retry_after_seconds: 0 }
      : { allowed: false, retry_after_seconds: Math.max(1, entry.expires_at - input.now_epoch_seconds) };
  }

  async acquireHeavy(input: {
    key: string;
    job_id: string;
    limit: number;
    ttl_seconds: number;
    now_epoch_seconds: number;
  }): Promise<FairUseDecision> {
    const now = input.now_epoch_seconds;
    const current = this.#heavy.get(input.key);
    const entry = !current || current.expires_at <= now
      ? { jobs: new Set<string>(), expires_at: now + input.ttl_seconds }
      : current;
    if (entry.jobs.has(input.job_id)) return { allowed: true, retry_after_seconds: 0 };
    if (entry.jobs.size >= input.limit) {
      return { allowed: false, retry_after_seconds: Math.max(1, entry.expires_at - now) };
    }
    entry.jobs.add(input.job_id);
    this.#heavy.set(input.key, entry);
    return { allowed: true, retry_after_seconds: 0 };
  }

  async releaseHeavy(input: { key: string; job_id: string }): Promise<void> {
    const entry = this.#heavy.get(input.key);
    entry?.jobs.delete(input.job_id);
    if (entry?.jobs.size === 0) this.#heavy.delete(input.key);
  }
}

export class RedisFairUseStore implements FairUseStore {
  constructor(private readonly redis: RedisEvalPort) {}

  async consume(input: {
    key: string;
    limit: number;
    window_seconds: number;
    now_epoch_seconds: number;
  }): Promise<FairUseDecision> {
    void input.now_epoch_seconds;
    return this.#decision(await this.redis.eval(
      REDIS_COUNTER_SCRIPT,
      1,
      input.key,
      input.window_seconds,
      input.limit,
    ));
  }

  async acquireHeavy(input: {
    key: string;
    job_id: string;
    limit: number;
    ttl_seconds: number;
    now_epoch_seconds: number;
  }): Promise<FairUseDecision> {
    void input.now_epoch_seconds;
    return this.#decision(await this.redis.eval(
      REDIS_HEAVY_ACQUIRE_SCRIPT,
      1,
      input.key,
      input.job_id,
      input.limit,
      input.ttl_seconds,
    ));
  }

  async releaseHeavy(input: { key: string; job_id: string }): Promise<void> {
    await this.redis.srem(input.key, input.job_id);
  }

  #decision(value: unknown): FairUseDecision {
    if (!Array.isArray(value) || value.length !== 2) throw new Error("Redis lieferte keine gültige Fair-Use-Entscheidung.");
    const allowed = Number(value[0]) === 1;
    const retryAfter = Number(value[1]);
    if (!Number.isFinite(retryAfter) || retryAfter < 0) throw new Error("Redis lieferte eine ungültige Retry-Zeit.");
    return { allowed, retry_after_seconds: Math.max(allowed ? 0 : 1, Math.ceil(retryAfter)) };
  }
}

export class FairUseService {
  readonly #policies: ReadonlyMap<FairUseBucket, FairUsePolicy>;

  constructor(
    readonly config: RateLimitConfig,
    private readonly store: FairUseStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#policies = new Map(config.policies.map((policy) => [policy.bucket, policy]));
  }

  async assertAllowed(input: FairUseCheck): Promise<void> {
    const policy = this.#policies.get(input.bucket);
    if (!policy) throw new Error(`Der Fair-Use-Bucket ${input.bucket} ist nicht konfiguriert.`);
    const decision = await this.store.consume({
      key: policyKey(policy, input.dimensions),
      limit: policy.limit,
      window_seconds: policy.window_seconds,
      now_epoch_seconds: Math.floor(this.now().getTime() / 1_000),
    });
    if (!decision.allowed) {
      throw createConnectorError({
        code: "RATE_LIMITED",
        message: "Das sichere Nutzungslimit ist erreicht. Bitte versuche es später erneut.",
        request_id: input.request_id,
        retryable: true,
        retry_after_seconds: decision.retry_after_seconds,
      });
    }
  }

  async acquireHeavy(input: { subject_id: string; club_id: string; job_id: string; request_id: string }): Promise<string> {
    const key = heavySlotKey(input.subject_id, input.club_id);
    const decision = await this.store.acquireHeavy({
      key,
      job_id: input.job_id,
      limit: this.config.max_concurrent_heavy_jobs_per_subject_club,
      ttl_seconds: JOB_SLOT_TTL_SECONDS,
      now_epoch_seconds: Math.floor(this.now().getTime() / 1_000),
    });
    if (!decision.allowed) {
      throw createConnectorError({
        code: "RATE_LIMITED",
        message: "Für diesen Verein läuft bereits ein schwerer Auftrag. Bitte prüfe zuerst dessen Status.",
        request_id: input.request_id,
        retryable: true,
        retry_after_seconds: decision.retry_after_seconds,
      });
    }
    return key;
  }

  releaseHeavy(key: string, jobId: string): Promise<void> {
    return this.store.releaseHeavy({ key, job_id: jobId });
  }
}

const JOB_SLOT_TTL_SECONDS = 8 * 60 * 60;
