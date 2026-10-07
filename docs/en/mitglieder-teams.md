---
id: mitglieder-teams
kategorie: thema
domaenen: [member, team]
stichwoerter: [members, teams, squads, roster, families, membership-status, season, resource-priorities]
---

# Members and teams

## Purpose

Through the actions of the `member`, `team` and `teams` domains, a club manages its members, families,
membership statuses and membership periods, as well as the permanent team master data including
squads and resource priorities, plus seasonal team management — seasons, season rosters, competitions,
iCal synchronization and team appointments.

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
permanent team master data — it does not replace it. Reading needs no confirmation; everything that
changes data is critical and goes through a preview and `comvenio action confirm`.

1. List teams (`cai.teams.01.list`, optionally with `department_id`), show one (`cai.teams.02.show`),
   create one (`cai.teams.03.create` with `department_id`, `name`, `sport_type`), change it
   (`cai.teams.04.update`, only the changed fields under `changes`) or archive it (`cai.teams.05.archive`).
2. List a team's seasons (`cai.teams.06.season_list`), create one (`cai.teams.07.season_create` with
   `name`, optionally `starts_on`, `ends_on`, `default_visibility` `PUBLIC` or `MEMBERS`), correct it
   (`cai.teams.08.season_correct`), activate it (`cai.teams.09.season_activate`) and complete it
   (`cai.teams.10.season_complete`).
3. Maintain the season roster: list it (`cai.teams.11.roster_list`), add a member
   (`cai.teams.12.roster_add` with `member_id`, optionally `role` `PLAYER`, `CAPTAIN`, `COACH`,
   `ASSISTANT_COACH`, `MANAGER`, `jersey_number`, `position`), change an entry (`cai.teams.13.roster_update`),
   remove one (`cai.teams.14.roster_remove`). To carry a roster over from a previous season, first look at
   `cai.teams.15.roster_carry_over_preview` with `source_season_id`, then run
   `cai.teams.16.roster_carry_over` with the chosen `member_ids`.
4. Season competitions: list them (`cai.teams.17.competition_list`), create one
   (`cai.teams.18.competition_create`, `type` `LEAGUE`, `CUP`, `FRIENDLY`, `TOURNAMENT`, `OTHER`),
   change one (`cai.teams.19.competition_update`), delete one (`cai.teams.20.competition_delete`).
5. Subscribe to a fixture list via iCal: list subscriptions (`cai.teams.21.ical_list`), create one with a
   `url` (`cai.teams.22.ical_create`), create a preview (`cai.teams.23.ical_preview`) and activate it with
   its `preview_token` (`cai.teams.24.ical_activate`); switch it off with `cai.teams.25.ical_deactivate`.
6. Start a synchronization right away (`cai.teams.26.sync_now`), look at runs (`cai.teams.27.sync_runs`
   with `limit`, `offset`), list open clarifications (`cai.teams.28.clarification_list`) and decide them
   (`cai.teams.29.clarification_resolve` with `resolution`, for example
   `{"type":"POSSIBLE_DUPLICATE","action":"KEEP_EXISTING"}`).
7. List team appointments (`cai.teams.30.termin_list`) and create one (`cai.teams.31.termin_create`,
   `kind` `MATCH`, `TRAINING`, `EXCURSION`, `OTHER`, plus `start_time`; a match needs `opponent`;
   repeat with weekdays via `repeat`). Change a hand-made appointment (`cai.teams.32.termin_update` with
   `event_id`). The fields sent change; a new start without an end moves the end along and keeps the
   duration. `null` clears opponent, home/away, competition, location and note (a match needs opponent
   and home/away). For a match the service always rebuilds the title from opponent and home/away, even
   when `termin` is empty; for the other kinds only when `title` is sent. The team name then stands in
   front ("F-Jugend: …"). For a series appointment `scope` applies: `THIS` changes this occurrence —
   opponent, home/away, competition and announcement belong to the whole series, though, and change
   there too; `FOLLOWING` ends the series before this occurrence and starts a new one from here, the
   following appointments get new ids. Times are ISO timestamps with a time zone, for example
   `2026-09-12T15:00:00+02:00` for 3 pm Central European Summer Time. The running season is shown by
   `cai.teams.06.season_list` (status `AKTIV`); its `id` is the `team_season_id`.

```bash
comvenio action call cai.teams.06.season_list --input '{"team_id":"<team-id>"}' --json

comvenio action call cai.teams.12.roster_add \
  --input '{"team_season_id":"<season-id>","member_id":"<member-id>","role":"CAPTAIN","jersey_number":7}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.teams.07.season_create \
  --input '{"team_id":"<team-id>","season":{"name":"Season 2026/27","starts_on":"2026-08-01","ends_on":"2027-06-30"}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.teams.31.termin_create \
  --input '{"team_season_id":"<season-id>","termin":{"kind":"MATCH","opponent":"SV Example","home_state":"HOME","start_time":"2026-09-12T15:00:00+02:00"}}' --json

comvenio action call cai.teams.32.termin_update \
  --input '{"team_season_id":"<season-id>","event_id":"<termin-id>","termin":{"location":"Sportplatz Motzing"}}' --json
```

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

**member**

