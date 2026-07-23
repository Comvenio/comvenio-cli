import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import {
  CHAT_GPT_APP_MANIFEST_SCHEMA,
  OPENAI_TOOL_TEST_PLAN_SCHEMA,
  buildChatGptAppManifest,
} from "../integrations/openai/src/index.ts";
import {
  RELEASE_GATE_REPORT_SCHEMA,
} from "../integrations/release/src/index.ts";
import {
  publishedRuntimeCatalog,
} from "../apps/mcp-server/src/runtime-tools.ts";

const workspaceRoot = resolve(import.meta.dir, "..");
const root = resolve(workspaceRoot, "integrations/openai");
const manifest = CHAT_GPT_APP_MANIFEST_SCHEMA.parse(JSON.parse(
  readFileSync(resolve(root, "submission/app-profile.json"), "utf8"),
));
const plan = OPENAI_TOOL_TEST_PLAN_SCHEMA.parse(JSON.parse(
  readFileSync(resolve(root, "submission/tool-test-plan.json"), "utf8"),
));
const releaseGate = RELEASE_GATE_REPORT_SCHEMA.parse(JSON.parse(
  readFileSync(
    resolve(
      workspaceRoot,
      "integrations/release/release-gate-report.json",
    ),
    "utf8",
  ),
));
const runtimeCatalog = publishedRuntimeCatalog(
  "production",
  releaseGate.evidence.release_scope,
);

if (
  JSON.stringify(manifest)
  !== JSON.stringify(
    buildChatGptAppManifest(runtimeCatalog.tool_catalog_sha256),
  )
) {
  throw new Error(
    "Statisches OpenAI-Profil weicht vom generierten Profil ab.",
  );
}
if (
  manifest.tool_catalog_version !== runtimeCatalog.tool_catalog_sha256
  || plan.catalog_source_hash_sha256
    !== runtimeCatalog.tool_catalog_sha256
  || JSON.stringify(
    plan.cases.map((item) => item.tool_name).sort(),
  ) !== JSON.stringify(runtimeCatalog.tool_names)
) {
  throw new Error(
    "OpenAI-Submission und produktive Runtime-Tools weichen voneinander ab.",
  );
}
if (
  JSON.stringify([...manifest.widget_resource_uris].sort())
  !== JSON.stringify(runtimeCatalog.widget_resource_uris)
) {
  throw new Error(
    "OpenAI-Submission und produktive Widget-Ressourcen weichen voneinander ab.",
  );
}

const matrixPaths = [...new Set(
  plan.cases.map((item) => item.expected_response_fixture),
)];
if (matrixPaths.length !== 1) {
  throw new Error(
    "Der Full-Scope benötigt genau eine kanonische OpenAI-Antwortmatrix.",
  );
}
const matrix = z.object({
  schema_version: z.literal("1.0.0"),
  entity: z.literal("ProviderResponseContractMatrix"),
  release_scope: z.literal(releaseGate.evidence.release_scope),
  runtime_tool_catalog_sha256:
    z.literal(runtimeCatalog.tool_catalog_sha256),
  synthetic_data_only: z.literal(true),
  provider: z.literal("openai"),
  cases: z.array(z.object({
    tool_name: z.string(),
  }).passthrough()),
}).passthrough().parse(JSON.parse(
  readFileSync(resolve(root, matrixPaths[0]!), "utf8"),
));
if (
  JSON.stringify(matrix.cases.map((item) => item.tool_name).sort())
  !== JSON.stringify(runtimeCatalog.tool_names)
) {
  throw new Error(
    "Die OpenAI-Antwortmatrix deckt nicht exakt den Runtime-Katalog ab.",
  );
}

const required = new Set([
  manifest.assets.icon,
  manifest.assets.logo,
  ...manifest.screenshots.map((item) => item.path),
  ...matrixPaths.map((item) => `./${item}`),
  "./submission/reviewer-runbook.md",
]);
for (const relativePath of required) {
  const path = resolve(root, relativePath.replace(/^\.\//u, ""));
  if (
    !existsSync(path)
    || !statSync(path).isFile()
    || statSync(path).size === 0
  ) {
    throw new Error(
      `OpenAI-Submission-Artefakt fehlt oder ist leer: ${relativePath}`,
    );
  }
}

for (const forbidden of [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  ".app.json",
]) {
  if (existsSync(resolve(root, forbidden))) {
    throw new Error(
      `Codex-Artefakt ist im OpenAI-Paket nicht zulässig: ${forbidden}`,
    );
  }
}

console.log(
  `OpenAI-Submission-Artefakte gültig: ${plan.cases.length} `
  + `Tool-Kandidaten, ${manifest.screenshots.length} Widgets.`,
);
