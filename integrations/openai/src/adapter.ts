import type { McpBinding, ToolDefinition } from "@comvenio/tool-catalog";

import { OPENAI_WIDGET_RESOURCE_URIS, type OpenAiAdapterInput, type OpenAiSecurityScheme, type OpenAiToolDescriptor, type OpenAiWidgetResourceUri } from "./types.ts";

function securitySchemes(tool: ToolDefinition): OpenAiSecurityScheme[] {
  const publicTool = tool.required_scopes.length > 0
    && tool.required_scopes.every((scope) => scope === "public.read")
    && tool.permission_policy.backend_audit_refs.some((reference) => /public/iu.test(reference));
  return publicTool ? [{ type: "noauth" }] : [{ type: "oauth2", scopes: [...tool.required_scopes].sort() }];
}

function widgetUri(tool: ToolDefinition, bindings: readonly McpBinding[]): OpenAiWidgetResourceUri | null {
  const uris = [...new Set(bindings.filter((binding) => binding.tool_name === tool.tool_name).map((binding) => binding.widget_resource_uri).filter((value): value is string => value !== null))];
  if (uris.length > 1) throw new Error(`${tool.tool_name}: Eine Toolgruppe darf nicht mehrere Widget-Ressourcen referenzieren.`);
  const uri = uris[0];
  if (!uri) return null;
  if (!(OPENAI_WIDGET_RESOURCE_URIS as readonly string[]).includes(uri)) throw new Error(`${tool.tool_name}: Unbekannte Widget-Ressource ${uri}.`);
  return uri as OpenAiWidgetResourceUri;
}

export class OpenAiConnectorAdapter {
  adapt(input: OpenAiAdapterInput): OpenAiToolDescriptor[] {
    return [...input.catalog.tools].sort((a, b) => a.tool_name.localeCompare(b.tool_name)).map((tool) => {
      const inputSchema = input.schemas.get(tool.input_schema_ref);
      const outputSchema = input.schemas.get(tool.output_schema_ref);
      if (!inputSchema || !outputSchema) throw new Error(`${tool.tool_name}: Input- oder Output-Schema fehlt.`);
      const resourceUri = widgetUri(tool, input.catalog.mcp_bindings);
      return {
        name: tool.tool_name,
        title: tool.title,
        description: tool.description,
        inputSchema: structuredClone(inputSchema),
        outputSchema: structuredClone(outputSchema),
        securitySchemes: securitySchemes(tool),
        annotations: structuredClone(tool.annotations),
        ...(resourceUri ? { _meta: { ui: { resourceUri } } } : {}),
      };
    });
  }

  validate(input: OpenAiAdapterInput): { valid: true; tool_count: number; catalog_source_hash_sha256: string } {
    const descriptors = this.adapt(input);
    if (descriptors.length !== input.catalog.tools.length) throw new Error("Der OpenAI-Adapter darf keine Tools ergänzen oder entfernen.");
    const descriptorsByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
    input.catalog.tools.forEach((tool) => {
      const descriptor = descriptorsByName.get(tool.tool_name);
      if (!descriptor || descriptor.name !== tool.tool_name || descriptor.title !== tool.title || descriptor.description !== tool.description
        || JSON.stringify(descriptor.annotations) !== JSON.stringify(tool.annotations)) {
        throw new Error(`${tool.tool_name}: Der OpenAI-Adapter hat den gemeinsamen Toolvertrag verändert.`);
      }
    });
    return { valid: true, tool_count: descriptors.length, catalog_source_hash_sha256: input.catalog.source_hash_sha256 };
  }
}
