import type { HttpsUrl, OAuthEnvironment } from "@comvenio/auth";
import {
  parseConnectorReleaseScope,
  type ConnectorReleaseScope,
} from "@comvenio/connector-contracts";
import IORedis from "ioredis";

import cimdPins from "../../../integrations/release/cimd-client-allowlist.v1.json";
import {
  InMemoryDomainStateStore,
  RedisDomainStateStore,
  type DomainStateStore,
} from "./domain-state-store.ts";
import { IntrospectionBearerAuthenticator } from "./http/auth.ts";
import { ExactProviderHintResolver } from "./http/context.ts";
import { McpHttpServer } from "./http/server.ts";
import { ConsoleTelemetrySink } from "./http/telemetry.ts";
import {
  HttpAgentCapabilityResolver,
  HttpActorTokenPort,
  HttpCapabilityContextResolver,
  HttpIntrospectionPort,
  PinnedProviderRegistrationResolver,
  createHttpReadinessCheck,
} from "./http/upstreams.ts";
import type { McpRuntimeOptions, ReadinessDependency } from "./http/types.ts";
import {
  startJobFilePlatform,
  type JobFileAdapterFactories,
  type JobsFilesConfig,
  type RunningJobFilePlatform,
} from "./job-file-runtime.ts";
import type { JobFilePlatform } from "./jobs/platform.ts";
import {
  createRuntimeAccessPolicy,
  createRuntimeServer,
} from "./runtime-tools.ts";

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
  MCP_RELEASE_SCOPE?: string;
  MCP_SHARED_STATE_ENCRYPTION_KEY?: string;
  MCP_SHARED_STATE_REDIS_URL?: string;
  OPENAI_APPS_CHALLENGE_TOKEN?: string;
  PORT?: string;
  RAILWAY_PUBLIC_DOMAIN?: string;
  REDIS_URL?: string;
  MCP_UPLOAD_S3_ENDPOINT?: string;
  MCP_UPLOAD_S3_REGION?: string;
  MCP_UPLOAD_S3_BUCKET?: string;
  MCP_UPLOAD_S3_ACCESS_KEY_ID?: string;
  MCP_UPLOAD_S3_SECRET_ACCESS_KEY?: string;
  MCP_CLAMD_HOST?: string;
  MCP_CLAMD_PORT?: string;
  JOB_BINDING_SECRET?: string;
}

export interface McpProcessConfig {
  environment: OAuthEnvironment;
  host: "0.0.0.0";
  port: number;
  public_origin: HttpsUrl;
  cli_oauth_client_id: HttpsUrl;
  cli_oauth_resource: HttpsUrl;
  edge_shared_secret: string | null;
  api_base_url: HttpsUrl;
  auth_base_url: HttpsUrl;
  internal_api_key: string;
  openai_apps_challenge_token: string | null;
  release_scope: ConnectorReleaseScope;
  shared_state_encryption_key: string | null;
  shared_state_redis_url: string | null;
  cimd_client_pins: unknown;
  allowed_hosts: string[];
  allowed_origins: string[];
  /** Uploads and jobs (K15); null unless every value of the group is set. */
  jobs_files: JobsFilesConfig | null;
  /** Names (never values) of the group's variables that are missing. */
  jobs_files_missing: string[];
}

/** Variables of the "uploads and jobs" group besides the shared-state Redis and key. */
export const JOBS_FILES_VARIABLES = Object.freeze([
  "MCP_UPLOAD_S3_ENDPOINT",
  "MCP_UPLOAD_S3_REGION",
  "MCP_UPLOAD_S3_BUCKET",
  "MCP_UPLOAD_S3_ACCESS_KEY_ID",
  "MCP_UPLOAD_S3_SECRET_ACCESS_KEY",
  "MCP_CLAMD_HOST",
  "MCP_CLAMD_PORT",
  "JOB_BINDING_SECRET",
] as const);

