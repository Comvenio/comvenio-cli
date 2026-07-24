import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const CONNECTOR_DOC_DIRECTORY = join(
  "comvenio-tools",
  "AI-docs",
  "concepts",
  "architecture",
  "comvenio-ai-connector",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): JsonRecord {
  assert(value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} muss ein Objekt sein.`);
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} muss ein Array sein.`);
  return value;
}

function string(value: unknown, label: string): string {
  assert(typeof value === "string" && value.length > 0, `${label} muss ein String sein.`);
  return value;
}

function integer(value: unknown, label: string): number {
  assert(typeof value === "number" && Number.isInteger(value), `${label} muss eine Ganzzahl sein.`);
  return value;
}

function findSourcecodeRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, CONNECTOR_DOC_DIRECTORY))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Comvenio AI-docs konnten oberhalb des CLI-Worktrees nicht gefunden werden.");
}

function sha256(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function parseYaml(path: string): { raw: string; value: JsonRecord } {
  const raw = readFileSync(path, "utf8");
  return { raw, value: record(Bun.YAML.parse(raw), path) };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeOrCheck(path: string, value: unknown, check: boolean): void {
  const expected = stableJson(value);
  writeTextOrCheck(path, expected, check);
}

function writeTextOrCheck(path: string, expected: string, check: boolean): void {
  if (check) {
    assert(existsSync(path), `Generiertes Artefakt fehlt: ${path}`);
    assert(readFileSync(path, "utf8") === expected, `Generiertes Artefakt ist veraltet: ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, expected, "utf8");
}

function uniqueStrings(values: string[], label: string): void {
  assert(new Set(values).size === values.length, `${label} enthält Duplikate.`);
}

const repositoryRoot = resolve(import.meta.dir, "..");
const sourcecodeRoot = findSourcecodeRoot(repositoryRoot);
const docsRoot = join(sourcecodeRoot, CONNECTOR_DOC_DIRECTORY);
const actionsSource = parseYaml(join(docsRoot, "comvenio-ai-connector-v1-actions.yaml"));
const routesSource = parseYaml(join(docsRoot, "comvenio-ai-connector-v1-routes.yaml"));
const providerSource = parseYaml(join(docsRoot, "comvenio-ai-connector-provider-tools.yaml"));
const backendAuditPath = join(
  sourcecodeRoot,
  "comvenio-tools",
  "AI-docs",
  "audits",
  "backend-rbac-route-audit-2026-05-11.json",
);
const backendAuditRaw = readFileSync(backendAuditPath, "utf8");
const backendAudit = record(JSON.parse(backendAuditRaw), backendAuditPath);

const actions = array(actionsSource.value.entries, "actions.entries").map((entry, index) =>
  record(entry, `actions.entries[${index}]`));
const routes = array(routesSource.value.routes, "routes.routes").map((entry, index) =>
  record(entry, `routes.routes[${index}]`));
const virtualTools = array(providerSource.value.virtual_tools, "provider.virtual_tools").map((entry, index) =>
  record(entry, `provider.virtual_tools[${index}]`));
const backendRoutes = array(backendAudit.routes, "backend_audit.routes");

assert(integer(actionsSource.value.entry_count, "actions.entry_count") === 303 && actions.length === 303,
  "Action-Inventar muss exakt 303 Einträge enthalten.");
assert(integer(actionsSource.value.domain_count, "actions.domain_count") === 26,
  "Action-Inventar muss exakt 26 Domains deklarieren.");
assert(new Set(actions.map((entry, index) => string(entry.domain, `actions[${index}].domain`))).size === 26,
  "Action-Inventar muss exakt 26 tatsächliche Domains enthalten.");
assert(integer(routesSource.value.entry_count, "routes.entry_count") === 572 && routes.length === 572,
  "Route-Inventar muss exakt 572 Callsites enthalten.");
assert(integer(providerSource.value.expected_virtual_tool_count, "provider.expected_virtual_tool_count") === 8
  && virtualTools.length === 8, "Provider-Vertrag muss exakt acht virtuelle Tools enthalten.");
assert(integer(providerSource.value.current_cli_action_count, "provider.current_cli_action_count") === 303,
  "Provider-Vertrag referenziert nicht die 303-Actions-Baseline.");
assert(integer(providerSource.value.current_cli_callsite_count, "provider.current_cli_callsite_count") === 572,
  "Provider-Vertrag referenziert nicht die 572-Callsite-Baseline.");
uniqueStrings(actions.map((entry, index) => string(entry.id, `actions[${index}].id`)), "Action-IDs");
uniqueStrings(routes.map((entry, index) => string(entry.id, `routes[${index}].id`)), "Route-IDs");
uniqueStrings(routes.map((entry, index) => string(entry.source_locator, `routes[${index}].source_locator`)),
  "Route-Source-Locators");
uniqueStrings(virtualTools.map((entry, index) => string(entry.tool_name, `virtual_tools[${index}].tool_name`)),
  "Virtuelle Toolnamen");

const oauthReplacements: Array<{ legacy_action_id: string; replacement: string }> = [];
const discoveredCandidates: Array<Record<string, unknown>> = [];
for (const [index, action] of actions.entries()) {
  const id = string(action.id, `actions[${index}].id`);
  const delivery = string(action.delivery, `actions[${index}].delivery`);
  if (delivery === "oauth_connect" || delivery === "oauth_disconnect") {
    oauthReplacements.push({ legacy_action_id: id, replacement: delivery });
    continue;
  }
  discoveredCandidates.push({
    legacy_action_id: id,
    domain: string(action.domain, `actions[${index}].domain`),
    state: "DISCOVERED",
    published: false,
    candidate_operation_ids: [`candidate.${id}`],
    blockers: [
      "backend_permission_audit_missing",
      "copy_fixture_missing",
      "route_trace_fixture_missing",
      "shared_handler_missing",
      "typed_schema_pair_missing",
    ],
  });
}
assert(oauthReplacements.length === 2, "Exakt Login und Logout müssen OAuth-Lifecycle-Ersatz sein.");
assert(discoveredCandidates.length + oauthReplacements.length === 303,
  "Jede Legacy-Action benötigt genau eine Migrationsspur.");

const generatedRoot = join(repositoryRoot, "packages", "tool-catalog", "generated");
const check = process.argv.includes("--check");
writeOrCheck(join(generatedRoot, "actions.v1.json"), actionsSource.value, check);
writeOrCheck(join(generatedRoot, "routes.v1.json"), routesSource.value, check);
writeOrCheck(join(generatedRoot, "provider-contract.v1.json"), providerSource.value, check);
writeOrCheck(join(generatedRoot, "migration-coverage.v1.json"), {
  contract_version: "1.0.0",
  action_inventory_version: string(actionsSource.value.contract_version, "actions.contract_version"),
  legacy_actions_total: 303,
  discovered_candidates: discoveredCandidates,
  oauth_lifecycle_replacements: oauthReplacements,
}, check);
writeTextOrCheck(join(generatedRoot, "operations.v1.yaml"), stableJson({
  contract_version: "1.0.0",
  publication_state: "BLOCKED",
  operations: [],
  unpublished_migration_candidates: discoveredCandidates.length,
  notice: "Nur vollständig auditierte OperationDefinition-Einträge dürfen dieses Array füllen.",
}), check);
writeTextOrCheck(join(generatedRoot, "provider-tools.v1.yaml"), stableJson({
  contract_version: "1.0.0",
  publication_state: "BLOCKED",
  virtual_tools: virtualTools.map((tool) => ({
    ...tool,
    publication_state: "DISCOVERED",
    blockers: ["handler_missing", "typed_schema_pair_missing"],
  })),
  domain_tools: [],
  notice: "Provider-Metadaten sind kein Runtime-Dispatch. Veröffentlichung folgt ausschließlich aus auditierten Operationen.",
}), check);
writeTextOrCheck(join(generatedRoot, "index.ts"), [
  "// Generated by scripts/import-connector-inventory.ts.",
  "// Domain and virtual tools remain unpublished until their audited schemas and handlers exist.",
  "export interface GeneratedToolContractMap {}",
  "export type GeneratedToolName = keyof GeneratedToolContractMap;",
  "",
].join("\n"), check);
writeOrCheck(join(generatedRoot, "backend-route-permissions.v1.json"), {
  contract_version: "1.0.0",
  classification_status: "migration_required",
  backend_source_hash_sha256: sha256(backendAuditRaw),
  source_audit_entry_count: backendRoutes.length,
  entries: [],
  unclassified_count: 572,
  notice: "Migrationsinventar, keine Runtime-Autorisierungsquelle. Erst exakte, getestete PermissionPolicy-Einträge reduzieren unclassified_count.",
}, check);
writeOrCheck(join(generatedRoot, "inventory-manifest.v1.json"), {
  contract_version: "1.0.0",
  generated_at_source_date: string(routesSource.value.verified_at, "routes.verified_at"),
  action_count: 303,
  domain_count: 26,
  route_callsite_count: 572,
  virtual_tool_count: 8,
  source_sha256: {
    actions: sha256(actionsSource.raw),
    routes: sha256(routesSource.raw),
    provider_tools: sha256(providerSource.raw),
    backend_rbac_audit: sha256(backendAuditRaw),
  },
}, check);

console.log(check
  ? "Connector-Inventar ist aktuell (26 Domains, 303 Actions, 572 Callsites, 8 virtuelle Tools)."
  : "Connector-Inventar generiert (26 Domains, 303 Actions, 572 Callsites, 8 virtuelle Tools).");
