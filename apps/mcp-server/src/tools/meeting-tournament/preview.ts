import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";

import type { K9ActionDefinition, K9OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };

function record(value: JsonValue): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function label(value: JsonValue, fallback: string): string {
  const data = record(value);
  for (const key of ["title", "name", "label", "resolution_number", "id"]) if (typeof data[key] === "string" && data[key] !== "") return data[key] as string;
  return fallback;
}

async function subject(input: JsonObject, definition: K9ActionDefinition, context: RequestContext, client: ComvenioApiClient): Promise<{ label: string; state: JsonValue | null }> {
  try {
    if (typeof input.tournament_id === "string") {
      const current = await client.request<JsonValue>({ method: "GET", service: "tournament", path: `/tournaments/${input.tournament_id}`, context });
      return { label: label(current, `Turnier ${input.tournament_id}`), state: { status: record(current).status ?? null } };
    }
    if (typeof input.protocol_id === "string") {
      const current = await client.request<JsonValue>({ method: "GET", service: "meeting", path: `/protocols/${input.protocol_id}/view`, context });
      return { label: label(current, `Sitzung ${input.protocol_id}`), state: { status: record(current).status ?? record(current).phase ?? null } };
    }
    if (typeof input.agenda_item_id === "string") {
      const current = await client.request<JsonValue>({ method: "GET", service: "meeting", path: `/agenda-items/${input.agenda_item_id}`, context });
      return { label: label(current, `Tagesordnungspunkt ${input.agenda_item_id}`), state: { status: record(current).status ?? null } };
    }
  } catch {
    // The mutation remains protected; preview falls back to an opaque resource label.
  }
  return { label: definition.domain === "meeting" ? "Sitzungsobjekt" : "Turnierobjekt", state: null };
}

export async function buildK9Preview(definition: K9ActionDefinition, operation: K9OperationDefinition, inputValue: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
  const input = record(inputValue);
  const current = await subject(input, definition, context, client);
  const effects: JsonValue[] = [
    { type: "risk", risk_class: operation.risk_class },
    { type: "backend_rbac_recheck", enabled: true },
  ];
  if (current.state) effects.push({ type: "current_state", value: current.state });
  if (/delete|remove|clear|reset|retract|cancel|decline/u.test(operation.operation)) effects.push({ type: "destructive_change", recoverable: false });
  if (/publish|approve|promote|confirm|start|complete|advance|close|cast|tally|result/u.test(operation.operation)) effects.push({ type: "domain_effect", operation: operation.operation });
  if (/bulk|reorder|options_add|proxy_bulk/u.test(operation.operation)) effects.push({ type: "mass_effect", operation: operation.operation });
  return {
    subject: current.label,
    summary: `${definition.source_action}: ${operation.operation} benötigt eine zweite, unveränderte Bestätigung.`,
    effects,
  };
}
