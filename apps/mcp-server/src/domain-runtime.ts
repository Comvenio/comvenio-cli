import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  CapabilitySnapshot,
  OAuthEnvironment,
} from "@comvenio/auth";
import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import {
  ACTION_CONFIRM_INPUT_SCHEMA,
  CONFIRMATION_WIDGET_SCHEMA,
  createConnectorError,
  createProviderNeutralResult,
  isConnectorError,
  type JsonValue,
  type OAuthScope,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  confirmationMatchHash,
  type DomainStateStore,
} from "./domain-state-store.ts";
import type { ToolSecurityScheme } from "./tool-security-schemes.ts";
import {
  ConfirmationWidgetCapabilityPolicy,
} from "./widgets/confirmation/policy.ts";
import {
  ConfirmationWidgetProjector,
} from "./widgets/confirmation/projector.ts";
import {
  confirmationActionToolMetadata,
  confirmationToolMetadata,
} from "./widgets/confirmation/resource.ts";
import {
  K7_ACTION_DEFINITIONS,
  K7_ACTION_SCHEMAS,
  createK7ToolSets,
} from "./tools/identity-club-member-team-role/index.ts";
import {
  EventConfirmationPolicy,
  K8_ACTION_DEFINITIONS,
  K8_ACTION_SCHEMAS,
  createK8ToolSets,
} from "./tools/event-plan/index.ts";
import {
  AgendaActionPolicy,
  K9_ACTION_DEFINITIONS,
  K9_ACTION_SCHEMAS,
  createK9ToolSets,
} from "./tools/meeting-tournament/index.ts";
import {
  AvailabilityContract,
  BookingConflictPolicy,
  K10_ACTION_DEFINITIONS,
  K10_ACTION_SCHEMAS,
  createK10ToolSets,
} from "./tools/booking-object-task/index.ts";
import {
  K11_ACTION_DEFINITIONS,
  K11_ACTION_SCHEMAS,
  SupplyChangeConfirmationPolicy,
  createK11ToolSets,
} from "./tools/supply-menu-shopping/index.ts";
import {
  ContentChangeConfirmationPolicy,
  K12_ACTION_DEFINITIONS,
  K12_ACTION_SCHEMAS,
  createK12ToolSets,
} from "./tools/content-homepage-news-data/index.ts";
import {
  K13_ACTION_DEFINITIONS,
  K13_ACTION_SCHEMAS,
  SponsorConfirmationPolicy,
  createK13ToolSet,
} from "./tools/sponsor-marketing/index.ts";

type ActionRisk = "read" | "reversible_write" | "critical_write";

interface DomainOperation {
  operation: string;
  required_scopes: readonly OAuthScope[];
  risk_class: ActionRisk;
  execution_gate: string;
  external_effect?: "none" | "comvenio_private" | "comvenio_public" | "third_party";
}

interface DomainDefinition {
  action_id: string;
  domain: string;
  source_action: string;
  publication_state: "implemented" | "blocked";
  blocker: string | null;
  required_scopes?: readonly OAuthScope[];
  risk_class?: ActionRisk;
  execution_gate?: string;
  operations?: Readonly<Record<string, DomainOperation>>;
}

interface DomainSchemaContract {
  input: z.ZodType;
  output: z.ZodType;
}

interface DomainToolSet {
  listVisible(input: {
    context: RequestContext;
    capability_snapshot: CapabilitySnapshot | null;
    provider_tool_updates: "dynamic";
  }): DomainDefinition[];
  execute(input: {
    action_id: never;
    input: unknown;
    context: RequestContext;
    capability_snapshot: CapabilitySnapshot | null;
  }): Promise<Record<string, JsonValue>>;
}

interface DomainMutationRequest {
  definition: { action_id: string };
  operation?: { operation: string };
  input: JsonValue;
  context: RequestContext;
}

interface DomainCallSafety {
  action_id: string;
  operation: string;
  idempotency_key: string | null;
}

interface PendingDomainConfirmation {
  preview_id: string;
  subject_id: string;
  club_id: string;
  capability_version: string;
  action_id: string;
  tool_name: string;
  operation: string;
  input: JsonValue;
  idempotency_key: string;
  expires_at: number;
}

export interface DomainToolSummary extends Record<string, JsonValue> {
  name: string;
  title: string;
  description: string;
  required_scopes: OAuthScope[];
  read_only: boolean;
  risk_class: ActionRisk;
}

export interface DomainRuntimeRegistration {
  tools: DomainToolSummary[];
  blocked_action_ids: string[];
}

export const FULL_CONNECTOR_REPLACEMENTS = Object.freeze({
  "cai.login.01.login": "oauth_connect",
  "cai.logout.01.logout": "oauth_disconnect",
  "cai.club.01.info": "cv_whoami_read",
  "cai.role.15.effective": "cv_permissions_explain_read",
});

const DOMAIN_LABELS: Record<string, string> = {
  whoami: "Verbindung",
  club: "Verein",
  member: "Mitglieder",
  team: "Teams",
  role: "Rollen",
  event: "Veranstaltungen",
  plan: "Lagepläne",
  meeting: "Sitzungen",
  tournament: "Turniere",
  booking: "Buchungen",
  object: "Objekte",
  task: "Aufgaben",
  recipe: "Rezepte",
  ingredient: "Zutaten",
  "ingredient-category": "Zutatenkategorien",
  shopping: "Einkauf",
  template: "Vorlagen",
  menu: "Speisekarten",
  homepage: "Homepage",
  schema: "Schemas",
  verify: "Vorschauen",
  data: "Dateien und Daten",
  news: "News",
  sponsor: "Sponsoring",
};

