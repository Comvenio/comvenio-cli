import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createParityReport,
  loadReviewInventory,
  validateBackendRoutePermissionAudit,
  type BackendRoutePermissionAudit,
} from "../../tool-catalog/src/index.ts";
import type { CapabilitySnapshot } from "../../auth/src/index.ts";
import type { ComvenioApiClient, ComvenioApiRequest } from "../../comvenio-client/src/index.ts";
import type { JsonValue, OAuthScope, RequestContext } from "../src/index.ts";
import {
  K7_ACTION_DEFINITIONS,
  K7_ACTION_IDS,
  K7_ACTION_SCHEMAS,
  createK7ToolSets,
  type K7ExecutionDependencies,
} from "../../../apps/mcp-server/src/tools/identity-club-member-team-role/index.ts";

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

const k7ClubId = "33333333-3333-4333-8333-333333333333";
const k7SubjectId = "22222222-2222-4222-8222-222222222222";
const k7MemberId = "66666666-6666-4666-8666-666666666666";
const k7GrantId = "55555555-5555-4555-8555-555555555555";

function k7Context(scopes: OAuthScope[], department_id: string | null = null): RequestContext {
  return {
    request_id: "11111111-1111-4111-8111-111111111111",
    surface: "mcp",
    provider: "openai",
    subject_id: k7SubjectId,
    oauth_grant_id: k7GrantId,
    club_id: k7ClubId,
    department_id,
    scopes,
    capability_version: "K".repeat(43),
    locale: "de-DE",
    timezone: "Europe/Berlin",
  };
}

function k7Capability(permissions: Record<string, boolean>, department_ids: string[] = []): CapabilitySnapshot {
  return {
    subject_id: k7SubjectId,
    member_id: k7MemberId,
    club_id: k7ClubId,
    department_ids,
    permissions,
    sources: [],
    capability_version: "K".repeat(43),
    generated_at: "2026-07-21T12:00:00.000Z",
    observed_at: "2026-07-21T12:00:00.000Z",
    expires_at: "2099-07-21T12:05:00.000Z",
  };
}

function k7Client(handler: (request: ComvenioApiRequest) => Promise<JsonValue>): ComvenioApiClient {
  return {
    timeout_ms: 15000,
    async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> {
      return await handler(request) as T;
    },
  };
}

function k7Dependencies(client: ComvenioApiClient): K7ExecutionDependencies {
  return {
    client,
    write_safety: {
      async execute(_request, mutation) { return mutation(); },
    },
    job_starter: {
      async start() {
        return { job_id: "99999999-9999-4999-8999-999999999999", status: "queued" };
      },
    },
  };
}

