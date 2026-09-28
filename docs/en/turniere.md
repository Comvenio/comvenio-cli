---
id: turniere
kategorie: thema
domaenen: [tournament]
stichwoerter: [tournaments, draw, schedule, results, standings, competition]
---

# Tournaments

## Purpose

The actions of the `tournament` domain manage tournaments through tournament series and their
concrete executions: register participants, run the draw, generate a schedule, record results and
view the standings. A match pairs participants — a team, an individual, or a doubles pair — not
necessarily a fixed Comvenio team.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by
`comvenio action list --json`.

- Creating, updating or deleting tournaments, and editing participants, the draw, the schedule or
  results, is a club administration task and requires a sign-in with the matching write scopes.
- Public registration and spectator viewing run through the web interface, not through this CLI.
- `--json` returns the machine-readable output for scripts and agents; instead of `--input '<json>'`,
  larger inputs can also be passed with `--file <path>`.

A critical (`critical_write`) action first returns a preview with a `preview_id` and
`confirmation_token`; only `comvenio action confirm --preview-id … --confirmation-token …
--idempotency-key …` executes it.

## Workflows

### Creating a tournament series

1. Create a series with a title, sport, format family, template, participation mode, eligible scope
   and rules configuration — not critical.
2. List series, view a single one — not critical; update it — not critical; delete it — critical.

```bash
comvenio action call cai.tournament.03.series_create \
  --input '{"series":{"title":"Club darts championship","description":"Annual club tournament","sport_key":"darts","format_family":"group_knockout","template_key":"darts_group_knockout","participation_mode":"internal","eligible_scope":"club","eligible_department_ids":[],"rules_config":{},"default_phase_pipeline":[],"is_public":true}}' --json

comvenio action call cai.tournament.01.series_list --input '{"limit":20,"offset":0}' --json
comvenio action call cai.tournament.02.series_show --input '{"series_id":"<series-id>"}' --json
comvenio action call cai.tournament.04.series_update \
  --input '{"series_id":"<series-id>","changes":{"is_public":false}}' --json

comvenio action call cai.tournament.05.series_delete --input '{"series_id":"<series-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

### Creating an execution from a series

A tournament is always created as a concrete execution of a series — there is deliberately no second,
series-less way to create a tournament.

1. Create an execution from a series with a title, tournament mode, start and end time, registration
   deadline, and minimum and maximum number of participants — not critical.
2. Optionally link the execution to an event, or remove that link again (`event_id` set to `null`) —
   not critical.

```bash
comvenio action call cai.tournament.06.execution_create \
  --input '{"series_id":"<series-id>","execution":{"title":"Club darts championship 2026","tournament_mode":"group_knockout","start_date":"2026-09-05T10:00:00+02:00","end_date":"2026-09-05T20:00:00+02:00","registration_deadline":"2026-08-31T23:59:59+02:00","min_teams":4,"max_teams":32,"team_size":1}}' --json

comvenio action call cai.tournament.07.execution_link \
  --input '{"tournament_id":"<tournament-id>","event_id":"<event-id>"}' --json
```

### Controlling a tournament

1. List tournaments, view a single one — not critical.
2. Update it — not critical; delete it — critical.
3. Set the status (draft, registration, draw, scheduled, active, completed, cancelled, archived) —
   critical.
4. Start or reset a tournament — critical.

```bash
comvenio action call cai.tournament.08.list --input '{"limit":20,"offset":0}' --json
comvenio action call cai.tournament.09.show \
  --input '{"tournament_id":"<tournament-id>","timezone":"Europe/Berlin"}' --json
comvenio action call cai.tournament.10.update \
  --input '{"tournament_id":"<tournament-id>","changes":{"title":"Club darts championship 2026 — final day"}}' --json

