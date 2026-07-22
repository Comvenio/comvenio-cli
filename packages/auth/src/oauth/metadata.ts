import { OAUTH_SCOPE_VALUES } from "@comvenio/connector-contracts";

import type {
  HttpsUrl,
  OAuthAuthorizationServerMetadata,
  OAuthEndpoints,
  OAuthEnvironment,
  OAuthProtectedResourceMetadata,
} from "./types.ts";
import { OAuthContractError } from "./types.ts";

function assertHttps(value: string, field: string): asserts value is HttpsUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthContractError("invalid_request", `${field} ist ungültig.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new OAuthContractError("invalid_request", `${field} muss eine kanonische HTTPS-URL sein.`);
  }
}

export function oauthEndpoints(
  environment: OAuthEnvironment,
  publicOrigin?: HttpsUrl,
): OAuthEndpoints {
  const production = environment === "production";
  const resource = publicOrigin ?? (production
    ? "https://mcp.comvenio.app"
    : "https://mcpdev.comvenio.app");
  assertHttps(resource, "MCP_PUBLIC_ORIGIN");
  if (new URL(resource).origin !== resource) {
    throw new OAuthContractError("invalid_request", "MCP_PUBLIC_ORIGIN muss ein HTTPS-Origin ohne Pfad sein.");
  }
  const authorizationServer = `https://${production ? "api" : "apidev"}.comvenio.app/auth` as HttpsUrl;
  return {
    resource,
    authorization_server: authorizationServer,
    protected_resource_metadata: `${resource}/.well-known/oauth-protected-resource`,
    authorization_server_metadata: `${authorizationServer}/.well-known/oauth-authorization-server`,
  };
}

export function createAuthorizationServerMetadata(
  environment: OAuthEnvironment,
): OAuthAuthorizationServerMetadata {
  const { authorization_server: issuer } = oauthEndpoints(environment);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...OAUTH_SCOPE_VALUES],
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
  };
}

export function createProtectedResourceMetadata(
  environment: OAuthEnvironment,
  resourceDocumentation: string,
  publicOrigin?: HttpsUrl,
): OAuthProtectedResourceMetadata {
  assertHttps(resourceDocumentation, "resource_documentation");
  const endpoints = oauthEndpoints(environment, publicOrigin);
  return {
    resource: endpoints.resource,
    authorization_servers: [endpoints.authorization_server],
    scopes_supported: [...OAUTH_SCOPE_VALUES],
    resource_documentation: resourceDocumentation,
  };
}
