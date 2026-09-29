---
id: veranstaltungen
kategorie: thema
domaenen: [event, plan]
stichwoerter: [event, template, series, recurring-event, area, program, invitation, registration, sponsor, festival-day]
---

# Events

## Purpose

With the `event` actions you manage your club's events end to end: from templates through recurring dates and multi-day festivals to areas, program, invitations, registrations, sponsors and design.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club has enabled and which scopes they need is shown by `comvenio action list --json`. You can also see fields and inputs offline, without signing in: `comvenio schema event --json`, `comvenio schema plan --json` and `comvenio help veranstaltungen`. What you can actually do also depends on your role in the club — permissions are checked server-side only.

| Operation | Permission or rule |
|---|---|
| Read visible events | Visibility filter; some catalog and series functions additionally need `view_events` |
| Create event, template or series | `create_events` |
| Manage event and sub-resources (areas, program, contacts, resources, sponsors, design, DJ) | `manage_events` |
| Manage the site plan (`plan`) | also `manage_events` |
| Edit or delete your own area note | only the person who created it |
| Respond to your own invitation | ownership and visibility rule |

A `403` means the permission is missing. A `404` can intentionally appear instead of `403` for data you cannot see.

### Safety rules for agents

- Never call the Comvenio API directly — use only the enabled `event` and `plan` actions (`comvenio action call …`). A missing action must be added to the CLI.
- Before `delete`, `remove`, `clear`, `unassign` and comparably critical operations, ask for explicit confirmation unless the deletion was already clearly requested — the CLI itself requires a preview first for these actions anyway, then `comvenio action confirm`.
- Never pass `club_id` in `--input` — the club comes from the sign-in, the CLI rejects `club_id` in the input.
- For multi-day festivals, create program items on the child event; the parent only shows the aggregate.
- Never delete the automatically created default area.
- Use `resource … --input '{"operation":"set", …}'` only when the complete target set is known; `operation=add` is additive.
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

1. Create a template: `comvenio action call cai.event.07.template_list_create_clone_instantiate --input '{"operation":"create","template":{"department_id":"<department-id>","title":"Darttraining","event_type":"training","visibility_scope":"member","organizer_type":"member","description":"Wöchentliches Training"}}'`.
2. Define a series from the template: `comvenio action call cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n --input '{"operation":"create","series":{"name":"Darttraining Mittwoch","department_id":"<department-id>","event_type":"training","visibility_scope":"member","timezone":"Europe/Berlin","rrule":"FREQ=WEEKLY;BYDAY=WE","dtstart":"2026-01-07T19:00:00+01:00","duration_minutes":120}}'`. The recurrence is an RRULE in `rrule` (e.g. `FREQ=WEEKLY;BYDAY=WE`), no longer separate frequency/weekday flags.
3. Materialize a concrete time range: a call without confirmation returns a preview — `comvenio action call cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n --input '{"operation":"materialize","series_id":"<series-id>","range":{"from":"2026-01-01","to":"2026-03-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true}}'`. Check the preview, then `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>`. `materialize` is idempotent and skips existing dates.

### Create and publish a single event

1. Create an event: `comvenio action call cai.event.03.create --input '{"event":{"department_id":"<department-id>","title":"Sommerfest","event_type":"party","visibility_scope":"public","organizer_type":"member","start_time":"2026-08-15T16:00:00+02:00","end_time":"2026-08-16T01:00:00+02:00","description":"Sommerfest am Vereinsheim","location":"Vereinsheim","event_complexity":"simple"}}'`.
2. Read an event: `comvenio action call cai.event.02.show --input '{"event_id":"<event-id>"}'`. List events (the time range is required): `comvenio action call cai.event.01.list --input '{"range":{"from":"2026-08-01","to":"2026-09-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true},"limit":50}'`.
3. Update an event: `comvenio action call cai.event.04.update --input '{"event_id":"<event-id>","changes":{"description":"Neuer Text"}}'`.
4. Publish an event (critical — preview first, then confirmation): `comvenio action call cai.event.05.publish --input '{"event_id":"<event-id>","make_public":true}'`, then `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>`. `publish` sets `status=confirmed`; `make_public=true` also sets `visibility_scope=public`.
5. Delete an event (critical): `comvenio action call cai.event.06.delete --input '{"event_id":"<event-id>"}'`, then `comvenio action confirm …`.

