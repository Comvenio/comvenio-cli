// Public error model: every customer-facing error carries a stable code, one
// sentence of cause and the next command. The texts live in exactly one file,
// docs/fehler/katalog.json, which the connector, the CLI and the documentation
// read. Internal connector codes stay unchanged and are mapped here.
import katalog from "../../../docs/fehler/katalog.json" with { type: "json" };

import type { ConnectorErrorCode } from "./index.ts";

export type PublicErrorLang = "de" | "en";

export interface PublicErrorText {
  message: string;
  cause: string;
}

export interface PublicErrorEntry {
  de: PublicErrorText;
  en: PublicErrorText;
  next_command: string | null;
  help: string;
}

export const PUBLIC_ERROR_CATALOG = katalog as Record<string, PublicErrorEntry>;

export type PublicErrorCode = keyof typeof katalog;

/** Wire shape of a rendered error; also the `--json` output of the CLI. */
export interface PublicError {
  code: PublicErrorCode;
  message: string;
  cause: string;
  next_command: string | null;
  help: string;
  request_id: string | null;
  lang: PublicErrorLang;
}

export function isPublicErrorCode(value: unknown): value is PublicErrorCode {
  return typeof value === "string" && Object.hasOwn(PUBLIC_ERROR_CATALOG, value);
}

/**
 * Maps an internal connector code to its public code.
 *
 * A request without an answer may still have been carried out upstream. For
 * an action with a writing effect that is OUTCOME_UNKNOWN ("check the state
 * instead of repeating"); a read stays an ordinary, repeatable timeout. The
 * effect comes from the action's risk class, never from the HTTP method — a
 * read preview may well be a POST. Without a known effect only the client's
 * own marker counts: it never retries a non-GET, so `retryable: false`.
 */
export function publicErrorCode(input: {
  code: ConnectorErrorCode | string;
  retryable?: boolean;
  effect?: "read" | "write";
}): PublicErrorCode {
  const unanswered = input.code === "UPSTREAM_TIMEOUT" || input.code === "UPSTREAM_UNAVAILABLE";
  // A write whose answer is missing or a server error may have run anyway.
  if (unanswered && input.effect === "write") return "OUTCOME_UNKNOWN";
  if (input.effect === undefined && input.code === "UPSTREAM_TIMEOUT" && input.retryable === false) {
    return "OUTCOME_UNKNOWN";
  }
  return isPublicErrorCode(input.code) ? input.code : "UNKNOWN_ERROR";
}

/** --lang wins, then LC_ALL/LANG of the environment, otherwise German. */
export function resolvePublicErrorLang(
  explicit: string | undefined,
  env: Record<string, string | undefined> = {},
): PublicErrorLang {
  for (const raw of [explicit, env.LC_ALL, env.LANG]) {
    if (!raw) continue;
    const lang = raw.trim().toLowerCase().slice(0, 2);
    if (lang === "en") return "en";
    if (lang === "de") return "de";
    if (raw === explicit) break;
  }
  return "de";
}

function fill(template: string, values: Record<string, string>): string | null {
  let missing = false;
  const filled = template.replace(/\{([a-z_]+)\}/gu, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === "") missing = true;
    return value ?? "";
  });
  return missing ? null : filled;
}

/**
 * Renders a catalog entry. A template whose placeholder cannot be filled is
 * dropped rather than shown half-empty: SCOPE_REQUIRED without known scopes
 * falls back to a plain login, which requests all scopes.
 */
export function renderPublicError(input: {
  code: PublicErrorCode;
  lang: PublicErrorLang;
  request_id?: string | null;
  required_scopes?: readonly string[];
  granted_scopes?: readonly string[];
}): PublicError {
  const entry = PUBLIC_ERROR_CATALOG[input.code] ?? PUBLIC_ERROR_CATALOG.UNKNOWN_ERROR!;
  const required = [...new Set(input.required_scopes ?? [])].sort();
  const login = [...new Set([...(input.granted_scopes ?? []), ...required])].sort();
  const values: Record<string, string> = {
    required_scopes: required.join(", "),
    login_scopes: login.join(","),
  };
  const text = entry[input.lang];
  const cause = fill(text.cause, values);
  const nextCommand = entry.next_command === null ? null : fill(entry.next_command, values);
  return {
    code: input.code,
    message: text.message,
    cause: cause ?? text.cause.replace(/\s*\{[a-z_]+\}/gu, ""),
    next_command: nextCommand
      ?? (input.code === "SCOPE_REQUIRED" ? "comvenio login" : entry.next_command),
    help: entry.help,
    request_id: input.request_id ?? null,
    lang: input.lang,
  };
}

/** Plain-text form shared by the CLI and the connector's text content. */
export function formatPublicError(error: PublicError): string {
  const reference = error.lang === "en" ? "Request ID" : "Anfrage-ID";
  const more = error.lang === "en" ? "More" : "Mehr";
  const label = error.lang === "en" ? "Error" : "Fehler";
  return [
    `${label} ${error.code}: ${error.message} ${error.cause}`,
    ...(error.next_command ? [`→ ${error.next_command}`] : []),
    `${more}: comvenio help fehler ${error.code}`,
    ...(error.request_id ? [`${reference}: ${error.request_id}`] : []),
  ].join("\n");
}
