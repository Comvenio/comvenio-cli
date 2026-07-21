import type { McpBinding, ToolDefinition } from "@comvenio/tool-catalog";

import {
  ANTHROPIC_WIDGET_RESOURCE_URIS,
  type AnthropicAdapterInput,
  type AnthropicToolDescriptor,
  type AnthropicWidgetResourceUri,
} from "./types.ts";

function widgetUri(tool: ToolDefinition, bindings: readonly McpBinding[]): AnthropicWidgetResourceUri | null {
  const uris = [...new Set(bindings
    .filter((binding) => binding.tool_name === tool.tool_name)
    .map((binding) => binding.widget_resource_uri)
    .filter((value): value is string => value !== null))];
  if (uris.length > 1) throw new Error(`${tool.tool_name}: Eine Toolgruppe darf nicht mehrere Widget-Ressourcen referenzieren.`);
  const uri = uris[0];
  if (!uri) return null;
  if (!(ANTHROPIC_WIDGET_RESOURCE_URIS as readonly string[]).includes(uri)) throw new Error(`${tool.tool_name}: Unbekannte Widget-Ressource ${uri}.`);
  return uri as AnthropicWidgetResourceUri;
}

export class AnthropicConnectorAdapter {
  adapt(input: AnthropicAdapterInput): AnthropicToolDescriptor[] {
    return [...input.catalog.tools].sort((left, right) => left.tool_name.localeCompare(right.tool_name)).map((tool) => {
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
        requiredScopes: [...tool.required_scopes].sort(),
        annotations: structuredClone(tool.annotations),
        ...(resourceUri ? { _meta: { ui: { resourceUri } } } : {}),
      };
    });
  }

  validate(input: AnthropicAdapterInput): { valid: true; tool_count: number; tool_sync_version: string } {
    const descriptors = this.adapt(input);
    const descriptorsByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
    if (descriptors.length !== input.catalog.tools.length) throw new Error("Der Anthropic-Adapter darf keine Tools ergänzen oder entfernen.");
    for (const tool of input.catalog.tools) {
      const descriptor = descriptorsByName.get(tool.tool_name);
      if (!descriptor || descriptor.title !== tool.title || descriptor.description !== tool.description
        || JSON.stringify(descriptor.requiredScopes) !== JSON.stringify([...tool.required_scopes].sort())
        || JSON.stringify(descriptor.annotations) !== JSON.stringify(tool.annotations)) {
        throw new Error(`${tool.tool_name}: Der Anthropic-Adapter hat den gemeinsamen Toolvertrag verändert.`);
      }
    }
    return { valid: true, tool_count: descriptors.length, tool_sync_version: input.catalog.source_hash_sha256 };
  }
}