const ACTION_CONFIRM_TOOL_SUMMARY: DomainToolSummary = {
  name: "action_confirm",
  title: "Comvenio: Kritische Aktion bestätigen",
  description: "App-interner Executor für genau eine aktuelle, serverseitig gebundene Wirkungsvorschau. Für Modelle verborgen; nur das Bestätigungs-Widget erhält den kurzlebigen Einmalnachweis.",
  required_scopes: ["club.read"],
  read_only: false,
  risk_class: "critical_write",
};

const confirmationSchema = z.object({
  preview_id: z.string().uuid(),
  confirmation_token: z.string().min(32).max(512),
}).strict();
const domainConfirmationPreviewSchema = z.object({
  preview_id: z.string().uuid(),
  confirmation_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  expires_at: z.string().datetime({ offset: true }),
}).passthrough();
const uuid = z.string().uuid();
const domainOutputSchema = z.object({
  action_id: z.string().min(1),
  operation: z.string().min(1).optional(),
  status: z.enum([
    "completed",
    "confirmation_required",
    "queued",
  ]).optional(),
  result: z.json(),
}).strict();
const pendingDomainConfirmationSchema = z.object({
  match_hash: z.string().length(64),
  preview_id: z.string().uuid(),
  subject_id: z.string().min(1),
  club_id: z.string().uuid(),
  capability_version: z.string().min(1),
  action_id: z.string().min(1),
  tool_name: z.string().min(1),
  operation: z.string().min(1),
  input: z.json(),
  idempotency_key: z.string().min(1),
  expires_at: z.number().int().positive(),
}).strict();

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutConfirmation(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "confirmation"),
  ) as JsonValue;
}

function digest(value: JsonValue): string {
  return createHash("sha256").update(canonical(withoutConfirmation(value))).digest("hex");
}

class DomainWriteCoordinator {
  readonly #calls = new AsyncLocalStorage<DomainCallSafety>();
  readonly #ttlMs = 24 * 60 * 60 * 1_000;

  constructor(private readonly stateStore: DomainStateStore) {}

  run<T>(context: DomainCallSafety, execute: () => Promise<T>): Promise<T> {
    return this.#calls.run(context, execute);
  }

  async execute(
    request: DomainMutationRequest,
    mutation: () => Promise<JsonValue>,
  ): Promise<JsonValue> {
    const call = this.#calls.getStore();
    const subjectId = request.context.subject_id;
    const clubId = request.context.club_id;
    if (!call || !subjectId || !clubId || !call.idempotency_key) {
      throw createConnectorError({
        code: "VALIDATION_FAILED",
        message: "Für diese Schreibaktion fehlt ein gültiger Idempotenzschlüssel.",
        request_id: request.context.request_id,
        retryable: false,
      });
    }
    const key = confirmationMatchHash(
      subjectId,
      clubId,
      call.action_id,
      call.operation,
      call.idempotency_key,
    );
    const payloadHash = digest(request.input);
    const ownerToken = randomUUID();
    const acquired = await this.stateStore.acquireWrite(
      key,
      payloadHash,
      ownerToken,
      this.#ttlMs,
    );
    if (acquired.status === "conflict") {
      throw createConnectorError({
        code: "CONFLICT",
        message: "Der Idempotenzschlüssel gehört zu einer anderen Wirkung.",
        request_id: request.context.request_id,
        retryable: false,
      });
    }
    if (acquired.status === "running") {
      throw createConnectorError({
        code: "CONFLICT",
        message: "Eine identische Schreibaktion wird bereits verarbeitet.",
        request_id: request.context.request_id,
        retryable: true,
      });
    }
    if (acquired.status === "completed") {
      return structuredClone(acquired.result);
    }

    try {
      const result = await mutation();
      const completed = await this.stateStore.completeWrite(
        key,
        payloadHash,
        ownerToken,
        result,
        this.#ttlMs,
      );
      if (!completed) {
        throw createConnectorError({
          code: "CONFLICT",
          message: "Der Schreibnachweis ist während der Ausführung abgelaufen.",
          request_id: request.context.request_id,
          retryable: false,
        });
      }
      return result;
    } catch (error) {
      await this.stateStore.abortWrite(key, payloadHash, ownerToken);
      throw error;
    }
  }
}

class K7ConfirmationCoordinator {
  readonly #ttlMs = 5 * 60 * 1_000;

  constructor(private readonly stateStore: DomainStateStore) {}

