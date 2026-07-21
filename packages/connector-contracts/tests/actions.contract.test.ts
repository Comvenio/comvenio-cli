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
import {
  EventConfirmationPolicy,
  K8_ACTION_DEFINITIONS,
  K8_ACTION_IDS,
  K8_ACTION_SCHEMAS,
  K8_EVENT_ACTION_IDS,
  K8_PLAN_ACTION_IDS,
  createK8ToolSets,
  eventDaySegments,
  localDateBoundaryUtc,
  publicCalendarEvent,
  redactEventPlanValue,
  type K8ExecutionDependencies,
} from "../../../apps/mcp-server/src/tools/event-plan/index.ts";

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

const k8EventId = "77777777-7777-4777-8777-777777777777";
const k8PlanId = "88888888-8888-4888-8888-888888888888";

function k8Context(scopes: OAuthScope[]): RequestContext {
  return {
    request_id: "11111111-1111-4111-8111-111111111111",
    surface: "mcp",
    provider: "anthropic",
    subject_id: k7SubjectId,
    oauth_grant_id: k7GrantId,
    club_id: k7ClubId,
    department_id: null,
    scopes,
    capability_version: "E".repeat(43),
    locale: "de-DE",
    timezone: "Europe/Berlin",
  };
}

function k8Capability(permissions: Record<string, boolean>): CapabilitySnapshot {
  return {
    subject_id: k7SubjectId,
    member_id: k7MemberId,
    club_id: k7ClubId,
    department_ids: [],
    permissions,
    sources: [],
    capability_version: "E".repeat(43),
    generated_at: "2026-07-21T12:00:00.000Z",
    observed_at: "2026-07-21T12:00:00.000Z",
    expires_at: "2099-07-21T12:05:00.000Z",
  };
}

function k8Dependencies(client: ComvenioApiClient): K8ExecutionDependencies {
  return {
    client,
    write_safety: { async execute(_request, mutation) { return mutation(); } },
    job_starter: { async start() { return { job_id: "99999999-9999-4999-8999-999999999999", status: "queued" }; } },
  };
}

