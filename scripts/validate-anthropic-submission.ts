import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  CLAUDE_DIRECTORY_MANIFEST_SCHEMA,
  CLAUDE_TOOL_SYNC_PLAN_SCHEMA,
  buildClaudeDirectoryManifest,
} from "../integrations/anthropic/src/index.ts";
import { publishedRuntimeToolNames } from "../apps/mcp-server/src/runtime-tools.ts";

const root = resolve(import.meta.dir, "../integrations/anthropic");
const manifest = CLAUDE_DIRECTORY_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(resolve(root, "submission/connector-profile.json"), "utf8")));
const plan = CLAUDE_TOOL_SYNC_PLAN_SCHEMA.parse(JSON.parse(readFileSync(resolve(root, "submission/tool-test-plan.json"), "utf8")));
const runtimeTools = publishedRuntimeToolNames("production");
const runtimeVersion = createHash("sha256").update(runtimeTools.join("\n"), "utf8").digest("hex");

if (JSON.stringify(manifest) !== JSON.stringify(buildClaudeDirectoryManifest(manifest.tool_sync_version))) {
  throw new Error("Statisches Claude-Directory-Profil weicht vom generierten Profil ab.");
}
if (manifest.tool_sync_version !== plan.tool_sync_version) throw new Error("Claude-Profil und Tool-Testplan referenzieren unterschiedliche Sync-Versionen.");
if (manifest.tool_sync_version !== runtimeVersion
  || JSON.stringify(plan.cases.map((item) => item.tool_name).sort()) !== JSON.stringify(runtimeTools)) {
  throw new Error("Claude-Submission und produktiv veröffentlichte Runtime-Tools weichen voneinander ab.");
}
if (manifest.screenshots.length < 3 || manifest.screenshots.length > 5) {
  throw new Error(`Claude-Submission benötigt drei bis fünf Carousel-Screenshots; vorhanden: ${manifest.screenshots.length}.`);
}
if (new Set(manifest.screenshots.map((item) => item.path)).size !== manifest.screenshots.length) {
  throw new Error("Claude-Submission enthält doppelte Carousel-Screenshot-Pfade.");
}
for (const resourceUri of manifest.widget_resource_uris) {
  if (!manifest.screenshots.some((item) => item.resource_uri === resourceUri)) {
    throw new Error(`Claude-Submission enthält keinen Carousel-Nachweis für ${resourceUri}.`);
  }
}

const required = [
  manifest.assets.icon,
  manifest.assets.logo,
  ...manifest.screenshots.map((item) => item.path),
  ...plan.cases.map((item) => `./${item.expected_response_fixture}`),
  "./submission/reviewer-runbook.md",
  "./submission/directory-submission-checklist.md",
];
for (const relativePath of required) {
  const path = resolve(root, relativePath.replace(/^\.\//u, ""));
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) throw new Error(`Claude-Submission-Artefakt fehlt oder ist leer: ${relativePath}`);
}
for (const screenshot of manifest.screenshots) {
  const image = readFileSync(resolve(root, screenshot.path));
  if (image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || image.readUInt32BE(16) < 1_000) {
    throw new Error(`Claude-Karussellbild ist kein PNG mit mindestens 1000 Pixel Breite: ${screenshot.path}`);
  }
}
for (const forbidden of [".claude-plugin/plugin.json", ".mcp.json", "manifest.json"]) {
  if (existsSync(resolve(root, forbidden))) throw new Error(`Claude-Code-Plugin ist kein Directory-Artefakt: ${forbidden}`);
}

console.log(`Anthropic-Submission-Artefakte gültig: ${plan.cases.length} Tool-Kandidaten, ${manifest.screenshots.length} Carousel-Screenshots.`);
