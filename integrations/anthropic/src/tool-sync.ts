import type { ToolCatalogSnapshot } from "@comvenio/tool-catalog";

import { CLAUDE_TOOL_SYNC_PLAN_SCHEMA } from "./schemas.ts";
import type { AnthropicToolDescriptor, ClaudeToolDrift, ClaudeToolSyncPlan, ClaudeToolSyncReport } from "./types.ts";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function changedFields(expected: AnthropicToolDescriptor, observed: AnthropicToolDescriptor): string[] {
  return (["title", "description", "inputSchema", "outputSchema", "requiredScopes", "annotations", "_meta"] as const)
    .filter((field) => stable(expected[field]) !== stable(observed[field]));
}

export class ClaudeToolSyncSuite {
  buildPlan(catalog: ToolCatalogSnapshot): ClaudeToolSyncPlan {
    return CLAUDE_TOOL_SYNC_PLAN_SCHEMA.parse({
      schema_version: "1.0.0",
      tool_sync_version: catalog.source_hash_sha256,
      coverage: "every_published_tool",
      cases: [...catalog.tools].sort((left, right) => left.tool_name.localeCompare(right.tool_name)).map((tool) => ({
        tool_name: tool.tool_name,
        happy_path_prompt: `Führe „${tool.title}“ mit gültigen synthetischen Daten im ausgewählten Testverein aus.`,
        permission_denied_prompt: `Prüfe „${tool.title}“ mit einem synthetischen Konto ohne die erforderliche Berechtigung.`,
        expected_response_fixture: `fixtures/provider/anthropic/${tool.tool_name}.response.json`,
        required_clients: ["mcp_inspector", "claude_custom_connector"],
        required_surfaces: ["web", "desktop", "mobile"],
      })),
    });
  }

  compare(input: { tool_sync_version: string; expected: AnthropicToolDescriptor[]; observed: AnthropicToolDescriptor[] }): ClaudeToolSyncReport {
    const expectedByName = new Map(input.expected.map((tool) => [tool.name, tool]));
    const observedByName = new Map(input.observed.map((tool) => [tool.name, tool]));
    if (expectedByName.size !== input.expected.length || observedByName.size !== input.observed.length) throw new Error("Tool-Sync enthält doppelte Toolnamen.");
    const missingTools = [...expectedByName.keys()].filter((name) => !observedByName.has(name)).sort();
    const extraTools = [...observedByName.keys()].filter((name) => !expectedByName.has(name)).sort();
    const drift: ClaudeToolDrift[] = [...expectedByName.entries()].flatMap(([name, expected]) => {
      const observed = observedByName.get(name);
      if (!observed) return [];
      const fields = changedFields(expected, observed);
      return fields.length > 0 ? [{ tool_name: name, changed_fields: fields }] : [];
    }).sort((left, right) => left.tool_name.localeCompare(right.tool_name));
    return {
      schema_version: "1.0.0",
      provider: "anthropic",
      tool_sync_version: input.tool_sync_version,
      status: input.expected.length > 0 && missingTools.length === 0 && extraTools.length === 0 && drift.length === 0 ? "pass" : "blocked",
      expected_tool_count: input.expected.length,
      observed_tool_count: input.observed.length,
      missing_tools: missingTools,
      extra_tools: extraTools,
      drift,
    };
  }
}