function plainValue(value: string, field: string, maxLength = 2_048): string {
  if (value !== value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${field} ist ungültig.`);
  }
  return value;
}

/**
 * All or nothing: with a missing value the group stays off and the runtime
 * behaves as before (no file tools, job actions hidden). A present but
 * malformed value is a configuration error. Values never enter messages.
 */
function jobsFilesConfig(
  input: McpProcessEnvironment,
  sharedStateRedis: string | null,
  sharedStateEncryption: string | null,
): { config: JobsFilesConfig | null; missing: string[] } {
  const missing: string[] = JOBS_FILES_VARIABLES.filter((name) => {
    const value = input[name];
    return value === undefined || value.trim() === "";
  });
  if (!sharedStateRedis) missing.push("MCP_SHARED_STATE_REDIS_URL");
  if (!sharedStateEncryption) missing.push("MCP_SHARED_STATE_ENCRYPTION_KEY");
  if (missing.length > 0 || !sharedStateRedis || !sharedStateEncryption) {
    return { config: null, missing: missing.sort() };
  }
  const endpoint = httpsUrl(input.MCP_UPLOAD_S3_ENDPOINT, "MCP_UPLOAD_S3_ENDPOINT", false);
  const clamdHost = plainValue(input.MCP_CLAMD_HOST!, "MCP_CLAMD_HOST", 253);
  if (!/^[A-Za-z0-9.-]+$/u.test(clamdHost)) throw new Error("MCP_CLAMD_HOST ist ungültig.");
  const clamdPort = Number(input.MCP_CLAMD_PORT);
  if (!Number.isInteger(clamdPort) || clamdPort < 1 || clamdPort > 65_535) {
    throw new Error("MCP_CLAMD_PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }
  const bindingSecret = plainValue(input.JOB_BINDING_SECRET!, "JOB_BINDING_SECRET", 512);
  if (bindingSecret.length < 32) throw new Error("JOB_BINDING_SECRET ist ungültig.");
  return {
    config: {
      redis_url: sharedStateRedis,
      encryption_key: sharedStateEncryption,
      quarantine: {
        endpoint,
        region: plainValue(input.MCP_UPLOAD_S3_REGION!, "MCP_UPLOAD_S3_REGION", 64),
        bucket: plainValue(input.MCP_UPLOAD_S3_BUCKET!, "MCP_UPLOAD_S3_BUCKET", 255),
        accessKeyId: plainValue(input.MCP_UPLOAD_S3_ACCESS_KEY_ID!, "MCP_UPLOAD_S3_ACCESS_KEY_ID", 256),
        secretAccessKey: plainValue(input.MCP_UPLOAD_S3_SECRET_ACCESS_KEY!, "MCP_UPLOAD_S3_SECRET_ACCESS_KEY", 512),
      },
      clamd: { host: clamdHost, port: clamdPort },
      job_binding_secret: bindingSecret,
    },
    missing: [],
  };
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

function releaseScope(
  value: string | undefined,
  selectedEnvironment: OAuthEnvironment,
): ConnectorReleaseScope {
  if (
    selectedEnvironment === "production"
    && (value === undefined || value.trim() === "")
  ) {
    throw new Error("MCP_RELEASE_SCOPE ist für Production erforderlich.");
  }
  return parseConnectorReleaseScope(value);
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

function sharedStateRedisUrl(
  value: string | undefined,
  selectedEnvironment: OAuthEnvironment,
): string | null {
  if (value === undefined || value.trim() === "") {
    if (selectedEnvironment === "production") {
      throw new Error(
        "MCP_SHARED_STATE_REDIS_URL ist für Production erforderlich.",
      );
    }
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MCP_SHARED_STATE_REDIS_URL ist ungültig.");
  }
  if (
    value !== value.trim()
    || !["redis:", "rediss:"].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.hash
  ) {
    throw new Error("MCP_SHARED_STATE_REDIS_URL ist ungültig.");
  }
  return value;
}

function sharedStateEncryptionKey(
  value: string | undefined,
  selectedEnvironment: OAuthEnvironment,
): string | null {
  if (value === undefined || value === "") {
    if (selectedEnvironment === "production") {
      throw new Error(
        "MCP_SHARED_STATE_ENCRYPTION_KEY ist für Production erforderlich.",
      );
    }
    return null;
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    throw new Error("MCP_SHARED_STATE_ENCRYPTION_KEY ist ungültig.");
  }
  if (
    value !== value.trim()
    || decoded.length !== 32
    || decoded.toString("base64url") !== value.replace(/=+$/u, "")
  ) {
    throw new Error("MCP_SHARED_STATE_ENCRYPTION_KEY ist ungültig.");
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
  const cliOauthClientId = httpsUrl(
    `${authBaseUrl}/oauth/clients/comvenio-cli`,
    "CLI OAuth client_id",
    true,
  );
  const cliOauthResource = httpsUrl(
    `${publicOrigin}/cli`,
    "CLI OAuth resource",
    true,
  );
  const internalApiKey = input.INTERNAL_API_KEY?.trim() ?? "";
  if (!internalApiKey || /[\r\n]/u.test(internalApiKey)) {
    throw new Error("INTERNAL_API_KEY ist für den MCP-Gateway erforderlich.");
  }
  const configuredEdgeSecret = edgeSharedSecret(
    input.MCP_EDGE_SHARED_SECRET,
    selectedEnvironment,
  );
  const sharedStateRedis = sharedStateRedisUrl(
    input.MCP_SHARED_STATE_REDIS_URL ?? input.REDIS_URL,
    selectedEnvironment,
  );
  const sharedStateEncryption = sharedStateEncryptionKey(
    input.MCP_SHARED_STATE_ENCRYPTION_KEY,
    selectedEnvironment,
  );
  if (Boolean(sharedStateRedis) !== Boolean(sharedStateEncryption)) {
    throw new Error(
      "Shared-State-Redis und Verschlüsselungsschlüssel müssen gemeinsam konfiguriert sein.",
    );
  }
  const jobsFiles = jobsFilesConfig(input, sharedStateRedis, sharedStateEncryption);
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
    cli_oauth_client_id: cliOauthClientId,
    cli_oauth_resource: cliOauthResource,
    edge_shared_secret: configuredEdgeSecret,
    api_base_url: apiBaseUrl,
    auth_base_url: authBaseUrl,
    internal_api_key: internalApiKey,
    openai_apps_challenge_token: openAiChallengeToken(input.OPENAI_APPS_CHALLENGE_TOKEN),
    release_scope: releaseScope(input.MCP_RELEASE_SCOPE, selectedEnvironment),
    shared_state_encryption_key: sharedStateEncryption,
    shared_state_redis_url: sharedStateRedis,
    cimd_client_pins: parsePins(input.MCP_CIMD_CLIENT_PINS_JSON),
    allowed_hosts: allowedHosts,
    allowed_origins: csv(input[`${prefix}_ALLOWED_ORIGINS`]),
    jobs_files: jobsFiles.config,
    jobs_files_missing: jobsFiles.missing,
  };
}

function runtimeReadiness(input: {
  config: McpProcessConfig;
  registrations: PinnedProviderRegistrationResolver;
  state_store: DomainStateStore;
  job_files_readiness?: readonly ReadinessDependency[];
}): ReadinessDependency[] {
  return [
    ...(input.job_files_readiness ?? []),
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
      name: "shared_state",
      required: true,
      check: async () => input.state_store.ready(),
    },
    {
      name: "capabilities",
      required: true,
      check: createHttpReadinessCheck({ url: `${input.config.api_base_url}/role/health` }),
    },
  ];
}

function runtimeServerFactory(
  config: McpProcessConfig,
  stateStore: DomainStateStore,
  agentCapabilities: HttpAgentCapabilityResolver,
  jobFiles: JobFilePlatform | null,
): McpRuntimeOptions["server_factory"] {
  return async (context) => {
    const exposesClubAgent = config.release_scope === "club_agent_bridge_v1"
      || config.release_scope === "full_connector_v1";
    const releasedAgentCapabilities = exposesClubAgent
      && context.request.club_id
      && context.backend_actor_token
      && context.request.scopes.includes("club.read")
      ? await agentCapabilities.resolve({
        context: context.request,
        backend_actor_token: context.backend_actor_token,
      })
      : [];
    // A token with only club.write may call write functions (R1+); the server filters the list
    // by the scope it carries, so either club scope loads it.
    const releasedAgentFunctions = exposesClubAgent
      && context.request.club_id
      && context.backend_actor_token
      && (context.request.scopes.includes("club.read") || context.request.scopes.includes("club.write"))
      ? await agentCapabilities.resolveFunctions({
        context: context.request,
        backend_actor_token: context.backend_actor_token,
      })
      : [];
    const server = createRuntimeServer({
      environment: config.environment,
      api_base_url: config.api_base_url,
      public_origin: config.public_origin,
      context,
      club_agent_capabilities: releasedAgentCapabilities,
      club_agent_functions: releasedAgentFunctions,
      domain_state_store: stateStore,
      release_scope: config.release_scope,
      job_files: jobFiles,
    });
    return server;
  };
}

export function createMcpDeploymentCandidate(
  config: McpProcessConfig,
  stateStore?: DomainStateStore,
  jobFiles?: RunningJobFilePlatform | null,
): McpHttpServer {
  const domainStateStore = stateStore
    ?? (config.environment === "development"
      ? new InMemoryDomainStateStore()
      : null);
  if (!domainStateStore) {
    throw new Error(
      "Production benötigt einen expliziten gemeinsamen MCP-Zustandsspeicher.",
    );
  }
  const registrations = new PinnedProviderRegistrationResolver(
    config.cimd_client_pins,
    config.cli_oauth_client_id,
  );
  const introspection = new HttpIntrospectionPort({
    auth_base_url: config.auth_base_url,
    internal_api_key: config.internal_api_key,
  });
  const actorTokens = new HttpActorTokenPort({
    auth_base_url: config.auth_base_url,
    internal_api_key: config.internal_api_key,
  });
  const agentCapabilities = new HttpAgentCapabilityResolver({
    api_base_url: config.api_base_url,
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
    cli_authenticator: new IntrospectionBearerAuthenticator({
      introspection,
      registrations,
      actor_tokens: actorTokens,
      audience: config.cli_oauth_resource,
      // Machine grants (client credentials per club) sign in here only.
      accept_machine_clients: true,
    }),
    cli_resource: config.cli_oauth_resource,
    provider_resolver: new ExactProviderHintResolver(),
    capability_resolver: new HttpCapabilityContextResolver({ api_base_url: config.api_base_url }),
    access_policy: createRuntimeAccessPolicy(
      config.environment,
      config.release_scope,
      Boolean(jobFiles),
    ),
    server_factory: runtimeServerFactory(
      config,
      domainStateStore,
      agentCapabilities,
      jobFiles?.platform ?? null,
    ),
    readiness_dependencies: runtimeReadiness({
      config,
      registrations,
      state_store: domainStateStore,
      job_files_readiness: jobFiles?.readiness ?? [],
    }),
    telemetry: new ConsoleTelemetrySink(),
  });
}

export async function startMcpDeploymentCandidate(
  input: McpProcessEnvironment,
  options: {
    job_file_adapters?: JobFileAdapterFactories;
    on_lifecycle_event?: (event: Record<string, string>) => void;
  } = {},
): Promise<{
  server: McpHttpServer;
  config: McpProcessConfig;
  state_store: DomainStateStore;
  /** Stops the job worker and closes its Redis connections; a no-op when the group is off. */
  close_background: () => Promise<void>;
}> {
  const config = readMcpProcessConfig(input);
  const stateStore = config.shared_state_redis_url
    && config.shared_state_encryption_key
    ? new RedisDomainStateStore(new IORedis(
      config.shared_state_redis_url,
      {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      },
    ), Buffer.from(config.shared_state_encryption_key, "base64url"))
    : new InMemoryDomainStateStore();
  let jobFiles: RunningJobFilePlatform | null = null;
  try {
    if (!await stateStore.ready()) {
      throw new Error("Der gemeinsame MCP-Zustandsspeicher ist nicht bereit.");
    }
    if (config.jobs_files) {
      jobFiles = await startJobFilePlatform({
        config: config.jobs_files,
        api_base_url: config.api_base_url,
        auth_base_url: config.auth_base_url,
        internal_api_key: config.internal_api_key,
        ...(options.job_file_adapters ? { adapters: options.job_file_adapters } : {}),
        ...(options.on_lifecycle_event ? { on_lifecycle_event: options.on_lifecycle_event } : {}),
      });
    }
    options.on_lifecycle_event?.({
      event: "comvenio_mcp_jobs_files",
      state: jobFiles ? "enabled" : "disabled",
      missing: config.jobs_files_missing.join(","),
    });
    const server = createMcpDeploymentCandidate(config, stateStore, jobFiles);
    await server.listen(config.port, config.host);
    const running = jobFiles;
    return {
      server,
      config,
      state_store: stateStore,
      close_background: async () => { await running?.close(); },
    };
  } catch (error) {
    await jobFiles?.close();
    await stateStore.close();
    throw error;
  }
}
