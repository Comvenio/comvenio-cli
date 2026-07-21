import type { OAuthScope, ProviderId, UUID } from "@comvenio/connector-contracts";

export type OAuthEnvironment = "development" | "production";
export type HttpsUrl = `https://${string}`;

export interface OAuthAuthorizationServerMetadata {
  issuer: HttpsUrl;
  authorization_endpoint: HttpsUrl;
  token_endpoint: HttpsUrl;
  revocation_endpoint: HttpsUrl;
  scopes_supported: OAuthScope[];
  client_id_metadata_document_supported: true;
  token_endpoint_auth_methods_supported: ["none"];
  code_challenge_methods_supported: ["S256"];
  grant_types_supported: ["authorization_code", "refresh_token"];
  response_types_supported: ["code"];
}

export interface OAuthProtectedResourceMetadata {
  resource: HttpsUrl;
  authorization_servers: [HttpsUrl];
  scopes_supported: OAuthScope[];
  resource_documentation: HttpsUrl;
}

export interface OAuthEndpoints {
  resource: HttpsUrl;
  authorization_server: HttpsUrl;
  protected_resource_metadata: HttpsUrl;
  authorization_server_metadata: HttpsUrl;
}

export interface OAuthClientRegistration {
  client_id: HttpsUrl;
  provider: ProviderId;
  redirect_uris: HttpsUrl[];
  allowed_scopes: OAuthScope[];
  token_endpoint_auth_method: "none";
  pkce_method: "S256";
  metadata_sha256: string;
  enabled: boolean;
}

export interface ConnectorGrant {
  grant_id: UUID;
  subject_id: UUID;
  client_id: OAuthClientRegistration["client_id"];
  provider: ProviderId;
  selected_club_id: UUID | null;
  scopes: OAuthScope[];
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface AuthorizationCodeRecord {
  code_hash_sha256: string;
  client_id: OAuthClientRegistration["client_id"];
  subject_id: UUID;
  redirect_uri: HttpsUrl;
  code_challenge_s256: string;
  selected_club_id: UUID | null;
  scopes: OAuthScope[];
  resource: HttpsUrl;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface ConnectorAccessClaims {
  iss: HttpsUrl;
  aud: "https://mcp.comvenio.app" | "https://mcpdev.comvenio.app";
  sub: UUID;
  grant_id: UUID;
  client_id: OAuthClientRegistration["client_id"];
  club_id: UUID | null;
  scope: string;
  iat: number;
  exp: number;
  jti: UUID;
}

export interface ClubSelectionContext {
  eligible_club_ids: UUID[];
  selected_club_id: UUID;
  selection_mode: "automatic_single_club" | "explicit_multi_club";
}

export interface AuthorizationRequest {
  response_type: "code";
  client_id: HttpsUrl;
  redirect_uri: HttpsUrl;
  code_challenge: string;
  code_challenge_method: "S256";
  state: string;
  scopes: OAuthScope[];
  resource: HttpsUrl;
}

export interface AuthorizationCodeTokenRequest {
  grant_type: "authorization_code";
  code: string;
  client_id: HttpsUrl;
  redirect_uri: HttpsUrl;
  code_verifier: string;
  resource: HttpsUrl;
}

export interface RefreshTokenRequest {
  grant_type: "refresh_token";
  refresh_token: string;
  client_id: HttpsUrl;
  resource: HttpsUrl;
}

export type OAuthTokenRequest = AuthorizationCodeTokenRequest | RefreshTokenRequest;

export interface OAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: 900;
  refresh_token: string;
  scope: string;
}

export type OAuthWireErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "unsupported_grant_type"
  | "temporarily_unavailable";

export class OAuthContractError extends Error {
  readonly error: OAuthWireErrorCode;

  constructor(error: OAuthWireErrorCode, message: string) {
    super(message);
    this.name = "OAuthContractError";
    this.error = error;
  }

  toJSON(): { error: OAuthWireErrorCode } {
    return { error: this.error };
  }
}

export const OAUTH_DEFAULTS = Object.freeze({
  authorization_state_ttl_seconds: 600,
  authorization_code_ttl_seconds: 60,
  access_token_ttl_seconds: 900,
  grant_inactivity_ttl_seconds: 2_592_000,
  refresh_rotation_grace_seconds: 5,
  positive_read_introspection_cache_seconds: 5,
  introspection_timeout_ms: 1_500,
  cimd_timeout_ms: 3_000,
  cimd_max_bytes: 65_536,
  cimd_cache_ttl_seconds: 86_400,
} as const);