  async confirmOrPreview<T>(input: {
    action_id: string;
    operation: string;
    payload: JsonValue;
    context: RequestContext;
    confirmation: z.infer<typeof confirmationSchema> | null;
    execute: () => Promise<T>;
  }): Promise<T | Record<string, JsonValue>> {
    const subjectId = input.context.subject_id;
    const clubId = input.context.club_id;
    if (!subjectId || !clubId) {
      throw createConnectorError({
        code: "AUTH_REQUIRED",
        message: "Für die Bestätigung fehlt der gebundene Nutzer oder Verein.",
        request_id: input.context.request_id,
        retryable: false,
      });
    }
    const payloadHash = digest(input.payload);
    if (!input.confirmation) {
      const previewId = randomUUID();
      const token = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + this.#ttlMs;
      const created = await this.stateStore.putConfirmation(
        "k7",
        previewId,
        {
          match_hash: confirmationMatchHash(
            input.action_id,
            input.operation,
            subjectId,
            clubId,
            payloadHash,
            token,
          ),
        },
        this.#ttlMs,
      );
      if (!created) {
        throw createConnectorError({
          code: "CONFLICT",
          message: "Die Wirkungsvorschau konnte nicht eindeutig gespeichert werden.",
          request_id: input.context.request_id,
          retryable: true,
        });
      }
      return {
        action_id: input.action_id,
        operation: input.operation,
        status: "confirmation_required",
        result: {
          confirmation_required: true,
          preview: {
            preview_id: previewId,
            confirmation_token: token,
            action_id: input.action_id,
            operation: input.operation,
            summary: "Kritische Comvenio-Aktion prüfen und ausdrücklich bestätigen.",
            expires_at: new Date(expiresAt).toISOString(),
          },
        },
      };
    }

    const stored = await this.stateStore.consumeConfirmation(
      "k7",
      input.confirmation.preview_id,
      confirmationMatchHash(
        input.action_id,
        input.operation,
        subjectId,
        clubId,
        payloadHash,
        input.confirmation.confirmation_token,
      ),
    );
    if (!stored) {
      throw createConnectorError({
        code: "CONFIRMATION_MISMATCH",
        message: "Die Bestätigung ist ungültig, abgelaufen oder gehört zu einer anderen Wirkung.",
        request_id: input.context.request_id,
        retryable: false,
      });
    }
    return input.execute();
  }
}

class DomainConfirmationRouter {
  readonly #ttlMs = 10 * 60 * 1_000;

  constructor(private readonly stateStore: DomainStateStore) {}

  async register(input: PendingDomainConfirmation & {
    confirmation_token: string;
    request_id: string;
  }): Promise<void> {
    const {
      confirmation_token: confirmationToken,
      request_id: requestId,
      ...pending
    } = input;
    const matchHash = confirmationMatchHash(
      pending.subject_id,
      pending.club_id,
      pending.capability_version,
      pending.idempotency_key,
      confirmationToken,
    );
    const ttlMs = Math.min(
      this.#ttlMs,
      Math.max(1, pending.expires_at - Date.now()),
    );
    const created = await this.stateStore.putConfirmation(
      "domain-router",
      input.preview_id,
      pendingDomainConfirmationSchema.parse({
        ...pending,
        match_hash: matchHash,
      }),
      ttlMs,
    );
    if (!created) {
      throw createConnectorError({
        code: "CONFLICT",
        message: "Die Wirkungsvorschau konnte nicht eindeutig gebunden werden.",
        request_id: requestId,
        retryable: true,
      });
    }
  }

  async consume(input: {
    preview_id: string;
    confirmation_token: string;
    idempotency_key: string;
    context: RequestContext;
  }): Promise<PendingDomainConfirmation> {
    const subjectId = input.context.subject_id;
    const clubId = input.context.club_id;
    const capabilityVersion = input.context.capability_version;
    const stored = subjectId && clubId && capabilityVersion
      ? await this.stateStore.consumeConfirmation(
        "domain-router",
        input.preview_id,
        confirmationMatchHash(
          subjectId,
          clubId,
          capabilityVersion,
          input.idempotency_key,
          input.confirmation_token,
        ),
      )
      : null;
    const parsed = pendingDomainConfirmationSchema.safeParse(stored);
    if (!parsed.success || parsed.data.expires_at <= Date.now()) {
      throw createConnectorError({
        code: "CONFIRMATION_MISMATCH",
        message: "Die Bestätigung ist ungültig, abgelaufen oder gehört zu einer anderen Wirkung.",
        request_id: input.context.request_id,
        retryable: false,
      });
    }
    const {
      match_hash: _matchHash,
      ...pending
    } = parsed.data;
    return pending;
  }
}

function actionToolName(actionId: string): string {
  const base = actionId.replace(/^cai\./u, "cv_").replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (base.length <= 64) return base;
  const hash = createHash("sha256").update(actionId).digest("hex").slice(0, 8);
  return `${base.slice(0, 55).replace(/_+$/u, "")}_${hash}`;
}

function actionOutputSchema(
  definition: DomainDefinition,
  resultSchema: z.ZodType,
): z.ZodType {
  const operations = definitionOperations(definition);
  const operationNames = operations.map((operation) => operation.operation);
  const operationSchema = operationNames.length === 1
    ? z.literal(operationNames[0]!)
    : z.enum(operationNames as [string, ...string[]]);
  return z.object({
    action_id: z.literal(definition.action_id),
    operation: operationSchema.optional(),
    status: z.enum([
      "completed",
      "confirmation_required",
      "queued",
    ]).optional(),
    result: resultSchema,
  }).strict();
}

