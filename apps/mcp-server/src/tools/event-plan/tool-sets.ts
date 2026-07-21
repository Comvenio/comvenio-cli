import { ToolVisibilityPolicy, type CapabilitySnapshot, type ProviderToolUpdateMode } from "@comvenio/auth";
import {
  createConnectorError,
  isConnectorError,
  normalizeRequestContext,
  type JsonValue,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { z } from "zod";

import { K8_ACTION_DEFINITIONS, validateK8Definitions } from "./definitions.ts";
import { executeK8Operation, hasK8OperationHandler } from "./handlers.ts";
import { EventConfirmationPolicy } from "./preview-confirmation.ts";
import { buildEventPreview } from "./preview.ts";
import { K8_ACTION_SCHEMAS } from "./schemas.ts";
import type {
  K8ActionDefinition,
  K8ActionId,
  K8ActionResult,
  K8Domain,
  K8ExecutionDependencies,
  K8ExecutionRequest,
  K8OperationDefinition,
} from "./types.ts";

export interface K8VisibilityRequest {
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
  provider_tool_updates?: ProviderToolUpdateMode;
}

function connectorError(
  context: RequestContext,
  code: Parameters<typeof createConnectorError>[0]["code"],
  message: string,
): Error {
  return createConnectorError({ code, message, request_id: context.request_id, retryable: false });
}

function assertJsonValue(value: unknown, context: RequestContext): asserts value is JsonValue {
  if (!z.json().safeParse(value).success) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe enthält ungültige JSON-Werte.");
}

function inputOperation(definition: K8ActionDefinition, input: JsonValue): K8OperationDefinition {
  const data = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
  const names = Object.keys(definition.operations);
  const name = typeof data.operation === "string" ? data.operation : names.length === 1 ? names[0] : null;
  const operation = name ? definition.operations[name] : null;
  if (!operation) throw new Error("Die Teiloperation ist nicht definiert.");
  return operation;
}

function targetDepartmentIds(value: JsonValue): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(targetDepartmentIds);
  return Object.entries(value).flatMap(([key, entry]) => key === "department_id" && typeof entry === "string" ? [entry] : targetDepartmentIds(entry));
}

function visibilityDecision(
  visibility: ToolVisibilityPolicy,
  actionId: K8ActionId,
  operation: K8OperationDefinition,
  context: RequestContext,
  snapshot: CapabilitySnapshot | null,
  providerToolUpdates: ProviderToolUpdateMode,
) {
  return visibility.evaluate({
    tool: {
      tool_name: `${actionId}:${operation.operation}`,
      required_scopes: operation.required_scopes,
      permission_policy: operation.permission_policy,
      is_public: false,
    },
    context,
    snapshot,
    provider_tool_updates: providerToolUpdates,
    catalog_contains_tool: true,
  });
}

function decisionError(
  operation: K8OperationDefinition,
  context: RequestContext,
  reason: ReturnType<typeof visibilityDecision>["reason"],
): Error {
  if (reason === "SCOPE_REQUIRED") {
    return createConnectorError({ code: "SCOPE_REQUIRED", message: "Der OAuth-Grant enthält nicht alle erforderlichen Event-/Datei-Scopes.", request_id: context.request_id, retryable: false, required_scope: operation.required_scopes[0] });
  }
  if (reason === "TENANT_MISMATCH" || reason === "DEPARTMENT_MISMATCH") return connectorError(context, "TENANT_MISMATCH", "Der Vereins- oder Abteilungskontext ist nicht zulässig.");
  if (reason === "CONTEXT_MISSING") return connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
  return connectorError(context, "PERMISSION_DENIED", "Die Event-/Plan-Aktion ist im aktuellen Berechtigungskontext nicht erlaubt.");
}

function confirmationFrom(input: JsonValue): { preview_id: string; confirmation_token: string } | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input.confirmation;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.preview_id === "string" && typeof value.confirmation_token === "string"
    ? { preview_id: value.preview_id, confirmation_token: value.confirmation_token }
    : null;
}

function validateK8RuntimeCoverage(): void {
  for (const definition of Object.values(K8_ACTION_DEFINITIONS)) {
    if (!K8_ACTION_SCHEMAS[definition.action_id]) throw new Error(`${definition.action_id}: Schema fehlt.`);
    for (const operation of Object.values(definition.operations)) {
      if (operation.execution_gate !== "job" && !hasK8OperationHandler(definition.action_id, operation.operation)) {
        throw new Error(`${definition.action_id}:${operation.operation}: Handler fehlt.`);
      }
    }
  }
}

export abstract class K8ToolSet {
  readonly domain: K8Domain;
  readonly #dependencies: K8ExecutionDependencies;
  readonly #visibility: ToolVisibilityPolicy;
  readonly #confirmation: EventConfirmationPolicy;

  protected constructor(
    domain: K8Domain,
    dependencies: K8ExecutionDependencies,
    visibility: ToolVisibilityPolicy = new ToolVisibilityPolicy(),
  ) {
    validateK8Definitions();
    validateK8RuntimeCoverage();
    this.domain = domain;
    this.#dependencies = dependencies;
    this.#visibility = visibility;
    this.#confirmation = new EventConfirmationPolicy();
  }

  listDefinitions(): K8ActionDefinition[] {
    return Object.values(K8_ACTION_DEFINITIONS).filter((item) => item.domain === this.domain).map((item) => structuredClone(item));
  }

