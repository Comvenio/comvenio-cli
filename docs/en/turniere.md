---
id: turniere
kategorie: thema
domaenen: [tournament]
stichwoerter: [tournaments, draw, schedule, results, standings, competition]
---

# Tournaments

## Purpose

`comvenio tournament` manages tournaments through tournament series and their concrete executions:
register participants, run the draw, generate a schedule, record results and view the standings. A
match pairs participants — a team, an individual, or a doubles pair — not necessarily a fixed Comvenio
team.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

- Creating, updating or deleting tournaments, and editing participants, the draw, the schedule or
  results, is a club administration task and requires a sign-in with the matching write permissions.
- Public registration and spectator viewing run through the web interface, not through this CLI.
- `--json` returns the machine-readable output for scripts and agents.
- Larger inputs are passed as a JSON file with `--file <path>`.

## Workflows

### Creating a tournament series

1. Create a series with a title, sport, format family, template, participation mode, eligible scope
   and rules configuration.
2. List series, view a single one, update or delete it.

The club is filled in automatically by the CLI.

### Creating an execution from a series

A tournament is always created as a concrete execution of a series — there is deliberately no second,
series-less way to create a tournament.

1. Create an execution from a series with a title, tournament mode, start and end time, registration
   deadline, and minimum and maximum number of participants.
2. Optionally link the execution to an event, or remove that link again.

### Controlling a tournament

1. List tournaments, view a single one, update or delete it.
2. Set the status: draft, registration, draw, scheduled, active, completed, cancelled, archived.
3. Start or reset a tournament, or generate a local preview.

### Managing participants

1. List a tournament's participants.
2. Register a team, individual or pair; the registration status defaults to confirmed and can be
   overridden when registering. Registering a team is its own command with the participant kind fixed
   to team.
3. Withdraw a participant — annulling, ahead of a redraw, or scored in the opponent's favor — or
   reinstate one.
4. Fully remove a participant (a stronger, soft deletion).

Without an explicit withdrawal mode, the current tournament state decides the approach.

### Running the draw

1. Create a draw with a strategy, speed, public visibility, fixed assignments, a return-leg option,
   automatic separation of participants from the same club, and knockout configuration (qualified
   participants per group, third-place match, full placement matches, placement mode); this first
   creates a draw session.
2. Confirm the draw — this materializes the matches. A confirmation is additive.
3. For a completely new draw, use the combined workflow: it resets, deletes all existing matches,
   creates a new draw session and confirms it in one step.

Withdrawn participants are not drawn again in any of the three variants.

### Generating a schedule and scheduling individual matches

1. List a tournament's matches.
2. Generate a schedule automatically — with match and break duration, number of fields/lanes and the
   first kickoff time; first as a dry run, then committed. Automatic object bookings can be turned
   off.
3. Schedule an individual match specifically — with start and end time, location, status and match
   number.
4. As needed, delete individual matches, clear all matches for a phase (group stage, finals, or all),
   or reset the whole tournament.

### Recording results

1. Record a football-style or goal-based result with home and away goals.
2. Record a tennis-style or set-based result with a set sequence, including tiebreak and
   match-tiebreak notation.
3. Record a special outcome — walkover, no-show, retirement with a partial score, or a no-contest for
   both sides. Only one special outcome is allowed per call; walkover, no-show and retirement
   additionally require stating the winner.

### Setting a result deadline

1. Set a deadline for a phase with a specific time, or set the policy — manual or automatic
   no-contest.
2. View the current configuration and overdue open matches.

### Standings and preview

1. Retrieve the current standings.
2. Generate a local preview and optionally open it directly — it is created as a standalone HTML file
   and does not change the tournament.

### Scope

Public registration and spectator viewing belong to the web interface, not to this CLI area.

## Examples

Create a tournament series (`series.json`):

```json
{
  "title": "Club darts championship",
  "description": "Annual club tournament",
  "sport_key": "darts",
  "format_family": "group_knockout",
  "template_key": "darts_group_knockout",
  "participation_mode": "internal",
  "eligible_scope": "club",
  "eligible_department_ids": [],
  "rules_config": {},
  "default_phase_pipeline": [],
  "is_public": true
}
```

```bash
comvenio tournament series-create --file series.json --json
comvenio tournament series-list --json
comvenio tournament series-show <series-id> --json
comvenio tournament series-update <series-id> --file series-update.json --json
comvenio tournament series-delete <series-id> --json
```

Create an execution from a series (`execution.json`):

```json
{
  "title": "Club darts championship 2026",
  "tournament_mode": "group_knockout",
  "start_date": "2026-09-05T10:00:00+02:00",
  "end_date": "2026-09-05T20:00:00+02:00",
  "registration_deadline": "2026-08-31T23:59:59+02:00",
  "min_teams": 4,
  "max_teams": 32,
  "team_size": 1
}
```

```bash
comvenio tournament execution-create <series-id> --file execution.json --json
comvenio tournament execution-link <tournament-id> --event <event-id> --json
```

Control a tournament:

```bash
comvenio tournament list --json
comvenio tournament show <tournament-id> --json
comvenio tournament update <tournament-id> --file tournament-update.json --json
comvenio tournament delete <tournament-id> --json
comvenio tournament status <tournament-id> --status registration --json
```