comvenio action call cai.tournament.12.status \
  --input '{"tournament_id":"<tournament-id>","status":"registration"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.tournament.19.start --input '{"tournament_id":"<tournament-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

### Managing participants

1. List a tournament's participants — not critical.
2. Register a team (`cai.tournament.14.mannschaft`, participant kind fixed to `team`) or an
   individual/pair (`cai.tournament.15.participant`) — not critical; the registration status defaults
   to `confirmed` and can be overridden when registering.
3. Withdraw a participant (`mode: cancel` — annulling, ahead of a redraw — or `mode: walkover` —
   scored in the opponent's favor) — critical — or reinstate one — not critical.
4. Fully remove a participant (a stronger, soft deletion) — critical.

```bash
comvenio action call cai.tournament.13.participants --input '{"tournament_id":"<tournament-id>","limit":100}' --json

comvenio action call cai.tournament.14.mannschaft \
  --input '{"tournament_id":"<tournament-id>","name":"SV Motzing AH","participant_kind":"team","registration_status":"confirmed","seed":1}' --json
comvenio action call cai.tournament.15.participant \
  --input '{"tournament_id":"<tournament-id>","name":"Max Muster","participant_kind":"individual","registration_status":"confirmed"}' --json

comvenio action call cai.tournament.16.participant_withdraw \
  --input '{"tournament_id":"<tournament-id>","participant_id":"<participant-id>","mode":"walkover"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.tournament.17.participant_reinstate \
  --input '{"tournament_id":"<tournament-id>","participant_id":"<participant-id>"}' --json
comvenio action call cai.tournament.18.participant_remove \
  --input '{"tournament_id":"<tournament-id>","participant_id":"<participant-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Without an explicit withdrawal mode, the current tournament state decides the approach.

### Running the draw

1. Create a draw with a strategy, fixed assignments and knockout configuration — not critical; this
   first creates a draw session.
2. Confirm the draw — critical, materializes the matches. A confirmation is additive.
3. For a completely new draw: `redraw` — critical, resets, deletes all existing matches, creates a new
   draw session and confirms it in one step.

```bash
comvenio action call cai.tournament.26.draw \
  --input '{"tournament_id":"<tournament-id>","draw_plan":{"strategy":"manual","fixed_assignments":[{"participant_id":"<id-1>","group_key":"A"},{"participant_id":"<id-2>","group_key":"B"}],"knockout_config":{"qualified_per_group":2,"third_place_match":true,"play_all_placements":false,"placement_mode":"direct"}}}' --json

comvenio action call cai.tournament.27.draw_confirm --input '{"tournament_id":"<tournament-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.tournament.23.redraw \
  --input '{"tournament_id":"<tournament-id>","draw_plan":{"strategy":"manual"}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Withdrawn participants are not drawn again in any of the three variants.

### Generating a schedule and scheduling individual matches

1. List a tournament's matches.
2. Generate a schedule automatically — with match and break duration, number of fields/lanes and the
   first kickoff time; first with `dry_run: true`, then committed — critical. Automatic object
   bookings can be turned off with `auto_book: false`.
3. Schedule an individual match specifically — with start and end time, location, status and match
   number — not critical.
4. As needed, delete individual matches (critical), clear all matches for a phase (critical), or reset
   the whole tournament (critical).

```bash
comvenio action call cai.tournament.20.matches \
  --input '{"tournament_id":"<tournament-id>","timezone":"Europe/Berlin","limit":100}' --json

comvenio action call cai.tournament.28.schedule_generate \
  --input '{"tournament_id":"<tournament-id>","match_minutes":15,"break_minutes":3,"field_count":2,"first_kickoff":"2026-09-05T10:00:00+02:00","dry_run":true}' --json

comvenio action call cai.tournament.28.schedule_generate \
  --input '{"tournament_id":"<tournament-id>","match_minutes":15,"break_minutes":3,"field_count":2,"first_kickoff":"2026-09-05T10:00:00+02:00","dry_run":false}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.tournament.29.match_schedule \
  --input '{"match_id":"<match-id>","starts_at":"2026-09-05T10:00:00+02:00","ends_at":"2026-09-05T10:15:00+02:00","location":"Board 1","match_number":1,"schedule_status":"proposed"}' --json

comvenio action call cai.tournament.30.match_delete --input '{"match_id":"<match-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
comvenio action call cai.tournament.21.matches_clear \
  --input '{"tournament_id":"<tournament-id>","phase":"group"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

### Recording results

`match_result` is not critical (results can be corrected in draft before the schedule is finally
confirmed).

1. Record a football-style or goal-based result with home and away goals.
2. Record a tennis-style or set-based result through `score` with a set sequence, including tiebreak
   and match-tiebreak notation.
3. Record a special outcome — walkover (`walkover`), no-show (`no_show`), retirement (`retired`) with
   a partial score, or a no-contest for both sides (`no_contest`). Only one special outcome is allowed
   per call; walkover, no-show and retirement additionally require `winner_side_id`.

```bash
comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"played","score_home":3,"score_away":1}' --json

comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"walkover","winner_side_id":"home"}' --json

comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"retired","winner_side_id":"away","score":{"sets":"6:3,2:1"}}' --json
```

### Setting a result deadline

1. View the current configuration (`show`, not critical).
2. Set a deadline for a phase with a specific time (`set_deadline`, not critical), or set the policy —
   manual or automatic no-contest (`set_policy`, not critical).

```bash
comvenio action call cai.tournament.32.deadline \
  --input '{"operation":"show","tournament_id":"<tournament-id>","phase":"group"}' --json
