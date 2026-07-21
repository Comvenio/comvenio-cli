import { ToolVisibilityPolicy, type CapabilitySnapshot, type ProviderToolUpdateMode } from "@comvenio/auth";
import { createConnectorError, isConnectorError, normalizeRequestContext, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import { z } from "zod";

import { PUBLIC_READ_CONTRACTS } from "../../public/contracts.ts";
import { K12_ACTION_DEFINITIONS, validateK12Definitions } from "./definitions.ts";
import { executeK12Operation, hasK12OperationHandler } from "./handlers.ts";
import { ContentChangeConfirmationPolicy, ContentJobPolicy } from "./policies.ts";
import { buildK12Preview } from "./preview.ts";
import { K12_ACTION_SCHEMAS } from "./schemas.ts";
import type { K12ActionDefinition, K12ActionId, K12ActionResult, K12Domain, K12ExecutionDependencies, K12ExecutionRequest, K12OperationDefinition } from "./types.ts";

export interface K12VisibilityRequest { context: RequestContext; capability_snapshot: CapabilitySnapshot | null; provider_tool_updates?: ProviderToolUpdateMode; }
function connectorError(context: RequestContext, code: Parameters<typeof createConnectorError>[0]["code"], message: string): Error { return createConnectorError({ code, message, request_id: context.request_id, retryable: false }); }
function assertJson(value: unknown, context: RequestContext): asserts value is JsonValue { if (!z.json().safeParse(value).success) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe enthält ungültige JSON-Werte."); }
function operationFor(definition: K12ActionDefinition, input: JsonValue): K12OperationDefinition {
  const value = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {}; const names = Object.keys(definition.operations);
  const name = typeof value.operation === "string" ? value.operation : names.length === 1 ? names[0] : null; const operation = name ? definition.operations[name] : null;
  if (!operation) throw new Error("Die Teiloperation ist nicht definiert."); return operation;
}
function valuesForKey(value: JsonValue, target: string): string[] { if (value === null || typeof value !== "object") return []; if (Array.isArray(value)) return value.flatMap((entry) => valuesForKey(entry, target)); return Object.entries(value).flatMap(([key, entry]) => key === target && typeof entry === "string" ? [entry] : valuesForKey(entry, target)); }
function visibilityDecision(visibility: ToolVisibilityPolicy, actionId: K12ActionId, operation: K12OperationDefinition, context: RequestContext, snapshot: CapabilitySnapshot | null, updates: ProviderToolUpdateMode) {
  return visibility.evaluate({ tool: { tool_name: `${actionId}:${operation.operation}`, required_scopes: operation.required_scopes, permission_policy: operation.permission_policy, is_public: false }, context, snapshot, provider_tool_updates: updates, catalog_contains_tool: true });
}
function decisionError(operation: K12OperationDefinition, context: RequestContext, reason: ReturnType<typeof visibilityDecision>["reason"]): Error {
  if (reason === "SCOPE_REQUIRED") return createConnectorError({ code: "SCOPE_REQUIRED", message: "Der OAuth-Grant enthält nicht alle erforderlichen Content- oder Datei-Scopes.", request_id: context.request_id, retryable: false, required_scope: operation.required_scopes[0] });
  if (reason === "TENANT_MISMATCH" || reason === "DEPARTMENT_MISMATCH") return connectorError(context, "TENANT_MISMATCH", "Der Vereins- oder Abteilungskontext ist nicht zulässig.");
  if (reason === "CONTEXT_MISSING") return connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
  return connectorError(context, "PERMISSION_DENIED", "Die Content-, Homepage-, Daten- oder Verifikationsaktion ist im aktuellen Berechtigungskontext nicht erlaubt.");
}
function confirmationFrom(input: JsonValue): { preview_id: string; confirmation_token: string } | null { if (input === null || typeof input !== "object" || Array.isArray(input)) return null; const value = input.confirmation; return value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.preview_id === "string" && typeof value.confirmation_token === "string" ? { preview_id: value.preview_id, confirmation_token: value.confirmation_token } : null; }
function withoutConfirmation(input: JsonValue): JsonValue {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "confirmation")) as JsonValue;
}
function validateRuntimeCoverage(): void {
  for (const definition of Object.values(K12_ACTION_DEFINITIONS)) {
    if (!K12_ACTION_SCHEMAS[definition.action_id]) throw new Error(`${definition.action_id}: Schema fehlt.`);
    for (const operation of Object.values(definition.operations)) if (!["job", "confirmed_job"].includes(operation.execution_gate) && !hasK12OperationHandler(definition.action_id, operation.operation)) throw new Error(`${definition.action_id}:${operation.operation}: Handler fehlt.`);
  }
}

