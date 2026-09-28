---
id: buchungen-objekte
kategorie: thema
domaenen: [booking, object]
stichwoerter: [bookings, objects, buildings, rooms, reservations, booking-rules, statistics]
---

# Buildings, objects and bookings

## Purpose

With `comvenio object` a club manages its buildings, rooms and bookable objects along with booking
and maintenance rules. With `comvenio booking` it creates reservations for those objects, approves or
rejects them, links related bookings, and evaluates utilization and guest fees.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

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
- `--file` expects UTF-8 JSON, `--json` returns the response unchanged.

## Workflows

### Understanding the hierarchy

A building contains rooms, a room contains objects, an object carries booking rules, task rules and
bookings, and a booking in turn can have participants and links to other bookings. An object
optionally belongs to a room but has no direct building. A room with bookability enabled
automatically creates a default object of type "event" when created.

### Managing buildings

1. List buildings (optionally with rooms) or view a single one.
2. Create a building with a department, name, description and address.
3. Update or remove a building.

| Purpose | Command |
|---|---|
| List | `comvenio object building list [--with-rooms]` |
| Detail | `comvenio object building show <id> [--with-rooms]` |
| Create | `comvenio object building create --file building.json` |
| Update | `comvenio object building update <id> --file patch.json` |
| Remove | `comvenio object building delete <id> [--force]` |

### Managing rooms

1. List rooms or view a single one.
2. Create a room with a building, name, capacity and bookability.
3. Update or remove a room.

| Purpose | Command |
|---|---|
| List | `comvenio object room list` |
| Detail | `comvenio object room show <id>` |
| Create | `comvenio object room create --file room.json` |
| Update | `comvenio object room update <id> --file patch.json` |
| Remove | `comvenio object room delete <id> [--force]` |

### Managing bookable objects

1. List objects — optionally filtered by type (static, portable, event) — or view a single one with
   all details.
2. Create an object with a department, optional room, name, description, type, booking granularity,
   duration limits, approval requirement and maximum number of participants.
3. Update or remove an object.

Booking granularity: 15 minutes, 30 minutes, hourly, free by date/time. For the three time-slot-based
variants, minimum and maximum duration are required; for the free variant both are discarded
automatically.

Deleting with a forced cascade also removes dependent entries (rules, bookings); without that
confirmation, Comvenio rejects the deletion when dependents exist.

| Purpose | Command |
|---|---|
| List | `comvenio object list [--type static\|portable\|event] [--with-all]` |
| Detail | `comvenio object show <id> [--with-all]` |
| Create | `comvenio object create --file object.json` |
| Update | `comvenio object update <id> --file patch.json` |
| Remove | `comvenio object delete <id> [--force]` |

### Maintaining booking and task rules

1. List a object's booking rules, view a single one, create it individually or in bulk, update or
   delete it.
2. List an object's task rules, view, create, update or delete them.

```powershell
comvenio object booking-rule list [--object-id <id>]
comvenio object booking-rule show <rule-id>
comvenio object booking-rule create --file rule.json
comvenio object booking-rule bulk --file rules.json
comvenio object booking-rule update <rule-id> --file rule.json
comvenio object booking-rule delete <rule-id>

comvenio object task-rule list [--object-id <id>]
comvenio object task-rule show <rule-id>
comvenio object task-rule create --file task-rule.json
comvenio object task-rule update <rule-id> --file task-rule.json
comvenio object task-rule delete <rule-id>
```

A booking rule sets the object, weekday, start and end time, and an optional seasonal validity (from
month/day, until month/day). For a bulk run, the CLI fills in the club per entry; for an update, the
start time, end time and all seasonal fields must all be supplied — unused seasonal fields stay empty.

A task rule sets the object, title, description, priority and a due-date offset in days after the
booking ends — not a recurrence interval, but a one-off due date per booking.

### Managing bookings

1. List the club's bookings — optionally only pending ones or filtered by status — or list bookings
   for a specific object; view a single booking.
