import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { z } from "zod";

import { loadReviewInventory } from "../packages/tool-catalog/src/index.ts";
import {
  CONNECTOR_EVAL_REPORT_SCHEMA,
  PILOT_PROTOCOL_SCHEMA,
  PRIVACY_THREAT_MODEL_SCHEMA,
  RELEASE_GATE_REPORT_SCHEMA,
  SUPPORT_RUNBOOK_SCHEMA,
  TENANT_ISOLATION_REPORT_SCHEMA,
  buildPendingReleaseArtifacts,
  buildReleaseGateReport,
} from "../integrations/release/src/index.ts";

const workspaceRoot = resolve(import.meta.dir, "..");
const releaseRoot = resolve(workspaceRoot, "integrations/release");
const writeMode = process.argv.includes("--write");

const fileNames = {
  eval: "connector-eval-suite.json",
  tenant_isolation: "tenant-isolation-suite.json",
  privacy: "privacy-threat-model.json",
  pilot: "pilot-protocol.json",
  release_gate: "release-gate-report.json",
  support: "support-runbook.json",
} as const;

function stable(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

if (writeMode) {
  const artifacts = buildPendingReleaseArtifacts();
  for (const [key, fileName] of Object.entries(fileNames)) {
    writeFileSync(resolve(releaseRoot, fileName), stable(artifacts[key as keyof typeof artifacts]), "utf8");
  }
  const fairUse = readJson(resolve(workspaceRoot, "apps/mcp-server/config/fair-use.v1.json"));
  writeFileSync(resolve(releaseRoot, "rate-limit-config.json"), stable(fairUse), "utf8");
}

for (const fileName of [...Object.values(fileNames), "rate-limit-config.json", "support-runbook.md", "cimd-client-allowlist.v1.json", "rts-task-commits.json"]) {
  if (!existsSync(resolve(releaseRoot, fileName))) throw new Error(`Releaseartefakt fehlt: integrations/release/${fileName}`);
}

const evalReport = CONNECTOR_EVAL_REPORT_SCHEMA.parse(readJson(resolve(releaseRoot, fileNames.eval)));
const tenantIsolation = TENANT_ISOLATION_REPORT_SCHEMA.parse(readJson(resolve(releaseRoot, fileNames.tenant_isolation)));
const privacy = PRIVACY_THREAT_MODEL_SCHEMA.parse(readJson(resolve(releaseRoot, fileNames.privacy)));
const pilot = PILOT_PROTOCOL_SCHEMA.parse(readJson(resolve(releaseRoot, fileNames.pilot)));
const releaseGate = RELEASE_GATE_REPORT_SCHEMA.parse(readJson(resolve(releaseRoot, fileNames.release_gate)));
const support = SUPPORT_RUNBOOK_SCHEMA.parse(readJson(resolve(releaseRoot, fileNames.support)));

const traceabilitySchema = z.object({
  schema_version: z.literal("1.0.0"),
  feature_id: z.literal("c5a5cb4f-7fcf-4975-8fb3-cb8aad928381"),
  tasks: z.array(z.object({
    key: z.string().regex(/^K(?:[1-9]|1\d|2[0-3])$/u),
    task_id: z.string().uuid(),
    commit: z.string().regex(/^[a-f0-9]{40}$/u),
  }).strict()).length(23),
}).strict();
const traceability = traceabilitySchema.parse(readJson(resolve(releaseRoot, "rts-task-commits.json")));
const orderedTraceability = [...traceability.tasks].sort((left, right) => Number(left.key.slice(1)) - Number(right.key.slice(1)));
if (new Set(orderedTraceability.map((item) => item.task_id)).size !== 23
  || orderedTraceability.some((item, index) => item.key !== `K${index + 1}`)) {
  throw new Error("RTS-Traceability muss K1 bis K23 mit eindeutigen Task-IDs enthalten.");
}
for (const item of orderedTraceability) {
  const resolvedCommit = execFileSync("git", ["show", "-s", "--format=%H", item.commit], { cwd: workspaceRoot, encoding: "utf8" }).trim();
  if (resolvedCommit !== item.commit) throw new Error(`${item.key}: Implementierungscommit ist nicht exakt auflösbar.`);
  execFileSync("git", ["merge-base", "--is-ancestor", item.commit, "HEAD"], { cwd: workspaceRoot, stdio: "ignore" });
}

assertSame(releaseGate.eval, evalReport, "ReleaseGateReport und ConnectorEvalSuite sind nicht synchron.");
assertSame(releaseGate.tenant_isolation, tenantIsolation, "ReleaseGateReport und TenantIsolationSuite sind nicht synchron.");
assertSame(releaseGate.privacy, privacy, "ReleaseGateReport und PrivacyThreatModel sind nicht synchron.");
assertSame(releaseGate.pilot, pilot, "ReleaseGateReport und PilotProtocol sind nicht synchron.");

const recomputed = buildReleaseGateReport({
  generated_at: releaseGate.generated_at,
  evidence: releaseGate.evidence,
  eval: evalReport,
  tenant_isolation: tenantIsolation,
  privacy,
  pilot,
  findings: releaseGate.findings,
  signatures: releaseGate.signatures,
  provider_gates: releaseGate.provider_gates,
});
assertSame(releaseGate, recomputed, "ReleaseGateReport entspricht nicht der aktuellen Gate-Logik.");

const inventory = loadReviewInventory();
if (releaseGate.evidence.action_classification_count !== inventory.actions.entry_count
  || releaseGate.evidence.action_total !== inventory.manifest.action_count
  || releaseGate.evidence.route_callsite_count !== inventory.routes.entry_count) {
  throw new Error("ReleaseGateReport weicht vom generierten 303/560-Inventar ab.");
}
const inventoryToolNames = inventory.provider_contract.virtual_tools.map((tool) => tool.tool_name).sort();
const evalToolNames = evalReport.results.map((result) => result.tool_name).sort();
assertSame(evalToolNames, inventoryToolNames, "ConnectorEvalSuite deckt nicht exakt die acht veröffentlichten virtuellen Tools ab.");

const migrationCandidatesPublished = inventory.migration.discovered_candidates.every((entry) => entry.published === true);
if (releaseGate.evidence.audited_operation_catalog_published !== migrationCandidatesPublished) {
  throw new Error("Der Operationskatalog-Publikationsstatus ist nicht aus der Migrationsspur abgeleitet.");
}

const fairUse = readJson(resolve(workspaceRoot, "apps/mcp-server/config/fair-use.v1.json"));
const releaseRateLimit = readJson(resolve(releaseRoot, "rate-limit-config.json"));
assertSame(releaseRateLimit, fairUse, "RateLimitConfig weicht von der produktiven MCP-Konfiguration ab.");

const cimdSchema = z.object({
  contract_version: z.literal("1.0.0"),
  release_state: z.enum(["BLOCKED", "READY"]),
  pins: z.array(z.object({
    client_id: z.string().url().startsWith("https://"),
    provider: z.enum(["openai", "anthropic"]),
    metadata_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    enabled: z.boolean(),
  }).strict()),
  notice: z.string().trim().min(1),
}).strict();
const cimd = cimdSchema.parse(readJson(resolve(releaseRoot, "cimd-client-allowlist.v1.json")));
const pinnedProviders = new Set(cimd.pins.filter((pin) => pin.enabled).map((pin) => pin.provider));
const cimdReady = cimd.release_state === "READY" && pinnedProviders.has("openai") && pinnedProviders.has("anthropic");
if (releaseGate.evidence.cimd_pins_verified !== cimdReady) throw new Error("CIMD-Gate und Pin-Artefakt widersprechen sich.");

const openAiPlan = readJson(resolve(workspaceRoot, "integrations/openai/submission/tool-test-plan.json")) as { cases: Array<{ tool_name: string }> };
const anthropicPlan = readJson(resolve(workspaceRoot, "integrations/anthropic/submission/tool-test-plan.json")) as { cases: Array<{ tool_name: string }> };
assertSame(openAiPlan.cases.map((item) => item.tool_name).sort(), evalToolNames, "OpenAI-Testplan driftet von der Eval-Suite.");
assertSame(anthropicPlan.cases.map((item) => item.tool_name).sort(), evalToolNames, "Anthropic-Testplan driftet von der Eval-Suite.");

if (privacy.log_service.connected_to_mcp || privacy.log_service.end_user_access || support.user_log_access) {
  throw new Error("Der Master-Admin-Log-Service darf nicht über MCP oder Endnutzer-Support zugänglich sein.");
}
if (pilot.status !== "passed" && releaseGate.decision !== "BLOCKED") throw new Error("Ein fehlender realer Pilot muss den Release blockieren.");
if (releaseGate.findings.some((finding) => finding.status === "open" && ["critical", "high"].includes(finding.severity))
  && releaseGate.decision !== "BLOCKED") throw new Error("Critical/High-Findings dürfen nicht freigegeben werden.");

const serialized = JSON.stringify({ evalReport, tenantIsolation, privacy, pilot, releaseGate, support });
if (/access[_-]?token|refresh[_-]?token|password|MITGLIED-GEHEIM/iu.test(serialized)) {
  throw new Error("Releaseartefakte enthalten ein mögliches Geheimnis.");
}

console.log(`Connector-Releaseartefakte gültig: ${releaseGate.decision}; Provider: ${releaseGate.provider_gates.map((gate) => `${gate.provider}=${gate.state}`).join(", ")}`);
