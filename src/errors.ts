// Customer-facing error output of the CLI. Every failure is shown as
// "Fehler <CODE>: <message> <cause>", the next command and the help pointer;
// --json prints the same as one object. Texts come from docs/fehler/katalog.json.
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

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

import { AuthError, LoginOptionError } from "./auth.ts";
import { ConnectorClientError } from "./mcp/client.ts";

/**
 * An error the CLI raises itself with a known public code. `detail` is the
 * CLI's own sentence shown under the catalog sentence; `required_scopes`
 * feeds the login command of SCOPE_REQUIRED.
 */
export class PublicCliError extends Error {
  readonly detail: string | undefined;
  readonly required_scopes: readonly string[];

  constructor(
    readonly code: PublicErrorCode,
    message: string,
    options: { detail?: string; required_scopes?: readonly string[] } = {},
  ) {
    super(message);
    this.name = "PublicCliError";
    this.detail = options.detail;
    this.required_scopes = options.required_scopes ?? [];
  }
}

export type CliPublicError = PublicError & {
  /**
   * The CLI's own sentence for this case where it adds something to the
   * catalog sentence (usage and sign-in errors, tool detail). Cleaned of the
   * home directory and URLs; never set for unexpected errors.
   */
  detail?: string;
};

/** Removes what the customer should not see in a detail line: home path, URLs, service names. */
export function cleanDetail(text: string, home: string = homedir()): string {
  let cleaned = text.replace(/https?:\/\/\S+/gu, "<URL>");
  // Internal service names ("content-service") are not the customer's business.
  cleaned = cleaned.replace(/\b(?:vom |von |im |der |dem )?[a-z][a-z0-9]*(?:-[a-z0-9]+)*-service\b/gu, "von Comvenio");
  if (home && home !== "/") cleaned = cleaned.split(home).join("~");
  return cleaned.trim();
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const INPUT_VALIDATION_MARKER = "Input validation error";

export function isInputValidationText(text: string): boolean {
  return text.includes(INPUT_VALIDATION_MARKER);
}

/**
 * Names the rejected fields of an MCP input validation error, e.g.
 * "input.operation: Invalid input". The SDK appends the zod issues as JSON;
 * if they cannot be read, the sentence after the marker stays.
 */
export function inputValidationDetail(text: string): string {
  const start = text.indexOf("[", text.indexOf(INPUT_VALIDATION_MARKER));
  if (start >= 0) {
    try {
      const issues = JSON.parse(text.slice(start)) as unknown;
      if (Array.isArray(issues)) {
        const lines = issues
          .map(object)
          .filter((issue): issue is Record<string, unknown> => issue !== null)
          .map((issue) => {
            const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
            const message = typeof issue.message === "string" ? issue.message : "ungültig";
            return path ? `${path}: ${message}` : message;
          });
        if (lines.length > 0) return lines.join("\n");
      }
    } catch {
      // Fall through to the plain sentence.
    }
  }
  const sentence = text.slice(text.indexOf(INPUT_VALIDATION_MARKER) + INPUT_VALIDATION_MARKER.length);
  return sentence.replace(/^[:\s]+/u, "").split("\n")[0]!.trim() || INPUT_VALIDATION_MARKER;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
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
  options: { lang: PublicErrorLang; granted_scopes?: readonly string[]; machine_grant?: boolean },
): CliPublicError {
  let code: PublicErrorCode = "UNKNOWN_ERROR";
  let requestId: string | null = null;
  let requiredScopes: string[] = [];
  let detail: string | undefined;

  if (error instanceof PublicCliError) {
    code = error.code;
    requiredScopes = [...error.required_scopes];
    detail = error.detail;
  } else if (error instanceof ConnectorClientError && !object(error.details) && isInputValidationText(error.message)) {
    // The MCP SDK checks the tool input before any handler runs and answers with
    // text only; without this the customer saw UNKNOWN_ERROR and not the field (K16).
    code = "VALIDATION_FAILED";
    detail = inputValidationDetail(error.message);
  } else if (error instanceof ConnectorClientError) {
    const data = object(error.details);
    requestId = typeof data?.request_id === "string" ? data.request_id : null;
    requiredScopes = strings(data?.required_scopes);
    if (requiredScopes.length === 0 && typeof data?.required_scope === "string") {
      requiredScopes = [data.required_scope];
    }
    if (typeof data?.error === "string" && isPublicErrorCode(data.code)) {
      // Current connector answer: `code` is already the public code.
      code = data.code;
      if (typeof data.detail === "string") detail = data.detail;
    } else {
      // Older tool answers carry only `error`; JSON-RPC errors only the internal `code`.
      const internal = typeof data?.error === "string"
        ? data.error.toUpperCase()
        : typeof data?.code === "string" ? data.code : "";
      code = internal === "INSUFFICIENT_SCOPE"
        ? "SCOPE_REQUIRED"
        : publicErrorCode({
          code: internal,
          ...(typeof data?.retryable === "boolean" ? { retryable: data.retryable } : {}),
        });
    }
  } else if (error instanceof LoginOptionError) {
    code = "USAGE_ERROR";
    detail = error.message;
  } else if (error instanceof AuthError) {
    code = "AUTH_REQUIRED";
    detail = error.message;
  } else if (error instanceof Error && error.name === "Error") {
    // Plain errors are argument and input checks of the command modules.
    code = "USAGE_ERROR";
    detail = error.message;
  }

  // An unexpected error has no server request; a local ID ties the report to
  // the run (COMVENIO_DEBUG=1 prints the stack next to it).
  if (code === "UNKNOWN_ERROR" && requestId === null) requestId = randomUUID();

  const rendered = renderPublicError({
    code,
    lang: options.lang,
    request_id: requestId,
    required_scopes: requiredScopes,
    granted_scopes: options.granted_scopes ?? [],
  });
  // A machine grant cannot sign in again with more scopes; a new grant carries them.
  if (code === "SCOPE_REQUIRED" && options.machine_grant) {
    const missing = requiredScopes.join(", ");
    return {
      ...rendered,
      next_command: null,
      detail: options.lang === "en"
        ? `This machine grant lacks ${missing || "the required scope"}. Create a new grant with it in club settings › Automation.`
        : `Diesem Maschinen-Grant fehlt ${missing || "der nötige Scope"}. Lege in den Vereinseinstellungen › Automation einen neuen Grant damit an.`,
    };
  }
  const cleaned = detail ? cleanDetail(detail) : "";
  // A machine grant cannot run `comvenio login`: the way out is the grant in the club
  // settings (the detail line says so), never a browser sign-in.
  const result = code === "AUTH_REQUIRED" && options.machine_grant ? { ...rendered, next_command: null } : rendered;
  return cleaned ? { ...result, detail: cleaned } : result;
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
  return 1;
}

export function resolveCliLang(argv: readonly string[], env: Record<string, string | undefined>): PublicErrorLang {
  return resolvePublicErrorLang(langArgument(argv), env);
}
