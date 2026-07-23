import type {
  CapabilitySnapshot,
  OAuthEnvironment,
} from "@comvenio/auth";
import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import {
  BOOKING_OBJECT_WIDGET_SCHEMA,
  EVENT_CALENDAR_WIDGET_SCHEMA,
  MEMBER_MANAGEMENT_WIDGET_SCHEMA,
  NEWS_WIDGET_SCHEMA,
  createConnectorError,
  createProviderNeutralResult,
  isConnectorError,
  type JsonValue,
  type OAuthScope,
  type RequestContext,
  type ServerActionDescriptor,
} from "@comvenio/connector-contracts";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainToolSummary } from "./domain-runtime.ts";
import type { ToolSecurityScheme } from "./tool-security-schemes.ts";
import {
  AvailabilityContract,
  createK10ToolSets,
} from "./tools/booking-object-task/index.ts";
import {
  createK12ToolSets,
} from "./tools/content-homepage-news-data/index.ts";
import {
  createK8ToolSets,
  localDateBoundaryUtc,
} from "./tools/event-plan/index.ts";
import {
  createK7ToolSets,
} from "./tools/identity-club-member-team-role/index.ts";
import { BookingObjectWidgetProjector } from "./widgets/booking-object/projector.ts";
import { BookingWidgetCapabilityPolicy } from "./widgets/booking-object/policy.ts";
import { bookingObjectToolMetadata } from "./widgets/booking-object/resource.ts";
import { EventCalendarWidgetProjector } from "./widgets/event-calendar/projector.ts";
import { EventWidgetCapabilityPolicy } from "./widgets/event-calendar/policy.ts";
import { eventCalendarToolMetadata } from "./widgets/event-calendar/resource.ts";
import { MemberManagementWidgetProjector } from "./widgets/member-management/projector.ts";
import { MemberWidgetCapabilityPolicy } from "./widgets/member-management/policy.ts";
import { memberManagementToolMetadata } from "./widgets/member-management/resource.ts";
import { NewsWidgetProjector } from "./widgets/news/projector.ts";
import { NewsWidgetCapabilityPolicy } from "./widgets/news/policy.ts";
import { newsToolMetadata } from "./widgets/news/resource.ts";

export const EVENT_CALENDAR_WIDGET_TOOL_NAME =
  "cv_event_calendar_widget_read" as const;
export const NEWS_WIDGET_TOOL_NAME =
  "cv_news_widget_read" as const;
export const MEMBER_MANAGEMENT_WIDGET_TOOL_NAME =
  "cv_member_management_widget_read" as const;
export const BOOKING_OBJECT_WIDGET_TOOL_NAME =
  "cv_booking_object_widget_read" as const;

const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const dateTime = z.string().datetime({ offset: true });
const timezone = z.string().trim().min(3).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: value }).format(0);
    return value.includes("/") && !value.startsWith("Etc/");
  } catch {
    return false;
  }
}, "IANA-Zeitzone erforderlich.");

const eventWidgetInputSchema = z.object({
  from: localDate.describe("Inklusiver lokaler Starttag im Format YYYY-MM-DD."),
  to: localDate.describe("Exklusiver lokaler Endtag im Format YYYY-MM-DD."),
  timezone: timezone.default("Europe/Berlin"),
  view: z.enum(["agenda", "week", "month"]).default("week"),
  limit: z.number().int().min(1).max(200).default(100),
}).strict().superRefine((value, context) => {
  if (value.from >= value.to) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "Der exklusive Endtag muss nach dem Starttag liegen.",
    });
  }
});
const newsWidgetInputSchema = z.object({
  filter: z.enum(["draft", "all_authorized"]).default("all_authorized"),
  selected_news_id: uuid.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
}).strict();
const memberWidgetInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  member_id: uuid.optional().describe(
    "Mitglied aus derselben angezeigten Liste, dessen Details explizit geöffnet werden sollen.",
  ),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
}).strict();
const bookingWidgetInputSchema = z.object({
  from: dateTime.describe("Inklusiver Beginn des angezeigten Zeitraums."),
  to: dateTime.describe("Exklusives Ende des angezeigten Zeitraums."),
  timezone: timezone.default("Europe/Berlin"),
  object_type: z.enum(["static", "portable", "event"]).optional(),
  selected_object_id: uuid.optional(),
  object_id: uuid.optional().describe(
    "Nur für einen servergenerierten Widget-Folgeaufruf zur Objektauswahl.",
  ),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.to) <= Date.parse(value.from)) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "to muss nach from liegen.",
    });
  }
  if (
    value.selected_object_id
    && value.object_id
    && value.selected_object_id !== value.object_id
  ) {
    context.addIssue({
      code: "custom",
      path: ["object_id"],
      message: "Die Widget-Objektbindung ist widersprüchlich.",
    });
  }
});