describe("K7 identity, club, member, team and role contract", () => {
  test("TC-01/TC-02: maps all five entities and exactly 54 inventoried actions", () => {
    expect(K7_ACTION_IDS).toHaveLength(54);
    expect(Object.keys(K7_ACTION_DEFINITIONS)).toHaveLength(54);
    expect(Object.keys(K7_ACTION_SCHEMAS)).toHaveLength(54);

    const sets = createK7ToolSets(k7Dependencies(k7Client(async () => null)));
    expect({
      identity: sets.identity.listDefinitions().length,
      club: sets.club.listDefinitions().length,
      member: sets.member.listDefinitions().length,
      team: sets.team.listDefinitions().length,
      role: sets.role.listDefinitions().length,
    }).toEqual({ identity: 1, club: 10, member: 21, team: 7, role: 15 });
    expect(K7_ACTION_IDS.some((id) => /login|logout|log_service|master.?admin/iu.test(id))).toBe(false);
  });

  test("fails closed for the unsafe club profile route and missing self-permission endpoint", async () => {
    expect(K7_ACTION_DEFINITIONS["cai.club.01.info"].publication_state).toBe("blocked");
    expect(K7_ACTION_DEFINITIONS["cai.role.15.effective"].publication_state).toBe("blocked");
    const sets = createK7ToolSets(k7Dependencies(k7Client(async () => {
      throw new Error("blocked handler must not run");
    })));
    await expect(sets.club.execute({
      action_id: "cai.club.01.info",
      input: { club_id: k7ClubId },
      context: k7Context(["club.read"]),
      capability_snapshot: k7Capability({}),
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("TC-03: member lists are masked and details contain only the explicit allowlist", async () => {
    const calls: string[] = [];
    const sets = createK7ToolSets(k7Dependencies(k7Client(async (request) => {
      calls.push(request.path);
      if (request.path.includes("by_club")) {
        return {
          items: [{
            id: k7MemberId,
            club_id: k7ClubId,
            first_name: "Anna",
            last_name: "Beispiel",
            email: "anna@example.org",
            phone_number: "+49 123 456789",
            user_id: "77777777-7777-4777-8777-777777777777",
            date_of_death: null,
            membership_status: { name: "Aktiv" },
            assignments: [{ department: { name: "Fußball" } }],
          }],
          total: 1,
          limit: 25,
          offset: 0,
          internal_cursor: "secret",
        } as JsonValue;
      }
      return {
        id: k7MemberId,
        club_id: k7ClubId,
        first_name: "Anna",
        last_name: "Beispiel",
        email: "anna@example.org",
        phone_number: "+49 123 456789",
        birthdate: "1990-01-02",
        address: "Musterweg 1",
        postal_code: "12345",
        city: "Berlin",
        state: "Berlin",
        country: "DE",
        joined_at: "2020-01-01",
        left_at: null,
        user_id: "77777777-7777-4777-8777-777777777777",
        invitation_id: "88888888-8888-4888-8888-888888888888",
        created_at: "2020-01-01T00:00:00Z",
      } as JsonValue;
    })));

    const list = await sets.member.execute({
      action_id: "cai.member.01.list",
      input: { club_id: k7ClubId, limit: 25, offset: 0 },
      context: k7Context(["member.read.basic"]),
      capability_snapshot: k7Capability({ view_members: true }),
    });
    expect(list.result).toEqual({
      items: [{
        member_id: k7MemberId,
        display_name: "Anna Beispiel",
        status_label: "Aktiv",
        department_labels: ["Fußball"],
        email_masked: "a***@e***.org",
        phone_masked: "***6789",
      }],
      total: 1,
      limit: 25,
      offset: 0,
    });
    expect(Object.keys((list.result as { items: Array<Record<string, JsonValue>> }).items[0]!).sort()).toEqual([
      "department_labels", "display_name", "email_masked", "member_id", "phone_masked", "status_label",
    ]);

    const detail = await sets.member.execute({
      action_id: "cai.member.02.show",
      input: { club_id: k7ClubId, member_id: k7MemberId },
      context: k7Context(["member.read.details"]),
      capability_snapshot: k7Capability({ view_members_details: true }),
    });
    expect(Object.keys(detail.result as Record<string, JsonValue>).sort()).toEqual([
      "address", "birthdate", "city", "country", "email", "first_name", "joined_at", "last_name",
      "left_at", "member_id", "phone_number", "postal_code", "state",
    ]);
    expect(JSON.stringify({ list, detail })).not.toContain("user_id");
    expect(JSON.stringify({ list, detail })).not.toContain("invitation_id");
    expect(calls).toEqual([`/members/by_club/${k7ClubId}`, `/members/${k7MemberId}`]);
  });

  test("member writes use Write-Safety and never widen their response to detail fields", async () => {
    let safetyCalls = 0;
    const client = k7Client(async () => ({
      id: k7MemberId,
      club_id: k7ClubId,
      first_name: "Anna",
      last_name: "Beispiel",
      email: "anna@example.org",
      phone_number: "+49 123 456789",
      birthdate: "1990-01-02",
      address: "Musterweg 1",
      user_id: "77777777-7777-4777-8777-777777777777",
    }));
    const dependencies = k7Dependencies(client);
    dependencies.write_safety = {
      async execute(_request, mutation) {
        safetyCalls++;
        return mutation();
      },
    };
    const result = await createK7ToolSets(dependencies).member.execute({
      action_id: "cai.member.03.add",
      input: { club_id: k7ClubId, member: { first_name: "Anna", last_name: "Beispiel" } },
      context: k7Context(["admin.write"]),
      capability_snapshot: k7Capability({ manage_members: true }),
    });
    expect(safetyCalls).toBe(1);
    expect(result.result).toEqual({
      member_id: k7MemberId,
      display_name: "Anna Beispiel",
      status_label: null,
      department_labels: [],
      email_masked: "a***@e***.org",
      phone_masked: "***6789",
    });
  });

  test("redacts payment, subscription, custom and audit fields from club settings", async () => {
    const club = createK7ToolSets(k7Dependencies(k7Client(async () => ({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      club_id: k7ClubId,
      organization_type: "SPORTS_CLUB",
      design_settings: {
        homepage_theme: "modern",
        custom_template_config: { font_pair: "friendly", internal_draft_id: "secret" },
      },
      contact_info: { email: "", phone: "", address: "", website: "", social_media: { facebook: "" } },
      payment_settings: { stripe: { secret_key: "sk_live_secret" } },
      subscription_settings: { plan: { name: "paid" } },
      custom_settings: { internal: "secret" },
      created_by: "77777777-7777-4777-8777-777777777777",
    })))).club;
    const result = await club.execute({
      action_id: "cai.club.03.settings",
      input: { club_id: k7ClubId },
      context: k7Context(["club.read"]),
      capability_snapshot: k7Capability({}),
    });
    expect(result.result).toEqual({
      organization_type: "SPORTS_CLUB",
      design_settings: {
        homepage_theme: "modern",
        custom_template_config: { font_pair: "friendly" },
      },
      contact_info: { email: "", phone: "", address: "", website: "", social_media: { facebook: "" } },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/payment|subscription|custom_settings|secret_key|created_by/iu);
    expect(() => K7_ACTION_SCHEMAS["cai.club.04.settings_update"].input.parse({
      club_id: k7ClubId,
      settings: { payment_settings: { stripe: { secret_key: "x" } } },
    })).toThrow();
  });

  test("validates empty states, pagination bounds and strict input schemas", () => {
    expect(K7_ACTION_SCHEMAS["cai.member.01.list"].input.parse({ club_id: k7ClubId })).toEqual({
      club_id: k7ClubId, limit: 50, offset: 0,
    });
    expect(() => K7_ACTION_SCHEMAS["cai.member.01.list"].input.parse({ club_id: k7ClubId, limit: 101 })).toThrow();
    expect(() => K7_ACTION_SCHEMAS["cai.member.02.show"].input.parse({
      club_id: k7ClubId, member_id: k7MemberId, include_secrets: true,
    })).toThrow();
    expect(K7_ACTION_SCHEMAS["cai.member.01.list"].output.parse({
      items: [], limit: 50, offset: 0, total: 0,
    })).toEqual({ items: [], limit: 50, offset: 0, total: 0 });
  });

  test("TC-06: schemas and definitions expose no login, log-service, master-admin or free secret payload", () => {
    const serialized = JSON.stringify({ definitions: K7_ACTION_DEFINITIONS, ids: K7_ACTION_IDS });
    expect(serialized).not.toMatch(/log-service|log_service|logincommandtool|master.?admin/iu);
    expect(serialized).not.toMatch(/stripe|secret_key|payment_settings|subscription_settings/iu);
  });
});
