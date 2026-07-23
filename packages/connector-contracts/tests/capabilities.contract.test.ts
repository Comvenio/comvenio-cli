import { describe, expect, test } from "bun:test";

import type { RequestContext } from "@comvenio/connector-contracts";
import {
  CapabilityContractError,
  CapabilitySnapshotCache,
  PermissionsExplainTool,
  ToolVisibilityPolicy,
  buildEffectivePermissionSelfPath,
  computeCapabilityVersion,
  createCapabilitySnapshot,
  validateEffectivePermissionRead,
  type ConnectorEffectivePermissionRead,
} from "../../auth/src/index.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const clubId = "44444444-4444-4444-8444-444444444444";
const otherClubId = "55555555-5555-4555-8555-555555555555";
const departmentId = "66666666-6666-4666-8666-666666666666";
const fixedNow = new Date("2026-07-21T10:10:00.000Z");

function effectiveRead(generatedAt = fixedNow.toISOString()): ConnectorEffectivePermissionRead {
  const unsigned: ConnectorEffectivePermissionRead = {
    member_id: memberId,
    club_id: clubId,
    department_ids: [departmentId],
    permissions: {
      manage_members: false,
      view_members: true,
    },
    sources: [{
      permission_key: "view_members",
      allowed: true,
      scope: "department",
      department_id: departmentId,
      assignment_type: "direct",
    }, {
      permission_key: "manage_members",
      allowed: false,
      scope: "club",
      department_id: null,
      assignment_type: "position",
    }],
    capability_version: "A".repeat(43),
    generated_at: generatedAt,
  };
  return { ...unsigned, capability_version: computeCapabilityVersion(unsigned) };
}

function snapshot() {
  return createCapabilitySnapshot({
    subject_id: subjectId,
    response: effectiveRead(),
    observed_at: fixedNow,
  });
}

function context(capabilityVersion = snapshot().capability_version): RequestContext {
  return {
    request_id: requestId,
    surface: "mcp",
    provider: "openai",
    subject_id: subjectId,
    oauth_grant_id: "77777777-7777-4777-8777-777777777777",
    club_id: clubId,
    department_id: departmentId,
    scopes: ["member.read.basic", "member.write", "role.read.self"],
    capability_version: capabilityVersion,
    locale: "de-DE",
    timezone: "Europe/Berlin",
  };
}

