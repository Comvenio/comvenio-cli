import type { JsonSchemaDocument, ToolCatalogSnapshot } from "@comvenio/tool-catalog";

import { AnthropicConnectorAdapter } from "./adapter.ts";
import { runAnthropicSubmissionPreflight } from "./preflight.ts";
import { buildClaudeDirectoryManifest } from "./profile.ts";
import { buildClaudeReviewerRunbook } from "./runbook.ts";
import { ClaudeToolSyncSuite } from "./tool-sync.ts";
import type { AnthropicToolDescriptor, ClaudeSubmissionBundle, ClaudeSubmissionEvidence } from "./types.ts";

export function buildClaudeSubmissionBundle(input: {
  artifact_root: string;
  catalog: ToolCatalogSnapshot;
  schemas: ReadonlyMap<string, JsonSchemaDocument>;
  observed_tools: AnthropicToolDescriptor[];
  evidence: Omit<ClaudeSubmissionEvidence, "tool_sync_report">;
}): ClaudeSubmissionBundle {
  const adapter = new AnthropicConnectorAdapter();
  adapter.validate({ catalog: input.catalog, schemas: input.schemas });
  const tools = adapter.adapt({ catalog: input.catalog, schemas: input.schemas });
  const syncSuite = new ClaudeToolSyncSuite();
  const toolSyncPlan = syncSuite.buildPlan(input.catalog);
  const toolSyncReport = syncSuite.compare({ tool_sync_version: input.catalog.source_hash_sha256, expected: tools, observed: input.observed_tools });
  const manifest = buildClaudeDirectoryManifest(input.catalog.source_hash_sha256);
  const reviewerRunbook = buildClaudeReviewerRunbook();
  const evidence: ClaudeSubmissionEvidence = { ...input.evidence, tool_sync_report: toolSyncReport };
  const preflight = runAnthropicSubmissionPreflight({ artifact_root: input.artifact_root, manifest, tools, tool_sync_plan: toolSyncPlan, evidence });
  return {
    schema_version: "1.0.0",
    provider: "anthropic",
    manifest,
    tools,
    tool_sync_plan: toolSyncPlan,
    tool_sync_report: toolSyncReport,
    reviewer_runbook: reviewerRunbook,
    preflight,
  };
}
