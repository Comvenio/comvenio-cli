import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readJsonFile } from "../util/file.ts";

// task-service endpoints (verified Sub-File 07):
//   GET  /task/tasks/by-club/{club_id}
//   GET  /task/tasks/my-tasks/assigned/{club_id}      (--mine)
//   GET  /task/tasks/{task_id}
//   POST /task/tasks/                                 (TaskCreate; task_context_id PFLICHT)
//   POST /task/task-assignments/                      (member_id, NOT user_id)
//   PUT  /task/tasks/{task_id}                        (done = status:completed + completed_at)
//   GET  /task/task-contexts/by-club/{club_id}
//   POST /task/task-contexts/                         (TaskContextCreate)

type TaskRead = {
  id?: string;
  title?: string;
  status?: string;
  priority?: string;
  task_context_id?: string;
  completed_at?: string | null;
  [key: string]: unknown;
};
type TaskContextRead = {
  id?: string;
  context_type?: string;
  context_id?: string;
  [key: string]: unknown;
};
type TaskReminderRead = {
  id?: string;
  task_id?: string;
  reminder_at?: string;
  when_ts?: number;
  comment?: string | null;
  task_title?: string | null;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
  mine?: boolean;
  subtasks?: boolean;
  chain?: boolean;
  title?: string;
  contextId?: string;
  description?: string;
  priority?: string;
  status?: string;
  departmentId?: string;
  dueDate?: string;
  remindAt?: string;
  comment?: string;
  memberId?: string;
  responsible?: boolean;
  // context create
  contextType?: string;
  refId?: string;
  file?: string;
};

function jsonBody(opts: Opts, command: string): unknown {
  if (!opts.file) throw new Error(`${command} benoetigt --file <payload.json>.`);
  return readJsonFile<unknown>(opts.file);
}

function printJsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function normalizeFutureReminderAt(
  value: string,
  nowMs: number = Date.now(),
): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  ) {
    throw new Error("--remind-at muss ein RFC-3339-Zeitpunkt mit Zeitzone sein.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("--remind-at ist kein gültiger Zeitpunkt.");
  }
  if (parsed.getTime() <= nowMs) {
    throw new Error("--remind-at muss in der Zukunft liegen.");
  }
  return parsed.toISOString();
}

export interface TaskReminderCommandOptions {
  remindAt?: string;
  comment?: string;
}

export interface TaskReminderCommandResult {
  data: unknown;
  text: string;
}

export async function executeTaskReminderCommand(input: {
  subcommand: string | undefined;
  taskId: string | undefined;
  options: TaskReminderCommandOptions;
  client: ComvenioClient;
  nowMs?: number;
}): Promise<TaskReminderCommandResult> {
  const { subcommand, taskId, options, client } = input;
  if (subcommand === "set") {
    if (!taskId) {
      throw new Error("task reminder set <task-id> benötigt eine Task-ID.");
    }
    if (!options.remindAt) {
      throw new Error("task reminder set benötigt --remind-at <RFC-3339>.");
    }
    const normalizedReminderAt = normalizeFutureReminderAt(
      options.remindAt,
      input.nowMs,
    );
    const row = await client.post<TaskReminderRead>(
      "automation",
      "/custom_reminders/task",
      prune({
        task_id: taskId,
        reminder_at: normalizedReminderAt,
        comment: options.comment,
      }),
    );
    return {
      data: row,
      text: `Persönliche Erinnerung gesetzt: ${row.task_title ?? taskId} am ${
        row.reminder_at
          ? new Date(row.reminder_at).toLocaleString("de-DE")
          : new Date(normalizedReminderAt).toLocaleString("de-DE")
      }`,
    };
  }

  if (subcommand === "list") {
    if (!taskId) {
      throw new Error("task reminder list <task-id> benötigt eine Task-ID.");
    }
    const rows = await client.get<TaskReminderRead[]>(
      "automation",
      `/custom_reminders/task/${taskId}`,
    );
    return {
      data: rows,
      text: rows.length
        ? renderTable(rows, [
            { header: "ID", width: 36, get: (row) => String(row.id ?? "") },
            {
              header: "Zeitpunkt",
              width: 22,
              get: (row) =>
                row.reminder_at
                  ? new Date(row.reminder_at).toLocaleString("de-DE")
                  : "–",
            },
            {
              header: "Kommentar",
              width: 36,
              get: (row) => String(row.comment ?? "–"),
            },
          ])
        : "Keine persönliche Erinnerung für diese Aufgabe.",
    };
  }

  if (subcommand === "delete") {
    if (!taskId) {
      throw new Error("task reminder delete <task-id> benötigt eine Task-ID.");
    }
    await client.del(
      "automation",
      `/custom_reminders/task/by-task/${taskId}`,
    );
    return {
      data: { deleted: true, task_id: taskId },
      text: `Persönliche Erinnerung für Aufgabe gelöscht: ${taskId}`,
    };
  }

  throw new Error(
    "task reminder unterstützt: set <task-id>, list <task-id>, delete <task-id>.",
  );
}

