export type UUID = string;
export type IanaTimeZone = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ClientSurface = "cli" | "mcp";
export type ProviderId = "openai" | "anthropic";
export type McpClientKind = "chatgpt" | "codex" | "claude" | "unknown";

export const OAUTH_SCOPE_VALUES = [
  "public.read",
  "club.read",
  "club.write",
  "member.read.basic",
  "member.read.details",
  "member.write",
  "team.read",
  "team.write",
  "role.read.self",
  "role.write",
  "event.read",
  "event.write",
  "booking.read",
  "object.read",
  "content.write",
  "content.read",
  "booking.write",
  "object.write",
  "task.read",
  "task.write",
  "supply.read",
  "supply.write",
  "meeting.read",
  "meeting.write",
  "sponsor.read",
  "sponsor.write",
  "admin.write",
  "files.read",
  "files.write",
  "files.export",
  "files.import",
  "connector.grants",
] as const;

export type OAuthScope = (typeof OAUTH_SCOPE_VALUES)[number];

export interface RequestContext {
  request_id: UUID;
  surface: ClientSurface;
  provider: ProviderId | null;
  subject_id: UUID | null;
  oauth_grant_id: UUID | null;
  club_id: UUID | null;
  department_id: UUID | null;
  scopes: OAuthScope[];
  capability_version: string | null;
  locale: "de-DE";
  timezone: IanaTimeZone;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ProviderNeutralResult<T extends JsonValue> {
  content: TextContent[];
  structuredContent: T;
  _meta: {
    request_id: UUID;
    capability_version?: string;
    widget_resource_uri?: string;
  };
  isError?: boolean;
}

export type ConnectorErrorCode =
  | "CONFIG_INVALID"
  | "AUTH_REQUIRED"
  | "AUTH_TEMPORARILY_UNAVAILABLE"
  | "SCOPE_REQUIRED"
  | "CLUB_SELECTION_REQUIRED"
  | "PERMISSION_DENIED"
  | "TENANT_MISMATCH"
  | "VALIDATION_FAILED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_MISMATCH"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "NOT_FOUND";

export interface ConnectorError {
  code: ConnectorErrorCode;
  message: string;
  request_id: UUID;
  retryable: boolean;
  retry_after_seconds?: number;
  required_scope?: OAuthScope;
}

const INVALID_REQUEST_ID = "00000000-0000-0000-0000-000000000000";
const CONNECTOR_ERRORS = new WeakSet<Error>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CLIENT_SURFACES = new Set<ClientSurface>(["cli", "mcp"]);
const PROVIDERS = new Set<ProviderId>(["openai", "anthropic"]);
const OAUTH_SCOPES = new Set<OAuthScope>(OAUTH_SCOPE_VALUES);

function invalidContext(requestId: string, message: string): Error & ConnectorError {
  return createConnectorError({
    code: "CONFIG_INVALID",
    message,
    request_id: requestId,
    retryable: false,
  });
}

function normalizeNullableUuid(
  value: string | null,
  field: string,
  requestId: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw invalidContext(requestId, `${field} ist ungültig.`);
  }
  return value.trim();
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function createConnectorError(input: ConnectorError): Error & ConnectorError {
  const error = new Error(input.message) as Error & ConnectorError;
  error.name = "ConnectorError";
  error.code = input.code;
  error.request_id = input.request_id;
  error.retryable = input.retryable;
  if (input.retry_after_seconds !== undefined) {
    error.retry_after_seconds = input.retry_after_seconds;
  }
  if (input.required_scope !== undefined) {
    error.required_scope = input.required_scope;
  }
  CONNECTOR_ERRORS.add(error);
  return error;
}

export function isConnectorError(value: unknown): value is Error & ConnectorError {
  return value instanceof Error && CONNECTOR_ERRORS.has(value);
}

export function normalizeRequestContext(context: RequestContext): RequestContext {
  const requestId = typeof context.request_id === "string" ? context.request_id.trim() : "";
  if (!UUID_PATTERN.test(requestId)) {
    throw invalidContext(INVALID_REQUEST_ID, "Die Request-ID ist ungültig.");
  }
  if (!CLIENT_SURFACES.has(context.surface)) {
    throw invalidContext(requestId, "Die Client-Oberfläche ist ungültig.");
  }
  if (context.provider !== null && !PROVIDERS.has(context.provider)) {
    throw invalidContext(requestId, "Der KI-Provider ist ungültig.");
  }
  if (context.locale !== "de-DE") {
    throw invalidContext(requestId, "Die Locale ist ungültig.");
  }
  if (typeof context.timezone !== "string" || !isIanaTimeZone(context.timezone.trim())) {
    throw invalidContext(requestId, "Die Zeitzone ist ungültig.");
  }
  if (!Array.isArray(context.scopes) || !context.scopes.every((scope) => OAUTH_SCOPES.has(scope))) {
    throw invalidContext(requestId, "Der OAuth-Scope-Kontext ist ungültig.");
  }
  if (context.surface === "cli" && context.provider !== null) {
    throw invalidContext(requestId, "Ein CLI-Kontext darf keinen KI-Provider setzen.");
  }
  if (context.surface === "cli" && context.oauth_grant_id !== null) {
    throw invalidContext(requestId, "Ein CLI-Kontext darf keinen OAuth-Grant setzen.");
  }
  if (context.surface === "mcp" && context.oauth_grant_id !== null && context.provider === null) {
    throw invalidContext(requestId, "Ein authentifizierter MCP-Kontext benötigt den geprüften KI-Provider.");
  }
  if (context.capability_version !== null
    && (typeof context.capability_version !== "string" || !context.capability_version.trim())) {
    throw invalidContext(requestId, "Die Capability-Version ist ungültig.");
  }

  return {
    ...context,
    request_id: requestId,
    subject_id: normalizeNullableUuid(context.subject_id, "Die Subject-ID", requestId),
    oauth_grant_id: normalizeNullableUuid(context.oauth_grant_id, "Die OAuth-Grant-ID", requestId),
    club_id: normalizeNullableUuid(context.club_id, "Die Club-ID", requestId),
    department_id: normalizeNullableUuid(context.department_id, "Die Abteilungs-ID", requestId),
    scopes: [...new Set(context.scopes)].sort(),
    capability_version: context.capability_version?.trim() ?? null,
    timezone: context.timezone.trim(),
  };
}

export function createProviderNeutralResult<T extends JsonValue>(
  context: RequestContext,
  structuredContent: T,
  content: TextContent[] = [],
): ProviderNeutralResult<T> {
  const normalized = normalizeRequestContext(context);
  return {
    content,
    structuredContent,
    _meta: {
      request_id: normalized.request_id,
      ...(normalized.capability_version
        ? { capability_version: normalized.capability_version }
        : {}),
    },
  };
}

export * from "./safety/index.ts";
export * from "./jobs/index.ts";
export * from "./uploads/index.ts";
export * from "./widgets/index.ts";
