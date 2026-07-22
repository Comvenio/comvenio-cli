import { describe, expect, test } from "bun:test";

import {
  createConnectorError,
  type JsonValue,
  type RequestContext,
} from "../src/index.ts";
import {
  FailClosedRecordingComvenioClient,
  type BackendRoutePermissionAuditEntry,
  type RouteTraceFixture,
  type RouteTraceStep,
} from "../../tool-catalog/src/index.ts";
import {
  AnonymousClubResolver,
  PUBLIC_INPUT_SCHEMAS,
  PUBLIC_READ_CONTRACTS,
  PublicAccessPolicy,
  PublicResponseRedactor,
  PublicToolSubset,
  createAuthChallenge,
} from "../../../apps/mcp-server/src/public/index.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const clubId = "33333333-3333-4333-8333-333333333333";
const otherClubId = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const newsId = "66666666-6666-4666-8666-666666666666";

const anonymousContext: RequestContext = {
  request_id: requestId,
  surface: "mcp",
  provider: "openai",
  subject_id: null,
  oauth_grant_id: null,
  club_id: null,
  department_id: null,
  scopes: ["public.read"],
  capability_version: null,
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

const domainStep: RouteTraceStep = {
  sequence: 1,
  http_method: "GET",
  service: "club",
  normalized_path_template: "/public/clubs/by-domain/{domain}",
  request_matcher: {
    path_parameters: { domain: "www.tsv-musterstadt.de" },
    query_parameters: {},
    authorization: "absent",
    content_type: null,
    idempotency_key: "absent",
    body_fixture_ref: null,
    body_match: "exact_rfc8785",
  },
  request_schema_ref: null,
  response_status: 200,
  response_fixture_ref: "fixtures/public/club-by-domain.response.json",
  error_response_fixture_refs: [],
  response_schema_ref: "schemas/public/club-summary.backend.json",
};

const domainAudit: BackendRoutePermissionAuditEntry = {
  audit_id: "audit.public.club.by-domain",
  service: "club",
  http_method: "GET",
  normalized_path_template: "/public/clubs/by-domain/{domain}",
  backend_function: "get_public_club_by_domain",
  source_locator: "club-service/app/routes/public.py:get_public_club_by_domain",
  authentication: "public",
  permission_policy: {
    all_of: [],
    any_of: [],
    owner_or_self_allowed: false,
    department_scope: "forbidden",
    backend_audit_refs: ["audit.public.club.by-domain"],
  },
  classification: "classified",
};

const domainFixture: RouteTraceFixture = {
  contract_version: "1.0.0",
  operation_id: "public.club.by-domain",
  source_branch_locators: ["club-service/app/routes/public.py:get_public_club_by_domain"],
  operation_input_fixture_ref: "fixtures/public/club-by-domain.input.json",
  fixture_clock: "2026-07-21T10:00:00.000Z",
  fixture_ids_ref: "fixtures/public/ids.json",
  execution_client: "FailClosedRecordingComvenioClient",
  steps: [domainStep],
  terminal_output_schema_ref: "schemas/public/club-view.json",
};

describe("public lazy-auth allowlist", () => {
  test("TC-01/TC-02: binds all four entities to public GET routes with absent authorization", async () => {
    const policy = new PublicAccessPolicy();
    expect(policy.list()).toHaveLength(14);
    for (const contract of policy.list()) {
      const trace: RouteTraceStep = {
        ...domainStep,
        service: contract.service,
        normalized_path_template: contract.normalized_path_template,
      };
      const audit: BackendRoutePermissionAuditEntry = {
        ...domainAudit,
        audit_id: `audit.${contract.alias}`,
        service: contract.service,
        normalized_path_template: contract.normalized_path_template,
        permission_policy: {
          ...domainAudit.permission_policy,
          backend_audit_refs: [`audit.${contract.alias}`],
        },
      };
      policy.assertRouteEvidence(contract.alias, { trace, audit });
    }
    expect(() => policy.assertPublishable("public_sponsors")).toThrow("Vertragsdrift");
    policy.assertRouteEvidence("public_club_by_domain", { trace: domainStep, audit: domainAudit });

    const fixtures = new Map<string, any>([
      ["fixtures/public/club-by-domain.response.json", {
        id: clubId,
        name: "TSV Musterstadt",
        slug: "tsv-musterstadt",
      }],
      ["fixtures/public/ids.json", { club_id: clubId }],
    ]);
    const schemas = new Map<string, any>([["schemas/public/club-summary.backend.json", {
      type: "object",
      required: ["id", "name", "slug"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        slug: { type: "string" },
      },
      additionalProperties: false,
    }]]);
    const recordingClient = new FailClosedRecordingComvenioClient({
      fixture: domainFixture,
      fixtures,
      schemas,
      handlers: new Map(),
      context: anonymousContext,
    });
    const resolver = new AnonymousClubResolver({ client: recordingClient, policy });
    const resolution = await resolver.resolve({
      selection: { domain: "www.tsv-musterstadt.de" },
      environment: "production",
      context: anonymousContext,
    });
    expect(recordingClient.consumed_steps).toBe(1);
    expect(resolution.toPublicView()).toEqual({ name: "TSV Musterstadt", slug: "tsv-musterstadt" });
    expect(resolution.upstreamClubId()).toBe(clubId);
    expect(JSON.stringify(resolution)).not.toContain(clubId);

    expect(() => policy.assertRouteEvidence("public_club_by_domain", {
      trace: {
        ...domainStep,
        request_matcher: { ...domainStep.request_matcher, authorization: "fixture_bearer_required" },
      },
      audit: domainAudit,
    })).toThrow("nicht fail-closed");
    expect(() => policy.assertRouteEvidence("public_club_by_domain", {
      trace: domainStep,
      audit: { ...domainAudit, authentication: "jwt" },
    })).toThrow("nicht fail-closed");
    expect(() => policy.assertRouteEvidence("public_club_by_domain", {
      trace: domainStep,
      audit: { ...domainAudit, authentication: "internal" },
    })).toThrow("nicht fail-closed");
  });

  test("TC-03: resolves only exact domain or DEV slug and never serializes internal IDs", async () => {
    const policy = new PublicAccessPolicy();
    const client = {
      timeout_ms: 15_000 as const,
      async request<T extends JsonValue>(): Promise<T> {
        return {
          id: clubId,
          name: "TSV Musterstadt",
          slug: "tsv-musterstadt",
          initial_admin_user_id: "DARF-NICHT-NACH-AUSSEN",
        } as unknown as T;
      },
    };
    const resolver = new AnonymousClubResolver({ client, policy });
    const development = await resolver.resolve({
      selection: { slug: "tsv-musterstadt" },
      environment: "development",
      context: anonymousContext,
    });
    expect(Object.keys(development.toPublicView()).sort()).toEqual(["name", "slug"]);
    await expect(resolver.resolve({
      selection: { slug: "tsv-musterstadt" },
      environment: "production",
      context: anonymousContext,
    })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Die öffentliche Ressource wurde nicht gefunden." });

    const missing = new AnonymousClubResolver({
      policy,
      client: {
        timeout_ms: 15_000 as const,
        async request() {
          throw createConnectorError({
            code: "NOT_FOUND",
            message: "Interner Unterschied darf nicht sichtbar sein.",
            request_id: requestId,
            retryable: false,
          });
        },
      },
    });
    await expect(missing.resolve({
      selection: { domain: "unbekannt.example" },
      environment: "production",
      context: anonymousContext,
    })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Die öffentliche Ressource wurde nicht gefunden." });
  });

  test("TC-04: exposes only verified public reads and keeps the drifted sponsor resolver blocked", () => {
    const subset = new PublicToolSubset();
    const aliases = subset.list().map((tool) => tool.resolver_alias);
    const verifiedAliases = Object.values(PUBLIC_READ_CONTRACTS)
      .filter((contract) => contract.publication_state === "verified")
      .map((contract) => contract.alias);
    expect(aliases.sort()).toEqual(verifiedAliases.sort());
    expect(Object.hasOwn(PUBLIC_READ_CONTRACTS, "public_sponsors")).toBe(true);
    expect(aliases).not.toContain("public_sponsors");
    expect(aliases.some((alias) => /member|role|booking|task|draft|admin/iu.test(alias))).toBe(false);
    expect(subset.list().every((tool) => tool.read_only && tool.required_scopes[0] === "public.read"))
      .toBe(true);
    const boundSubset = new PublicToolSubset({
      public_tools: [{
        tool_name: "cv_public_news",
        resolver_alias: "public_news",
        required_scopes: ["public.read"],
        risk_class: "read",
      }],
    });
    expect(boundSubset.filterCatalog([
      {
        tool_name: "cv_public_news",
        resolver_alias: "public_news" as const,
        required_scopes: ["public.read"] as const,
        risk_class: "read" as const,
      },
      {
        tool_name: "cv_member_read",
        resolver_alias: null,
        required_scopes: ["member.read.basic"] as const,
        risk_class: "read" as const,
      },
      {
        tool_name: "cv_public_write_spoof",
        resolver_alias: "public_news" as const,
        required_scopes: ["public.read"] as const,
        risk_class: "critical_write" as const,
      },
    ]).map((tool) => tool.tool_name)).toEqual(["cv_public_news"]);
    expect(() => new PublicToolSubset({
      public_tools: [{
        tool_name: "cv_public_write_spoof",
        resolver_alias: "public_news",
        required_scopes: ["public.read"],
        risk_class: "critical_write",
      }],
    })).toThrow("nicht als öffentlicher Read-Vertrag");
    expect(() => new PublicAccessPolicy({
      ...PUBLIC_READ_CONTRACTS,
      public_sponsors: {
        ...PUBLIC_READ_CONTRACTS.public_sponsors,
        publication_state: "verified",
      },
    })).toThrow("ungültig");
  });

  test("TC-05: challenges only private, personalized or write tools", () => {
    const subset = new PublicToolSubset({
      protected_tools: [{ tool_name: "cv_member_write", required_scopes: ["member.write"] }],
    });
    expect(subset.classify({ method: "initialize" }).anonymous_allowed).toBe(true);
    expect(subset.classify({
      method: "tools/call",
      params: { name: "public_news", arguments: { club_id: clubId } },
    }).reason).toBe("PUBLIC_TOOL");
    const privateDecision = subset.classify({
      method: "tools/call",
      params: { name: "cv_member_write", arguments: { club_id: clubId } },
    });
    expect(privateDecision).toEqual({
      anonymous_allowed: false,
      required_scopes: ["member.write"],
      reason: "OAUTH_REQUIRED",
    });
    const challenge = createAuthChallenge({
      environment: "production",
      request_id: requestId,
      required_scopes: privateDecision.required_scopes,
    });
    expect(challenge.www_authenticate).toBe(
      "Bearer resource_metadata=\"https://mcp.comvenio.app/.well-known/oauth-protected-resource\", scope=\"member.write\"",
    );
    expect(JSON.stringify(challenge)).not.toMatch(/client_id|token|member_id/iu);
  });

  test("TC-06: drops drafts, foreign tenants, audit fields and unapproved response fields", () => {
    const redactor = new PublicResponseRedactor();
    expect(() => redactor.redact({
      alias: "public_sponsors",
      response: [],
      request_id: requestId,
      expected_club_id: clubId,
    })).toThrow("Vertragsdrift");
    const published = {
      id: newsId,
      club_id: clubId,
      title: "Sommerfest",
      teaser: "Wir feiern gemeinsam.",
      content: "<script>secret()</script><p>Text</p>",
      visibility_scope: "public",
      is_draft: false,
      published_at: "2026-07-21T10:00:00.000Z",
      author_name: "Öffentliches Redaktionsteam",
      created_by: "77777777-7777-4777-8777-777777777777",
      internal_notes: "DARF-NICHT-NACH-AUSSEN",
    };
    const list = redactor.redact({
      alias: "public_news",
      response: [
        published,
        { ...published, id: "88888888-8888-4888-8888-888888888888", is_draft: true },
      ],
      request_id: requestId,
      expected_club_id: clubId,
    });
    expect(list).toEqual([{
      id: newsId,
      title: "Sommerfest",
      summary: "Wir feiern gemeinsam.",
      sanitized_html: null,
      hero_url: null,
      published_at: "2026-07-21T10:00:00.000Z",
      author_display_name: "Öffentliches Redaktionsteam",
    }]);
    expect(JSON.stringify(list)).not.toMatch(/script|created_by|internal_notes|DARF-NICHT/iu);

    expect(() => redactor.redact({
      alias: "public_news_detail",
      response: { ...published, is_draft: true },
      request_id: requestId,
    })).toThrow("nicht gefunden");
    expect(() => redactor.redact({
      alias: "public_news_detail",
      response: null,
      request_id: requestId,
    })).toThrow("nicht gefunden");

    const home = redactor.redact({
      alias: "public_club_home",
      response: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        club_id: clubId,
        label: "Start",
        slug: "start",
        visibility_scope: "public",
        is_active: true,
        created_by: "77777777-7777-4777-8777-777777777777",
        widgets: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            tab_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            club_id: clubId,
            kind: "news",
            title: "Aktuelles",
            position: 0,
            is_active: true,
            config: { internal_filter: "draft" },
          },
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            tab_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            club_id: otherClubId,
            kind: "members",
            title: "Fremdes Widget",
            position: 1,
            is_active: true,
          },
        ],
      }],
      request_id: requestId,
      expected_club_id: clubId,
    });
    expect(JSON.stringify(home)).not.toMatch(/created_by|config|Fremdes Widget/iu);

    const events = redactor.redact({
      alias: "public_events",
      response: [
        { id: eventId, club_id: clubId, title: "Fest", visibility_scope: "public", status: "confirmed" },
        { id: "99999999-9999-4999-8999-999999999999", club_id: otherClubId, title: "Fremd", visibility_scope: "public", status: "confirmed" },
      ],
      request_id: requestId,
      expected_club_id: clubId,
    });
    expect((events as any[]).map((event) => event.id)).toEqual([eventId]);
    expect(PUBLIC_INPUT_SCHEMAS.public_events.safeParse({
      club_id: clubId,
      from: "2026-07-21T00:00:00.000Z",
      to: "2026-07-28T00:00:00.000Z",
      limit: 101,
    }).success).toBe(false);
  });
});