2. Create a booking with an object, title, start and end time, and an optional comment; the club is
   filled in automatically.
3. Approve, reject or cancel a booking; for this the CLI first reads the current booking so that the
   required club and object details are sent along in full.
4. Update a booking — title, comment, times or status; the object assignment deliberately stays
   unchanged.
5. Soft-delete a booking.
6. Create several related bookings — for example a main booking together with portable objects — in
   a single bulk run.

| Purpose | Command |
|---|---|
| Club list | `comvenio booking list [--pending\|--status <v>]` |
| Object list | `comvenio booking list --object-id <id>` |
| Detail | `comvenio booking show <id>` |
| Create | `comvenio booking create --file booking.json` |
| Update | `comvenio booking update <id> --file patch.json` |
| Approve | `comvenio booking approve <id>` |
| Reject | `comvenio booking reject <id>` |
| Cancel | `comvenio booking cancel <id>` |
| Soft-delete | `comvenio booking delete <id>` |
| Bulk booking | `comvenio booking bulk --file bulk.json` |

For an admin booking on behalf of another member, the responsible member is supplied explicitly; like
backdated bookings, this requires the matching permission.

### A booking's participants

1. List a booking's participants or view a single one.
2. Add a participant with a member identifier, or as a guest with a name and email address;
   alternatively add several member groups at once.
3. Update a participant's status (invited, accepted, rejected) or remove a participant.

```powershell
comvenio booking participant list <reservation-id>
comvenio booking participant show <participant-id>
comvenio booking participant add <reservation-id> --member-id <id>
comvenio booking participant add <reservation-id> --guest --guest-name "Max Muster" --guest-email "max@example.org"
comvenio booking participant add-groups <reservation-id> --file groups.json
comvenio booking participant update <participant-id> --status accepted
comvenio booking participant remove <participant-id>
```

### Linking bookings

1. List a booking's links or view all links for the club.
2. Link a main booking with another booking.
3. Remove a link.

```powershell
comvenio booking link list <reservation-id>
comvenio booking link club
comvenio booking link add --file link.json
comvenio booking link remove <link-id>
```

If the main booking is canceled, Comvenio can automatically cancel linked portable bookings as well.

### Evaluating statistics

1. Retrieve object statistics for a year or a month — total count, year-over-year comparison, monthly
   values and participant figures.
2. Retrieve guest statistics over a period — aggregated guest fees per responsible member.

### Deliberate scope

Not part of this area are internal system-to-system routes with their own authentication contract, an
anonymous public excerpt of individual highlighted objects, and technical bulk lookups and file
exports — these are not regular administrative actions. Tags for objects are a separate sub-area not
covered here.

The machine-readable contract for bookings is available via `comvenio schema booking --json`; for
objects that becomes usable once the domain is enabled in the central schema index.

## Examples

Create a building (`building.json`):

```json
{
  "department_id": "<department-id>",
  "name": "Clubhouse",
  "description": "Main location",
  "address": "Musterweg 1, 12345 Musterstadt"
}
```

```bash
comvenio object building create --file building.json --json
comvenio object building list --with-rooms --json
```

Create a room (`room.json`):

```json
{
  "building_id": "<building-id>",
  "name": "Darts room",
  "capacity": 24,
  "booking": true
}
```

```bash
comvenio object room create --file room.json --json
```

Create an object (`object.json`):

```json
{
  "department_id": "<department-id>",
  "room_id": "<room-id>",
  "name": "Dartboard 1",
  "description": "Board at lane 1",
  "type": "static",
  "booking_granularity": "30min",
  "min_duration_minutes": 30,
  "max_duration_minutes": 180,
  "approval_required": false,
  "max_participants": 8
}
```

```bash
comvenio object create --file object.json --json
comvenio object list --type static --with-all --json
comvenio object delete <object-id> --force --json
```

Create a booking rule (`rule.json`):

