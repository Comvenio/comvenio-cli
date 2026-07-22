import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  CHAT_GPT_APP_MANIFEST_SCHEMA,
  OPENAI_TOOL_TEST_PLAN_SCHEMA,
} from "../integrations/openai/src/index.ts";
import { publishedRuntimeToolNames } from "../apps/mcp-server/src/runtime-tools.ts";

const root = resolve(import.meta.dir, "../integrations/openai");
const manifest = CHAT_GPT_APP_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(resolve(root, "submission/app-profile.json"), "utf8")));
const plan = OPENAI_TOOL_TEST_PLAN_SCHEMA.parse(JSON.parse(readFileSync(resolve(root, "submission/tool-test-plan.json"), "utf8")));
const runtimeTools = publishedRuntimeToolNames("production");
const runtimeVersion = createHash("sha256").update(runtimeTools.join("\n"), "utf8").digest("hex");

if (manifest.tool_catalog_version !== plan.catalog_source_hash_sha256) {
  throw new Error("OpenAI-Profil und Tool-Testplan referenzieren unterschiedliche Katalogversionen.");
}
if (manifest.tool_catalog_version !== runtimeVersion
  || JSON.stringify(plan.cases.map((item) => item.tool_name).sort()) !== JSON.stringify(runtimeTools)) {
  throw new Error("OpenAI-Submission und produktiv veröffentlichte Runtime-Tools weichen voneinander ab.");
}

const required = [
  manifest.assets.icon,
  manifest.assets.logo,
  ...manifest.screenshots.map((item) => item.path),
  ...plan.cases.map((item) => `./${item.expected_response_fixture}`),
  "./submission/reviewer-runbook.md",
];
for (const relativePath of required) {
  const path = resolve(root, relativePath.replace(/^\.\//u, ""));
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`OpenAI-Submission-Artefakt fehlt oder ist leer: ${relativePath}`);
  }
}

for (const forbidden of [".codex-plugin/plugin.json", ".mcp.json", ".app.json"]) {
  if (existsSync(resolve(root, forbidden))) throw new Error(`Codex-Artefakt ist im OpenAI-Paket nicht zulässig: ${forbidden}`);
}

console.log(`OpenAI-Submission-Artefakte gültig: ${plan.cases.length} Tool-Kandidaten, ${manifest.screenshots.length} Widgets.`);