- `cai.member.01.list` — list (read) · Scopes: `member.read.basic`
- `cai.member.02.show` — show (read) · Scopes: `member.read.details`
- `cai.member.03.add` — add (change) · Scopes: `admin.write`
- `cai.member.04.update` — update (change) · Scopes: `admin.write`
- `cai.member.05.remove` — remove (change with confirmation) · Scopes: `admin.write`
- `cai.member.06.import` — import (change with confirmation) · Scopes: `files.import`
- `cai.member.07.family_list` — family-list (read) · Scopes: `member.read.details`
- `cai.member.08.family_show` — family-show (read) · Scopes: `member.read.details`
- `cai.member.09.family_add` — family-add (change) · Scopes: `admin.write`
- `cai.member.10.family_update` — family-update (change) · Scopes: `admin.write`
- `cai.member.11.family_delete` — family-delete (change with confirmation) · Scopes: `admin.write`
- `cai.member.12.status_list` — status-list (read) · Scopes: `member.read.basic`
- `cai.member.13.status_show` — status-show (read) · Scopes: `member.read.details`
- `cai.member.14.status_add` — status-add (change) · Scopes: `admin.write`
- `cai.member.15.status_update` — status-update (change) · Scopes: `admin.write`
- `cai.member.16.status_delete` — status-delete (change with confirmation) · Scopes: `admin.write`
- `cai.member.17.period_list` — period-list (read) · Scopes: `member.read.basic`
- `cai.member.18.period_show` — period-show (read) · Scopes: `member.read.details`
- `cai.member.19.period_add` — period-add (change) · Scopes: `admin.write`
- `cai.member.20.period_update` — period-update (change) · Scopes: `admin.write`
- `cai.member.21.period_delete` — period-delete (change with confirmation) · Scopes: `admin.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"member"}'` (the sign-in sets `club_id` — never in `--input`)

**team**

- `cai.team.01.list` — list (read) · Scopes: `club.read`
- `cai.team.02.show` — show (read) · Scopes: `club.read`
- `cai.team.03.create` — create (change with confirmation) · Scopes: `club.write`
- `cai.team.04.update` — update (change with confirmation) · Scopes: `club.write`
- `cai.team.05.delete` — delete (change with confirmation) · Scopes: `admin.write`
- `cai.team.06.member_list_add_update_remove` — member list|add|update|remove (change with confirmation) · Scopes: `admin.write`
- `cai.team.07.resource_list_add_update_remove` — resource list|add|update|remove (change with confirmation) · Scopes: `admin.write`
- `cai.teams.01.list` — list (read) · Scopes: `club.read`
- `cai.teams.02.show` — show (read) · Scopes: `club.read`
- `cai.teams.03.create` — create (change with confirmation) · Scopes: `club.write`
- `cai.teams.04.update` — update (change with confirmation) · Scopes: `club.write`
- `cai.teams.05.archive` — archive (change with confirmation) · Scopes: `club.write`
- `cai.teams.06.season_list` — season list (read) · Scopes: `club.read`
- `cai.teams.07.season_create` — season create (change with confirmation) · Scopes: `club.write`
- `cai.teams.08.season_correct` — season update (change with confirmation) · Scopes: `club.write`
- `cai.teams.09.season_activate` — season activate (change with confirmation) · Scopes: `club.write`
- `cai.teams.10.season_complete` — season complete (change with confirmation) · Scopes: `club.write`
- `cai.teams.11.roster_list` — roster show (read) · Scopes: `club.read`
- `cai.teams.12.roster_add` — roster add (change with confirmation) · Scopes: `club.write`
- `cai.teams.13.roster_update` — roster update (change with confirmation) · Scopes: `club.write`
- `cai.teams.14.roster_remove` — roster remove (change with confirmation) · Scopes: `club.write`
- `cai.teams.15.roster_carry_over_preview` — roster carry-over --preview (read) · Scopes: `club.read`
- `cai.teams.16.roster_carry_over` — roster carry-over (change with confirmation) · Scopes: `club.write`
- `cai.teams.17.competition_list` — competition list (read) · Scopes: `club.read`
- `cai.teams.18.competition_create` — competition create (change with confirmation) · Scopes: `admin.write`
- `cai.teams.19.competition_update` — competition update (change with confirmation) · Scopes: `admin.write`
- `cai.teams.20.competition_delete` — competition delete (change with confirmation) · Scopes: `admin.write`
- `cai.teams.21.ical_list` — ical list (read) · Scopes: `club.read`
- `cai.teams.22.ical_create` — ical create (change with confirmation) · Scopes: `admin.write`
- `cai.teams.23.ical_preview` — ical preview (change) · Scopes: `admin.write`
- `cai.teams.24.ical_activate` — ical activate (change with confirmation) · Scopes: `admin.write`
- `cai.teams.25.ical_deactivate` — ical deactivate (change with confirmation) · Scopes: `admin.write`
- `cai.teams.26.sync_now` — sync now (change with confirmation) · Scopes: `admin.write`
- `cai.teams.27.sync_runs` — sync runs (read) · Scopes: `club.read`
- `cai.teams.28.clarification_list` — sync clarifications (read) · Scopes: `club.read`
- `cai.teams.29.clarification_resolve` — sync resolve (change with confirmation) · Scopes: `admin.write`
- `cai.teams.30.termin_list` — termin list (read) · Scopes: `club.read`
- `cai.teams.31.termin_create` — termin create (change with confirmation) · Scopes: `club.write`
- `cai.teams.32.termin_update` — termin update (change with confirmation) · Scopes: `club.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"team"}'` (the sign-in sets `club_id` — never in `--input`)
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
- `USAGE_ERROR` — a command the CLI no longer has; find the matching action with
  `comvenio action list`. See `comvenio help fehler USAGE_ERROR`.
