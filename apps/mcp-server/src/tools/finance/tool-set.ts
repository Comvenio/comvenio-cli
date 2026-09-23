import { ToolVisibilityPolicy, type CapabilitySnapshot, type ProviderToolUpdateMode } from "@comvenio/auth";
import { createConnectorError, isConnectorError, normalizeRequestContext, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import { z } from "zod";
import { K14_ACTION_DEFINITIONS, validateK14Definitions } from "./definitions.ts";
import { executeK14Operation, hasK14OperationHandler } from "./handlers.ts";
import { FinanceConfirmationPolicy } from "./policies.ts";
import { buildK14Preview } from "./preview.ts";
import { K14_ACTION_SCHEMAS } from "./schemas.ts";
import type { K14ActionDefinition, K14ActionResult, K14ExecutionDependencies, K14ExecutionRequest, K14MutationRequest, K14OperationDefinition } from "./types.ts";

// Alles, was am Plan selbst haengt — Lesen wie Schreiben.
const PLAN_ACTIONS = new Set<string>([
  "cai.finance.01.plan_list", "cai.finance.02.plan_show", "cai.finance.03.plan_create",
  "cai.finance.04.plan_update", "cai.finance.05.plan_close", "cai.finance.07.plan_copy",
]);

export interface K14VisibilityRequest { context: RequestContext; capability_snapshot: CapabilitySnapshot | null; provider_tool_updates?: ProviderToolUpdateMode; }
function error(context: RequestContext, code: Parameters<typeof createConnectorError>[0]["code"], message: string): Error { return createConnectorError({ code, message, request_id: context.request_id, retryable: false }); }
function assertJson(value: unknown, context: RequestContext): asserts value is JsonValue { if (!z.json().safeParse(value).success) throw error(context, "VALIDATION_FAILED", "Die Tool-Eingabe enthält ungültige JSON-Werte."); }
function operationFor(definition: K14ActionDefinition, input: JsonValue): K14OperationDefinition { const row = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {}; const names = Object.keys(definition.operations); const name = typeof row.operation === "string" ? row.operation : names.length === 1 ? names[0] : null; const operation = name ? definition.operations[name] : null; if (!operation) throw new Error("Operation fehlt."); return operation; }
// Sucht ein ausdrueckliches `department_id: null` — im Rumpf wie in `changes`.
function setztAbteilungAufNull(value: JsonValue): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(setztAbteilungAufNull);
  return Object.entries(value).some(([key, entry]) => (key === "department_id" && entry === null) || setztAbteilungAufNull(entry));
}
function valuesFor(value: JsonValue, keys: Set<string>): string[] { if (value === null || typeof value !== "object") return []; if (Array.isArray(value)) return value.flatMap((entry) => valuesFor(entry, keys)); return Object.entries(value).flatMap(([key, entry]) => keys.has(key) && typeof entry === "string" ? [entry] : valuesFor(entry, keys)); }
function confirmationFrom(input: JsonValue): { preview_id: string; confirmation_token: string } | null { if (input === null || typeof input !== "object" || Array.isArray(input)) return null; const value = input.confirmation; return value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.preview_id === "string" && typeof value.confirmation_token === "string" ? { preview_id: value.preview_id, confirmation_token: value.confirmation_token } : null; }
function withoutConfirmation(input: JsonValue): JsonValue { if (input === null || typeof input !== "object" || Array.isArray(input)) return input; return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "confirmation")) as JsonValue; }
function visibilityDecision(visibility: ToolVisibilityPolicy, definition: K14ActionDefinition, operation: K14OperationDefinition, context: RequestContext, snapshot: CapabilitySnapshot | null, updates: ProviderToolUpdateMode) { return visibility.evaluate({ tool: { tool_name: `${definition.action_id}:${operation.operation}`, required_scopes: operation.required_scopes, permission_policy: operation.permission_policy, is_public: false }, context, snapshot, provider_tool_updates: updates, catalog_contains_tool: true }); }
function decisionError(operation: K14OperationDefinition, context: RequestContext, reason: ReturnType<typeof visibilityDecision>["reason"]): Error {
  if (reason === "SCOPE_REQUIRED") return createConnectorError({ code: "SCOPE_REQUIRED", message: "Der OAuth-Grant enthält den benötigten Finanz-Scope nicht.", request_id: context.request_id, retryable: false, required_scope: operation.required_scopes[0] });
  if (["TENANT_MISMATCH", "DEPARTMENT_MISMATCH"].includes(reason)) return error(context, "TENANT_MISMATCH", "Der Vereins- oder Abteilungskontext ist nicht zulässig.");
  if (reason === "CONTEXT_MISSING") return error(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
  // Eine veraltete Berechtigungsauskunft ist kein fehlendes Recht. Als
  // PERMISSION_DENIED gemeldet — so machen es die anderen Bereiche — würde sie
  // den Menschen dazu bringen, seine Rechte zu prüfen, und die stimmen. Zu
  // erneuern ist die Verbindung, und genau das sagt AUTH_REQUIRED. Ein eigener
  // Code wäre treffender, aber die Fehler-Union teilen sich alle Bereiche.
  if (reason === "VERSION_STALE") return error(context, "AUTH_REQUIRED", "Die Berechtigungsauskunft ist veraltet. Bitte die Verbindung erneuern.");
  return error(context, "PERMISSION_DENIED", "Die Finanz-Aktion ist im aktuellen Berechtigungskontext nicht erlaubt.");
}
function validateRuntime(): void {
  for (const definition of Object.values(K14_ACTION_DEFINITIONS)) {
    if (!K14_ACTION_SCHEMAS[definition.action_id]) throw new Error(`${definition.action_id}: Schema fehlt.`);
    for (const operation of Object.values(definition.operations)) if (!hasK14OperationHandler(definition.action_id, operation.operation)) throw new Error(`${definition.action_id}:${operation.operation}: Handler fehlt.`);
  }
}

export class FinanceToolSet {
  readonly #dependencies: K14ExecutionDependencies; readonly #visibility: ToolVisibilityPolicy; readonly #confirmation: NonNullable<K14ExecutionDependencies["confirmation"]>;
  constructor(dependencies: K14ExecutionDependencies, visibility = new ToolVisibilityPolicy()) { validateK14Definitions(); validateRuntime(); this.#dependencies = dependencies; this.#visibility = visibility; this.#confirmation = dependencies.confirmation ?? new FinanceConfirmationPolicy(); }
  listDefinitions(): K14ActionDefinition[] { return Object.values(K14_ACTION_DEFINITIONS).map((definition) => structuredClone(definition)); }
  // Kein `publicReadContracts`: Es gibt keine öffentliche Sicht auf die
  // Vereinsbuchhaltung, und ein leerer Vertrag wäre eine Einladung, später
  // einen hineinzuschreiben.
  listVisible(input: K14VisibilityRequest): K14ActionDefinition[] {
    const context = normalizeRequestContext(input.context);
    return this.listDefinitions().flatMap((definition) => {
      const operations = Object.fromEntries(Object.values(definition.operations).filter((operation) => {
        if (["write_safety", "confirmation"].includes(operation.execution_gate) && !this.#dependencies.write_safety) return false;
        return visibilityDecision(this.#visibility, definition, operation, context, input.capability_snapshot, input.provider_tool_updates ?? "dynamic").visible;
      }).map((operation) => [operation.operation, operation]));
      return Object.keys(operations).length ? [{ ...definition, operations }] : [];
    });
  }

  async execute(requestInput: K14ExecutionRequest): Promise<K14ActionResult> {
    const context = normalizeRequestContext(requestInput.context);
    const definition = K14_ACTION_DEFINITIONS[requestInput.action_id];
    if (!definition) throw error(context, "NOT_FOUND", "Die angeforderte Finanz-Aktion ist nicht verfügbar.");
    let input: unknown;
    try { input = K14_ACTION_SCHEMAS[definition.action_id].input.parse(requestInput.input); } catch (cause) { if (cause instanceof z.ZodError) throw error(context, "VALIDATION_FAILED", "Die Tool-Eingabe entspricht nicht dem freigegebenen Finanz-Schema."); throw cause; }
    assertJson(input, context);
    let operation: K14OperationDefinition;
    try { operation = operationFor(definition, input); } catch { throw error(context, "VALIDATION_FAILED", "Die angeforderte Teiloperation ist nicht freigegeben."); }
    if (!context.club_id) throw error(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
    if (valuesFor(input, new Set(["club_id"])).some((id) => id !== context.club_id)) throw error(context, "TENANT_MISMATCH", "Der Tool-Aufruf gehört nicht zum ausgewählten Verein.");
    if (context.department_id && valuesFor(input, new Set(["department_id"])).some((id) => id !== context.department_id)) throw error(context, "TENANT_MISMATCH", "Die Aktion überschreitet den gewählten Abteilungskontext.");
    // Die vereinsweite Zusammenfassung enthält notwendig die Zahlen aller
    // Abteilungen. Wer in einem Abteilungskontext arbeitet, bekommt sie nicht
    // gefiltert, sondern gar nicht — mit dem Hinweis auf die Aktion, die passt.
    if (definition.action_id === "cai.finance.14.summary" && operation.operation === "total" && context.department_id) {
      throw error(context, "TENANT_MISMATCH", "Die vereinsweite Zusammenfassung ist im Abteilungskontext nicht verfügbar. Nutze die Teiloperation „by_department“.");
    }
    // Ein Jahresplan gehört dem Verein, nicht einer Abteilung: Er trägt das
    // verfügbare Kapital und den Status, der für ALLE Abteilungen gilt. Im
    // Abteilungskontext wäre jede Planaktion eine Grenzüberschreitung — Lesen
    // zeigt das Vereinskapital, Schreiben sperrt oder öffnet das Jahr für
    // Abteilungen, die nichts davon wissen. Der Filter `department_scope`
    // leistet das nicht: `optional` heisst „darf, muss aber nicht", und die
    // Pläne tragen selbst kein `department_id`, an dem der Abgleich greifen
    // könnte. Fremdvalidierung Runde 1 (2026-09-21).
    if (PLAN_ACTIONS.has(definition.action_id) && context.department_id) {
      throw error(context, "TENANT_MISMATCH", "Der Jahresplan gehört dem Verein, nicht einer Abteilung. Wechsle in den vereinsweiten Kontext.");
    }
    // Ein Posten ohne Abteilung ist vereinsweit. Im Abteilungskontext angelegt,
    // entstünde er ausserhalb der eigenen Grenze — deshalb wird sie hier
    // gesetzt statt stillschweigend weggelassen.
    if (definition.action_id === "cai.finance.09.position_create" && context.department_id
      && !valuesFor(input, new Set(["department_id"])).length) {
      throw error(context, "VALIDATION_FAILED", "Im Abteilungskontext braucht ein Budgetposten die eigene Abteilung in „department_id“.");
    }
    // `department_id: null` ist keine Auslassung, sondern eine Verschiebung:
    // Der Posten wird vereinsweit und verlaesst damit die eigene Abteilung.
    // Der Abgleich oben sieht das nicht — `valuesFor` sammelt nur Strings.
    // Fremdvalidierung Runde 2 (2026-09-21).
    if (context.department_id && setztAbteilungAufNull(input)) {
      throw error(context, "TENANT_MISMATCH", "Einen Posten aus der Abteilung in den vereinsweiten Bereich zu verschieben, verlangt einen vereinsweiten Kontext.");
    }
    const decision = visibilityDecision(this.#visibility, definition, operation, context, requestInput.capability_snapshot, "dynamic");
    if (!decision.authorized) throw decisionError(operation, context, decision.reason);
    const snapshot = requestInput.capability_snapshot;
    if (!snapshot) throw error(context, "PERMISSION_DENIED", "Der aktuelle Berechtigungskontext fehlt.");
    const mutationRequest: K14MutationRequest = { definition, operation, input, context, capability_snapshot: snapshot };
    const safeMutationRequest = { ...mutationRequest, input: withoutConfirmation(input) };
    const mutation = () => executeK14Operation(definition.action_id, operation.operation, input, context, this.#dependencies.client);
    try {
      let result: JsonValue; let status: K14ActionResult["status"] = "completed";
      if (operation.execution_gate === "inline") result = await mutation();
      else if (operation.execution_gate === "write_safety") { if (!this.#dependencies.write_safety) throw error(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert."); result = await this.#dependencies.write_safety.execute(safeMutationRequest, mutation); }
      else {
        if (!this.#dependencies.write_safety) throw error(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist nicht konfiguriert.");
        // The preview reads (sub positions, the frame so far) only for the call
        // that shows it; the confirmed call needs no second read.
        const preview = await buildK14Preview(definition, operation, input, context, confirmationFrom(input) ? undefined : this.#dependencies.client);
        result = await this.#confirmation.confirmOrPreview({ mutation: mutationRequest, ...preview, confirmation: confirmationFrom(input) }, () => this.#dependencies.write_safety!.execute(safeMutationRequest, mutation));
        if (result !== null && typeof result === "object" && !Array.isArray(result) && result.confirmation_required === true) status = "confirmation_required";
      }
      const parsed = K14_ACTION_SCHEMAS[definition.action_id].output.safeParse(result);
      if (!parsed.success) throw error(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat keine freigegebene Antwort geliefert.");
      assertJson(parsed.data, context);
      return { action_id: definition.action_id, operation: operation.operation, status, result: parsed.data };
    } catch (cause) {
      if (isConnectorError(cause) && cause.code === "PERMISSION_DENIED") { await this.#dependencies.on_backend_forbidden?.({ action_id: definition.action_id, operation: operation.operation, context }); throw error(context, "PERMISSION_DENIED", "Der Finance-Service hat die Buchhaltungs-Aktion im aktuellen Kontext abgelehnt."); }
      if (isConnectorError(cause) && cause.code === "NOT_FOUND") throw error(context, "NOT_FOUND", "Der angeforderte Finanz-Datensatz wurde nicht gefunden.");
      throw cause;
    }
  }
}
export function createK14ToolSet(dependencies: K14ExecutionDependencies): FinanceToolSet { return new FinanceToolSet(dependencies); }
