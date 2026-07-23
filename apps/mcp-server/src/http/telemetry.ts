import type {
  SafeTelemetryRecord,
  TelemetrySink,
} from "./types.ts";

const SAFE_TELEMETRY_KEYS = [
  "request_id",
  "provider",
  "authenticated",
  "route",
  "method",
  "status_code",
  "duration_ms",
  "outcome",
  "recorded_at",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ROUTES = new Set<SafeTelemetryRecord["route"]>([
  "/mcp",
  "/health",
  "/ready",
  "/.well-known/oauth-protected-resource",
  "/.well-known/openai-apps-challenge",
]);
const METHODS = new Set<SafeTelemetryRecord["method"]>(["POST", "GET", "DELETE"]);
const OUTCOMES = new Set<SafeTelemetryRecord["outcome"]>(["success", "rejected", "failed"]);

export function createSafeTelemetryRecord(input: SafeTelemetryRecord): SafeTelemetryRecord {
  if (typeof input.request_id !== "string"
    || !UUID_PATTERN.test(input.request_id)
    || (input.provider !== null && input.provider !== "openai" && input.provider !== "anthropic")
    || typeof input.authenticated !== "boolean"
    || !ROUTES.has(input.route)
    || !METHODS.has(input.method)
    || !Number.isInteger(input.status_code)
    || input.status_code < 100
    || input.status_code > 599
    || !Number.isFinite(input.duration_ms)
    || !OUTCOMES.has(input.outcome)
    || typeof input.recorded_at !== "string"
    || !ISO_INSTANT_PATTERN.test(input.recorded_at)
    || !Number.isFinite(Date.parse(input.recorded_at))) {
    throw new Error("Die Telemetrie enthält ungültige Werte.");
  }
  const record: SafeTelemetryRecord = {
    request_id: input.request_id,
    provider: input.provider,
    authenticated: input.authenticated,
    route: input.route,
    method: input.method,
    status_code: input.status_code,
    duration_ms: Math.max(0, Math.round(input.duration_ms)),
    outcome: input.outcome,
    recorded_at: input.recorded_at,
  };
  if (JSON.stringify(Object.keys(record)) !== JSON.stringify(SAFE_TELEMETRY_KEYS)) {
    throw new Error("Die Telemetrie enthält nicht freigegebene Felder.");
  }
  return Object.freeze(record);
}

export class NullTelemetrySink implements TelemetrySink {
  record(_event: SafeTelemetryRecord): void {
    // Intentionally empty: deployments must opt in to a data-minimized metrics sink.
  }
}

export class ConsoleTelemetrySink implements TelemetrySink {
  readonly #write: (line: string) => void;

  constructor(write: (line: string) => void = (line) => console.info(line)) {
    this.#write = write;
  }

  record(event: SafeTelemetryRecord): void {
    this.#write(JSON.stringify(createSafeTelemetryRecord(event)));
  }
}

export class MemoryTelemetrySink implements TelemetrySink {
  readonly #events: SafeTelemetryRecord[] = [];

  record(event: SafeTelemetryRecord): void {
    this.#events.push(structuredClone(createSafeTelemetryRecord(event)));
  }

  list(): SafeTelemetryRecord[] {
    return structuredClone(this.#events);
  }
}
