import {
  ToolVisibilityPolicy,
  type CapabilitySnapshot,
  type ProviderToolUpdateMode,
} from "@comvenio/auth";
import {
  createConnectorError,
  isConnectorError,
  normalizeRequestContext,
  type JsonValue,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { z } from "zod";

import { K7_ACTION_DEFINITIONS, validateK7Definitions } from "./definitions.ts";
import { K7_ACTION_HANDLERS } from "./handlers.ts";
import { K7_ACTION_SCHEMAS } from "./schemas.ts";
import type {
  K7ActionDefinition,
  K7ActionId,
  K7ActionResult,
  K7Domain,
  K7ExecutionDependencies,
  K7ExecutionRequest,
} from "./types.ts";

export interface K7VisibilityRequest {
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
  provider_tool_updates?: ProviderToolUpdateMode;
}

function validateK7RuntimeCoverage(): void {
  for (const definition of Object.values(K7_ACTION_DEFINITIONS)) {
    if (!K7_ACTION_SCHEMAS[definition.action_id]) {
      throw new Error(`${definition.action_id}: Das Input-/Output-Schema fehlt.`);
    }
    if (definition.publication_state === "implemented"
      && definition.execution_gate !== "job"
      && !K7_ACTION_HANDLERS[definition.action_id]) {
      throw new Error(`${definition.action_id}: Der typisierte Handler fehlt.`);
    }
  }
}

function connectorError(
  context: RequestContext,
  code: Parameters<typeof createConnectorError>[0]["code"],
  message: string,
): Error {
  return createConnectorError({ code, message, request_id: context.request_id, retryable: false });
}

function assertJsonValue(value: unknown, context: RequestContext): asserts value is JsonValue {
  const json = z.json().safeParse(value);
  if (!json.success) {
    throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe enthält ungültige JSON-Werte.");
  }
}

function targetDepartmentIds(value: JsonValue): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(targetDepartmentIds);
  return Object.entries(value).flatMap(([key, entry]) => {
    if (key === "department_id" && typeof entry === "string") return [entry];
    return targetDepartmentIds(entry);
  });
}

function decisionError(
  definition: K7ActionDefinition,
  context: RequestContext,
  reason: ReturnType<ToolVisibilityPolicy["evaluate"]>["reason"],
): Error {
  if (reason === "SCOPE_REQUIRED") {
    const required = definition.required_scopes[0];
    return createConnectorError({
      code: "SCOPE_REQUIRED",
      message: "Der OAuth-Grant enthält nicht den erforderlichen Scope.",
      request_id: context.request_id,
      retryable: false,
      ...(required ? { required_scope: required } : {}),
    });
  }
  if (reason === "TENANT_MISMATCH" || reason === "DEPARTMENT_MISMATCH") {
    return connectorError(context, "TENANT_MISMATCH", "Der angeforderte Vereins- oder Abteilungskontext ist nicht zulässig.");
  }
  if (reason === "CONTEXT_MISSING") {
    return connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
  }
  return connectorError(context, "PERMISSION_DENIED", "Die Aktion ist im aktuellen Berechtigungskontext nicht erlaubt.");
}

export abstract class K7ToolSet {
  readonly domain: K7Domain;
  readonly #dependencies: K7ExecutionDependencies;
  readonly #visibility: ToolVisibilityPolicy;

  protected constructor(
    domain: K7Domain,
    dependencies: K7ExecutionDependencies,
    visibility: ToolVisibilityPolicy = new ToolVisibilityPolicy(),
  ) {
    validateK7Definitions();
    validateK7RuntimeCoverage();
    this.domain = domain;
    this.#dependencies = dependencies;
    this.#visibility = visibility;
  }

  listDefinitions(): K7ActionDefinition[] {
    return Object.values(K7_ACTION_DEFINITIONS)
      .filter((definition) => definition.domain === this.domain)
      .map((definition) => structuredClone(definition));
  }

  listVisible(input: K7VisibilityRequest): K7ActionDefinition[] {
    const context = normalizeRequestContext(input.context);
    return this.listDefinitions().filter((definition) => {
      if (definition.publication_state !== "implemented") return false;
      if (definition.execution_gate === "write_safety" && !this.#dependencies.write_safety) return false;
      if (definition.execution_gate === "job" && !this.#dependencies.job_starter) return false;
      const decision = this.#visibility.evaluate({
        tool: {
          tool_name: definition.action_id,
          required_scopes: definition.required_scopes,
          permission_policy: definition.permission_policy,
          is_public: false,
        },
        context,
        snapshot: input.capability_snapshot,
        provider_tool_updates: input.provider_tool_updates ?? "dynamic",
        catalog_contains_tool: true,
      });
      return decision.visible;
    });
  }