### Multi-day festivals with festival days

1. Create the parent event with `event_complexity=multi_day` (see above); it must be public.
2. Manage festival days: `comvenio action call cai.event.27.child_list_create_invitation_summary --input '{"operation":"list","event_id":"<parent-event-id>"}'`, to create one `--input '{"operation":"create","event_id":"<parent-event-id>","child":{"title":"Samstag","event_type":"party","visibility_scope":"public","organizer_type":"member","start_time":"2026-08-15T16:00:00+02:00","end_time":"2026-08-16T01:00:00+02:00"}}'`.
3. Create program items on the respective child event — the parent only shows the aggregate.
4. Copy areas between festival days (critical): `comvenio action call cai.event.09.area_list_add_show_update_delete_bulk_copy --input '{"operation":"copy","source_event_id":"<child-event-id>","target_event_ids":["<other-child-event-id>"]}'`, then `comvenio action confirm …`.

### Set up, staff and document areas

1. Create an area: `comvenio action call cai.event.09.area_list_add_show_update_delete_bulk_copy --input '{"operation":"add","event_id":"<event-id>","area":{"name":"Bühne","description":"Programm und Technik","color":"#7c3aed","is_public":true,"area_category":"stage"}}'`, or several in one call (critical) with `operation=bulk` and `areas`. Area fields are `name`, `description`, `color`, `is_public`, `public_description` and `area_category`; whether an area is the default area is decided automatically for the event and cannot be set through the action.
2. Change an area: `operation=update` with `area_id` and `changes`. Delete an area (critical): `operation=delete` with `area_id`, then `comvenio action confirm …`.
3. Assign members: `comvenio action call cai.event.10.assignment_list_add_remove_clear --input '{"operation":"add","area_id":"<area-id>","event_id":"<event-id>","member_id":"<member-id>"}'`; remove (critical) with `operation=remove` and `member_id`, clear (critical) with `operation=clear`.
4. Create an area lead: `comvenio action call cai.event.11.lead_list_add_update_delete --input '{"operation":"add","area_id":"<area-id>","lead":{"member_id":"<member-id>","role":"Bereichsleitung"}}'`.
5. Add a note: `comvenio action call cai.event.12.area_note_list_add_update_delete --input '{"operation":"add","area_id":"<area-id>","note":{"content":"Stromanschluss geprüft","is_public":false}}'`. Listing notes needs `limit` and `offset`: `--input '{"operation":"list","area_id":"<area-id>","limit":20,"offset":0}'`.

### Maintain program and contacts

1. Create a program item: `comvenio action call cai.event.13.program_list_add_update_delete_reorder --input '{"operation":"add","event_id":"<event-id>","item":{"title":"Eröffnung","description":"Begrüßung durch den Vorstand","start_time":"2026-08-15T18:00:00+02:00","end_time":"2026-08-15T18:15:00+02:00","location":"Hauptbühne","sort_order":10}}'`.
2. Change the order (critical): `--input '{"operation":"reorder","event_id":"<event-id>","item_ids":["<program-item-1>","<program-item-2>"]}'` — `item_ids` holds the new order, then `comvenio action confirm …`.
3. Create a contact: `comvenio action call cai.event.14.contact_list_add_update_delete --input '{"operation":"add","event_id":"<event-id>","contact":{"name":"Max Mustermann","role":"Technik","email":"max@example.org","phone_number":"+49...","is_public":false}}'`.

### Link files, resources and tags

1. Upload a file through the file actions first (see the separate "Files" article), then link it at the business level: `comvenio action call cai.event.16.attachment_list_show_add_update_delete --input '{"operation":"add","event_id":"<event-id>","attachment":{"file_id":"<file-id>","attachment_type":"flyer","title":"Festflyer","is_public":true}}'`. Common attachment types: `content`, `counter`, `protocol`, `tournament`, `title_picture`, `flyer`, `news`, `menu`, `shoppinglist`, `canva_embed`.
2. Link a resource: `operation=add` adds (`resource*:object` with `target_type`, `target_id`, optionally `quantity`/`notes`), `operation=set` replaces the whole set (`resources*:array`); remove (critical) with `operation=remove` and `target_type`/`target_id`. Check utilization: `operation=usage` with `target_type`, `target_id`, `range`, optionally `status`.
3. Create a tag category and tag, then assign: `comvenio action call cai.event.17.tag_category_and_assignment_workflows --input '{"operation":"category_add","category":{"name":"Sportart"}}'`, `--input '{"operation":"tag_add","tag":{"name":"Darts","category_id":"<category-id>"}}'`, `--input '{"operation":"assign","event_id":"<event-id>","tag_id":"<tag-id>"}'`; view assigned tags with `operation=assigned`. `category_update` and `tag_update` expect the full set of partial changes in `changes`.