describe("K8 event and plan adapter contract", () => {
  test("TC-01/TC-02: exposes EventToolSet, PlanToolSet, preview policy and exactly 28/13 action contracts", () => {
    expect(K8_EVENT_ACTION_IDS).toHaveLength(28);
    expect(K8_PLAN_ACTION_IDS).toHaveLength(13);
    expect(K8_ACTION_IDS).toHaveLength(41);
    expect(Object.keys(K8_ACTION_DEFINITIONS)).toHaveLength(41);
    expect(Object.keys(K8_ACTION_SCHEMAS)).toHaveLength(41);
    expect(new EventConfirmationPolicy()).toBeInstanceOf(EventConfirmationPolicy);

    const sets = createK8ToolSets(k8Dependencies(k7Client(async () => null)));
    expect(sets.event.listDefinitions()).toHaveLength(28);
    expect(sets.plan.listDefinitions()).toHaveLength(13);
    for (const definition of Object.values(K8_ACTION_DEFINITIONS)) {
      expect(Object.keys(definition.operations).length).toBeGreaterThan(0);
    }
  });

  test("uses branch-specific write policies instead of legacy aggregate read metadata", () => {
    const sponsor = K8_ACTION_DEFINITIONS["cai.event.18.sponsor_and_sponsor_program_workflows"];
    expect(sponsor.operations.link_list!).toMatchObject({ risk_class: "read", required_scopes: ["event.read"] });
    expect(sponsor.operations.link_add!).toMatchObject({ risk_class: "reversible_write", required_scopes: ["event.write"] });
    expect(sponsor.operations.link_delete!).toMatchObject({ risk_class: "critical_write", execution_gate: "event_confirmation" });
    expect(K8_ACTION_DEFINITIONS["cai.plan.10.detail"].operations.create!).toMatchObject({
      risk_class: "reversible_write",
      required_scopes: ["event.write"],
    });
    expect(K8_ACTION_DEFINITIONS["cai.plan.11.export"].operations.export!.required_scopes).toEqual(["files.export", "event.read"]);
  });

  test("TC-03: minimizes public calendar data and rejects untyped or invalid time input", () => {
    const result = publicCalendarEvent({
      id: k8EventId,
      club_id: k7ClubId,
      department_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Sommerfest",
      description: "Öffentlich",
      location: "Vereinsheim",
      start_time: "2026-03-28T23:30:00.000Z",
      end_time: "2026-03-30T00:30:00.000Z",
      event_type: "party",
      status: "confirmed",
      created_by: k7SubjectId,
      external_email: "private@example.org",
    }, "Europe/Berlin") as Record<string, JsonValue>;
    expect(Object.keys(result).sort()).toEqual([
      "day_segments", "description", "end_time", "event_type", "location", "start_time", "status", "timezone", "title",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/club_id|department_id|created_by|external_email|private@example/iu);
    expect(() => K8_ACTION_SCHEMAS["cai.event.01.list"].input.parse({
      club_id: k7ClubId,
      range: { from: "2026-07-01", to: "2026-08-01", timezone: "GMT+2" },
    })).toThrow();
    expect(() => K8_ACTION_SCHEMAS["cai.event.02.show"].input.parse({ club_id: k7ClubId, event_id: k8EventId, include_tokens: true })).toThrow();
  });

  test("TC-05: publish/delete produce a server-side preview and mutate only after a matching second confirmation", async () => {
    let patches = 0;
    const client = k7Client(async (request) => {
      if (request.method === "GET") return { id: k8EventId, title: "Sommerfest", status: "draft", visibility_scope: "member" };
      if (request.method === "PATCH") {
        patches++;
        return { id: k8EventId, title: "Sommerfest", status: "confirmed", visibility_scope: "public" };
      }
      return null;
    });
    const event = createK8ToolSets(k8Dependencies(client)).event;
    const request = {
      action_id: "cai.event.05.publish" as const,
      input: { club_id: k7ClubId, event_id: k8EventId, make_public: true },
      context: k8Context(["event.write"]),
      capability_snapshot: k8Capability({ manage_events: true }),
    };
    const first = await event.execute(request);
    expect(first.status).toBe("confirmation_required");
    expect(patches).toBe(0);
    const preview = ((first.result as Record<string, JsonValue>).preview as Record<string, JsonValue>);
    expect(preview).toMatchObject({ action_id: request.action_id, operation: "publish", subject: "Sommerfest" });

    const second = await event.execute({
      ...request,
      input: {
        ...request.input,
        confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token },
      },
    });
    expect(second.status).toBe("completed");
    expect(patches).toBe(1);
  });

  test("TC-06: preserves local calendar days across the Europe/Berlin DST transition", () => {
    expect(localDateBoundaryUtc("2026-03-29", "Europe/Berlin")).toBe("2026-03-28T23:00:00.000Z");
    expect(localDateBoundaryUtc("2026-03-30", "Europe/Berlin")).toBe("2026-03-29T22:00:00.000Z");
    expect(eventDaySegments("2026-03-28T23:30:00.000Z", "2026-03-30T00:30:00.000Z", "Europe/Berlin"))
      .toEqual([
        { local_date: "2026-03-29", timezone: "Europe/Berlin", starts_on_day: true, ends_on_day: false },
        { local_date: "2026-03-30", timezone: "Europe/Berlin", starts_on_day: false, ends_on_day: true },
      ]);
  });

  test("file-producing plan actions accept remote file IDs and never local paths", () => {
    expect(K8_ACTION_SCHEMAS["cai.plan.13.compose"].input.parse({
      club_id: k7ClubId,
      event_id: k8EventId,
      plan_id: k8PlanId,
      illustration_file_id: "99999999-9999-4999-8999-999999999999",
    })).toMatchObject({ draw_lines: true, output_format: "png" });
    expect(() => K8_ACTION_SCHEMAS["cai.plan.13.compose"].input.parse({
      club_id: k7ClubId,
      event_id: k8EventId,
      plan_id: k8PlanId,
      illustration_file_id: "C:\\private\\plan.png",
    })).toThrow();
    expect(JSON.stringify({ definitions: K8_ACTION_DEFINITIONS, schemas: Object.keys(K8_ACTION_SCHEMAS) }))
      .not.toMatch(/readFileSync|frontend-base|playwright-cli|--out|local_path/iu);
  });

  test("redacts nested tokens, credentials and attendee identifiers independent of key spelling", () => {
    const safe = redactEventPlanValue({
      id: k8EventId,
      OAuthToken: "secret-token",
      api_key: "secret-api-key",
      nested: {
        invitation_token_hash: "secret-hash",
        assigned_user_id: k7SubjectId,
        member_id: k7MemberId,
        external_email: "anna@example.org",
        external_name: "Anna Beispiel",
      },
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toMatch(/secret-token|secret-api-key|secret-hash|assigned_user_id|member_id|anna@example|Anna Beispiel/iu);
    expect(serialized).toContain("external_email_masked");
  });
});
