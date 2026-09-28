---
id: mitglieder-teams
kategorie: thema
domaenen: [member, team]
stichwoerter: [members, teams, squads, roster, families, membership-status, season, resource-priorities]
---

# Members and teams

## Purpose

`comvenio member` and `comvenio team` let a club manage its members, families, membership statuses
and membership periods, as well as the permanent team master data including squads and resource
priorities. `comvenio teams` adds seasonal team management on top: seasons with a lifecycle, season
rosters, competitions, iCal subscriptions, schedule synchronization and team appointments.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

- Reading members, teams, squads and resource priorities requires the member visibility permission
  in the club.
- Creating, updating or deleting members, families, membership statuses, membership periods and team
  master data requires the `manage_members` permission in the club.
- Creating or updating team appointments requires the season permission (manage teams) or the role of
  an active coach or team manager for that season.
- `--club <club-id>` overrides the club from the local sign-in.
- `--json` returns the unchanged response for scripts and agents.
- Larger inputs are passed as a UTF-8 JSON file with `--file <path>`.

## Workflows

### Managing members

1. List members or view a single one.
2. Create a new member with first name, last name and email address.
3. Update or remove a member.

`member add` can additionally assign a membership status and a family. These two relationships
cannot be changed through a later update — the dedicated status and membership-period workflows
exist for that.

### Families

1. List families or view a single one.
2. Create a family with a name and a responsible member.
3. Update or delete a family.

```bash
comvenio member family-list --json
comvenio member family-show <family-id> --json
comvenio member family-add --file family.json --json
comvenio member family-update <family-id> --file family-update.json --json
comvenio member family-delete <family-id> --json
```

The club is set automatically from the signed-in context when creating a family. Required fields when
creating one: name and responsible member.

### Membership statuses

1. List, view, create, update or delete statuses.

```bash
comvenio member status-list --json
comvenio member status-show <status-id> --json
comvenio member status-add --file status.json --json
comvenio member status-update <status-id> --file status-update.json --json
comvenio member status-delete <status-id> --json
```

Values such as "Active" are club-specific records with a name, description, discount eligibility and
priority — not a fixed set shared across clubs.

### Membership periods

1. List a member's periods or view a single one.
2. Create a period with a join date, optionally with a leave date, reason and note.
3. Update or delete a period.

```bash
comvenio member period-list <member-id> --json
comvenio member period-show <period-id> --json
comvenio member period-add --file period.json --json
comvenio member period-update <period-id> --file period-update.json --json
comvenio member period-delete <period-id> --json
```

When creating a period, the CLI adds the club from context automatically; an update may include the
join date, leave date, reason and note.

### Bulk-importing members

1. Prepare the import file with `preview: true` and run it as a dry run.
2. Check the preview result.
3. Only after a checked preview, run the real import; `reconcile_absent_members: true` marks missing
   existing members as having left and therefore belongs only in this second step.

The club in the import file is ignored and replaced with the signed-in club.

### Managing teams (master data)

1. List the club's teams or view a team with its squad and resource priorities.
2. Create a team with a department, name and sport type.
3. Partially update or remove a team.

| Purpose | Command |
|---|---|
| The club's teams | `comvenio team list` |
| Team with squad and priorities | `comvenio team show <team-id>` |
| Create a team | `comvenio team create --file team.json` |
| Update a team | `comvenio team update <team-id> --file patch.json` |
| Remove a team | `comvenio team delete <team-id>` |

Valid sport types: football, tennis, handball, basketball, volleyball, table tennis, other. Gender:
male, female, mixed.

### A team's squad

1. Read the squad.
2. Add a member with a role (player, captain, coach, assistant coach, manager), optionally with a
   jersey number and position.
3. Update or remove an assignment.

`member_id` is the member's ID within the club, not the user ID. Comvenio rejects a duplicate
assignment of the same member to the same team as a conflict.

### Resource priorities

Resource priorities assign bookable objects to a team, such as halls, courts or equipment.

