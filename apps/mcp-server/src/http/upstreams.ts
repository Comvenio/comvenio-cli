import {
  createCapabilitySnapshot,
  PositiveReadIntrospectionCache,
  type CapabilitySnapshot,
  type HttpsUrl,
  type OAuthClientRegistration,
} from "@comvenio/auth";
import {
  OAUTH_SCOPE_VALUES,
  type OAuthScope,
  type ProviderId,
  type RequestContext,
} from "@comvenio/connector-contracts";

import { runtimeError } from "./errors.ts";
import type {
  ActorTokenPort,
  CapabilityContextResolver,
  IntrospectionPort,
  ProviderRegistrationResolver,
} from "./types.ts";

const UPSTREAM_TIMEOUT_MS = 1_500;
const CAPABILITY_TTL_MS = 30_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface CimdPin {
  client_id: HttpsUrl;
  provider: ProviderId;
  metadata_sha256: string;
  allowed_scopes: OAuthScope[];
  enabled: boolean;
}

interface CimdPinDocument {
  contract_version: "1.0.0";
  release_state: "BLOCKED" | "READY";
  pins: CimdPin[];
}

function normalizeBaseUrl(value: string, field: string): HttpsUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} ist keine gültige URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} muss eine kanonische HTTPS-URL sein.`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "") as HttpsUrl;
}

function endpoint(base: HttpsUrl, path: string): string {
  return `${base}${path}`;
}

async function jsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Ungültige JSON-Antwort.");
  }
}

async function timedFetch(fetchImpl: FetchLike, input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function internalHeaders(internalApiKey: string, requestId: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "x-internal-api-key": internalApiKey,
    "x-request-id": requestId,
  };
}

export class HttpIntrospectionPort implements IntrospectionPort {
  readonly #authBaseUrl: HttpsUrl;
  readonly #internalApiKey: string;
  readonly #fetch: FetchLike;
  readonly #cache = new PositiveReadIntrospectionCache();
  readonly #now: () => number;

  constructor(input: {
    auth_base_url: string;
    internal_api_key: string;
    fetch?: FetchLike;
    now?: () => number;
  }) {
    this.#authBaseUrl = normalizeBaseUrl(input.auth_base_url, "AUTH_SERVICE_BASE_URL");
    this.#internalApiKey = input.internal_api_key;
    if (!this.#internalApiKey || /[\r\n]/u.test(this.#internalApiKey)) {
      throw new Error("INTERNAL_API_KEY ist ungültig.");
    }
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = input.now ?? Date.now;
  }

  async introspect(input: Parameters<IntrospectionPort["introspect"]>[0]): Promise<unknown> {
    if (!input.force_fresh) {
      const cached = this.#cache.get(input.raw_token, "read", this.#now());
      if (cached) return cached;
    }
    const response = await timedFetch(this.#fetch, endpoint(this.#authBaseUrl, "/oauth/introspect"), {
      method: "POST",
      headers: internalHeaders(this.#internalApiKey, input.request_id),
      body: new URLSearchParams({
        token: input.raw_token,
        token_type_hint: "access_token",
        resource: input.audience,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Introspection fehlgeschlagen (${response.status}).`);
    }
    const result = await jsonResponse(response);
    this.#cache.put(input.raw_token, result, this.#now());
    return result;
  }
}

export class HttpActorTokenPort implements ActorTokenPort {
  readonly #authBaseUrl: HttpsUrl;
  readonly #internalApiKey: string;
  readonly #fetch: FetchLike;

