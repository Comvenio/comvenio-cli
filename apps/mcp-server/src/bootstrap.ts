import type { HttpsUrl, OAuthEnvironment } from "@comvenio/auth";

import cimdPins from "../../../integrations/release/cimd-client-allowlist.v1.json";
import { IntrospectionBearerAuthenticator } from "./http/auth.ts";
import { ExactProviderHintResolver } from "./http/context.ts";
import { McpHttpServer } from "./http/server.ts";
import { ConsoleTelemetrySink } from "./http/telemetry.ts";
import {
  HttpActorTokenPort,
  HttpCapabilityContextResolver,
  HttpIntrospectionPort,
  PinnedProviderRegistrationResolver,
  createHttpReadinessCheck,
} from "./http/upstreams.ts";
import type { McpRuntimeOptions, ReadinessDependency } from "./http/types.ts";
import { createRuntimeAccessPolicy, createRuntimeServer } from "./runtime-tools.ts";

export interface McpProcessEnvironment {
  [key: string]: string | undefined;
  AUTH_SERVICE_BASE_URL?: string;
  COMVENIO_API_BASE_URL?: string;
  COMVENIO_MCP_ENV?: string;
  INTERNAL_API_KEY?: string;
  MCP_CIMD_CLIENT_PINS_JSON?: string;
  MCP_EDGE_SHARED_SECRET?: string;
  MCP_DEV_ALLOWED_HOSTS?: string;
  MCP_DEV_ALLOWED_ORIGINS?: string;
  MCP_PROD_ALLOWED_HOSTS?: string;
  MCP_PROD_ALLOWED_ORIGINS?: string;
  MCP_PUBLIC_ORIGIN?: string;
  OPENAI_APPS_CHALLENGE_TOKEN?: string;
  PORT?: string;
  RAILWAY_PUBLIC_DOMAIN?: string;
}

