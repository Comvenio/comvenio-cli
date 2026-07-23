import { ToolVisibilityPolicy, type CapabilitySnapshot, type ProviderToolUpdateMode } from "@comvenio/auth";
import { createConnectorError, isConnectorError, normalizeRequestContext, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import { z } from "zod";

import { PUBLIC_READ_CONTRACTS } from "../../public/contracts.ts";
import { K11_ACTION_DEFINITIONS, validateK11Definitions } from "./definitions.ts";
import { executeK11Operation, hasK11OperationHandler } from "./handlers.ts";
import { SupplyChangeConfirmationPolicy, SupplyJobPolicy } from "./policies.ts";
import { buildK11Preview } from "./preview.ts";
import { K11_ACTION_SCHEMAS } from "./schemas.ts";
import type { K11ActionDefinition, K11ActionId, K11ActionResult, K11Domain, K11ExecutionDependencies, K11ExecutionRequest, K11OperationDefinition } from "./types.ts";

export interface K11VisibilityRequest { context: RequestContext; capability_snapshot: CapabilitySnapshot | null; provider_tool_updates?: ProviderToolUpdateMode; }
function connectorError(context: RequestContext, code: Parameters<typeof createConnectorError>[0]["code"], message: string): Error { return createConnectorError({ code, message, request_id: context.request_id, retryable: false }); }
function assertJson(value: unknown, context: RequestContext): asserts value is JsonValue { if (!z.json().safeParse(value).success) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe enthält ungültige JSON-Werte."); }
function operationFor(definition: K11ActionDefinition, input: JsonValue): K11OperationDefinition {
  const data = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {}; const names = Object.keys(definition.operations);
  const name = typeof data.operation === "string" ? data.operation : names.length === 1 ? names[0] : null; const operation = name ? definition.operations[name] : null;
  if (!operation) throw new Error("Die Teiloperation ist nicht definiert."); return operation;
}
function valuesForKey(value: JsonValue, target: string): string[] {
  if (value === null || typeof value !== "object") return []; if (Array.isArray(value)) return value.flatMap((item) => valuesForKey(item, target));
  return Object.entries(value).flatMap(([key, entry]) => key === target && typeof entry === "string" ? [entry] : valuesForKey(entry, target));
}
function visibilityDecision(visibility: ToolVisibilityPolicy, actionId: K11ActionId, operation: K11OperationDefinition, context: RequestContext, snapshot: CapabilitySnapshot | null, updates: ProviderToolUpdateMode) {
  return visibility.evaluate({ tool: { tool_name: `${actionId}:${operation.operation}`, required_scopes: operation.required_scopes, permission_policy: operation.permission_policy, is_public: false }, context, snapshot, provider_tool_updates: updates, catalog_contains_tool: true });
}
function decisionError(operation: K11OperationDefinition, context: RequestContext, reason: ReturnType<typeof visibilityDecision>["reason"]): Error {
  if (reason === "SCOPE_REQUIRED") return createConnectorError({ code: "SCOPE_REQUIRED", message: "Der OAuth-Grant enthält nicht alle erforderlichen Supply- oder Datei-Scopes.", request_id: context.request_id, retryable: false, required_scope: operation.required_scopes[0] });
  if (reason === "TENANT_MISMATCH" || reason === "DEPARTMENT_MISMATCH") return connectorError(context, "TENANT_MISMATCH", "Der Vereins- oder Abteilungskontext ist nicht zulässig.");
  if (reason === "CONTEXT_MISSING") return connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
  return connectorError(context, "PERMISSION_DENIED", "Die Supply-, Menü- oder Einkaufsaktion ist im aktuellen Berechtigungskontext nicht erlaubt.");
}
function confirmationFrom(input: JsonValue): { preview_id: string; confirmation_token: string } | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null; const value = input.confirmation;
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.preview_id === "string" && typeof value.confirmation_token === "string" ? { preview_id: value.preview_id, confirmation_token: value.confirmation_token } : null;
}
function validateRuntimeCoverage(): void {
  for (const definition of Object.values(K11_ACTION_DEFINITIONS)) {
    if (!K11_ACTION_SCHEMAS[definition.action_id]) throw new Error(`${definition.action_id}: Schema fehlt.`);
    for (const operation of Object.values(definition.operations)) if (operation.execution_gate !== "job" && !hasK11OperationHandler(definition.action_id, operation.operation)) throw new Error(`${definition.action_id}:${operation.operation}: Handler fehlt.`);
  }
}

export abstract class K11ToolSet {
  readonly domain: K11Domain;
  readonly #dependencies: K11ExecutionDependencies;
  readonly #visibility: ToolVisibilityPolicy;
  readonly #confirmation: NonNullable<K11ExecutionDependencies["confirmation"]>;
  readonly #jobs = new SupplyJobPolicy();
  protected constructor(domain: K11Domain, dependencies: K11ExecutionDependencies, visibility = new ToolVisibilityPolicy()) {
    validateK11Definitions(); validateRuntimeCoverage(); this.domain = domain; this.#dependencies = dependencies; this.#visibility = visibility;
    this.#confirmation = dependencies.confirmation ?? new SupplyChangeConfirmationPolicy();
  }
  listDefinitions(): K11ActionDefinition[] { return Object.values(K11_ACTION_DEFINITIONS).filter((definition) => definition.domain === this.domain).map((definition) => structuredClone(definition)); }
  listVisible(input: K11VisibilityRequest): K11ActionDefinition[] {
    const context = normalizeRequestContext(input.context);
    return this.listDefinitions().flatMap((definition) => {
      const operations = Object.fromEntries(Object.values(definition.operations).filter((operation) => {
        if (["write_safety", "confirmation"].includes(operation.execution_gate) && !this.#dependencies.write_safety) return false;
        if (operation.execution_gate === "job" && !this.#dependencies.job_starter) return false;
        return visibilityDecision(this.#visibility, definition.action_id, operation, context, input.capability_snapshot, input.provider_tool_updates ?? "dynamic").visible;
      }).map((operation) => [operation.operation, operation]));
      return Object.keys(operations).length ? [{ ...definition, operations }] : [];
    });
  }
  async execute(requestInput: K11ExecutionRequest): Promise<K11ActionResult> {
    const context = normalizeRequestContext(requestInput.context); const definition = K11_ACTION_DEFINITIONS[requestInput.action_id];
    if (!definition || definition.domain !== this.domain || definition.publication_state !== "implemented") throw connectorError(context, "NOT_FOUND", "Die angeforderte Supply-, Menü- oder Einkaufsaktion ist nicht verfügbar.");
    let input: unknown; try { input = K11_ACTION_SCHEMAS[definition.action_id].input.parse(requestInput.input); } catch (error) { if (error instanceof z.ZodError) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe entspricht nicht dem freigegebenen Supply-Schema."); throw error; }
    assertJson(input, context); let operation: K11OperationDefinition; try { operation = operationFor(definition, input); } catch { throw connectorError(context, "VALIDATION_FAILED", "Die angeforderte Teiloperation ist nicht freigegeben."); }
    if (context.club_id === null) throw connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
    if (valuesForKey(input, "club_id").some((id) => id !== context.club_id)) throw connectorError(context, "TENANT_MISMATCH", "Der Tool-Aufruf gehört nicht zum ausgewählten Verein.");
    if (context.department_id !== null && valuesForKey(input, "department_id").some((id) => id !== context.department_id)) throw connectorError(context, "TENANT_MISMATCH", "Die Aktion überschreitet den gewählten Abteilungskontext.");
    const decision = visibilityDecision(this.#visibility, definition.action_id, operation, context, requestInput.capability_snapshot, "dynamic"); if (!decision.authorized) throw decisionError(operation, context, decision.reason);
    const snapshot = requestInput.capability_snapshot; if (!snapshot) throw connectorError(context, "PERMISSION_DENIED", "Der aktuelle Berechtigungskontext fehlt.");
    const mutationRequest = { definition, operation, input, context, capability_snapshot: snapshot }; const mutation = () => executeK11Operation(definition.action_id, operation.operation, input, context, this.#dependencies.client);
    try {
      let result: JsonValue; let status: K11ActionResult["status"] = "completed";
      if (operation.execution_gate === "inline") result = await mutation();
      else if (operation.execution_gate === "job") {
        if (!this.#dependencies.job_starter || !this.#jobs.requiresJob(mutationRequest)) throw connectorError(context, "CONFIG_INVALID", "Der sichere Supply-Job-Start ist nicht konfiguriert.");
        result = await this.#dependencies.job_starter.start(mutationRequest); status = "queued";
      } else if (operation.execution_gate === "write_safety") {
        if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert."); result = await this.#dependencies.write_safety.execute(mutationRequest, mutation);
      } else {
        if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert.");
        const preview = await buildK11Preview(definition, operation, input, context, this.#dependencies.client);
        try { result = await this.#confirmation.confirmOrPreview({ mutation: mutationRequest, ...preview, confirmation: confirmationFrom(input) }, () => this.#dependencies.write_safety!.execute(mutationRequest, mutation)); }
        catch (error) { if (!isConnectorError(error) && error instanceof Error && /Bestätigung/u.test(error.message)) throw connectorError(context, "CONFIRMATION_MISMATCH", "Die Bestätigung ist ungültig, abgelaufen oder passt nicht mehr zur Wirkungsvorschau."); throw error; }
        if (result !== null && typeof result === "object" && !Array.isArray(result) && result.confirmation_required === true) status = "confirmation_required";
      }
      const parsed = K11_ACTION_SCHEMAS[definition.action_id].output.safeParse(result); if (!parsed.success) throw connectorError(context, "UPSTREAM_UNAVAILABLE", "Der Supply-Service hat keine freigegebene Antwort geliefert.");
      assertJson(parsed.data, context); return { action_id: definition.action_id, operation: operation.operation, status, result: parsed.data };
    } catch (error) {
      if (isConnectorError(error) && error.code === "PERMISSION_DENIED") { await this.#dependencies.on_backend_forbidden?.({ action_id: definition.action_id, operation: operation.operation, context }); throw connectorError(context, "PERMISSION_DENIED", "Der Supply-Service hat die Aktion im aktuellen Kontext abgelehnt."); }
      if (isConnectorError(error) && error.code === "CONFLICT" && definition.action_id === "cai.shopping.procurement.activate") {
        throw connectorError(context, "CONFLICT", "Bereits angelegt");
      }
      if (isConnectorError(error) && error.code === "NOT_FOUND") throw connectorError(context, "NOT_FOUND", "Die angeforderte Supply-Ressource wurde nicht gefunden."); throw error;
    }
  }
}

export class RecipeToolSet extends K11ToolSet { constructor(dependencies: K11ExecutionDependencies) { super("recipe", dependencies); } }
export class IngredientToolSet extends K11ToolSet { constructor(dependencies: K11ExecutionDependencies) { super("ingredient", dependencies); } }
export class IngredientCategoryToolSet extends K11ToolSet { constructor(dependencies: K11ExecutionDependencies) { super("ingredient-category", dependencies); } }
export class ShoppingToolSet extends K11ToolSet { constructor(dependencies: K11ExecutionDependencies) { super("shopping", dependencies); } }
export class TemplateToolSet extends K11ToolSet { constructor(dependencies: K11ExecutionDependencies) { super("template", dependencies); } }
export class MenuToolSet extends K11ToolSet {
  constructor(dependencies: K11ExecutionDependencies) { super("menu", dependencies); }
  publicReadContracts() { return [structuredClone(PUBLIC_READ_CONTRACTS.public_menu), structuredClone(PUBLIC_READ_CONTRACTS.public_event_menu)]; }
}
export function createK11ToolSets(dependencies: K11ExecutionDependencies) {
  return { recipe: new RecipeToolSet(dependencies), ingredient: new IngredientToolSet(dependencies), ingredient_category: new IngredientCategoryToolSet(dependencies), shopping: new ShoppingToolSet(dependencies), template: new TemplateToolSet(dependencies), menu: new MenuToolSet(dependencies) };
}
