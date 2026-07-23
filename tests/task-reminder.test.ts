import { describe, expect, test } from "bun:test";

import {
  executeTaskReminderCommand,
  normalizeFutureReminderAt,
} from "../src/commands/task.ts";
import type { ComvenioClient } from "../src/http.ts";

function recordingClient(getValue: unknown = []): {
  client: ComvenioClient;
  calls: Array<{
    method: string;
    service: string;
    path: string;
    body?: unknown;
  }>;
} {
  const calls: Array<{
    method: string;
    service: string;
    path: string;
    body?: unknown;
  }> = [];
  const client: ComvenioClient = {
    get: async (service, path) => {
      calls.push({ method: "GET", service, path });
      return getValue as never;
    },
    post: async (service, path, body) => {
      calls.push({ method: "POST", service, path, body });
      return {
        id: "reminder-1",
        task_id: "task-1",
        reminder_at: "2026-08-01T10:30:00.000Z",
        comment: "Material prüfen",
      } as never;
    },
    patch: async () => ({} as never),
    put: async () => ({} as never),
    postForm: async () => ({} as never),
    del: async (service, path) => {
      calls.push({ method: "DELETE", service, path });
      return undefined as never;
    },
    service: async () => ({} as never),
  };
  return { client, calls };
}

describe("task reminder CLI contract", () => {
  test("normalizes a future RFC-3339 timestamp", () => {
    expect(
      normalizeFutureReminderAt(
        "2026-08-01T12:30:00+02:00",
        Date.parse("2026-07-23T00:00:00Z"),
      ),
    ).toBe("2026-08-01T10:30:00.000Z");
  });

  test("rejects invalid and past timestamps before an API call", () => {
    expect(() => normalizeFutureReminderAt("invalid", 0)).toThrow(
      "RFC-3339",
    );
    expect(() => normalizeFutureReminderAt("2026-08-01", 0)).toThrow(
      "mit Zeitzone",
    );
    expect(() =>
      normalizeFutureReminderAt(
        "2026-07-22T12:00:00Z",
        Date.parse("2026-07-23T00:00:00Z"),
      ),
    ).toThrow("in der Zukunft");
  });

  test("sets only the current user's reminder through the automation route", async () => {
    const { client, calls } = recordingClient();
    const result = await executeTaskReminderCommand({
      subcommand: "set",
      taskId: "task-1",
      options: {
        remindAt: "2026-08-01T12:30:00+02:00",
        comment: "Material prüfen",
      },
      client,
      nowMs: Date.parse("2026-07-23T00:00:00Z"),
    });

    expect(calls).toEqual([{
      method: "POST",
      service: "automation",
      path: "/custom_reminders/task",
      body: {
        task_id: "task-1",
        reminder_at: "2026-08-01T10:30:00.000Z",
        comment: "Material prüfen",
      },
    }]);
    expect(JSON.stringify(calls)).not.toContain("user_id");
    expect(JSON.stringify(calls)).not.toContain("club_id");
    expect(JSON.stringify(calls)).not.toContain("recipient");
    expect(result.text).toContain("Persönliche Erinnerung gesetzt");
  });

  test("lists only reminders returned for the selected task", async () => {
    const reminder = {
      id: "reminder-1",
      task_id: "task-1",
      reminder_at: "2026-08-01T10:30:00.000Z",
      comment: "Material prüfen",
    };
    const { client, calls } = recordingClient([reminder]);
    const result = await executeTaskReminderCommand({
      subcommand: "list",
      taskId: "task-1",
      options: {},
      client,
    });

    expect(calls).toEqual([{
      method: "GET",
      service: "automation",
      path: "/custom_reminders/task/task-1",
    }]);
    expect(result.data).toEqual([reminder]);
    expect(result.text).toContain("Material prüfen");
  });

  test("deletes the deterministic current-user reminder by task", async () => {
    const { client, calls } = recordingClient();
    const result = await executeTaskReminderCommand({
      subcommand: "delete",
      taskId: "task-1",
      options: {},
      client,
    });

    expect(calls).toEqual([{
      method: "DELETE",
      service: "automation",
      path: "/custom_reminders/task/by-task/task-1",
    }]);
    expect(result.data).toEqual({ deleted: true, task_id: "task-1" });
  });

  test("rejects incomplete reminder commands before an API call", async () => {
    const { client, calls } = recordingClient();
    await expect(executeTaskReminderCommand({
      subcommand: "set",
      taskId: "task-1",
      options: {},
      client,
    })).rejects.toThrow("--remind-at");
    await expect(executeTaskReminderCommand({
      subcommand: "list",
      taskId: undefined,
      options: {},
      client,
    })).rejects.toThrow("Task-ID");
    await expect(executeTaskReminderCommand({
      subcommand: "unknown",
      taskId: "task-1",
      options: {},
      client,
    })).rejects.toThrow("set <task-id>, list <task-id>, delete <task-id>");
    expect(calls).toEqual([]);
  });
});
