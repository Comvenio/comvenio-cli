import actionsJson from "../generated/actions.v1.json";
import backendAuditDraftJson from "../generated/backend-route-permissions.v1.json";
import manifestJson from "../generated/inventory-manifest.v1.json";
import migrationJson from "../generated/migration-coverage.v1.json";
import providerJson from "../generated/provider-contract.v1.json";
import routesJson from "../generated/routes.v1.json";

import type {
  BackendPermissionAuditDraft,
  InventoryManifest,
  LegacyActionInventory,
  MigrationCoverageSnapshot,
  ProviderToolContract,
  RouteInventory,
} from "./types.ts";
import { assertCatalog } from "./validation.ts";

export interface ReviewInventorySnapshot {
  readonly actions: LegacyActionInventory;
  readonly routes: RouteInventory;
  readonly migration: MigrationCoverageSnapshot;
  readonly provider_contract: ProviderToolContract;
  readonly backend_permission_audit_draft: BackendPermissionAuditDraft;
  readonly manifest: InventoryManifest;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function assertGeneratedInventory(snapshot: ReviewInventorySnapshot): void {
  const { actions, routes, migration, provider_contract: provider, manifest } = snapshot;
  assertCatalog(actions.entry_count === 303 && actions.entries.length === 303,
    "Actions-Snapshot muss exakt 303 Einträge enthalten.");
  assertCatalog(actions.domain_count === 26
    && new Set(actions.entries.map((entry) => entry.domain)).size === 26,
  "Actions-Snapshot muss exakt 26 Domains enthalten.");
  assertCatalog(routes.entry_count === 560 && routes.routes.length === 560,
    "Routes-Snapshot muss exakt 560 Callsites enthalten.");
  assertCatalog(routes.semantics.inventory_only === true,
    "Route-Inventar darf keine Runtime-Autorität sein.");
  assertCatalog(new Set(routes.routes.map((entry) => entry.source_locator)).size === 560,
    "Route-Source-Locators müssen eindeutig sein.");
  assertCatalog(provider.expected_virtual_tool_count === 8 && provider.virtual_tools.length === 8,
    "Provider-Vertrag muss exakt acht virtuelle Tools enthalten.");
  assertCatalog(JSON.stringify(provider.virtual_tools.map((tool) => tool.tool_name).sort()) === JSON.stringify([
    "cv_file_get_read",
    "cv_file_upload_complete_write",
    "cv_file_upload_start_write",
    "cv_job_cancel_write",
    "cv_job_status_read",
    "cv_permissions_explain_read",
    "cv_schema_read",
    "cv_whoami_read",
  ]), "Die acht virtuellen Plattformtools weichen vom V1-Vertrag ab.");
  assertCatalog(provider.virtual_tools.every((tool) => tool.tool_name.length <= 64),
    "Virtueller Toolname überschreitet 64 Zeichen.");
  assertCatalog(provider.virtual_tools.every((tool) =>
    !/(?:generic.?api.?request|run_cli_command|shell|api_request)/iu.test(tool.tool_name)),
  "Generische Provider-Tools sind verboten.");
  assertCatalog(manifest.action_count === 303 && manifest.domain_count === 26
    && manifest.route_callsite_count === 560 && manifest.virtual_tool_count === 8,
  "Inventar-Manifest weicht von den normativen Zählwerten ab.");

  const actionIds = new Set(actions.entries.map((entry) => entry.id));
  const discovered = new Set(migration.discovered_candidates.map((entry) => entry.legacy_action_id));
  const replaced = new Set(migration.oauth_lifecycle_replacements.map((entry) => entry.legacy_action_id));
  assertCatalog(migration.discovered_candidates.every((entry) => entry.state === "DISCOVERED"
    && entry.published === false && entry.blockers.length > 0),
  "Nicht auditierte Migrationseinträge müssen fail-closed DISCOVERED bleiben.");
  assertCatalog(discovered.size + replaced.size === 303,
    "Migrationsspur deckt nicht exakt 303 Legacy-Actions ab.");
  assertCatalog([...actionIds].every((id) => discovered.has(id) || replaced.has(id)),
    "Legacy-Action ohne Migrationsspur.");
  assertCatalog([...discovered].every((id) => !replaced.has(id)),
    "Legacy-Action darf nicht zugleich Kandidat und OAuth-Ersatz sein.");
  assertCatalog(snapshot.backend_permission_audit_draft.classification_status === "migration_required"
    && snapshot.backend_permission_audit_draft.entries.length === 0
    && snapshot.backend_permission_audit_draft.unclassified_count === 560,
  "Unauditierte Routen dürfen nicht als Backend-Permission-Audit erscheinen.");

  const schemaEntries = actions.entries.filter((entry) => entry.domain === "schema");
  assertCatalog(schemaEntries.length > 0
    && schemaEntries.every((entry) => entry.coverage_status === "core-partial"),
  "Die Schema-Domain muss als core-partial markiert bleiben.");
}

const INTERNAL_SNAPSHOT: ReviewInventorySnapshot = {
  actions: actionsJson as unknown as LegacyActionInventory,
  routes: routesJson as unknown as RouteInventory,
  migration: migrationJson as unknown as MigrationCoverageSnapshot,
  provider_contract: providerJson as unknown as ProviderToolContract,
  backend_permission_audit_draft: backendAuditDraftJson as unknown as BackendPermissionAuditDraft,
  manifest: manifestJson as unknown as InventoryManifest,
};

export function loadReviewInventory(): ReviewInventorySnapshot {
  assertGeneratedInventory(INTERNAL_SNAPSHOT);
  return clone(INTERNAL_SNAPSHOT);
}
