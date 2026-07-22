import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server as NodeHttpServer } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
  Express,
  NextFunction,
  Request,
  Response,
} from "express";
import {
  createBearerChallenge,
  createProtectedResourceMetadata,
} from "@comvenio/auth";
import type { ProviderId, UUID } from "@comvenio/connector-contracts";

import { StatelessTransportContextFactory } from "./context.ts";
import { jsonRpcErrorBody, runtimeError, toHttpError } from "./errors.ts";
import { HealthReadinessProbe } from "./health.ts";
import { createSafeTelemetryRecord } from "./telemetry.ts";
import type {
  McpRuntimeOptions,
  SafeTelemetryRecord,
  StatelessTransportContext,
} from "./types.ts";
import { createAuthChallenge } from "../public/auth-challenge.ts";
import type { AuthChallenge } from "../public/types.ts";
import { mountBookingObjectWidgetAssets } from "../widgets/booking-object/assets.ts";
import { mountConfirmationWidgetAssets } from "../widgets/confirmation/assets.ts";
import { mountEventCalendarWidgetAssets } from "../widgets/event-calendar/assets.ts";
import { mountMemberManagementWidgetAssets } from "../widgets/member-management/assets.ts";
import { mountNewsWidgetAssets } from "../widgets/news/assets.ts";

const MCP_ROUTE = "/mcp" as const;
const HEALTH_ROUTE = "/health" as const;
const READY_ROUTE = "/ready" as const;
const PROTECTED_RESOURCE_ROUTE = "/.well-known/oauth-protected-resource" as const;
const OPENAI_APPS_CHALLENGE_ROUTE = "/.well-known/openai-apps-challenge" as const;
const RESOURCE_DOCUMENTATION = "https://www.comvenio.app/datenschutz" as const;
const MCP_EDGE_HEADER = "x-comvenio-edge-secret" as const;

function validEdgeSecret(secret: string): boolean {
  return secret.length >= 32
    && secret.length <= 512
    && secret === secret.trim()
    && !/[\u0000-\u001f\u007f]/u.test(secret);
}

function edgeSecretMatches(expected: string | null, received: string | undefined): boolean {
  if (expected === null) return true;
  if (received === undefined) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");
  return expectedBytes.length === receivedBytes.length
    && timingSafeEqual(expectedBytes, receivedBytes);
}

function validateRuntimeOptions(options: McpRuntimeOptions): void {
  if ((options.environment === "production" && options.edge_shared_secret === null)
    || (options.edge_shared_secret !== null && !validEdgeSecret(options.edge_shared_secret))) {
    throw new Error("Das MCP-Edge-Secret ist ungültig.");
  }
  if (options.allowed_hosts.length === 0
    || options.allowed_hosts.some((host) => !host || /[\s/:]/u.test(host))) {
    throw new Error("Mindestens ein gültiger Host muss freigegeben sein.");
  }
  for (const origin of options.allowed_origins) {
    const url = new URL(origin);
    const localDevelopment = options.environment === "development"
      && url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.origin !== origin || (url.protocol !== "https:" && !localDevelopment)) {
      throw new Error("Die Origin-Allowlist enthält einen ungültigen Eintrag.");
    }
  }
  for (const dependencyName of ["catalog", "auth"] as const) {
    if (!options.readiness_dependencies.some((dependency) =>
      dependency.name === dependencyName && dependency.required)) {
      throw new Error(`Die erforderliche Readiness-Abhängigkeit ${dependencyName} fehlt.`);
    }
  }
}

function methodForTelemetry(value: string): SafeTelemetryRecord["method"] {
  return value === "DELETE" ? "DELETE" : value === "POST" ? "POST" : "GET";
}

export class McpHttpServer {
  readonly app: Express;
  readonly #options: McpRuntimeOptions;
  readonly #contextFactory: StatelessTransportContextFactory;
  readonly #probe: HealthReadinessProbe;
  readonly #allowedOrigins: ReadonlySet<string>;
  #httpServer: NodeHttpServer | null = null;
  #draining = false;
  #inflight = 0;
  #drainWaiters = new Set<() => void>();