const memberListPageSchema = z.object({
  items: z.array(z.object({
    member_id: uuid,
    display_name: z.string(),
    status_label: z.string().nullable(),
    department_labels: z.array(z.string()),
    email_masked: z.string().nullable(),
    phone_masked: z.string().nullable(),
  }).strict()).max(100),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0),
  total: z.number().int().min(0).nullable(),
}).strict();
const objectListSchema = z.union([
  z.array(z.object({
    id: uuid.optional(),
    object_id: uuid.optional(),
    club_id: uuid,
    name: z.string(),
  }).passthrough()).max(100),
  z.object({
    items: z.array(z.object({
      id: uuid.optional(),
      object_id: uuid.optional(),
      club_id: uuid,
      name: z.string(),
    }).passthrough()).max(100),
  }).passthrough(),
]);

const MEMBER_WIDGET_SUMMARY: DomainToolSummary = {
  name: MEMBER_MANAGEMENT_WIDGET_TOOL_NAME,
  title: "Comvenio: Mitgliederübersicht öffnen",
  description: "Zeigt die datensparsame Mitgliederübersicht des über OAuth verbundenen Vereins. Verein und Rechte werden serverseitig abgeleitet; frage niemals nach club_id. Nicht maskierte Details werden nur nach einem expliziten, erneut berechtigten Folgeaufruf geladen.",
  required_scopes: ["member.read.basic"],
  read_only: true,
  risk_class: "read",
};
const EVENT_WIDGET_SUMMARY: DomainToolSummary = {
  name: EVENT_CALENDAR_WIDGET_TOOL_NAME,
  title: "Comvenio: Persönlichen Vereinskalender öffnen",
  description: "Zeigt alle im aktuellen OAuth- und Rechtekontext freigegebenen Vereinstermine im Kalender. Der Verein wird aus OAuth abgeleitet; frage niemals nach club_id oder Vereinsdomain.",
  required_scopes: ["event.read"],
  read_only: true,
  risk_class: "read",
};
const NEWS_WIDGET_SUMMARY: DomainToolSummary = {
  name: NEWS_WIDGET_TOOL_NAME,
  title: "Comvenio: Freigegebene News öffnen",
  description: "Zeigt veröffentlichte Beiträge und – bei entsprechender Berechtigung – interne News oder Entwürfe des über OAuth verbundenen Vereins. Der Verein wird serverseitig gebunden; frage niemals nach club_id.",
  required_scopes: ["content.read"],
  read_only: true,
  risk_class: "read",
};
const BOOKING_WIDGET_SUMMARY: DomainToolSummary = {
  name: BOOKING_OBJECT_WIDGET_TOOL_NAME,
  title: "Comvenio: Objekte und Verfügbarkeit öffnen",
  description: "Zeigt freigegebene Buchungsobjekte und prüft nach expliziter Objektauswahl deren Verfügbarkeit im angegebenen Zeitraum. Der Verein wird aus OAuth abgeleitet; frage niemals nach club_id.",
  required_scopes: ["booking.read", "object.read"],
  read_only: true,
  risk_class: "read",
};

function oauthSecuritySchemes(scopes: OAuthScope[]): ToolSecurityScheme[] {
  return [{ type: "oauth2", scopes: [...scopes] }];
}

function metadata(
  widget: Record<string, unknown>,
  schemes: ToolSecurityScheme[],
): Record<string, unknown> {
  return {
    ...widget,
    securitySchemes: structuredClone(schemes),
  };
}

function oauthClubId(context: RequestContext): string {
  if (!context.club_id) {
    throw createConnectorError({
      code: "CLUB_SELECTION_REQUIRED",
      message: "Der OAuth-Grant enthält keinen ausgewählten Verein.",
      request_id: context.request_id,
      retryable: false,
    });
  }
  return context.club_id;
}

function widgetResult(
  context: RequestContext,
  modelInput: unknown,
  text: string,
  widgetMetadata: Record<string, unknown>,
): CallToolResult {
  const model = z.record(z.string(), z.json()).parse(modelInput);
  const result = createProviderNeutralResult(
    context,
    model,
    [{ type: "text", text }],
  );
  return {
    ...result,
    structuredContent: model,
    _meta: {
      ...result._meta,
      ...widgetMetadata,
    },
  };
}

