import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";

import type { K8ActionDefinition, K8OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };

function record(value: JsonValue): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function label(value: JsonValue, fallback: string): string {
  const data = record(value);
  for (const key of ["title", "name", "label", "id"]) {
    if (typeof data[key] === "string" && data[key] !== "") return data[key];
  }
  return fallback;
}

async function eventSubject(
  input: JsonObject,
  context: RequestContext,
  client: ComvenioApiClient,
): Promise<{ subject: string; current_state: JsonValue | null }> {
  if (typeof input.event_id !== "string") return { subject: "Veranstaltungs-/Planungsobjekt", current_state: null };
  const current = await client.request<JsonValue>({ method: "GET", service: "event", path: `/events/${input.event_id}`, context });
  return {
    subject: label(current, `Event ${input.event_id}`),
    current_state: {
      status: record(current).status ?? null,
      visibility_scope: record(current).visibility_scope ?? null,
      start_time: record(current).start_time ?? null,
      end_time: record(current).end_time ?? null,
    },
  };
}

export async function buildEventPreview(
  definition: K8ActionDefinition,
  operation: K8OperationDefinition,
  inputValue: JsonValue,
  context: RequestContext,
  client: ComvenioApiClient,
): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
  const input = record(inputValue);
  const current = await eventSubject(input, context, client);
  const effects: JsonValue[] = [
    { type: "risk", risk_class: operation.risk_class },
    { type: "external_effect", external_effect: operation.external_effect },
    { type: "backend_recheck", enabled: true },
  ];
  if (current.current_state) effects.push({ type: "current_state", value: current.current_state });
  if (operation.operation === "publish") {
    effects.push({ type: "state_transition", from: record(current.current_state ?? {}).status ?? null, to: "confirmed" });
    if (input.make_public === true) effects.push({ type: "visibility_transition", to: "public" });
  }
  if (/delete|remove|clear|reset|unassign|unlink/u.test(operation.operation)) {
    effects.push({ type: "destructive_change", recoverable: false });
  }
  if (/bulk|copy|materialize|sync|run|reorder|promote|adjust/u.test(operation.operation)) {
    effects.push({ type: "mass_or_derived_effect", operation: operation.operation });
  }
  if (operation.external_effect === "third_party") effects.push({ type: "third_party_effect", operation: operation.operation });
  return {
    subject: current.subject,
    summary: `${definition.source_action}: ${operation.operation} erfordert eine zweite, unveränderte Bestätigung.`,
    effects,
  };
}
