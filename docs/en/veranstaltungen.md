---
id: veranstaltungen
kategorie: thema
domaenen: [event, plan]
stichwoerter: [event, template, series, recurring-event, area, program, invitation, registration, sponsor, festival-day]
---

# Events

## Purpose

With the `event` commands you manage your club's events end to end: from templates through recurring dates and multi-day festivals to areas, program, invitations, registrations, sponsors and design.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Before working with events, run `comvenio schema event --json` and `comvenio event --help` to see fields and subcommands. Sign in with `comvenio login`; without `--scopes` it requests all scopes, `--scopes` narrows it down. What you can actually do also depends on your role in the club — permissions are checked server-side only.

| Operation | Permission or rule |
|---|---|
| Read visible events | Visibility filter; some catalog and series functions additionally need `view_events` |
| Create event, template or series | `create_events` |
| Manage event and sub-resources (areas, program, contacts, resources, sponsors, design, DJ) | `manage_events` |
| Edit or delete your own area note | only the person who created it |
| Respond to your own invitation | ownership and visibility rule |

A `403` means the permission is missing. A `404` can intentionally appear instead of `403` for data you cannot see.

### Safety rules for agents

- Never call the Comvenio API directly — use only the `event` commands. A missing command must be added to the CLI.
- Before `delete`, `clear`, `set` with an empty list, and `dj reset`, ask for explicit confirmation unless the deletion was already clearly requested.
- Never use a foreign club ID in JSON files — `club_id` comes from the login context for unambiguous contracts.
- For multi-day festivals, create program items on the child event; the parent only shows the aggregate.
- Never delete the automatically created default area.
- Use `resource set` only when the complete target set is known; `resource add` is additive.
- Upload files with `data upload` first, then link them with `event attachment add`.
- Show names instead of identifiers as soon as names are available in the responses.

## Workflows

### Terms

| Term | Meaning |
|---|---|
| Event | A concrete date. |
| Template | An event with `is_template=true` that does not count as a concrete date. |
| Recurring date | `RECURRING` + `AUTO`, for example a weekly training session. |
| Yearly event | `YEARLY_TEMPLATE` + `MANUAL`; the next concrete date is deliberately planned. |
| Standing event | Umbrella term for recurring dates and yearly events. |
| Parent event | A multi-day overall festival (`event_complexity=multi_day`); it must be public. |
| Child event | One concrete festival day under a parent event. |
| Default area | An automatically created general area of an event; must not be deleted. |
| EventArea | A real work area such as stage, bar or kitchen. |
| Attachment | The business-level link of an existing file, news or menu record to an event. |

Key values: `event_type` (`party`, `meeting`, `excursion`, `training`, `competition`, `other`) ·
`visibility_scope` (`public`, `member`, `private`, `department`, `invite_only`) ·
`status` (`draft`, `planned`, `confirmed`, `archived`, `cancelled` — there is no `published` status) ·
`organizer_type` (`member`, `external`) · `event_complexity` (`simple`, `multi_day`) ·
`invitation_status` (`invited`, `accepted`, `rejected`, `waitlist`) ·
`club_invitation_status` (`pending`, `accepted`, `declined`, `cancelled`) ·
`resource_target` (`object`, `room`, `building`).

### Materialize a template, series and dates

1. Create a template: `comvenio event template create --title "Darttraining" --event-type training --visibility-scope member --organizer-type member --department-id <department-id> --description "Wöchentliches Training" --json`.
2. Define a series from the template: `comvenio event series create <template-id> --start-time <iso> --frequency weekly --weekdays WE --duration-minutes 120 --json`.
3. Materialize a concrete time range: `comvenio event series materialize <series-id> --start <iso> --end <iso> --json`. `materialize` is idempotent and skips existing dates.
4. For "open end" use `--open-end` instead of `--duration-minutes` — this explicitly sends `duration_minutes=null`, and the generated dates get `end_time=null`. The series' own time range is limited independently with `--until <iso>`. Without either duration flag, the previous default duration remains.

