import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type {
  ActiveIntrospection,
  CapabilitySnapshot,
  OAuthClientRegistration,
  OAuthEnvironment,
} from "@comvenio/auth";
import type {
  OAuthScope,
  ProviderId,
  RequestContext,
  UUID,
} from "@comvenio/connector-contracts";
import type { McpRequestAccessPolicy } from "../public/types.ts";

export type RequestRisk = "read" | "write";

export interface ProviderRequestContext {
  request_id: UUID;
  provider: ProviderId;
  authenticated: boolean;
  protocol_version: string | null;
  received_at: string;
}

export interface AuthenticatedConnectorPrincipal {
  subject_id: UUID;
  oauth_grant_id: UUID;
  client_id: `https://${string}`;
  provider: ProviderId;
  club_id: UUID | null;
  scopes: OAuthScope[];
  expires_at_epoch_seconds: number;
}

export interface BearerAuthenticator {
  authenticate(input: {
    raw_token: string;
    request_id: UUID;
    environment: OAuthEnvironment;
    risk: RequestRisk;
  }): Promise<AuthenticatedConnectorPrincipal>;
}

export interface IntrospectionPort {
  introspect(input: {
    raw_token: string;
    request_id: UUID;
    audience: "https://mcp.comvenio.app" | "https://mcpdev.comvenio.app";
    force_fresh: boolean;
  }): Promise<unknown>;
}

export interface ProviderRegistrationResolver {
  resolve(clientId: ActiveIntrospection["client_id"]): Promise<OAuthClientRegistration | null>;
}

export interface ProviderResolverInput {
  host: string | null;
  origin: string | null;
  user_agent: string | null;
  provider_hint: string | null;
}

export interface ProviderResolver {
  resolve(input: ProviderResolverInput): Promise<ProviderId | null> | ProviderId | null;
}

export interface CapabilityContextResolver {
  resolve(input: {
    context: RequestContext;
    force_recheck: boolean;
  }): Promise<CapabilitySnapshot>;
}

export interface StatelessTransportContext {
  provider_request: ProviderRequestContext;
  request: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
  risk: RequestRisk;
}

export type McpServerFactory = (
  context: StatelessTransportContext,
) => McpServer | Promise<McpServer>;

export interface ReadinessDependency {
  name: string;
  required: boolean;
  check(): Promise<boolean>;
}

export interface ReadinessInspection {
  ready: boolean;
  dependencies: Array<{
    name: string;
    required: boolean;
    available: boolean;
  }>;
}

export interface SafeTelemetryRecord {
  request_id: UUID;
  provider: ProviderId | null;
  authenticated: boolean;
  route: "/mcp" | "/health" | "/ready";
  method: "POST" | "GET" | "DELETE";
  status_code: number;
  duration_ms: number;
  outcome: "success" | "rejected" | "failed";
  recorded_at: string;
}

export interface TelemetrySink {
  record(event: SafeTelemetryRecord): void | Promise<void>;
}

export interface McpRuntimeOptions {
  environment: OAuthEnvironment;
  allowed_hosts: string[];
  allowed_origins: string[];
  authenticator: BearerAuthenticator;
  provider_resolver: ProviderResolver;
  capability_resolver: CapabilityContextResolver;
  access_policy: McpRequestAccessPolicy;
  server_factory: McpServerFactory;
  readiness_dependencies: ReadinessDependency[];
  telemetry: TelemetrySink;
  now?: () => Date;
  request_id?: () => UUID;
}
