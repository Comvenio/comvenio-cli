// Compatibility client for the established CLI command modules.
// Keep this API and the HttpError identity stable during expand-and-contract.

export type RequestOpts = {
  // Per-request timeout override. Synchronous LLM endpoints legitimately run
  // longer than the shared 15-second default.
  timeoutMs?: number;
};

export type ComvenioClient = {
  get<T = unknown>(service: string, path: string): Promise<T>;
  post<T = unknown>(service: string, path: string, body?: unknown, opts?: RequestOpts): Promise<T>;
  patch<T = unknown>(service: string, path: string, body?: unknown): Promise<T>;
  put<T = unknown>(service: string, path: string, body?: unknown): Promise<T>;
  postForm<T = unknown>(service: string, path: string, body: FormData): Promise<T>;
  del<T = unknown>(service: string, path: string): Promise<T>;
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

export type LegacyClientState = {
  token: string;
  gatewayBaseUrl: string;
};

export function createClient(state: LegacyClientState): ComvenioClient {
  const gatewayBase = state.gatewayBaseUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${state.token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const RETRYABLE_STATUS = new Set([502, 503, 504, 429]);
  const MAX_ATTEMPTS = 3;
  const REQUEST_TIMEOUT_MS = 15000;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function request<T>(
    method: string,
    url: string,
    body?: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const canRetry = method === "GET";
    let attempt = 0;

    while (true) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await response.text();
        clearTimeout(timer);
        if (!response.ok) {
          if (canRetry && RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
            const delay = 300 * 3 ** (attempt - 1) + Math.random() * 200;
            await sleep(delay);
            continue;
          }
          throw new HttpError(response.status, text, url);
        }
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      } catch (error) {
        clearTimeout(timer);
        if (canRetry && attempt < MAX_ATTEMPTS && !(error instanceof HttpError)) {
          const delay = 300 * 3 ** (attempt - 1) + Math.random() * 200;
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }

  const serviceUrl = (service: string, path: string) =>
    `${gatewayBase}/${service}${path.startsWith("/") ? path : `/${path}`}`;

  return {
    get: (service, path) => request("GET", serviceUrl(service, path)),
    post: (service, path, body, opts) =>
      request("POST", serviceUrl(service, path), body, opts?.timeoutMs),
    patch: (service, path, body) => request("PATCH", serviceUrl(service, path), body),
    put: (service, path, body) => request("PUT", serviceUrl(service, path), body),
    postForm: async <T = unknown>(service: string, path: string, body: FormData) => {
      const url = serviceUrl(service, path);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${state.token}`,
            Accept: "application/json",
          },
          body,
          signal: controller.signal,
        });
        const responseText = await response.text();
        if (!response.ok) throw new HttpError(response.status, responseText, url);
        if (!responseText) return undefined as T;
        try {
          return JSON.parse(responseText) as T;
        } catch {
          return responseText as T;
        }
      } finally {
        clearTimeout(timer);
      }
    },
    del: (service, path) => request("DELETE", serviceUrl(service, path)),
    service: (service, path) => request("GET", serviceUrl(service, path)),
  };
}
