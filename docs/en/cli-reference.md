---
id: cli-reference
kategorie: thema
domaenen: [schema, help, verify, plan]
stichwoerter: [cli, reference, commands, schema, verify]
---

# comvenio CLI — overview

## Purpose

This article is the entry point to the comvenio CLI: the ground rules for
every call, an overview of the areas with a pointer to their own article,
and the topic commands `schema` and `verify`, which don't form a topic of
their own but accompany every other area. The full workflow coverage with
known gaps and deliberate exclusions per area is in
[`coverage.md`](coverage.md).

## Requirements and permissions

Sign in with `comvenio login`; which actions your club has enabled and which
scopes they need is shown by `comvenio action list --json`.

Every command needs a valid sign-in; exceptions and details are in the
article on sign-in and club context. What is allowed beyond that follows
from the sign-in's scopes and the role in the club — the server-side check
decides, not the CLI itself.

## Workflows

### Ground rules

```bash
comvenio <command> --help
comvenio <command> ... --json
```

- For automated calls, always use `--json`. Successful responses land on
  standard output, errors on standard error.
- The sign-in runs through the browser with secure storage in the
  respective operating system.
- Permissions are checked on the server: `401` usually means an invalid or
  expired sign-in, `403` a missing permission, `404` an unknown resource.
- If there is no matching action for a task, that is a gap in the connector
  — it gets closed there, not worked around.
- Changes are never retried automatically; only read requests have a limited
  retry on transient errors.

### Areas and their actions

Every area has its own article. The path to its actions is always the same:
`comvenio action list` shows what is enabled for the current sign-in
(`--json` additionally shows inputs and scopes), and
`comvenio action call <action-id> --input '<json>'` runs them.

| Area | Article |
|---|---|
| sign-in, club context, available actions, club profile and design | [`auth-club.md`](auth-club.md) |
| public club homepage: preview, apply, show | [`homepage.md`](homepage.md) |
| members, families, membership periods, teams | [`mitglieder-teams.md`](mitglieder-teams.md) |
| custom roles, permission matrix, assignments, effective rights | [`rollen-rechte.md`](rollen-rechte.md) |
| events, templates, series | [`veranstaltungen.md`](veranstaltungen.md) |
| bookings, objects, buildings, rooms, booking rules | [`buchungen-objekte.md`](buchungen-objekte.md) |
| tasks, contexts, assignments, notes, checklists | [`aufgaben.md`](aufgaben.md) |
| menus, ingredients, shopping lists | [`speisekarten.md`](speisekarten.md) |
| meeting series, minutes, agenda, votes, resolutions | [`meetings.md`](meetings.md) |
| annual plan, budget items, bookings | [`finanzen.md`](finanzen.md) |
| files, folders, structured exports | [`dateien.md`](dateien.md) |
| rich news, preview, publishing, videos | [`vereinsnews.md`](vereinsnews.md) |
| site plans, zones, tables, markers, guests | [`veranstaltungen.md`](veranstaltungen.md) |
| series, runs, participants, schedule, results | [`turniere.md`](turniere.md) |
| local sponsors, products, contracts, assignments | [`sponsoring.md`](sponsoring.md) |
| club area: divisions, zones, overview | [`zonen.md`](zonen.md) |
| club agent: chat, functions, approvals | [`club-agent.md`](club-agent.md) |
| weekly preview: flyers and templates | [`wochenvorschau.md`](wochenvorschau.md) |

### Help in the program

```bash
comvenio help
comvenio help zonen
comvenio help fehler SCOPE_REQUIRED
comvenio help suche booking
```

`comvenio help` shows the same articles as this documentation — offline, without sign-in and in the
version that belongs to the installed program. A topic can be opened by its name or by one of its
commands (`comvenio help zone`). `--lang en` or an English environment choose the English version,
`--json` returns `{ id, title, lang, markdown, related }`. Every error message points to its article
with `comvenio help fehler <CODE>`.

### Querying schemas

```bash
comvenio schema --json
comvenio schema event --json
```

`schema` answers the question "which fields and values may I send?" for a
given area — offline, without sign-in. Sending undocumented fields based on
a guess is not supported — when in doubt, the matching schema is checked
first.

### Read first, then change

```bash
comvenio action call cai.task.02.show --input '{"task_id":"<task-id>"}' --json
```

For full-replace changes, the service reads the existing data and merges in
the given fields. Even so, the current state should be checked with the
matching read action before every change.

### Complex input as JSON

Multi-part structures are submitted as JSON in `--input '<json>'`. The
matching topic article describes the expected JSON; undocumented fields
based on guesses are never used.

### Preview before publishing

```bash
comvenio action call cai.homepage.01.preview \
  --input '{"tabs":[{"label":"Home","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"clear_existing":false}' \
  --json
comvenio action call cai.verify.04.homepage \
  --input '{"operation":"live","viewports":["390x844","1440x900"],"audit":true,"wait_ms":500}' \
  --json
```

Preview and checking never replace approval. Publishing or changing steps
run only after a factual or visual check.

### Checking with `verify`

```bash
comvenio action call cai.verify.01.url \
  --input '{"target_url":"https://club.web.comvenio.app","viewports":["390x844","1440x900"],"audit":true,"wait_ms":500}' \
  --json
comvenio action call cai.verify.04.homepage \
  --input '{"operation":"live","viewports":["390x844","1440x900"],"audit":true,"wait_ms":500}' \
  --json
```

The `verify` actions visually check an address, an event, a menu, the
homepage, a news item or a certificate, and report findings instead of a
plain pass/fail. Details per area are in the respective topic article.

### Deliberately removed generators

Content is never generated automatically — Comvenio composes content and
design deliberately instead and stores them declaratively:

- Menu: create the menu and its entries or apply from a file, design through
  its own style command.
- Homepage: generate a preview through an action, then apply it (see
  [`homepage.md`](homepage.md)); the theme is set through the club design
  (`cai.club.05.design`, see [`auth-club.md`](auth-club.md)).

There is no additional background call that invents content.

## Examples

Query the schema of an area, then read a task:

```bash
comvenio schema task --json
comvenio action call cai.task.02.show --input '{"task_id":"<task-id>"}' --json
```

Check a public address visually:

```bash
comvenio action call cai.verify.01.url \
  --input '{"target_url":"https://club.web.comvenio.app","viewports":["390x844","1440x900"],"audit":true,"wait_ms":500}' \
  --json
```

## Commands and actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Errors

- `AUTH_REQUIRED` — the sign-in has expired, was revoked, or is missing; sign
  in again. `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — the sign-in is missing the scope for this action; the
  displayed `comvenio login --scopes …` command fixes it.
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — the club role does not allow the action.
  `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — the given identifier does not belong to any visible or
  existing entry. `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — the input does not match the action's schema.
  `comvenio help fehler VALIDATION_FAILED`.
- `OUTCOME_UNKNOWN` — a write action (for example `action confirm` on
  `homepage apply` or a `plan` deletion) ended with a timeout or server
  error; do not retry, check the current state first.
  `comvenio help fehler OUTCOME_UNKNOWN`.
- `USAGE_ERROR` — an argument or option is missing, does not fit together,
  or has the wrong format. `comvenio help fehler USAGE_ERROR`.
- `OAUTH_ONLY` — an old command does not run with the current sign-in; find
  the matching action with `comvenio action list`.
  `comvenio help fehler OAUTH_ONLY`.