### Invite members and clubs, capture registrations

1. Invite a member: `comvenio action call cai.event.19.invitation_and_club_invitation_workflows --input '{"operation":"member_add","invitation":{"event_id":"<event-id>","member_id":"<member-id>"}}'`; set the status: `--input '{"operation":"member_status","invitation_id":"<invitation-id>","status":"accepted"}'`.
2. Invite in bulk: `--input '{"operation":"member_add_groups","event_id":"<event-id>","group_ids":["<group-id>"]}'` (for departments `member_add_departments`/`department_ids`, for organizational groups `member_add_org_groups`/`organization_group_ids`).
3. Invite a Comvenio club: `--input '{"operation":"club_add","event_id":"<event-id>","invited_club_id":"<club-id>","invitation_type":"public","message":"Wir freuen uns auf euch."}'`; invite an external club by e-mail (critical): `--input '{"operation":"club_external","event_id":"<event-id>","external_email":"kontakt@example.org","external_club_name":"Dartfreunde Beispiel","invitation_type":"public"}'`, then `comvenio action confirm …`.
4. Capture a manual registration: `--input '{"operation":"add","event_id":"<event-id>","registration":{"participant_count":3,"notes":"Kommt gegen 18 Uhr"}}'` via `cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate`; statistics with `operation=stats`; admin correction (critical) with `operation=adjust`, `registration_id`, `participant_count`, `reason`.

### Maintain sponsors, design, copy, DJ and external match schedule

1. Create sponsor master data through the sponsoring actions (see the separate article); linking it to the event runs through `comvenio action call cai.event.18.sponsor_and_sponsor_program_workflows --input '{"operation":"link_add","event_id":"<event-id>","link":{"advertiser_id":"<advertiser-id>","tier":"gold"}}'`.
2. Link a sponsor to a program item: `--input '{"operation":"program_add","link_id":"<sponsor-link-id>","item_id":"<program-item-id>"}'`.
3. Set the event theme: `comvenio action call cai.event.22.design_theme_and_asset_workflows --input '{"operation":"theme_set","event_id":"<event-id>","theme":{"primary_color":"#123456","accent_color":"#f59e0b","font_family":"Inter"}}'`. Upload an asset (critical, upload the file through the file actions first): `--input '{"operation":"asset_upload","event_id":"<event-id>","file_id":"<file-id>","asset_type":"FLYER"}'`, then `comvenio action confirm …`; removing an asset is also critical with `operation=asset_delete`.
4. Merge public-hub copy per key: `comvenio action call cai.event.23.copy_set_reset --input '{"operation":"set","event_id":"<event-id>","values":{"hero_kicker":"Vereinsfest","program_title":"Unser Programm"}}'`; reset a single key (critical): `--input '{"operation":"reset","event_id":"<event-id>","key":"program_title"}'`.
5. DJ settings and requests: `comvenio action call cai.event.24.dj_settings_and_request_workflows --input '{"operation":"settings","event_id":"<event-id>"}'`, requests with `operation=requests`, change settings with `operation=settings_set`, request status with `operation=request_status` and `status` (`played`, `rejected`, `pending`), reset (critical) with `operation=reset`.
6. Create and run an external team synchronization: `comvenio action call cai.event.25.external_sync_workflows --input '{"operation":"add","sync":{"provider_id":"nuliga_tennis","external_club_id":"<provider-club-id>"}}'`, then run it (critical) with `operation=run`, then `comvenio action confirm …`.

### Site plan

