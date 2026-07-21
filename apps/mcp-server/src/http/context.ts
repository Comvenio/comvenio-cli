import { randomUUID } from "node:crypto";

import {
  normalizeRequestContext,
  type ProviderId,
  type RequestContext,
  type UUID,
} from "@comvenio/connector-contracts";

import { extractBearerToken } from "./auth.ts";
import { runtimeError } from "./errors.ts";
import type {
  BearerAuthenticator,
  CapabilityContextResolver,
  McpRuntimeOptions,
  ProviderResolver,
  RequestRisk,
  StatelessTransportContext,
} from "./types.ts";

type JsonObject = Record<string, unknown>;

interface RequestedTenantContext {
  club_id: string | null;
  department_id: string | null;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function messages(body: unknown): JsonObject[] {
  const values = Array.isArray(body) ? body : [body];
  return values.map(object).filter((value): value is JsonObject => value !== null);
}

function requestRisk(body: unknown): RequestRisk {
  return messages(body).some((message) => message.method === "tools/call") ? "write" : "read";
}

function singleRequestedValue(values: Array<string | null>, field: string, requestId: UUID): string | null {
  const present = [...new Set(values.filter((value): value is string => value !== null))];
  if (present.length > 1) {
    throw runtimeError({
      code: "TENANT_MISMATCH",
      message: `${field} ist innerhalb der Anfrage widersprüchlich.`,
      request_id: requestId,
      retryable: false,
    });
  }
  return present[0] ?? null;
}

function requestedTenant(body: unknown, requestId: UUID): RequestedTenantContext {
  const argumentsList = messages(body)
    .filter((message) => message.method === "tools/call")
    .map((message) => object(object(message.params)?.arguments))
    .filter((value): value is JsonObject => value !== null);
  const value = (arguments_: JsonObject, key: string): string | null => {
    const candidate = arguments_[key];
    if (candidate === undefined || candidate === null) return null;
    if (typeof candidate !== "string") {
      throw runtimeError({
        code: "VALIDATION_FAILED",
        message: `${key} ist ungültig.`,
        request_id: requestId,
        retryable: false,
      });
    }
    return candidate;
  };
  return {
    club_id: singleRequestedValue(argumentsList.map((item) => value(item, "club_id")), "club_id", requestId),
    department_id: singleRequestedValue(
      argumentsList.map((item) => value(item, "department_id")),
      "department_id",
      requestId,
    ),
  };
}

function protocolVersion(value: string | undefined, requestId: UUID): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw runtimeError({
      code: "VALIDATION_FAILED",
      message: "Die MCP-Protokollversion ist ungültig.",
      request_id: requestId,
      retryable: false,
    });
  }
  return normalized;
}

export class ExactProviderHintResolver implements ProviderResolver {
  resolve(input: { provider_hint: string | null }): ProviderId | null {
    return input.provider_hint === "openai" || input.provider_hint === "anthropic"
      ? input.provider_hint
      : null;
  }
}

export class StatelessTransportContextFactory {
  readonly #environment: McpRuntimeOptions["environment"];
  readonly #authenticator: BearerAuthenticator;
  readonly #providerResolver: ProviderResolver;
  readonly #capabilityResolver: CapabilityContextResolver;
  readonly #now: () => Date;
  readonly #requestId: () => UUID;

  constructor(input: Pick<McpRuntimeOptions,
    "environment" | "authenticator" | "provider_resolver" | "capability_resolver" | "now" | "request_id"
  >) {
    this.#environment = input.environment;
    this.#authenticator = input.authenticator;
    this.#providerResolver = input.provider_resolver;
    this.#capabilityResolver = input.capability_resolver;
    this.#now = input.now ?? (() => new Date());
    this.#requestId = input.request_id ?? (() => randomUUID());
  }