function widgetError(
  context: RequestContext,
  error: unknown,
): CallToolResult {
  const connectorError = isConnectorError(error) ? error : null;
  const hidden = connectorError?.code === "PERMISSION_DENIED"
    || connectorError?.code === "NOT_FOUND"
    || connectorError?.code === "TENANT_MISMATCH";
  return {
    content: [{
      type: "text",
      text: hidden
        ? "Diese Ansicht ist in deinem aktuellen Vereins- und Rechtekontext nicht verfügbar."
        : "Die Comvenio-Ansicht konnte nicht sicher geladen werden.",
    }],
    structuredContent: {
      error: connectorError?.code.toLowerCase() ?? "upstream_unavailable",
      ...(connectorError?.required_scope
        ? { required_scope: connectorError.required_scope }
        : {}),
    },
    _meta: { request_id: context.request_id },
    isError: true,
  };
}

function filterMembers(
  page: z.infer<typeof memberListPageSchema>,
  query: string | undefined,
): z.infer<typeof memberListPageSchema> {
  const normalized = query?.trim().toLocaleLowerCase("de-DE");
  if (!normalized) return page;
  const items = page.items.filter((item) => [
    item.display_name,
    item.status_label ?? "",
    ...item.department_labels,
  ].some((value) => value.toLocaleLowerCase("de-DE").includes(normalized)));
  return {
    ...page,
    items,
    total: items.length,
  };
}

function objectItems(
  value: JsonValue,
): Array<Record<string, JsonValue>> {
  const parsed = objectListSchema.parse(value);
  const items = Array.isArray(parsed) ? parsed : parsed.items;
  return items.map((item) => z.record(z.string(), z.json()).parse(item));
}

function objectId(
  value: Record<string, JsonValue>,
): string | null {
  return typeof value.object_id === "string"
    ? value.object_id
    : typeof value.id === "string"
      ? value.id
      : null;
}

function actionDescriptor(input: {
  action_id: string;
  label: string;
  tool_name: string;
  arguments: Record<string, JsonValue>;
}): ServerActionDescriptor {
  return {
    action_id: input.action_id,
    label: input.label,
    tool_name: input.tool_name,
    input: input.arguments,
    visibility: "visible",
    enabled: true,
    risk_class: "read",
    requires_confirmation: false,
    disabled_reason: null,
  };
}