### Create and publish a single event

1. Create an event: `comvenio event create --file event.json --json` (flags work as well; values from the file complement the flags).
2. Read or list events: `comvenio event show <event-id>`, `comvenio event list [--month|--start|--end|--complexity]`.
3. Update an event: `comvenio event update <event-id> --file patch.json --json`.
4. Publish an event: `comvenio event publish <event-id> [--public]` — sets `status=confirmed`; with `--public` it also sets `visibility_scope=public`.
5. Delete an event: `comvenio event delete <event-id>`.

### Multi-day festivals with festival days

1. Create the parent event with `event_complexity=multi_day`; it must be public.
2. Manage festival days: `comvenio event child list|create|invitation-summary <parent-id>`.
3. Create program items on the respective child event — the parent only shows the aggregate.
4. Copy areas between festival days: `comvenio event area copy --file area-copy.json --json`.

### Set up, staff and document areas

1. Create an area: `comvenio event area add <event-id> --name "Bühne" --description "Programm und Technik" --color "#7c3aed" --area-category stage --public --json`, or several in one call with `comvenio event area bulk --file areas.json --json`.
2. Assign members: `comvenio event assignment add <area-id> --member-id <member-id> --json`; remove with `comvenio event assignment remove <area-id> --member-id <member-id> --json`, clear with `clear`; the event and club IDs are resolved automatically via the area.
3. Create an area lead: `comvenio event lead add <area-id> --file lead.json --json`.
4. Add a note: `comvenio event area-note add <area-id> --notes "Stromanschluss geprüft" --json`.

### Maintain program and contacts

1. Create a program item: `comvenio event program add <event-id> --area <area-id> --title "Eröffnung" --start-time <iso> --end-time <iso> --sort-order 10 --json`.
2. Change the order: `comvenio event program reorder <event-id> --file reorder.json --json`.
3. Create a contact: `comvenio event contact add <event-id> --file contact.json --json`.

### Link files, resources and tags

1. Upload a file: `comvenio data upload ./flyer.pdf --context event --context-id <event-id> --json`.
2. Link the file at the business level: `comvenio event attachment add <event-id> --attachment-type flyer --attachment-id <file-id> --title "Festflyer" --json`. Attachment types: `content`, `counter`, `protocol`, `tournament`, `title_picture`, `flyer`, `news`, `menu`, `shoppinglist`, `canva_embed`.
3. Link a resource: `comvenio event resource add <event-id> --file resources.json --json` (adds) or `comvenio event resource set <event-id> --file resources.json --json` (replaces the whole set); remove with `comvenio event resource remove <event-id> --target-type room --target-id <room-id> --json`. Check utilization: `comvenio event resource usage --target-type room --target-id <room-id> --start <iso> --end <iso> --status planned,confirmed --json`.
4. Create a tag category and tag, then assign: `comvenio event tag category-add --name "Sportart" --json`, `comvenio event tag add --name "Darts" --category-id <category-id> --json`, `comvenio event tag assign <event-id> --tag-id <tag-id> --json`; view assigned tags: `comvenio event tag assigned <event-id> --json`.

### Invite members and clubs, capture registrations

1. Invite a member: `comvenio event invitation add <event-id> --user-id <user-id> --json`; set the status: `comvenio event invitation status <invitation-id> --status accepted --json`.
2. Invite in bulk: `comvenio event invitation groups --file groups.json --json` (for departments the list is `departments`/`department_ids`, for organizational groups `org-groups`/`org_group_ids`).
3. Invite a Comvenio club: `comvenio event club-invitation add --file club-invitation.json --json`; invite an external club by e-mail: `comvenio event club-invitation external --file external-invitation.json --json`.
4. Capture a manual registration: `comvenio event registration add <event-id> --file registration.json --json`; statistics: `comvenio event registration stats <event-id> --json`; admin correction: `comvenio event registration adjust <registration-id> --file adjustment.json --json`.

