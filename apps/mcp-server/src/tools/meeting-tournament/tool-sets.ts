import { ToolVisibilityPolicy, type CapabilitySnapshot, type ProviderToolUpdateMode } from "@comvenio/auth";
import { createConnectorError, isConnectorError, normalizeRequestContext, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import { z } from "zod";

import { K9_ACTION_DEFINITIONS, validateK9Definitions } from "./definitions.ts";
import { executeK9Operation, hasK9OperationHandler } from "./handlers.ts";
import { AgendaActionPolicy, TournamentJobPolicy } from "./policies.ts";
import { buildK9Preview } from "./preview.ts";
import { K9_ACTION_SCHEMAS } from "./schemas.ts";
import type {
  K9ActionDefinition,
  K9ActionId,
  K9ActionResult,
  K9Domain,
  K9ExecutionDependencies,
  K9ExecutionRequest,
  K9OperationDefinition,
} from "./types.ts";

export interface K9VisibilityRequest {
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

function operationFor(definition: K9ActionDefinition, input: JsonValue): K9OperationDefinition {
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

function visibilityDecision(visibility: ToolVisibilityPolicy, actionId: K9ActionId, operation: K9OperationDefinition, context: RequestContext, snapshot: CapabilitySnapshot | null, providerToolUpdates: ProviderToolUpdateMode) {
  return visibility.evaluate({
    tool: { tool_name: `${actionId}:${operation.operation}`, required_scopes: operation.required_scopes, permission_policy: operation.permission_policy, is_public: false },
    context,
    snapshot,
    provider_tool_updates: providerToolUpdates,
    catalog_contains_tool: true,
  });
}

function decisionError(operation: K9OperationDefinition, context: RequestContext, reason: ReturnType<typeof visibilityDecision>["reason"]): Error {
  if (reason === "SCOPE_REQUIRED") return createConnectorError({ code: "SCOPE_REQUIRED", message: "Der OAuth-Grant enthält nicht alle erforderlichen Meeting-/Turnier-Scopes.", request_id: context.request_id, retryable: false, required_scope: operation.required_scopes[0] });
  if (reason === "TENANT_MISMATCH" || reason === "DEPARTMENT_MISMATCH") return connectorError(context, "TENANT_MISMATCH", "Der Vereins- oder Abteilungskontext ist nicht zulässig.");
  if (reason === "CONTEXT_MISSING") return connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
  return connectorError(context, "PERMISSION_DENIED", "Die Meeting-/Turnier-Aktion ist im aktuellen Berechtigungskontext nicht erlaubt.");
}

function confirmationFrom(input: JsonValue): { preview_id: string; confirmation_token: string } | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input.confirmation;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.preview_id === "string" && typeof value.confirmation_token === "string" ? { preview_id: value.preview_id, confirmation_token: value.confirmation_token } : null;
}

function validateRuntimeCoverage(): void {
  for (const definition of Object.values(K9_ACTION_DEFINITIONS)) {
    if (!K9_ACTION_SCHEMAS[definition.action_id]) throw new Error(`${definition.action_id}: Schema fehlt.`);
    for (const operation of Object.values(definition.operations)) if (operation.execution_gate !== "job" && !hasK9OperationHandler(definition.action_id, operation.operation)) throw new Error(`${definition.action_id}:${operation.operation}: Handler fehlt.`);
  }
}

export abstract class K9ToolSet {
  readonly domain: K9Domain;
  readonly #dependencies: K9ExecutionDependencies;
  readonly #visibility: ToolVisibilityPolicy;
  readonly #confirmation: AgendaActionPolicy;
  readonly #jobs: TournamentJobPolicy;

  protected constructor(domain: K9Domain, dependencies: K9ExecutionDependencies, visibility: ToolVisibilityPolicy = new ToolVisibilityPolicy()) {
    validateK9Definitions();
    validateRuntimeCoverage();
    this.domain = domain;
    this.#dependencies = dependencies;
    this.#visibility = visibility;
    this.#confirmation = new AgendaActionPolicy();
    this.#jobs = new TournamentJobPolicy();
  }

  listDefinitions(): K9ActionDefinition[] {
    return Object.values(K9_ACTION_DEFINITIONS).filter((definition) => definition.domain === this.domain).map((definition) => structuredClone(definition));
  }

  listVisible(input: K9VisibilityRequest): K9ActionDefinition[] {
    const context = normalizeRequestContext(input.context);
    return this.listDefinitions().flatMap((definition) => {
      const operations = Object.fromEntries(Object.values(definition.operations).filter((operation) => {
        if (["write_safety", "agenda_confirmation"].includes(operation.execution_gate) && !this.#dependencies.write_safety) return false;
        if (operation.execution_gate === "job" && !this.#dependencies.job_starter) return false;
        return visibilityDecision(this.#visibility, definition.action_id, operation, context, input.capability_snapshot, input.provider_tool_updates ?? "dynamic").visible;
      }).map((operation) => [operation.operation, operation]));
      return Object.keys(operations).length ? [{ ...definition, operations }] : [];
    });
  }

  async execute(requestInput: K9ExecutionRequest): Promise<K9ActionResult> {
    const context = normalizeRequestContext(requestInput.context);
    const definition = K9_ACTION_DEFINITIONS[requestInput.action_id];
    if (!definition || definition.domain !== this.domain || definition.publication_state !== "implemented") throw connectorError(context, "NOT_FOUND", "Die angeforderte Meeting-/Turnier-Aktion ist nicht verfügbar.");
    let input: unknown;
    try {
      input = K9_ACTION_SCHEMAS[definition.action_id].input.parse(requestInput.input);
    } catch (error) {
      if (error instanceof z.ZodError) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe entspricht nicht dem freigegebenen Meeting-/Turnier-Schema.");
      throw error;
    }
    assertJson(input, context);
    let operation: K9OperationDefinition;
    try {
      operation = operationFor(definition, input);
    } catch {
      throw connectorError(context, "VALIDATION_FAILED", "Die angeforderte Teiloperation ist nicht freigegeben.");
    }
    if (context.club_id === null) throw connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
    const data = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
    if (data.club_id !== context.club_id) throw connectorError(context, "TENANT_MISMATCH", "Der Tool-Aufruf gehört nicht zum ausgewählten Verein.");
    if (context.department_id !== null && targetDepartmentIds(input).some((id) => id !== context.department_id)) throw connectorError(context, "TENANT_MISMATCH", "Die Aktion überschreitet den gewählten Abteilungskontext.");

    const decision = visibilityDecision(this.#visibility, definition.action_id, operation, context, requestInput.capability_snapshot, "dynamic");
    if (!decision.authorized) throw decisionError(operation, context, decision.reason);
    const snapshot = requestInput.capability_snapshot;
    if (!snapshot) throw connectorError(context, "PERMISSION_DENIED", "Der aktuelle Berechtigungskontext fehlt.");
    const mutationRequest = { definition, operation, input, context, capability_snapshot: snapshot };
    const mutation = () => executeK9Operation(definition.action_id, operation.operation, input, context, this.#dependencies.client);

    try {
      let result: JsonValue;
      let status: K9ActionResult["status"] = "completed";
      if (operation.execution_gate === "job") {
        if (!this.#dependencies.job_starter || !this.#jobs.requiresJob(mutationRequest)) throw connectorError(context, "CONFIG_INVALID", "Der sichere Meeting-/Turnier-Job-Start ist nicht konfiguriert.");
        result = await this.#dependencies.job_starter.start(mutationRequest);
        status = "queued";
      } else if (operation.execution_gate === "write_safety") {
        if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert.");
        result = await this.#dependencies.write_safety.execute(mutationRequest, mutation);
      } else if (operation.execution_gate === "agenda_confirmation") {
        if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert.");
        const preview = await buildK9Preview(definition, operation, input, context, this.#dependencies.client);
        const confirmation = this.#dependencies.agenda_confirmation ?? this.#confirmation;
        try {
          result = await confirmation.confirmOrPreview({ mutation: mutationRequest, ...preview, confirmation: confirmationFrom(input) }, () => this.#dependencies.write_safety!.execute(mutationRequest, mutation));
        } catch (error) {
          if (!isConnectorError(error) && error instanceof Error && /Bestätigung/u.test(error.message)) throw connectorError(context, "CONFIRMATION_MISMATCH", "Die Bestätigung ist ungültig, abgelaufen oder passt nicht mehr zur Wirkungsvorschau.");
          throw error;
        }
        if (result !== null && typeof result === "object" && !Array.isArray(result) && result.confirmation_required === true) status = "confirmation_required";
      } else {
        result = await mutation();
      }
      const parsed = K9_ACTION_SCHEMAS[definition.action_id].output.safeParse(result);
      if (!parsed.success) throw connectorError(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat keine freigegebene Meeting-/Turnier-Antwort geliefert.");
      assertJson(parsed.data, context);
      return { action_id: definition.action_id, operation: operation.operation, status, result: parsed.data };
    } catch (error) {
      if (isConnectorError(error) && error.code === "PERMISSION_DENIED") {
        await this.#dependencies.on_backend_forbidden?.({ action_id: definition.action_id, operation: operation.operation, context });
        throw connectorError(context, "PERMISSION_DENIED", "Der Fachservice hat die Meeting-/Turnier-Aktion im aktuellen Kontext abgelehnt.");
      }
      if (isConnectorError(error) && error.code === "NOT_FOUND") throw connectorError(context, "NOT_FOUND", "Die angeforderte Meeting-/Turnier-Ressource wurde nicht gefunden.");
      throw error;
    }
  }
}

export class MeetingToolSet extends K9ToolSet {
  constructor(dependencies: K9ExecutionDependencies) { super("meeting", dependencies); }
}

export class TournamentToolSet extends K9ToolSet {
  constructor(dependencies: K9ExecutionDependencies) { super("tournament", dependencies); }
}

export function createK9ToolSets(dependencies: K9ExecutionDependencies): { meeting: MeetingToolSet; tournament: TournamentToolSet } {
  return { meeting: new MeetingToolSet(dependencies), tournament: new TournamentToolSet(dependencies) };
}
