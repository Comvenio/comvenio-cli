import {
  PermissionsExplainTool,
  type OAuthEnvironment,
} from "@comvenio/auth";
import { createComvenioApiClient } from "@comvenio/comvenio-client";
import {
  createProviderNeutralResult,
  isConnectorError,
  type JsonValue,
  type OAuthScope,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { StatelessTransportContext } from "./http/types.ts";
import { PublicAccessPolicy } from "./public/policy.ts";
import { PublicResponseRedactor } from "./public/redaction.ts";
import { PUBLIC_INPUT_SCHEMAS } from "./public/schemas.ts";
import { PublicToolSubset } from "./public/subset.ts";
import type {
  ProtectedToolDescriptor,
  PublicResolverAlias,
  PublicToolCandidate,
} from "./public/types.ts";
import { TaskToolSet } from "./tools/booking-object-task/index.ts";
import {
  eventCalendarToolMetadata,
  registerEventCalendarWidgetResource,
} from "./widgets/event-calendar/resource.ts";
import { EventCalendarWidgetProjector } from "./widgets/event-calendar/projector.ts";
import { EventWidgetCapabilityPolicy } from "./widgets/event-calendar/policy.ts";
import {
  newsToolMetadata,
  registerNewsWidgetResource,
} from "./widgets/news/resource.ts";
import { NewsWidgetProjector } from "./widgets/news/projector.ts";
import { NewsWidgetCapabilityPolicy } from "./widgets/news/policy.ts";
import {
  installToolSecuritySchemeProjection,
  type ToolSecurityScheme,
} from "./tool-security-schemes.ts";

const noInputSchema = z.object({}).strict();
const dateTime = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
const myTaskSchema = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  due_date: dateTime.nullable(),
  scheduled_start: dateTime.nullable(),
  scheduled_end: dateTime.nullable(),
}).strict();
const myTasksOutputSchema = z.object({
  club_id: uuid,
  range: z.object({ from: dateTime, to: dateTime }).strict(),
  tasks: z.array(myTaskSchema),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  undated_tasks_excluded: z.number().int().nonnegative(),
}).strict();
const myTasksSchema = z.object({
  from: dateTime.describe("Inklusiver Beginn des gewünschten Zeitraums als RFC-3339-Zeitpunkt."),
  to: dateTime.describe("Exklusives Ende des gewünschten Zeitraums als RFC-3339-Zeitpunkt."),
  include_completed: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
}).strict().refine((value) => Date.parse(value.from) < Date.parse(value.to), {
  message: "to muss nach from liegen.",
  path: ["to"],
});
const taskReminderSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("set"),
    task_id: uuid.describe("Task-ID aus cv_my_tasks_read."),
    reminder_at: dateTime.describe("Persönlicher Erinnerungszeitpunkt als RFC-3339-Zeitpunkt."),
    comment: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({
    operation: z.literal("delete"),
    task_id: uuid.describe("Task-ID aus cv_my_tasks_read."),
  }).strict(),
]);
const taskReminderResultSchema = z.object({
  id: uuid,
  task_id: uuid,
  reminder_at: dateTime,
  comment: z.string().nullable(),
}).strict();
const taskReminderOutputSchema = z.object({
  operation: z.enum(["set", "delete"]),
  task_id: uuid,
  reminder: taskReminderResultSchema.nullable(),
}).strict();

const PROTECTED_TOOLS = Object.freeze([
  { tool_name: "cv_whoami_read", required_scopes: ["club.read"] },
  { tool_name: "cv_permissions_explain_read", required_scopes: ["club.read"] },
  { tool_name: "cv_schema_read", required_scopes: ["club.read"] },
  { tool_name: "cv_my_tasks_read", required_scopes: ["task.read"] },
  { tool_name: "cv_my_task_reminder_write", required_scopes: ["task.read", "task.write"] },
] satisfies ProtectedToolDescriptor[]);

const TOOL_SCOPES = Object.freeze({
  cv_whoami_read: ["club.read"],
  cv_permissions_explain_read: ["club.read"],
  cv_schema_read: ["club.read"],
  cv_my_tasks_read: ["task.read"],
  cv_my_task_reminder_write: ["task.read", "task.write"],
} satisfies Record<(typeof PROTECTED_TOOLS)[number]["tool_name"], OAuthScope[]>);

