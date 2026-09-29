---
id: meetings
kategorie: thema
domaenen: [meeting]
stichwoerter: [meetings, protocols, agenda, resolutions, voting, participants, board-meeting]
---

# Meetings and protocols

## Purpose

The actions of the `meeting` domain cover the operational workflows around club meetings: creating
meeting series, keeping a protocol for a specific date, running the agenda, capturing notes and
participants, holding decisions and votes, managing resolutions, and finally publishing the official
record.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by
`comvenio action list --json`.

- Write actions (series, protocols, agenda, notes, participants, decisions, votes, resolutions,
  record) require the `manage_meetings` permission or the respective granular meeting permission.
- Only participants recorded as present are eligible to vote.
- `--json` is the binding output form for scripts and agents.
- Instead of `--input '<json>'`, larger inputs can also be passed with `--file <path>` (JSON).
- An error is not an empty result: the CLI returns a service error with a non-zero exit code.

Every sub-action of a multi-part action is selected with `"operation": "<name>"` in `--input`. A
critical (`critical_write`) sub-action first returns a preview with a `preview_id` and
`confirmation_token`; only `comvenio action confirm --preview-id … --confirmation-token …
--idempotency-key …` executes it.

## Workflows

### Creating a meeting series

1. Create a series with a department, title and default values for protocol type, approval
   requirement and protocol style (`create`, not critical).
2. List series or view a single one (`list`, `show`, not critical), update (`update`, not critical) or
   delete it (`delete`, critical).

```bash
comvenio action call cai.meeting.01.series_list_show_create_update_delete \
  --input '{"operation":"create","series":{"department_id":"<department-id>","title":"Monthly board meeting","description":"Regular board meeting","meeting_type":"Board meeting","default_protocol_type":"formal","default_requires_approval":true,"default_protocol_summary_style":"results"}}' --json

comvenio action call cai.meeting.01.series_list_show_create_update_delete \
  --input '{"operation":"list","limit":20,"offset":0}' --json
```

Allowed values for the protocol style: `results`, `detailed`, `decision`, `short`, `action`, `custom`.

### Creating a protocol for a date

1. Create a protocol for a specific event date with the meeting series, event, department and title
   (`create`, not critical).
2. List or view a protocol (`list`, `show`, not critical).

```bash
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"create","protocol":{"meeting_id":"<meeting-series-id>","event_id":"<event-id>","department_id":"<department-id>","title":"Board meeting July 2026","protocol_type":"formal","requires_approval":true,"allow_public_join":false}}' --json
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"show","protocol_id":"<protocol-id>"}' --json
```

A protocol's lifecycle runs: preparation open → preparation by administration → agenda finished → in
progress → finalized → protocol generation → pending approval → published. Comvenio sets the start
time when moving to "in progress" and the end time when moving to "finalized".

3. Advance a protocol to the next phase (`advance`, critical) or revert a phase (`revert`, critical).
4. Query changes since a point in time (`updates`, not critical).
5. Check the validation status before publishing (`validation`, not critical), then publish
   (`publish`, critical).

```bash
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"advance","protocol_id":"<protocol-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"validation","protocol_id":"<protocol-id>"}' --json
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"publish","protocol_id":"<protocol-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Important conditions: moving from "protocol generation" to "pending approval" requires a protocol
entry for every agenda item that was handled. Publishing requires all validators to have confirmed.
Reverting a phase is not allowed in every phase.

### Agenda and live status

For this action, every sub-action is critical — even listing and viewing first return a preview and
require confirmation.

1. Create an agenda item with a title, description and estimated duration.
2. List the agenda, view, update, delete or reorder an item.
3. Start, complete or skip an item; for a carried-over item, link it to the matching protocol with
   `protocol_id`, since an agenda item can belong to more than one protocol.
4. Approve an item (`approve`).

```bash
comvenio action call cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr \
  --input '{"operation":"create","protocol_id":"<protocol-id>","agenda_item":{"title":"Treasury report","description":"Second-quarter review","estimated_duration_minutes":20,"is_hidden":false}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr \
  --input '{"operation":"reorder","protocol_id":"<protocol-id>","agenda_item_ids":["<top-id-1>","<top-id-2>"]}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr \
  --input '{"operation":"start","protocol_id":"<protocol-id>","agenda_item_id":"<top-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

### Notes

1. List notes for an agenda item (`list`) or an entire protocol (`list_protocol`) — not critical.
2. Create a note with a protocol, agenda item, content and note type (`create`, not critical); update
   (`update`, not critical) or delete it (`delete`, critical).

