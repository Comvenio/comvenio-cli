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

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Sign in with `comvenio login`; which scopes a given action needs is shown by `comvenio action list --json`. For a member's own personal task reminder, the read scope `task.read` is already enough — a write scope is explicitly not required for it, because it does not change a shared task, only the member's own preference.

## Workflows

### Enums

| Field | Values |
|---|---|
| `status` | `open`, `in_progress`, `completed`, `cancelled` |
| `priority` | `low`, `medium`, `high` |
| `context_type` | `club`, `event`, `object`, `meeting`, `supply` |

### Creating a task

1. First find or create a context: the context describes what the task refers to; the referenced entity is given as the context's own reference (`--ref-id`), not as the ID that `task create` needs afterwards.
2. Use the `id` from the context response as `--context-id` for the task.
3. Create the task with a title and context ID; both are required. A due date is given as an ISO timestamp.
4. Optionally assign a member (see below).

Several tasks, including checklists and assignments, can be created together in one call.

### Changing, cancelling or completing a task

Changing a task only replaces the fields that were actually given. `completed` and `cancelled` may not be set back to `open`. To complete a task, a dedicated command is more convenient than a status change through update: it sets the status to `completed` and the completion timestamp to the current time in one step.

### Assigning a member

An assignment explicitly expects a member ID, not a user ID. An assignment can be marked as primarily responsible. Assignments can be fully read, updated and removed again.

### Maintaining contexts, notes and checklists

Contexts, notes and checklist items are passed as a file so the current backend payload can be set without a lossy field-by-field mapping. Checklist items can additionally be toggled (done/open) and reordered.

### Setting a personal task reminder

Every signed-in user can set, view and delete exactly one own, freely chosen reminder for a task visible to them:

1. Give the reminder time as a valid, future timestamp in RFC 3339 format.
2. Optionally add a comment.
3. Setting a reminder again for the same task replaces the existing personal reminder idempotently.

Right before delivery, Comvenio checks task existence and active membership again and takes the club context automatically from the task. A reminder that was replaced, deleted, or is no longer allowed after leaving the club, is not delivered; it is delivered exclusively to the member's own account. A club, member, user or recipient ID is not needed for these commands and is not sent either.

### Scope boundary

Internal automation routes, specialized polling and scheduling-matrix models, and cross-cutting cleanup endpoints are not general club actions. The usual task, context, assignment, note and checklist workflow is fully reachable through the CLI.

## Examples

```bash
comvenio task context list --json

comvenio task context create \
  --context-type event \
  --ref-id <event-id> \
  --json
```

```bash
comvenio task list --json
comvenio task list --mine --json
comvenio task show <task-id> --json
comvenio task show <task-id> --subtasks --json
comvenio task show <task-id> --chain --json
```

`--mine` returns the tasks assigned to the current user. `--subtasks` loads the subtasks, `--chain` the task chain instead of the normal detail view; `--subtasks` takes priority when both are set.

```bash
comvenio task create \
  --title "Getränkestand besetzen" \
  --context-id <task-context-id> \
  --description "Zwei Schichten einteilen" \
  --priority high \
  --status open \
  --department-id <department-id> \
  --due-date 2026-07-20T18:00:00+02:00 \
  --json
```

```json
{
  "items": [
    {
      "task": {
        "club_id": "<club-id>",
        "task_context_id": "<task-context-id>",
        "title": "Dartboards aufbauen",
        "priority": "high"
      },
      "checklist_items": [{ "title": "Werkzeug prüfen", "order_index": 0 }],
      "assignments": [{ "member_id": "<member-id>", "is_responsible": true }]
    }
  ]
}
```

```bash
comvenio task bulk --file tasks.json --json
```

```bash
comvenio task update <task-id> --title "Neuer Titel" --priority medium --json
comvenio task update <task-id> --status in_progress --json
comvenio task update <task-id> --status cancelled --json
comvenio task update <task-id> --file task-update.json --json
comvenio task delete <task-id> --json
comvenio task done <task-id> --json
```

```bash
comvenio task assign <task-id> --member-id <member-id> --responsible --json

comvenio task assignment list <task-id> --json
comvenio task assignment show <assignment-id> --json
comvenio task assignment update <assignment-id> --file assignment-update.json --json
comvenio task assignment delete <assignment-id> --json
```

```bash
comvenio task context show <context-id> --json
comvenio task context update <context-id> --file context-update.json --json
comvenio task context delete <context-id> --json

comvenio task note list <task-id> --json
comvenio task note add <task-id> --file note.json --json
comvenio task note update <note-id> --file note-update.json --json
comvenio task note delete <note-id> --json

comvenio task checklist list <task-id> --json
comvenio task checklist add <task-id> --file checklist-item.json --json
comvenio task checklist update <item-id> --file checklist-item-update.json --json
comvenio task checklist toggle <item-id> --json
comvenio task checklist reorder <task-id> --file reorder.json --json
comvenio task checklist delete <item-id> --json
```

The verified fields per route are also shown by `comvenio schema task --json`.

```bash
comvenio task reminder set <task-id> \
  --remind-at 2026-07-25T18:00:00+02:00 \
  --comment "Getränkebestellung prüfen" \
  --json

comvenio task reminder list <task-id> --json
comvenio task reminder delete <task-id> --json
```

## Commands and actions

<!-- gen:docs befehle -->

**task** — complete

- `comvenio task list`
- `comvenio task show`
- `comvenio task show --subtasks`
- `comvenio task show --chain`
- `comvenio task create`
- `comvenio task bulk`
- `comvenio task update`
- `comvenio task assign`
- `comvenio task done`
- `comvenio task delete`
- `comvenio task reminder set|list|delete`
- `comvenio task context list|show|create|update|delete`
- `comvenio task assignment list|show|update|delete`
- `comvenio task note list|add|update|delete`
- `comvenio task checklist list|add|update|toggle|delete|reorder`
- Fields and values: `comvenio schema task --json`
<!-- /gen:docs -->

## Errors

- `VALIDATION_FAILED` — a required field such as title or context ID is missing, or a status change is not allowed (for example, back to `open`). More: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — the task, context, assignment, note or checklist item does not exist or is not visible. More: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow this task action. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the required task scope, for example for writing. More: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — the task was changed in the meantime, or does not allow the requested status change in its current state. More: `comvenio help fehler CONFLICT`
