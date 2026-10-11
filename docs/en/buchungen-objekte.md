---
id: buchungen-objekte
kategorie: thema
domaenen: [booking, object]
stichwoerter: [bookings, objects, buildings, rooms, reservations, booking-rules, statistics]
---

# Buildings, objects and bookings

## Purpose

Through the actions of the `object` domain, a club manages its buildings, rooms and bookable objects
along with booking and task rules. Through the actions of the `booking` domain it creates reservations
for those objects, approves or rejects them, links related bookings, and evaluates utilization and
guest fees.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by
`comvenio action list --json`.

- Read access to buildings, rooms, objects and bookings requires club membership.
- Changing buildings, rooms, objects, booking rules or task rules requires `manage_objects` in the
  matching club or department scope.
- Approving or rejecting bookings requires `confirm_object_bookings`; a booking may not be
  self-approved by its owner through this permission.
- Updating, canceling or deleting a booking is allowed for the person who made it, or for an admin
  with `confirm_object_bookings`.
- Backdated bookings and bookings made on behalf of another member also require
  `confirm_object_bookings`.
- Guest-fee statistics require `confirm_object_bookings` or `manage_objects`.
- `--json` returns the response unchanged; instead of `--input '<json>'`, larger inputs can also be
  passed with `--file <path>` (UTF-8 JSON).

Every sub-action of a multi-part action is selected with `"operation": "<name>"` in `--input`. A
critical (`critical_write`) sub-action first returns a preview with a `preview_id` and
`confirmation_token`; only `comvenio action confirm --preview-id … --confirmation-token=…
--idempotency-key …` executes it.

## Workflows

### Understanding the hierarchy

A building contains rooms, a room contains objects, an object carries booking rules, task rules and
bookings, and a booking in turn can have participants and links to other bookings. An object
optionally belongs to a room but has no direct building.

### Managing buildings

1. List buildings or view a single one — not critical.
2. Create or update a building with a department, name, description and address — not critical.
3. Delete a building — critical, requires `force: true`.

```bash
comvenio action call cai.object.06.building_list_show_create_update_delete \
  --input '{"operation":"create","building":{"department_id":"<department-id>","name":"Clubhouse","description":"Main location","address":"Musterweg 1, 12345 Musterstadt"}}' --json

comvenio action call cai.object.06.building_list_show_create_update_delete \
  --input '{"operation":"list","with_rooms":true}' --json

comvenio action call cai.object.06.building_list_show_create_update_delete \
  --input '{"operation":"delete","building_id":"<building-id>","force":true}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json
```

### Managing rooms

1. List rooms or view a single one — not critical.
2. Create or update a room with a building, name, capacity and bookability — not critical.
3. Delete a room — critical, requires `force: true`.

```bash
comvenio action call cai.object.07.room_list_show_create_update_delete \
  --input '{"operation":"create","room":{"building_id":"<building-id>","name":"Darts room","capacity":24,"booking":true}}' --json

comvenio action call cai.object.07.room_list_show_create_update_delete \
  --input '{"operation":"delete","room_id":"<room-id>","force":true}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json
```

### Managing bookable objects

1. List objects — optionally filtered by type (`static`, `portable`, `event`) — or view a single one —
   not critical.
2. Create or update an object with a department, optional room, name, description, type, booking
   granularity, duration limits, approval requirement and maximum number of participants — not
   critical.
3. Delete an object — critical, requires `force: true`.

```bash
comvenio action call cai.object.01.list --input '{"type":"static","limit":20,"offset":0}' --json
comvenio action call cai.object.02.show --input '{"object_id":"<object-id>"}' --json

comvenio action call cai.object.03.create \
  --input '{"department_id":"<department-id>","room_id":"<room-id>","is_default":false,"object":{"name":"Dartboard 1","description":"Board at lane 1","type":"static","booking_granularity":"30min","min_duration_minutes":30,"max_duration_minutes":180,"approval_required":false,"max_participants":8}}' --json

comvenio action call cai.object.05.delete --input '{"object_id":"<object-id>","force":true}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json
```