function outputUnion(schemas: z.ZodType[]): z.ZodType {
  if (schemas.length === 0) return domainOutputSchema;
  if (schemas.length === 1) return schemas[0]!;
  return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

export function domainToolName(actionId: string): string {
  return actionToolName(actionId);
}

function actionCopy(definition: DomainDefinition, operationNames: string[]): {
  title: string;
  description: string;
} {
  const domain = DOMAIN_LABELS[definition.domain] ?? definition.domain;
  const action = definition.source_action.replace(/[|_-]+/gu, " ")
    .replace(/\s+/gu, " ").trim();
  const title = `Comvenio: ${domain} – ${action}`.slice(0, 120);
  const operations = operationNames.length > 1
    ? ` Sichtbare Teilaktionen: ${operationNames.join(", ")}.`
    : "";
  return {
    title,
    description: (
      `${title}. Übergib die strikt typisierten Fachparameter unter „input“.`
      + " Der Verein wird aus OAuth abgeleitet; frage niemals nach club_id, Vereinsdomain oder einer manuellen Vereinsauswahl."
      + operations
    ).slice(0, 1_000),
  };
}

function confirmationPreview(
  result: Record<string, JsonValue>,
): z.infer<typeof domainConfirmationPreviewSchema> | null {
  if (result.status !== "confirmation_required") return null;
  const resultRecord = result.result;
  if (
    resultRecord === null
    || typeof resultRecord !== "object"
    || Array.isArray(resultRecord)
  ) {
    return null;
  }
  const preview = resultRecord.preview;
  const parsed = domainConfirmationPreviewSchema.safeParse(preview);
  return parsed.success ? parsed.data : null;
}

function impactFor(
  definition: DomainDefinition,
  operation: DomainOperation,
): {
  creates: number;
  updates: number;
  deletes: number;
  publishes: number;
  imports: number;
  exports: number;
  affected_total: number;
  summary: string;
} {
  const action = `${definition.source_action} ${operation.operation}`
    .toLowerCase();
  const kind = /(?:delete|remove|reject|cancel)/u.test(action)
    ? "deletes"
    : /(?:publish|public)/u.test(action)
      ? "publishes"
      : /import/u.test(action)
        ? "imports"
        : /export/u.test(action)
          ? "exports"
          : /(?:create|add)/u.test(action)
            ? "creates"
            : "updates";
  return {
    creates: kind === "creates" ? 1 : 0,
    updates: kind === "updates" ? 1 : 0,
    deletes: kind === "deletes" ? 1 : 0,
    publishes: kind === "publishes" ? 1 : 0,
    imports: kind === "imports" ? 1 : 0,
    exports: kind === "exports" ? 1 : 0,
    affected_total: 1,
    summary: "Eine kritische Comvenio-Wirkung wird ausgeführt.",
  };
}

function confirmationWidgetResult(input: {
  definition: DomainDefinition;
  operation: DomainOperation;
  tool_name: string;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
  preview: z.infer<typeof domainConfirmationPreviewSchema>;
  idempotency_key: string;
  environment: OAuthEnvironment;
}): CallToolResult {
  const copy = actionCopy(input.definition, [input.operation.operation]);
  const challenge = {
    preview: {
      preview_id: input.preview.preview_id,
      request_id: input.context.request_id,
      club_id: input.context.club_id!,
      tool_name: input.tool_name,
      risk_class: "critical_write" as const,
      target: {
        type: input.definition.domain,
        id: null,
        label: copy.title,
      },
      impact: impactFor(input.definition, input.operation),
      safe_summary: `${copy.title} wird erst nach deiner Bestätigung ausgeführt.`,
      masked_fields: [],
      expires_at: input.preview.expires_at,
    },
    confirmation_token: input.preview.confirmation_token,
    confirm_label: "Verbindlich bestätigen",
    cancel_label: "Abbrechen" as const,
    acknowledgement_required: true,
  };
  const widget = new ConfirmationWidgetProjector(
    new ConfirmationWidgetCapabilityPolicy([input.tool_name]),
  ).project({
    club: {
      club_id: input.context.club_id!,
      name: "Ausgewählter Verein",
      timezone: input.context.timezone,
    },
    context: input.context,
    capability_snapshot: input.capability_snapshot,
    challenge,
    confirm_action: {
      action_id: "action.confirm",
      label: "Verbindlich bestätigen",
      tool_name: "action_confirm",
      input: {
        preview_id: input.preview.preview_id,
        confirmation_token: input.preview.confirmation_token,
        idempotency_key: input.idempotency_key,
      },
      visibility: "visible",
      enabled: true,
      risk_class: "critical_write",
      requires_confirmation: true,
      disabled_reason: null,
    },
  });
  return {
    content: [{
      type: "text",
      text: `${copy.title} benötigt deine ausdrückliche Bestätigung.`,
    }],
    structuredContent: widget,
    _meta: {
      request_id: input.context.request_id,
      capability_version: input.context.capability_version!,
      "comvenio/confirmation": {
        preview_id: input.preview.preview_id,
        confirmation_token: input.preview.confirmation_token,
        idempotency_key: input.idempotency_key,
      },
      ...confirmationToolMetadata(input.environment)._meta,
    },
  };
}

function definitionOperations(definition: DomainDefinition): DomainOperation[] {
  if (definition.operations) return Object.values(definition.operations);
  return [{
    operation: "execute",
    required_scopes: definition.required_scopes ?? [],
    risk_class: definition.risk_class ?? "read",
    execution_gate: definition.execution_gate ?? "inline",
    external_effect: definition.risk_class === "read" ? "none" : "comvenio_private",
  }];
}

function selectedOperation(
  definition: DomainDefinition,
  input: JsonValue,
): DomainOperation | null {
  const operations = definitionOperations(definition);
  if (operations.length === 1) return operations[0]!;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const name = typeof input.operation === "string" ? input.operation : null;
  return name ? operations.find((operation) => operation.operation === name) ?? null : null;
}

function callSchema(
  definition: DomainDefinition,
  inputSchema: z.ZodType,
): z.ZodType {
  return z.object({
    input: inputSchema,
    idempotency_key: uuid.optional().describe(
      "Stabiler UUID-Schlüssel für Schreib- und Jobaufrufe; bei einem Retry unverändert wiederverwenden.",
    ),
  }).strict().superRefine((value, context) => {
    const parsedInput = z.json().safeParse(value.input);
    if (!parsedInput.success) return;
    const operation = selectedOperation(definition, parsedInput.data);
    if (!operation) {
      context.addIssue({
        code: "custom",
        path: ["input", "operation"],
        message: "Die Teilaktion ist im aktuellen Rechtekontext nicht sichtbar.",
      });
      return;
    }
    if ((operation.risk_class !== "read" || operation.execution_gate.includes("job"))
      && !value.idempotency_key) {
      context.addIssue({
        code: "custom",
        path: ["idempotency_key"],
        message: "Schreib- und Jobaktionen benötigen einen Idempotenzschlüssel.",
      });
    }
  });
}

function externalDomainInputSchema(inputSchema: z.ZodType): z.ZodType {
  if (inputSchema instanceof z.ZodDiscriminatedUnion) {
    const options = inputSchema.options.map((option) =>
      externalDomainInputSchema(option as z.ZodType)) as [
        z.ZodObject,
        z.ZodObject,
        ...z.ZodObject[],
      ];
    return z.discriminatedUnion(
      inputSchema.def.discriminator,
      options,
    );
  }
  if (inputSchema instanceof z.ZodUnion) {
    const options = inputSchema.options.map((option) =>
      externalDomainInputSchema(option as z.ZodType)) as [
        z.ZodType,
        z.ZodType,
        ...z.ZodType[],
      ];
    return z.union(options);
  }
  if (inputSchema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = { ...inputSchema.shape };
    delete shape.club_id;
    delete shape.confirmation;
    return z.strictObject(shape);
  }
  throw new Error(
    `Nicht unterstütztes Domain-Eingabeschema: ${inputSchema.constructor.name}`,
  );
}

function bindOAuthClub(
  value: JsonValue,
  context: RequestContext,
): JsonValue {
  if (!context.club_id) {
    throw createConnectorError({
      code: "CLUB_SELECTION_REQUIRED",
      message: "Der OAuth-Grant enthält keinen ausgewählten Verein.",
      request_id: context.request_id,
      retryable: false,
    });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw createConnectorError({
      code: "VALIDATION_FAILED",
      message: "Die Fachparameter müssen ein Objekt sein.",
      request_id: context.request_id,
      retryable: false,
    });
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "club_id")
    || Object.prototype.hasOwnProperty.call(value, "confirmation")
  ) {
    throw createConnectorError({
      code: "VALIDATION_FAILED",
      message: "Vereinskontext und Bestätigungsnachweis werden ausschließlich serverseitig gebunden.",
      request_id: context.request_id,
      retryable: false,
    });
  }
  return z.json().parse({
    ...value,
    club_id: context.club_id,
  });
}

