import {
  PermissionsExplainTool,
  type OAuthEnvironment,
} from "@comvenio/auth";
import { createComvenioApiClient } from "@comvenio/comvenio-client";
import {
  createProviderNeutralResult,
  type JsonValue,
  type OAuthScope,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

const uuid = z.string().uuid();
const clubContextSchema = z.object({ club_id: uuid, department_id: uuid.optional() }).strict();

const PROTECTED_TOOLS = Object.freeze([
  { tool_name: "cv_whoami_read", required_scopes: ["club.read"] },
  { tool_name: "cv_permissions_explain_read", required_scopes: ["club.read"] },
  { tool_name: "cv_schema_read", required_scopes: ["club.read"] },
] satisfies ProtectedToolDescriptor[]);

const TOOL_COPY = Object.freeze({
  cv_whoami_read: {
    title: "Comvenio: Eigene Verbindung",
    description: "Zeigt den gewählten Verein, den geprüften KI-Provider und die aktiven OAuth-Scopes.",
  },
  cv_permissions_explain_read: {
    title: "Comvenio: Eigene Rechte erklären",
    description: "Erklärt ausschließlich deine effektiven Rechte im gewählten Verein.",
  },
  cv_schema_read: {
    title: "Comvenio: Verfügbare Aktionen erklären",
    description: "Listet die aktuell in deinem Rechtekontext sichtbaren Comvenio-Aktionen.",
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

function assertClub(input: unknown, context: RequestContext): { club_id: string; department_id?: string } {
  const parsed = clubContextSchema.parse(input);
  if (context.club_id !== parsed.club_id || context.department_id !== (parsed.department_id ?? null)) {
    throw new Error("Der Tool-Aufruf passt nicht zum gewählten Vereins- oder Abteilungskontext.");
  }
  return parsed;
}

export function createRuntimeServer(input: {
  environment: OAuthEnvironment;
  api_base_url: string;
  context: StatelessTransportContext;
}): McpServer {
  const server = new McpServer({ name: "comvenio-mcp-server", version: "1.0.0" });
  registerEventCalendarWidgetResource(server, input.environment);
  registerNewsWidgetResource(server, input.environment);
  const catalog = createRuntimeToolCatalog(input.environment);
  const publicDescriptors = new PublicToolSubset({ public_tools: catalog.public_tools }).list();
  for (const descriptor of publicDescriptors) {
    const alias = descriptor.resolver_alias;
    server.registerTool(alias, {
      title: descriptor.title,
      description: descriptor.description,
      inputSchema: PUBLIC_INPUT_SCHEMAS[alias],
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(widgetMetadata(alias, input.environment) ? { _meta: widgetMetadata(alias, input.environment) } : {}),
    }, async (arguments_) => executePublic({
      alias,
      arguments: arguments_,
      api_base_url: input.api_base_url,
      context: input.context.request,
    }));
  }

  if (input.context.provider_request.authenticated && input.context.capability_snapshot) {
    server.registerTool("cv_whoami_read", {
      ...TOOL_COPY.cv_whoami_read,
      inputSchema: clubContextSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (arguments_) => {
      assertClub(arguments_, input.context.request);
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

    server.registerTool("cv_permissions_explain_read", {
      ...TOOL_COPY.cv_permissions_explain_read,
      inputSchema: clubContextSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (arguments_) => {
      const parsed = assertClub(arguments_, input.context.request);
      return toMcpResult(new PermissionsExplainTool().execute(
        parsed,
        input.context.request,
        input.context.capability_snapshot!,
      ));
    });

    server.registerTool("cv_schema_read", {
      ...TOOL_COPY.cv_schema_read,
      inputSchema: clubContextSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (arguments_) => {
      assertClub(arguments_, input.context.request);
      const tools = [
        ...publicDescriptors.map((tool) => ({
          name: tool.resolver_alias,
          title: tool.title,
          description: tool.description,
          required_scopes: ["public.read"] as OAuthScope[],
          read_only: true,
        })),
        ...Object.entries(TOOL_COPY).map(([name, copy]) => ({
          name,
          ...copy,
          required_scopes: ["club.read"] as OAuthScope[],
          read_only: true,
        })),
      ].sort((left, right) => left.name.localeCompare(right.name));
      return toMcpResult(createProviderNeutralResult(input.context.request, { tools }, [{
        type: "text",
        text: `${tools.length} Aktionen sind in diesem Verbindungskontext verfügbar.`,
      }]));
    });
  }
  return server;
}