### Maintain sponsors, design, copy, DJ and external match schedule

1. Create sponsor master data via `comvenio sponsor` first, then link it to the event: `comvenio event sponsor add <event-id> --advertiser-id <advertiser-id> --area <area-id> --tier gold --sort-order 10 --json`.
2. Link a sponsor to a program item: `comvenio event sponsor-program add <sponsor-link-id> --program-item-id <program-item-id> --label "präsentiert von" --json`.
3. Set the event theme and upload assets: `comvenio event design theme-set <event-id> --file theme.json --json`, `comvenio event design asset-upload <event-id> --file ./flyer.png --asset-type FLYER --json`; remove an asset: `comvenio event design asset-delete <event-id> --asset-id <asset-id> --json`.
4. Merge public-hub copy per key: `comvenio event copy set <event-id> --file copy.json --json`; reset a single key: `comvenio event copy reset <event-id> --key program_title --json`.
5. Manage DJ settings and requests: `comvenio event dj settings|requests|settings-set|request-status|reset`.
6. Create and run an external team synchronization: `comvenio event external-sync add --file sync.json --json`, then `comvenio event external-sync run --json`.

### Site plan

Site plans are event functionality, but their own CLI domain because of their scope:

```bash
comvenio plan list <event-id> --json
comvenio plan create <event-id> --name "Hauptgelände" --json
comvenio plan update <plan-id> --file plan-patch.json --json
comvenio plan delete <plan-id> --json

comvenio plan zone create <plan-id> --name "Festzelt" --length 20 --width 10 --json
comvenio plan zone update <zone-id> --file zone-patch.json --json
comvenio plan zone delete <zone-id> --json

comvenio plan table create <plan-id> --capacity 8 --length 2.2 --width 0.8 --json
comvenio plan table update <table-id> --file table-patch.json --json
comvenio plan table delete <table-id> --json

comvenio plan marker create <plan-id> --marker-type parking --label "Parken" --json
comvenio plan marker update <marker-id> --file marker-patch.json --json
comvenio plan marker delete <marker-id> --json

comvenio plan guest list <event-id> --json
comvenio plan guest add <event-id> --file guest.json --json
comvenio plan guest update <guest-id> --file guest-patch.json --json
comvenio plan guest delete <guest-id> --json
```

`guest.json` contains `{"name": "Gastverein", "logo_file_id": "<file-id-or-null>"}`; on
`guest update` both fields are optional.

Further plan commands: `zone list|link|unlink`, `table duplicate`, `detail`, `export`, `illustrate`,
`compose`.

## Examples

Minimal `event.json` contract:

```json
{
  "title": "Sommerfest",
  "event_type": "party",
  "visibility_scope": "public",
  "organizer_type": "member",
  "department_id": "<department-id>",
  "start_time": "2026-08-15T16:00:00+02:00",
  "end_time": "2026-08-16T01:00:00+02:00",
  "description": "Sommerfest am Vereinsheim",
  "location": "Vereinsheim",
  "status": "planned",
  "event_complexity": "simple"
}
```

Additional fields on create and update include `organizer_member_id`, `external_name`, `external_email`, `has_protocol_support`, `has_counter_support`, `has_purchase_support`, `invitation_mode` and `feature_profile`. Only available on update are `actual_visitors`, `actual_revenue` and `actual_costs`.

Several areas in one call:

```json
{
  "event_id": "<event-id>",
  "areas": [
    {"name": "Bühne", "is_public": true, "area_category": "stage"},
    {"name": "Bar", "is_public": true, "area_category": "bar"}
  ]
}
```

```bash
comvenio event area bulk --file areas.json --json
```

Copying areas between festival days:

```json
{
  "source_area_ids": ["<area-id>"],
  "target_event_ids": ["<child-event-id>"],
  "copy_leads": true,
  "copy_assignments": true,
  "copy_notes": true,
  "copy_program": true,
  "copy_contacts": true,
  "copy_sponsors": true,
  "copy_resources": true,
  "copy_tasks": true,
  "copy_shifts": true,
  "reuse_existing": true
}
```

