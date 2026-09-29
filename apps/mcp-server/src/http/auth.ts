import {
  validateIntrospectionResult,
  type HttpsUrl,
  type OAuthEnvironment,
} from "@comvenio/auth";
import {
  OAUTH_SCOPE_VALUES,
  isMachineGrantScope,
  type OAuthScope,
} from "@comvenio/connector-contracts";

import { runtimeError } from "./errors.ts";
import type {
  AuthenticatedConnectorPrincipal,
  ActorTokenPort,
  IntrospectionPort,
  ProviderRegistrationResolver,
  RequestRisk,
} from "./types.ts";

const KNOWN_SCOPES = new Set<string>(OAUTH_SCOPE_VALUES);

// Client id of a machine grant (03-maschinen-grant §4.4, DC-5).
const MACHINE_CLIENT_ID = /^cvg_client_[A-Za-z0-9_-]{1,128}$/u;
// The shared introspection validator pins provider and CLI clients to HTTPS
// ids. A machine client id is checked here; the rest of the answer goes
// through the same validator with this stand-in, so no field is checked less.
const MACHINE_CLIENT_STAND_IN = "https://machine-grant.invalid/";

/**
 * Separates the machine marker from an introspection answer.
 *
 * An active introspection of a machine token carries the usual fields plus
 * `client_kind: "machine"`, with the grant's `cvg_client_…` id as
 * `client_id`. Every other answer passes through unchanged.
 */
export function splitMachineIntrospection(raw: unknown): {
  result: unknown;
  machine_client_id: `cvg_client_${string}` | null;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)
    || !Object.hasOwn(raw, "client_kind")) {
    return { result: raw, machine_client_id: null };
  }
  const { client_kind: clientKind, client_id: clientId, ...rest } = raw as Record<string, unknown>;
  if (clientKind !== "machine" || typeof clientId !== "string" || !MACHINE_CLIENT_ID.test(clientId)) {
    throw new Error("Die Introspection-Antwort ist ungültig.");
  }
  return {
    result: { ...rest, client_id: MACHINE_CLIENT_STAND_IN },
    machine_client_id: clientId as `cvg_client_${string}`,
  };
}

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
  readonly #actorTokens: ActorTokenPort;
  readonly #audience: HttpsUrl;
  readonly #acceptMachineClients: boolean;
  readonly #now: () => Date;

  constructor(input: {
    introspection: IntrospectionPort;
    registrations: ProviderRegistrationResolver;
    actor_tokens: ActorTokenPort;
    audience: HttpsUrl;
    /**
     * Machine grants sign in only on the CLI channel (03-maschinen-grant
     * §4.4); the provider connector keeps rejecting them.
     */
    accept_machine_clients?: boolean;
    now?: () => Date;
  }) {
    this.#introspection = input.introspection;
    this.#registrations = input.registrations;
    this.#actorTokens = input.actor_tokens;
    this.#audience = input.audience;
    this.#acceptMachineClients = input.accept_machine_clients ?? false;
    this.#now = input.now ?? (() => new Date());
  }

  async authenticate(input: {
    raw_token: string;
    request_id: string;
    environment: OAuthEnvironment;
    risk: RequestRisk;
  }): Promise<AuthenticatedConnectorPrincipal> {
    const expectedAudience = this.#audience;
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
    let machineClientId: `cvg_client_${string}` | null = null;
    try {
      const split = splitMachineIntrospection(rawResult);
      machineClientId = split.machine_client_id;
      introspection = validateIntrospectionResult(split.result);
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
    const scopes = introspection.scope.split(" ") as OAuthScope[];
    let provider: AuthenticatedConnectorPrincipal["provider"];
    let scopesAllowed: boolean;
    if (machineClientId !== null) {
      // A machine grant has no provider registration: it is issued per club
      // in the web app. It is accepted on the CLI channel only, always bound
      // to a club and never with a blocked scope (D-GTA-07). Rights inside
      // the club are still checked by the services against the person who
      // created the grant (D-GTA-14, backend actor from the exchange below).
      if (!this.#acceptMachineClients || introspection.club_id === null) {
        throw runtimeError({
          code: "AUTH_REQUIRED",
          message: "Der OAuth-Client ist nicht freigegeben.",
          request_id: input.request_id,
          retryable: false,
        });
      }
      provider = null;
      scopesAllowed = scopes.every((scope) => isMachineGrantScope(scope));
    } else {
      const registration = await this.#registrations.resolve(introspection.client_id);
      if (!registration?.enabled || registration.client_id !== introspection.client_id) {
        throw runtimeError({
          code: "AUTH_REQUIRED",
          message: "Der OAuth-Client ist nicht freigegeben.",
          request_id: input.request_id,
          retryable: false,
        });
      }
      provider = registration.provider;
      scopesAllowed = scopes.every((scope) => KNOWN_SCOPES.has(scope)
        && registration.allowed_scopes.includes(scope));
    }
    if (!scopesAllowed) {
      throw runtimeError({
        code: "AUTH_REQUIRED",
        message: "Der Bearer-Token enthält ungültige Berechtigungen.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    let actorResponse: unknown;
    try {
      actorResponse = await this.#actorTokens.exchange({
        raw_token: input.raw_token,
        request_id: input.request_id,
        audience: expectedAudience,
      });
    } catch {
      throw runtimeError({
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
        message: "Der Zugriffskontext kann derzeit nicht erstellt werden.",
        request_id: input.request_id,
        retryable: true,
      });
    }
    const actor = actorResponse !== null && typeof actorResponse === "object" && !Array.isArray(actorResponse)
      ? actorResponse as Record<string, unknown>
      : null;
    if (!actor || Object.keys(actor).sort().join(",") !== "access_token,expires_in,token_type"
      || typeof actor.access_token !== "string" || actor.access_token.length < 16
      || /[\r\n]/u.test(actor.access_token) || actor.token_type !== "Bearer" || actor.expires_in !== 300) {
      throw runtimeError({
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
        message: "Der Zugriffskontext kann derzeit nicht erstellt werden.",
        request_id: input.request_id,
        retryable: true,
      });
    }
    return {
      subject_id: introspection.sub,
      oauth_grant_id: introspection.grant_id,
      client_id: machineClientId ?? introspection.client_id,
      provider,
      club_id: introspection.club_id,
      scopes: [...scopes].sort(),
      expires_at_epoch_seconds: introspection.exp,
      backend_actor_token: actor.access_token,
    };
  }
}
