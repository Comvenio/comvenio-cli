import {
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  parseConnectorReleaseScope,
} from "@comvenio/connector-contracts";
import { z } from "zod";

import {
  buildClaudeDirectoryManifest,
  buildClaudeRuntimeToolSyncPlan,
} from "../integrations/anthropic/src/index.ts";
import {
  buildChatGptAppManifest,
  buildOpenAiRuntimeToolTestPlan,
} from "../integrations/openai/src/index.ts";
import {
  publishedRuntimeCatalog,
} from "../apps/mcp-server/src/runtime-tools.ts";

const workspaceRoot = resolve(import.meta.dir, "..");
const checkMode = process.argv.includes("--check");
const releaseReportPath = resolve(
  workspaceRoot,
  "integrations/release/release-gate-report.json",
);

function stable(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sync(path: string, value: unknown): void {
  const expected = stable(value);
  if (checkMode) {
    if (readFileSync(path, "utf8") !== expected) {
      throw new Error(`Provider-Artefakt ist nicht scope-synchron: ${path}`);
    }
    return;
  }
  writeFileSync(path, expected, "utf8");
}

const release = z.object({
  evidence: z.object({
    release_scope: z.string(),
  }).passthrough(),
}).passthrough().parse(
  JSON.parse(readFileSync(releaseReportPath, "utf8")),
);
const releaseScope = parseConnectorReleaseScope(
  release.evidence.release_scope,
);
const catalog = publishedRuntimeCatalog("production", releaseScope);
const responseMatrix = {
  schema_version: "1.0.0",
  entity: "ProviderResponseContractMatrix",
  release_scope: releaseScope,
  runtime_tool_catalog_sha256: catalog.tool_catalog_sha256,
  synthetic_data_only: true,
  cases: catalog.tools.map((tool) => ({
    tool_name: tool.name,
    risk_class: tool.risk_class,
    required_scopes: tool.required_scopes,
    expected_outcome: tool.risk_class === "read"
      ? "grounded_success_or_actionable_denial"
      : tool.risk_class === "reversible_write"
        ? "idempotent_success_or_actionable_denial"
        : tool.risk_class === "agent_orchestration"
          ? "governed_agent_turn_or_actionable_denial"
        : "confirmation_required_or_actionable_denial",
    oauth_bound_club_context:
      !tool.required_scopes.includes("public.read"),
    backend_rbac_recheck_required:
      !tool.required_scopes.includes("public.read"),
    confirmation_contract: tool.risk_class === "critical_write",
    response_contract: {
      structured_content_required: true,
      safe_text_summary_required: true,
      provider_specific_payload_forbidden: true,
      secret_or_token_echo_forbidden: true,
      delegated_capability_confirmation:
        tool.risk_class === "agent_orchestration",
      provider_retry_contract:
        tool.risk_class === "agent_orchestration"
          ? "non_idempotent_conversation_domain_effects_guarded"
          : tool.risk_class === "read"
            ? "safe_repeat"
            : "idempotent_by_key",
    },
  })),
};

sync(
  resolve(
    workspaceRoot,
    "integrations/openai/submission/app-profile.json",
  ),
  buildChatGptAppManifest(catalog.tool_catalog_sha256),
);
sync(
  resolve(
    workspaceRoot,
    "integrations/openai/submission/tool-test-plan.json",
  ),
  buildOpenAiRuntimeToolTestPlan({
    catalog_hash_sha256: catalog.tool_catalog_sha256,
    tools: catalog.tools,
  }),
);
sync(
  resolve(
    workspaceRoot,
    "integrations/openai/fixtures/provider/openai/full-connector-v1.response.json",
  ),
  { ...responseMatrix, provider: "openai" },
);
sync(
  resolve(
    workspaceRoot,
    "integrations/anthropic/submission/connector-profile.json",
  ),
  buildClaudeDirectoryManifest(catalog.tool_catalog_sha256),
);
sync(
  resolve(
    workspaceRoot,
    "integrations/anthropic/submission/tool-test-plan.json",
  ),
  buildClaudeRuntimeToolSyncPlan({
    tool_sync_version: catalog.tool_catalog_sha256,
    tools: catalog.tools,
  }),
);
sync(
  resolve(
    workspaceRoot,
    "integrations/anthropic/fixtures/provider/anthropic/full-connector-v1.response.json",
  ),
  { ...responseMatrix, provider: "anthropic" },
);

console.log(
  `${checkMode ? "Geprüft" : "Synchronisiert"}: `
  + `${releaseScope}, ${catalog.tool_count} Tools, `
  + `${catalog.widget_contract_count} Widgets.`,
);
