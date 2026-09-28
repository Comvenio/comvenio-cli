// Customer-facing error output of the CLI. Every failure is shown as
// "Fehler <CODE>: <message> <cause>", the next command and the help pointer;
// --json prints the same as one object. Texts come from docs/fehler/katalog.json.
import {
  formatPublicError,
  isPublicErrorCode,
  publicErrorCode,
  renderPublicError,
  resolvePublicErrorLang,
  type PublicError,
  type PublicErrorCode,
  type PublicErrorLang,
} from "@comvenio/connector-contracts";

import { AuthError } from "./auth.ts";
import { HttpError, OAuthOnlyError } from "./http.ts";
import { ConnectorClientError } from "./mcp/client.ts";

/** An error the CLI raises itself with a known public code. */
export class PublicCliError extends Error {
  constructor(
    readonly code: PublicErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PublicCliError";
  }
}

export type CliPublicError = PublicError & {
  /** The original text where it adds something to the catalog sentence. */
  detail?: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function httpCode(status: number): PublicErrorCode {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 422) return "VALIDATION_FAILED";
  return "UPSTREAM_UNAVAILABLE";
}

/** Reads the value of --lang from the raw arguments (also --lang=en). */
export function langArgument(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--lang") return argv[index + 1];
    if (argument.startsWith("--lang=")) return argument.slice("--lang=".length);
  }
  return undefined;
}

export function toPublicError(
  error: unknown,
  options: { lang: PublicErrorLang; granted_scopes?: readonly string[]; command?: string | null },
): CliPublicError {
  let code: PublicErrorCode = "UNKNOWN_ERROR";
  let requestId: string | null = null;
  let requiredScopes: string[] = [];
  let detail: string | undefined;

  if (error instanceof PublicCliError) {
    code = error.code;
  } else if (error instanceof ConnectorClientError) {
    const data = object(error.details);
    requestId = typeof data?.request_id === "string" ? data.request_id : null;
    requiredScopes = strings(data?.required_scopes);
    if (requiredScopes.length === 0 && typeof data?.required_scope === "string") {
      requiredScopes = [data.required_scope];
    }
    if (isPublicErrorCode(data?.code)) {
      code = data.code;
    } else {
      // Older connector answers and JSON-RPC errors carry only the internal code.
      const internal = typeof data?.error === "string"
        ? data.error.toUpperCase()
        : typeof data?.code === "string" ? data.code : "";
      code = internal === "INSUFFICIENT_SCOPE"
        ? "SCOPE_REQUIRED"
        : publicErrorCode({
          code: internal,
          ...(typeof data?.retryable === "boolean" ? { retryable: data.retryable } : {}),
        });
      if (code === "UNKNOWN_ERROR") detail = error.message;
    }
  } else if (error instanceof OAuthOnlyError) {
    code = "OAUTH_ONLY";
  } else if (error instanceof AuthError) {
    // During login an AuthError is a wrong option, not an expired sign-in.
    code = options.command === "login" ? "USAGE_ERROR" : "AUTH_REQUIRED";
    detail = error.message;
  } else if (error instanceof HttpError) {
    code = httpCode(error.status);
    // The URL and body can name internal services; only the status is shown.
    detail = `HTTP ${error.status}`;
  } else if (error instanceof Error && error.name === "Error") {
    // Plain errors are argument and input checks of the command modules.
    code = "USAGE_ERROR";
    detail = error.message;
  } else {
    detail = error instanceof Error ? error.message : String(error);
  }

  const rendered = renderPublicError({
    code,
    lang: options.lang,
    request_id: requestId,
    required_scopes: requiredScopes,
    granted_scopes: options.granted_scopes ?? [],
  });
  return detail ? { ...rendered, detail } : rendered;
}

export function formatCliError(error: CliPublicError): string {
  const text = formatPublicError(error);
  if (!error.detail) return text;
  const [first, ...rest] = text.split("\n");
  const detail = error.detail.split("\n").map((line) => `  ${line}`);
  return [first, ...detail, ...rest].join("\n");
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof AuthError) return 2;
  if (error instanceof HttpError) return 3;
  return 1;
}

export function resolveCliLang(argv: readonly string[], env: Record<string, string | undefined>): PublicErrorLang {
  return resolvePublicErrorLang(langArgument(argv), env);
}