Site plans are event functionality, but their own action domain because of their scope. Read and simple write operations (`list`, `show`, `create`, `update`, `link`, `duplicate`) run directly; critical operations (`delete`, `unlink`, `export`, `illustrate`, `compose`) return a preview first, then `comvenio action confirm --preview-id … --confirmation-token … --idempotency-key …`.

```bash
comvenio action call cai.plan.01.list --input '{"event_id":"<event-id>"}'
comvenio action call cai.plan.03.create --input '{"event_id":"<event-id>","plan":{"name":"Hauptgelände"}}'
comvenio action call cai.plan.04.update --input '{"plan_id":"<plan-id>","changes":{"name":"Hauptgelände Nord"}}'
comvenio action call cai.plan.05.delete --input '{"plan_id":"<plan-id>"}'   # critical

comvenio action call cai.plan.06.zone_list_create_update_delete_link_unlink \
  --input '{"operation":"create","plan_id":"<plan-id>","zone":{"name":"Festzelt","length_m":20,"width_m":10}}'

comvenio action call cai.plan.07.table_create_duplicate_update_delete \
  --input '{"operation":"create","table":{"event_id":"<event-id>","capacity":8,"length_m":2.2,"width_m":0.8}}'

comvenio action call cai.plan.08.marker_create_update_delete \
  --input '{"operation":"create","marker":{"event_id":"<event-id>","marker_type":"parking","label":"Parken"}}'

comvenio action call cai.plan.09.guest_list_add_update_delete \
  --input '{"operation":"add","event_id":"<event-id>","guest":{"name":"Gastverein"}}'

comvenio action call cai.plan.10.detail --input '{"zone_id":"<zone-id>","detail_plan":{"name":"Zeltplan Detail"}}'
comvenio action call cai.plan.11.export --input '{"event_id":"<event-id>","format":"pdf","hide_zone_ids":[],"hide_marker_ids":[],"hide_tables":false,"hide_labels":false}'   # critical
```

## Examples

Event object on create (the `event` field of `cai.event.03.create`):

```json
{
  "department_id": "<department-id>",
  "title": "Sommerfest",
  "event_type": "party",
  "visibility_scope": "public",
  "organizer_type": "member",
  "start_time": "2026-08-15T16:00:00+02:00",
  "end_time": "2026-08-16T01:00:00+02:00",
  "description": "Sommerfest am Vereinsheim",
  "location": "Vereinsheim",
  "event_complexity": "simple"
}
```

Additional fields include `organizer_member_id`, `external_name`, `external_email`, `has_protocol_support`, `has_counter_support`, `has_purchase_support` and `feature_profile`. `status` can only be set on update.

Several areas in one call (`cai.event.09…`, `operation=bulk`, critical):

```json
{
  "operation": "bulk",
  "event_id": "<event-id>",
  "areas": [
    {"name": "Bühne", "is_public": true, "area_category": "stage"},
    {"name": "Bar", "is_public": true, "area_category": "bar"}
  ]
}
```

Area lead (`lead` field):

```json
{"member_id": "<member-id>", "role": "Bereichsleitung"}
```

Program item (`item` field of `cai.event.13…`, `operation=add`):

```json
{
  "title": "Live-Musik",
  "description": "Band auf der Hauptbühne",
  "start_time": "2026-08-15T18:00:00+02:00",
  "end_time": "2026-08-15T20:00:00+02:00",
  "location": "Hauptbühne",
  "sort_order": 20
}
```

Changing the order (`item_ids` holds the new sort order):

```json
{"operation": "reorder", "event_id": "<event-id>", "item_ids": ["<program-item-1>", "<program-item-2>"]}
```

Contact (`contact` field):

```json
{
  "name": "Max Mustermann",
  "role": "Technik",
  "phone_number": "+49...",
  "email": "max@example.org",
  "is_public": false
}
```

Resource payload — `operation=add` adds, `operation=set` replaces the whole set:

```json
{
  "operation": "set",
  "event_id": "<event-id>",
  "resources": [
    {"target_type": "room", "target_id": "<room-id>"},
    {"target_type": "object", "target_id": "<object-id>"}
  ]
}
```

Inviting groups, departments or organizational groups:

```json
{"operation": "member_add_groups", "event_id": "<event-id>", "group_ids": ["<group-id>"]}
```

Inviting a Comvenio club:

