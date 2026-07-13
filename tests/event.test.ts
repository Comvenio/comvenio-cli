import { describe, expect, test } from "bun:test";

import {
  buildEventCreateBody,
  buildSeriesCreateBody,
  buildSeriesRrule,
  buildTemplateInstanceBody,
} from "../src/commands/event.ts";
import { handleEventOperation } from "../src/commands/event-operations.ts";
import type { ComvenioClient } from "../src/http.ts";

function recordingClient(getValue: unknown = {}): {
  client: ComvenioClient;
  calls: Array<{ method: string; path: string; body?: unknown }>;
} {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const client: ComvenioClient = {
    get: async (_service, path) => {
      calls.push({ method: "GET", path });
      return getValue as never;
    },
    post: async (_service, path, body) => {
      calls.push({ method: "POST", path, body });
      return { id: "created-1" } as never;
    },
    patch: async (_service, path, body) => {
      calls.push({ method: "PATCH", path, body });
      return { id: "updated-1" } as never;
    },
    put: async (_service, path, body) => {
      calls.push({ method: "PUT", path, body });
      return { id: "updated-1" } as never;
    },
    postForm: async (_service, path, body) => {
      calls.push({ method: "POST_FORM", path, body });
      return { id: "asset-1" } as never;
    },
    del: async (_service, path) => {
      calls.push({ method: "DELETE", path });
      return undefined as never;
    },
    service: async (_service, path) => {
      calls.push({ method: "GET", path });
      return getValue as never;
    },
  };
  return { client, calls };
}

describe("event templates", () => {
  test("creates a reusable event template with the backend field names", () => {
    expect(buildEventCreateBody({
      title: "Darttraining",
      eventType: "training",
      visibilityScope: "member",
      organizerType: "member",
      departmentId: "dept-1",
      complexity: "simple",
    }, "club-1", true)).toEqual({
      club_id: "club-1",
      title: "Darttraining",
      event_type: "training",
      visibility_scope: "member",
      organizer_type: "member",
      department_id: "dept-1",
      event_complexity: "simple",
      is_template: true,
    });
  });

  test("instantiates with safe copy defaults", () => {
    expect(buildTemplateInstanceBody({
      startTime: "2026-07-15T19:00:00+02:00",
      endTime: "2026-07-15T21:00:00+02:00",
    })).toEqual({
      start_time: "2026-07-15T19:00:00+02:00",
      end_time: "2026-07-15T21:00:00+02:00",
      copy_tags: true,
      copy_areas: true,
      copy_tasks: true,
      copy_task_assignments: false,
    });
  });
});

describe("event series", () => {
  test("builds a readable weekly recurrence rule", () => {
    expect(buildSeriesRrule({
      frequency: "weekly",
      interval: "2",
      weekdays: "MO,FR",
      count: "12",
    })).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=12");
  });

  test("rejects ambiguous recurrence limits and invalid weekdays", () => {
    expect(() => buildSeriesRrule({ count: "4", until: "2026-12-31" })).toThrow(
      "nicht gleichzeitig",
    );
    expect(() => buildSeriesRrule({ weekdays: "MO,XX" })).toThrow("MO,TU,WE");
  });

  test("creates a recurring series from a template with useful defaults", () => {
    const body = buildSeriesCreateBody({
      startTime: "2026-07-15T19:00:00+02:00",
      weekdays: "WE",
    }, "club-1", {
      id: "template-1",
      title: "Darttraining",
      description: "Wöchentliches Training",
      department_id: "dept-1",
      is_template: true,
    });

    expect(body).toMatchObject({
      club_id: "club-1",
      title: "Darttraining",
      dtstart: "2026-07-15T17:00:00.000Z",
      duration_minutes: 120,
      timezone: "Europe/Berlin",
      rrule: "FREQ=WEEKLY;BYDAY=WE",
      template_event_id: "template-1",
      default_department_id: "dept-1",
      series_type: "RECURRING",
      materialization_mode: "AUTO",
    });
  });

  test("defaults yearly series to manual materialization", () => {
    const body = buildSeriesCreateBody({
      startTime: "2027-05-01T10:00:00+02:00",
      seriesType: "yearly",
    }, "club-1", {
      id: "template-1",
      title: "Maifest",
      department_id: "dept-1",
      is_template: true,
    });

    expect(body).toMatchObject({
      rrule: "FREQ=YEARLY",
      series_type: "YEARLY_TEMPLATE",
      materialization_mode: "MANUAL",
    });
  });
});