Area lead:

```json
{"member_id": "<member-id>", "title": "Bereichsleitung", "is_default": true}
```

A complete program payload:

```json
{
  "club_id": "<club-id>",
  "area_id": "<area-id>",
  "responsible_member_id": "<member-id>",
  "start_time": "2026-08-15T18:00:00+02:00",
  "end_time": "2026-08-15T20:00:00+02:00",
  "time_label": "Sa 18:00",
  "title": "Live-Musik",
  "description": "Band auf der Hauptbühne",
  "icon": "music",
  "image_url": "https://example.org/legacy-image.jpg",
  "image_file_id": "<file-id>",
  "flyer_file_id": "<file-id>",
  "reference_type": "tournament",
  "reference_id": "<event-id>",
  "reference_label": "Dartturnier",
  "reference_url": "/club/...",
  "sort_order": 20
}
```

Changing the order (`items` holds the new sort order):

```json
{"items": [{"id": "<program-item-1>", "sort_order": 10}, {"id": "<program-item-2>", "sort_order": 20}]}
```

Creating a contact:

```json
{
  "area_id": "<area-id>",
  "name": "Max Mustermann",
  "role": "Technik",
  "phone": "+49...",
  "email": "max@example.org",
  "notes": "Ab 14 Uhr vor Ort",
  "member_id": null,
  "priority": "important",
  "sort_order": 10,
  "visibility": "members"
}
```

`priority` is `normal`, `important` or `emergency`; `visibility` is `public`, `members` or `admin`.

Resource payload — `add` adds, `set` replaces the whole set, the club ID is filled in per target:

```json
{
  "targets": [
    {"target_type": "room", "target_id": "<room-id>", "event_area_id": "<area-id>"},
    {"target_type": "object", "target_id": "<object-id>"}
  ]
}
```

Inviting groups, departments or organizational groups:

```json
{"event_id": "<event-id>", "group_ids": ["<group-id>"]}
```

Inviting a Comvenio club:

```json
{
  "event_id": "<event-id>",
  "invited_club_id": "<club-id>",
  "invitation_type": "public",
  "message": "Wir freuen uns auf euch."
}
```

Inviting an external club by e-mail:

```json
{
  "event_id": "<event-id>",
  "external_email": "kontakt@example.org",
  "external_club_name": "Dartfreunde Beispiel",
  "external_contact_name": "Erika Beispiel",
  "invitation_type": "public",
  "message": "Einladung zum Turnier",
  "menu_id": null
}
```

Manual registration with orders:

```json
{
  "attendee_count": 3,
  "contact_name": "Erika Beispiel",
  "contact_email": "erika@example.org",
  "contact_phone": "+49...",
  "notes": "Kommt gegen 18 Uhr",
  "orders": [
    {"menu_item_id": "<menu-item-id>", "quantity": 2, "note": "ohne Zwiebeln"}
  ]
}
```

Admin correction of a registration:

```json
{"admin_adjustment_count": 10, "admin_adjustment_reason": "Helfer ohne Online-Anmeldung"}
```

Setting an event theme:

```json
{
  "name": "Sommerfest 2026",
  "base_brief": "Warm, familiär, Vereinsfarben im Mittelpunkt",
  "css_vars": {"--event-primary": "#123456", "--event-accent": "#f59e0b"},
  "reference_image_ids": ["<file-id>"],
  "mood_tags": ["sommerlich", "familiär"]
}
```

Public-hub copy is merged per key:

```json
{"copy": {"hero_kicker": "Vereinsfest", "program_title": "Unser Programm"}}
```

External team synchronization:

```json
{
  "department_id": "<department-id>",
  "provider": "nuliga_tennis",
  "external_club_id": "<provider-club-id>",
  "external_team_id": "<provider-team-id>",
  "age_group_filter": null,
  "home_location": "Vereinsanlage",
  "team_label": "Herren 1",
  "sync_enabled": true
}
```