1. Read a team's priorities.
2. Create a priority with an object and a rank (default 1), a booking duration in minutes (default
   120) and an optional note.
3. Update or remove a priority.

| Purpose | Command |
|---|---|
| Read priorities | `comvenio team resource list <team-id>` |
| Create a priority | `comvenio team resource add <team-id> --object-id <id> --priority 1` |
| Update a priority | `comvenio team resource update <team-id> --priority-id <id> --priority 2` |
| Remove a priority | `comvenio team resource remove <team-id> --priority-id <id>` |

### Seasonal teams (`comvenio teams`)

The `comvenio teams` namespace is the seasonal team management layer. It adds seasons with a
lifecycle of Draft → Active → Completed, season rosters, competitions, iCal subscriptions and
schedule synchronization on top of the permanent team master data — it does not replace it.

1. Create, view, list (optionally filtered by department, with or without sub-departments), update
   or archive a team.
2. Create, view, list, retroactively correct, activate or complete a team's season.
3. Add, update or remove season roster members; preview or selectively carry over a roster from a
   previous season.
4. Create, list, update or remove a season's competitions.
5. Create an iCal source, check it with a preview, activate or deactivate it.
6. Trigger synchronization immediately, review the sync history; list and resolve clarification cases
   from synchronization.
7. Create, update, cancel or delete team appointments — training, match, outing, other.

| Purpose | Command |
|---|---|
| List teams | `comvenio teams list [--department-id <id> [--include-descendants]]` |
| View a team | `comvenio teams show <team-id>` |
| Create a team | `comvenio teams create --name … --department-id … --sport-type … --yes` |
| Update a team | `comvenio teams update <team-id> … --yes` |
| Archive a team | `comvenio teams archive <team-id> --yes` |
| List seasons | `comvenio teams season list <team-id>` |
| View a season | `comvenio teams season show <season-id> --team <team-id>` |
| Create a season | `comvenio teams season create <team-id> --name … --yes` |
| Correct a season | `comvenio teams season update <season-id> --reason … … --yes` |
| Activate/complete a season | `comvenio teams season activate\|complete <season-id> --yes` |
| View a roster | `comvenio teams roster show <season-id>` |
| Add a roster member | `comvenio teams roster add <season-id> --member-id … --yes` |
| Update a roster entry | `comvenio teams roster update <roster-id> … --yes` |
| Remove a roster member | `comvenio teams roster remove <roster-id> --yes` |
| Roster carry-over (preview) | `comvenio teams roster carry-over <season-id> --source <id> --preview` |
| Carry over roster selectively | `comvenio teams roster carry-over <season-id> --source <id> [--members a,b] --yes` |
| List competitions | `comvenio teams competition list <season-id>` |
| Create a competition | `comvenio teams competition create <season-id> --name … --yes` |
| Update/remove a competition | `comvenio teams competition update\|delete <competition-id> --yes` |
| List iCal sources | `comvenio teams ical list <season-id>` |
| Save an iCal source | `comvenio teams ical create <season-id> --url … --yes` |
| iCal preview | `comvenio teams ical preview <subscription-id>` |
| Activate an iCal source | `comvenio teams ical activate <subscription-id> --preview-token … --yes` |
| Deactivate an iCal source | `comvenio teams ical deactivate <subscription-id> --yes` |
| Sync immediately | `comvenio teams sync now <subscription-id> --yes` |
| Sync history | `comvenio teams sync runs <subscription-id> [--limit --offset]` |
| List clarification cases | `comvenio teams sync clarifications <season-id>` |
| Resolve a clarification case | `comvenio teams sync resolve <clarification-id> --file resolution.json --yes` |
| A season's appointments | `comvenio teams termin list <season-id> [--kind training\|spiel\|ausflug\|sonstiges]` |
| View an appointment | `comvenio teams termin show <season-id> <event-id>` |
| Create an appointment | `comvenio teams termin create <season-id> --kind … --start … [--repeat di,do --until …] --yes` |
| Update an appointment | `comvenio teams termin update <season-id> <event-id> … [--scope this\|following] --yes` |
| Cancel an appointment | `comvenio teams termin cancel <season-id> <event-id> [--reason …] [--scope this\|following] --yes` |
| Delete an appointment | `comvenio teams termin delete <season-id> <event-id> [--scope this\|series] --yes` |