  constructor(options: McpRuntimeOptions) {
    validateRuntimeOptions(options);
    this.#options = options;
    this.#allowedOrigins = new Set(options.allowed_origins);
    this.#contextFactory = new StatelessTransportContextFactory(options);
    this.#probe = new HealthReadinessProbe(options.readiness_dependencies);
    this.app = createMcpExpressApp({
      host: "0.0.0.0",
      allowedHosts: [...options.allowed_hosts],
    });
    this.app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.path === HEALTH_ROUTE
        || edgeSecretMatches(options.edge_shared_secret, request.get(MCP_EDGE_HEADER))) {
        next();
        return;
      }
      response.setHeader("cache-control", "no-store");
      response.status(403).json({ error: "Forbidden" });
    });
    // Future widget bundles remain immutable test assets, but only resources
    // registered by the runtime catalog are advertised to providers.
    mountBookingObjectWidgetAssets(this.app, options.environment);
    mountConfirmationWidgetAssets(this.app, options.environment);
    mountEventCalendarWidgetAssets(this.app, options.environment);
    mountMemberManagementWidgetAssets(this.app, options.environment);
    mountNewsWidgetAssets(this.app, options.environment);
    this.#mountRoutes();
  }

  get inflightRequests(): number {
    return this.#inflight;
  }

  get draining(): boolean {
    return this.#draining;
  }

  async listen(port: number, host = "0.0.0.0"): Promise<{ port: number; host: string }> {
    if (this.#httpServer) throw new Error("Der MCP-Server läuft bereits.");
    const server = await new Promise<NodeHttpServer>((resolve, reject) => {
      const listener = this.app.listen(port, host, () => resolve(listener));
      listener.once("error", reject);
    });
    this.#httpServer = server;
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Der MCP-Listener hat keine TCP-Adresse.");
    }
    return { port: address.port, host };
  }

  async drain(timeoutMs = 20_000): Promise<boolean> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new Error("Der Drain-Timeout ist ungültig.");
    }
    this.#draining = true;
    this.#probe.setDraining(true);
    const listener = this.#httpServer;
    this.#httpServer = null;
    const listenerClosed = listener
      ? new Promise<void>((resolve) => listener.close(() => resolve()))
      : Promise.resolve();
    if (this.#inflight === 0) {
      await listenerClosed;
      return true;
    }
    const drained = new Promise<boolean>((resolve) => {
      const waiter = () => resolve(true);
      this.#drainWaiters.add(waiter);
    });
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([drained, timeout]);
    if (result) await listenerClosed;
    return result;
  }

  #mountRoutes(): void {
    this.app.use(MCP_ROUTE, (request: Request, response: Response, next: NextFunction) => {
      const origin = request.get("origin");
      if (origin && !this.#allowedOrigins.has(origin)) {
        const requestId = this.#newRequestId();
        response.setHeader("x-request-id", requestId);
        response.status(403).json(jsonRpcErrorBody({
          code: "PERMISSION_DENIED",
          message: "Die Request-Origin ist nicht freigegeben.",
          request_id: requestId,
          retryable: false,
        }));
        return;
      }
      next();
    });

    this.app.get(HEALTH_ROUTE, (request, response) => {
      const requestId = this.#newRequestId();
      const startedAt = Date.now();
      response.setHeader("x-request-id", requestId);
      response.status(200).json(this.#probe.health());
      void this.#record({
        request_id: requestId,
        provider: null,
        authenticated: false,
        route: HEALTH_ROUTE,
        method: methodForTelemetry(request.method),
        status_code: 200,
        duration_ms: Date.now() - startedAt,
        outcome: "success",
        recorded_at: this.#now().toISOString(),
      });
    });

    this.app.get(PROTECTED_RESOURCE_ROUTE, (request, response) => {
      const requestId = this.#newRequestId();
      const startedAt = Date.now();
      response.setHeader("cache-control", "public, max-age=300");
      response.setHeader("x-request-id", requestId);
      response.status(200).json(createProtectedResourceMetadata(
        this.#options.environment,
        RESOURCE_DOCUMENTATION,
        this.#options.public_origin,
      ));
      void this.#record({
        request_id: requestId,
        provider: null,
        authenticated: false,
        route: PROTECTED_RESOURCE_ROUTE,
        method: methodForTelemetry(request.method),
        status_code: 200,
        duration_ms: Date.now() - startedAt,
        outcome: "success",
        recorded_at: this.#now().toISOString(),
      });
    });

    this.app.get(OPENAI_APPS_CHALLENGE_ROUTE, (request, response) => {
      const requestId = this.#newRequestId();
      const startedAt = Date.now();
      const token = this.#options.openai_apps_challenge_token;
      const statusCode = token ? 200 : 404;
      response.setHeader("cache-control", "no-store");
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("x-request-id", requestId);
      response.status(statusCode).send(token ?? "Not found");
      void this.#record({
        request_id: requestId,
        provider: null,
        authenticated: false,
        route: OPENAI_APPS_CHALLENGE_ROUTE,
        method: methodForTelemetry(request.method),
        status_code: statusCode,
        duration_ms: Date.now() - startedAt,
        outcome: statusCode === 200 ? "success" : "rejected",
        recorded_at: this.#now().toISOString(),
      });
    });

    this.app.get(READY_ROUTE, async (request, response) => {
      const requestId = this.#newRequestId();
      const startedAt = Date.now();
      const readiness = await this.#probe.readiness();
      const statusCode = readiness.status === "ready" ? 200 : 503;
      response.setHeader("x-request-id", requestId);
      response.status(statusCode).json(readiness);
      void this.#record({
        request_id: requestId,
        provider: null,
        authenticated: false,
        route: READY_ROUTE,
        method: methodForTelemetry(request.method),
        status_code: statusCode,
        duration_ms: Date.now() - startedAt,
        outcome: statusCode === 200 ? "success" : "failed",
        recorded_at: this.#now().toISOString(),
      });
    });

    this.app.post(MCP_ROUTE, (request, response) => {
      void this.#handleMcp(request, response);
    });
    this.app.get(MCP_ROUTE, (request, response) => this.#methodNotAllowed(request, response));
    this.app.delete(MCP_ROUTE, (request, response) => this.#methodNotAllowed(request, response));

    this.app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
      if (response.headersSent) return;
      const requestId = this.#newRequestId();
      response.setHeader("x-request-id", requestId);
      response.status(400).json(jsonRpcErrorBody({
        code: "VALIDATION_FAILED",
        message: error instanceof SyntaxError
          ? "Der JSON-Request ist ungültig."
          : "Die Anfrage ist ungültig.",
        request_id: requestId,
        retryable: false,
      }));
    });
  }

  async #handleMcp(request: Request, response: Response): Promise<void> {
    const fallbackRequestId = this.#newRequestId();
    const startedAt = Date.now();
    let context: StatelessTransportContext | null = null;
    let authChallenge: AuthChallenge | null = null;
    let finalized = false;
    let mcpServer: Awaited<ReturnType<McpRuntimeOptions["server_factory"]>> | null = null;
    let transport: StreamableHTTPServerTransport | null = null;
    this.#inflight += 1;

    const finalize = async () => {
      if (finalized) return;
      finalized = true;
      await Promise.allSettled([
        transport?.close() ?? Promise.resolve(),
        mcpServer?.close() ?? Promise.resolve(),
      ]);
      this.#inflight -= 1;
      if (this.#inflight === 0) {
        for (const waiter of this.#drainWaiters) waiter();
        this.#drainWaiters.clear();
      }
      await this.#record({
        request_id: context?.request.request_id ?? fallbackRequestId,
        provider: context?.provider_request.provider ?? null,
        authenticated: context?.provider_request.authenticated ?? false,
        route: MCP_ROUTE,
        method: "POST",
        status_code: response.statusCode,
        duration_ms: Date.now() - startedAt,
        outcome: response.statusCode < 400 ? "success"
          : response.statusCode < 500 ? "rejected" : "failed",
        recorded_at: this.#now().toISOString(),
      });
    };
    response.once("close", () => void finalize());

    try {
      if (this.#draining) {
        throw runtimeError({
          code: "UPSTREAM_UNAVAILABLE",
          message: "Der Connector wird gerade aktualisiert. Bitte versuche es erneut.",
          request_id: fallbackRequestId,
          retryable: true,
          retry_after_seconds: 5,
        });
      }
      context = await this.#contextFactory.create({
        authorization: request.get("authorization"),
        host: request.get("host"),
        origin: request.get("origin"),
        user_agent: request.get("user-agent"),
        provider_hint: request.get("x-comvenio-provider"),
        protocol_version: request.get("mcp-protocol-version"),
        body: request.body,
      });
      const accessDecision = this.#options.access_policy.classify(request.body);
      if (!context.provider_request.authenticated && !accessDecision.anonymous_allowed) {
        authChallenge = createAuthChallenge({
          environment: this.#options.environment,
          request_id: context.request.request_id,
          required_scopes: accessDecision.required_scopes,
          public_origin: this.#options.public_origin,
        });
        throw runtimeError({
          code: "AUTH_REQUIRED",
          message: authChallenge.message,
          request_id: context.request.request_id,
          retryable: false,
          required_scope: authChallenge.required_scopes[0]!,
        });
      }
      response.setHeader("x-request-id", context.request.request_id);
      mcpServer = await this.#options.server_factory(context);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(request, response, request.body);
      if (response.writableEnded) await finalize();
    } catch (error) {
      const requestId = context?.request.request_id ?? fallbackRequestId;
      const httpError = toHttpError(error, requestId);
      if (httpError.status === 401) {
        response.setHeader(
          "WWW-Authenticate",
          authChallenge?.www_authenticate
            ?? createBearerChallenge(this.#options.environment, "public.read", this.#options.public_origin),
        );
      }
      response.setHeader("x-request-id", requestId);
      if (!response.headersSent) {
        response.status(httpError.status).json(jsonRpcErrorBody(httpError.connector_error));
      } else if (!response.writableEnded) {
        response.end();
      }
      if (response.writableEnded) await finalize();
    }
  }

  #methodNotAllowed(request: Request, response: Response): void {
    const requestId = this.#newRequestId();
    const startedAt = Date.now();
    response.setHeader("allow", "POST");
    response.setHeader("x-request-id", requestId);
    response.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
        data: { request_id: requestId },
      },
      id: null,
    });
    void this.#record({
      request_id: requestId,
      provider: null,
      authenticated: false,
      route: MCP_ROUTE,
      method: methodForTelemetry(request.method),
      status_code: 405,
      duration_ms: Date.now() - startedAt,
      outcome: "rejected",
      recorded_at: this.#now().toISOString(),
    });
  }

  #newRequestId(): UUID {
    return this.#options.request_id?.() ?? randomUUID();
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  async #record(event: SafeTelemetryRecord): Promise<void> {
    try {
      await this.#options.telemetry.record(createSafeTelemetryRecord(event));
    } catch {
      // Telemetry is deliberately non-blocking and must never expose request content in fallback logs.
    }
  }
}
