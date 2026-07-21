import {
  createConnectorError,
  isConnectorError,
  type ConnectorError,
  type UUID,
} from "@comvenio/connector-contracts";

export type HttpErrorResponse = {
  status: number;
  connector_error: ConnectorError;
};

export function runtimeError(
  input: Omit<ConnectorError, "request_id"> & { request_id: UUID },
): Error & ConnectorError {
  return createConnectorError(input);
}

export function toHttpError(error: unknown, requestId: UUID): HttpErrorResponse {
  if (isConnectorError(error)) {
    const status = error.code === "AUTH_REQUIRED" ? 401
      : error.code === "SCOPE_REQUIRED" || error.code === "PERMISSION_DENIED"
        || error.code === "TENANT_MISMATCH" ? 403
        : error.code === "RATE_LIMITED" ? 429
          : error.code === "AUTH_TEMPORARILY_UNAVAILABLE"
            || error.code === "UPSTREAM_UNAVAILABLE" ? 503
            : error.code === "UPSTREAM_TIMEOUT" ? 504
              : 400;
    return { status, connector_error: error };
  }
  return {
    status: 500,
    connector_error: {
      code: "UPSTREAM_UNAVAILABLE",
      message: "Die Anfrage konnte nicht verarbeitet werden.",
      request_id: requestId,
      retryable: true,
    },
  };
}

export function jsonRpcErrorBody(error: ConnectorError): Record<string, unknown> {
  const code = error.code === "AUTH_REQUIRED" ? -32001
    : error.code === "TENANT_MISMATCH" || error.code === "PERMISSION_DENIED" ? -32003
      : error.code === "VALIDATION_FAILED" || error.code === "CONFIG_INVALID" ? -32602
        : -32603;
  return {
    jsonrpc: "2.0",
    error: {
      code,
      message: error.message,
      data: {
        code: error.code,
        request_id: error.request_id,
        retryable: error.retryable,
      },
    },
    id: null,
  };
}