  async execute(requestInput: K7ExecutionRequest): Promise<K7ActionResult> {
    const context = normalizeRequestContext(requestInput.context);
    const definition = K7_ACTION_DEFINITIONS[requestInput.action_id];
    if (!definition || definition.domain !== this.domain) {
      throw connectorError(context, "NOT_FOUND", "Die angeforderte Tool-Aktion ist nicht verfügbar.");
    }
    if (definition.publication_state !== "implemented" || definition.execution_gate === "blocked") {
      throw connectorError(context, "NOT_FOUND", "Die angeforderte Tool-Aktion ist nicht verfügbar.");
    }

    let input: unknown;
    try {
      input = K7_ACTION_SCHEMAS[definition.action_id].input.parse(requestInput.input);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw connectorError(context, "VALIDATION_FAILED", "Die Tool-Eingabe entspricht nicht dem freigegebenen Schema.");
      }
      throw error;
    }
    assertJsonValue(input, context);
    const inputClubId = typeof input === "object" && input !== null && !Array.isArray(input)
      ? input.club_id
      : null;
    if (context.club_id === null) {
      throw connectorError(context, "CLUB_SELECTION_REQUIRED", "Bitte wähle zuerst einen Verein aus.");
    }
    if (typeof inputClubId !== "string" || inputClubId !== context.club_id) {
      throw connectorError(context, "TENANT_MISMATCH", "Der Tool-Aufruf gehört nicht zum ausgewählten Verein.");
    }

    const decision = this.#visibility.evaluate({
      tool: {
        tool_name: definition.action_id,
        required_scopes: definition.required_scopes,
        permission_policy: definition.permission_policy,
        is_public: false,
      },
      context,
      snapshot: requestInput.capability_snapshot,
      provider_tool_updates: "dynamic",
      catalog_contains_tool: true,
    });
    if (!decision.authorized) throw decisionError(definition, context, decision.reason);

    const snapshot = requestInput.capability_snapshot;
    if (snapshot === null) {
      throw connectorError(context, "PERMISSION_DENIED", "Der aktuelle Berechtigungskontext fehlt.");
    }
    if (context.department_id !== null
      && targetDepartmentIds(input).some((departmentId) => departmentId !== context.department_id)) {
      throw connectorError(context, "TENANT_MISMATCH", "Die Aktion überschreitet den gewählten Abteilungskontext.");
    }

    const handler = K7_ACTION_HANDLERS[definition.action_id];
    if (definition.execution_gate !== "job" && !handler) {
      throw connectorError(context, "CONFIG_INVALID", "Der Tool-Handler ist nicht vollständig konfiguriert.");
    }

    try {
      let result: JsonValue;
      if (definition.execution_gate === "job") {
        if (!this.#dependencies.job_starter) {
          throw connectorError(context, "CONFIG_INVALID", "Der sichere Datei-Job-Start ist noch nicht konfiguriert.");
        }
        result = await this.#dependencies.job_starter.start({ definition, input, context, capability_snapshot: snapshot });
      } else if (definition.execution_gate === "write_safety") {
        if (!this.#dependencies.write_safety) {
          throw connectorError(context, "CONFIG_INVALID", "Der Write-Safety-Flow ist noch nicht konfiguriert.");
        }
        result = await this.#dependencies.write_safety.execute(
          { definition, input, context, capability_snapshot: snapshot },
          () => handler!(input, context, this.#dependencies.client),
        );
      } else {
        result = await handler!(input, context, this.#dependencies.client);
      }

      let safeResult: unknown;
      try {
        safeResult = K7_ACTION_SCHEMAS[definition.action_id].output.parse(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw connectorError(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat keine freigegebene Antwortform geliefert.");
        }
        throw error;
      }
      assertJsonValue(safeResult, context);
      return { action_id: definition.action_id, result: safeResult };
    } catch (error) {
      if (isConnectorError(error) && error.code === "PERMISSION_DENIED") {
        await this.#dependencies.on_backend_forbidden?.({ action_id: definition.action_id, context });
        throw connectorError(context, "PERMISSION_DENIED", "Der Fachservice hat die Aktion im aktuellen Kontext abgelehnt.");
      }
      if (isConnectorError(error) && error.code === "NOT_FOUND") {
        throw connectorError(context, "NOT_FOUND", "Die angeforderte Ressource wurde nicht gefunden.");
      }
      throw error;
    }
  }
}

export class IdentityToolSet extends K7ToolSet {
  constructor(dependencies: K7ExecutionDependencies) { super("whoami", dependencies); }
}

export class ClubToolSet extends K7ToolSet {
  constructor(dependencies: K7ExecutionDependencies) { super("club", dependencies); }
}

export class MemberToolSet extends K7ToolSet {
  constructor(dependencies: K7ExecutionDependencies) { super("member", dependencies); }
}

export class TeamToolSet extends K7ToolSet {
  constructor(dependencies: K7ExecutionDependencies) { super("team", dependencies); }
}

export class RoleToolSet extends K7ToolSet {
  constructor(dependencies: K7ExecutionDependencies) { super("role", dependencies); }
}

export interface K7ToolSets {
  identity: IdentityToolSet;
  club: ClubToolSet;
  member: MemberToolSet;
  team: TeamToolSet;
  role: RoleToolSet;
}

export function createK7ToolSets(dependencies: K7ExecutionDependencies): K7ToolSets {
  return {
    identity: new IdentityToolSet(dependencies),
    club: new ClubToolSet(dependencies),
    member: new MemberToolSet(dependencies),
    team: new TeamToolSet(dependencies),
    role: new RoleToolSet(dependencies),
  };
}