Booking granularity: `15min`, `30min`, `hourly`, `timedate` (free by date/time). For the three
time-slot-based variants, stating minimum and maximum duration makes sense; for the free variant they
stay empty. `force: true` also deletes an object's dependent entries (rules, bookings).

### Maintaining booking and task rules

1. List an object's booking rules, view a single one — not critical; create it individually or in
   bulk — not critical; update it — not critical; delete it — critical.
2. List an object's task rules, view, create, update — not critical; delete — critical.

```bash
comvenio action call cai.object.08.booking_rule_list_show_create_bulk_update_delete \
  --input '{"operation":"create","rule":{"object_id":"<object-id>","weekday":"tuesday","start_time":"18:00","end_time":"22:00"}}' --json

comvenio action call cai.object.08.booking_rule_list_show_create_bulk_update_delete \
  --input '{"operation":"delete","rule_id":"<rule-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json

comvenio action call cai.object.09.task_rule_list_show_create_update_delete \
  --input '{"operation":"create","rule":{"object_id":"<object-id>","title":"Check board","description":"Check tips and lighting","priority":"medium","due_offset_days":0}}' --json
```

A booking rule sets the object, weekday, start and end time, and an optional seasonal validity (from
month/day, until month/day). A task rule sets the object, title, description, priority and a due-date
offset in days after the booking ends — not a recurrence interval, but a one-off due date per booking.

### Managing bookings

1. List the club's bookings (`list`, with a period `from`/`to`/`timezone`) or bookings for a specific
   object (`list_object`); view a single booking (`show`) — not critical.
2. Create a booking with an object, title, start and end time, timezone and status — critical.
3. Update, approve, reject, cancel or delete a booking — each critical.

```bash
comvenio action call cai.booking.01.list \
  --input '{"operation":"list","from":"2026-07-01T00:00:00+02:00","to":"2026-07-31T23:59:59+02:00","timezone":"Europe/Berlin","limit":20,"offset":0}' --json

comvenio action call cai.booking.02.show --input '{"reservation_id":"<reservation-id>","timezone":"Europe/Berlin"}' --json

comvenio action call cai.booking.03.create \
  --input '{"object_id":"<object-id>","title":"Darts training","start_time":"2026-07-21T18:00:00+02:00","end_time":"2026-07-21T20:00:00+02:00","timezone":"Europe/Berlin","status":"requested","comment":"League preparation"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json

comvenio action call cai.booking.05.approve --input '{"reservation_id":"<reservation-id>","object_id":"<object-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json

comvenio action call cai.booking.07.cancel \
  --input '{"reservation_id":"<reservation-id>","object_id":"<object-id>","reason":"Court closed"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json
```

For an admin booking on behalf of another member, `resp_member_id` is supplied explicitly; like
backdated bookings, this requires the matching permission.

### Creating several bookings in bulk

Several related bookings — for example a main booking together with portable objects — can be created
in a single bulk run — critical.

```bash
comvenio action call cai.booking.09.bulk \
  --input '{"object_id":"<main-object-id>","title":"Darts training","start_time":"2026-07-21T18:00:00+02:00","end_time":"2026-07-21T20:00:00+02:00","timezone":"Europe/Berlin","status":"requested","group_ids":["<group-id>"],"portable_reservations":[{"object_id":"<portable-object-id>","start_time":"2026-07-21T17:45:00+02:00","end_time":"2026-07-21T20:15:00+02:00","title":"Mobile board"}]}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json
```

### A booking's participants

1. List a booking's participants or view a single one — not critical.
2. Add a participant with a member identifier, or as a guest with a name and email address — not
   critical; alternatively add several member groups at once — critical.
3. Update a participant's status (invited, accepted, rejected, cancelled) — not critical; remove a
   participant — critical.

