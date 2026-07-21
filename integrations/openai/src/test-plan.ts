import type { ToolCatalogSnapshot } from "@comvenio/tool-catalog";

import { OPENAI_TOOL_TEST_PLAN_SCHEMA } from "./schemas.ts";
import type { OpenAiToolTestPlan } from "./types.ts";

export function buildOpenAiToolTestPlan(catalog: ToolCatalogSnapshot): OpenAiToolTestPlan {
  return OPENAI_TOOL_TEST_PLAN_SCHEMA.parse({
    schema_version: "1.0.0",
    catalog_source_hash_sha256: catalog.source_hash_sha256,
    coverage: "every_published_tool",
    cases: [...catalog.tools].sort((a, b) => a.tool_name.localeCompare(b.tool_name)).map((tool) => ({
      tool_name: tool.tool_name,
      prompt: `Prüfe „${tool.title}“ mit synthetischen Daten im ausgewählten Testverein.`,
      expected_response_fixture: `fixtures/provider/openai/${tool.tool_name}.response.json`,
      required_surfaces: ["web", "mobile"],
      verifies: ["schema", "security_schemes", "annotations", "rbac_recheck"],
    })),
  });
}
