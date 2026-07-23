import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListToolsRequestSchema,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

export type ToolSecurityScheme =
  | { type: "noauth" }
  | { type: "oauth2"; scopes: string[] };

type RawRequestHandler = (
  request: unknown,
  extra: unknown,
) => Promise<unknown> | unknown;

interface ToolListHandlerRegistry {
  _requestHandlers: Map<string, RawRequestHandler>;
}

interface ToolListResult {
  tools: Array<{
    name: string;
    _meta?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

function isToolListResult(value: unknown): value is ToolListResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const tools = (value as { tools?: unknown }).tools;
  return Array.isArray(tools)
    && tools.every((tool) =>
      tool !== null
      && typeof tool === "object"
      && !Array.isArray(tool)
      && typeof (tool as { name?: unknown }).name === "string");
}

/**
 * SDK 1.29 keeps unknown registration fields but does not project the Apps SDK
 * `securitySchemes` extension into `tools/list`. Keep this adapter isolated and
 * fail closed if the pinned SDK changes its handler registry.
 */
export function installToolSecuritySchemeProjection(
  server: McpServer,
  securitySchemesByTool: ReadonlyMap<string, readonly ToolSecurityScheme[]>,
): void {
  const registry = server.server as unknown as ToolListHandlerRegistry;
  const originalHandler = registry._requestHandlers.get("tools/list");
  if (!originalHandler) {
    throw new Error("Der MCP-SDK-Handler für tools/list ist nicht initialisiert.");
  }

  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await originalHandler(request, extra);
    if (!isToolListResult(result)) {
      throw new Error("Der MCP-SDK-Handler hat keine gültige Tool-Liste geliefert.");
    }

    return {
      ...result,
      tools: result.tools.map((tool) => {
        const configured = securitySchemesByTool.get(tool.name);
        if (!configured) return tool;
        const securitySchemes = structuredClone(configured);
        return {
          ...tool,
          securitySchemes,
          _meta: {
            ...(tool._meta ?? {}),
            securitySchemes: structuredClone(securitySchemes),
          },
        };
      }),
    } as unknown as ListToolsResult;
  });
}
