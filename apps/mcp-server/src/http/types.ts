import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type {
  ActiveIntrospection,
  CapabilitySnapshot,
  OAuthClientRegistration,
  OAuthEnvironment,
  HttpsUrl,
} from "@comvenio/auth";
import type {
  McpClientKind,
  OAuthScope,
  ProviderId,
  RequestContext,
  UUID,
} from "@comvenio/connector-contracts";
import type { McpRequestAccessPolicy } from "../public/types.ts";

export type RequestRisk = "read" | "write";

export interface ProviderRequestContext {
  request_id: UUID;
  provider: ProviderId | null;
  client_kind: McpClientKind;
  authenticated: boolean;
  protocol_version: string | null;
  received_at: string;
}

export interface AgentCapabilityProjection {
  key: string;
  capability_id: string;
  capability_version: number;
  status: "implemented";
  source: "capability_gate";
  channels: string[];
  advertisable: true;
  agent_selectable: true;
  user_invocable: true;
  externally_exposed: true;
  release_id: string | null;
  executor_id: string;
  executor_version: string;
  policy_version: string;
  input_schema_hash: string;
  output_schema_hash: string;
  evidence_bundle_id: string;
  evidence_bundle_hash: string | null;
}

export interface AuthenticatedConnectorPrincipal {
  subject_id: UUID;
  oauth_grant_id: UUID;
  client_id: `https://${string}`;
  provider: ProviderId;
  club_id: UUID | null;
  scopes: OAuthScope[];
  expires_at_epoch_seconds: number;
  backend_actor_token: string;
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
    audience: HttpsUrl;
    force_fresh: boolean;
  }): Promise<unknown>;
}

export interface ProviderRegistrationResolver {
  resolve(clientId: ActiveIntrospection["client_id"]): Promise<OAuthClientRegistration | null>;
}

export interface ActorTokenPort {
  exchange(input: {
    raw_token: string;
    request_id: UUID;
    audience: HttpsUrl;
  }): Promise<unknown>;
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
    backend_actor_token: string;
  }): Promise<CapabilitySnapshot>;
}

export interface StatelessTransportContext {
  provider_request: ProviderRequestContext;
  request: RequestContext;
  capability_snapshot: CapabilitySnapshot | null;
  backend_actor_token: string | null;
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
  route: "/mcp" | "/health" | "/ready" | "/.well-known/oauth-protected-resource" | "/.well-known/openai-apps-challenge";
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
  public_origin: HttpsUrl;
  edge_shared_secret: string | null;
  openai_apps_challenge_token?: string | null;
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
