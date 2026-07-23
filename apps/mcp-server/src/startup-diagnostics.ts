export type McpStartupFailureReason =
  | "invalid_runtime_configuration"
  | "shared_state_unavailable"
  | "listener_unavailable"
  | "unknown_startup_failure";

export interface McpStartupFailureRecord {
  event: "comvenio_mcp_start_failed";
  reason: McpStartupFailureReason;
  configuration_field?: string;
  error_code?: string;
}

const CONFIGURATION_FIELDS = Object.freeze([
  "AUTH_SERVICE_BASE_URL",
  "COMVENIO_API_BASE_URL",
  "COMVENIO_MCP_ENV",
  "INTERNAL_API_KEY",
  "MCP_CIMD_CLIENT_PINS_JSON",
  "MCP_EDGE_SHARED_SECRET",
  "MCP_PUBLIC_ORIGIN",
  "MCP_RELEASE_SCOPE",
  "MCP_SHARED_STATE_ENCRYPTION_KEY",
  "MCP_SHARED_STATE_REDIS_URL",
  "PORT",
] as const);

const SAFE_NETWORK_ERROR_CODES = new Set([
  "EACCES",
  "EADDRINUSE",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "NOAUTH",
  "WRONGPASS",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" && SAFE_NETWORK_ERROR_CODES.has(candidate)
    ? candidate
    : undefined;
}

function configurationField(message: string): string | undefined {
  return CONFIGURATION_FIELDS.find((field) => message.includes(field));
}

export function mcpStartupFailureRecord(error: unknown): McpStartupFailureRecord {
  const message = errorMessage(error);
  const field = configurationField(message);
  if (field) {
    return {
      event: "comvenio_mcp_start_failed",
      reason: "invalid_runtime_configuration",
      configuration_field: field,
    };
  }

  const code = errorCode(error);
  if (
    message.includes("Redis")
    || message.includes("Zustandsspeicher")
    || ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "NOAUTH", "WRONGPASS"]
      .includes(code ?? "")
  ) {
    return {
      event: "comvenio_mcp_start_failed",
      reason: "shared_state_unavailable",
      ...(code ? { error_code: code } : {}),
    };
  }

  if (
    message.includes("listen")
    || message.includes("TCP")
    || ["EACCES", "EADDRINUSE"].includes(code ?? "")
  ) {
    return {
      event: "comvenio_mcp_start_failed",
      reason: "listener_unavailable",
      ...(code ? { error_code: code } : {}),
    };
  }

  return {
    event: "comvenio_mcp_start_failed",
    reason: "unknown_startup_failure",
  };
}