function requiredScopes(operations: DomainOperation[]): OAuthScope[] {
  return [...new Set(operations.flatMap((operation) => operation.required_scopes))].sort();
}

function annotations(operations: DomainOperation[]): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
} {
  const readOnly = operations.every((operation) => operation.risk_class === "read");
  return {
    readOnlyHint: readOnly,
    destructiveHint: operations.some((operation) => operation.risk_class === "critical_write"),
    idempotentHint: readOnly,
    openWorldHint: operations.some((operation) =>
      operation.external_effect === "comvenio_public"
      || operation.external_effect === "third_party"),
  };
}

function toMcpResult(
  context: RequestContext,
  output: Record<string, JsonValue>,
): CallToolResult {
  const encoded = JSON.stringify(output);
  return {
    ...createProviderNeutralResult(
      context,
      output,
      [{
        type: "text",
        text: encoded.length <= 80_000
          ? encoded
          : JSON.stringify({
              action_id: output.action_id,
              status: output.status ?? "completed",
              truncated: true,
            }),
      }],
    ),
    structuredContent: output,
  };
}

function executionError(context: RequestContext, error: unknown): CallToolResult {
  if (isConnectorError(error)) {
    return {
      content: [{
        type: "text",
        text: error.code === "PERMISSION_DENIED" || error.code === "NOT_FOUND"
          ? "Diese Comvenio-Ressource ist in deinem aktuellen Vereins- und Rechtekontext nicht verfügbar."
          : error.message,
      }],
      structuredContent: {
        error: error.code.toLowerCase(),
        ...(error.required_scope ? { required_scope: error.required_scope } : {}),
      },
      _meta: { request_id: context.request_id },
      isError: true,
    };
  }
  return {
    content: [{
      type: "text",
      text: "Die Comvenio-Aktion konnte nicht sicher abgeschlossen werden.",
    }],
    structuredContent: { error: "upstream_unavailable" },
    _meta: { request_id: context.request_id },
    isError: true,
  };
}

function asToolSet(value: unknown): DomainToolSet {
  return value as DomainToolSet;
}

function definitionMap(
  definitions: Readonly<Record<string, unknown>>,
): Readonly<Record<string, DomainDefinition>> {
  return definitions as Readonly<Record<string, DomainDefinition>>;
}

function schemaMap(
  schemas: Readonly<Record<string, unknown>>,
): Readonly<Record<string, DomainSchemaContract>> {
  return schemas as Readonly<Record<string, DomainSchemaContract>>;
}

const ALL_DEFINITION_MAPS = [
  definitionMap(K7_ACTION_DEFINITIONS),
  definitionMap(K8_ACTION_DEFINITIONS),
  definitionMap(K9_ACTION_DEFINITIONS),
  definitionMap(K10_ACTION_DEFINITIONS),
  definitionMap(K11_ACTION_DEFINITIONS),
  definitionMap(K12_ACTION_DEFINITIONS),
  definitionMap(K13_ACTION_DEFINITIONS),
] as const;