comvenio action call cai.tournament.32.deadline \
  --input '{"operation":"set_deadline","tournament_id":"<tournament-id>","phase":"group","deadline_at":"2026-09-05T18:00:00+02:00"}' --json
comvenio action call cai.tournament.32.deadline \
  --input '{"operation":"set_policy","tournament_id":"<tournament-id>","policy":"auto_no_contest"}' --json
```

### Standings and preview

1. Retrieve the current standings — not critical.
2. Generate a local preview as HTML — critical; it does not change the tournament but counts as an
   export.

```bash
comvenio action call cai.tournament.24.standings --input '{"tournament_id":"<tournament-id>"}' --json

comvenio action call cai.tournament.25.preview \
  --input '{"tournament_id":"<tournament-id>","output_format":"html"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

### Not yet available as an action / scope

Public registration and spectator viewing belong to the web interface, not to this actions area.

## Examples

Create a tournament series and an execution:

```bash
comvenio action call cai.tournament.03.series_create \
  --input '{"series":{"title":"Club darts championship","description":"Annual club tournament","sport_key":"darts","format_family":"group_knockout","template_key":"darts_group_knockout","participation_mode":"internal","eligible_scope":"club","eligible_department_ids":[],"rules_config":{},"default_phase_pipeline":[],"is_public":true}}' --json

comvenio action call cai.tournament.06.execution_create \
  --input '{"series_id":"<series-id>","execution":{"title":"Club darts championship 2026","tournament_mode":"group_knockout","start_date":"2026-09-05T10:00:00+02:00","end_date":"2026-09-05T20:00:00+02:00","registration_deadline":"2026-08-31T23:59:59+02:00","min_teams":4,"max_teams":32,"team_size":1}}' --json
```

Register and withdraw a participant:

```bash
comvenio action call cai.tournament.14.mannschaft \
  --input '{"tournament_id":"<tournament-id>","name":"SV Motzing AH","participant_kind":"team","registration_status":"confirmed","seed":1}' --json

comvenio action call cai.tournament.16.participant_withdraw \
  --input '{"tournament_id":"<tournament-id>","participant_id":"<participant-id>","mode":"walkover"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Run and confirm the draw:

```bash
comvenio action call cai.tournament.26.draw \
  --input '{"tournament_id":"<tournament-id>","draw_plan":{"strategy":"manual","fixed_assignments":[{"participant_id":"<id-1>","group_key":"A"},{"participant_id":"<id-2>","group_key":"B"}],"knockout_config":{"qualified_per_group":2,"third_place_match":true,"play_all_placements":false,"placement_mode":"direct"}}}' --json