export interface McpProcessConfig {
  environment: OAuthEnvironment;
  host: "0.0.0.0";
  port: number;
  public_origin: HttpsUrl;
  edge_shared_secret: string | null;
  api_base_url: HttpsUrl;
  auth_base_url: HttpsUrl;
  internal_api_key: string;
  openai_apps_challenge_token: string | null;
  cimd_client_pins: unknown;
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

function httpsUrl(value: string | undefined, field: string, allowPath: boolean): HttpsUrl {
  let parsed: URL;
  try {
    parsed = new URL(value ?? "");
  } catch {
    throw new Error(`${field} muss eine gültige HTTPS-URL sein.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash
    || (!allowPath && (parsed.pathname !== "/" || parsed.origin !== (value ?? "").replace(/\/$/u, "")))) {
    throw new Error(`${field} muss eine kanonische HTTPS-URL${allowPath ? "" : " ohne Pfad"} sein.`);
  }
  return `${parsed.origin}${allowPath ? parsed.pathname.replace(/\/+$/u, "") : ""}` as HttpsUrl;
}

function parsePins(value: string | undefined): unknown {
  if (value === undefined || value.trim() === "") return cimdPins;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("MCP_CIMD_CLIENT_PINS_JSON enthält kein gültiges JSON.");
  }
}

function openAiChallengeToken(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  if (value !== value.trim() || value.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("OPENAI_APPS_CHALLENGE_TOKEN ist ungültig.");
  }
  return value;
}

function edgeSharedSecret(
  value: string | undefined,
  selectedEnvironment: OAuthEnvironment,
): string | null {
  if (value === undefined || value === "") {
    if (selectedEnvironment === "production") {
      throw new Error("MCP_EDGE_SHARED_SECRET ist für Production erforderlich.");
    }
    return null;
  }
  if (value !== value.trim()
    || value.length < 32
    || value.length > 512
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("MCP_EDGE_SHARED_SECRET ist ungültig.");
  }
  return value;
}

export function readMcpProcessConfig(input: McpProcessEnvironment): McpProcessConfig {
  const selectedEnvironment = environment(input.COMVENIO_MCP_ENV);
  const prefix = selectedEnvironment === "production" ? "MCP_PROD" : "MCP_DEV";
  const publicOrigin = httpsUrl(
    input.MCP_PUBLIC_ORIGIN ?? (selectedEnvironment === "development" ? "https://mcpdev.comvenio.app" : undefined),
    "MCP_PUBLIC_ORIGIN",
    false,
  );
  const apiBaseUrl = httpsUrl(
    input.COMVENIO_API_BASE_URL
      ?? (selectedEnvironment === "production" ? "https://api.comvenio.app" : "https://apidev.comvenio.app"),
    "COMVENIO_API_BASE_URL",
    false,
  );
  const authBaseUrl = httpsUrl(input.AUTH_SERVICE_BASE_URL ?? `${apiBaseUrl}/auth`, "AUTH_SERVICE_BASE_URL", true);
  const internalApiKey = input.INTERNAL_API_KEY?.trim() ?? "";
  if (!internalApiKey || /[\r\n]/u.test(internalApiKey)) {
    throw new Error("INTERNAL_API_KEY ist für den MCP-Gateway erforderlich.");
  }
  const configuredHosts = csv(input[`${prefix}_ALLOWED_HOSTS`]);
  const railwayHost = input.RAILWAY_PUBLIC_DOMAIN?.trim();
  const allowedHosts = [...new Set([
    new URL(publicOrigin).hostname,
    ...(railwayHost ? [railwayHost, "healthcheck.railway.app"] : []),
    ...configuredHosts,
  ])];
  return {
    environment: selectedEnvironment,
    host: "0.0.0.0",
    port: port(input.PORT),
    public_origin: publicOrigin,
    edge_shared_secret: edgeSharedSecret(input.MCP_EDGE_SHARED_SECRET, selectedEnvironment),
    api_base_url: apiBaseUrl,
    auth_base_url: authBaseUrl,
    internal_api_key: internalApiKey,
    openai_apps_challenge_token: openAiChallengeToken(input.OPENAI_APPS_CHALLENGE_TOKEN),
    cimd_client_pins: parsePins(input.MCP_CIMD_CLIENT_PINS_JSON),
    allowed_hosts: allowedHosts,
    allowed_origins: csv(input[`${prefix}_ALLOWED_ORIGINS`]),
  };
}

function runtimeReadiness(input: {
  config: McpProcessConfig;
  registrations: PinnedProviderRegistrationResolver;
}): ReadinessDependency[] {
  return [
    { name: "catalog", required: true, check: async () => true },
    {
      name: "auth",
      required: true,
      check: createHttpReadinessCheck({
        url: `${input.config.auth_base_url}/.well-known/oauth-authorization-server`,
      }),
    },
    {
      name: "provider_registrations",
      required: true,
      check: async () => input.registrations.isReleaseReady(),
    },
    {
      name: "capabilities",
      required: true,
      check: createHttpReadinessCheck({ url: `${input.config.api_base_url}/role/health` }),
    },
  ];
}

function runtimeServerFactory(config: McpProcessConfig): McpRuntimeOptions["server_factory"] {
  return (context) => {
    const server = createRuntimeServer({
      environment: config.environment,
      api_base_url: config.api_base_url,
      context,
    });
    return server;
  };
}

export function createMcpDeploymentCandidate(config: McpProcessConfig): McpHttpServer {
  const registrations = new PinnedProviderRegistrationResolver(config.cimd_client_pins);
  const introspection = new HttpIntrospectionPort({
    auth_base_url: config.auth_base_url,
    internal_api_key: config.internal_api_key,
  });
  const actorTokens = new HttpActorTokenPort({
    auth_base_url: config.auth_base_url,
    internal_api_key: config.internal_api_key,
  });
  return new McpHttpServer({
    environment: config.environment,
    public_origin: config.public_origin,
    edge_shared_secret: config.edge_shared_secret,
    openai_apps_challenge_token: config.openai_apps_challenge_token,
    allowed_hosts: config.allowed_hosts,
    allowed_origins: config.allowed_origins,
    authenticator: new IntrospectionBearerAuthenticator({
      introspection,
      registrations,
      actor_tokens: actorTokens,
      audience: config.public_origin,
    }),
    provider_resolver: new ExactProviderHintResolver(),
    capability_resolver: new HttpCapabilityContextResolver({ api_base_url: config.api_base_url }),
    access_policy: createRuntimeAccessPolicy(config.environment),
    server_factory: runtimeServerFactory(config),
    readiness_dependencies: runtimeReadiness({ config, registrations }),
    telemetry: new ConsoleTelemetrySink(),
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
