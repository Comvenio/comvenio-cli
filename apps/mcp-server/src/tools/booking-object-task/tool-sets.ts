import { ToolVisibilityPolicy, type CapabilitySnapshot, type ProviderToolUpdateMode } from "@comvenio/auth";
import { createConnectorError, isConnectorError, normalizeRequestContext, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import { z } from "zod";

import { AvailabilityContract, availabilityRequestsForMutation } from "./availability.ts";
import { BookingConflictDetected, BookingConflictPolicy } from "./booking-conflict.ts";
import { K10_ACTION_DEFINITIONS, validateK10Definitions } from "./definitions.ts";
import { executeK10Operation, hasK10OperationHandler } from "./handlers.ts";
import { buildK10Preview } from "./preview.ts";
import { K10_ACTION_SCHEMAS } from "./schemas.ts";
import type {
  K10ActionDefinition,
  K10ActionId,
  K10ActionResult,
  K10Domain,
  K10ExecutionDependencies,
  K10ExecutionRequest,
  K10OperationDefinition,
} from "./types.ts";

export interface K10VisibilityRequest {
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
  provider_tool_updates?: ProviderToolUpdateMode;
}

function connectorError(context: RequestContext, code: Parameters<typeof createConnectorError>[0]["code"], message: string): Error {
  return createConnectorError({ code, message, request_id: context.request_id, retryable: false });
}

function assertJson(value: unknown, context: RequestContext): asserts value is JsonValue {
  if (!z.json().safeParse(value).success) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe enthält ungültige JSON-Werte.");
}

function operationFor(definition: K10ActionDefinition, input: JsonValue): K10OperationDefinition {
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

function targetClubIds(value: JsonValue): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(targetClubIds);
  return Object.entries(value).flatMap(([key, entry]) => key === "club_id" && typeof entry === "string" ? [entry] : targetClubIds(entry));
}

function visibilityDecision(visibility: ToolVisibilityPolicy, actionId: K10ActionId, operation: K10OperationDefinition, context: RequestContext, snapshot: CapabilitySnapshot | null, providerToolUpdates: ProviderToolUpdateMode) {
  return visibility.evaluate({
    tool: { tool_name: `${actionId}:${operation.operation}`, required_scopes: operation.required_scopes, permission_policy: operation.permission_policy, is_public: false },
    context,
    snapshot,
    provider_tool_updates: providerToolUpdates,
    catalog_contains_tool: true,
  });
}

function decisionError(operation: K10OperationDefinition, context: RequestContext, reason: ReturnType<typeof visibilityDecision>["reason"]): Error {
  if (reason === "SCOPE_REQUIRED") return createConnectorError({ code: "SCOPE_REQUIRED", message: "Der OAuth-Grant enthält nicht alle erforderlichen Buchungs-, Objekt- oder Aufgaben-Scopes.", request_id: context.request_id, retryable: false, required_scope: operation.required_scopes[0] });
  if (reason === "TENANT_MISMATCH" || reason === "DEPARTMENT_MISMATCH") return connectorError(context, "TENANT_MISMATCH", "Der Vereins- oder Abteilungskontext ist nicht zulässig.");
  if (reason === "CONTEXT_MISSING") return connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
  return connectorError(context, "PERMISSION_DENIED", "Die Buchungs-, Objekt- oder Aufgabenaktion ist im aktuellen Berechtigungskontext nicht erlaubt.");
}

function confirmationFrom(input: JsonValue): { preview_id: string; confirmation_token: string } | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input.confirmation;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.preview_id === "string" && typeof value.confirmation_token === "string" ? { preview_id: value.preview_id, confirmation_token: value.confirmation_token } : null;
}

function validateRuntimeCoverage(): void {
  for (const definition of Object.values(K10_ACTION_DEFINITIONS)) {
    if (!K10_ACTION_SCHEMAS[definition.action_id]) throw new Error(`${definition.action_id}: Schema fehlt.`);
    for (const operation of Object.values(definition.operations)) if (!hasK10OperationHandler(definition.action_id, operation.operation)) throw new Error(`${definition.action_id}:${operation.operation}: Handler fehlt.`);
  }
}

export abstract class K10ToolSet {
  readonly domain: K10Domain;
  readonly #dependencies: K10ExecutionDependencies;
  readonly #visibility: ToolVisibilityPolicy;
  readonly #conflict: K10ExecutionDependencies["booking_conflict"];

  protected constructor(domain: K10Domain, dependencies: K10ExecutionDependencies, visibility: ToolVisibilityPolicy = new ToolVisibilityPolicy()) {
    validateK10Definitions();
    validateRuntimeCoverage();
    this.domain = domain;
    this.#dependencies = dependencies;
    this.#visibility = visibility;
    this.#conflict = dependencies.booking_conflict ?? new BookingConflictPolicy(new AvailabilityContract(dependencies.client));
  }

  listDefinitions(): K10ActionDefinition[] {
    return Object.values(K10_ACTION_DEFINITIONS).filter((definition) => definition.domain === this.domain).map((definition) => structuredClone(definition));
  }

