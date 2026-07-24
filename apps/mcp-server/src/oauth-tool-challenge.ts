import type {
  OAuthScope,
  RequestContext,
} from "@comvenio/connector-contracts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function normalizedScopes(scopes: readonly OAuthScope[]): OAuthScope[] {
  return [...new Set(scopes)].sort();
}

export function insufficientScopeToolResult(input: {
  public_origin: string;
  required_scopes: readonly OAuthScope[];
  context?: RequestContext;
}): CallToolResult {
  const requiredScopes = normalizedScopes(input.required_scopes);
  if (requiredScopes.length === 0) {
    throw new Error("Eine OAuth-Step-up-Challenge benötigt mindestens einen Scope.");
  }
  const publicOrigin = input.public_origin.replace(/\/+$/u, "");
  const resourceMetadata = `${publicOrigin}/.well-known/oauth-protected-resource`;
  const scope = requiredScopes.join(" ");
  const challenge = [
    `Bearer resource_metadata="${resourceMetadata}"`,
    'error="insufficient_scope"',
    'error_description="Für diese Comvenio-Aktion fehlen erforderliche OAuth-Scopes."',
    `scope="${scope}"`,
  ].join(", ");
  return {
    content: [{
      type: "text",
      text: "Für diese Aktion benötigt Comvenio zusätzliche Berechtigungen. Bitte starte den OAuth-Step-up für die angezeigten Scopes und wiederhole anschließend denselben Aufruf.",
    }],
    structuredContent: {
      error: "insufficient_scope",
      required_scopes: requiredScopes,
    },
    _meta: {
      "mcp/www_authenticate": [challenge],
      ...(input.context
        ? { request_id: input.context.request_id }
        : {}),
    },
    isError: true,
  };
}