comvenio action call cai.tournament.27.draw_confirm --input '{"tournament_id":"<tournament-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Generate a schedule (dry run, then committed):

```bash
comvenio action call cai.tournament.28.schedule_generate \
  --input '{"tournament_id":"<tournament-id>","match_minutes":15,"break_minutes":3,"field_count":2,"first_kickoff":"2026-09-05T10:00:00+02:00","dry_run":true}' --json
comvenio action call cai.tournament.28.schedule_generate \
  --input '{"tournament_id":"<tournament-id>","match_minutes":15,"break_minutes":3,"field_count":2,"first_kickoff":"2026-09-05T10:00:00+02:00","dry_run":false}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Record results:

```bash
comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"played","score_home":3,"score_away":1}' --json
comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"walkover","winner_side_id":"home"}' --json
```

Set a deadline and retrieve the standings:

```bash
comvenio action call cai.tournament.32.deadline \
  --input '{"operation":"set_deadline","tournament_id":"<tournament-id>","phase":"group","deadline_at":"2026-09-05T18:00:00+02:00"}' --json
comvenio action call cai.tournament.24.standings --input '{"tournament_id":"<tournament-id>"}' --json
```

## Commands and actions

<!-- gen:docs befehle -->

**tournament**

- `cai.tournament.01.series_list` — list (read)
- `cai.tournament.02.series_show` — show (read)
- `cai.tournament.03.series_create` — create (change)
- `cai.tournament.04.series_update` — update (change)
- `cai.tournament.05.series_delete` — delete (change with confirmation)
- `cai.tournament.06.execution_create` — create (change)
- `cai.tournament.07.execution_link` — link (change)
- `cai.tournament.08.list` — list (read)
- `cai.tournament.09.show` — show (read)
- `cai.tournament.10.update` — update (change)
- `cai.tournament.11.delete` — delete (change with confirmation)
- `cai.tournament.12.status` — set (change with confirmation)
- `cai.tournament.13.participants` — list (read)
- `cai.tournament.14.mannschaft` — create (change)
- `cai.tournament.15.participant` — create (change)
- `cai.tournament.16.participant_withdraw` — withdraw (change with confirmation)
- `cai.tournament.17.participant_reinstate` — reinstate (change)
- `cai.tournament.18.participant_remove` — remove (change with confirmation)
- `cai.tournament.19.start` — start (change with confirmation)
- `cai.tournament.20.matches` — list (change)
- `cai.tournament.21.matches_clear` — clear (change with confirmation)
- `cai.tournament.22.reset` — reset (change with confirmation)
- `cai.tournament.23.redraw` — redraw (change with confirmation)
- `cai.tournament.24.standings` — show (read)
- `cai.tournament.25.preview` — export (change with confirmation)
- `cai.tournament.26.draw` — create (change)
- `cai.tournament.27.draw_confirm` — confirm (change with confirmation)
- `cai.tournament.28.schedule_generate` — generate (change with confirmation)
- `cai.tournament.29.match_schedule` — set (change)
- `cai.tournament.30.match_delete` — delete (change with confirmation)
- `cai.tournament.31.match_result` — set (change)
- `cai.tournament.32.deadline` — show, set_deadline, set_policy (read, change)
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
- `OUTCOME_UNKNOWN` — a critical action (set status, start, reset, delete, confirm draw, commit
  schedule) was not clearly confirmed after `action confirm`; check the current state with a read
  before retrying. See `comvenio help fehler OUTCOME_UNKNOWN`.
- `OAUTH_ONLY` — an old, classic command (`comvenio tournament …`) no longer works; use the matching
  action instead. See `comvenio help fehler OAUTH_ONLY`.
