---
id: cli-reference
kategorie: thema
domaenen: [schema, help, verify, plan]
stichwoerter: [cli, reference, commands, schema, verify]
---

# comvenio CLI — overview

## Purpose

This article is the entry point to the comvenio CLI: the ground rules for
every call, an overview of the top-level commands with a pointer to their
own article, and the topic commands `schema` and `verify`, which don't form
a topic of their own but accompany every other command. The full workflow
coverage with known gaps and deliberate exclusions per command is in
[`coverage.md`](coverage.md).

## Requirements and permissions

> **Sign-in:** Except `login`, `logout`, `whoami`, `action`, `finance`, `schema` and `help`, all commands are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

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
- The default is the browser sign-in with secure storage in the respective
  operating system; an opaque device token is the older path for the
  classic commands and is never decoded.
- Permissions are checked on the server: `401` usually means an invalid or
  expired sign-in, `403` a missing permission, `404` an unknown resource.
- If there is no matching command for a task, that is a gap in the CLI — it
  gets closed there, not worked around.
- Changes are never retried automatically; only read requests have a limited
  retry on transient errors.

### Topics and their commands

Every top-level command belongs to a topic with its own article:

| Command | Area | Article |
|---|---|---|
| `login`, `logout`, `whoami`, `action`, `club` | sign-in, club context, available actions, club profile and design | [`auth-club.md`](auth-club.md) |
| `homepage` | public club homepage: preview, apply, show | [`homepage.md`](homepage.md) |
| `member`, `team` | members, families, membership periods, teams | [`mitglieder-teams.md`](mitglieder-teams.md) |
| `role` | custom roles, permission matrix, assignments, effective rights | [`rollen-rechte.md`](rollen-rechte.md) |
| `event` | events, templates, series | [`veranstaltungen.md`](veranstaltungen.md) |
| `booking`, `object` | bookings, objects, buildings, rooms, booking rules | [`buchungen-objekte.md`](buchungen-objekte.md) |
| `task` | tasks, contexts, assignments, notes, checklists | [`aufgaben.md`](aufgaben.md) |
| `recipe`, `ingredient`, `ingredient-category`, `shopping`, `template`, `menu` | menus, ingredients, shopping lists | [`speisekarten.md`](speisekarten.md) |
| `meeting` | meeting series, minutes, agenda, votes, resolutions | [`meetings.md`](meetings.md) |
| `finance` | annual plan, budget items, bookings | [`finanzen.md`](finanzen.md) |
| `data` | files, folders, structured exports | [`dateien.md`](dateien.md) |
| `news` | rich news, preview, publishing, videos | [`vereinsnews.md`](vereinsnews.md) |
| `plan` | site plans, zones, tables, markers, guests | [`veranstaltungen.md`](veranstaltungen.md) |
| `tournament` | series, runs, participants, schedule, results | [`turniere.md`](turniere.md) |
| `sponsor` | local sponsors, products, contracts, assignments | [`sponsoring.md`](sponsoring.md) |
| `zone`, `task-zones` | club area: divisions, zones, overview | [`zonen.md`](zonen.md) |
| `agent` | club agent: chat, functions, approvals | [`club-agent.md`](club-agent.md) |
| `weekly-preview` | weekly preview: flyers and templates | [`wochenvorschau.md`](wochenvorschau.md) |

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
given area. Sending undocumented fields based on a guess is not supported —
when in doubt, the matching schema is checked first.

### Read first, then change

```bash
comvenio event show <event-id> --json
comvenio news show <news-id> --json
comvenio task show <task-id> --json
```

For full-replace changes, the CLI reads the existing data and merges in the
given fields. Even so, the current state should be checked before every
change.

### Complex input as a file

Multi-part structures are submitted through a file. The matching topic
article describes the expected JSON; undocumented fields based on guesses
are never used.

### Preview before publishing

```bash
comvenio news preview --file news.json --json
comvenio homepage preview --file homepage.json --ttl-hours 24 --json
comvenio tournament preview <id> --json
comvenio verify event <event-id> --json
```

Preview and checking never replace approval. Publishing or changing steps
run only after a factual or visual check.

### Checking with `verify`

```bash
comvenio verify --help
comvenio verify url <address> --json
comvenio verify homepage --audit --json
```

`verify` visually checks an address, an event, a menu, the homepage, a news
item or a certificate, and reports findings with a clear exit code instead
of a plain pass/fail. Details per area are in the respective topic article.

### Deliberately removed generators

`menu generate`, `menu design`, `homepage generate` and `homepage design`
never generate content automatically — these calls deliberately abort with
an explanation. Content and design are instead deliberately composed and
stored declaratively:

- Menu: create the menu and its entries or apply from a file, design through
  its own style command.
- Homepage: generate a preview from a file, then apply it; the theme is set
  through the club design.

There is no additional background call that invents content.

## Examples

Query the schema of an area and read the structure before checking it:

```bash
comvenio schema event --json
comvenio event show <event-id> --json
comvenio verify event <event-id> --json
```

Check a public address visually:

```bash
comvenio verify url https://club.web.comvenio.app --json
```

## Commands and actions

<!-- gen:docs befehle -->

**schema** — core available, some workflows missing

- `comvenio schema`
- `comvenio schema <domain>`

**help** — complete

- `comvenio help`
- `comvenio help <thema>`
- `comvenio help fehler`
- `comvenio help fehler <code>`
- `comvenio help suche <text>`

**verify** — complete

- `comvenio verify url`
- `comvenio verify event`
- `comvenio verify menu`
- `comvenio verify homepage`
- `comvenio verify news`
- `comvenio verify certificate`

**plan** — complete

- `comvenio plan list`
- `comvenio plan show`
- `comvenio plan create`
- `comvenio plan update`
- `comvenio plan delete`
- `comvenio plan zone list|create|update|delete|link|unlink`
- `comvenio plan table create|duplicate|update|delete`
- `comvenio plan marker create|update|delete`
- `comvenio plan guest list|add|update|delete`
- `comvenio plan detail`
- `comvenio plan export`
- `comvenio plan illustrate`
- `comvenio plan compose`
<!-- /gen:docs -->

## Errors

- `AUTH_REQUIRED` — the sign-in has expired, was revoked, or is missing; sign
  in again. `comvenio help fehler AUTH_REQUIRED`.
- `PERMISSION_DENIED` — the club role does not allow the command.
  `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — the given identifier does not belong to any visible or
  existing entry. `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — an input file does not match the area's schema.
  `comvenio help fehler VALIDATION_FAILED`.
- `USAGE_ERROR` — an argument or option is missing, does not fit together,
  or has the wrong format. `comvenio help fehler USAGE_ERROR`.
