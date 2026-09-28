---
id: mitglieder-teams
kategorie: thema
domaenen: [member, team]
stichwoerter: [members, teams, squads, roster, families, membership-status, season, resource-priorities]
---

# Members and teams

## Purpose

Through the actions of the `member` and `team` domains, a club manages its members, families,
membership statuses and membership periods, as well as the permanent team master data including
squads and resource priorities. Seasonal team management — seasons, season rosters, competitions,
iCal synchronization and team appointments — is not yet available as an action.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by
`comvenio action list --json`.

- Reading members, teams, squads and resource priorities requires the member visibility permission in
  the club.
- Creating, updating or deleting members, families, membership statuses, membership periods and team
  master data requires the `manage_members` permission in the club.
- `--json` returns the unchanged response for scripts and agents.
- Instead of `--input '<json>'`, larger inputs can also be passed with `--file <path>` (UTF-8 JSON).

## Workflows

### Managing members

1. List members or view a single one.
2. Create a new member with first name, last name and email address.
3. Update or remove a member (removing is critical: preview first, then confirm).

```bash
comvenio action call cai.member.01.list --input '{"limit":20,"offset":0}' --json
comvenio action call cai.member.02.show --input '{"member_id":"<member-id>"}' --json
comvenio action call cai.member.03.add \
  --input '{"member":{"first_name":"Max","last_name":"Muster","email":"max@example.org"}}' --json
comvenio action call cai.member.04.update \
  --input '{"member_id":"<member-id>","changes":{"phone_number":"+49 123 456789"}}' --json
comvenio action call cai.member.05.remove --input '{"member_id":"<member-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

`member.add` can additionally set `membership_status_id` and `family_id`. These two relationships
cannot be changed through a later update — the dedicated status and period workflows below exist for
that.

### Bulk-importing members

1. Upload the import file beforehand (see article "DataShare — files, folders and papers") and note
   its file identifier.
2. Trigger the import with that file identifier — critical: check the preview, then confirm.

```bash
comvenio action call cai.member.06.import --input '{"file_id":"<file-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

### Families

1. List families or view a single one.
2. Create a family with a name and a responsible member, or update it.
3. Delete a family — critical.

```bash
comvenio action call cai.member.07.family_list --input '{}' --json
comvenio action call cai.member.08.family_show --input '{"family_id":"<family-id>"}' --json
comvenio action call cai.member.09.family_add \
  --input '{"family":{"name":"Muster family","notes":"Family fee","responsible_member_id":"<member-id>"}}' --json
comvenio action call cai.member.10.family_update \
  --input '{"family_id":"<family-id>","changes":{"notes":"Updated note"}}' --json
comvenio action call cai.member.11.family_delete --input '{"family_id":"<family-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Required fields when creating: name and responsible member.

### Membership statuses

1. List, view, create or update statuses.
2. Delete a status — critical.

```bash
comvenio action call cai.member.12.status_list --input '{}' --json
comvenio action call cai.member.13.status_show --input '{"status_id":"<status-id>"}' --json
comvenio action call cai.member.14.status_add \
  --input '{"status":{"name":"Active","description":"Active club member","is_discount_eligible":false,"priority":100}}' --json
comvenio action call cai.member.15.status_update \
  --input '{"status_id":"<status-id>","changes":{"priority":80}}' --json
comvenio action call cai.member.16.status_delete --input '{"status_id":"<status-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Values such as "Active" are club-specific records with a name, description, discount eligibility and
priority — not a fixed set shared across clubs.

### Membership periods

1. List a member's periods or view a single one.
2. Create a period with a join date, optionally with a leave date, reason and note; update it.
3. Delete a period — critical.

```bash
comvenio action call cai.member.17.period_list --input '{"member_id":"<member-id>"}' --json
comvenio action call cai.member.18.period_show --input '{"period_id":"<period-id>"}' --json
comvenio action call cai.member.19.period_add \
  --input '{"period":{"member_id":"<member-id>","joined_at":"2020-01-01","note":"Rejoined"}}' --json
comvenio action call cai.member.20.period_update \
  --input '{"period_id":"<period-id>","changes":{"left_at":"2026-06-30","reason":"Resignation"}}' --json
comvenio action call cai.member.21.period_delete --input '{"period_id":"<period-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

### Managing teams (master data)

1. List the club's teams or view a team with its squad and resource priorities.
2. Create a team with a department, name and sport type; partially update it.
3. Delete a team — critical.

```bash
comvenio action call cai.team.01.list --input '{}' --json
comvenio action call cai.team.02.show --input '{"team_id":"<team-id>"}' --json
comvenio action call cai.team.03.create \
  --input '{"team":{"department_id":"<department-id>","name":"Darts 1","sport_type":"OTHER","gender":"MIXED","season":"2026/27","required_resource_count":2,"buffer_before_minutes":30,"buffer_after_minutes":15}}' --json
