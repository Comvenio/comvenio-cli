import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";

import type { K10ActionDefinition, K10OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };

function record(value: JsonValue): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function label(value: JsonValue, fallback: string): string {
  const data = record(value);
  for (const key of ["title", "name", "id"]) if (typeof data[key] === "string" && data[key] !== "") return data[key] as string;
  return fallback;
}

async function currentSubject(input: JsonObject, definition: K10ActionDefinition, context: RequestContext, client: ComvenioApiClient): Promise<{ label: string; state: JsonValue | null }> {
  try {
    if (typeof input.reservation_id === "string") {
      const current = await client.request<JsonValue>({ method: "GET", service: "object", path: `/object-reservations/${input.reservation_id}`, context });
      return { label: label(current, "Buchung"), state: { status: record(current).status ?? null, start_time: record(current).start_time ?? null, end_time: record(current).end_time ?? null } };
    }
    if (typeof input.object_id === "string") {
      const current = await client.request<JsonValue>({ method: "GET", service: "object", path: `/objects/${input.object_id}`, context });
      return { label: label(current, "Buchungsobjekt"), state: { is_active: record(current).is_active ?? null } };
    }
    if (typeof input.task_id === "string") {
      const current = await client.request<JsonValue>({ method: "GET", service: "task", path: `/tasks/${input.task_id}`, context });
      return { label: label(current, "Aufgabe"), state: { status: record(current).status ?? null } };
    }
  } catch {
    // Confirmation remains server-side bound even if an optional preview read fails.
  }
  return { label: definition.domain === "booking" ? "Buchung" : definition.domain === "object" ? "Buchungsobjekt" : "Aufgabe", state: null };
}

export async function buildK10Preview(definition: K10ActionDefinition, operation: K10OperationDefinition, inputValue: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
  const input = record(inputValue);
  const current = await currentSubject(input, definition, context, client);
  const effects: JsonValue[] = [
    { type: "risk", risk_class: operation.risk_class },
    { type: "backend_rbac_recheck", enabled: true },
  ];
  if (definition.domain === "booking") effects.push({ type: "implicit_reservation", enabled: false }, { type: "final_backend_conflict_check", enabled: true });
  if (current.state) effects.push({ type: "current_state", value: current.state });
  if (/delete|remove|cancel|reject/u.test(operation.operation)) effects.push({ type: "destructive_change", recoverable: false });
  if (/bulk|add_groups|reorder/u.test(operation.operation)) effects.push({ type: "mass_effect", operation: operation.operation });
  return {
    subject: current.label,
    summary: `${definition.source_action}: ${operation.operation} benötigt eine zweite, unveränderte Bestätigung.`,
    effects,
  };
}
