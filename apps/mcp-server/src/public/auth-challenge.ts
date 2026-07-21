import {
  oauthEndpoints,
  type OAuthEnvironment,
} from "@comvenio/auth";
import {
  OAUTH_SCOPE_VALUES,
  type OAuthScope,
  type UUID,
} from "@comvenio/connector-contracts";

import type { AuthChallenge } from "./types.ts";

const KNOWN_SCOPES = new Set<string>(OAUTH_SCOPE_VALUES);

export function createAuthChallenge(input: {
  environment: OAuthEnvironment;
  request_id: UUID;
  required_scopes: readonly OAuthScope[];
}): AuthChallenge {
  const requiredScopes = [...new Set(input.required_scopes)].sort();
  if (requiredScopes.length === 0 || !requiredScopes.every((scope) => KNOWN_SCOPES.has(scope))) {
    throw new Error("Die OAuth-Challenge enthält ungültige Scopes.");
  }
  const resourceMetadata = oauthEndpoints(input.environment).protected_resource_metadata;
  return Object.freeze({
    status: 401 as const,
    request_id: input.request_id,
    resource_metadata: resourceMetadata,
    required_scopes: requiredScopes,
    www_authenticate: `Bearer resource_metadata="${resourceMetadata}", scope="${requiredScopes.join(" ")}"`,
    message: "Verbinde Comvenio, um diese private oder schreibende Aktion auszuführen.",
  });
}