describe("effective permission self contract", () => {
  test("normalizes exact own capability data and rejects role or assignment leakage", () => {
    const normalized = validateEffectivePermissionRead(effectiveRead());
    expect(normalized.department_ids).toEqual([departmentId]);
    expect(normalized.sources.map((source) => source.permission_key)).toEqual([
      "manage_members",
      "view_members",
    ]);

    expect(() => validateEffectivePermissionRead({
      ...effectiveRead(),
      role_id: "88888888-8888-4888-8888-888888888888",
    })).toThrow("unerlaubte oder fehlende Felder");
    expect(() => validateEffectivePermissionRead({
      ...effectiveRead(),
      department_ids: [departmentId, departmentId],
    })).toThrow("Duplikate");
  });

  test("binds the capability version to sorted JCS-shaped content", () => {
    const first = effectiveRead();
    const reordered = {
      ...first,
      permissions: { view_members: true, manage_members: false },
      sources: [...first.sources].reverse(),
    };
    expect(computeCapabilityVersion(first)).toBe(computeCapabilityVersion(reordered));
    expect(computeCapabilityVersion({
      ...first,
      permissions: { ...first.permissions, manage_members: true },
    })).not.toBe(first.capability_version);
    expect(() => createCapabilitySnapshot({
      subject_id: subjectId,
      response: { ...first, capability_version: "B".repeat(43) },
      observed_at: fixedNow,
    })).toThrow("stimmt nicht");
  });

  test("matches the role-service digest and accepts FastAPI UTC precision", () => {
    const otherDepartmentId = "77777777-7777-4777-8777-777777777777";
    const roleServiceRead: ConnectorEffectivePermissionRead = {
      member_id: memberId,
      club_id: clubId,
      department_ids: [otherDepartmentId, departmentId],
      permissions: { view_members: true },
      sources: [{
        permission_key: "view_members",
        allowed: true,
        scope: "department",
        department_id: otherDepartmentId,
        assignment_type: "position",
      }, {
        permission_key: "view_members",
        allowed: false,
        scope: "department",
        department_id: otherDepartmentId,
        assignment_type: "position",
      }, {
        permission_key: "view_members",
        allowed: true,
        scope: "club",
        department_id: null,
        assignment_type: "direct",
      }, {
        permission_key: "view_members",
        allowed: false,
        scope: "club",
        department_id: null,
        assignment_type: "position",
      }, {
        permission_key: "view_members",
        allowed: false,
        scope: "department",
        department_id: departmentId,
        assignment_type: "direct",
      }, {
        permission_key: "view_members",
        allowed: false,
        scope: "club",
        department_id: null,
        assignment_type: "direct",
      }],
      capability_version: "rbwuEmmAqKgGYscAiXI1MFR5x8gBGl6yHmJunRjYHfg",
      generated_at: "2026-07-21T10:10:00.123456Z",
    };
    expect(computeCapabilityVersion(roleServiceRead))
      .toBe(roleServiceRead.capability_version);
    expect(validateEffectivePermissionRead(roleServiceRead).generated_at)
      .toBe("2026-07-21T10:10:00.123Z");

    expect(validateEffectivePermissionRead({
      ...roleServiceRead,
      generated_at: "2026-07-21T10:10:00.123456+00:00",
    }).generated_at).toBe("2026-07-21T10:10:00.123Z");
    for (const generatedAt of [
      "2026-07-21T11:10:00.123456+01:00",
      "2026-02-30T10:10:00Z",
      "2026-07-21T24:00:00Z",
    ]) {
      expect(() => validateEffectivePermissionRead({
        ...roleServiceRead,
        generated_at: generatedAt,
      })).toThrow("Erzeugungszeitpunkt");
    }
  });

  test("supports an empty effective permission state without widening access", () => {
    const empty = effectiveRead();
    empty.permissions = {};
    empty.sources = [];
    empty.department_ids = [];
    empty.capability_version = computeCapabilityVersion(empty);
    expect(validateEffectivePermissionRead(empty).permissions).toEqual({});
  });

  test("builds only the authenticated self endpoint and never accepts a member id", () => {
    expect(buildEffectivePermissionSelfPath({ club_id: clubId, department_id: departmentId }))
      .toBe(`/permissions/effective/self?club_id=${clubId}&department_id=${departmentId}`);
    expect(buildEffectivePermissionSelfPath({ club_id: clubId })).not.toContain("member_id");
  });
});