Register participants:

```bash
comvenio tournament participants <tournament-id> --json
comvenio tournament mannschaft <tournament-id> --name "SV Motzing AH" --seed 1 --json
comvenio tournament participant <tournament-id> --name "Max Muster" --kind individual --json
comvenio tournament participant <tournament-id> --name "Pair A" --kind pair --json
```

Withdraw a participant:

```bash
comvenio tournament participant-withdraw <tournament-id> --participant <participant-id> --mode cancel --json
comvenio tournament participant-withdraw <tournament-id> --participant <participant-id> --mode walkover --json
comvenio tournament participant-reinstate <tournament-id> --participant <participant-id> --json
comvenio tournament participant-remove <tournament-id> --participant <participant-id> --json
```

Run the draw (`draw.json`):

```json
{
  "strategy": "manual",
  "speed": "normal",
  "public_show_enabled": false,
  "fixed_assignments": [
    { "participant_id": "<id-1>", "group_key": "A" },
    { "participant_id": "<id-2>", "group_key": "B" }
  ],
  "double_round": false,
  "auto_separate_same_club": true,
  "knockout_config": {
    "qualified_per_group": 2,
    "third_place_match": true,
    "play_all_placements": false,
    "placement_mode": "direct"
  }
}
```

```bash
comvenio tournament draw <tournament-id> --file draw.json --json
comvenio tournament draw-confirm <tournament-id> --json
comvenio tournament redraw <tournament-id> --file draw.json --json
```

Generate a schedule:

```bash
comvenio tournament matches <tournament-id> --json
comvenio tournament schedule-generate <tournament-id> \
  --match-minutes 15 --break-minutes 3 --field-count 2 \
  --first-kickoff 2026-09-05T10:00:00+02:00 --dry-run --json

comvenio tournament schedule-generate <tournament-id> \
  --match-minutes 15 --break-minutes 3 --field-count 2 \
  --first-kickoff 2026-09-05T10:00:00+02:00 --json
```

Schedule an individual match and clean up:

```bash
comvenio tournament match-schedule <match-id> \
  --start 2026-09-05T10:00:00+02:00 \
  --end 2026-09-05T10:15:00+02:00 \
  --location "Board 1" --status proposed --match-number 1 --json

comvenio tournament match-delete <match-id> --json
comvenio tournament matches-clear <tournament-id> --phase group --json
comvenio tournament reset <tournament-id> --json
```

Record results:

```bash
comvenio tournament match-result <match-id> --home 3 --away 1 --json
comvenio tournament match-result <match-id> --sets "6:2,7:6(9:7)" --json
comvenio tournament match-result <match-id> --walkover --winner home --json
comvenio tournament match-result <match-id> --retired --winner away --sets "6:3,2:1" --json
```

Set a deadline:

```bash
comvenio tournament deadline <tournament-id> --phase group --at 2026-09-05T18:00:00+02:00 --json
comvenio tournament deadline <tournament-id> --policy auto_no_contest --json
comvenio tournament deadline <tournament-id> --show --json
```

Standings and preview:

```bash
comvenio tournament standings <tournament-id> --json
comvenio tournament preview <tournament-id> --open
```

## Commands and actions

<!-- gen:docs befehle -->

**tournament** — complete

- `comvenio tournament series-list`
- `comvenio tournament series-show`
- `comvenio tournament series-create`
- `comvenio tournament series-update`
- `comvenio tournament series-delete`
- `comvenio tournament execution-create`
- `comvenio tournament execution-link`
- `comvenio tournament list`
- `comvenio tournament show`
- `comvenio tournament update`
- `comvenio tournament delete`
- `comvenio tournament status`
- `comvenio tournament participants`
- `comvenio tournament mannschaft`
- `comvenio tournament participant`
- `comvenio tournament participant-withdraw`
- `comvenio tournament participant-reinstate`
- `comvenio tournament participant-remove`
- `comvenio tournament start`
- `comvenio tournament matches`
- `comvenio tournament matches-clear`
- `comvenio tournament reset`
- `comvenio tournament redraw`
- `comvenio tournament standings`
- `comvenio tournament preview`
- `comvenio tournament draw`
- `comvenio tournament draw-confirm`
- `comvenio tournament schedule-generate`
- `comvenio tournament match-schedule`
- `comvenio tournament match-delete`
- `comvenio tournament match-result`
- `comvenio tournament deadline`
<!-- /gen:docs -->

## Errors

- `PERMISSION_DENIED` — the sign-in does not carry the write permissions needed to edit a tournament,
  its participants, draw, schedule or results. See `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — a field is missing or does not fit, for example an incomplete series, a
  result submitted without the required winner, or more than one special outcome in a single call.
  See `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — the given series, tournament, participant or match ID does not belong to a visible
  entry. See `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — an action contradicts the current tournament state, for example a result for a match
  that is already completed, or a draw without a prior reset while a schedule already exists. See
  `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — the sign-in was granted without the scope required for a tournament write action.
  See `comvenio help fehler SCOPE_REQUIRED`.
