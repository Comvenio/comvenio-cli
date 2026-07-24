import { createHash, randomUUID } from "node:crypto";

type JsonObject = Record<string, unknown>;

type JsonRpcResponse = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    data?: unknown;
  };
};

export type ConnectorTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  _meta?: Record<string, unknown>;
};

export function connectorToolActionId(tool: ConnectorTool): string | null {
  const actionId = tool._meta?.["comvenio/actionId"];
  return typeof actionId === "string"
    && /^cai\.[a-z0-9][a-z0-9._-]{2,180}$/u.test(actionId)
    ? actionId
    : null;
}

export class ConnectorClientError extends Error {
  constructor(
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "ConnectorClientError";
  }
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

export function connectorActionToolName(actionId: string): string {
  if (!/^cai\.[a-z0-9][a-z0-9._-]{2,180}$/u.test(actionId)) {
    throw new ConnectorClientError("Die Action-ID ist ungültig.");
  }
  const base = actionId.replace(/^cai\./u, "cv_").replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (base.length <= 64) return base;
  const hash = createHash("sha256").update(actionId).digest("hex").slice(0, 8);
  return `${base.slice(0, 55).replace(/_+$/u, "")}_${hash}`;
}

export class CliConnectorClient {
  readonly #endpoint: string;
  readonly #accessToken: string;
  readonly #fetch: typeof fetch;

  constructor(input: {
    endpoint: string;
    access_token: string;
    fetch?: typeof fetch;
  }) {
    const endpoint = new URL(input.endpoint);
    if (
      endpoint.protocol !== "https:"
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
      || endpoint.pathname !== "/cli"
    ) {
      throw new ConnectorClientError(
        "Der CLI-Connector muss eine kanonische HTTPS-/cli-Ressource sein.",
      );
    }
    if (!input.access_token || /[\s\r\n]/u.test(input.access_token)) {
      throw new ConnectorClientError("Der OAuth-Access-Token ist ungültig.");
    }
    this.#endpoint = endpoint.toString().replace(/\/$/u, "");
    this.#accessToken = input.access_token;
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async #request(method: string, params?: JsonObject): Promise<JsonObject> {
    const id = randomUUID();
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.#accessToken}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        ...(params ? { params } : {}),
      }),
    });
    const raw = await response.text();
    let payload: JsonRpcResponse;
    try {
      payload = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      throw new ConnectorClientError(
        `Der Connector hat keine gültige JSON-Antwort geliefert (HTTP ${response.status}).`,
      );
    }
    if (!response.ok || payload.error) {
      const message = typeof payload.error?.message === "string"
        ? payload.error.message
        : `Connector-Anfrage fehlgeschlagen (HTTP ${response.status}).`;
      throw new ConnectorClientError(message, payload.error?.data ?? payload);
    }
    if (payload.id !== id) {
      throw new ConnectorClientError("Die Connector-Antwort gehört zu einer anderen Anfrage.");
    }
    const result = object(payload.result);
    if (!result) {
      throw new ConnectorClientError("Die Connector-Antwort enthält kein gültiges Ergebnis.");
    }
    return result;
  }

  async listTools(): Promise<ConnectorTool[]> {
    const result = await this.#request("tools/list");
    if (!Array.isArray(result.tools)) {
      throw new ConnectorClientError("Die Connector-Toolliste ist ungültig.");
    }
    return result.tools.map((entry) => {
      const tool = object(entry);
      if (!tool || typeof tool.name !== "string") {
        throw new ConnectorClientError("Die Connector-Toolliste enthält einen ungültigen Eintrag.");
      }
      return tool as ConnectorTool;
    });
  }

  async callTool(name: string, arguments_: JsonObject): Promise<JsonObject> {
    if (!/^[a-z][a-z0-9_]{2,63}$/u.test(name)) {
      throw new ConnectorClientError("Der Connector-Toolname ist ungültig.");
    }
    const result = await this.#request("tools/call", {
      name,
      arguments: arguments_,
    });
    if (result.isError === true) {
      const structured = object(result.structuredContent);
      const content = Array.isArray(result.content) ? result.content : [];
      const firstText = content
        .map(object)
        .find((entry) => entry?.type === "text" && typeof entry.text === "string");
      throw new ConnectorClientError(
        typeof firstText?.text === "string"
          ? firstText.text
          : "Die Comvenio-Aktion wurde abgelehnt.",
        structured,
      );
    }
    const structured = object(result.structuredContent);
    if (!structured) {
      throw new ConnectorClientError("Die Comvenio-Antwort enthält kein strukturiertes Ergebnis.");
    }
    return structured;
  }

  callAction(input: {
    action_id: string;
    input: JsonObject;
    idempotency_key?: string;
  }): Promise<JsonObject> {
    return this.callTool(connectorActionToolName(input.action_id), {
      input: input.input,
      ...(input.idempotency_key
        ? { idempotency_key: input.idempotency_key }
        : {}),
    });
  }

  whoami(): Promise<JsonObject> {
    return this.callTool("cv_whoami_read", {});
  }

  confirm(input: {
    preview_id: string;
    confirmation_token: string;
    idempotency_key: string;
  }): Promise<JsonObject> {
    return this.callTool("action_confirm", input);
  }
}