```bash
comvenio action call cai.booking.10.participant_list_show_add_add_groups_update_remove \
  --input '{"operation":"add","reservation_id":"<reservation-id>","participant":{"member_id":"<member-id>"}}' --json

comvenio action call cai.booking.10.participant_list_show_add_add_groups_update_remove \
  --input '{"operation":"add","reservation_id":"<reservation-id>","participant":{"is_guest":true,"guest_name":"Max Muster","guest_email":"max@example.org"}}' --json

comvenio action call cai.booking.10.participant_list_show_add_add_groups_update_remove \
  --input '{"operation":"update","participant_id":"<participant-id>","status":"accepted"}' --json
```

### Linking bookings

1. List a booking's links or view all links for the club — not critical.
2. Link a main booking with another booking — not critical.
3. Remove a link — critical.

```bash
comvenio action call cai.booking.11.link_list_club_add_remove \
  --input '{"operation":"add","primary_reservation_id":"<main-booking-id>","linked_reservation_id":"<linked-booking-id>"}' --json

comvenio action call cai.booking.11.link_list_club_add_remove \
  --input '{"operation":"list","reservation_id":"<reservation-id>"}' --json
```

If the main booking is canceled, Comvenio can automatically cancel linked portable bookings as well.

### Evaluating statistics

1. Retrieve object statistics for a year or a month — not critical.
2. Retrieve guest statistics over a period — aggregated guest fees per responsible member — not
   critical.

```bash
comvenio action call cai.booking.12.stats_object_guests \
  --input '{"operation":"object","object_id":"<object-id>","year":2026,"month":7}' --json
comvenio action call cai.booking.12.stats_object_guests \
  --input '{"operation":"guests","from_date":"2026-01-01T00:00:00+02:00","to_date":"2026-12-31T23:59:59+01:00","limit":50}' --json
```

### Not yet available as an action

Internal system-to-system routes with their own authentication contract, an anonymous public excerpt
of individual highlighted objects, and technical bulk lookups and file exports are deliberately not
part of these actions. Tags for objects are a separate sub-area not covered here.

## Examples

Create a building and a room:

```bash
comvenio action call cai.object.06.building_list_show_create_update_delete \
  --input '{"operation":"create","building":{"department_id":"<department-id>","name":"Clubhouse","description":"Main location","address":"Musterweg 1, 12345 Musterstadt"}}' --json
comvenio action call cai.object.07.room_list_show_create_update_delete \
  --input '{"operation":"create","room":{"building_id":"<building-id>","name":"Darts room","capacity":24,"booking":true}}' --json
```

Create an object and delete it with a forced cascade:

```bash
comvenio action call cai.object.03.create \
  --input '{"department_id":"<department-id>","room_id":"<room-id>","is_default":false,"object":{"name":"Dartboard 1","description":"Board at lane 1","type":"static","booking_granularity":"30min","min_duration_minutes":30,"max_duration_minutes":180,"approval_required":false,"max_participants":8}}' --json
comvenio action call cai.object.05.delete --input '{"object_id":"<object-id>","force":true}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json
```

Create a booking rule:

```bash
comvenio action call cai.object.08.booking_rule_list_show_create_bulk_update_delete \
  --input '{"operation":"create","rule":{"object_id":"<object-id>","weekday":"tuesday","start_time":"18:00","end_time":"22:00"}}' --json
```

Create, approve and cancel a booking:

```bash
comvenio action call cai.booking.03.create \
  --input '{"object_id":"<object-id>","title":"Darts training","start_time":"2026-07-21T18:00:00+02:00","end_time":"2026-07-21T20:00:00+02:00","timezone":"Europe/Berlin","status":"requested","comment":"League preparation"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json

comvenio action call cai.booking.05.approve --input '{"reservation_id":"<reservation-id>","object_id":"<object-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json
```

Bulk booking with a portable object:

```bash
comvenio action call cai.booking.09.bulk \
  --input '{"object_id":"<main-object-id>","title":"Darts training","start_time":"2026-07-21T18:00:00+02:00","end_time":"2026-07-21T20:00:00+02:00","timezone":"Europe/Berlin","status":"requested","group_ids":["<group-id>"],"portable_reservations":[{"object_id":"<portable-object-id>","start_time":"2026-07-21T17:45:00+02:00","end_time":"2026-07-21T20:15:00+02:00","title":"Mobile board"}]}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <key> --json
```

