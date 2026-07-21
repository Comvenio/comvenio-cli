import {
  oauthEndpoints,
  validateIntrospectionResult,
  type OAuthEnvironment,
} from "@comvenio/auth";
import {
  OAUTH_SCOPE_VALUES,
  type OAuthScope,
} from "@comvenio/connector-contracts";

import { runtimeError } from "./errors.ts";
import type {
  AuthenticatedConnectorPrincipal,
  IntrospectionPort,
  ProviderRegistrationResolver,
  RequestRisk,
} from "./types.ts";

const KNOWN_SCOPES = new Set<string>(OAUTH_SCOPE_VALUES);

export function extractBearerToken(
  authorization: string | undefined,
  requestId: string,
): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer ([^\s]+)$/u.exec(authorization);
  if (!match?.[1] || match[1].startsWith("cvn_") || match[1].length > 8_192) {
    throw runtimeError({
      code: "AUTH_REQUIRED",
      message: "Der Bearer-Token ist ungültig.",
      request_id: requestId,
      retryable: false,
    });
  }
  return match[1];
}

export class IntrospectionBearerAuthenticator {
  readonly #introspection: IntrospectionPort;
  readonly #registrations: ProviderRegistrationResolver;
  readonly #now: () => Date;

  constructor(input: {
    introspection: IntrospectionPort;
    registrations: ProviderRegistrationResolver;
    now?: () => Date;
  }) {
    this.#introspection = input.introspection;
    this.#registrations = input.registrations;
    this.#now = input.now ?? (() => new Date());
  }

  async authenticate(input: {
    raw_token: string;
    request_id: string;
    environment: OAuthEnvironment;
    risk: RequestRisk;
  }): Promise<AuthenticatedConnectorPrincipal> {
    const expectedAudience = oauthEndpoints(input.environment).resource as
      | "https://mcp.comvenio.app"
      | "https://mcpdev.comvenio.app";
    let rawResult: unknown;
    try {
      rawResult = await this.#introspection.introspect({
        raw_token: input.raw_token,
        request_id: input.request_id,
        audience: expectedAudience,
        force_fresh: input.risk === "write",
      });
    } catch {
      throw runtimeError({
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
        message: "Die Anmeldung kann derzeit nicht geprüft werden.",
        request_id: input.request_id,
        retryable: true,
      });
    }
    let introspection;
    try {
      introspection = validateIntrospectionResult(rawResult);
    } catch {
      throw runtimeError({
        code: "AUTH_REQUIRED",
        message: "Der Bearer-Token ist ungültig oder abgelaufen.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
    if (!introspection.active || introspection.aud !== expectedAudience
      || introspection.exp <= nowSeconds || introspection.iat > nowSeconds + 60) {
      throw runtimeError({
        code: "AUTH_REQUIRED",
        message: "Der Bearer-Token ist ungültig oder abgelaufen.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    const registration = await this.#registrations.resolve(introspection.client_id);
    if (!registration?.enabled || registration.client_id !== introspection.client_id) {
      throw runtimeError({
        code: "AUTH_REQUIRED",
        message: "Der OAuth-Client ist nicht freigegeben.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    const scopes = introspection.scope.split(" ") as OAuthScope[];
    if (!scopes.every((scope) => KNOWN_SCOPES.has(scope)
      && registration.allowed_scopes.includes(scope))) {
      throw runtimeError({
        code: "AUTH_REQUIRED",
        message: "Der Bearer-Token enthält ungültige Berechtigungen.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    return {
      subject_id: introspection.sub,
      oauth_grant_id: introspection.grant_id,
      client_id: introspection.client_id,
      provider: registration.provider,
      club_id: introspection.club_id,
      scopes: [...scopes].sort(),
      expires_at_epoch_seconds: introspection.exp,
    };
  }
}
