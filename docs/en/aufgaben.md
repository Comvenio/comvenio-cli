---
id: aufgaben
kategorie: thema
domaenen: [task]
stichwoerter: [tasks, checklists, assignments, reminder, notes]
---

# Tasks

## Purpose

Tasks let a club plan work, assign it to members, accompany it with checklists and notes, and complete it — every task refers to a business context such as the club itself, an event, an object, a meeting or a supply.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by `comvenio action list --json`.

## Workflows

### Enums

| Field | Values |
|---|---|
| `status` | `open`, `in_progress`, `completed`, `cancelled` |
| `priority` | `low`, `medium`, `high` |
| `context_type` | `club`, `event`, `object`, `meeting`, `supply` |

### Creating a task (`cai.task.05.create`)

1. First find a context (`cai.task.11.context_list_show_create_update_delete`, `operation: list`) or create one (`operation: create`): the context describes what the task refers to.
2. Use the `id` from the context response as `task_context_id` for the task. For a task not tied to an event, object, meeting or supply, use `context_type: club` with the club ID as `context_id` (shown by `comvenio whoami --json`); reuse an existing club context from the list.
3. Create the task with `title` and `task_context_id`; both are required. A due date (`due_date`) is given as an ISO timestamp.
4. Optionally assign a member (see below).

Several tasks, including checklists and assignments, can be created together in one call (`cai.task.06.bulk`); that is `critical_write` and runs through the preview/confirm sequence.

### Changing, cancelling or completing a task

`cai.task.07.update` only replaces the fields actually set in `changes`. `completed` and `cancelled` may not be set back to `open`. To complete a task, `cai.task.09.done` is more convenient than a status change through update: it sets the status to `completed`; the completion timestamp (`completed_at`) is given explicitly. `cai.task.10.delete` is `critical_write`.

### Assigning a member (`cai.task.08.assign`)

An assignment explicitly expects a member ID (`member_id`), not a user ID, plus optionally `is_responsible`. Assignments can be fully read and updated through `cai.task.12.assignment_list_show_update_delete` (`reversible_write`); removing one (`operation: delete`) is `critical_write`.

### Maintaining contexts, notes and checklists

- `cai.task.11.context_list_show_create_update_delete` manages contexts; deleting is `critical_write`.
- `cai.task.13.note_list_add_update_delete` manages notes (`content`); deleting is `critical_write`.
- `cai.task.14.checklist_list_add_update_toggle_delete_reorder` manages checklist items, including toggling (`toggle`, done/open); deleting and reordering (`reorder`) are `critical_write`.

### Setting a personal task reminder

Not yet available as an action — do this in the web app.

### Scope boundary

Internal automation routes, specialized polling and scheduling-matrix models, and cross-cutting cleanup endpoints are not general club actions. The usual task, context, assignment, note and checklist workflow is fully reachable through the actions described here.

## Examples

```bash
comvenio action call cai.task.11.context_list_show_create_update_delete \
  --input '{"operation":"list","limit":50,"offset":0}'

comvenio action call cai.task.11.context_list_show_create_update_delete \
  --input '{"operation":"create","context":{"context_type":"event","context_id":"<event-id>","is_default":false}}'
```

```bash
comvenio action call cai.task.01.list --input '{"operation":"list","limit":50,"offset":0}'
comvenio action call cai.task.01.list --input '{"operation":"mine","limit":50,"offset":0}'
comvenio action call cai.task.02.show --input '{"task_id":"<task-id>"}'
comvenio action call cai.task.03.show_subtasks --input '{"task_id":"<task-id>"}'
comvenio action call cai.task.04.show_chain --input '{"task_id":"<task-id>"}'
```

`operation: mine` returns the tasks assigned to the current user.

```bash
comvenio action call cai.task.05.create --input '{
  "task": {
    "title": "Getränkestand besetzen",
    "task_context_id": "<task-context-id>",
    "description": "Zwei Schichten einteilen",
    "priority": "high",
    "status": "open",
    "department_id": "<department-id>",
    "due_date": "2026-07-20T18:00:00+02:00"
  }
}'
```