describe("capability snapshot cache", () => {
  test("single-flights reads, expires after at most 30 seconds and never serves stale fallback", async () => {
    let nowMs = fixedNow.getTime();
    let calls = 0;
    const cache = new CapabilitySnapshotCache({
      readSelf: async () => {
        calls += 1;
        return effectiveRead(new Date(nowMs).toISOString());
      },
    }, () => new Date(nowMs));
    const requestContext = { ...context(), capability_version: null };
    const [first, parallel] = await Promise.all([
      cache.read({ context: requestContext }),
      cache.read({ context: requestContext }),
    ]);
    expect(first.state).toBe("MISS_RELOADED");
    expect(parallel.snapshot.capability_version).toBe(first.snapshot.capability_version);
    expect(calls).toBe(1);
    nowMs += 29_000;
    expect((await cache.read({ context: requestContext })).state).toBe("HIT");
    nowMs += 1_001;
    expect((await cache.read({ context: requestContext })).state).toBe("EXPIRED_RELOADED");
    expect(calls).toBe(2);
  });

  test("reloads on widget version drift, before every write and after a backend 403", async () => {
    let calls = 0;
    const cache = new CapabilitySnapshotCache({
      readSelf: async () => {
        calls += 1;
        return effectiveRead();
      },
    }, () => fixedNow);
    const requestContext = { ...context(), capability_version: null };
    await cache.read({ context: requestContext });
    expect((await cache.read({
      context: requestContext,
      widget_capability_version: "Z".repeat(43),
    })).state).toBe("VERSION_STALE_RELOADED");
    expect((await cache.beforeWrite(requestContext)).state).toBe("WRITE_RECHECK");
    cache.invalidateAfterForbidden(requestContext);
    expect((await cache.read({ context: requestContext })).state).toBe("MISS_RELOADED");
    expect(calls).toBe(4);
  });

  test("fails closed for a cross-tenant self response", async () => {
    const cache = new CapabilitySnapshotCache({
      readSelf: async () => {
        const read = { ...effectiveRead(), club_id: otherClubId };
        read.capability_version = computeCapabilityVersion(read);
        return read;
      },
    }, () => fixedNow);
    await expect(cache.read({ context: { ...context(), capability_version: null } }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });
});

describe("tool visibility and own explanation", () => {
  const readTool = {
    tool_name: "cv_member_read_view_members_12345678",
    required_scopes: ["member.read.basic" as const],
    permission_policy: {
      all_of: ["view_members"],
      any_of: [],
      owner_or_self_allowed: false,
      department_scope: "optional" as const,
    },
    is_public: false,
  };

  test("combines catalog, scope, tenant, version and capability without role-name inference", () => {
    const policy = new ToolVisibilityPolicy(() => fixedNow);
    const allowed = policy.evaluate({
      tool: readTool,
      context: context(),
      snapshot: snapshot(),
      provider_tool_updates: "dynamic",
      catalog_contains_tool: true,
    });
    expect(allowed).toEqual({ visible: true, authorized: true, reason: "VISIBLE" });
    expect(policy.evaluate({
      tool: { ...readTool, permission_policy: { ...readTool.permission_policy, all_of: ["manage_members"] } },
      context: context(),
      snapshot: snapshot(),
      provider_tool_updates: "dynamic",
      catalog_contains_tool: true,
    }).reason).toBe("PERMISSION_REQUIRED");
  });

  test("hides dynamic discovery for static providers but still permits a cached call to be rechecked", () => {
    const decision = new ToolVisibilityPolicy(() => fixedNow).evaluate({
      tool: readTool,
      context: context(),
      snapshot: snapshot(),
      provider_tool_updates: "stable_cached",
      catalog_contains_tool: true,
    });
    expect(decision).toEqual({
      visible: false,
      authorized: true,
      reason: "PROVIDER_STATIC_TOOLSET",
    });
  });

  test("permissions_explain contains only safe own capability provenance", () => {
    const result = new PermissionsExplainTool(() => fixedNow).execute({
      club_id: clubId,
      department_id: departmentId,
    }, context(), snapshot());
    expect(result.structuredContent.allowed_capabilities).toEqual(["view_members"]);
    expect(result.structuredContent.denied_capabilities).toEqual(["manage_members"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(memberId);
    expect(serialized).not.toContain("role_id");
    expect(serialized).not.toContain("assignment_id");
    expect(() => new PermissionsExplainTool(
      () => new Date(fixedNow.getTime() + 30_001),
    ).execute({
      club_id: clubId,
      department_id: departmentId,
    }, context(), snapshot())).toThrow("nicht abgelaufenen");
  });

  test("capability errors serialize without response bodies or identifiers", () => {
    const error = new CapabilityContractError("PERMISSION_DENIED", `secret:${memberId}`);
    expect(error.toJSON()).toEqual({ error: "PERMISSION_DENIED" });
  });
});