  async create(input: {
    authorization?: string;
    host?: string;
    origin?: string;
    user_agent?: string;
    provider_hint?: string;
    protocol_version?: string;
    body: unknown;
  }): Promise<StatelessTransportContext> {
    const requestId = this.#requestId();
    const receivedAt = this.#now();
    const risk = requestRisk(input.body);
    const tenant = requestedTenant(input.body, requestId);
    const rawToken = extractBearerToken(input.authorization, requestId);
    const principal = rawToken === null ? null : await this.#authenticator.authenticate({
      raw_token: rawToken,
      request_id: requestId,
      environment: this.#environment,
      risk,
    });
    const detectedProvider = await this.#providerResolver.resolve({
      host: input.host ?? null,
      origin: input.origin ?? null,
      user_agent: input.user_agent ?? null,
      provider_hint: input.provider_hint ?? null,
    });
    if (principal && detectedProvider && principal.provider !== detectedProvider) {
      throw runtimeError({
        code: "TENANT_MISMATCH",
        message: "Der OAuth-Client passt nicht zum aufrufenden KI-Provider.",
        request_id: requestId,
        retryable: false,
      });
    }
    const provider = principal?.provider ?? detectedProvider;
    if (!provider) {
      throw runtimeError({
        code: "CONFIG_INVALID",
        message: "Der aufrufende KI-Provider konnte nicht bestimmt werden.",
        request_id: requestId,
        retryable: false,
      });
    }
    if (principal?.club_id && tenant.club_id && principal.club_id !== tenant.club_id) {
      throw runtimeError({
        code: "TENANT_MISMATCH",
        message: "Der angeforderte Verein stimmt nicht mit dem OAuth-Grant überein.",
        request_id: requestId,
        retryable: false,
      });
    }
    const clubId = principal?.club_id ?? tenant.club_id;
    if (tenant.department_id !== null && clubId === null) {
      throw runtimeError({
        code: "VALIDATION_FAILED",
        message: "Eine Abteilung benötigt einen expliziten Verein.",
        request_id: requestId,
        retryable: false,
      });
    }
    let request = normalizeRequestContext({
      request_id: requestId,
      surface: "mcp",
      provider,
      subject_id: principal?.subject_id ?? null,
      oauth_grant_id: principal?.oauth_grant_id ?? null,
      club_id: clubId,
      department_id: tenant.department_id,
      scopes: principal?.scopes ?? ["public.read"],
      capability_version: null,
      locale: "de-DE",
      timezone: "Europe/Berlin",
    });
    const requiresCapability = request.subject_id !== null && request.club_id !== null
      && request.scopes.some((scope) => scope !== "public.read");
    const capabilitySnapshot = requiresCapability
      ? await this.#capabilityResolver.resolve({ context: request, force_recheck: risk === "write" })
      : null;
    if (capabilitySnapshot) {
      if (capabilitySnapshot.subject_id !== request.subject_id
        || capabilitySnapshot.club_id !== request.club_id) {
        throw runtimeError({
          code: "TENANT_MISMATCH",
          message: "Der Rechtekontext gehört zu einem anderen Verein oder Benutzer.",
          request_id: requestId,
          retryable: false,
        });
      }
      request = normalizeRequestContext({
        ...request,
        capability_version: capabilitySnapshot.capability_version,
      });
    }
    return {
      provider_request: {
        request_id: requestId,
        provider,
        authenticated: principal !== null,
        protocol_version: protocolVersion(input.protocol_version, requestId),
        received_at: receivedAt.toISOString(),
      },
      request,
      capability_snapshot: capabilitySnapshot,
      risk,
    };
  }
}

export function assertStatelessContext(value: StatelessTransportContext): StatelessTransportContext {
  const normalized = normalizeRequestContext(value.request);
  if (value.provider_request.request_id !== normalized.request_id
    || value.provider_request.provider !== normalized.provider
    || value.provider_request.authenticated !== (normalized.subject_id !== null)
    || (value.capability_snapshot !== null
      && value.capability_snapshot.capability_version !== normalized.capability_version)) {
    throw runtimeError({
      code: "CONFIG_INVALID",
      message: "Der zustandslose Transportkontext ist inkonsistent.",
      request_id: normalized.request_id,
      retryable: false,
    });
  }
  return {
    ...value,
    provider_request: { ...value.provider_request },
    request: normalized,
    capability_snapshot: value.capability_snapshot ? structuredClone(value.capability_snapshot) : null,
  };
}