```json
{
  "object_id": "<object-id>",
  "weekday": "tuesday",
  "start_time": "18:00",
  "end_time": "22:00",
  "valid_from_month": null,
  "valid_from_day": null,
  "valid_until_month": null,
  "valid_until_day": null
}
```

```bash
comvenio object booking-rule create --file rule.json --json
comvenio object booking-rule bulk --file rules.json --json
```

Create a task rule (`task-rule.json`):

```json
{
  "object_id": "<object-id>",
  "title": "Check board",
  "description": "Check tips and lighting",
  "priority": "medium",
  "due_offset_days": 0
}
```

```bash
comvenio object task-rule create --file task-rule.json --json
```

Create a booking (`booking.json`):

```json
{
  "object_id": "<object-id>",
  "title": "Darts training",
  "start_time": "2026-07-21T18:00:00+02:00",
  "end_time": "2026-07-21T20:00:00+02:00",
  "comment": "League preparation",
  "status": "requested"
}
```

```bash
comvenio booking create --file booking.json --json
comvenio booking list --pending --json
comvenio booking approve <booking-id> --json
comvenio booking cancel <booking-id> --json
```

Bulk booking with a portable object (`bulk.json`):

```json
{
  "object_id": "<main-object-id>",
  "start_time": "2026-07-21T18:00:00+02:00",
  "end_time": "2026-07-21T20:00:00+02:00",
  "title": "Darts training",
  "group_ids": ["<group-id>"],
  "portable_reservations": [
    {
      "object_id": "<portable-object-id>",
      "start_time": "2026-07-21T17:45:00+02:00",
      "end_time": "2026-07-21T20:15:00+02:00",
      "title": "Mobile board"
    }
  ]
}
```

```bash
comvenio booking bulk --file bulk.json --json
```

Manage participants:

```bash
comvenio booking participant add <reservation-id> --member-id <member-id> --json
comvenio booking participant add <reservation-id> --guest --guest-name "Max Muster" --guest-email "max@example.org" --json
comvenio booking participant update <participant-id> --status accepted --json
```

Link bookings (`link.json`):

```json
{
  "primary_reservation_id": "<main-booking-id>",
  "linked_reservation_id": "<linked-booking-id>"
}
```

```bash
comvenio booking link add --file link.json --json
comvenio booking link list <reservation-id> --json
```

Retrieve statistics:

```bash
comvenio booking stats object <object-id> --year 2026 --month 7 --json
comvenio booking stats guests --from 2026-01-01 --to 2026-12-31 --json
```

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**booking** — complete

- `comvenio booking list`
- `comvenio booking show`
- `comvenio booking create`
- `comvenio booking update`
- `comvenio booking approve`
- `comvenio booking reject`
- `comvenio booking cancel`
- `comvenio booking delete`
- `comvenio booking bulk`
- `comvenio booking participant list|show|add|add-groups|update|remove`
- `comvenio booking link list|club|add|remove`
- `comvenio booking stats object|guests`
- Fields and values: `comvenio schema booking --json`

**object** — complete

- `comvenio object list`
- `comvenio object show`
- `comvenio object create`
- `comvenio object update`
- `comvenio object delete`
- `comvenio object building list|show|create|update|delete`
- `comvenio object room list|show|create|update|delete`
- `comvenio object booking-rule list|show|create|bulk|update|delete`
- `comvenio object task-rule list|show|create|update|delete`
- Fields and values: `comvenio schema object --json`
<!-- /gen:docs -->

## Errors

- `PERMISSION_DENIED` — `manage_objects` is missing for a change to a building, room, object or rule,
  or `confirm_object_bookings` is missing for approval, rejection or a backdated booking. See
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — a field is missing or does not fit, for example a missing duration limit on a
  time-slot-based object or an incomplete rule body. See `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — the given building, room, object, rule or booking ID does not belong to a visible
  entry in the connected club. See `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — an object with existing child entries is deleted without a forced cascade, or a
  booking overlaps with an existing reservation. See `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — the sign-in was granted without the scope required for a write action. See
  `comvenio help fehler SCOPE_REQUIRED`.
