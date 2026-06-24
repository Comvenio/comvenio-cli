import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";

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
  memberId?: string;
  responsible?: boolean;
  // context create
  contextType?: string;
  refId?: string;
};

/**
 * `comvenio task <action> [arg1] [arg2]` dispatcher.
 *   task list [--mine] | task show <id> | task create | task assign <id> | task done <id>
 *   task context list | task context create
 */
export function registerTaskCommands(cli: CAC): void {
  cli
    .command("task <action> [arg1] [arg2]", "Aufgaben: list|show|create|assign|done | context list|create")
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
    .option("--member-id <v>", "Member-ID (assign; NICHT user_id)")
    .option("--responsible", "assign: is_responsible=true")
    // context create
    .option("--context-type <v>", "context create: club|event|object|meeting|supply")
    .option("--ref-id <v>", "context create: context_id (referenzierte Entitaet)")
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
          if (sub === "create") {
            if (!opts.contextType) {
              throw new Error(
                "task context create benoetigt --context-type (club|event|object|meeting|supply).",
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
          throw new Error(`Unbekannte task-context-Aktion "${sub}". Verfuegbar: list, create`);
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
          default:
            throw new Error(
              `Unbekannte Aktion "${action}". Verfuegbar: list, show, create, assign, done, context`,
            );
        }
      },
    );
}
