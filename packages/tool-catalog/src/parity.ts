import type {
  LegacyActionInventory,
  OAuthLifecycleReplacement,
  OperationDefinition,
  ParityReport,
} from "./types.ts";
import { assertCatalog } from "./validation.ts";

export function createParityReport(input: {
  action_inventory: LegacyActionInventory;
  operation_catalog_version: string;
  operations: readonly OperationDefinition[];
  oauth_lifecycle_replacements: readonly OAuthLifecycleReplacement[];
}): ParityReport {
  assertCatalog(input.action_inventory.entry_count === 303
    && input.action_inventory.entries.length === 303,
  "Der Paritätsreport benötigt die vollständige 303-Actions-Baseline.");
  const inventoryIds = new Set(input.action_inventory.entries.map((entry) => entry.id));
  const coveredIds = new Set<string>();
  const extraOperationIds: string[] = [];
  for (const operation of input.operations) {
    if (inventoryIds.has(operation.legacy_action_id)) coveredIds.add(operation.legacy_action_id);
    else extraOperationIds.push(operation.operation_id);
  }
  const replacementIds = new Set<string>();
  for (const replacement of input.oauth_lifecycle_replacements) {
    const action = input.action_inventory.entries.find((entry) => entry.id === replacement.legacy_action_id);
    assertCatalog(action, `Unbekannter OAuth-Lifecycle-Ersatz ${replacement.legacy_action_id}.`);
    assertCatalog(
      (replacement.replacement === "oauth_connect" && action.delivery === "oauth_connect")
        || (replacement.replacement === "oauth_disconnect" && action.delivery === "oauth_disconnect"),
      `${replacement.legacy_action_id}: OAuth-Lifecycle-Ersatz passt nicht zum Inventar.`,
    );
    replacementIds.add(replacement.legacy_action_id);
  }
  const conflicts = [...coveredIds].filter((id) => replacementIds.has(id));
  extraOperationIds.push(...input.operations
    .filter((operation) => conflicts.includes(operation.legacy_action_id))
    .map((operation) => operation.operation_id));
  const missing = [...inventoryIds]
    .filter((id) => !coveredIds.has(id) && !replacementIds.has(id))
    .sort();
  const extras = [...new Set(extraOperationIds)].sort();
  return {
    action_inventory_version: input.action_inventory.contract_version,
    operation_catalog_version: input.operation_catalog_version,
    legacy_actions_total: 303,
    covered_action_ids: [...coveredIds].sort(),
    oauth_lifecycle_replacements: [...replacementIds].sort(),
    missing_action_ids: missing,
    extra_operation_ids: extras,
    status: missing.length === 0 && extras.length === 0 ? "pass" : "fail",
  };
}

export function assertParity(report: ParityReport): void {
  assertCatalog(report.status === "pass",
    `CLI-/MCP-Parität fehlt: ${report.missing_action_ids.length} fehlend, ${report.extra_operation_ids.length} zusätzlich.`);
}