  constructor(input: { auth_base_url: string; internal_api_key: string; fetch?: FetchLike }) {
    this.#authBaseUrl = normalizeBaseUrl(input.auth_base_url, "AUTH_SERVICE_BASE_URL");
    this.#internalApiKey = input.internal_api_key;
    if (!this.#internalApiKey || /[\r\n]/u.test(this.#internalApiKey)) {
      throw new Error("INTERNAL_API_KEY ist ungültig.");
    }
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async exchange(input: Parameters<ActorTokenPort["exchange"]>[0]): Promise<unknown> {
    const response = await timedFetch(this.#fetch, endpoint(this.#authBaseUrl, "/oauth/actor-token"), {
      method: "POST",
      headers: internalHeaders(this.#internalApiKey, input.request_id),
      body: new URLSearchParams({
        token: input.raw_token,
        token_type_hint: "access_token",
        resource: input.audience,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Actor-Token-Austausch fehlgeschlagen (${response.status}).`);
    }
    return jsonResponse(response);
  }
}

export class PinnedProviderRegistrationResolver implements ProviderRegistrationResolver {
  readonly #registrations = new Map<HttpsUrl, OAuthClientRegistration>();

  constructor(document: unknown) {
    const value = document as Partial<CimdPinDocument>;
    if (value?.contract_version !== "1.0.0" || !Array.isArray(value.pins)) {
      throw new Error("Die CIMD-Pin-Allowlist ist ungültig.");
    }
    for (const raw of value.pins) {
      if (!raw || typeof raw !== "object") throw new Error("Die CIMD-Pin-Allowlist ist ungültig.");
      const pin = raw as CimdPin;
      const clientId = normalizeBaseUrl(pin.client_id, "CIMD client_id");
      if (clientId !== pin.client_id || !["openai", "anthropic"].includes(pin.provider)
        || !/^[a-f0-9]{64}$/u.test(pin.metadata_sha256) || typeof pin.enabled !== "boolean"
        || !Array.isArray(pin.allowed_scopes) || pin.allowed_scopes.length === 0
        || new Set(pin.allowed_scopes).size !== pin.allowed_scopes.length
        || pin.allowed_scopes.some((scope) => !(OAUTH_SCOPE_VALUES as readonly string[]).includes(scope))
        || this.#registrations.has(clientId)) {
        throw new Error("Die CIMD-Pin-Allowlist ist ungültig.");
      }
      this.#registrations.set(clientId, {
        client_id: clientId,
        provider: pin.provider,
        redirect_uris: [],
        allowed_scopes: [...pin.allowed_scopes].sort(),
        token_endpoint_auth_method: "none",
        pkce_method: "S256",
        metadata_sha256: pin.metadata_sha256,
        enabled: pin.enabled,
      });
    }
  }

  async resolve(clientId: HttpsUrl): Promise<OAuthClientRegistration | null> {
    const registration = this.#registrations.get(clientId);
    return registration ? structuredClone(registration) : null;
  }

  isReleaseReady(): boolean {
    const enabled = new Set([...this.#registrations.values()]
      .filter((registration) => registration.enabled)
      .map((registration) => registration.provider));
    return enabled.size === 2 && enabled.has("openai") && enabled.has("anthropic");
  }
}

interface CachedCapability {
  snapshot: CapabilitySnapshot;
  cached_at_ms: number;
}

function capabilityKey(context: RequestContext): string {
  return `${context.subject_id}:${context.club_id}:${context.department_id ?? ""}`;
}

export class HttpCapabilityContextResolver implements CapabilityContextResolver {
  readonly #apiBaseUrl: HttpsUrl;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;
  readonly #cache = new Map<string, CachedCapability>();
  readonly #inflight = new Map<string, Promise<CapabilitySnapshot>>();

  constructor(input: { api_base_url: string; fetch?: FetchLike; now?: () => Date }) {
    this.#apiBaseUrl = normalizeBaseUrl(input.api_base_url, "COMVENIO_API_BASE_URL");
    if (new URL(this.#apiBaseUrl).origin !== this.#apiBaseUrl) {
      throw new Error("COMVENIO_API_BASE_URL muss ein HTTPS-Origin ohne Pfad sein.");
    }
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = input.now ?? (() => new Date());
  }

  async resolve(input: Parameters<CapabilityContextResolver["resolve"]>[0]): Promise<CapabilitySnapshot> {
    const { context } = input;
    if (!context.subject_id || !context.club_id) {
      throw runtimeError({
        code: "CLUB_SELECTION_REQUIRED",
        message: "Für die Rechteprüfung muss ein Verein ausgewählt sein.",
        request_id: context.request_id,
        retryable: false,
      });
    }
    const key = capabilityKey(context);
    const nowMs = this.#now().getTime();
    const cached = this.#cache.get(key);
    if (!input.force_recheck && cached && nowMs - cached.cached_at_ms >= 0
      && nowMs - cached.cached_at_ms <= CAPABILITY_TTL_MS
      && (!context.capability_version || context.capability_version === cached.snapshot.capability_version)) {
      return structuredClone(cached.snapshot);
    }
    const pending = this.#inflight.get(key);
    if (pending && !input.force_recheck) return structuredClone(await pending);
    const request = this.#load(input);
    this.#inflight.set(key, request);
    try {
      const snapshot = await request;
      this.#cache.set(key, { snapshot, cached_at_ms: nowMs });
      return structuredClone(snapshot);
    } finally {
      if (this.#inflight.get(key) === request) this.#inflight.delete(key);
    }
  }

  async #load(input: Parameters<CapabilityContextResolver["resolve"]>[0]): Promise<CapabilitySnapshot> {
    const parameters = new URLSearchParams({ club_id: input.context.club_id! });
    if (input.context.department_id) parameters.set("department_id", input.context.department_id);
    let response: Response;
    try {
      response = await timedFetch(
        this.#fetch,
        `${this.#apiBaseUrl}/role/permissions/effective/self?${parameters.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${input.backend_actor_token}`,
            "x-request-id": input.context.request_id,
          },
        },
      );
    } catch {
      throw runtimeError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "Die aktuellen Berechtigungen können derzeit nicht geladen werden.",
        request_id: input.context.request_id,
        retryable: true,
      });
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw runtimeError({
        code: response.status === 401 ? "AUTH_REQUIRED"
          : response.status === 403 || response.status === 404 ? "PERMISSION_DENIED"
            : "UPSTREAM_UNAVAILABLE",
        message: response.status >= 500
          ? "Die aktuellen Berechtigungen können derzeit nicht geladen werden."
          : "Der gewählte Vereins- oder Abteilungskontext ist nicht erlaubt.",
        request_id: input.context.request_id,
        retryable: response.status >= 500,
      });
    }
    let snapshot: CapabilitySnapshot;
    try {
      snapshot = createCapabilitySnapshot({
        subject_id: input.context.subject_id!,
        response: await jsonResponse(response),
        observed_at: this.#now(),
      });
    } catch {
      throw runtimeError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "Die Berechtigungsantwort ist ungültig.",
        request_id: input.context.request_id,
        retryable: false,
      });
    }
    if (snapshot.club_id !== input.context.club_id
      || (input.context.department_id !== null
        && !snapshot.department_ids.includes(input.context.department_id))) {
      throw runtimeError({
        code: "TENANT_MISMATCH",
        message: "Der Berechtigungskontext gehört zu einem anderen Verein oder einer anderen Abteilung.",
        request_id: input.context.request_id,
        retryable: false,
      });
    }
    return snapshot;
  }
}

export function createHttpReadinessCheck(input: {
  url: string;
  fetch?: FetchLike;
}): () => Promise<boolean> {
  const fetchImpl = input.fetch ?? globalThis.fetch.bind(globalThis);
  return async () => {
    try {
      const response = await timedFetch(fetchImpl, input.url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      await response.body?.cancel().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    }
  };
}
