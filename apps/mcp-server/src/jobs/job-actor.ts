import { createHmac } from "node:crypto";

import type { OAuthScope, UUID } from "@comvenio/connector-contracts";

/**
 * Job actor exchange (D-CAI-023): a background job obtains its backend actor
 * from the auth-service through `POST /oauth/job-actor-token`, bound to the
 * grant, the subject, the club and a connector-signed job binding. The job
 * itself never carries a token; the actor lives for at most five minutes.
 */

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const EXCHANGE_TIMEOUT_MS = 5_000;
const MAX_BINDING_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_ACTOR_LIFETIME_SECONDS = 300;

export interface JobBindingInput {
  job_id: UUID;
  action_id: string;
  grant_id: UUID;
  subject_id: UUID;
  club_id: UUID;
  expires_at: string;
}

export interface JobActorRequest {
  request_id: UUID;
  job_id: UUID;
  action_id: string;
  grant_id: UUID;
  subject_id: UUID;
  club_id: UUID;
  scopes: readonly OAuthScope[];
  expires_at: string;
}

export interface JobActorPort {
  exchange(input: JobActorRequest): Promise<{ access_token: string; expires_in: number }>;
}

/** The grant was revoked or expired, or the binding was refused: the job must not retry. */
export class JobActorRevokedError extends Error {
  constructor() {
    super("Der Job-Actor wurde verweigert.");
    this.name = "JobActorRevokedError";
  }
}

/** Temporary failure of the exchange (network, 5xx, malformed answer): the job may retry. */
export class JobActorUnavailableError extends Error {
  constructor() {
    super("Der Job-Actor ist vorübergehend nicht verfügbar.");
    this.name = "JobActorUnavailableError";
  }
}

export function jobBindingMessage(input: JobBindingInput): string {
  return [
    input.job_id,
    input.action_id,
    input.grant_id,
    input.subject_id,
    input.club_id,
    input.expires_at,
  ].join("|");
}

export function signJobBinding(secret: string, input: JobBindingInput): string {
  return createHmac("sha256", secret).update(jobBindingMessage(input), "utf8").digest("hex");
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("AUTH_SERVICE_BASE_URL muss eine kanonische HTTPS-URL sein.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "");
}

export class HttpJobActorTokenPort implements JobActorPort {
  readonly #endpoint: string;
  readonly #internalApiKey: string;
  readonly #bindingSecret: string;
  readonly #fetch: FetchLike;
  readonly #now: () => number;

  constructor(input: {
    auth_base_url: string;
    internal_api_key: string;
    binding_secret: string;
    fetch?: FetchLike;
    now?: () => number;
  }) {
    this.#endpoint = `${normalizeBaseUrl(input.auth_base_url)}/oauth/job-actor-token`;
    if (!input.internal_api_key || /[\r\n]/u.test(input.internal_api_key)) {
      throw new Error("INTERNAL_API_KEY ist ungültig.");
    }
    if (input.binding_secret.length < 32) {
      throw new Error("JOB_BINDING_SECRET ist ungültig.");
    }
    this.#internalApiKey = input.internal_api_key;
    this.#bindingSecret = input.binding_secret;
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = input.now ?? Date.now;
  }

  async exchange(input: JobActorRequest): Promise<{ access_token: string; expires_in: number }> {
    const expiresAt = Date.parse(input.expires_at);
    const now = this.#now();
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > MAX_BINDING_LIFETIME_MS) {
      throw new Error("Die Job-Bindung hat eine ungültige Ablaufzeit.");
    }
    const binding: JobBindingInput = {
      job_id: input.job_id,
      action_id: input.action_id,
      grant_id: input.grant_id,
      subject_id: input.subject_id,
      club_id: input.club_id,
      expires_at: input.expires_at,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-internal-api-key": this.#internalApiKey,
          "x-request-id": input.request_id,
        },
        body: JSON.stringify({
          grant_id: input.grant_id,
          subject_id: input.subject_id,
          club_id: input.club_id,
          scopes: [...input.scopes].sort(),
          job_binding: {
            job_id: binding.job_id,
            action_id: binding.action_id,
            expires_at: binding.expires_at,
            signature: signJobBinding(this.#bindingSecret, binding),
          },
        }),
        signal: controller.signal,
      });
    } catch {
      throw new JobActorUnavailableError();
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new JobActorRevokedError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new JobActorUnavailableError();
    }
    let actor: unknown;
    try {
      actor = await response.json();
    } catch {
      throw new JobActorUnavailableError();
    }
    const value = actor !== null && typeof actor === "object" && !Array.isArray(actor)
      ? actor as Record<string, unknown>
      : null;
    if (!value
      || Object.keys(value).sort().join(",") !== "access_token,expires_in,token_type"
      || typeof value.access_token !== "string"
      || value.access_token.length < 16
      || /[\r\n]/u.test(value.access_token)
      || value.token_type !== "Bearer"
      || typeof value.expires_in !== "number"
      || !Number.isInteger(value.expires_in)
      || value.expires_in < 1
      || value.expires_in > MAX_ACTOR_LIFETIME_SECONDS) {
      throw new JobActorUnavailableError();
    }
    return { access_token: value.access_token, expires_in: value.expires_in };
  }
}
