import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTeamMemberBody, buildResourcePriorityBody } from "../src/commands/team.ts";
import { pathWithForce } from "../src/commands/object.ts";
import { buildReservationMutationBody } from "../src/commands/booking.ts";

const schema = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "src", "schema", `${name}.json`), "utf8"));

describe("team admin payloads", () => {
  test("CLI flags override member JSON and convert integers", () => {
    expect(
      buildTeamMemberBody(
        { memberId: "member-1", role: "CAPTAIN", jerseyNumber: "17" },
        { role: "PLAYER", position: "Board 1" },
      ),
    ).toEqual({
      member_id: "member-1",
      role: "CAPTAIN",
      jersey_number: 17,
      position: "Board 1",
    });
  });

  test("resource-priority payload keeps file fields and validates numbers", () => {
    expect(
      buildResourcePriorityBody(
        { objectId: "object-1", priority: "2", bookingDurationMinutes: "90" },
        { notes: "Training" },
      ),
    ).toEqual({
      object_id: "object-1",
      priority: 2,
      booking_duration_minutes: 90,
      notes: "Training",
    });
    expect(() => buildResourcePriorityBody({ priority: "1.5" })).toThrow("ganze Zahl");
  });
});

describe("object admin routes", () => {
  test("force is an explicit query opt-in", () => {
    expect(pathWithForce("/objects/id", undefined)).toBe("/objects/id");
    expect(pathWithForce("/objects/id", false)).toBe("/objects/id");
    expect(pathWithForce("/objects/id", true)).toBe("/objects/id?force=true");
  });
});

describe("booking admin payloads", () => {
  const current = { id: "booking-1", club_id: "club-1", object_id: "object-1", status: "requested" };

  test("update preserves reservation identity despite file input", () => {
    expect(
      buildReservationMutationBody(current, {
        title: "Training",
        club_id: "foreign-club",
        object_id: "foreign-object",
      }),
    ).toEqual({
      title: "Training",
      club_id: "club-1",
      object_id: "object-1",
    });
  });

  test("approve/reject/cancel add the status to the mandatory identity", () => {
    expect(buildReservationMutationBody(current, {}, "approved")).toEqual({
      club_id: "club-1",
      object_id: "object-1",
      status: "approved",
    });
    expect(buildReservationMutationBody(current, {}, "cancelled").status).toBe("cancelled");
  });

  test("missing backend identity is rejected before a mutation", () => {
    expect(() => buildReservationMutationBody({ id: "broken" }, { title: "x" })).toThrow(
      "club_id/object_id",
    );
  });
});

describe("admin schemas", () => {
  test("publish team, object and booking workflows", () => {
    expect(schema("team").commands.member).toContain("update");
    expect(schema("team").commands.resource).toContain("remove");
    expect(schema("object").commands.booking_rule).toContain("bulk");
    expect(schema("object").commands.task_rule).toContain("update");
    expect(schema("booking").commands.reservation).toContain("cancel");
    expect(schema("booking").commands.participant).toContain("add-groups");
    expect(schema("booking").commands.link).toContain("add");
  });
});