Retrieve statistics:

```bash
comvenio action call cai.booking.12.stats_object_guests \
  --input '{"operation":"object","object_id":"<object-id>","year":2026,"month":7}' --json
```

## Commands and actions

<!-- gen:docs befehle -->

**booking**

- `cai.booking.01.list` — list, list_object (read) · Scopes: `booking.read`
- `cai.booking.02.show` — show (read) · Scopes: `booking.read`
- `cai.booking.03.create` — create (change with confirmation) · Scopes: `booking.write`, `object.read`
- `cai.booking.04.update` — update (change with confirmation) · Scopes: `booking.write`, `object.read`
- `cai.booking.05.approve` — approve (change with confirmation) · Scopes: `booking.write`
- `cai.booking.06.reject` — reject (change with confirmation) · Scopes: `booking.write`
- `cai.booking.07.cancel` — cancel (change with confirmation) · Scopes: `booking.write`
- `cai.booking.08.delete` — delete (change with confirmation) · Scopes: `booking.write`
- `cai.booking.09.bulk` — create (change with confirmation) · Scopes: `booking.write`, `object.read`
- `cai.booking.10.participant_list_show_add_add_groups_update_remove` — list, show, add, add_groups, update, remove (read, change, change with confirmation) · Scopes: `booking.read`, `booking.write`
- `cai.booking.11.link_list_club_add_remove` — list, club, add, remove (read, change, change with confirmation) · Scopes: `booking.read`, `booking.write`
- `cai.booking.12.stats_object_guests` — object, guests (read) · Scopes: `booking.read`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"booking"}'` (the sign-in sets `club_id` — never in `--input`)

**object**

- `cai.object.01.list` — list (read) · Scopes: `object.read`
- `cai.object.02.show` — show (read) · Scopes: `object.read`
- `cai.object.03.create` — create (change) · Scopes: `object.write`
- `cai.object.04.update` — update (change) · Scopes: `object.write`
- `cai.object.05.delete` — delete (change with confirmation) · Scopes: `object.write`
- `cai.object.06.building_list_show_create_update_delete` — list, show, create, update, delete (read, change, change with confirmation) · Scopes: `object.read`, `object.write`
- `cai.object.07.room_list_show_create_update_delete` — list, show, create, update, delete (read, change, change with confirmation) · Scopes: `object.read`, `object.write`
- `cai.object.08.booking_rule_list_show_create_bulk_update_delete` — list, list_object, show, create, bulk, update, delete (read, change, change with confirmation) · Scopes: `object.read`, `object.write`
- `cai.object.09.task_rule_list_show_create_update_delete` — list, list_object, show, create, update, delete (read, change, change with confirmation) · Scopes: `object.read`, `object.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"object"}'` (the sign-in sets `club_id` — never in `--input`)
<!-- /gen:docs -->

## Errors

- `PERMISSION_DENIED` — `manage_objects` is missing for a change to a building, room, object or rule,
  or `confirm_object_bookings` is missing for approval, rejection or a backdated booking. See
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — a field is missing or does not fit, for example a missing `force: true` on a
  delete or an incomplete rule body. See `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — the given building, room, object, rule or booking ID does not belong to a visible
  entry in the connected club. See `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — an object with existing child entries is deleted without `force: true`, or a booking
  overlaps with an existing reservation. See `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — the sign-in was granted without the scope required for a write action. See
  `comvenio help fehler SCOPE_REQUIRED`.
- `OUTCOME_UNKNOWN` — a critical action (create, update, approve, delete) was not clearly confirmed
  after `action confirm`; check the current state with a read before retrying. See
  `comvenio help fehler OUTCOME_UNKNOWN`.
- `USAGE_ERROR` — a command the CLI no longer has; find the matching action with
  `comvenio action list`. See `comvenio help fehler USAGE_ERROR`.