export abstract class K12ToolSet {
  readonly domain: K12Domain;
  readonly #dependencies: K12ExecutionDependencies;
  readonly #visibility: ToolVisibilityPolicy;
  readonly #confirmation: NonNullable<K12ExecutionDependencies["confirmation"]>;
  readonly #jobs = new ContentJobPolicy();
  protected constructor(domain: K12Domain, dependencies: K12ExecutionDependencies, visibility = new ToolVisibilityPolicy()) { validateK12Definitions(); validateRuntimeCoverage(); this.domain = domain; this.#dependencies = dependencies; this.#visibility = visibility; this.#confirmation = dependencies.confirmation ?? new ContentChangeConfirmationPolicy(); }
  listDefinitions(): K12ActionDefinition[] { return Object.values(K12_ACTION_DEFINITIONS).filter((definition) => definition.domain === this.domain).map((definition) => structuredClone(definition)); }
  listVisible(input: K12VisibilityRequest): K12ActionDefinition[] {
    const context = normalizeRequestContext(input.context);
    return this.listDefinitions().flatMap((definition) => {
      const operations = Object.fromEntries(Object.values(definition.operations).filter((operation) => {
        if (["write_safety", "confirmation"].includes(operation.execution_gate) && !this.#dependencies.write_safety) return false;
        if (["job", "confirmed_job"].includes(operation.execution_gate) && !this.#dependencies.job_starter) return false;
        if (definition.action_id === "cai.verify.01.url" && !this.#dependencies.verify_target_guard) return false;
        return visibilityDecision(this.#visibility, definition.action_id, operation, context, input.capability_snapshot, input.provider_tool_updates ?? "dynamic").visible;
      }).map((operation) => [operation.operation, operation]));
      return Object.keys(operations).length ? [{ ...definition, operations }] : [];
    });
  }
  async execute(requestInput: K12ExecutionRequest): Promise<K12ActionResult> {
    const context = normalizeRequestContext(requestInput.context); const definition = K12_ACTION_DEFINITIONS[requestInput.action_id];
    if (!definition || definition.domain !== this.domain || definition.publication_state !== "implemented") throw connectorError(context, "NOT_FOUND", "Die angeforderte Content-Aktion ist nicht verfügbar.");
    let input: unknown; try { input = K12_ACTION_SCHEMAS[definition.action_id].input.parse(requestInput.input); } catch (error) { if (error instanceof z.ZodError) throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe entspricht nicht dem freigegebenen Content-Schema."); throw error; }
    assertJson(input, context); let operation: K12OperationDefinition; try { operation = operationFor(definition, input); } catch { throw connectorError(context, "VALIDATION_FAILED", "Die angeforderte Teiloperation ist nicht freigegeben."); }
    if (context.club_id === null) throw connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
    if (valuesForKey(input, "club_id").some((id) => id !== context.club_id)) throw connectorError(context, "TENANT_MISMATCH", "Der Tool-Aufruf gehört nicht zum ausgewählten Verein.");
    if (context.department_id !== null && [...valuesForKey(input, "department_id"), ...valuesForKey(input, "club_department_id")].some((id) => id !== context.department_id)) throw connectorError(context, "TENANT_MISMATCH", "Die Aktion überschreitet den gewählten Abteilungskontext.");
    const decision = visibilityDecision(this.#visibility, definition.action_id, operation, context, requestInput.capability_snapshot, "dynamic"); if (!decision.authorized) throw decisionError(operation, context, decision.reason);
    const snapshot = requestInput.capability_snapshot; if (!snapshot) throw connectorError(context, "PERMISSION_DENIED", "Der aktuelle Berechtigungskontext fehlt.");
    if (definition.action_id === "cai.verify.01.url") {
      const targetUrl = input !== null && typeof input === "object" && !Array.isArray(input) && typeof input.target_url === "string" ? input.target_url : null;
      if (!targetUrl || !this.#dependencies.verify_target_guard) throw connectorError(context, "CONFIG_INVALID", "Die DNS- und Redirect-Prüfung für externe Verifikationsziele ist nicht konfiguriert.");
      try { await this.#dependencies.verify_target_guard.assertSafe(targetUrl, context); }
      catch { throw connectorError(context, "VALIDATION_FAILED", "Das externe Verifikationsziel wurde durch die DNS-, IP- oder Redirect-Prüfung abgelehnt."); }
    }
    const mutationRequest = { definition, operation, input, context, capability_snapshot: snapshot }; const mutation = () => executeK12Operation(definition.action_id, operation.operation, input, context, this.#dependencies.client);
    const jobMutationRequest = { ...mutationRequest, input: withoutConfirmation(input) };
    try {
      let result: JsonValue; let status: K12ActionResult["status"] = "completed";
      if (operation.execution_gate === "inline") result = await mutation();
      else if (operation.execution_gate === "job") {
        if (!this.#dependencies.job_starter || !this.#jobs.requiresJob(jobMutationRequest)) throw connectorError(context, "CONFIG_INVALID", "Der sichere Content-Job-Start ist nicht konfiguriert.");
        result = await this.#dependencies.job_starter.start(jobMutationRequest); status = "queued";
      } else if (operation.execution_gate === "write_safety") {
        if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert."); result = await this.#dependencies.write_safety.execute(mutationRequest, mutation);
      } else {
        const preview = await buildK12Preview(definition, operation, input, context);
        const confirmedMutation = operation.execution_gate === "confirmed_job"
          ? async () => { if (!this.#dependencies.job_starter || !this.#jobs.requiresJob(jobMutationRequest)) throw connectorError(context, "CONFIG_INVALID", "Der sichere Content-Job-Start ist nicht konfiguriert."); return this.#dependencies.job_starter.start(jobMutationRequest); }
          : async () => { if (!this.#dependencies.write_safety) throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert."); return this.#dependencies.write_safety.execute(mutationRequest, mutation); };
        result = await this.#confirmation.confirmOrPreview({ mutation: mutationRequest, ...preview, confirmation: confirmationFrom(input) }, confirmedMutation);
        if (result !== null && typeof result === "object" && !Array.isArray(result) && result.confirmation_required === true) status = "confirmation_required";
        else if (operation.execution_gate === "confirmed_job") status = "queued";
      }
      const parsed = K12_ACTION_SCHEMAS[definition.action_id].output.safeParse(result); if (!parsed.success) throw connectorError(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat keine freigegebene Antwort geliefert.");
      assertJson(parsed.data, context); return { action_id: definition.action_id, operation: operation.operation, status, result: parsed.data };
    } catch (error) {
      if (isConnectorError(error) && error.code === "PERMISSION_DENIED") { await this.#dependencies.on_backend_forbidden?.({ action_id: definition.action_id, operation: operation.operation, context }); throw connectorError(context, "PERMISSION_DENIED", "Der Fachservice hat die Content-Aktion im aktuellen Kontext abgelehnt."); }
      if (isConnectorError(error) && error.code === "NOT_FOUND") throw connectorError(context, "NOT_FOUND", "Die angeforderte Content-Ressource wurde nicht gefunden."); throw error;
    }
  }
}

export class HomepageToolSet extends K12ToolSet { constructor(dependencies: K12ExecutionDependencies) { super("homepage", dependencies); } publicReadContracts() { return [structuredClone(PUBLIC_READ_CONTRACTS.public_club_home)]; } }
export class SchemaToolSet extends K12ToolSet { readonly coverage_status = "core-partial" as const; constructor(dependencies: K12ExecutionDependencies) { super("schema", dependencies); } }
export class VerifyToolSet extends K12ToolSet { constructor(dependencies: K12ExecutionDependencies) { super("verify", dependencies); } }
export class DataToolSet extends K12ToolSet { constructor(dependencies: K12ExecutionDependencies) { super("data", dependencies); } }
export class NewsToolSet extends K12ToolSet { constructor(dependencies: K12ExecutionDependencies) { super("news", dependencies); } publicReadContracts() { return [structuredClone(PUBLIC_READ_CONTRACTS.public_news), structuredClone(PUBLIC_READ_CONTRACTS.public_news_detail), structuredClone(PUBLIC_READ_CONTRACTS.public_department_news)]; } }
export function createK12ToolSets(dependencies: K12ExecutionDependencies) { return { homepage: new HomepageToolSet(dependencies), schema: new SchemaToolSet(dependencies), verify: new VerifyToolSet(dependencies), data: new DataToolSet(dependencies), news: new NewsToolSet(dependencies) }; }
