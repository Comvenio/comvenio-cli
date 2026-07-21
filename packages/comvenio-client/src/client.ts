import {
  createConnectorError,
  isConnectorError,
  normalizeRequestContext,
  type ConnectorErrorCode,
  type JsonValue,
  type RequestContext,
} from "@comvenio/connector-contracts";

export type ComvenioHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ComvenioApiRequest {
  method: ComvenioHttpMethod;
  service: string;
  path: string;
  context: RequestContext;
  query?: Record<string, string | string[]>;
  body?: JsonValue;
}

export interface ComvenioApiClient {
  readonly timeout_ms: 15000;
  request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T>;
}

export interface ClientTelemetryEvent {
  request_id: string;
  surface: RequestContext["surface"];
  provider: RequestContext["provider"];
  method: ComvenioHttpMethod;
  service: string;
  attempt: number;
  duration_ms: number;
  outcome: "retry" | "success" | "error";
  status?: number;
  error_code?: ConnectorErrorCode;
}

export interface ComvenioApiClientConfig {
  gatewayBaseUrl: string;
  accessToken?:
    | string
    | null
    | ((context: RequestContext) => string | null | Promise<string | null>);
  telemetry?: (event: ClientTelemetryEvent) => void;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ComvenioApiClientDependencies {
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

const REQUEST_TIMEOUT_MS = 15000 as const;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const SERVICE_PATTERN = /^[a-z][a-z0-9-]*$/;
const HTTP_METHODS = new Set<ComvenioHttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function configError(requestId: string, message: string): Error {
  return createConnectorError({
    code: "CONFIG_INVALID",
    message,
    request_id: requestId,
    retryable: false,
  });
}

function normalizeGatewayBaseUrl(value: string, requestId: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configError(requestId, "Die Comvenio-Basis-URL ist ungültig.");
  }
  if (!(["https:", "http:"] as string[]).includes(url.protocol)) {
    throw configError(requestId, "Die Comvenio-Basis-URL muss HTTP oder HTTPS verwenden.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configError(requestId, "Die Comvenio-Basis-URL enthält unzulässige Bestandteile.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function validateRequestTarget(request: ComvenioApiRequest): void {
  if (!HTTP_METHODS.has(request.method)) {
    throw configError(request.context.request_id, "Die HTTP-Methode ist ungültig.");
  }
  if (!SERVICE_PATTERN.test(request.service)) {
    throw configError(request.context.request_id, "Der Comvenio-Service ist ungültig.");
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(request.path);
  } catch {
    throw configError(request.context.request_id, "Der Comvenio-Pfad ist ungültig.");
  }
  if (!request.path.startsWith("/")
    || decodedPath.includes("..")
    || /^\/\/+/u.test(request.path)
    || /[?#\\]/u.test(request.path)) {
    throw configError(request.context.request_id, "Der Comvenio-Pfad ist ungültig.");
  }
  if (request.body !== undefined && !isJsonValue(request.body)) {
    throw configError(request.context.request_id, "Der Request-Body ist ungültig.");
  }
}

function buildUrl(base: string, request: ComvenioApiRequest): string {
  const url = new URL(`${base}/${request.service}${request.path}`);
  for (const key of Object.keys(request.query ?? {}).sort()) {
    const rawValue = request.query?.[key];
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value !== undefined) url.searchParams.append(key, value);
    }
  }
  return url.toString();
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.values(value as Record<string, unknown>)
        .every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup must not replace the normalized upstream error.
  }
}

function errorForStatus(status: number): { code: ConnectorErrorCode; retryable: boolean } {
  if (status === 401) return { code: "AUTH_REQUIRED", retryable: false };
  if (status === 403) return { code: "PERMISSION_DENIED", retryable: false };
  if (status === 404) return { code: "NOT_FOUND", retryable: false };
  if (status === 409) return { code: "CONFLICT", retryable: false };
  if (status === 429) return { code: "RATE_LIMITED", retryable: true };
  if (status === 400 || status === 422) return { code: "VALIDATION_FAILED", retryable: false };
  return { code: "UPSTREAM_UNAVAILABLE", retryable: status >= 500 };
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function resolveAccessToken(
  source: ComvenioApiClientConfig["accessToken"],
  context: RequestContext,
): Promise<string | null> {
  let raw: string | null | undefined;
  try {
    raw = typeof source === "function" ? await source(context) : source;
  } catch (error) {
    if (isConnectorError(error)) throw error;
    throw createConnectorError({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
      message: "Der Zugriffskontext konnte nicht geladen werden.",
      request_id: context.request_id,
      retryable: true,
    });
  }
  if (raw === null || raw === undefined || raw === "") return null;
  const token = raw.trim();
  if (!token || /[\r\n]/u.test(token)) {
    throw configError(context.request_id, "Das Zugriffstoken ist ungültig.");
  }
  return token;
}

export function createComvenioApiClient(
  config: ComvenioApiClientConfig,
  dependencies: ComvenioApiClientDependencies = {},
): ComvenioApiClient {
  const fetchImpl: FetchLike = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = dependencies.sleep ?? ((milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? Date.now;

  const emit = (event: ClientTelemetryEvent): void => {
    try {
      config.telemetry?.(event);
    } catch {
      // Observability must never change request behavior.
    }
  };

  return {
    timeout_ms: REQUEST_TIMEOUT_MS,

    async request<T extends JsonValue>(input: ComvenioApiRequest): Promise<T> {
      const context = normalizeRequestContext(input.context);
      const request = { ...input, context };
      validateRequestTarget(request);
      const base = normalizeGatewayBaseUrl(config.gatewayBaseUrl, context.request_id);
      const url = buildUrl(base, request);
      const token = await resolveAccessToken(config.accessToken, context);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Request-ID": context.request_id,
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (request.body !== undefined) headers["Content-Type"] = "application/json";

      const canRetry = request.method === "GET";
      let attempt = 0;

      while (attempt < MAX_ATTEMPTS) {
        attempt++;
        const startedAt = now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetchImpl(url, {
            method: request.method,
            headers,
            body: request.body === undefined ? undefined : JSON.stringify(request.body),
            signal: controller.signal,
          });

          if (!response.ok) {
            await discardResponseBody(response);
            if (canRetry && RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
              emit({
                request_id: context.request_id,
                surface: context.surface,
                provider: context.provider,
                method: request.method,
                service: request.service,
                attempt,
                duration_ms: now() - startedAt,
                outcome: "retry",
                status: response.status,
              });
              await sleep(300 * 3 ** (attempt - 1));
              continue;
            }

            const mapped = errorForStatus(response.status);
            const retryAfter = retryAfterSeconds(response);
            emit({
              request_id: context.request_id,
              surface: context.surface,
              provider: context.provider,
              method: request.method,
              service: request.service,
              attempt,
              duration_ms: now() - startedAt,
              outcome: "error",
              status: response.status,
              error_code: mapped.code,
            });
            throw createConnectorError({
              code: mapped.code,
              message: "Der Comvenio-Dienst hat die Anfrage abgelehnt.",
              request_id: context.request_id,
              retryable: mapped.retryable,
              ...(retryAfter === undefined ? {} : { retry_after_seconds: retryAfter }),
            });
          }

          const text = await response.text();
          let result: unknown = null;
          if (text) {
            try {
              result = JSON.parse(text);
            } catch {
              throw createConnectorError({
                code: "UPSTREAM_UNAVAILABLE",
                message: "Der Comvenio-Dienst hat eine ungültige Antwort geliefert.",
                request_id: context.request_id,
                retryable: false,
              });
            }
          }
          if (!isJsonValue(result)) {
            throw createConnectorError({
              code: "UPSTREAM_UNAVAILABLE",
              message: "Der Comvenio-Dienst hat eine ungültige Antwort geliefert.",
              request_id: context.request_id,
              retryable: false,
            });
          }
          emit({
            request_id: context.request_id,
            surface: context.surface,
            provider: context.provider,
            method: request.method,
            service: request.service,
            attempt,
            duration_ms: now() - startedAt,
            outcome: "success",
            status: response.status,
          });
          return result as T;
        } catch (error) {
          if (isConnectorError(error)) throw error;
          if (isAbortError(error)) {
            if (canRetry && attempt < MAX_ATTEMPTS) {
              emit({
                request_id: context.request_id,
                surface: context.surface,
                provider: context.provider,
                method: request.method,
                service: request.service,
                attempt,
                duration_ms: now() - startedAt,
                outcome: "retry",
                error_code: "UPSTREAM_TIMEOUT",
              });
              await sleep(300 * 3 ** (attempt - 1));
              continue;
            }
            emit({
              request_id: context.request_id,
              surface: context.surface,
              provider: context.provider,
              method: request.method,
              service: request.service,
              attempt,
              duration_ms: now() - startedAt,
              outcome: "error",
              error_code: "UPSTREAM_TIMEOUT",
            });
            throw createConnectorError({
              code: "UPSTREAM_TIMEOUT",
              message: "Der Comvenio-Dienst hat nicht rechtzeitig geantwortet.",
              request_id: context.request_id,
              retryable: canRetry,
            });
          }
          if (canRetry && attempt < MAX_ATTEMPTS) {
            emit({
              request_id: context.request_id,
              surface: context.surface,
              provider: context.provider,
              method: request.method,
              service: request.service,
              attempt,
              duration_ms: now() - startedAt,
              outcome: "retry",
              error_code: "UPSTREAM_UNAVAILABLE",
            });
            await sleep(300 * 3 ** (attempt - 1));
            continue;
          }
          emit({
            request_id: context.request_id,
            surface: context.surface,
            provider: context.provider,
            method: request.method,
            service: request.service,
            attempt,
            duration_ms: now() - startedAt,
            outcome: "error",
            error_code: "UPSTREAM_UNAVAILABLE",
          });
          throw createConnectorError({
            code: "UPSTREAM_UNAVAILABLE",
            message: "Der Comvenio-Dienst ist vorübergehend nicht erreichbar.",
            request_id: context.request_id,
            retryable: canRetry,
          });
        } finally {
          clearTimeout(timer);
        }
      }

      throw createConnectorError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "Der Comvenio-Dienst ist vorübergehend nicht erreichbar.",
        request_id: context.request_id,
        retryable: canRetry,
      });
    },
  };
}
