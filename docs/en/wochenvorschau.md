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

Sign in with `comvenio login`; which actions your club has enabled and which scopes they need is
shown by `comvenio action list --json`. Same rights as the button in the web app: the club role
needs the right to manage club settings, or the right to manage events of the relevant department.

## Workflows

### Creating a weekly preview

1. `comvenio action call cai.club.11.weekly_preview_create --input '{"department_id":"<department-id>","range":"next_week","telegram":false}'`
   creates a preview for the coming week.
2. Without `"team_ids"`, all teams of the department are included; with
   `"team_ids":["<team-id-a>","<team-id-b>"]` only the ones named. `"event_ids"` selects individual
   events instead of a whole time range.
3. `"range"` is `next_week` or `next_7_days`; with `"telegram": true` the draft also goes to the
   linked Telegram chats after approval.
4. The action is `critical_write`: the call first returns a preview with `preview_id` and
   `confirmation_token`, plus the run and plan ID; the draft itself is only created on confirmation
   and then sits in the agent messenger for approval.
5. Check the preview, then confirm:
   `comvenio action confirm --preview-id <preview-id> --confirmation-token <confirmation-token> --idempotency-key <key>`.
   The idempotency key makes a repeat safe: if the confirmation aborts on a timeout, the service may
   still have kept working — the same key then returns the same run instead of a second one.

### Viewing a plan's weekly previews

1. `comvenio action call cai.club.12.weekly_preview_list --input '{"plan_id":"<plan-id>","limit":20}'`
   (the plan ID comes from the response of `weekly_preview_create`, `limit` is required).
2. Each entry shows the date, the number of events and the state: "wartet auf Freigabe" (awaiting
   approval), "veröffentlicht: <link>" (published) or — once the publish link has expired —
   "veröffentlicht (Link abgelaufen)" (published, link expired).

### Templates

Not yet available as an action — do this in the web app.

## Examples

```bash
comvenio action call cai.club.11.weekly_preview_create --input '{"department_id":"<department-id>","range":"next_week","telegram":false}'
comvenio action confirm --preview-id <preview-id> --confirmation-token <confirmation-token> --idempotency-key <key>
comvenio action call cai.club.11.weekly_preview_create --input '{"department_id":"<department-id>","team_ids":["<team-id-a>","<team-id-b>"],"range":"next_7_days","telegram":true}'
comvenio action call cai.club.12.weekly_preview_list --input '{"plan_id":"<plan-id>","limit":20}'
```

## Commands and actions

<!-- gen:docs befehle -->

**weekly-preview**

- `cai.club.11.weekly_preview_create` — weekly-preview-create (change with confirmation) · Scopes: `club.write`
- `cai.club.12.weekly_preview_list` — weekly-preview-list (read) · Scopes: `club.read`
<!-- /gen:docs -->

## Errors

- `CONFIRMATION_REQUIRED` — `weekly_preview_create` is `critical_write` and without confirmation
  only creates a preview; only `comvenio action confirm` triggers it. More:
  `comvenio help fehler CONFIRMATION_REQUIRED`.
- `CONFIRMATION_EXPIRED` — the preview expired before it was confirmed; call `create` again. More:
  `comvenio help fehler CONFIRMATION_EXPIRED`.
- `OUTCOME_UNKNOWN` — `action confirm` exceeded the time limit or ended with a server error; the
  weekly preview may still have been created — do not simply retry, check with
  `weekly_preview_list` first. More: `comvenio help fehler OUTCOME_UNKNOWN`.
- `VALIDATION_FAILED` — `department_id` is missing, `range` is invalid, or a field does not match
  the input schema. More: `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — the plan is not known under the given identifier. More:
  `comvenio help fehler NOT_FOUND`.
- `SCOPE_REQUIRED` — the sign-in is missing `club.write` (to create) or `club.read` (to view).
  More: `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — the club role does not allow creating or viewing. More:
  `comvenio help fehler PERMISSION_DENIED`.
