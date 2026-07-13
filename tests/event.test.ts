import { describe, expect, test } from "bun:test";

import {
  buildEventCreateBody,
  buildSeriesCreateBody,
  buildSeriesRrule,
  buildTemplateInstanceBody,
} from "../src/commands/event.ts";

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
