import { describe, expect, test } from "bun:test";

import type { RequestContext } from "@comvenio/connector-contracts";
import { createClubSelectionContext } from "../../../packages/auth/src/index.ts";
import {
  ToolCatalog,
  type OperationDefinition,
  type ToolCatalogSnapshot,
  type ToolDefinition,
} from "../../../packages/tool-catalog/src/index.ts";

const clubId = "33333333-3333-4333-8333-333333333333";
const otherClubId = "44444444-4444-4444-8444-444444444444";
const operation: OperationDefinition = {
  operation_id: "member.list",
  domain: "member",
  legacy_action_id: "cai.member.01.list",
  source_branch_locators: ["src/commands/member.ts:member.list"],
  shared_handler_ref: "@comvenio/tool-catalog/operations/member/list",
  route_trace_fixture_ref: "fixtures/member/list.route-trace.json",
  input_schema_ref: "schemas/member/list.input.json",
  output_schema_ref: "schemas/member/list.output.json",
  required_scopes: ["member.read.basic"],
  permission_policy: {
    all_of: ["view_members"],
    any_of: [],
    owner_or_self_allowed: false,
    department_scope: "optional",
    backend_audit_refs: ["audit.member.list"],
  },
  risk_class: "read",
  execution_mode: "inline",
  external_effect: "comvenio_private",
  idempotency: "read",
  confirmation: "none",
};
const tool: ToolDefinition = {
  tool_name: "cv_member_read_view_members_12345678",
  tool_group_key_sha256: "a".repeat(64),
  title: "Comvenio: Mitglieder anzeigen",
  description: "Zeigt berechtigte Mitgliedsdaten im ausgewählten Verein.",
  copy_fixture_ref: "copy/member.read.json",
  operation_ids: [operation.operation_id],
  required_scopes: ["member.read.basic"],
  risk_class: "read",
  execution_mode: "inline",
  idempotency: "read",
  confirmation: "none",
  permission_policy: structuredClone(operation.permission_policy),
  external_effect: "comvenio_private",
  input_schema_ref: "generated/tools/member.input.json",
  output_schema_ref: "generated/tools/member.output.json",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
const snapshot: ToolCatalogSnapshot = {
  contract_version: "1.0.0",
  source_hash_sha256: "b".repeat(64),
  operations: [operation],
  tools: [tool],
  cli_bindings: [{
    operation_id: operation.operation_id,
    command_expression: "member list",
    argument_mapper_ref: "bindings/member/list.args",
    renderer_ref: "bindings/member/list.renderer",
    compatibility_fixture_ref: "fixtures/member/list.cli.json",
  }],
  mcp_bindings: [{
    operation_id: operation.operation_id,
    tool_name: tool.tool_name,
    operation_discriminator: operation.operation_id,
    widget_resource_uri: "ui://comvenio/member-management",
  }],
};
const context: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "mcp",
  provider: "anthropic",
  subject_id: "22222222-2222-4222-8222-222222222222",
  oauth_grant_id: "55555555-5555-4555-8555-555555555555",
  club_id: clubId,
  department_id: null,
  scopes: ["member.read.basic"],
  capability_version: "cap-v1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

describe("MCP catalog tenant isolation", () => {
  const catalog = new ToolCatalog(snapshot);

  test("hides private tools until scope, club and capability are present", () => {
    expect(catalog.listVisible({
      context: { ...context, club_id: null },
      capabilities: new Set(["view_members"]),
    })).toEqual([]);
    expect(catalog.listVisible({ context, capabilities: new Set() })).toEqual([]);
    expect(catalog.listVisible({
      context: { ...context, scopes: [] },
      capabilities: new Set(["view_members"]),
    })).toEqual([]);
    expect(catalog.listVisible({
      context,
      capabilities: new Set(["view_members"]),
    })).toHaveLength(1);
  });

  test("denies cross-tenant and unknown calls before any handler can be resolved", () => {
    expect(() => catalog.resolveCall({
      tool_name: tool.tool_name,
      operation_id: operation.operation_id,
      club_id: otherClubId,
    }, {
      context,
      capabilities: new Set(["view_members"]),
    })).toThrow("Verein stimmt nicht");
    expect(() => catalog.resolveCall({
      tool_name: "cv_unknown_read",
      operation_id: "unknown.read",
      club_id: clubId,
    }, {
      context,
      capabilities: new Set(["view_members"]),
    })).toThrow("Tool wurde nicht gefunden");
  });

  test("requires an explicit club before private tool discovery for multi-club subjects", () => {
    expect(() => createClubSelectionContext({
      eligible_club_ids: [clubId, otherClubId],
      request_id: context.request_id,
    })).toThrow("Bitte wähle den Verein");
    expect(catalog.listVisible({
      context: { ...context, club_id: null },
      capabilities: new Set(["view_members"]),
    })).toEqual([]);
  });
});
