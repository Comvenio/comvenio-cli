---
id: wochenvorschau
kategorie: thema
domaenen: [weekly-preview]
stichwoerter: [weekly preview, flyer, template, telegram, plan]
---

# Weekly preview

## Purpose

The weekly preview automatically creates a draft with a department's upcoming events — for
approval in the agent messenger and publishing afterwards. Templates control the draft's design.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Same endpoints and rights as the button in the web app: the club role needs the right to manage
club settings, or the right to manage events of the relevant department. Sign in with
`comvenio login`; the exact scopes needed are shown by `comvenio action list --json`.

## Workflows

### Creating a weekly preview

1. `comvenio weekly-preview create --department <department-id>` creates a preview for the coming
   week (default `--range next_week`, optionally `--range next_7_days`).
2. Without `--teams`, all teams of the department are included; with `--teams <id-a>,<id-b>` only
   the ones named.
3. With `--telegram`, the draft also goes to the linked Telegram chats after approval.
4. The response states the run and plan ID; the draft itself sits in the agent messenger for
   approval.
5. The call always carries an idempotency key — set by hand with `--idempotency-key <key>` or
   generated automatically otherwise. If the call aborts on a timeout, the service may still have
   kept working: calling again with the same key returns the original run instead of a second one.

### Viewing a plan's weekly previews

1. `comvenio weekly-preview list --plan <plan-id>` (the plan ID comes from `create`).
2. Each row shows the date, the number of events and the state: "wartet auf Freigabe" (awaiting
   approval), "veröffentlicht: <link>" (published) or — once the publish link has expired —
   "veröffentlicht (Link abgelaufen)" (published, link expired).

### Managing templates

1. List templates: `comvenio weekly-preview template list`, optionally filtered with
   `--department <department-id>`. Without templates, the system default applies.
2. View a single template: `comvenio weekly-preview template show <id>`.
3. Create a template: `comvenio weekly-preview template set --name "<name>" --department <department-id> --file design.json`
   (`--name` is required when creating).
4. Update a template: `comvenio weekly-preview template set <id> --name "<new name>"` or with
   `--file design.json`. `--department` only applies when creating — a template never changes its
   department. Without `--name` and without `--file` there is nothing to change.
5. Delete a template: `comvenio weekly-preview template delete <id>`.

A local preview image of the template (`template preview`) does not exist here yet — that follows
with the image part of this function.

## Examples

```bash
comvenio weekly-preview create --department <department-id>
comvenio weekly-preview create --department <department-id> --teams <team-id-a>,<team-id-b> --range next_7_days --telegram
comvenio weekly-preview list --plan <plan-id>
comvenio weekly-preview template list --department <department-id>
comvenio weekly-preview template set --name "Summer design" --department <department-id> --file design.json
comvenio weekly-preview template delete <template-id>
```

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**weekly-preview** — core available, some workflows missing

- `comvenio weekly-preview create`
- `comvenio weekly-preview list`
- `comvenio weekly-preview template list`
- `comvenio weekly-preview template show`
- `comvenio weekly-preview template set`
- `comvenio weekly-preview template delete`
<!-- /gen:docs -->

## Errors

- `OUTCOME_UNKNOWN` — `create` exceeded the time limit; the weekly preview may still have been
  created. More: `comvenio help fehler OUTCOME_UNKNOWN`.
- `VALIDATION_FAILED` — `--department` is missing, `--range` is invalid, or `template set` is
  missing `--name` when creating. More: `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — plan or template are not known under the given identifier. More:
  `comvenio help fehler NOT_FOUND`.
- `PERMISSION_DENIED` — the club role does not allow creating or managing templates. More:
  `comvenio help fehler PERMISSION_DENIED`.
