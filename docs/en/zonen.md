---
id: zonen
kategorie: thema
domaenen: [zone]
stichwoerter: [zone, zones, zone set, geojson, territory, sponsor, tasks]
---

# Club territory and zones

## Purpose

A club splits its territory into **zone sets** (for example "Flyers (streets)") and each zone set
into **zones** — areas on the map. Tasks are assigned zones; whoever is assigned to a task is
thereby assigned to its zones.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Sign in with `comvenio login`; the scopes a given command needs are shown by
`comvenio action list --json`. Drawing happens exclusively in the territory editor of the web app
— the CLI reads and writes zones as GeoJSON files, it does not change corner points interactively.

## Workflows

### Creating and maintaining a zone set

1. See existing zone sets: `comvenio zone set list --json`.
2. Create a new zone set: `comvenio zone set create --name "<name>" --center <lat>,<lng> --zoom <n>`.
3. Rename it: `comvenio zone set update <zone-set-id> --name "<new name>"`.
   `update` reads the current state itself; with `--expected-version <n>` it writes against a
   known state — if it no longer matches, the service answers with `409` and states
   `live_version`.
4. Delete a zone set: `comvenio zone set delete <zone-set-id>`.

### Creating and maintaining zones

1. See a zone set's zones: `comvenio zone list --set <zone-set-id>`.
2. Create a zone from a GeoJSON file:
   `comvenio zone create --set <zone-set-id> --name "<name>" --geojson <file>.geojson --color "#e0842b"`.
   `--geojson` accepts a `Polygon` or `MultiPolygon`, a `Feature` or a `FeatureCollection` with
   exactly one feature; coordinates are `[lng, lat]`, every ring is closed and has at least four
   points, at most 2000 points per zone. An invalid file is rejected before the call.
3. Update its shape: `comvenio zone update <zone-id> --geojson <new-file>.geojson`.
4. Delete a zone: `comvenio zone delete <zone-id>`. Deleted zones stay on their tasks and are shown
   there as deleted.

### Maintaining zone details

1. Enter a building count by hand: `comvenio zone update <zone-id> --building-count 120`; leave it
   to the estimate again with `--building-count leer`.
2. Set or clear a note: `comvenio zone update <zone-id> --notes "<text>"` or `--notes ""`.
3. Restart the estimate (for example after "estimate failed"):
   `comvenio zone estimate <zone-id>` — the result appears in `zone list` within a few seconds.
4. Set sponsor, meeting point, mode of transport and special notes:
   `comvenio zone update <zone-id> --pate <member-id> --treffpunkt "<lat>,<lng>,<description>" --fortbewegung fuss --besonderheiten hunde,zugang`.
   Each of these fields is cleared individually with `leer`.

### Importing zones

1. `comvenio zone import --set <zone-set-id> --geojson <file>.geojson`. Every feature of the
   `FeatureCollection` becomes a zone; the name comes from `properties.name`, the color optionally
   from `properties.color`. Invalid features are skipped and listed with their index and reason;
   the valid zones are created regardless.

### Overview and assignment

1. Overview per zone: `comvenio zone overview --set <zone-set-id>` — shows **not assigned**, **in
   progress**, **assigned, open** and, with `--status completed`, **done**; canceled tasks never
   count.
2. See a task's zones: `comvenio task-zones <task-id>`.
3. Assign or remove a zone: `comvenio task-zones <task-id> add <zone-id>` or
   `comvenio task-zones <task-id> remove <zone-id>`. A task only ever carries zones from one zone
   set; templates get no zones.

The offline schema for zones is available at `comvenio schema zone --json`.

## Examples

```bash
comvenio zone set create --name "Flyers (streets)" --center 48.8950,12.3790 --zoom 16
comvenio zone create --set <zone-set-id> --name "Kastner street" --geojson kastner.geojson --color "#e0842b"
comvenio zone update <zone-id> --pate <member-id> --treffpunkt "49.05,12.36,Materials at the Huber family" --fortbewegung fuss --besonderheiten hunde,zugang
comvenio zone estimate <zone-id>
comvenio zone overview --set <zone-set-id> --status open,in_progress,completed --json
comvenio task-zones <task-id> add <zone-id>
```

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**zone** — complete

- `comvenio zone set list`
- `comvenio zone set create`
- `comvenio zone set update`
- `comvenio zone set delete`
- `comvenio zone list`
- `comvenio zone create`
- `comvenio zone update`
- `comvenio zone estimate`
- `comvenio zone delete`
- `comvenio zone import`
- `comvenio zone overview`
- `comvenio zone task-zones`
- `comvenio zone task-zones add`
- `comvenio zone task-zones remove`
- Fields and values: `comvenio schema zone --json`
<!-- /gen:docs -->

## Errors

- `VALIDATION_FAILED` — the GeoJSON geometry or a field like `--pate` is invalid, for example an
  unclosed ring or an unknown member ID. More: `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — the zone or zone set has changed since the state that was read
  (`--expected-version` no longer matches). More: `comvenio help fehler CONFLICT`.
- `NOT_FOUND` — zone set, zone or task are not known under the given identifier. More:
  `comvenio help fehler NOT_FOUND`.
- `PERMISSION_DENIED` — the club role does not allow creating, changing or deleting. More:
  `comvenio help fehler PERMISSION_DENIED`.
- `UPSTREAM_UNAVAILABLE` — a service needed for validation (for example for `--pate`) is currently
  not answering. More: `comvenio help fehler UPSTREAM_UNAVAILABLE`.