Behavior contract: every read and write action supports `--json`. Exit codes: `0` success, `2`
validation or unknown target, `3` missing permission, `4` conflict, `5` transport or service error.
Important mutations (create, archive, lifecycle transitions, activation, deactivation, immediate
sync, clarification resolution, and roster or competition writes) first show a full summary and
write nothing without explicit confirmation. Season-related writes always require the concrete
target ID, never a collective scope. iCal source URLs appear masked in output and summaries.

Activating an iCal source always follows the same chain: create the source → fetch a preview (returns
a short-lived preview token) → activate with that token. If the subscription changes, the token
expires and the preview must be fetched again. A clarification case is resolved with a type and an
action, for example an ambiguous home role confirmed as home, with the additional instruction to
reconcile the resource assignment afterwards.

Team appointments require the season permission (manage teams) or the role of an active coach or team
manager for that season. Start and end times are in Berlin local time. A repeat creates a series up to
an end date or the end of the season; a match additionally needs an opponent and whether it is a home
or away match. A general announcement can be switched on or off explicitly; without an explicit
setting it follows the kind of appointment. Error messages from the
service appear as a sentence with a code, for example a note that a match is missing its opponent; if
the season permission is missing, Comvenio rejects the change, and if the appointment has already
started, Comvenio reports a conflict (exit code `3` or `4` respectively, see above). Appointments originating from schedule synchronization appear in
the overview but cannot be edited there.

### Scope

External synchronizations with federation platforms (for example football or tennis association
portals) and an internal system-to-system route for booking information are not part of this CLI
area: provider imports depend on external providers, and the internal route uses its own
non-user-facing authentication.

The machine-readable contract for teams is available via `comvenio schema team --json` once the
domain is enabled in the central schema index.

## Examples

Create and update a member:

```bash
comvenio member list --json
comvenio member show <member-id> --json
comvenio member add --first-name Max --last-name Muster --email max@example.org --json
comvenio member update <member-id> --phone "+49 123 456789" --json
comvenio member remove <member-id> --json
```

Create a family (`family.json`):

```json
{
  "name": "Muster family",
  "notes": "Family fee",
  "responsible_member_id": "<member-id>"
}
```

```bash
comvenio member family-add --file family.json --json
```

Create a membership status (`status.json`):

```json
{
  "name": "Active",
  "description": "Active club member",
  "is_discount_eligible": false,
  "priority": 100
}
```

```bash
comvenio member status-add --file status.json --json
```

Create a membership period (`period.json`):

```json
{
  "member_id": "<member-id>",
  "joined_at": "2020-01-01",
  "left_at": null,
  "reason": null,
  "note": "Rejoined"
}
```

```bash
comvenio member period-add --file period.json --json
```

Bulk import with preview (`import.json`):

```json
{
  "preview": true,
  "import_date": "2026-07-13",
  "reconcile_absent_members": false,
  "present_member_ids": [],
  "rows": [
    {
      "row_index": 1,
      "first_name": "Max",
      "last_name": "Muster",
      "email": "max@example.org",
      "joined_at": "2020-01-01",
      "membership_status_name": "Active",
      "department_names": ["Darts"]
    }
  ]
}
```

```bash
comvenio member import --file import.json --json
```

Create a team (`team.json`):

```json
{
  "department_id": "<department-id>",
  "name": "Darts 1",
  "sport_type": "OTHER",
  "gender": "MIXED",
  "season": "2026/27",
  "required_resource_count": 2,
  "buffer_before_minutes": 30,
  "buffer_after_minutes": 15
}
```

```bash
comvenio team create --file team.json --json
comvenio team list --json
comvenio team show <team-id> --json
```

