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

Sign in with `comvenio login`; which actions your club has enabled and which scopes they need is
shown by `comvenio action list --json`. Drawing happens exclusively in the territory editor of the
web app — zone sets, zones and their assignment to tasks are managed there.

## Workflows

### Zone sets, zones and their assignment

A club creates its zone sets and zones in the web app's territory editor and changes their shape,
color, note, sponsor, meeting point, mode of transport and special notes there. The building count
per zone is estimated automatically: after creating a zone and after every change to its shape,
the addresses (street and house number) inside the polygon are counted from OpenStreetMap; a
number entered by hand takes precedence over the estimate.

Tasks are assigned one or more zones of a zone set in the territory editor — a task only ever
carries zones from a single zone set, and templates get no zones. Whoever is assigned to a task is
thereby assigned to its zones. An overview per zone shows what is not assigned, in progress,
assigned-open or — on request — done; canceled tasks never count.

## Examples

There are no `comvenio` commands for this area — zone sets, zones and their assignment are edited
exclusively in the web app's territory editor.

## Commands and actions

<!-- gen:docs befehle -->

**zone**

- No action yet — this area works through the web app.
- Fields and values: `comvenio schema zone --json`
<!-- /gen:docs -->

## Errors

There are no `comvenio` commands for this area and therefore no CLI error codes of its own; errors
while drawing or assigning are shown directly by the web app's territory editor.
