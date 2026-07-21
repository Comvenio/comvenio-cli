import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OAuthEnvironment } from "@comvenio/auth";

import { runtimeError } from "./http/errors.ts";
import { McpHttpServer } from "./http/server.ts";
import { ExactProviderHintResolver } from "./http/context.ts";
import type {
  BearerAuthenticator,
  CapabilityContextResolver,
  McpRuntimeOptions,
  ReadinessDependency,
} from "./http/types.ts";
import { PublicToolSubset } from "./public/subset.ts";
import { registerBookingObjectWidgetResource } from "./widgets/booking-object/resource.ts";
import { registerConfirmationWidgetResource } from "./widgets/confirmation/resource.ts";
import { registerEventCalendarWidgetResource } from "./widgets/event-calendar/resource.ts";
import { registerMemberManagementWidgetResource } from "./widgets/member-management/resource.ts";
import { registerNewsWidgetResource } from "./widgets/news/resource.ts";

export interface McpProcessEnvironment {
  [key: string]: string | undefined;
  COMVENIO_MCP_ENV?: string;
  MCP_DEV_ALLOWED_HOSTS?: string;
  MCP_DEV_ALLOWED_ORIGINS?: string;
  MCP_PROD_ALLOWED_HOSTS?: string;
  MCP_PROD_ALLOWED_ORIGINS?: string;
  PORT?: string;
  RAILWAY_PUBLIC_DOMAIN?: string;
}

export interface McpProcessConfig {
  environment: OAuthEnvironment;
  host: "0.0.0.0";
  port: number;
  allowed_hosts: string[];
  allowed_origins: string[];
}

function csv(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  const values = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (new Set(values).size !== values.length) {
    throw new Error("Eine MCP-Allowlist enthält doppelte Einträge.");
  }
  return values;
}

function environment(value: string | undefined): OAuthEnvironment {
  if (value === undefined || value === "production") return "production";
  if (value === "development") return "development";
  throw new Error("COMVENIO_MCP_ENV muss production oder development sein.");
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? "8080");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }
  return parsed;
}

export function readMcpProcessConfig(input: McpProcessEnvironment): McpProcessConfig {
  const selectedEnvironment = environment(input.COMVENIO_MCP_ENV);
  const prefix = selectedEnvironment === "production" ? "MCP_PROD" : "MCP_DEV";
  const canonicalHost = selectedEnvironment === "production"
    ? "mcp.comvenio.app"
    : "mcpdev.comvenio.app";
  const configuredHosts = csv(input[`${prefix}_ALLOWED_HOSTS`]);
  const railwayHost = input.RAILWAY_PUBLIC_DOMAIN?.trim();
  const allowedHosts = [...new Set([
    canonicalHost,
    ...(railwayHost ? [railwayHost, "healthcheck.railway.app"] : []),
    ...configuredHosts,
  ])];
  return {
    environment: selectedEnvironment,
    host: "0.0.0.0",
    port: port(input.PORT),
    allowed_hosts: allowedHosts,
    allowed_origins: csv(input[`${prefix}_ALLOWED_ORIGINS`]),
  };
}

class UnavailableBearerAuthenticator implements BearerAuthenticator {
  async authenticate(input: Parameters<BearerAuthenticator["authenticate"]>[0]): Promise<never> {
    throw runtimeError({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
      message: "Die Connector-Anmeldung ist noch nicht freigegeben.",
      request_id: input.request_id,
      retryable: true,
    });
  }
}

class UnavailableCapabilityResolver implements CapabilityContextResolver {
  async resolve(input: Parameters<CapabilityContextResolver["resolve"]>[0]): Promise<never> {
    throw runtimeError({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Der Rechteabgleich ist noch nicht freigegeben.",
      request_id: input.context.request_id,
      retryable: true,
    });
  }
}

function blockedReadinessDependencies(): ReadinessDependency[] {
  return [
    { name: "catalog", required: true, check: async () => false },
    { name: "auth", required: true, check: async () => false },
  ];
}

function createBlockedServerFactory(environment: OAuthEnvironment): McpRuntimeOptions["server_factory"] {
  return () => {
    const server = new McpServer({
      name: "comvenio-mcp-server",
      version: "0.1.0",
    });
    registerBookingObjectWidgetResource(server, environment);
    registerConfirmationWidgetResource(server, environment);
    registerEventCalendarWidgetResource(server, environment);
    registerMemberManagementWidgetResource(server, environment);
    registerNewsWidgetResource(server, environment);
    return server;
  };
}

/**
 * Creates the deployable, fail-closed process shell.
 *
 * It intentionally publishes no tools while the audited catalog and the real OAuth/RBAC
 * adapters are blocked by the release report. Liveness can therefore be verified on Railway
 * without turning an infrastructure smoke test into a product release.
 */
export function createMcpDeploymentCandidate(config: McpProcessConfig): McpHttpServer {
  return new McpHttpServer({
    environment: config.environment,
    allowed_hosts: config.allowed_hosts,
    allowed_origins: config.allowed_origins,
    authenticator: new UnavailableBearerAuthenticator(),
    provider_resolver: new ExactProviderHintResolver(),
    capability_resolver: new UnavailableCapabilityResolver(),
    access_policy: new PublicToolSubset({ public_tools: [], protected_tools: [] }),
    server_factory: createBlockedServerFactory(config.environment),
    readiness_dependencies: blockedReadinessDependencies(),
    telemetry: { record() {} },
  });
}

export async function startMcpDeploymentCandidate(
  input: McpProcessEnvironment,
): Promise<{ server: McpHttpServer; config: McpProcessConfig }> {
  const config = readMcpProcessConfig(input);
  const server = createMcpDeploymentCandidate(config);
  await server.listen(config.port, config.host);
  return { server, config };
}
