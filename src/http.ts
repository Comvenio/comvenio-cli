// HTTP client against the Comvenio gateway. Vorbild: rts-cli/src/http.ts.
// Every request carries `Authorization: Bearer <opaque cvn_ token>`. GETs are
// retried on transient gateway errors; mutations are NEVER auto-retried.
import type { ComvenioCliState } from "./auth.ts";

export type ComvenioClient = {
  get<T = unknown>(service: string, path: string): Promise<T>;
  post<T = unknown>(service: string, path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(service: string, path: string, body?: unknown): Promise<T>;
  put<T = unknown>(service: string, path: string, body?: unknown): Promise<T>;
  del<T = unknown>(service: string, path: string): Promise<T>;
  // Convenience GET helper: service("user", "/users/me").
  service<T = unknown>(service: string, path: string): Promise<T>;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public url: string,
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

// Minimal state shape this client needs — accepts the full state OR a probe
// object (login verifies a token before the full state exists).
type ClientState = Pick<ComvenioCliState, "token" | "gatewayBaseUrl">;

export function createClient(state: ClientState): ComvenioClient {
  const gatewayBase = state.gatewayBaseUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${state.token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Transient gateway/origin errors. Only these are retried (GET only).
  const RETRYABLE_STATUS = new Set([502, 503, 504, 429]);
  const MAX_ATTEMPTS = 3;
  const REQUEST_TIMEOUT_MS = 15000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function request<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    // Retry ONLY idempotent GETs. POST/PATCH/DELETE are never auto-retried
    // (duplicate-mutation hazard).
    const canRetry = method === "GET";
    let attempt = 0;

    while (true) {
      attempt++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctrl.signal,
        });
        const text = await res.text();
        clearTimeout(timer);
        if (!res.ok) {
          if (
            canRetry &&
            RETRYABLE_STATUS.has(res.status) &&
            attempt < MAX_ATTEMPTS
          ) {
            // Exponential backoff with jitter: ~0.3s, ~0.9s
            const delay = 300 * 3 ** (attempt - 1) + Math.random() * 200;
            await sleep(delay);
            continue;
          }
          throw new HttpError(res.status, text, url);
        }
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      } catch (err) {
        clearTimeout(timer);
        // Timeout (AbortError) or network/DNS abort: retry GET only.
        if (canRetry && attempt < MAX_ATTEMPTS && !(err instanceof HttpError)) {
          const delay = 300 * 3 ** (attempt - 1) + Math.random() * 200;
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  // Build ${gatewayBase}/${service}${path} — the gateway routes every service
  // under a singular prefix (/user, /club, /member, ...).
  const serviceUrl = (service: string, path: string) =>
    `${gatewayBase}/${service}${path.startsWith("/") ? path : `/${path}`}`;

  return {
    get: (service, path) => request("GET", serviceUrl(service, path)),
    post: (service, path, body) =>
      request("POST", serviceUrl(service, path), body),
    patch: (service, path, body) =>
      request("PATCH", serviceUrl(service, path), body),
    put: (service, path, body) =>
      request("PUT", serviceUrl(service, path), body),
    del: (service, path) => request("DELETE", serviceUrl(service, path)),
    service: (service, path) => request("GET", serviceUrl(service, path)),
  };
}