```json
{
  "operation": "club_add",
  "event_id": "<event-id>",
  "invited_club_id": "<club-id>",
  "invitation_type": "public",
  "message": "Wir freuen uns auf euch."
}
```

Inviting an external club by e-mail (critical):

```json
{
  "operation": "club_external",
  "event_id": "<event-id>",
  "external_email": "kontakt@example.org",
  "external_club_name": "Dartfreunde Beispiel",
  "external_contact_name": "Erika Beispiel",
  "invitation_type": "public",
  "message": "Einladung zum Turnier"
}
```

Manual registration:

```json
{
  "operation": "add",
  "event_id": "<event-id>",
  "registration": {
    "participant_count": 3,
    "notes": "Kommt gegen 18 Uhr"
  }
}
```

Admin correction of a registration (critical):

```json
{"operation": "adjust", "registration_id": "<registration-id>", "participant_count": 10, "reason": "Helfer ohne Online-Anmeldung"}
```

Setting an event theme:

```json
{
  "operation": "theme_set",
  "event_id": "<event-id>",
  "theme": {
    "primary_color": "#123456",
    "accent_color": "#f59e0b",
    "font_family": "Inter"
  }
}
```

Public-hub copy is merged per key:

```json
{"operation": "set", "event_id": "<event-id>", "values": {"hero_kicker": "Vereinsfest", "program_title": "Unser Programm"}}
```

Creating an external team synchronization:

```json
{"operation": "add", "sync": {"provider_id": "nuliga_tennis", "external_club_id": "<provider-club-id>", "active": true}}
```

Site plan zone:

```json
{"operation": "create", "plan_id": "<plan-id>", "zone": {"name": "Festzelt", "length_m": 20, "width_m": 10}}
```

### Links to other areas

| Task | Where |
|---|---|
| Upload files/gallery | separate "Files" article |
| Link a file as flyer/cover image at the business level | `cai.event.16…`, `operation=add` |
| Sponsor master data and contracts | separate "Sponsoring" article |
| Assign a sponsor to an event | `cai.event.18…`, `operation=link_add` |
| Manage rooms, buildings and objects | separate "Bookings and objects" article |
| Confirm or reject bookings | separate "Bookings and objects" article |
| Link a resource to an event | `cai.event.15…` |
| Tasks and shifts | separate "Tasks" article, on the area's context |
| Menus | separate "Menus" article |
| Assign a menu to an event area | `cai.event.28.menu_list_assign_unassign` |
| Site plan | `cai.plan…` |

### Deliberately not mirrored

| Area | Reason |
|---|---|
| Changing system-wide copy defaults | Platform administration, not club management. |
| Purely public share, public-hub and form pages | They do not manage the club; admin functions have their own actions. |
| Calendar subscriptions | The sign-in contract is not yet built for this path. Do not bypass it with a direct call. |
| Legacy site-plan view | Replaced by the current `plan` domain. |

## Commands and actions

<!-- gen:docs befehle -->

**event**

