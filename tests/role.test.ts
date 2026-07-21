import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyPermissions,
  buildPatchPreview,
  buildReplacePreview,
  buildRoleAssignmentBody,
  ensureRoleIsMutable,
  parseAllowed,
} from "../src/commands/role.ts";

describe("role assignment safety", () => {
  test("builds a club-scoped assignment from stable IDs", () => {
    expect(buildRoleAssignmentBody("club-1", {
      memberId: "member-1",
      roleId: "role-1",
      scope: "club",
    })).toEqual({
      club_id: "club-1",
      member_id: "member-1",
      role_id: "role-1",
      scope: "club",
      department_id: undefined,
    });
  });

  test("requires a department ID for department scope", () => {
    expect(() => buildRoleAssignmentBody("club-1", {
      memberId: "member-1",
      roleId: "role-1",
      scope: "department",
    })).toThrow("--department-id");
  });

  test("rejects a department ID for club scope", () => {
    expect(() => buildRoleAssignmentBody("club-1", {
      memberId: "member-1",
      roleId: "role-1",
      scope: "club",
      departmentId: "department-1",
    })).toThrow("darf nicht");
  });
});

describe("role permission safety", () => {
  test("accepts only explicit boolean flag values", () => {
    expect(parseAllowed("true")).toBe(true);
    expect(parseAllowed("false")).toBe(false);
    expect(() => parseAllowed("yes")).toThrow("true oder false");
  });

  test("builds a complete replacement preview", () => {
    const preview = buildReplacePreview(
      [
        { id: "p1", role_id: "r1", permission_key: "manage_events", allowed: true },
        { id: "p2", role_id: "r1", permission_key: "manage_finances", allowed: true },
      ],
      [
        { key: "manage_events", description: "Events", module: "event" },
        { key: "manage_finances", description: "Finanzen", module: "finance" },
        { key: "manage_roles", description: "Rollen", module: "role" },
      ],
      { manage_events: true },
    );

    expect(preview.before).toEqual({
      manage_events: true,
      manage_finances: true,
      manage_roles: false,
    });
    expect(preview.after).toEqual({
      manage_events: true,
      manage_finances: false,
      manage_roles: false,
    });
    expect(preview.diff.find((row) => row.permission_key === "manage_finances")?.changed).toBe(true);
  });

  test("builds a patch preview without clearing omitted permissions", () => {
    const preview = buildPatchPreview(
      [
        { id: "p1", role_id: "r1", permission_key: "manage_events", allowed: true },
        { id: "p2", role_id: "r1", permission_key: "manage_roles", allowed: false },
      ],
      [
        { key: "manage_events", description: "Events", module: "event" },
        { key: "manage_roles", description: "Rollen", module: "role" },
      ],
      { manage_roles: true },
    );

    expect(preview.after).toEqual({ manage_events: true, manage_roles: true });
    expect(preview.diff.filter((row) => row.changed).map((row) => row.permission_key))
      .toEqual(["manage_roles"]);
  });

  test("replace reads the matrix in the same run and writes against the preview", async () => {
    const reads: string[] = [];
    const events: string[] = [];
    let posted: unknown;
    const client = {
      get: async (_service: string, path: string) => {
        reads.push(path);
        if (path.startsWith("/permissions/by-role/")) {
          return [{ id: "p1", role_id: "r1", permission_key: "manage_events", allowed: false }];
        }
        return [{ key: "manage_events", description: "Events", module: "event" }];
      },
      post: async (_service: string, _path: string, body: unknown) => {
        events.push("post");
        posted = body;
        return {
          role_id: "r1",
          mode: "replace",
          before: { manage_events: false },
          after: { manage_events: true },
          changed: ["manage_events"],
          changes: [{ permission_key: "manage_events", before: false, after: true }],
        };
      },
    };

    const application = await applyPermissions(client as never, "r1", {
      file: join(import.meta.dir, "fixtures", "role-matrix.json"),
      replace: true,
      yes: true,
    }, () => events.push("preflight"));

    expect(reads).toEqual([
      "/permissions/by-role/r1",
      "/permission-definitions/",
    ]);
    expect(posted).toEqual({
      values: { manage_events: true },
      replace: true,
      expected_before: { manage_events: false },
    });
    expect(application.kind).toBe("applied");
    expect(events).toEqual(["preflight", "post"]);
    if (application.kind === "applied") expect(application.preview).toBeDefined();
  });

  test("patch emits preflight before writing and uses optimistic evidence", async () => {
    const events: string[] = [];
    let posted: unknown;
    const client = {
      get: async (_service: string, path: string) => path.startsWith("/permissions/by-role/")
        ? [{ id: "p1", role_id: "r1", permission_key: "manage_events", allowed: false }]
        : [{ key: "manage_events", description: "Events", module: "event" }],
      post: async (_service: string, _path: string, body: unknown) => {
        events.push("post");
        posted = body;
        return {
          role_id: "r1",
          mode: "patch",
          before: { manage_events: false },
          after: { manage_events: true },
          changed: ["manage_events"],
          changes: [{ permission_key: "manage_events", before: false, after: true }],
        };
      },
    };

    const application = await applyPermissions(client as never, "r1", {
      file: join(import.meta.dir, "fixtures", "role-matrix.json"),
      replace: false,
      yes: false,
    }, (evidence) => {
      events.push("preflight");
      expect(evidence.current).toEqual({ manage_events: false });
    });

    expect(events).toEqual(["preflight", "post"]);
    expect(posted).toEqual({
      values: { manage_events: true },
      replace: false,
      expected_before: { manage_events: false },
    });
    expect(application.kind).toBe("applied");
  });

  test("replace preview never posts without confirmation", async () => {
    let posts = 0;
    const client = {
      get: async (_service: string, path: string) => path.startsWith("/permissions/by-role/")
        ? []
        : [{ key: "manage_events", description: "Events", module: "event" }],
      post: async () => {
        posts += 1;
        return {};
      },
    };

    const application = await applyPermissions(client as never, "r1", {
      file: join(import.meta.dir, "fixtures", "role-matrix.json"),
      replace: true,
      yes: false,
    });

    expect(application.kind).toBe("preview");
    expect(posts).toBe(0);
  });

  test("blocks protected roles before a write", () => {
    expect(() => ensureRoleIsMutable({ name: "Mitglied", is_protected: true }))
      .toThrow("geschützte Rolle");
    expect(() => ensureRoleIsMutable({ name: "Kasse", is_protected: false }))
      .not.toThrow();
  });
});

describe("role machine-readable schema", () => {
  test("publishes matrix, assignment and effective workflows", () => {
    const schema = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "src", "schema", "role.json"), "utf8"),
    );

    expect(schema.commands.permissions).toContain(
      "role permissions apply --role-id <id> --file <matrix.json> --replace --yes",
    );
    expect(schema.commands.assignments.some((command: string) => command.includes("--scope club|department"))).toBe(true);
    expect(schema.commands.effective).toContain(
      "role effective --member-id <id> [--department-id <id>]",
    );
  });
});
