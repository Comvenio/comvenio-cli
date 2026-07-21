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
import {
  AgendaActionPolicy,
  K9_ACTION_DEFINITIONS,
  K9_ACTION_IDS,
  K9_ACTION_SCHEMAS,
  K9_MEETING_ACTION_IDS,
  K9_TOURNAMENT_ACTION_IDS,
  TournamentJobPolicy,
  createK9ToolSets,
  stableTournamentMatches,
  type K9ExecutionDependencies,
} from "../../../apps/mcp-server/src/tools/meeting-tournament/index.ts";
import {
  AvailabilityContract,
  BookingConflictPolicy,
  K10_ACTION_DEFINITIONS,
  K10_ACTION_IDS,
  K10_ACTION_SCHEMAS,
  K10_BOOKING_ACTION_IDS,
  K10_OBJECT_ACTION_IDS,
  K10_TASK_ACTION_IDS,
  createK10ToolSets,
  minimizeGuestStatistics,
  type K10ExecutionDependencies,
} from "../../../apps/mcp-server/src/tools/booking-object-task/index.ts";

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
    const client = k7Client(async (request): Promise<JsonValue> => {
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

const k9TournamentId = "99999999-9999-4999-8999-999999999999";
const k9AgendaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function k9Dependencies(client: ComvenioApiClient): K9ExecutionDependencies {
  return {
    client,
    write_safety: { async execute(_request, mutation) { return mutation(); } },
    job_starter: { async start() { return { job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "queued" }; } },
  };
}

describe("K9 meeting and tournament adapter contract", () => {
  test("TC-01/TC-02: exposes all required entities and exactly 11/32 action contracts", () => {
    expect(K9_MEETING_ACTION_IDS).toHaveLength(11);
    expect(K9_TOURNAMENT_ACTION_IDS).toHaveLength(32);
    expect(K9_ACTION_IDS).toHaveLength(43);
    expect(Object.keys(K9_ACTION_DEFINITIONS)).toHaveLength(43);
    expect(Object.keys(K9_ACTION_SCHEMAS)).toHaveLength(43);
    expect(new AgendaActionPolicy()).toBeInstanceOf(AgendaActionPolicy);
    expect(new TournamentJobPolicy()).toBeInstanceOf(TournamentJobPolicy);
    const sets = createK9ToolSets(k9Dependencies(k7Client(async () => null)));
    expect(sets.meeting.listDefinitions()).toHaveLength(11);
    expect(sets.tournament.listDefinitions()).toHaveLength(32);
  });

  test("corrects aggregate risk drift and keeps Meeting/Tournament permissions separate", () => {
    const meeting = K9_ACTION_DEFINITIONS["cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr"];
    expect(meeting.operations.list!).toMatchObject({ risk_class: "read", required_scopes: ["meeting.read"] });
    expect(meeting.operations.update!).toMatchObject({ risk_class: "critical_write", execution_gate: "agenda_confirmation", required_scopes: ["meeting.write"] });
    expect(meeting.operations.update!.permission_policy.any_of).toContain("can_manage_agenda_items");
    const participant = K9_ACTION_DEFINITIONS["cai.tournament.14.mannschaft"].operations.create!;
    expect(participant).toMatchObject({ risk_class: "reversible_write", execution_gate: "write_safety", required_scopes: ["event.write"] });
    expect(participant.permission_policy.any_of).toContain("manage_tournament_participants");
  });

  test("TC-03: a participant without meeting-manage rights cannot see agenda mutation branches", () => {
    const meeting = createK9ToolSets(k9Dependencies(k7Client(async () => null))).meeting;
    const definitions = meeting.listVisible({
      context: k8Context(["meeting.read", "meeting.write"]),
      capability_snapshot: k8Capability({ can_view: true }),
    });
    const agenda = definitions.find((definition) => definition.action_id === "cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr");
    expect(Object.keys(agenda?.operations ?? {})).toEqual(["list", "show"]);
  });

  test("TC-04: an agenda mutation has no effect before a matching second confirmation", async () => {
    let patches = 0;
    const meeting = createK9ToolSets(k9Dependencies(k7Client(async (request) => {
      if (request.method === "GET") return { id: k9AgendaId, title: "Bericht des Vorstands", status: "planned" };
      patches++;
      return { id: k9AgendaId, title: "Bericht des Vorstands", status: "updated" };
    }))).meeting;
    const request = {
      action_id: "cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr" as const,
      input: { club_id: k7ClubId, operation: "update" as const, agenda_item_id: k9AgendaId, changes: { title: "Neuer Titel" } },
      context: k8Context(["meeting.write"]),
      capability_snapshot: k8Capability({ can_manage_agenda_items: true }),
    };
    const first = await meeting.execute(request);
    expect(first.status).toBe("confirmation_required");
    expect(patches).toBe(0);
    const preview = (first.result as Record<string, JsonValue>).preview as Record<string, JsonValue>;
    const second = await meeting.execute({ ...request, input: { ...request.input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } } });
    expect(second.status).toBe("completed");
    expect(patches).toBe(1);
  });

  test("TC-05: a large tournament schedule returns a job handle without backend execution", async () => {
    let calls = 0;
    const tournament = createK9ToolSets(k9Dependencies(k7Client(async () => { calls++; return null; }))).tournament;
    const result = await tournament.execute({
      action_id: "cai.tournament.28.schedule_generate",
      input: { club_id: k7ClubId, tournament_id: k9TournamentId, match_minutes: 15, field_count: 4 },
      context: k8Context(["event.write"]),
      capability_snapshot: k8Capability({ manage_tournaments: true }),
    });
    expect(result.status).toBe("queued");
    expect(result.result).toEqual({ job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "queued" });
    expect(calls).toBe(0);
  });

  test("TC-06: multi-day tournament matches preserve timezone, day segments and stable ordering", () => {
    const result = stableTournamentMatches([
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", starts_at: "2026-03-29T23:00:00.000Z", ends_at: "2026-03-30T00:00:00.000Z", match_number: 3 },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", starts_at: "2026-03-28T23:30:00.000Z", ends_at: "2026-03-30T00:30:00.000Z", match_number: 2 },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", starts_at: "2026-03-28T23:30:00.000Z", ends_at: "2026-03-29T00:00:00.000Z", match_number: 1 },
    ], "Europe/Berlin") as Record<string, JsonValue>;
    expect((result.items as Array<Record<string, JsonValue>>).map((match) => match.id)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    expect((result.items as Array<Record<string, JsonValue>>)[1]!.day_segments).toHaveLength(2);
    expect(result.timezone).toBe("Europe/Berlin");
  });

  test("minimizes participant data and accepts remote file IDs instead of local paths", async () => {
    const tournament = createK9ToolSets(k9Dependencies(k7Client(async () => [{
      id: k7MemberId, name: "Anna Beispiel", participant_kind: "individual", registration_status: "confirmed",
      member_id: k7MemberId, captain_member_id: k7MemberId, email: "anna@example.org", phone: "+49 123", participant_metadata: { secret: "hidden" },
    }]))).tournament;
    const result = await tournament.execute({
      action_id: "cai.tournament.13.participants",
      input: { club_id: k7ClubId, tournament_id: k9TournamentId },
      context: k8Context(["event.read"]),
      capability_snapshot: k8Capability({ view_tournaments: true }),
    });
    expect(result.result).toEqual({ items: [{ participant_id: k7MemberId, name: "Anna Beispiel", participant_kind: "individual", registration_status: "confirmed" }], returned: 1, truncated: false });
    expect(JSON.stringify(result)).not.toMatch(/member_id|email|phone|metadata|secret/iu);
    expect(K9_ACTION_SCHEMAS["cai.meeting.11.attachment_list_add_remove"].input.parse({ club_id: k7ClubId, operation: "add", entry_id: k9AgendaId, file_id: k7MemberId })).toMatchObject({ file_id: k7MemberId });
    expect(() => K9_ACTION_SCHEMAS["cai.meeting.11.attachment_list_add_remove"].input.parse({ club_id: k7ClubId, operation: "add", entry_id: k9AgendaId, file_id: "C:\\private\\protocol.pdf" })).toThrow();
    expect(JSON.stringify(K9_ACTION_DEFINITIONS)).not.toMatch(/log-service|log_service|meetinglogtool|synchronoustournamentbulkrun/iu);
  });
});

const k10ObjectId = "12121212-1212-4212-8212-121212121212";
const k10ReservationId = "13131313-1313-4313-8313-131313131313";

function k10Dependencies(client: ComvenioApiClient): K10ExecutionDependencies {
  return {
    client,
    write_safety: { async execute(_request, mutation) { return mutation(); } },
  };
}

describe("K10 booking, object and task adapter contract", () => {
  test("TC-01/TC-02: exposes all required entities and exactly 12/9/14 action contracts", () => {
    expect(K10_BOOKING_ACTION_IDS).toHaveLength(12);
    expect(K10_OBJECT_ACTION_IDS).toHaveLength(9);
    expect(K10_TASK_ACTION_IDS).toHaveLength(14);
    expect(K10_ACTION_IDS).toHaveLength(35);
    expect(Object.keys(K10_ACTION_DEFINITIONS)).toHaveLength(35);
    expect(Object.keys(K10_ACTION_SCHEMAS)).toHaveLength(35);
    const client = k7Client(async () => []);
    const availability = new AvailabilityContract(client);
    expect(new BookingConflictPolicy(availability)).toBeInstanceOf(BookingConflictPolicy);
    const sets = createK10ToolSets(k10Dependencies(client));
    expect(sets.booking.listDefinitions()).toHaveLength(12);
    expect(sets.object.listDefinitions()).toHaveLength(9);
    expect(sets.task.listDefinitions()).toHaveLength(14);
  });

  test("TC-03: booking reads require an explicit club, bounded range and IANA timezone", () => {
    const schema = K10_ACTION_SCHEMAS["cai.booking.01.list"].input;
    expect(schema.parse({
      club_id: k7ClubId,
      operation: "list",
      from: "2026-07-21T08:00:00+02:00",
      to: "2026-07-21T18:00:00+02:00",
      timezone: "Europe/Berlin",
    })).toMatchObject({ club_id: k7ClubId, timezone: "Europe/Berlin", limit: 50, offset: 0 });
    expect(() => schema.parse({ club_id: k7ClubId, operation: "list", timezone: "Europe/Berlin" })).toThrow();
    expect(() => schema.parse({ club_id: k7ClubId, operation: "list", from: "2026-07-21", to: "2026-07-22", timezone: "GMT+2" })).toThrow();
  });

  test("TC-04: a conflict introduced after preview prevents every booking mutation", async () => {
    let reservationReads = 0;
    let posts = 0;
    const client = k7Client(async (request): Promise<JsonValue> => {
      if (request.method === "POST") {
        posts++;
        return { id: k10ReservationId, club_id: k7ClubId, object_id: k10ObjectId };
      }
      if (request.path === `/objects/${k10ObjectId}`) return {
        id: k10ObjectId, club_id: k7ClubId, name: "Vereinsheim", is_active: true, booking_granularity: "30min", min_duration_minutes: 30, max_duration_minutes: 480,
      };
      if (request.path === `/object-reservations/object/${k10ObjectId}`) {
        reservationReads++;
        return reservationReads === 1 ? [] : [{
          id: "14141414-1414-4414-8414-141414141414", club_id: k7ClubId, object_id: k10ObjectId,
          start_time: "2026-07-21T10:30:00+02:00", end_time: "2026-07-21T11:30:00+02:00", status: "approved",
          title: "Private Buchung", resp_member_id: k7MemberId,
        }];
      }
      if (request.path === `/object-booking-rules/object/${k10ObjectId}`) return [];
      return null;
    });
    const booking = createK10ToolSets(k10Dependencies(client)).booking;
    const request = {
      action_id: "cai.booking.03.create" as const,
      input: {
        club_id: k7ClubId, object_id: k10ObjectId,
        start_time: "2026-07-21T10:00:00+02:00", end_time: "2026-07-21T12:00:00+02:00", timezone: "Europe/Berlin", title: "Training",
      },
      context: k8Context(["booking.write", "object.read"]),
      capability_snapshot: k8Capability({}),
    };
    const first = await booking.execute(request);
    expect(first.status).toBe("confirmation_required");
    expect(posts).toBe(0);
    const preview = (first.result as Record<string, JsonValue>).preview as Record<string, JsonValue>;
    expect(JSON.stringify(preview)).not.toMatch(/Private Buchung|resp_member_id/iu);
    await expect(booking.execute({
      ...request,
      input: { ...request.input, confirmation: { preview_id: preview.preview_id, confirmation_token: preview.confirmation_token } },
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(posts).toBe(0);
  });

  test("TC-05: users without object management can read objects but cannot see write actions", () => {
    const object = createK10ToolSets(k10Dependencies(k7Client(async () => []))).object;
    const visible = object.listVisible({
      context: k8Context(["object.read", "object.write"]),
      capability_snapshot: k8Capability({}),
    });
    expect(visible.map((definition) => definition.action_id)).toContain("cai.object.01.list");
    expect(visible.map((definition) => definition.action_id)).not.toContain("cai.object.03.create");
    expect(visible.map((definition) => definition.action_id)).not.toContain("cai.object.04.update");
  });

  test("TC-06: schemas exclude implicit reservations, cross-club task moves, logs and free payloads", () => {
    expect(() => K10_ACTION_SCHEMAS["cai.task.07.update"].input.parse({
      club_id: k7ClubId, task_id: k10ReservationId, changes: { task_context_id: k10ObjectId },
    })).toThrow();
    expect(() => K10_ACTION_SCHEMAS["cai.booking.03.create"].input.parse({
      club_id: k7ClubId, object_id: k10ObjectId, start_time: "2026-07-21T10:00:00+02:00", end_time: "2026-07-21T12:00:00+02:00",
      timezone: "Europe/Berlin", reservation_hold: true,
    })).toThrow();
    const serialized = JSON.stringify(K10_ACTION_DEFINITIONS);
    expect(serialized).not.toMatch(/log-service|log_service|implicitreservation|crossclubtaskmove/iu);
    expect(serialized).not.toMatch(/local_path|file_path|credential|secret/iu);
  });

  test("guest statistics are aggregate-only and omit guest/member identifiers", () => {
    const result = minimizeGuestStatistics({
      club_id: k7ClubId, total_guests: 2, total_fee: 10,
      members: [{ resp_member_id: k7MemberId, total_guests: 2, total_bookings_with_guests: 1, total_fee: 10, guests: [{ guest_name: "Privat", guest_email: "privat@example.org" }] }],
    });
    expect(result).toEqual({
      club_id: k7ClubId, from_date: null, to_date: null, total_guests: 2, total_fee: 10,
      members: [{ total_guests: 2, total_bookings_with_guests: 1, total_fee: 10 }], truncated: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/resp_member_id|guest_name|guest_email|privat@example/iu);
  });
});
