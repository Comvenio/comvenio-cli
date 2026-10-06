import {
  formatPublicError,
  isConnectorError,
  publicErrorCode,
  renderPublicError,
  type RequestContext,
} from "@comvenio/connector-contracts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { insufficientScopeToolResult } from "./oauth-tool-challenge.ts";

/**
 * Service codes whose reason may reach the customer, each reviewed for what it
 * reveals. The automations of the ai-service (automatisierungen-07 DC-3); a new
 * code joins only after the same review.
 */
const PUBLIC_DETAIL_CODES: ReadonlySet<string> = new Set([
  "automation_changed",
  "automation_paused",
  "automation_limit_reached",
  "function_not_automatable",
  "standing_not_allowed",
  "invalid_args",
  "invalid_schedule",
  "invalid_trigger",
]);

/**
 * The customer-facing tool error: public code, cause and next command from
 * docs/fehler/katalog.json. A missing scope keeps the OAuth step-up challenge
 * so providers can re-authorize; `error` keeps the internal code for existing
 * consumers, `code` is the public one.
 */
export function publicToolError(
  context: RequestContext,
  publicOrigin: string,
  error: unknown,
  effect: "read" | "write",
): CallToolResult {
  const connectorError = isConnectorError(error) ? error : null;
  const code = connectorError ? publicErrorCode({ ...connectorError, effect }) : "UNKNOWN_ERROR";
  const requiredScopes = connectorError?.required_scopes
    ?? (connectorError?.required_scope ? [connectorError.required_scope] : []);
  const rendered = renderPublicError({
    code,
    lang: "de",
    request_id: context.request_id,
    required_scopes: requiredScopes,
    granted_scopes: context.scopes,
  });
  const publicFields = {
    code: rendered.code,
    message: rendered.message,
    cause: rendered.cause,
    next_command: rendered.next_command,
    help: rendered.help,
    request_id: context.request_id,
  };
  // The service's reason names the way forward for a conflict or a refused input
  // (automation_changed with live_version, automatisierungen-07 DC-3) — but only for
  // reviewed codes: a free service text can tell a foreign club's file from a missing
  // one (finance receipts, review R3). Refusals and unknown objects keep the catalog
  // sentence: a 404 says nothing about existence.
  const detail = connectorError?.detail
    && (connectorError.code === "CONFLICT" || connectorError.code === "VALIDATION_FAILED")
    && PUBLIC_DETAIL_CODES.has(connectorError.detail.split(/[\s(]/u)[0] ?? "")
    ? connectorError.detail
    : null;
  // Assistants read the article through the public help tool (05-ki-zugang).
  const assistantHint = `Hilfe: comvenio_hilfe mit operation "fehler" und code "${rendered.code}".`;
  const reason = detail ? `\nGrund: ${detail}` : "";
  const content = [{ type: "text" as const, text: `${formatPublicError(rendered)}${reason}\n${assistantHint}` }];
  if (connectorError?.code === "SCOPE_REQUIRED" && requiredScopes.length > 0) {
    return insufficientScopeToolResult({
      public_origin: publicOrigin,
      required_scopes: requiredScopes,
      context,
    });
  }
  return {
    content,
    structuredContent: {
      error: connectorError?.code.toLowerCase() ?? "upstream_unavailable",
      ...(connectorError?.required_scope ? { required_scope: connectorError.required_scope } : {}),
      ...publicFields,
      ...(detail ? { detail } : {}),
    },
    _meta: { request_id: context.request_id },
    isError: true,
  };
}
