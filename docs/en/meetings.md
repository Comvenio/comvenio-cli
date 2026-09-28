---
id: meetings
kategorie: thema
domaenen: [meeting]
stichwoerter: [meetings, protocols, agenda, resolutions, voting, participants, board-meeting]
---

# Meetings and protocols

## Purpose

`comvenio meeting` covers the operational workflows around club meetings: creating meeting series,
keeping a protocol for a specific date, running the agenda, capturing notes and participants, holding
decisions and votes, managing resolutions, and finally publishing the official record.

## Requirements and permissions

- Write actions (series, protocols, agenda, notes, participants, decisions, votes, resolutions,
  record) require the `manage_meetings` permission or the respective granular meeting permission.
- Only participants recorded as present are eligible to vote.
- `--club <club-id>` overrides the club from the local sign-in state.
- `--json` is the binding output form for scripts and agents.
- Larger inputs are passed as a JSON file with `--file <payload.json>`; the fields are forwarded
  unchanged to the respective action's contract.

## Workflows

### Creating a meeting series

1. Create a series with club, department, title and default values for protocol type, approval
   requirement and protocol style.
2. List series or view a single one, update or delete it as needed.

### Creating a protocol for a date

1. Create a protocol for a specific event date with the meeting series, event, club, department and
   title.
2. List or view a protocol.

A protocol's lifecycle runs: preparation open → preparation by administration → agenda finished → in
progress → finalized → protocol generation → pending approval → published. Comvenio sets the start
time when moving to "in progress" and the end time when moving to "finalized".

3. Advance a protocol to the next phase or revert a phase.
4. Query changes since a point in time.
5. Check the validation status before publishing, then publish.

Important conditions: moving from "protocol generation" to "pending approval" requires a protocol
entry for every agenda item that was handled. Publishing requires all validators to have confirmed.
Reverting a phase is not allowed in every phase.

### Agenda and live status

1. Create an agenda item with a title, description and estimated duration.
2. List the agenda, view, update, delete or reorder an item.
3. Start, complete or skip an item; for a carried-over item, link it to the matching protocol, since
   an agenda item can belong to more than one protocol.
4. Approve an item.

### Notes

1. List notes for an agenda item or an entire protocol.
2. Create a note with a protocol, agenda item, club, content and note type.
3. Update or delete a note.

Business note types: admin, discussion, note, summary. The "task update" type is only ever created
automatically by the task workflow and is not meant for manual notes.

### Participants and validation

1. List a protocol's participants.
2. Add a participant — with a user, a member, or at least a name as identity.
3. Update a participant's role or presence; remove a participant.
4. Validate a participant or undo a validation.

### Decisions and voting

A decision is always created on an agenda item and may only be created for an item that is currently
being handled.

1. Create a decision with a protocol, agenda item, department, club, title, decision type and start of
   validity.
2. Add voting options individually or as a batch, if needed.
3. Open voting, cast votes — directly, in bulk, or by proxy —, close voting, view results and
   eligible voters.
4. Update or cancel a decision, or promote it to a resolution with a resolution number.

Offline tallies run through a dedicated action: without an increment, the value sets the absolute
count; with an increment, a delta is added, including negative values. With multiple choice enabled,
retracting a single option only removes your own vote for that option; a full retraction removes all
of your own votes for that decision.

### Resolutions

1. List a club's resolutions, optionally filtered by department, category, or including expired ones;
   list a protocol's resolutions.
2. View a single resolution and its history.
3. Create, update, approve or decline, or delete a resolution.

Resolution status: new, accepted, declined, expired. A decline requires a justification; for an
approval the justification is optional.

### Record and attachments

Protocol entries are the official record of a protocol in the "protocol generation" phase.

1. List entries for a protocol or an agenda item, view a single entry.
2. Create an entry with a protocol and content, optionally flagged as AI-generated.
3. Update or delete an entry.
4. List an entry's attachments, link an already uploaded file, or remove an attachment.

An attachment links an already uploaded file via its file identifier; the upload itself does not run
through these actions.

### Deliberately excluded workflows

The following areas are deliberately not part of these club-admin workflows: internal
system-to-system maintenance with its own authentication contract, browser- and invitation-based
access for participants (public and personal access links), private AI-assistant drafts with their
own confirmation and permission context, and automatically generated task-update notes.

## Examples

Create a meeting series (`meeting-series.json`):

