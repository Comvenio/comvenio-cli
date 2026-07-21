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

export function createSafeTelemetryRecord(input: SafeTelemetryRecord): SafeTelemetryRecord {
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

export class MemoryTelemetrySink implements TelemetrySink {
  readonly #events: SafeTelemetryRecord[] = [];

  record(event: SafeTelemetryRecord): void {
    this.#events.push(structuredClone(event));
  }

  list(): SafeTelemetryRecord[] {
    return structuredClone(this.#events);
  }
}