  listVisible(input: K10VisibilityRequest): K10ActionDefinition[] {
    const context = normalizeRequestContext(input.context);
    return this.listDefinitions().flatMap((definition) => {
      const operations = Object.fromEntries(Object.values(definition.operations).filter((operation) => {
        if (operation.execution_gate !== "inline" && !this.#dependencies.write_safety) return false;
        return visibilityDecision(this.#visibility, definition.action_id, operation, context, input.capability_snapshot, input.provider_tool_updates ?? "dynamic").visible;
      }).map((operation) => [operation.operation, operation]));
      return Object.keys(operations).length > 0 ? [{ ...definition, operations }] : [];
    });
  }

  async execute(requestInput: K10ExecutionRequest): Promise<K10ActionResult> {
    const context = normalizeRequestContext(requestInput.context);
    const definition = K10_ACTION_DEFINITIONS[requestInput.action_id];
    if (!definition || definition.domain !== this.domain || definition.publication_state !== "implemented") throw connectorError(context, "NOT_FOUND", "Die angeforderte Buchungs-, Objekt- oder Aufgabenaktion ist nicht verfügbar.");
    let input: unknown;
    try {
      input = K10_ACTION_SCHEMAS[definition.action_id].input.parse(requestInput.input);
    } catch (error) {
      if (error instanceof z.ZodError) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe entspricht nicht dem freigegebenen Buchungs-, Objekt- oder Aufgaben-Schema.");
      throw error;
    }
    assertJson(input, context);
    let operation: K10OperationDefinition;
    try {
      operation = operationFor(definition, input);
    } catch {
      throw connectorError(context, "VALIDATION_FAILED", "Die angeforderte Teiloperation ist nicht freigegeben.");
    }
    if (context.club_id === null) throw connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
    const data = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
    if (data.club_id !== context.club_id || targetClubIds(input).some((id) => id !== context.club_id)) throw connectorError(context, "TENANT_MISMATCH", "Der Tool-Aufruf gehört nicht zum ausgewählten Verein.");
    if (context.department_id !== null && targetDepartmentIds(input).some((id) => id !== context.department_id)) throw connectorError(context, "TENANT_MISMATCH", "Die Aktion überschreitet den gewählten Abteilungskontext.");

    const decision = visibilityDecision(this.#visibility, definition.action_id, operation, context, requestInput.capability_snapshot, "dynamic");
    if (!decision.authorized) throw decisionError(operation, context, decision.reason);
    const snapshot = requestInput.capability_snapshot;
    if (!snapshot) throw connectorError(context, "PERMISSION_DENIED", "Der aktuelle Berechtigungskontext fehlt.");
    const mutationRequest = { definition, operation, input, context, capability_snapshot: snapshot };
    const mutation = () => executeK10Operation(definition.action_id, operation.operation, input, context, this.#dependencies.client);

    try {
      let result: JsonValue;
      let status: K10ActionResult["status"] = "completed";
      if (operation.execution_gate === "inline") {
        result = await mutation();
      } else if (operation.execution_gate === "write_safety") {
        if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert.");
        result = await this.#dependencies.write_safety.execute(mutationRequest, mutation);
      } else {
        if (!this.#dependencies.write_safety || !this.#conflict) throw connectorError(context, "CONFIG_INVALID", "Der sichere Bestätigungsflow ist nicht konfiguriert.");
        const preview = await buildK10Preview(definition, operation, input, context, this.#dependencies.client);
        const availabilityRequests = await availabilityRequestsForMutation(mutationRequest, this.#dependencies.client);
        try {
          result = await this.#conflict.confirmOrPreview({ mutation: mutationRequest, ...preview, availability_requests: availabilityRequests, confirmation: confirmationFrom(input) }, () => this.#dependencies.write_safety!.execute(mutationRequest, mutation));
        } catch (error) {
          if (error instanceof BookingConflictDetected) throw connectorError(context, "CONFLICT", error.message);
          if (!isConnectorError(error) && error instanceof Error && /Bestätigung/u.test(error.message)) throw connectorError(context, "CONFIRMATION_MISMATCH", "Die Bestätigung ist ungültig, abgelaufen oder passt nicht mehr zur Wirkungsvorschau.");
          throw error;
        }
        if (result !== null && typeof result === "object" && !Array.isArray(result) && result.confirmation_required === true) status = "confirmation_required";
      }
      const parsed = K10_ACTION_SCHEMAS[definition.action_id].output.safeParse(result);
      if (!parsed.success) throw connectorError(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat keine freigegebene Buchungs-, Objekt- oder Aufgabenantwort geliefert.");
      assertJson(parsed.data, context);
      return { action_id: definition.action_id, operation: operation.operation, status, result: parsed.data };
    } catch (error) {
      if (isConnectorError(error) && error.code === "PERMISSION_DENIED") {
        await this.#dependencies.on_backend_forbidden?.({ action_id: definition.action_id, operation: operation.operation, context });
        throw connectorError(context, "PERMISSION_DENIED", "Der Fachservice hat die Aktion im aktuellen Kontext abgelehnt.");
      }
      if (isConnectorError(error) && error.code === "NOT_FOUND") throw connectorError(context, "NOT_FOUND", "Die angeforderte Buchungs-, Objekt- oder Aufgabenressource wurde nicht gefunden.");
      throw error;
    }
  }
}

export class BookingToolSet extends K10ToolSet { constructor(dependencies: K10ExecutionDependencies) { super("booking", dependencies); } }
export class ObjectToolSet extends K10ToolSet { constructor(dependencies: K10ExecutionDependencies) { super("object", dependencies); } }
export class TaskToolSet extends K10ToolSet { constructor(dependencies: K10ExecutionDependencies) { super("task", dependencies); } }

export function createK10ToolSets(dependencies: K10ExecutionDependencies): { booking: BookingToolSet; object: ObjectToolSet; task: TaskToolSet } {
  return { booking: new BookingToolSet(dependencies), object: new ObjectToolSet(dependencies), task: new TaskToolSet(dependencies) };
}