```bash
comvenio action call cai.task.06.bulk --input '{
  "items": [
    {
      "task": { "title": "Dartboards aufbauen", "task_context_id": "<task-context-id>", "priority": "high" },
      "checklist_items": [{ "title": "Werkzeug prüfen", "order_index": 0 }],
      "assignments": [{ "member_id": "<member-id>", "is_responsible": true }]
    }
  ]
}'
# response returns preview_id, confirmation_token, target, current state, diff and risk
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.task.07.update --input '{"task_id":"<task-id>","changes":{"title":"Neuer Titel","priority":"medium"}}'
comvenio action call cai.task.07.update --input '{"task_id":"<task-id>","changes":{"status":"in_progress"}}'
comvenio action call cai.task.07.update --input '{"task_id":"<task-id>","changes":{"status":"cancelled"}}'
comvenio action call cai.task.09.done --input '{"task_id":"<task-id>","completed_at":"2026-07-20T19:00:00+02:00"}'

comvenio action call cai.task.10.delete --input '{"task_id":"<task-id>"}'
# response returns preview_id, confirmation_token, target, current state, diff and risk
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.task.08.assign --input '{"task_id":"<task-id>","assignment":{"member_id":"<member-id>","is_responsible":true}}'

comvenio action call cai.task.12.assignment_list_show_update_delete --input '{"operation":"list","task_id":"<task-id>"}'
comvenio action call cai.task.12.assignment_list_show_update_delete --input '{"operation":"show","assignment_id":"<assignment-id>"}'
comvenio action call cai.task.12.assignment_list_show_update_delete --input '{"operation":"update","assignment_id":"<assignment-id>","is_responsible":false}'
comvenio action call cai.task.12.assignment_list_show_update_delete --input '{"operation":"delete","assignment_id":"<assignment-id>"}'
```

```bash
comvenio action call cai.task.11.context_list_show_create_update_delete --input '{"operation":"show","context_id":"<context-id>"}'
comvenio action call cai.task.11.context_list_show_create_update_delete --input '{"operation":"update","context_id":"<context-id>","is_default":true}'
comvenio action call cai.task.11.context_list_show_create_update_delete --input '{"operation":"delete","context_id":"<context-id>"}'

comvenio action call cai.task.13.note_list_add_update_delete --input '{"operation":"list","task_id":"<task-id>"}'
comvenio action call cai.task.13.note_list_add_update_delete --input '{"operation":"add","task_id":"<task-id>","content":"Getränkebestellung geprüft"}'
comvenio action call cai.task.13.note_list_add_update_delete --input '{"operation":"update","note_id":"<note-id>","content":"Aktualisierter Text"}'
comvenio action call cai.task.13.note_list_add_update_delete --input '{"operation":"delete","note_id":"<note-id>"}'

comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"list","task_id":"<task-id>"}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"add","task_id":"<task-id>","item":{"title":"Getränke bestellen","order_index":0}}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"update","item_id":"<item-id>","changes":{"title":"Getränke bestellen (60 Kästen)"}}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"toggle","item_id":"<item-id>"}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"delete","item_id":"<item-id>"}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"reorder","task_id":"<task-id>","ordered_ids":["<item-id-1>","<item-id-2>"]}'
```

Deleting or reordering checklist calls, deleting a context, note or assignment, and `bulk` are `critical_write` and run through the same preview/confirm sequence shown above for `cai.task.10.delete`. The verified fields per action are also shown by `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"task"}'`.

## Commands and actions

<!-- gen:docs befehle -->

**task**

- `cai.task.01.list` — list, mine (read) · Scopes: `task.read`, `club.read`
- `cai.task.02.show` — show (read) · Scopes: `task.read`
- `cai.task.03.show_subtasks` — show (read) · Scopes: `task.read`
- `cai.task.04.show_chain` — show (read) · Scopes: `task.read`
- `cai.task.05.create` — create (change) · Scopes: `task.write`
- `cai.task.06.bulk` — create (change with confirmation) · Scopes: `task.write`
- `cai.task.07.update` — update (change) · Scopes: `task.write`
- `cai.task.08.assign` — assign (change) · Scopes: `task.write`
- `cai.task.09.done` — complete (change) · Scopes: `task.write`
- `cai.task.10.delete` — delete (change with confirmation) · Scopes: `task.write`
- `cai.task.11.context_list_show_create_update_delete` — list, show, create, update, delete (read, change, change with confirmation) · Scopes: `task.read`, `task.write`
- `cai.task.12.assignment_list_show_update_delete` — list, show, update, delete (read, change, change with confirmation) · Scopes: `task.read`, `task.write`
- `cai.task.13.note_list_add_update_delete` — list, add, update, delete (read, change, change with confirmation) · Scopes: `task.read`, `task.write`
- `cai.task.14.checklist_list_add_update_toggle_delete_reorder` — list, add, update, toggle, delete, reorder (read, change, change with confirmation) · Scopes: `club.read`, `task.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"task"}'` (the sign-in sets `club_id` — never in `--input`)
<!-- /gen:docs -->

## Errors

- `VALIDATION_FAILED` — a required field such as title or context ID is missing, or a status change is not allowed (for example, back to `open`). More: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — the task, context, assignment, note or checklist item does not exist or is not visible. More: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow this task action. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the required task scope, for example for writing. More: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — the task was changed in the meantime, or does not allow the requested status change in its current state. More: `comvenio help fehler CONFLICT`
- `OUTCOME_UNKNOWN` — for a write action, the server response was missing; before retrying, use a read action to check whether the change already landed. More: `comvenio help fehler OUTCOME_UNKNOWN`