```bash
comvenio action call cai.meeting.04.note_list_list_protocol_create_update_delete \
  --input '{"operation":"create","note":{"protocol_id":"<protocol-id>","agenda_item_id":"<top-id>","content":"Treasury report received","note_type":"summary"}}' --json
comvenio action call cai.meeting.04.note_list_list_protocol_create_update_delete \
  --input '{"operation":"list_protocol","protocol_id":"<protocol-id>"}' --json
```

Business note types: admin, discussion, note, summary. The "task update" type is only ever created
automatically by the task workflow and is not meant for manual notes.

### Participants and validation

1. List a protocol's participants (`list`, not critical).
2. Add a participant (`add`, not critical) — with a user, a member, or at least a name as identity.
3. Update a participant's role or presence (`update`, not critical) — nothing else on an existing
   participant can be changed this way; remove a participant (`remove`, critical).
4. Validate a participant (`validate`, not critical) or undo a validation (`unvalidate`, critical).

```bash
comvenio action call cai.meeting.05.participant_list_add_update_remove_validate_unvalidate \
  --input '{"operation":"add","protocol_id":"<protocol-id>","participant":{"member_id":"<member-id>","role":"member"}}' --json
comvenio action call cai.meeting.05.participant_list_add_update_remove_validate_unvalidate \
  --input '{"operation":"validate","participant_id":"<participant-id>"}' --json
```

### Decisions and voting

A decision is always created on an agenda item and may only be created for an item that is currently
being handled. Full decision data for an agenda item is returned by the `agenda` sub-action — there is
no separate list or detail view for individual decisions. Every sub-action except `agenda` is
critical.

1. Create a decision with an agenda item, title, decision type and start of validity (`create`).
2. Add voting options individually (`option_add`) or as a batch (`options_add`), if needed.
3. Open voting, cast votes — directly, in bulk, or by proxy —, close voting, view results (`results`,
   not critical) and eligible voters (`eligible`, not critical).
4. Update a decision (`update`), cancel it (`cancel`, requires `cancel_reason`), or promote it to a
   resolution with a resolution number (`promote`).

```bash
comvenio action call cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote \
  --input '{"operation":"create","agenda_item_id":"<top-id>","decision":{"title":"Approve 2027 budget","decision_type":"voting","voting_visibility":"public","valid_from":"2026-07-13T19:30:00+02:00","voting_eligibility":"all_participants","allow_proxy_voting":true,"is_offline_voting":false,"allow_multiple_choice":false}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.07.voting_open_close_results_eligible_tally \
  --input '{"operation":"open","decision_id":"<decision-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract \
  --input '{"operation":"cast","decision_id":"<decision-id>","vote":{"option_id":"<option-id>"}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.07.voting_open_close_results_eligible_tally \
  --input '{"operation":"close","decision_id":"<decision-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
comvenio action call cai.meeting.07.voting_open_close_results_eligible_tally \
  --input '{"operation":"results","decision_id":"<decision-id>"}' --json
```

Offline tallies run through `voting_tally`: without `increment`, `count` sets the absolute count; with
`increment: true`, a delta is added. With multiple choice enabled, retracting a single option
(`option_retract`) only removes your own vote for that option; a full retraction (`retract`) removes
all of your own votes for that decision.

### Resolutions

1. List a club's resolutions, optionally filtered by department, category, or including expired ones
   (`list`); list a protocol's resolutions (`list_protocol`) — not critical.
2. View a single resolution (`show`) and its history (`history`) — not critical.
3. Create, update, approve or decline, or delete a resolution — each critical.

```bash
comvenio action call cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli \
  --input '{"operation":"list","category":"bylaws","valid_only":true,"limit":20,"offset":0}' --json

comvenio action call cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli \
  --input '{"operation":"approve","resolution_id":"<resolution-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli \
  --input '{"operation":"decline","resolution_id":"<resolution-id>","reason":"Procedural defect in the draft resolution"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Resolution status: new, accepted, declined, expired. A decline requires a justification; for an
approval the justification is optional.

### Record and attachments

Protocol entries are the official record of a protocol in the "protocol generation" phase.

1. List entries for a protocol (`list`) or an agenda item (`show_agenda`), view a single entry
   (`show`) — not critical.
2. Create an entry with an agenda item and content (`create`, not critical), optionally flagged as
   AI-generated; update (`update`, not critical) or delete it (`delete`, critical).
3. List an entry's attachments (`list`, not critical), link an already uploaded file via its file
   identifier (`add`, critical), or remove an attachment (`remove`, critical).

```bash
comvenio action call cai.meeting.10.entry_list_show_show_agenda_create_update_delete \
  --input '{"operation":"create","agenda_item_id":"<top-id>","entry":{"protocol_id":"<protocol-id>","content":"Treasury report acknowledged unanimously.","is_ai_generated":false}}' --json