export function fullWidgetReviewToolSummaries(): DomainToolSummary[] {
  return [
    structuredClone(BOOKING_WIDGET_SUMMARY),
    structuredClone(EVENT_WIDGET_SUMMARY),
    structuredClone(MEMBER_WIDGET_SUMMARY),
    structuredClone(NEWS_WIDGET_SUMMARY),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

export function fullWidgetProtectedToolDescriptors(): Array<{
  tool_name: string;
  required_scopes: OAuthScope[];
}> {
  return fullWidgetReviewToolSummaries().map((tool) => ({
    tool_name: tool.name,
    required_scopes: [...tool.required_scopes],
  }));
}

export function registerFullWidgetRuntime(input: {
  server: McpServer;
  client: ComvenioApiClient;
  context: RequestContext;
  capability_snapshot: CapabilitySnapshot;
  environment: OAuthEnvironment;
  advertised_security_schemes: Map<string, readonly ToolSecurityScheme[]>;
}): { tools: DomainToolSummary[] } {
  const visibleTools: DomainToolSummary[] = [];
  const clubId = oauthClubId(input.context);

  const k8 = createK8ToolSets({ client: input.client });
  const visibleEventActions = new Set(k8.event.listVisible({
    context: input.context,
    capability_snapshot: input.capability_snapshot,
    provider_tool_updates: "dynamic",
  }).map((definition) => definition.action_id));
  if (visibleEventActions.has("cai.event.01.list")) {
    const schemes = oauthSecuritySchemes(["event.read"]);
    input.advertised_security_schemes.set(
      EVENT_CALENDAR_WIDGET_TOOL_NAME,
      schemes,
    );
    registerAppTool(input.server, EVENT_CALENDAR_WIDGET_TOOL_NAME, {
      title: EVENT_WIDGET_SUMMARY.title,
      description: EVENT_WIDGET_SUMMARY.description,
      inputSchema: eventWidgetInputSchema,
      outputSchema: EVENT_CALENDAR_WIDGET_SCHEMA,
      _meta: metadata(
        eventCalendarToolMetadata(input.environment)._meta,
        schemes,
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async (arguments_) => {
      try {
        const parsed = eventWidgetInputSchema.parse(arguments_);
        const eventResult = await k8.event.execute({
          action_id: "cai.event.01.list",
          input: {
            club_id: clubId,
            range: {
              from: parsed.from,
              to: parsed.to,
              timezone: parsed.timezone,
              from_inclusive: true,
              to_exclusive: true,
            },
            view: parsed.view,
            limit: parsed.limit,
          },
          context: input.context,
          capability_snapshot: input.capability_snapshot,
        });
        const model = new EventCalendarWidgetProjector(
          new EventWidgetCapabilityPolicy([]),
        ).private({
          club: {
            club_id: clubId,
            name: "Ausgewählter Verein",
            timezone: input.context.timezone,
          },
          context: input.context,
          capability_snapshot: input.capability_snapshot,
          range: {
            from: localDateBoundaryUtc(parsed.from, parsed.timezone),
            to: localDateBoundaryUtc(parsed.to, parsed.timezone),
          },
          view: parsed.view,
          source: eventResult.result,
          action_candidates: [],
        });
        return widgetResult(
          input.context,
          model,
          `${model.data.events.length} freigegebene Termine werden angezeigt.`,
          eventCalendarToolMetadata(input.environment)._meta,
        );
      } catch (error) {
        return widgetError(input.context, error);
      }
    });
    visibleTools.push(structuredClone(EVENT_WIDGET_SUMMARY));
  }

  const k12 = createK12ToolSets({ client: input.client });
  const visibleNewsActions = new Set(k12.news.listVisible({
    context: input.context,
    capability_snapshot: input.capability_snapshot,
    provider_tool_updates: "dynamic",
  }).map((definition) => definition.action_id));
  if (visibleNewsActions.has("cai.news.01.list")) {
    const schemes = oauthSecuritySchemes(["content.read"]);
    input.advertised_security_schemes.set(NEWS_WIDGET_TOOL_NAME, schemes);
    registerAppTool(input.server, NEWS_WIDGET_TOOL_NAME, {
      title: NEWS_WIDGET_SUMMARY.title,
      description: NEWS_WIDGET_SUMMARY.description,
      inputSchema: newsWidgetInputSchema,
      outputSchema: NEWS_WIDGET_SCHEMA,
      _meta: metadata(newsToolMetadata(input.environment)._meta, schemes),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async (arguments_) => {
      try {
        const parsed = newsWidgetInputSchema.parse(arguments_);
        const list = await k12.news.execute({
          action_id: "cai.news.01.list",
          input: {
            club_id: clubId,
            operation: "private",
            limit: parsed.limit,
            offset: parsed.offset,
          },
          context: input.context,
          capability_snapshot: input.capability_snapshot,
        });
        const listRecord = z.object({
          items: z.array(z.object({ news_id: uuid }).passthrough()).max(100),
        }).passthrough().parse(list.result);
        if (
          parsed.selected_news_id
          && !listRecord.items.some((article) =>
            article.news_id === parsed.selected_news_id)
        ) {
          throw createConnectorError({
            code: "NOT_FOUND",
            message: "Der Beitrag ist in der aktuellen News-Seite nicht verfügbar.",
            request_id: input.context.request_id,
            retryable: false,
          });
        }
        const detail = parsed.selected_news_id
          && visibleNewsActions.has("cai.news.02.show")
          ? await k12.news.execute({
              action_id: "cai.news.02.show",
              input: {
                club_id: clubId,
                operation: "private",
                news_id: parsed.selected_news_id,
              },
              context: input.context,
              capability_snapshot: input.capability_snapshot,
            })
          : null;
        const actions = visibleNewsActions.has("cai.news.02.show")
          ? listRecord.items.map((article) => actionDescriptor({
              action_id: `news.details.${article.news_id}`,
              label: "Beitrag anzeigen",
              tool_name: NEWS_WIDGET_TOOL_NAME,
              arguments: {
                selected_news_id: article.news_id,
                filter: parsed.filter,
                limit: parsed.limit,
                offset: parsed.offset,
              },
            }))
          : [];
        const model = new NewsWidgetProjector(
          new NewsWidgetCapabilityPolicy([NEWS_WIDGET_TOOL_NAME]),
        ).private({
          club: {
            club_id: clubId,
            name: "Ausgewählter Verein",
            timezone: input.context.timezone,
          },
          context: input.context,
          capability_snapshot: input.capability_snapshot,
          list_source: list.result,
          filter: parsed.filter,
          selected_news_id: parsed.selected_news_id ?? null,
          detail_source: detail?.result ?? null,
          action_candidates: actions,
        });
        return widgetResult(
          input.context,
          model,
          `${model.data.articles.length} freigegebene News werden angezeigt.`,
          newsToolMetadata(input.environment)._meta,
        );
      } catch (error) {
        return widgetError(input.context, error);
      }
    });
    visibleTools.push(structuredClone(NEWS_WIDGET_SUMMARY));
  }

  const k7 = createK7ToolSets({ client: input.client });
  const visibleMemberActions = new Set(k7.member.listVisible({
    context: input.context,
    capability_snapshot: input.capability_snapshot,
    provider_tool_updates: "dynamic",
  }).map((definition) => definition.action_id));

  if (visibleMemberActions.has("cai.member.01.list")) {
    const schemes = oauthSecuritySchemes(["member.read.basic"]);
    input.advertised_security_schemes.set(
      MEMBER_MANAGEMENT_WIDGET_TOOL_NAME,
      schemes,
    );
    registerAppTool(input.server, MEMBER_MANAGEMENT_WIDGET_TOOL_NAME, {
      title: MEMBER_WIDGET_SUMMARY.title,
      description: MEMBER_WIDGET_SUMMARY.description,
      inputSchema: memberWidgetInputSchema,
      outputSchema: MEMBER_MANAGEMENT_WIDGET_SCHEMA,
      _meta: metadata(
        memberManagementToolMetadata(input.environment)._meta,
        schemes,
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async (arguments_) => {
      try {
        const parsed = memberWidgetInputSchema.parse(arguments_);
        const pageResult = await k7.member.execute({
          action_id: "cai.member.01.list",
          input: {
            club_id: clubId,
            limit: parsed.limit,
            offset: parsed.offset,
          },
          context: input.context,
          capability_snapshot: input.capability_snapshot,
        });
        const page = filterMembers(
          memberListPageSchema.parse(pageResult.result),
          parsed.query,
        );
        let detailRequest: {
          member_id: string;
          source: JsonValue;
          masked_fields: string[];
        } | null = null;
        if (parsed.member_id) {
          if (!page.items.some((item) => item.member_id === parsed.member_id)) {
            throw createConnectorError({
              code: "NOT_FOUND",
              message: "Das Mitglied ist in der aktuellen Ansicht nicht verfügbar.",
              request_id: input.context.request_id,
              retryable: false,
            });
          }
          if (!visibleMemberActions.has("cai.member.02.show")) {
            throw createConnectorError({
              code: "SCOPE_REQUIRED",
              message: "Für Mitgliederdetails fehlt die aktuelle Berechtigung.",
              request_id: input.context.request_id,
              retryable: false,
              required_scope: "member.read.details",
            });
          }
          const detail = await k7.member.execute({
            action_id: "cai.member.02.show",
            input: { club_id: clubId, member_id: parsed.member_id },
            context: input.context,
            capability_snapshot: input.capability_snapshot,
          });
          detailRequest = {
            member_id: parsed.member_id,
            source: detail.result,
            masked_fields: [],
          };
        }
        const actions = visibleMemberActions.has("cai.member.02.show")
          ? page.items.map((member) => actionDescriptor({
              action_id: `member.details.${member.member_id}`,
              label: "Details anzeigen",
              tool_name: MEMBER_MANAGEMENT_WIDGET_TOOL_NAME,
              arguments: {
                member_id: member.member_id,
                limit: parsed.limit,
                offset: parsed.offset,
                ...(parsed.query ? { query: parsed.query } : {}),
              },
            }))
          : [];
        const model = new MemberManagementWidgetProjector(
          new MemberWidgetCapabilityPolicy([
            MEMBER_MANAGEMENT_WIDGET_TOOL_NAME,
          ]),
        ).project({
          club: {
            club_id: clubId,
            name: "Ausgewählter Verein",
            timezone: input.context.timezone,
          },
          context: input.context,
          capability_snapshot: input.capability_snapshot,
          list_source: z.json().parse(page),
          query: parsed.query ?? null,
          detail_request: detailRequest,
          action_candidates: actions,
        });
        return widgetResult(
          input.context,
          model,
          `${page.items.length} freigegebene Mitglieder werden angezeigt.`,
          memberManagementToolMetadata(input.environment)._meta,
        );
      } catch (error) {
        return widgetError(input.context, error);
      }
    });
    visibleTools.push(structuredClone(MEMBER_WIDGET_SUMMARY));
  }

  const k10 = createK10ToolSets({ client: input.client });
  const visibleObjectActions = new Set(k10.object.listVisible({
    context: input.context,
    capability_snapshot: input.capability_snapshot,
    provider_tool_updates: "dynamic",
  }).map((definition) => definition.action_id));
  if (
    visibleObjectActions.has("cai.object.01.list")
    && input.context.scopes.includes("booking.read")
  ) {
    const schemes = oauthSecuritySchemes(["booking.read", "object.read"]);
    input.advertised_security_schemes.set(
      BOOKING_OBJECT_WIDGET_TOOL_NAME,
      schemes,
    );
    registerAppTool(input.server, BOOKING_OBJECT_WIDGET_TOOL_NAME, {
      title: BOOKING_WIDGET_SUMMARY.title,
      description: BOOKING_WIDGET_SUMMARY.description,
      inputSchema: bookingWidgetInputSchema,
      outputSchema: BOOKING_OBJECT_WIDGET_SCHEMA,
      _meta: metadata(
        bookingObjectToolMetadata(input.environment)._meta,
        schemes,
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async (arguments_) => {
      try {
        const parsed = bookingWidgetInputSchema.parse(arguments_);
        const selectedObjectId =
          parsed.selected_object_id ?? parsed.object_id ?? null;
        const objectResult = await k10.object.execute({
          action_id: "cai.object.01.list",
          input: {
            club_id: clubId,
            ...(parsed.object_type ? { type: parsed.object_type } : {}),
            limit: 100,
            offset: 0,
          },
          context: input.context,
          capability_snapshot: input.capability_snapshot,
        });
        const objects = objectItems(objectResult.result);
        if (
          selectedObjectId
          && !objects.some((object) => objectId(object) === selectedObjectId)
        ) {
          throw createConnectorError({
            code: "NOT_FOUND",
            message: "Das Objekt ist in der aktuellen Ansicht nicht verfügbar.",
            request_id: input.context.request_id,
            retryable: false,
          });
        }
        const availability = selectedObjectId
          ? await new AvailabilityContract(input.client).check({
              club_id: clubId,
              object_id: selectedObjectId,
              from: parsed.from,
              to: parsed.to,
              timezone: parsed.timezone,
            }, input.context)
          : null;
        const actions = objects.flatMap((object) => {
          const visibleObjectId = objectId(object);
          return visibleObjectId
            ? [actionDescriptor({
                action_id: `booking.object.select.${visibleObjectId}`,
                label: "Verfügbarkeit anzeigen",
                tool_name: BOOKING_OBJECT_WIDGET_TOOL_NAME,
                arguments: {
                  object_id: visibleObjectId,
                  from: parsed.from,
                  to: parsed.to,
                  timezone: parsed.timezone,
                  ...(parsed.object_type
                    ? { object_type: parsed.object_type }
                    : {}),
                },
              })]
            : [];
        });
        const model = new BookingObjectWidgetProjector(
          new BookingWidgetCapabilityPolicy([
            BOOKING_OBJECT_WIDGET_TOOL_NAME,
          ]),
        ).project({
          club: {
            club_id: clubId,
            name: "Ausgewählter Verein",
            timezone: input.context.timezone,
          },
          context: input.context,
          capability_snapshot: input.capability_snapshot,
          object_source: objectResult.result,
          selected_object_id: selectedObjectId,
          availability_source: availability,
          range: { from: parsed.from, to: parsed.to },
          action_candidates: actions,
        });
        return widgetResult(
          input.context,
          model,
          selectedObjectId
            ? "Die aktuelle Verfügbarkeit des ausgewählten Objekts wird angezeigt."
            : `${objects.length} freigegebene Buchungsobjekte werden angezeigt.`,
          bookingObjectToolMetadata(input.environment)._meta,
        );
      } catch (error) {
        return widgetError(input.context, error);
      }
    });
    visibleTools.push(structuredClone(BOOKING_WIDGET_SUMMARY));
  }

  return {
    tools: visibleTools.sort((left, right) => left.name.localeCompare(right.name)),
  };
}