const TOOL_COPY = Object.freeze({
  cv_whoami_read: {
    title: "Comvenio: Eigene Verbindung",
    description: "Ohne Eingabe aufrufen, wenn Vereinskontext oder Verbindung unklar sind. Zeigt den im OAuth-Grant gewählten Verein, den geprüften KI-Provider und die aktiven OAuth-Scopes.",
  },
  cv_permissions_explain_read: {
    title: "Comvenio: Eigene Rechte erklären",
    description: "Ohne Eingabe aufrufen. Erklärt ausschließlich deine effektiven Rechte im über OAuth gewählten Verein.",
  },
  cv_schema_read: {
    title: "Comvenio: Verfügbare Aktionen erklären",
    description: "Ohne Eingabe aufrufen. Listet die aktuell in deinem OAuth- und Rechtekontext sichtbaren Comvenio-Aktionen.",
  },
  cv_my_tasks_read: {
    title: "Comvenio: Eigene Aufgaben anzeigen",
    description: "Zeigt deine persönlichen, dir zugewiesenen Aufgaben im gewünschten Zeitraum. Verein und Mitglied werden sicher aus deiner OAuth-Verbindung abgeleitet; frage niemals nach club_id, Vereinsdomain oder Mitglieds-ID.",
  },
  cv_my_task_reminder_write: {
    title: "Comvenio: Eigene Aufgaben-Erinnerung verwalten",
    description: "Setzt oder löscht deine persönliche Erinnerung für eine Aufgabe. Verwende nur eine task_id aus cv_my_tasks_read; Verein und Benutzer werden sicher aus OAuth abgeleitet. Die Erinnerung wird ausschließlich dir zugestellt.",
  },
});

export interface RuntimeToolCatalog {
  public_tools: PublicToolCandidate[];
  protected_tools: ProtectedToolDescriptor[];
}

function publicCandidates(environment: OAuthEnvironment): PublicToolCandidate[] {
  const policy = new PublicAccessPolicy();
  return policy.list()
    .filter((contract) => contract.publication_state === "verified"
      && (environment === "development" || contract.availability === "all_environments"))
    .map((contract) => ({
      tool_name: contract.alias,
      resolver_alias: contract.alias,
      required_scopes: ["public.read"] as const,
      risk_class: "read" as const,
    }));
}

export function createRuntimeToolCatalog(environment: OAuthEnvironment): RuntimeToolCatalog {
  return {
    public_tools: publicCandidates(environment),
    protected_tools: PROTECTED_TOOLS.map((tool) => ({
      tool_name: tool.tool_name,
      required_scopes: [...tool.required_scopes],
    })),
  };
}

export function publishedRuntimeToolNames(environment: OAuthEnvironment): string[] {
  const catalog = createRuntimeToolCatalog(environment);
  return [
    ...catalog.public_tools.map((tool) => tool.tool_name),
    ...catalog.protected_tools.map((tool) => tool.tool_name),
  ].sort();
}

export function createRuntimeAccessPolicy(environment: OAuthEnvironment): PublicToolSubset {
  return new PublicToolSubset(createRuntimeToolCatalog(environment));
}

function anonymousContext(context: RequestContext): RequestContext {
  return {
    ...context,
    subject_id: null,
    oauth_grant_id: null,
    club_id: null,
    department_id: null,
    scopes: ["public.read"],
    capability_version: null,
  };
}

function pathFor(alias: PublicResolverAlias, input: Record<string, unknown>, template: string): string {
  return template.replace(/\{([a-z_]+)\}/gu, (_match, key: string) => {
    const value = input[key];
    if (typeof value !== "string") throw new Error(`${alias}: Pfadparameter ${key} fehlt.`);
    return encodeURIComponent(value);
  });
}

function queryFor(alias: PublicResolverAlias, input: Record<string, unknown>): Record<string, string> | undefined {
  const query: Record<string, string> = {};
  if (alias === "public_events") {
    query.from = String(input.from);
    query.to = String(input.to);
    query.limit = String(input.limit);
  } else if (["public_training", "public_news"].includes(alias)) {
    query.limit = String(input.limit);
  } else if (alias === "public_department_news") {
    query.department_id = String(input.department_id);
    query.limit = String(input.limit);
  }
  return Object.keys(query).length ? query : undefined;
}