comvenio action call cai.meeting.11.attachment_list_add_remove \
  --input '{"operation":"add","entry_id":"<entry-id>","file_id":"<file-id>","title":"Treasury report Q2"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

The upload of the attachment file itself does not run through this action — it must already be
uploaded (see article "DataShare — files, folders and papers").

### Not yet available as an action

Internal system-to-system maintenance with its own authentication contract, browser- and
invitation-based access for participants (public and personal access links), and private AI-assistant
drafts with their own confirmation and permission context are deliberately not part of these actions —
they run in the web app.

## Examples

Create a meeting series:

```bash
comvenio action call cai.meeting.01.series_list_show_create_update_delete \
  --input '{"operation":"create","series":{"department_id":"<department-id>","title":"Monthly board meeting","description":"Regular board meeting","meeting_type":"Board meeting","default_protocol_type":"formal","default_requires_approval":true,"default_protocol_summary_style":"results"}}' --json
```

Create a protocol and publish it:

```bash
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"create","protocol":{"meeting_id":"<meeting-series-id>","event_id":"<event-id>","department_id":"<department-id>","title":"Board meeting July 2026","protocol_type":"formal","requires_approval":true,"allow_public_join":false}}' --json

comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"publish","protocol_id":"<protocol-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Create a decision and run a vote:

```bash
comvenio action call cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote \
  --input '{"operation":"create","agenda_item_id":"<top-id>","decision":{"title":"Approve 2027 budget","decision_type":"voting","voting_visibility":"public","valid_from":"2026-07-13T19:30:00+02:00","voting_eligibility":"all_participants","allow_proxy_voting":true,"is_offline_voting":false,"allow_multiple_choice":false}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.07.voting_open_close_results_eligible_tally \
  --input '{"operation":"open","decision_id":"<decision-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json

comvenio action call cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract \
  --input '{"operation":"cast","decision_id":"<decision-id>","vote":{"option_id":"<option-id>"}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

Decline a resolution:

```bash
comvenio action call cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli \
  --input '{"operation":"decline","resolution_id":"<resolution-id>","reason":"Procedural defect in the draft resolution"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <key> --json
```

## Commands and actions

<!-- gen:docs befehle -->

**meeting**

- `cai.meeting.01.series_list_show_create_update_delete` — list, show, create, update, delete (read, change, change with confirmation) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat` — list, show, create, update, delete, advance, revert, updates, validation, publish (read, change, change with confirmation) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr` — list, show, create, update, delete, reorder, start, complete, skip, approve (read, change with confirmation) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.04.note_list_list_protocol_create_update_delete` — list, list_protocol, create, update, delete (read, change, change with confirmation) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.05.participant_list_add_update_remove_validate_unvalidate` — list, add, update, remove, validate, unvalidate (read, change, change with confirmation) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote` — create, agenda, update, cancel, option_add, options_add, promote (change with confirmation, read) · Scopes: `meeting.write`, `meeting.read`
- `cai.meeting.07.voting_open_close_results_eligible_tally` — open, close, results, eligible, tally (change with confirmation, read) · Scopes: `meeting.write`, `meeting.read`
- `cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract` — cast, cast_bulk, proxy, proxy_bulk, option_retract, retract (change with confirmation) · Scopes: `meeting.write`
- `cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli` — list, list_protocol, show, history, create, update, approve, decline, delete (read, change with confirmation) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.10.entry_list_show_show_agenda_create_update_delete` — list, show, show_agenda, create, update, delete (read, change, change with confirmation) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.11.attachment_list_add_remove` — list, add, remove (read, change with confirmation) · Scopes: `meeting.read`, `meeting.write`, `files.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"meeting"}'` (the sign-in sets `club_id` — never in `--input`)
<!-- /gen:docs -->

## Errors

- `PERMISSION_DENIED` — the club role does not carry `manage_meetings` or the matching granular
  meeting permission for the attempted action. See `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — a required field is missing or has the wrong format, for example when
  creating a series, a protocol, a decision or a resolution. See
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — the given series, protocol, agenda, decision or resolution ID does not belong to a
  visible entry. See `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — an action contradicts the current state, for example a phase transition whose
  preconditions are not yet met, or a vote that is already closed. See
  `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — the sign-in was granted without the scope required for a meeting write action.
  See `comvenio help fehler SCOPE_REQUIRED`.
- `OUTCOME_UNKNOWN` — a critical action (delete, phase transition, vote, resolution) was not clearly
  confirmed after `action confirm`; check the current state with a read before retrying. See
  `comvenio help fehler OUTCOME_UNKNOWN`.
- `USAGE_ERROR` — a command the CLI no longer has; find the matching action with
  `comvenio action list`. See `comvenio help fehler USAGE_ERROR`.