### Links to other areas

| Task | Right command |
|---|---|
| Upload files/gallery | `comvenio data upload ... --context event --context-id <event-id>` |
| Link a file as flyer/cover image at the business level | `comvenio event attachment add ...` |
| Sponsor master data and contracts | `comvenio sponsor ...` |
| Assign a sponsor to an event | `comvenio event sponsor add ...` |
| Manage rooms, buildings and objects | `comvenio object ...` |
| Confirm or reject bookings | `comvenio booking ...` |
| Link a resource to an event | `comvenio event resource ...` |
| Tasks and shifts | `comvenio task ...` on the task context of the area |
| Menus | `comvenio menu ...` |
| Assign a menu to an event area | `comvenio event menu list|assign|unassign` |
| Site plan | `comvenio plan ...` |

### Deliberately not mirrored

| Area | Reason |
|---|---|
| Changing system-wide copy defaults | Platform administration, not club management. |
| Purely public share, public-hub and form pages | They do not manage the club; admin functions have their own commands. |
| Calendar subscriptions | The CLI sign-in contract is not yet built for this path. Do not bypass it with a direct call. |
| Legacy site-plan view | Replaced by the current `plan` domain. |

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**event** — complete

- `comvenio event list`
- `comvenio event show`
- `comvenio event create`
- `comvenio event update`
- `comvenio event publish`
- `comvenio event delete`
- `comvenio event template list|create|clone|instantiate`
- `comvenio event series list|show|create|materialize|promote-recurring|promote-yearly|next`
- `comvenio event area list|add|show|update|delete|bulk|copy`
- `comvenio event assignment list|add|remove|clear`
- `comvenio event lead list|add|update|delete`
- `comvenio event area-note list|add|update|delete`
- `comvenio event program list|add|update|delete|reorder`
- `comvenio event contact list|add|update|delete`
- `comvenio event resource list|add|set|remove|link-show|link-update|link-delete|usage|usage-batch`
- `comvenio event attachment list|show|add|update|delete`
- `comvenio event tag category and assignment workflows`
- `comvenio event sponsor and sponsor-program workflows`
- `comvenio event invitation and club-invitation workflows`
- `comvenio event registration list|add|stats|show|update|adjust|delete|aggregate`
- `comvenio event design theme and asset workflows`
- `comvenio event copy set|reset`
- `comvenio event dj settings and request workflows`
- `comvenio event external-sync workflows`
- `comvenio event instance previous|next|compare|clone-next`
- `comvenio event child list|create|invitation-summary`
- `comvenio event menu list|assign|unassign`
- Fields and values: `comvenio schema event --json`

**plan** — complete

- `comvenio plan list`
- `comvenio plan show`
- `comvenio plan create`
- `comvenio plan update`
- `comvenio plan delete`
- `comvenio plan zone list|create|update|delete|link|unlink`
- `comvenio plan table create|duplicate|update|delete`
- `comvenio plan marker create|update|delete`
- `comvenio plan guest list|add|update|delete`
- `comvenio plan detail`
- `comvenio plan export`
- `comvenio plan illustrate`
- `comvenio plan compose`
<!-- /gen:docs -->

## Errors

- `AUTH_REQUIRED` — your sign-in has expired or is missing before an event command runs. See `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — the sign-in does not carry the scope required for this event action. See `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — your role in the club does not allow, for example, `create_events` or `manage_events`. See `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — the event, area, template or series does not exist or is not visible to you. See `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — a required field is missing or has the wrong format, for example in the event or area JSON. See `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — an area, resource or date does not allow the action in its current state. See `comvenio help fehler CONFLICT`.
- `CONFIRMATION_REQUIRED` — a critical change such as deleting an area must be confirmed first. See `comvenio help fehler CONFIRMATION_REQUIRED`.