function widgetMetadata(alias: PublicResolverAlias, environment: OAuthEnvironment): Record<string, unknown> | undefined {
  if (alias === "public_events") {
    return eventCalendarToolMetadata(environment)._meta;
  }
  if (["public_news", "public_department_news"].includes(alias)) {
    return newsToolMetadata(environment)._meta;
  }
  return undefined;
}

function noAuthSecuritySchemes(): ToolSecurityScheme[] {
  return [{ type: "noauth" }];
}

function oauthSecuritySchemes(scopes: OAuthScope[]): ToolSecurityScheme[] {
  return [{ type: "oauth2", scopes: [...scopes] }];
}

function withSecurityMetadata(
  metadata: Record<string, unknown> | undefined,
  securitySchemes: ToolSecurityScheme[],
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    securitySchemes: structuredClone(securitySchemes),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function projectPublicWidgetModel(
  alias: PublicResolverAlias,
  parsed: Record<string, unknown>,
  redacted: JsonValue,
): JsonValue | null {
  const clubId = typeof parsed.club_id === "string" ? parsed.club_id : null;
  if (!clubId) return null;

  if (alias === "public_events") {
    const events = Array.isArray(redacted)
      ? redacted.filter((item) => {
        const value = record(item);
        return typeof value?.start === "string" && typeof value.end === "string";
      })
      : [];
    return z.json().parse(new EventCalendarWidgetProjector(new EventWidgetCapabilityPolicy([])).public({
      club: { club_id: clubId, name: "Verein", timezone: "Europe/Berlin" },
      range: { from: String(parsed.from), to: String(parsed.to) },
      source: events as JsonValue,
    }));
  }

  if (alias === "public_news" || alias === "public_department_news") {
    return z.json().parse(new NewsWidgetProjector(new NewsWidgetCapabilityPolicy([])).public({
      club: { club_id: clubId, name: "Verein", timezone: "Europe/Berlin" },
      source: redacted,
    }));
  }
  return null;
}

function safeText(value: JsonValue): string {
  const encoded = JSON.stringify(value);
  return encoded.length <= 80_000 ? encoded : JSON.stringify({ truncated: true });
}

function toMcpResult(result: ReturnType<typeof createProviderNeutralResult>): CallToolResult {
  if (result.structuredContent === null || typeof result.structuredContent !== "object"
    || Array.isArray(result.structuredContent)) {
    throw new Error("Das strukturierte Tool-Ergebnis muss ein Objekt sein.");
  }
  return {
    content: result.content,
    structuredContent: result.structuredContent as Record<string, unknown>,
    _meta: result._meta,
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  };
}

async function executePublic(input: {
  alias: PublicResolverAlias;
  arguments: unknown;
  api_base_url: string;
  context: RequestContext;
}): Promise<CallToolResult> {
  const parsed = PUBLIC_INPUT_SCHEMAS[input.alias].parse(input.arguments) as Record<string, unknown>;
  const policy = new PublicAccessPolicy();
  const contract = policy.assertPublishable(input.alias);
  const context = policy.assertAnonymousContext(anonymousContext(input.context));
  const client = createComvenioApiClient({ gatewayBaseUrl: input.api_base_url });
  let response: JsonValue;
  try {
    response = await client.request({
      method: "GET",
      service: contract.service,
      path: pathFor(input.alias, parsed, contract.normalized_path_template),
      query: queryFor(input.alias, parsed),
      context,
    });
  } catch (error) {
    return policy.normalizeHiddenResource(error, context.request_id);
  }
  const expectedClubId = typeof parsed.club_id === "string" ? parsed.club_id : undefined;
  const redacted = new PublicResponseRedactor(policy).redact({
    alias: input.alias,
    response,
    request_id: context.request_id,
    expected_club_id: expectedClubId,
  });
  const widgetModel = projectPublicWidgetModel(input.alias, parsed, redacted);
  return toMcpResult(createProviderNeutralResult(
    context,
    widgetModel ?? { result: redacted },
    [{ type: "text", text: safeText(redacted) }],
  ));
}

function taskTimestamp(task: Record<string, unknown>): number | null {
  for (const key of ["due_date", "scheduled_start", "scheduled_end"] as const) {
    const value = task[key];
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function projectMyTask(task: Record<string, JsonValue>): z.infer<typeof myTaskSchema> | null {
  const parsed = myTaskSchema.safeParse({
    id: task.id,
    title: task.title,
    description: typeof task.description === "string" ? task.description : null,
    status: typeof task.status === "string" ? task.status : null,
    priority: typeof task.priority === "string" ? task.priority : null,
    due_date: typeof task.due_date === "string" ? task.due_date : null,
    scheduled_start: typeof task.scheduled_start === "string" ? task.scheduled_start : null,
    scheduled_end: typeof task.scheduled_end === "string" ? task.scheduled_end : null,
  });
  return parsed.success ? parsed.data : null;
}

function filterMyTasks(input: {
  result: JsonValue;
  from: string;
  to: string;
  include_completed: boolean;
  limit: number;
}): Record<string, JsonValue> {
  const source = Array.isArray(input.result)
    ? input.result.filter((item): item is Record<string, JsonValue> =>
      item !== null && typeof item === "object" && !Array.isArray(item))
    : [];
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  let undated = 0;
  const matching = source.flatMap((task) => {
    const timestamp = taskTimestamp(task);
    if (timestamp === null) {
      undated++;
      return [];
    }
    if (task.status === "cancelled" || (!input.include_completed && task.status === "completed")) {
      return [];
    }
    if (timestamp < from || timestamp >= to) return [];
    const projected = projectMyTask(task);
    return projected ? [projected] : [];
  });
  const tasks = matching.slice(0, input.limit);
  return {
    range: { from: input.from, to: input.to },
    tasks,
    returned: tasks.length,
    truncated: matching.length > input.limit,
    undated_tasks_excluded: undated,
  };
}

function projectTaskReminder(value: JsonValue): z.infer<typeof taskReminderOutputSchema>["reminder"] {
  const source = record(value);
  const parsed = source
    ? taskReminderResultSchema.safeParse({
        id: source.id,
        task_id: source.task_id,
        reminder_at: source.reminder_at,
        comment: typeof source.comment === "string" ? source.comment : null,
      })
    : null;
  if (!parsed || !parsed.success) {
    throw new Error("Der Automation-Service hat keine gültige Reminder-Antwort geliefert.");
  }
  return parsed.data;
}

function protectedToolError(
  context: RequestContext,
  code: string,
  text: string,
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: { error: code },
    _meta: {
      request_id: context.request_id,
      ...(context.capability_version
        ? { capability_version: context.capability_version }
        : {}),
    },
    isError: true,
  };
}

function insufficientScopeResult(
  publicOrigin: string,
  scope: OAuthScope,
): CallToolResult {
  const challenge = `Bearer resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Für persönliche Aufgaben wird der OAuth-Scope ${scope} benötigt.", scope="${scope}"`;
  return {
    content: [{
      type: "text",
      text: `Deine Comvenio-Verbindung benötigt zusätzlich den OAuth-Scope ${scope}. Bitte autorisiere die Verbindung erneut.`,
    }],
    structuredContent: {
      error: "insufficient_scope",
      required_scope: scope,
    },
    _meta: {
      "mcp/www_authenticate": [challenge],
    },
    isError: true,
  };
}

export function createRuntimeServer(input: {
  environment: OAuthEnvironment;
  api_base_url: string;
  public_origin: string;
  context: StatelessTransportContext;
}): McpServer {
  const server = new McpServer({ name: "comvenio-mcp-server", version: "1.0.0" });
  const advertisedSecuritySchemes = new Map<string, readonly ToolSecurityScheme[]>();
  registerEventCalendarWidgetResource(server, input.environment);
  registerNewsWidgetResource(server, input.environment);
  const catalog = createRuntimeToolCatalog(input.environment);
  const publicDescriptors = new PublicToolSubset({ public_tools: catalog.public_tools }).list();
  for (const descriptor of publicDescriptors) {
    const alias = descriptor.resolver_alias;
    const securitySchemes = noAuthSecuritySchemes();
    advertisedSecuritySchemes.set(alias, securitySchemes);
    const metadata = widgetMetadata(alias, input.environment);
    registerAppTool(server, alias, {
      title: descriptor.title,
      description: descriptor.description,
      inputSchema: PUBLIC_INPUT_SCHEMAS[alias],
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: withSecurityMetadata(metadata, securitySchemes),
    }, async (arguments_) => executePublic({
      alias,
      arguments: arguments_,
      api_base_url: input.api_base_url,
      context: input.context.request,
    }));
  }

  if (
    input.context.provider_request.authenticated
    && input.context.capability_snapshot
    && input.context.request.scopes.includes("club.read")
  ) {
    const clubReadSecuritySchemes = oauthSecuritySchemes(["club.read"]);
    advertisedSecuritySchemes.set("cv_whoami_read", clubReadSecuritySchemes);
    registerAppTool(server, "cv_whoami_read", {
      ...TOOL_COPY.cv_whoami_read,
      inputSchema: noInputSchema,
      _meta: withSecurityMetadata(undefined, clubReadSecuritySchemes),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
      const output = {
        club_id: input.context.request.club_id,
        department_id: input.context.request.department_id,
        provider: input.context.request.provider,
        scopes: input.context.request.scopes,
        capability_version: input.context.request.capability_version,
      } satisfies Record<string, JsonValue>;
      return toMcpResult(createProviderNeutralResult(input.context.request, output, [{
        type: "text",
        text: "Deine Comvenio-Verbindung ist aktiv und an den ausgewählten Verein gebunden.",
      }]));
    });

    advertisedSecuritySchemes.set("cv_permissions_explain_read", clubReadSecuritySchemes);
    registerAppTool(server, "cv_permissions_explain_read", {
      ...TOOL_COPY.cv_permissions_explain_read,
      inputSchema: noInputSchema,
      _meta: withSecurityMetadata(undefined, clubReadSecuritySchemes),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
      const clubId = input.context.request.club_id;
      if (!clubId) throw new Error("Der OAuth-Grant enthält keinen gebundenen Verein.");
      return toMcpResult(new PermissionsExplainTool().execute(
        {
          club_id: clubId,
          ...(input.context.request.department_id
            ? { department_id: input.context.request.department_id }
            : {}),
        },
        input.context.request,
        input.context.capability_snapshot!,
      ));
    });

    advertisedSecuritySchemes.set("cv_schema_read", clubReadSecuritySchemes);
    registerAppTool(server, "cv_schema_read", {
      ...TOOL_COPY.cv_schema_read,
      inputSchema: noInputSchema,
      _meta: withSecurityMetadata(undefined, clubReadSecuritySchemes),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
      const tools = [
        ...publicDescriptors.map((tool) => ({
          name: tool.resolver_alias,
          title: tool.title,
          description: tool.description,
          required_scopes: ["public.read"] as OAuthScope[],
          read_only: true,
        })),
        ...Object.entries(TOOL_COPY)
          .filter(([name]) =>
            TOOL_SCOPES[name as keyof typeof TOOL_SCOPES].every((scope) =>
              input.context.request.scopes.includes(scope)))
          .map(([name, copy]) => ({
            name,
            ...copy,
            required_scopes: TOOL_SCOPES[name as keyof typeof TOOL_SCOPES],
            read_only: name !== "cv_my_task_reminder_write",
          })),
      ].sort((left, right) => left.name.localeCompare(right.name));
      return toMcpResult(createProviderNeutralResult(input.context.request, { tools }, [{
        type: "text",
        text: `${tools.length} Aktionen sind in diesem Verbindungskontext verfügbar.`,
      }]));
    });

    const clubId = input.context.request.club_id;
    const backendActorToken = input.context.backend_actor_token;
    if (clubId && backendActorToken) {
      const taskReadSecuritySchemes = oauthSecuritySchemes(["task.read"]);
      const apiClient = createComvenioApiClient({
        gatewayBaseUrl: input.api_base_url,
        accessToken: backendActorToken,
      });
      const tasks = new TaskToolSet({
        client: apiClient,
      });
      if (input.context.request.scopes.includes("task.read")) {
        advertisedSecuritySchemes.set("cv_my_tasks_read", taskReadSecuritySchemes);
        registerAppTool(server, "cv_my_tasks_read", {
          ...TOOL_COPY.cv_my_tasks_read,
          inputSchema: myTasksSchema,
          outputSchema: myTasksOutputSchema,
          _meta: withSecurityMetadata(undefined, taskReadSecuritySchemes),
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        }, async (arguments_) => {
          const parsed = myTasksSchema.parse(arguments_);
          try {
            const result = await tasks.execute({
              action_id: "cai.task.01.list",
              input: {
                club_id: clubId,
                operation: "mine",
                limit: 100,
                offset: 0,
              },
              context: input.context.request,
              capability_snapshot: input.context.capability_snapshot,
            });
            const output = {
              club_id: clubId,
              ...filterMyTasks({
                result: result.result,
                from: parsed.from,
                to: parsed.to,
                include_completed: parsed.include_completed,
                limit: parsed.limit,
              }),
            } satisfies Record<string, JsonValue>;
            return toMcpResult(createProviderNeutralResult(
              input.context.request,
              output,
              [{ type: "text", text: safeText(output) }],
            ));
          } catch (error) {
            if (isConnectorError(error) && error.code === "SCOPE_REQUIRED") {
              return insufficientScopeResult(
                input.public_origin,
                error.required_scope ?? "task.read",
              );
            }
            throw error;
          }
        });
      }

      if (
        input.context.request.scopes.includes("task.read")
        && input.context.request.scopes.includes("task.write")
      ) {
        const taskReminderSecuritySchemes = oauthSecuritySchemes([
          "task.read",
          "task.write",
        ]);
        advertisedSecuritySchemes.set(
          "cv_my_task_reminder_write",
          taskReminderSecuritySchemes,
        );
        registerAppTool(server, "cv_my_task_reminder_write", {
          ...TOOL_COPY.cv_my_task_reminder_write,
          inputSchema: taskReminderSchema,
          outputSchema: taskReminderOutputSchema,
          _meta: withSecurityMetadata(undefined, taskReminderSecuritySchemes),
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        }, async (arguments_) => {
          const parsed = taskReminderSchema.parse(arguments_);
          for (const scope of ["task.read", "task.write"] as const) {
            if (!input.context.request.scopes.includes(scope)) {
              return insufficientScopeResult(input.public_origin, scope);
            }
          }

          try {
            if (parsed.operation === "set") {
              if (Date.parse(parsed.reminder_at) <= Date.now()) {
                return protectedToolError(
                  input.context.request,
                  "validation_failed",
                  "Der Erinnerungszeitpunkt muss in der Zukunft liegen.",
                );
              }
              const response = await apiClient.request<JsonValue>({
                method: "POST",
                service: "automation",
                path: "/custom_reminders/task",
                body: {
                  task_id: parsed.task_id,
                  reminder_at: parsed.reminder_at,
                  ...(parsed.comment ? { comment: parsed.comment } : {}),
                },
                context: input.context.request,
              });
              const output = {
                operation: "set",
                task_id: parsed.task_id,
                reminder: projectTaskReminder(response),
              } satisfies z.infer<typeof taskReminderOutputSchema>;
              return toMcpResult(createProviderNeutralResult(
                input.context.request,
                output,
                [{
                  type: "text",
                  text: "Deine persönliche Aufgaben-Erinnerung wurde gespeichert.",
                }],
              ));
            }

            await apiClient.request({
              method: "DELETE",
              service: "automation",
              path: (
                `/custom_reminders/task/by-task/`
                + encodeURIComponent(parsed.task_id)
              ),
              context: input.context.request,
            });
            const output = {
              operation: "delete",
              task_id: parsed.task_id,
              reminder: null,
            } satisfies z.infer<typeof taskReminderOutputSchema>;
            return toMcpResult(createProviderNeutralResult(
              input.context.request,
              output,
              [{
                type: "text",
                text: "Deine persönliche Aufgaben-Erinnerung wurde gelöscht.",
              }],
            ));
          } catch (error) {
            if (isConnectorError(error) && error.code === "PERMISSION_DENIED") {
              return protectedToolError(
                input.context.request,
                "permission_denied",
                "Die Aufgabe ist in deinem aktuellen Vereins- und Rechtekontext nicht verfügbar.",
              );
            }
            if (isConnectorError(error) && error.code === "NOT_FOUND") {
              return protectedToolError(
                input.context.request,
                "not_found",
                "Die Aufgabe oder Erinnerung wurde nicht gefunden.",
              );
            }
            throw error;
          }
        });
      }
    }
  }
  installToolSecuritySchemeProjection(server, advertisedSecuritySchemes);
  return server;
}