Partially update a team:

```json
{
  "name": "Darts First Team",
  "home_location": "Clubhouse",
  "required_resource_count": 3
}
```

```bash
comvenio team update <team-id> --file team-update.json --json
```

Manage the squad:

```bash
comvenio team member list <team-id> --json
comvenio team member add <team-id> --member-id <member-id> --role PLAYER --json
comvenio team member update <team-id> --member-id <member-id> --role CAPTAIN --json
comvenio team member remove <team-id> --member-id <member-id> --json
```

Create a resource priority:

```bash
comvenio team resource list <team-id> --json
comvenio team resource add <team-id> --object-id <object-id> --priority 1 \
  --booking-duration-minutes 120 --notes "Tuesday training" --json
```

Create a seasonal team and season:

```bash
comvenio teams list --department-id <department-id> --include-descendants --json
comvenio teams create --name "Darts 1" --department-id <department-id> --sport-type OTHER --yes --json
comvenio teams season create <team-id> --name "2026/27" --yes --json
comvenio teams season activate <season-id> --yes --json
```

Carry over a season roster:

```bash
comvenio teams roster carry-over <season-id> --source <previous-season-id> --preview --json
comvenio teams roster carry-over <season-id> --source <previous-season-id> --members <member-id-a>,<member-id-b> --yes --json
```

Activate an iCal source:

```bash
comvenio teams ical create <season-id> --url "https://federation.example/calendar.ics" --yes --json
comvenio teams ical preview <subscription-id> --json
comvenio teams ical activate <subscription-id> --preview-token <token> --yes --json
comvenio teams sync now <subscription-id> --yes --json
```

Resolve a clarification case (`resolution.json`):

```json
{
  "type": "AMBIGUOUS_HOME_ROLE",
  "action": "CONFIRM_HOME",
  "trigger_resource_reconcile": true
}
```

```bash
comvenio teams sync resolve <clarification-id> --file resolution.json --yes --json
```

Create a team appointment:

```bash
comvenio teams termin create <season-id> --kind training --start 2026-10-06T19:00 \
  --repeat di,do --until 2026-12-18 --yes --json

comvenio teams termin create <season-id> --kind spiel --start 2026-10-11T15:00 \
  --opponent "SV Nachbarort" --home --yes --json

comvenio teams termin cancel <season-id> <event-id> --reason "Court closed" --scope this --yes --json
```

## Commands and actions

<!-- gen:docs befehle -->

**member** — complete

- `comvenio member list`
- `comvenio member show`
- `comvenio member add`
- `comvenio member update`
- `comvenio member remove`
- `comvenio member import`
- `comvenio member family-list`
- `comvenio member family-show`
- `comvenio member family-add`
- `comvenio member family-update`
- `comvenio member family-delete`
- `comvenio member status-list`
- `comvenio member status-show`
- `comvenio member status-add`
- `comvenio member status-update`
- `comvenio member status-delete`
- `comvenio member period-list`
- `comvenio member period-show`
- `comvenio member period-add`
- `comvenio member period-update`
- `comvenio member period-delete`
- Fields and values: `comvenio schema member --json`

**team** — complete

- `comvenio team list`
- `comvenio team show`
- `comvenio team create`
- `comvenio team update`
- `comvenio team delete`
- `comvenio team member list|add|update|remove`
- `comvenio team resource list|add|update|remove`
- Fields and values: `comvenio schema team --json`
<!-- /gen:docs -->

## Errors

- `PERMISSION_DENIED` — the club role does not allow creating, updating or deleting members,
  families, teams or squad entries, even though the sign-in carries the required scopes. See
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — a field in the submitted file is missing, not allowed or has the wrong
  format, for example when creating a member, family or team. See
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — the given member, family, team, season or roster ID does not belong to a visible
  entry in the connected club. See `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — a member is already assigned to the same team, or a team change contradicts the
  current season state. See `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — the sign-in was granted without the scope required for a write action. See
  `comvenio help fehler SCOPE_REQUIRED`.