describe("event hub operations", () => {
  test("assigns a member with the event and club contract resolved from the area", async () => {
    const { client, calls } = recordingClient({ event_id: "event-1" });
    await handleEventOperation({
      action: "assignment",
      sub: "add",
      id: "area-1",
      opts: { memberId: "member-1" },
      client,
      clubId: "club-1",
    });

    expect(calls).toEqual([
      { method: "GET", path: "/events/areas/area-1" },
      {
        method: "POST",
        path: "/events/areas/area-1/assign-member",
        body: {
          club_id: "club-1",
          event_id: "event-1",
          event_area_id: "area-1",
          member_id: "member-1",
        },
      },
    ]);
  });

  test("links an existing file as an event attachment", async () => {
    const { client, calls } = recordingClient();
    await handleEventOperation({
      action: "attachment",
      sub: "add",
      id: "event-1",
      opts: {
        attachmentType: "flyer",
        attachmentId: "file-1",
        title: "Flyer",
      },
      client,
      clubId: "club-1",
    });

    expect(calls[0]).toEqual({
      method: "POST",
      path: "/events/event-1/attachments",
      body: {
        attachment_type: "flyer",
        attachment_id: "file-1",
        title: "Flyer",
        event_id: "event-1",
        club_id: "club-1",
      },
    });
  });

  test("assigns tags without requiring a raw API payload", async () => {
    const { client, calls } = recordingClient();
    await handleEventOperation({
      action: "tag",
      sub: "assign",
      id: "event-1",
      opts: { tagId: "tag-1" },
      client,
      clubId: "club-1",
    });

    expect(calls[0]).toEqual({
      method: "POST",
      path: "/events/tags/assign",
      body: { club_id: "club-1", event_id: "event-1", tag_id: "tag-1" },
    });
  });

  test("updates a tag category with the backend's full create schema", async () => {
    const { client, calls } = recordingClient({
      name: "Sportart",
      description: "Bisherige Beschreibung",
      is_default: false,
      club_id: "club-1",
    });
    await handleEventOperation({
      action: "tag",
      sub: "category-update",
      id: "category-1",
      opts: { name: "Disziplin" },
      client,
      clubId: "club-1",
    });

    expect(calls).toEqual([
      { method: "GET", path: "/events/tags/category/category-1" },
      {
        method: "PATCH",
        path: "/events/tags/category/category-1",
        body: {
          name: "Disziplin",
          description: "Bisherige Beschreibung",
          is_default: false,
          club_id: "club-1",
        },
      },
    ]);
  });

  test("updates a tag without losing its required category and club", async () => {
    const { client, calls } = recordingClient({
      name: "Darts",
      category_id: "category-1",
      club_id: "club-1",
    });
    await handleEventOperation({
      action: "tag",
      sub: "update",
      id: "tag-1",
      opts: { name: "Steeldarts" },
      client,
      clubId: "club-1",
    });

    expect(calls).toEqual([
      { method: "GET", path: "/events/tags/tag-1" },
      {
        method: "PATCH",
        path: "/events/tags/tag-1",
        body: { name: "Steeldarts", category_id: "category-1", club_id: "club-1" },
      },
    ]);
  });

  test("builds the resource usage query from safe flags", async () => {
    const { client, calls } = recordingClient([]);
    await handleEventOperation({
      action: "resource",
      sub: "usage",
      id: undefined,
      opts: {
        targetType: "room",
        targetId: "room-1",
        start: "2026-07-20T18:00:00+02:00",
        end: "2026-07-20T20:00:00+02:00",
        status: "planned,confirmed",
      },
      client,
      clubId: "club-1",
    });

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.path).toContain("/events/resource-usage/?");
    expect(calls[0]?.path).toContain("target_type=room");
    expect(calls[0]?.path).toContain("target_id=room-1");
  });
});