  listVisible(input: K8VisibilityRequest): K8ActionDefinition[] {
    const context = normalizeRequestContext(input.context);
    return this.listDefinitions().flatMap((definition) => {
      if (definition.publication_state !== "implemented") return [];
      const operations = Object.fromEntries(Object.values(definition.operations).filter((operation) => {
        if ((operation.execution_gate === "write_safety" || operation.execution_gate === "event_confirmation") && !this.#dependencies.write_safety) return false;
        if (operation.execution_gate === "job" && !this.#dependencies.job_starter) return false;
        return visibilityDecision(this.#visibility, definition.action_id, operation, context, input.capability_snapshot, input.provider_tool_updates ?? "dynamic").visible;
      }).map((operation) => [operation.operation, operation]));
      return Object.keys(operations).length ? [{ ...definition, operations }] : [];
    });
  }

  async execute(requestInput: K8ExecutionRequest): Promise<K8ActionResult> {
    const context = normalizeRequestContext(requestInput.context);
    const definition = K8_ACTION_DEFINITIONS[requestInput.action_id];
    if (!definition || definition.domain !== this.domain || definition.publication_state !== "implemented") {
      throw connectorError(context, "NOT_FOUND", "Die angeforderte Event-/Plan-Aktion ist nicht verfügbar.");
    }
    let input: unknown;
    try {
      input = K8_ACTION_SCHEMAS[definition.action_id].input.parse(requestInput.input);
    } catch (error) {
      if (error instanceof z.ZodError) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe entspricht nicht dem freigegebenen Event-/Plan-Schema.");
      throw error;
    }
    assertJsonValue(input, context);
    let operation: K8OperationDefinition;
    try {
      operation = inputOperation(definition, input);
    } catch {
      throw connectorError(context, "VALIDATION_FAILED", "Die angeforderte Teiloperation ist nicht freigegeben.");
    }
    if (context.club_id === null) throw connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
    const data = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
    if (data.club_id !== context.club_id) throw connectorError(context, "TENANT_MISMATCH", "Der Tool-Aufruf gehört nicht zum ausgewählten Verein.");

    const decision = visibilityDecision(this.#visibility, definition.action_id, operation, context, requestInput.capability_snapshot, "dynamic");
    if (!decision.authorized) throw decisionError(operation, context, decision.reason);
    const snapshot = requestInput.capability_snapshot;
    if (!snapshot) throw connectorError(context, "PERMISSION_DENIED", "Der aktuelle Berechtigungskontext fehlt.");
    if (context.department_id !== null && targetDepartmentIds(input).some((id) => id !== context.department_id)) {
      throw connectorError(context, "TENANT_MISMATCH", "Die Aktion überschreitet den gewählten Abteilungskontext.");
    }

    const mutation = async () => executeK8Operation(definition.action_id, operation.operation, input, context, this.#dependencies.client);
    try {
      let result: JsonValue;
      if (operation.execution_gate === "job") {
        if (!this.#dependencies.job_starter) throw connectorError(context, "CONFIG_INVALID", "Der sichere Event-Datei-Job-Start ist nicht konfiguriert.");
        result = await this.#dependencies.job_starter.start({ definition, operation, input, context, capability_snapshot: snapshot });
      } else if (operation.execution_gate === "write_safety") {
        if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert.");
        result = await this.#dependencies.write_safety.execute({ definition, operation, input, context, capability_snapshot: snapshot }, mutation);
      } else if (operation.execution_gate === "event_confirmation") {
        if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert.");
        const preview = await buildEventPreview(definition, operation, input, context, this.#dependencies.client);
        const confirmationPort = this.#dependencies.event_confirmation ?? this.#confirmation;
        try {
          result = await confirmationPort.confirmOrPreview({ mutation: { definition, operation, input, context, capability_snapshot: snapshot }, ...preview, confirmation: confirmationFrom(input) }, () => this.#dependencies.write_safety!.execute({ definition, operation, input, context, capability_snapshot: snapshot }, mutation));
        } catch (error) {
          if (!isConnectorError(error) && error instanceof Error && /Bestätigung/u.test(error.message)) {
            throw connectorError(context, "CONFIRMATION_MISMATCH", "Die Bestätigung ist ungültig, abgelaufen oder passt nicht mehr zur Wirkungsvorschau.");
          }
          throw error;
        }
      } else {
        result = await mutation();
      }
      const parsed = K8_ACTION_SCHEMAS[definition.action_id].output.safeParse(result);
      if (!parsed.success) throw connectorError(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat keine freigegebene Event-/Plan-Antwort geliefert.");
      assertJsonValue(parsed.data, context);
      const needsConfirmation = parsed.data !== null && typeof parsed.data === "object" && !Array.isArray(parsed.data) && parsed.data.confirmation_required === true;
      return { action_id: definition.action_id, operation: operation.operation, status: needsConfirmation ? "confirmation_required" : "completed", result: parsed.data };
    } catch (error) {
      if (isConnectorError(error) && error.code === "PERMISSION_DENIED") {
        await this.#dependencies.on_backend_forbidden?.({ action_id: definition.action_id, operation: operation.operation, context });
        throw connectorError(context, "PERMISSION_DENIED", "Der Fachservice hat die Event-/Plan-Aktion im aktuellen Kontext abgelehnt.");
      }
      if (isConnectorError(error) && error.code === "NOT_FOUND") throw connectorError(context, "NOT_FOUND", "Die angeforderte Event-/Plan-Ressource wurde nicht gefunden.");
      throw error;
    }
  }
}

export class EventToolSet extends K8ToolSet {
  constructor(dependencies: K8ExecutionDependencies) { super("event", dependencies); }
}

export class PlanToolSet extends K8ToolSet {
  constructor(dependencies: K8ExecutionDependencies) { super("plan", dependencies); }
}

export function createK8ToolSets(dependencies: K8ExecutionDependencies): { event: EventToolSet; plan: PlanToolSet } {
  return { event: new EventToolSet(dependencies), plan: new PlanToolSet(dependencies) };
}