comvenio action call cai.team.04.update \
  --input '{"team_id":"<team-id>","changes":{"name":"Darts First Team","home_location":"Clubhouse","required_resource_count":3}}' --json
comvenio action call cai.team.05.delete --input '{"team_id":"<team-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Valid sport types: `FOOTBALL`, `HANDBALL`, `BASKETBALL`, `VOLLEYBALL`, `TENNIS`, `TABLE_TENNIS`,
`OTHER`. Gender: `MALE`, `FEMALE`, `MIXED`.

### A team's squad

This action is critical as a whole — even reading the squad first shows a preview and requires
confirmation.

```bash
comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"list","team_id":"<team-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"add","team_id":"<team-id>","member_id":"<member-id>","role":"PLAYER"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"update","team_id":"<team-id>","member_id":"<member-id>","changes":{"role":"CAPTAIN"}}' --json
comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"remove","team_id":"<team-id>","member_id":"<member-id>"}' --json
```

`member_id` is the member's ID within the club, not the user ID. Comvenio rejects a duplicate
assignment of the same member to the same team as a conflict. Roles: `PLAYER`, `CAPTAIN`, `COACH`,
`ASSISTANT_COACH`, `MANAGER`; optionally also a jersey number (`jersey_number`) and position.

### Resource priorities

Resource priorities assign bookable objects to a team, such as halls, courts or equipment. This
action is also critical as a whole — every sub-action requires a preview and confirmation.

```bash
comvenio action call cai.team.07.resource_list_add_update_remove \
  --input '{"operation":"list","team_id":"<team-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.team.07.resource_list_add_update_remove \
  --input '{"operation":"add","team_id":"<team-id>","object_id":"<object-id>","priority":1,"booking_duration_minutes":120,"notes":"Tuesday training"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

### Seasonal teams

Seasonal team management adds seasons with a lifecycle of Draft → Active → Completed, season rosters,
competitions, iCal subscriptions, schedule synchronization and team appointments on top of the
permanent team master data — it does not replace it. This area is not yet available as an action —
manage it in the web app. The machine-readable contract is available independently via
`comvenio schema team --json` once the domain is enabled in the central schema index.

## Examples

Create and update a member:

```bash
comvenio action call cai.member.01.list --input '{"limit":20,"offset":0}' --json
comvenio action call cai.member.03.add \
  --input '{"member":{"first_name":"Max","last_name":"Muster","email":"max@example.org"}}' --json
comvenio action call cai.member.04.update \
  --input '{"member_id":"<member-id>","changes":{"phone_number":"+49 123 456789"}}' --json
```

Create a family:

```bash
comvenio action call cai.member.09.family_add \
  --input '{"family":{"name":"Muster family","notes":"Family fee","responsible_member_id":"<member-id>"}}' --json
```

Create a membership status:

```bash
comvenio action call cai.member.14.status_add \
  --input '{"status":{"name":"Active","description":"Active club member","is_discount_eligible":false,"priority":100}}' --json
```

Create a membership period:

```bash
comvenio action call cai.member.19.period_add \
  --input '{"period":{"member_id":"<member-id>","joined_at":"2020-01-01","note":"Rejoined"}}' --json
```

Create a team and maintain its squad and a resource priority:

```bash
comvenio action call cai.team.03.create \
  --input '{"team":{"department_id":"<department-id>","name":"Darts 1","sport_type":"OTHER","gender":"MIXED","season":"2026/27","required_resource_count":2,"buffer_before_minutes":30,"buffer_after_minutes":15}}' --json

comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"add","team_id":"<team-id>","member_id":"<member-id>","role":"PLAYER"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.team.07.resource_list_add_update_remove \
  --input '{"operation":"add","team_id":"<team-id>","object_id":"<object-id>","priority":1,"booking_duration_minutes":120,"notes":"Tuesday training"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

## Commands and actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Errors

- `PERMISSION_DENIED` — the club role does not allow creating, updating or deleting members, families,
  teams or squad entries, even though the sign-in carries the required scopes. See
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — a field in the input is missing, not allowed or has the wrong format, for
  example when creating a member, family or team. See `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — the given member, family, team or squad ID does not belong to a visible entry in the
  connected club. See `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — a member is already assigned to the same team, or a change contradicts the current
  state. See `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — the sign-in was granted without the scope required for a write action. See
  `comvenio help fehler SCOPE_REQUIRED`.
- `OUTCOME_UNKNOWN` — a critical action (delete, squad or resource-priority changes) was not clearly
  confirmed after `action confirm`; check the current state with a read before retrying. See
  `comvenio help fehler OUTCOME_UNKNOWN`.
- `OAUTH_ONLY` — an old, classic command from this area (`comvenio member …`, `comvenio team …`) no
  longer works; use the matching action instead. See `comvenio help fehler OAUTH_ONLY`.
