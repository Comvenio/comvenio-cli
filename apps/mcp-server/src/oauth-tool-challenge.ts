import {
  formatPublicError,
  renderPublicError,
  type OAuthScope,
  type RequestContext,
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
  // Public error model (docs/fehler/katalog.json): code, cause and the login
  // command with all scopes, next to the OAuth step-up challenge.
  const rendered = renderPublicError({
    code: "SCOPE_REQUIRED",
    lang: "de",
    request_id: input.context?.request_id ?? null,
    required_scopes: requiredScopes,
    granted_scopes: input.context?.scopes ?? [],
  });
  return {
    content: [{
      type: "text",
      text: formatPublicError(rendered),
    }],
    structuredContent: {
      error: "insufficient_scope",
      required_scopes: requiredScopes,
      code: rendered.code,
      message: rendered.message,
      cause: rendered.cause,
      next_command: rendered.next_command,
      help: rendered.help,
      request_id: rendered.request_id,
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