/**
 * `comvenio task <action> [arg1] [arg2]` dispatcher.
 *   task list [--mine] | task show <id> | task create | task assign <id> | task done <id>
 *   task reminder set|list|delete | task context list | task context create
 */
export function registerTaskCommands(cli: CAC): void {
  cli
    .command(
      "task <action> [arg1] [arg2]",
      "Aufgaben sowie persönliche Erinnerungen, Contexts, Zuweisungen, Notizen und Checklisten verwalten",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--mine", "Nur mir zugewiesene Tasks (list)")
    .option("--subtasks", "show: Subtasks laden")
    .option("--chain", "show: Chain laden")
    .option("--title <v>", "Titel (Pflicht bei create)")
    .option("--context-id <v>", "task_context_id (PFLICHT bei create)")
    .option("--description <v>", "Beschreibung")
    .option("--priority <v>", "low|medium|high")
    .option("--status <v>", "open|in_progress|completed|cancelled")
    .option("--department-id <v>", "Abteilungs-ID")
    .option("--due-date <v>", "Faelligkeit (ISO)")
    .option("--remind-at <v>", "Persönliche Erinnerung als RFC-3339-Zeitpunkt")
    .option("--comment <v>", "Optionaler Kommentar zur persönlichen Erinnerung")
    .option("--member-id <v>", "Member-ID (assign; NICHT user_id)")
    .option("--responsible", "assign: is_responsible=true")
    // context create
    .option("--context-type <v>", "context create: club|event|object|meeting|supply")
    .option("--ref-id <v>", "context create: context_id (referenzierte Entitaet)")
    .option("--file <path>", "JSON-Payload fuer update/bulk und Unterressourcen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(
      async (
        action: string,
        arg1: string | undefined,
        arg2: string | undefined,
        opts: Opts,
      ) => {
        const state = loadState();
        const client = createClient(state);

        // task reminder set|list|delete
        if (action === "reminder") {
          const result = await executeTaskReminderCommand({
            subcommand: arg1,
            taskId: arg2,
            options: {
              remindAt: opts.remindAt,
              comment: opts.comment,
            },
            client,
          });
          output(result.data, opts.json, () => result.text);
          return;
        }

        const clubId = requireClubId(state, opts.club);

        // task context <sub>
        if (action === "context") {
          const sub = arg1;
          if (sub === "list") {
            const ctxs = await client.get<TaskContextRead[]>(
              "task",
              `/task-contexts/by-club/${clubId}`,
            );
            output(ctxs, opts.json, () =>
              ctxs.length
                ? renderTable(ctxs, [
                    { header: "ID", width: 36, get: (c) => String(c.id ?? "") },
                    { header: "Typ", width: 12, get: (c) => String(c.context_type ?? "—") },
                    { header: "Ref-ID", width: 36, get: (c) => String(c.context_id ?? "—") },
                  ])
                : "Keine Task-Contexts.",
            );
            return;
          }
          if (sub === "show") {
            if (!arg2) throw new Error("task context show <context-id> benoetigt eine ID.");
            const ctx = await client.get<TaskContextRead>("task", `/task-contexts/${arg2}`);
            output(ctx, opts.json, () => printJsonResult(ctx));
            return;
          }
          if (sub === "create") {
            if (!opts.contextType) {
              throw new Error(
                "task context create benoetigt --context-type (club|event|object|meeting|supply).",
              );
            }
            if (!opts.refId) {
              throw new Error(
                "task context create benoetigt --ref-id (context_id des referenzierten Objekts).",
              );
            }
            const body = prune({
              club_id: clubId,
              context_type: opts.contextType,
              context_id: opts.refId,
            });
            const ctx = await client.post<TaskContextRead>("task", "/task-contexts/", body);
            output(ctx, opts.json, () => `Task-Context angelegt: ${ctx.id}`);
            return;
          }
          if (sub === "update") {
            if (!arg2) throw new Error("task context update <context-id> benoetigt eine ID.");
            const ctx = await client.put<TaskContextRead>(
              "task",
              `/task-contexts/${arg2}`,
              jsonBody(opts, "task context update"),
            );
            output(ctx, opts.json, () => `Task-Context aktualisiert: ${ctx.id ?? arg2}`);
            return;
          }
          if (sub === "delete") {
            if (!arg2) throw new Error("task context delete <context-id> benoetigt eine ID.");
            await client.del("task", `/task-contexts/${arg2}`);
            output({ deleted: true, id: arg2 }, opts.json, () => `Task-Context geloescht: ${arg2}`);
            return;
          }
          throw new Error(
            `Unbekannte task-context-Aktion "${sub}". Verfuegbar: list, show, create, update, delete`,
          );
        }

        // task assignment <list|show|update|delete> <task-id|assignment-id>
        if (action === "assignment") {
          const sub = arg1;
          if (!arg2) throw new Error(`task assignment ${sub ?? "<aktion>"} benoetigt eine ID.`);
          if (sub === "list") {
            const rows = await client.get("task", `/task-assignments/by-task/${arg2}`);
            output(rows, opts.json, () => printJsonResult(rows));
            return;
          }
          if (sub === "show") {
            const row = await client.get("task", `/task-assignments/${arg2}`);
            output(row, opts.json, () => printJsonResult(row));
            return;
          }
          if (sub === "update") {
            const row = await client.put(
              "task",
              `/task-assignments/${arg2}`,
              jsonBody(opts, "task assignment update"),
            );
            output(row, opts.json, () => `Zuweisung aktualisiert: ${arg2}`);
            return;
          }
          if (sub === "delete") {
            await client.del("task", `/task-assignments/${arg2}`);
            output({ deleted: true, id: arg2 }, opts.json, () => `Zuweisung geloescht: ${arg2}`);
            return;
          }
          throw new Error(
            `Unbekannte task-assignment-Aktion "${sub}". Verfuegbar: list, show, update, delete`,
          );
        }

        // task note <list|add|update|delete> <task-id|note-id>
        if (action === "note") {
          const sub = arg1;
          if (!arg2) throw new Error(`task note ${sub ?? "<aktion>"} benoetigt eine ID.`);
          if (sub === "list") {
            const rows = await client.get("task", `/tasks/${arg2}/notes`);
            output(rows, opts.json, () => printJsonResult(rows));
            return;
          }
          if (sub === "add") {
            const row = await client.post(
              "task",
              `/tasks/${arg2}/notes`,
              jsonBody(opts, "task note add"),
            );
            output(row, opts.json, () => `Notiz angelegt fuer Task ${arg2}`);
            return;
          }
          if (sub === "update") {
            const row = await client.put(
              "task",
              `/tasks/notes/${arg2}`,
              jsonBody(opts, "task note update"),
            );
            output(row, opts.json, () => `Notiz aktualisiert: ${arg2}`);
            return;
          }
          if (sub === "delete") {
            await client.del("task", `/tasks/notes/${arg2}`);
            output({ deleted: true, id: arg2 }, opts.json, () => `Notiz geloescht: ${arg2}`);
            return;
          }
          throw new Error(
            `Unbekannte task-note-Aktion "${sub}". Verfuegbar: list, add, update, delete`,
          );
        }

        // task checklist <list|add|update|toggle|delete|reorder> <task-id|item-id>
        if (action === "checklist") {
          const sub = arg1;
          if (!arg2) throw new Error(`task checklist ${sub ?? "<aktion>"} benoetigt eine ID.`);
          if (sub === "list") {
            const rows = await client.get("task", `/tasks/${arg2}/checklist-items`);
            output(rows, opts.json, () => printJsonResult(rows));
            return;
          }
          if (sub === "add") {
            const row = await client.post(
              "task",
              `/tasks/${arg2}/checklist-items`,
              jsonBody(opts, "task checklist add"),
            );
            output(row, opts.json, () => `Checklistenpunkt angelegt fuer Task ${arg2}`);
            return;
          }
          if (sub === "update") {
            const row = await client.put(
              "task",
              `/tasks/checklist-items/${arg2}`,
              jsonBody(opts, "task checklist update"),
            );
            output(row, opts.json, () => `Checklistenpunkt aktualisiert: ${arg2}`);
            return;
          }
          if (sub === "toggle") {
            const row = await client.patch("task", `/tasks/checklist-items/${arg2}/toggle`, {});
            output(row, opts.json, () => `Checklistenpunkt umgeschaltet: ${arg2}`);
            return;
          }
          if (sub === "delete") {
            await client.del("task", `/tasks/checklist-items/${arg2}`);
            output({ deleted: true, id: arg2 }, opts.json, () => `Checklistenpunkt geloescht: ${arg2}`);
            return;
          }
          if (sub === "reorder") {
            const rows = await client.patch(
              "task",
              `/tasks/${arg2}/checklist-items/reorder`,
              jsonBody(opts, "task checklist reorder"),
            );
            output(rows, opts.json, () => `Checkliste sortiert: ${arg2}`);
            return;
          }
          throw new Error(
            `Unbekannte task-checklist-Aktion "${sub}". Verfuegbar: list, add, update, toggle, delete, reorder`,
          );
        }

        switch (action) {
          case "list": {
            const path = opts.mine
              ? `/tasks/my-tasks/assigned/${clubId}`
              : `/tasks/by-club/${clubId}`;
            const data = await client.get<TaskRead[]>("task", path);
            output(data, opts.json, () =>
              data.length
                ? renderTable(data, [
                    { header: "ID", width: 36, get: (t) => String(t.id ?? "") },
                    { header: "Titel", width: 28, get: (t) => String(t.title ?? "—") },
                    { header: "Status", width: 12, get: (t) => String(t.status ?? "—") },
                    { header: "Prio", width: 8, get: (t) => String(t.priority ?? "—") },
                  ])
                : "Keine Aufgaben.",
            );
            break;
          }
          case "show": {
            const id = arg1;
            if (!id) throw new Error("task show benoetigt eine <task-id>.");
            let path = `/tasks/${id}`;
            if (opts.subtasks) path = `/tasks/${id}/subtasks`;
            else if (opts.chain) path = `/tasks/${id}/chain`;
            const t = await client.get<TaskRead>("task", path);
            output(t, opts.json, () =>
              [
                `Titel:   ${(t as TaskRead).title ?? "—"}`,
                `ID:      ${(t as TaskRead).id ?? id}`,
                `Status:  ${(t as TaskRead).status ?? "—"}`,
                `Prio:    ${(t as TaskRead).priority ?? "—"}`,
                `Context: ${(t as TaskRead).task_context_id ?? "—"}`,
              ].join("\n"),
            );
            break;
          }
          case "create": {
            if (!opts.title) throw new Error("task create benoetigt --title.");
            // task_context_id is PFLICHT and has no "default club context" lookup —
            // pre-flight abort (no API call) if missing. Sub-File 07 TC-05.
            if (!opts.contextId) {
              throw new Error(
                "task create benoetigt --context-id (task_context_id). " +
                  "Ermittle ihn via `comvenio task context list`.",
              );
            }
            const body = prune({
              club_id: clubId,
              task_context_id: opts.contextId,
              title: opts.title,
              description: opts.description,
              priority: opts.priority,
              status: opts.status,
              department_id: opts.departmentId,
              due_date: opts.dueDate,
            });
            const t = await client.post<TaskRead>("task", "/tasks/", body);
            output(t, opts.json, () => `Aufgabe angelegt: ${t.title} (${t.id})`);
            break;
          }
          case "bulk": {
            const rows = await client.post(
              "task",
              "/tasks/bulk",
              jsonBody(opts, "task bulk"),
            );
            output(rows, opts.json, () => printJsonResult(rows));
            break;
          }
          case "update": {
            const id = arg1;
            if (!id) throw new Error("task update benoetigt eine <task-id>.");
            const fromFlags = prune({
              title: opts.title,
              description: opts.description,
              priority: opts.priority,
              status: opts.status,
              department_id: opts.departmentId,
              due_date: opts.dueDate,
              task_context_id: opts.contextId,
              completed_at: opts.status === "completed" ? new Date().toISOString() : undefined,
            });
            const body = opts.file ? readJsonFile<unknown>(opts.file) : fromFlags;
            if (!opts.file && Object.keys(fromFlags).length === 0) {
              throw new Error("task update benoetigt mindestens ein Feld oder --file <payload.json>.");
            }
            const row = await client.put<TaskRead>("task", `/tasks/${id}`, body);
            output(row, opts.json, () => `Aufgabe aktualisiert: ${row.title ?? id}`);
            break;
          }
          case "assign": {
            const id = arg1;
            if (!id) throw new Error("task assign benoetigt eine <task-id>.");
            if (!opts.memberId) {
              throw new Error("task assign benoetigt --member-id (Member-ID, NICHT user_id).");
            }
            const body = prune({
              task_id: id,
              club_id: clubId,
              member_id: opts.memberId,
              is_responsible: opts.responsible ? true : undefined,
            });
            const res = await client.post<{ id?: string }>("task", "/task-assignments/", body);
            output(res, opts.json, () =>
              `Aufgabe ${id} zugewiesen an Member ${opts.memberId}.`,
            );
            break;
          }
          case "done": {
            const id = arg1;
            if (!id) throw new Error("task done benoetigt eine <task-id>.");
            // done = PUT (not PATCH); completed_at is NOT auto-set → CLI sends it.
            const done = await client.put<TaskRead>("task", `/tasks/${id}`, {
              status: "completed",
              completed_at: new Date().toISOString(),
            });
            output(done, opts.json, () =>
              `Aufgabe abgeschlossen: ${done.title ?? id} (status=${done.status ?? "completed"})`,
            );
            break;
          }
          case "delete": {
            const id = arg1;
            if (!id) throw new Error("task delete benoetigt eine <task-id>.");
            await client.del("task", `/tasks/${id}`);
            output({ deleted: true, id }, opts.json, () => `Aufgabe geloescht: ${id}`);
            break;
          }
          default:
            throw new Error(
              `Unbekannte Aktion "${action}". Verfuegbar: list, show, create, bulk, update, assign, done, delete, reminder, context, assignment, note, checklist`,
            );
        }
      },
    );
}
