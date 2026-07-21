import type { JsonSchemaDocument, ToolCatalogSnapshot } from "@comvenio/tool-catalog";

import { OpenAiConnectorAdapter } from "./adapter.ts";
import { buildChatGptAppManifest } from "./profile.ts";
import { runOpenAiSubmissionPreflight } from "./preflight.ts";
import { buildOpenAiReviewerRunbook } from "./runbook.ts";
import { buildOpenAiToolTestPlan } from "./test-plan.ts";
import type { MarketplaceSubmissionBundle, OpenAiSubmissionEvidence } from "./types.ts";

export function buildMarketplaceSubmissionBundle(input: {
  artifact_root: string;
  catalog: ToolCatalogSnapshot;
  schemas: ReadonlyMap<string, JsonSchemaDocument>;
  evidence: OpenAiSubmissionEvidence;
}): MarketplaceSubmissionBundle {
  const adapter = new OpenAiConnectorAdapter();
  adapter.validate({ catalog: input.catalog, schemas: input.schemas });
  const tools = adapter.adapt({ catalog: input.catalog, schemas: input.schemas });
  const manifest = buildChatGptAppManifest(input.catalog.source_hash_sha256);
  const toolTestPlan = buildOpenAiToolTestPlan(input.catalog);
  const reviewerRunbook = buildOpenAiReviewerRunbook();
  const preflight = runOpenAiSubmissionPreflight({ artifact_root: input.artifact_root, manifest, tools, tool_test_plan: toolTestPlan, evidence: input.evidence });
  return { schema_version: "1.0.0", provider: "openai", manifest, tools, tool_test_plan: toolTestPlan, reviewer_runbook: reviewerRunbook, preflight };
}