```json
{
  "club_id": "<club-id>",
  "department_id": "<department-id>",
  "title": "Monthly board meeting",
  "description": "Regular board meeting",
  "meeting_type": "Board meeting",
  "default_protocol_type": "formal",
  "default_requires_approval": true,
  "default_protocol_summary_style": "results"
}
```

```bash
comvenio meeting series-create --file meeting-series.json --json
comvenio meeting series-list --json
```

Allowed values for the protocol style: `results`, `detailed`, `decision`, `short`, `action`, `custom`.

Create a protocol for a date:

```json
{
  "meeting_id": "<meeting-series-id>",
  "event_id": "<event-id>",
  "club_id": "<club-id>",
  "department_id": "<department-id>",
  "title": "Board meeting July 2026",
  "protocol_type": "formal",
  "requires_approval": true,
  "allow_public_join": false
}
```

```bash
comvenio meeting protocol-create --file protocol.json --json
comvenio meeting protocol-show <protocol-id> --json
comvenio meeting protocol-advance <protocol-id> --json
comvenio meeting protocol-validation <protocol-id> --json
comvenio meeting protocol-publish <protocol-id> --json
```

Create and control an agenda item:

```json
{
  "title": "Treasury report",
  "description": "Second-quarter review",
  "estimated_duration_minutes": 20,
  "is_hidden": false
}
```

```bash
comvenio meeting agenda-create <protocol-id> --file top.json --json
```

```json
{
  "item_positions": {
    "<top-id-1>": 0,
    "<top-id-2>": 1
  }
}
```

```bash
comvenio meeting agenda-reorder <protocol-id> --file order.json --json
comvenio meeting agenda-start <top-id> --protocol <protocol-id> --json
comvenio meeting agenda-complete <top-id> --protocol <protocol-id> --json
```

`--protocol` matters for a carried-over agenda item, since it can belong to more than one protocol.

Create a note:

```bash
comvenio meeting note-create --file note.json --json
comvenio meeting note-list <top-id> --json
```

Add and validate a participant:

```bash
comvenio meeting participant-add <protocol-id> --file participant.json --json
comvenio meeting participant-validate <participant-id> --json
```

Create a decision and run a vote:

```json
{
  "agenda_item_id": "<top-id>",
  "protocol_id": "<protocol-id>",
  "department_id": "<department-id>",
  "club_id": "<club-id>",
  "title": "Approve 2027 budget",
  "decision_type": "voting",
  "voting_visibility": "public",
  "valid_from": "2026-07-13T19:30:00+02:00",
  "voting_eligibility": "all_participants",
  "allow_proxy_voting": true,
  "is_offline_voting": false,
  "allow_multiple_choice": false
}
```

```bash
comvenio meeting decision-create <top-id> --file decision.json --json
comvenio meeting voting-open <decision-id> --json
comvenio meeting vote-cast <decision-id> --file vote.json --json
comvenio meeting voting-close <decision-id> --json
comvenio meeting voting-results <decision-id> --json
comvenio meeting voting-tally <decision-id> --option <option-id> --count -1 --increment --json
comvenio meeting decision-promote <decision-id> --number 12 --json
```

Approve or decline a resolution:

```bash
comvenio meeting resolution-list --department <department-id> --category bylaws --json
comvenio meeting resolution-approve <resolution-id> --json
comvenio meeting resolution-decline <resolution-id> --file decline.json --json
```

Create a protocol entry with an attachment:

```bash
comvenio meeting entry-create <top-id> --file entry.json --json
comvenio meeting attachment-add <entry-id> --file attachment.json --json
```

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**meeting** — complete

- `comvenio meeting series list|show|create|update|delete`
- `comvenio meeting protocol list|show|create|update|delete|advance|revert|updates|validation|publish`
- `comvenio meeting agenda list|show|create|update|delete|reorder|start|complete|skip|approve`
- `comvenio meeting note list|list-protocol|create|update|delete`
- `comvenio meeting participant list|add|update|remove|validate|unvalidate`
- `comvenio meeting decision create|agenda|update|cancel|option-add|options-add|promote`
- `comvenio meeting voting open|close|results|eligible|tally`
- `comvenio meeting vote cast|cast-bulk|proxy|proxy-bulk|option-retract|retract`
- `comvenio meeting resolution list|list-protocol|show|history|create|update|approve|decline|delete`
- `comvenio meeting entry list|show|show-agenda|create|update|delete`
- `comvenio meeting attachment list|add|remove`
- Fields and values: `comvenio schema meeting --json`
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
