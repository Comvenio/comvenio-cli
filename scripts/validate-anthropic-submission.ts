import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import {
  CLAUDE_DIRECTORY_MANIFEST_SCHEMA,
  CLAUDE_TOOL_SYNC_PLAN_SCHEMA,
  buildClaudeDirectoryManifest,
} from "../integrations/anthropic/src/index.ts";
import {
  RELEASE_GATE_REPORT_SCHEMA,
} from "../integrations/release/src/index.ts";
import {
  publishedRuntimeCatalog,
} from "../apps/mcp-server/src/runtime-tools.ts";

const workspaceRoot = resolve(import.meta.dir, "..");
const root = resolve(workspaceRoot, "integrations/anthropic");
const allowBlockedDraft = process.argv.includes("--allow-blocked-draft");
const manifest = CLAUDE_DIRECTORY_MANIFEST_SCHEMA.parse(JSON.parse(
  readFileSync(resolve(root, "submission/connector-profile.json"), "utf8"),
));
const plan = CLAUDE_TOOL_SYNC_PLAN_SCHEMA.parse(JSON.parse(
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
    buildClaudeDirectoryManifest(runtimeCatalog.tool_catalog_sha256),
  )
) {
  throw new Error(
    "Statisches Claude-Directory-Profil weicht vom generierten Profil ab.",
  );
}
if (
  manifest.tool_sync_version !== runtimeCatalog.tool_catalog_sha256
  || plan.tool_sync_version !== runtimeCatalog.tool_catalog_sha256
  || JSON.stringify(
    plan.cases.map((item) => item.tool_name).sort(),
  ) !== JSON.stringify(runtimeCatalog.tool_names)
) {
  throw new Error(
    "Claude-Submission und produktive Runtime-Tools weichen voneinander ab.",
  );
}
if (
  JSON.stringify([...manifest.widget_resource_uris].sort())
  !== JSON.stringify(runtimeCatalog.widget_resource_uris)
) {
  throw new Error(
    "Claude-Submission und produktive Widget-Ressourcen weichen voneinander ab.",
  );
}

if (
  !allowBlockedDraft
  && (manifest.screenshots.length < 3 || manifest.screenshots.length > 5)
) {
  throw new Error(
    "Claude-Submission benötigt drei bis fünf Carousel-Screenshots; "
    + `vorhanden: ${manifest.screenshots.length}.`,
  );
}
if (
  allowBlockedDraft
  && manifest.screenshots.length !== 0
  && (manifest.screenshots.length < 3 || manifest.screenshots.length > 5)
) {
  throw new Error(
    "Ein Claude-Entwurf darf keine unvollständige Carousel-Evidence "
    + `enthalten; vorhanden: ${manifest.screenshots.length}.`,
  );
}
if (
  new Set(
    manifest.screenshots.map((item) => item.path),
  ).size !== manifest.screenshots.length
) {
  throw new Error(
    "Claude-Submission enthält doppelte Carousel-Screenshot-Pfade.",
  );
}
for (
  const resourceUri of manifest.screenshots.length === 0
    ? []
    : manifest.widget_resource_uris
) {
  if (
    !manifest.screenshots.some(
      (item) => item.resource_uri === resourceUri,
    )
  ) {
    throw new Error(
      `Claude-Submission enthält keinen Carousel-Nachweis für ${resourceUri}.`,
    );
  }
}

const matrixPaths = [...new Set(
  plan.cases.map((item) => item.expected_response_fixture),
)];
if (matrixPaths.length !== 1) {
  throw new Error(
    "Der Full-Scope benötigt genau eine kanonische Claude-Antwortmatrix.",
  );
}
const matrix = z.object({
  schema_version: z.literal("1.0.0"),
  entity: z.literal("ProviderResponseContractMatrix"),
  release_scope: z.literal(releaseGate.evidence.release_scope),
  runtime_tool_catalog_sha256:
    z.literal(runtimeCatalog.tool_catalog_sha256),
  synthetic_data_only: z.literal(true),
  provider: z.literal("anthropic"),
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
    "Die Claude-Antwortmatrix deckt nicht exakt den Runtime-Katalog ab.",
  );
}

const required = new Set([
  manifest.assets.icon,
  manifest.assets.logo,
  ...manifest.screenshots.map((item) => item.path),
  ...matrixPaths.map((item) => `./${item}`),
  "./submission/reviewer-runbook.md",
  "./submission/directory-submission-checklist.md",
]);
for (const relativePath of required) {
  const path = resolve(root, relativePath.replace(/^\.\//u, ""));
  if (
    !existsSync(path)
    || !statSync(path).isFile()
    || statSync(path).size === 0
  ) {
    throw new Error(
      `Claude-Submission-Artefakt fehlt oder ist leer: ${relativePath}`,
    );
  }
}
for (const screenshot of manifest.screenshots) {
  const image = readFileSync(resolve(root, screenshot.path));
  if (
    image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    || image.readUInt32BE(16) < 1_000
  ) {
    throw new Error(
      "Claude-Karussellbild ist kein PNG mit mindestens 1000 Pixel Breite: "
      + screenshot.path,
    );
  }
}
if (allowBlockedDraft && manifest.screenshots.length === 0) {
  const checklist = readFileSync(
    resolve(root, "submission/directory-submission-checklist.md"),
    "utf8",
  );
  if (
    !checklist.includes("Status: **BLOCKED")
    || !checklist.includes("DIRECTORY_PORTAL_EVIDENCE_PENDING")
  ) {
    throw new Error(
      "Der screenshotlose Claude-Entwurf muss ausdrücklich als blockiert "
      + "dokumentiert sein.",
    );
  }
}
for (const forbidden of [
  ".claude-plugin/plugin.json",
  ".mcp.json",
  "manifest.json",
]) {
  if (existsSync(resolve(root, forbidden))) {
    throw new Error(
      `Claude-Code-Plugin ist kein Directory-Artefakt: ${forbidden}`,
    );
  }
}

console.log(
  `Anthropic-Submission-Artefakte gültig: ${plan.cases.length} `
  + `Tool-Kandidaten, ${manifest.screenshots.length} Carousel-Screenshots.`,
);
