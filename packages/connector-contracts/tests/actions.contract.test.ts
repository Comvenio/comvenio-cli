import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createParityReport,
  loadReviewInventory,
  validateBackendRoutePermissionAudit,
  type BackendRoutePermissionAudit,
} from "../../tool-catalog/src/index.ts";

describe("Comvenio connector inventory contract", () => {
  const inventory = loadReviewInventory();
  const generatedRoot = resolve(import.meta.dir, "../../tool-catalog/generated");

  test("pins the complete 26/303/560 baseline and eight virtual tools", () => {
    expect(inventory.actions.entries).toHaveLength(303);
    expect(new Set(inventory.actions.entries.map((entry) => entry.domain)).size).toBe(26);
    expect(inventory.routes.routes).toHaveLength(560);
    expect(new Set(inventory.routes.routes.map((entry) => entry.source_locator)).size).toBe(560);
    expect(inventory.provider_contract.virtual_tools).toHaveLength(8);
    expect(inventory.actions.entries.filter((entry) => entry.domain === "schema"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ coverage_status: "core-partial" })]));
  });

  test("covers every legacy action by a blocked candidate or exact OAuth replacement", () => {
    const candidateIds = inventory.migration.discovered_candidates
      .map((entry) => entry.legacy_action_id);
    const replacementIds = inventory.migration.oauth_lifecycle_replacements
      .map((entry) => entry.legacy_action_id);
    expect(candidateIds).toHaveLength(301);
    expect(replacementIds.sort()).toEqual([
      "cai.login.01.login_token",
      "cai.logout.01.logout",
    ]);
    expect(new Set([...candidateIds, ...replacementIds]).size).toBe(303);
    expect(inventory.migration.discovered_candidates.every((entry) =>
      entry.state === "DISCOVERED" && entry.published === false && entry.blockers.length === 5)).toBe(true);
  });

  test("fails published parity until audited operations replace discovered candidates", () => {
    const report = createParityReport({
      action_inventory: inventory.actions,
      operation_catalog_version: "foundation-empty",
      operations: [],
      oauth_lifecycle_replacements: inventory.migration.oauth_lifecycle_replacements,
    });
    expect(report.missing_action_ids).toHaveLength(301);
    expect(report).toMatchObject({
      legacy_actions_total: 303,
      oauth_lifecycle_replacements: [
        "cai.login.01.login_token",
        "cai.logout.01.logout",
      ],
      status: "fail",
    });
  });

  test("keeps generated operation and provider artifacts blocked by default", () => {
    const operations = Bun.YAML.parse(readFileSync(resolve(generatedRoot, "operations.v1.yaml"), "utf8"));
    const providers = Bun.YAML.parse(
      readFileSync(resolve(generatedRoot, "provider-tools.v1.yaml"), "utf8"),
    ) as {
      publication_state: string;
      domain_tools: unknown[];
      virtual_tools: Array<{ publication_state: string }>;
    };
    expect(operations).toMatchObject({
      publication_state: "BLOCKED",
      operations: [],
      unpublished_migration_candidates: 301,
    });
    expect(providers.publication_state).toBe("BLOCKED");
    expect(providers.domain_tools).toEqual([]);
    expect(providers.virtual_tools).toHaveLength(8);
    expect(providers.virtual_tools.every((tool: { publication_state: string }) =>
      tool.publication_state === "DISCOVERED")).toBe(true);
  });

  test("refuses the raw backend audit draft as a publication authority", () => {
    expect(() => validateBackendRoutePermissionAudit(
      inventory.backend_permission_audit_draft as unknown as BackendRoutePermissionAudit,
      new Set(),
    )).toThrow("unklassifizierte Routen");
  });

  test("contains no generic dispatch tool or secret-bearing generated telemetry", () => {
    const serialized = JSON.stringify(inventory);
    expect(inventory.provider_contract.virtual_tools.every((tool) =>
      tool.tool_name.length <= 64
      && !/(?:generic.?api.?request|run_cli_command|shell|api_request)/iu.test(tool.tool_name))).toBe(true);
    expect(serialized).not.toMatch(/cvn_[a-z0-9_-]+/iu);
    expect(serialized).not.toContain("Authorization: Bearer");
  });
});