function highestRisk(operations: DomainOperation[]): ActionRisk {
  if (operations.some((operation) => operation.risk_class === "critical_write")) {
    return "critical_write";
  }
  if (operations.some((operation) =>
    operation.risk_class === "reversible_write")) {
    return "reversible_write";
  }
  return "read";
}

export function fullDomainReviewToolSummaries(): DomainToolSummary[] {
  const summaries = ALL_DEFINITION_MAPS
    .flatMap((items) => Object.values(items))
    .filter((definition) => definition.publication_state === "implemented")
    .map((definition) => {
      const operations = definitionOperations(definition);
      return {
        name: actionToolName(definition.action_id),
        ...actionCopy(
          definition,
          operations.map((operation) => operation.operation),
        ),
        required_scopes: requiredScopes(operations),
        read_only: operations.every(
          (operation) => operation.risk_class === "read",
        ),
        risk_class: highestRisk(operations),
      };
    });
  return [...summaries, structuredClone(ACTION_CONFIRM_TOOL_SUMMARY)]
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function fullDomainCatalogSummary(): {
  discovered_actions: number;
  published_domain_actions: number;
  blocked_action_ids: string[];
  replacement_action_ids: string[];
} {
  const definitions = ALL_DEFINITION_MAPS.flatMap((items) => Object.values(items));
  const blocked = definitions
    .filter((definition) => definition.publication_state !== "implemented")
    .map((definition) => definition.action_id)
    .sort();
  return {
    discovered_actions: definitions.length,
    published_domain_actions: definitions.length - blocked.length,
    blocked_action_ids: blocked,
    replacement_action_ids: Object.keys(FULL_CONNECTOR_REPLACEMENTS).sort(),
  };
}

export function fullDomainProtectedToolDescriptors(): Array<{
  tool_name: string;
  required_scopes: OAuthScope[];
}> {
  const names = ALL_DEFINITION_MAPS.flatMap((items) => Object.values(items))
    .filter((definition) => definition.publication_state === "implemented")
    .map((definition) => actionToolName(definition.action_id));
  if (new Set(names).size !== names.length) {
    throw new Error("Der vollständige Domain-Katalog enthält kollidierende Toolnamen.");
  }
  return [
    ...names.sort().map((tool_name) => ({
      tool_name,
      required_scopes: ["club.read"] as OAuthScope[],
    })),
    {
      tool_name: ACTION_CONFIRM_TOOL_SUMMARY.name,
      required_scopes: [...ACTION_CONFIRM_TOOL_SUMMARY.required_scopes],
    },
  ].sort((left, right) => left.tool_name.localeCompare(right.tool_name));
}

export function registerFullDomainRuntime(input: {
  server: McpServer;
  client: ComvenioApiClient;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
  environment: OAuthEnvironment;
  state_store: DomainStateStore;
  advertised_security_schemes: Map<string, readonly ToolSecurityScheme[]>;
}): DomainRuntimeRegistration {
  const writeCoordinator = new DomainWriteCoordinator(input.state_store);
  const k7Confirmation = new K7ConfirmationCoordinator(input.state_store);
  const domainConfirmationRouter = new DomainConfirmationRouter(
    input.state_store,
  );
  const eventConfirmation = new EventConfirmationPolicy({
    state_store: input.state_store,
  });
  const agendaConfirmation = new AgendaActionPolicy({
    state_store: input.state_store,
  });
  const supplyConfirmation = new SupplyChangeConfirmationPolicy({
    state_store: input.state_store,
  });
  const contentConfirmation = new ContentChangeConfirmationPolicy(
    undefined,
    input.state_store,
  );
  const sponsorConfirmation = new SponsorConfirmationPolicy(
    undefined,
    input.state_store,
  );
  const bookingConfirmation = new BookingConflictPolicy(
    new AvailabilityContract(input.client),
    { preview_store: input.state_store },
  );
  const writeSafety = {
    execute: (
      request: DomainMutationRequest,
      mutation: () => Promise<JsonValue>,
    ) => writeCoordinator.execute(request, mutation),
  };
  const groups: Array<{
    sets: DomainToolSet[];
    definitions: Readonly<Record<string, DomainDefinition>>;
    schemas: Readonly<Record<string, DomainSchemaContract>>;
  }> = [];

  const k7 = createK7ToolSets({ client: input.client, write_safety: writeSafety });
  groups.push({
    sets: Object.values(k7).map(asToolSet),
    definitions: definitionMap(K7_ACTION_DEFINITIONS),
    schemas: schemaMap(K7_ACTION_SCHEMAS),
  });
  const k8 = createK8ToolSets({
    client: input.client,
    write_safety: writeSafety,
    event_confirmation: eventConfirmation,
  });
  groups.push({
    sets: Object.values(k8).map(asToolSet),
    definitions: definitionMap(K8_ACTION_DEFINITIONS),
    schemas: schemaMap(K8_ACTION_SCHEMAS),
  });
  const k9 = createK9ToolSets({
    client: input.client,
    write_safety: writeSafety,
    agenda_confirmation: agendaConfirmation,
  });
  groups.push({
    sets: Object.values(k9).map(asToolSet),
    definitions: definitionMap(K9_ACTION_DEFINITIONS),
    schemas: schemaMap(K9_ACTION_SCHEMAS),
  });
  const k10 = createK10ToolSets({
    client: input.client,
    write_safety: writeSafety,
    booking_conflict: bookingConfirmation,
  });
  groups.push({
    sets: Object.values(k10).map(asToolSet),
    definitions: definitionMap(K10_ACTION_DEFINITIONS),
    schemas: schemaMap(K10_ACTION_SCHEMAS),
  });
  const k11 = createK11ToolSets({
    client: input.client,
    write_safety: writeSafety,
    confirmation: supplyConfirmation,
  });
  groups.push({
    sets: Object.values(k11).map(asToolSet),
    definitions: definitionMap(K11_ACTION_DEFINITIONS),
    schemas: schemaMap(K11_ACTION_SCHEMAS),
  });
  const k12 = createK12ToolSets({
    client: input.client,
    write_safety: writeSafety,
    confirmation: contentConfirmation,
  });
  groups.push({
    sets: Object.values(k12).map(asToolSet),
    definitions: definitionMap(K12_ACTION_DEFINITIONS),
    schemas: schemaMap(K12_ACTION_SCHEMAS),
  });
  const k13 = createK13ToolSet({
    client: input.client,
    write_safety: writeSafety,
    confirmation: sponsorConfirmation,
  });
  groups.push({
    sets: [asToolSet(k13)],
    definitions: definitionMap(K13_ACTION_DEFINITIONS),
    schemas: schemaMap(K13_ACTION_SCHEMAS),
  });

  interface RegisteredDomainAction {
    set: DomainToolSet;
    definition: DomainDefinition;
    schema: DomainSchemaContract;
    output_schema: z.ZodType;
    tool_name: string;
  }

  const registered = new Set<string>();
  const runtimeActions = new Map<string, RegisteredDomainAction>();
  const summaries: DomainToolSummary[] = [];

  async function executeAction(input_: {
    runtime: RegisteredDomainAction;
    parsed_input: JsonValue;
    idempotency_key: string | null;
    confirmation: z.infer<typeof confirmationSchema> | null;
  }): Promise<Record<string, JsonValue>> {
    const definition = input_.runtime.definition;
    const k7Critical = !definition.operations
      && definition.risk_class === "critical_write";
    const executionInput = !k7Critical && input_.confirmation
      && input_.parsed_input !== null
      && typeof input_.parsed_input === "object"
      && !Array.isArray(input_.parsed_input)
      ? z.json().parse({
          ...input_.parsed_input,
          confirmation: input_.confirmation,
        })
      : input_.parsed_input;
    input_.runtime.schema.input.parse(executionInput);
    const operation = selectedOperation(definition, executionInput);
    if (!operation) {
      throw createConnectorError({
        code: "PERMISSION_DENIED",
        message: "Die Teilaktion ist im aktuellen Rechtekontext nicht sichtbar.",
        request_id: input.context.request_id,
        retryable: false,
      });
    }
    const execute = () => writeCoordinator.run({
      action_id: definition.action_id,
      operation: operation.operation,
      idempotency_key: input_.idempotency_key,
    }, () => input_.runtime.set.execute({
      action_id: definition.action_id as never,
      input: executionInput,
      context: input.context,
      capability_snapshot: input.capability_snapshot,
    }));
    const result = k7Critical
      ? await k7Confirmation.confirmOrPreview({
          action_id: definition.action_id,
          operation: operation.operation,
          payload: input_.parsed_input,
          context: input.context,
          confirmation: input_.confirmation,
          execute,
        })
      : await execute();
    const parsedResult = z.record(z.string(), z.json()).parse(result);
    if (!confirmationPreview(parsedResult)) {
      input_.runtime.output_schema.parse(parsedResult);
    }
    return parsedResult;
  }

  for (const group of groups) {
    for (const set of group.sets) {
      const visible = set.listVisible({
        context: input.context,
        capability_snapshot: input.capability_snapshot,
        provider_tool_updates: "dynamic",
      });
      for (const definition of visible.sort((left, right) =>
        left.action_id.localeCompare(right.action_id))) {
        if (registered.has(definition.action_id)) continue;
        const schema = group.schemas[definition.action_id];
        const canonicalDefinition = group.definitions[definition.action_id];
        if (!schema || !canonicalDefinition) {
          throw new Error(
            `${definition.action_id}: Runtime-Schema oder Definition fehlt.`,
          );
        }
        const operations = definitionOperations(definition);
        const riskClass = highestRisk(operations);
        const toolName = actionToolName(definition.action_id);
        const scopes = requiredScopes(operations);
        const copy = actionCopy(
          definition,
          operations.map((operation) => operation.operation),
        );
        const securitySchemes: ToolSecurityScheme[] = [{
          type: "oauth2",
          scopes,
        }];
        const inputSchema = callSchema(
          definition,
          externalDomainInputSchema(schema.input),
        );
        const runtime: RegisteredDomainAction = {
          set,
          definition: canonicalDefinition,
          schema,
          output_schema: actionOutputSchema(canonicalDefinition, schema.output),
          tool_name: toolName,
        };
        runtimeActions.set(definition.action_id, runtime);
        input.advertised_security_schemes.set(toolName, securitySchemes);
        registerAppTool(input.server, toolName, {
          ...copy,
          inputSchema,
          outputSchema: riskClass === "critical_write"
            ? z.union([
              runtime.output_schema,
              CONFIRMATION_WIDGET_SCHEMA,
            ])
            : runtime.output_schema,
          annotations: annotations(operations),
          _meta: {
            ...(riskClass === "critical_write"
              ? confirmationToolMetadata(input.environment)._meta
              : {}),
            securitySchemes: structuredClone(securitySchemes),
          },
        }, async (arguments_) => {
          const parsed = inputSchema.parse(arguments_) as {
            input: unknown;
            idempotency_key?: string;
          };
          const parsedInput = bindOAuthClub(
            z.json().parse(parsed.input),
            input.context,
          );
          try {
            const result = await executeAction({
              runtime,
              parsed_input: parsedInput,
              idempotency_key: parsed.idempotency_key ?? null,
              confirmation: null,
            });
            const preview = confirmationPreview(result);
            if (preview) {
              if (
                !parsed.idempotency_key
                || !input.context.subject_id
                || !input.context.club_id
                || !input.context.capability_version
              ) {
                throw createConnectorError({
                  code: "CONFIG_INVALID",
                  message: "Die Wirkungsvorschau ist nicht vollständig an den aktuellen Kontext gebunden.",
                  request_id: input.context.request_id,
                  retryable: false,
                });
              }
              const operation = selectedOperation(
                canonicalDefinition,
                parsedInput,
              );
              if (!operation || operation.risk_class !== "critical_write") {
                throw createConnectorError({
                  code: "CONFIG_INVALID",
                  message: "Die Wirkungsvorschau gehört zu keiner kritischen Teilaktion.",
                  request_id: input.context.request_id,
                  retryable: false,
                });
              }
              await domainConfirmationRouter.register({
                preview_id: preview.preview_id,
                confirmation_token: preview.confirmation_token,
                request_id: input.context.request_id,
                subject_id: input.context.subject_id,
                club_id: input.context.club_id,
                capability_version: input.context.capability_version,
                action_id: canonicalDefinition.action_id,
                tool_name: toolName,
                operation: operation.operation,
                input: parsedInput,
                idempotency_key: parsed.idempotency_key,
                expires_at: Date.parse(preview.expires_at),
              });
              return confirmationWidgetResult({
                definition: canonicalDefinition,
                operation,
                tool_name: toolName,
                context: input.context,
                capability_snapshot: input.capability_snapshot,
                preview,
                idempotency_key: parsed.idempotency_key,
                environment: input.environment,
              });
            }
            return toMcpResult(input.context, result);
          } catch (error) {
            return executionError(input.context, error);
          }
        });
        registered.add(definition.action_id);
        summaries.push({
          name: toolName,
          ...copy,
          required_scopes: scopes,
          read_only: riskClass === "read",
          risk_class: riskClass,
        });
      }
    }
  }

  const visibleCritical = [...runtimeActions.values()].filter((runtime) =>
    highestRisk(definitionOperations(runtime.definition))
    === "critical_write");
  if (visibleCritical.length > 0) {
    const confirmedActionOutputSchema = outputUnion(
      visibleCritical.map((runtime) => runtime.output_schema),
    );
    const securitySchemes: ToolSecurityScheme[] = [{
      type: "oauth2",
      scopes: ["club.read"],
    }];
    input.advertised_security_schemes.set(
      ACTION_CONFIRM_TOOL_SUMMARY.name,
      securitySchemes,
    );
    registerAppTool(input.server, ACTION_CONFIRM_TOOL_SUMMARY.name, {
      title: ACTION_CONFIRM_TOOL_SUMMARY.title,
      description: ACTION_CONFIRM_TOOL_SUMMARY.description,
      inputSchema: ACTION_CONFIRM_INPUT_SCHEMA,
      outputSchema: confirmedActionOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ...confirmationActionToolMetadata()._meta,
        securitySchemes: structuredClone(securitySchemes),
      },
    }, async (arguments_) => {
      try {
        const parsed = ACTION_CONFIRM_INPUT_SCHEMA.parse(arguments_);
        const pending = await domainConfirmationRouter.consume({
          ...parsed,
          context: input.context,
        });
        const runtime = runtimeActions.get(pending.action_id);
        const stillVisible = runtime?.set.listVisible({
          context: input.context,
          capability_snapshot: input.capability_snapshot,
          provider_tool_updates: "dynamic",
        }).some((definition) =>
          definition.action_id === pending.action_id);
        if (
          !runtime
          || runtime.tool_name !== pending.tool_name
          || !stillVisible
        ) {
          throw createConnectorError({
            code: "PERMISSION_DENIED",
            message: "Die kritische Aktion ist im aktuellen Rechtekontext nicht mehr verfügbar.",
            request_id: input.context.request_id,
            retryable: false,
          });
        }
        const operation = selectedOperation(
          runtime.definition,
          pending.input,
        );
        if (
          !operation
          || operation.operation !== pending.operation
          || operation.risk_class !== "critical_write"
        ) {
          throw createConnectorError({
            code: "CONFIRMATION_MISMATCH",
            message: "Die bestätigte Teilaktion stimmt nicht mehr mit der Vorschau überein.",
            request_id: input.context.request_id,
            retryable: false,
          });
        }
        const result = await executeAction({
          runtime,
          parsed_input: pending.input,
          idempotency_key: pending.idempotency_key,
          confirmation: {
            preview_id: parsed.preview_id,
            confirmation_token: parsed.confirmation_token,
          },
        });
        if (confirmationPreview(result)) {
          throw createConnectorError({
            code: "CONFLICT",
            message: "Die Vorschau konnte nicht atomar bestätigt werden. Bitte erstelle eine neue Vorschau.",
            request_id: input.context.request_id,
            retryable: false,
          });
        }
        return toMcpResult(input.context, result);
      } catch (error) {
        return executionError(input.context, error);
      }
    });
  }

  return {
    tools: summaries.sort((left, right) => left.name.localeCompare(right.name)),
    blocked_action_ids: fullDomainCatalogSummary().blocked_action_ids,
  };
}