- `cai.event.01.list` — list (read) · Scopes: `event.read`
- `cai.event.02.show` — show (read) · Scopes: `event.read`
- `cai.event.03.create` — create (change) · Scopes: `event.write`
- `cai.event.04.update` — update (change) · Scopes: `event.write`
- `cai.event.05.publish` — publish (change with confirmation) · Scopes: `event.write`
- `cai.event.06.delete` — delete (change with confirmation) · Scopes: `event.write`
- `cai.event.07.template_list_create_clone_instantiate` — list, create, clone, instantiate (read, change) · Scopes: `event.read`, `event.write`
- `cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n` — list, show, create, update, delete, materialize, materialize_next, promote_recurring, promote_yearly (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.09.area_list_add_show_update_delete_bulk_copy` — list, add, show, update, delete, bulk, copy (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.10.assignment_list_add_remove_clear` — list, add, remove, clear (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.11.lead_list_add_update_delete` — list, add, update, delete (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.12.area_note_list_add_update_delete` — list, add, update, delete (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.13.program_list_add_update_delete_reorder` — list, add, update, delete, reorder (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.14.contact_list_add_update_delete` — list, add, update, delete (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.15.resource_list_add_set_remove_link_show_link_update_link_delete_usage_u` — list, add, set, remove, link_show, link_update, link_delete, usage, usage_batch (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.16.attachment_list_show_add_update_delete` — list, show, add, update, delete (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.17.tag_category_and_assignment_workflows` — category_list, category_show, category_add, category_update, category_delete, tag_list, tag_show, tag_add, tag_update, tag_delete, assigned, assignment_list, assign, unassign, clear (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.18.sponsor_and_sponsor_program_workflows` — link_list, link_add, link_delete, tier_list, tier_add, tier_update, tier_delete, tier_sync, program_by_sponsor, program_by_item, program_add, program_delete (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.19.invitation_and_club_invitation_workflows` — member_mine, member_list, member_show, member_add, member_add_groups, member_add_departments, member_add_org_groups, member_update, member_status, member_delete, member_notified, club_list, club_attending, club_incoming, club_accepted, club_show, club_add, club_external, club_self_join, club_update, club_respond, club_delete (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate` — list, add, stats, show, update, adjust, delete, aggregate (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.22.design_theme_and_asset_workflows` — theme_show, theme_set, theme_delete, asset_list, asset_upload, asset_delete (read, change, change with confirmation) · Scopes: `event.read`, `event.write`, `files.write`
- `cai.event.23.copy_set_reset` — set, reset (change, change with confirmation) · Scopes: `event.write`
- `cai.event.24.dj_settings_and_request_workflows` — settings, requests, settings_set, request_status, reset (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.25.external_sync_workflows` — list, add, show, update, delete, matches, run, stats, provider_run (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.event.26.instance_previous_next_compare_clone_next` — previous, next, compare, clone_next (read, change) · Scopes: `event.read`, `event.write`
- `cai.event.27.child_list_create_invitation_summary` — list, create, invitation_summary (read, change) · Scopes: `event.read`, `event.write`
- `cai.event.28.menu_list_assign_unassign` — list, assign, unassign (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- Fields and values: `comvenio schema event --json` (the sign-in sets `club_id` — never in `--input`)

**plan**

- `cai.plan.01.list` — list (read) · Scopes: `event.read`
- `cai.plan.02.show` — show (read) · Scopes: `event.read`
- `cai.plan.03.create` — create (change) · Scopes: `event.write`
- `cai.plan.04.update` — update (change) · Scopes: `event.write`
- `cai.plan.05.delete` — delete (change with confirmation) · Scopes: `event.write`
- `cai.plan.06.zone_list_create_update_delete_link_unlink` — list, create, update, delete, link, unlink (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.plan.07.table_create_duplicate_update_delete` — create, duplicate, update, delete (change, change with confirmation) · Scopes: `event.write`
- `cai.plan.08.marker_create_update_delete` — create, update, delete (change, change with confirmation) · Scopes: `event.write`
- `cai.plan.09.guest_list_add_update_delete` — list, add, update, delete (read, change, change with confirmation) · Scopes: `event.read`, `event.write`
- `cai.plan.10.detail` — create (change) · Scopes: `event.write`
- `cai.plan.11.export` — export (change with confirmation) · Scopes: `files.export`, `event.read`
- `cai.plan.12.illustrate` — illustrate (change with confirmation) · Scopes: `files.export`, `event.read`
- `cai.plan.13.compose` — compose (change with confirmation) · Scopes: `files.write`, `event.write`
<!-- /gen:docs -->

## Errors

- `AUTH_REQUIRED` — your sign-in has expired or is missing before an event or plan action runs. See `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — the sign-in does not carry the scope required for this action. See `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — your role in the club does not allow, for example, `create_events` or `manage_events`. See `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — the event, area, template, series or plan does not exist or is not visible to you. See `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — a required field is missing or has the wrong format in the input. See `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — an area, resource or date does not allow the action in its current state. See `comvenio help fehler CONFLICT`.
- `CONFIRMATION_REQUIRED` — a critical action such as deleting an area needs `comvenio action confirm` with the preview first. See `comvenio help fehler CONFIRMATION_REQUIRED`.
- `OUTCOME_UNKNOWN` — a writing action did not answer in time after confirmation; check the current state instead of repeating. See `comvenio help fehler OUTCOME_UNKNOWN`.
- `OAUTH_ONLY` — only when an old, classic command is used instead of an action. See `comvenio help fehler OAUTH_ONLY`.
