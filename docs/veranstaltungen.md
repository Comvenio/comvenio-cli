# Veranstaltungen mit dem Comvenio-CLI

Diese Referenz beschreibt die vollständige clubseitige Verwaltung von Veranstaltungen. Sie ist eigenständig: Du brauchst weder Backend-Quellcode noch interne Comvenio-Dokumentation.

Lies vor jeder Event-Arbeit zuerst:

```bash
comvenio schema event --json
comvenio event --help
```

Nutze für Agenten immer `--json`. Rufe keine Comvenio-API direkt auf. Fehlt ein Befehl, muss das CLI erweitert werden.

## Schnellstart: Darttraining als Vorlage und Serie

```bash
comvenio event template create \
  --title "Darttraining" \
  --event-type training \
  --visibility-scope member \
  --organizer-type member \
  --department-id <department-id> \
  --description "Wöchentliches Training" \
  --json

comvenio event series create <template-id> \
  --start-time 2026-07-15T19:00:00+02:00 \
  --frequency weekly \
  --weekdays WE \
  --duration-minutes 120 \
  --json

comvenio event series materialize <series-id> \
  --start 2026-07-15T00:00:00+02:00 \
  --end 2027-01-15T00:00:00+01:00 \
  --json
```

Der Ablauf ist immer: **Vorlage erstellen → Serie definieren → konkretes Zeitfenster materialisieren**. `materialize` ist idempotent und überspringt vorhandene Termine.

## Begriffe und Regeln

| Begriff | Bedeutung |
|---|---|
| Veranstaltung | Ein konkreter Termin. |
| Vorlage | Ein Event mit `is_template=true`, das nicht als konkreter Termin gilt. |
| Regeltermin | `RECURRING` + `AUTO`, zum Beispiel ein wöchentliches Training. |
| Jährliches Event | `YEARLY_TEMPLATE` + `MANUAL`. Der nächste konkrete Termin wird bewusst geplant. |
| Dauertermin | Nutzerbegriff für Regeltermine und jährliche Events. |
| Parent-Event | Mehrtägiges Gesamtfest mit `event_complexity=multi_day`. Es muss öffentlich sein. |
| Child-Event | Ein konkreter Festtag unter einem Parent-Event. |
| Default-Area | Automatisch erzeugter allgemeiner Bereich eines Events. Er darf nicht gelöscht werden. |
| EventArea | Echter Arbeitsbereich wie Bühne, Bar oder Küche. |
| Attachment | Fachliche Verknüpfung eines bestehenden Datei-/News-/Menü-Datensatzes mit einem Event. |

Wichtige Enums:

- `event_type`: `party`, `meeting`, `excursion`, `training`, `competition`, `other`
- `visibility_scope`: `public`, `member`, `private`, `department`, `invite_only`
- `status`: `draft`, `planned`, `confirmed`, `archived`, `cancelled`
- `organizer_type`: `member`, `external`
- `event_complexity`: `simple`, `multi_day`
- `invitation_status`: `invited`, `accepted`, `rejected`, `waitlist`
- `club_invitation_status`: `pending`, `accepted`, `declined`, `cancelled`
- `resource_target`: `object`, `room`, `building`

Es gibt keinen Status `published`. `event publish` setzt `status=confirmed`. Mit `--public` wird zusätzlich `visibility_scope=public` gesetzt.

## Command-Matrix

Die Syntax für Untergruppen lautet immer:

```text
comvenio event <gruppe> <aktion> <primär-id> [flags] --json
```

### Event, Vorlagen, Serien und Festtage

| Zweck | CLI | Service-Vertrag |
|---|---|---|
| Events listen | `event list [--month|--start|--end|--complexity]` | `GET /events/club/{club_id}` |
| Event lesen | `event show <event-id>` | `GET /events/{id}` |
| Event erstellen | `event create <flags> [--file event.json]` | `POST /events/` |
| Event aktualisieren | `event update <event-id> <flags> [--file patch.json]` | `PATCH /events/{id}` |
| Event veröffentlichen | `event publish <event-id> [--public]` | `PATCH /events/{id}` |
| Event löschen | `event delete <event-id>` | `DELETE /events/{id}` |
| Vorlagen | `event template list|create|clone|instantiate` | `/events/...templates` |
| Serien | `event series list|show|create|update|delete|materialize|next|promote-recurring|promote-yearly` | `/event-series/...` |
| Seriennavigation | `event instance previous|next|compare <event-id>` | `/events/{id}/...instance` |
| Folgeinstanz | `event instance clone-next <event-id> --start-time <iso>` | `POST /events/{id}/clone-as-next-instance` |
| Festtage | `event child list|create|invitation-summary <parent-id>` | `/events/{parent_id}/children` |

`event create` und `event template create` akzeptieren entweder normale Flags oder zusätzlich `--file`. Werte aus der Datei ergänzen die Flags. `club_id` kommt immer aus dem CLI-Kontext.

Minimaler `event.json`-Vertrag:

```json
{
  "title": "Sommerfest",
  "event_type": "party",
  "visibility_scope": "public",
  "organizer_type": "member",
  "department_id": "<uuid>",
  "start_time": "2026-08-15T16:00:00+02:00",
  "end_time": "2026-08-16T01:00:00+02:00",
  "description": "Sommerfest am Vereinsheim",
  "location": "Vereinsheim",
  "status": "planned",
  "event_complexity": "simple"
}
```

Zusätzliche Create- und Update-Felder sind unter anderem `organizer_member_id`,
`external_name`, `external_email`, `has_protocol_support`, `has_counter_support`,
`has_purchase_support`, `invitation_mode` und `feature_profile`. Nur beim Aktualisieren
verfügbar sind `actual_visitors`, `actual_revenue` und `actual_costs`.

### Bereiche, Helfer, Leitungen und Notizen

| Zweck | CLI |
|---|---|
| Bereiche | `event area list|show|add|update|delete|bulk|copy` |
| Mitgliederzuweisungen | `event assignment list|add|remove|clear <area-id>` |
| Bereichsleitungen | `event lead list|add|update|delete <area-id-or-lead-id>` |
| Bereichsnotizen | `event area-note list|add|update|delete <area-id-or-note-id>` |

Einzelnen Bereich anlegen:

```bash
comvenio event area add <event-id> \
  --name "Bühne" \
  --description "Programm und Technik" \
  --color "#7c3aed" \
  --area-category stage \
  --public \
  --json
```

Für den vollständigen Area-Vertrag akzeptiert `area add` zusätzlich `--file` mit
`public_description`, `opens_at`, `closes_at`, `geometry`, `crs_mode` und
`is_default`. `area update <area-id> --file area-patch.json` unterstützt dieselben
änderbaren Fachfelder außer `is_default`; `geometry` enthält GeoJSON als JSON-Text.

Mehrere Bereiche in einem Aufruf:

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

Bereiche zwischen Festtagen kopieren:

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

```bash
comvenio event area copy --file area-copy.json --json
```

Zuweisungen lösen Event- und Club-ID automatisch über die Area auf:

```bash
comvenio event assignment add <area-id> --member-id <member-id> --json
comvenio event assignment remove <area-id> --member-id <member-id> --json
```

Leitung anlegen:

```json
{"member_id":"<member-id>","title":"Bereichsleitung","is_default":true}
```

```bash
comvenio event lead add <area-id> --file lead.json --json
```

Notizen können direkt gesetzt werden:

```bash
comvenio event area-note add <area-id> --notes "Stromanschluss geprüft" --json
```

### Programm und Kontakte

| Zweck | CLI |
|---|---|
| Programm | `event program list|add|update|delete|reorder` |
| Kontakte | `event contact list|add|update|delete` |

Programmpunkt anlegen:

```bash
comvenio event program add <event-id> \
  --area <area-id> \
  --title "Eröffnung" \
  --start-time 2026-08-15T16:00:00+02:00 \
  --end-time 2026-08-15T16:30:00+02:00 \
  --sort-order 10 \
  --json
```

Ein vollständiger Programm-Payload kann diese Felder enthalten:

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
  "reference_id": "<uuid>",
  "reference_label": "Dartturnier",
  "reference_url": "/club/...",
  "sort_order": 20
}
```

Reihenfolge ändern (`items` enthält die neue Sortierung):

```json
{"items":[{"id":"<program-item-1>","sort_order":10},{"id":"<program-item-2>","sort_order":20}]}
```

```bash
comvenio event program reorder <event-id> --file reorder.json --json
```

Kontakt anlegen:

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

```bash
comvenio event contact add <event-id> --file contact.json --json
```

Kontakt-Enums: `priority` ist `normal`, `important` oder `emergency`;
`visibility` ist `public`, `members` oder `admin`.

### Ressourcen, Anhänge und Tags

| Zweck | CLI |
|---|---|
| Event-Ressourcen | `event resource list|add|set|remove|link-show|link-update|link-delete` |
| Auslastung prüfen | `event resource usage|usage-batch` |
| Anhänge | `event attachment list|show|add|update|delete` |
| Tags | `event tag category-*|list|show|add|update|delete|assigned|assignment-list|assign|unassign|clear` |

Ressourcen-Payload:

```json
{
  "targets": [
    {"target_type":"room","target_id":"<room-id>","event_area_id":"<area-id>"},
    {"target_type":"object","target_id":"<object-id>"}
  ]
}
```

```bash
comvenio event resource add <event-id> --file resources.json --json
comvenio event resource set <event-id> --file resources.json --json
comvenio event resource remove <event-id> --target-type room --target-id <room-id> --json
comvenio event resource usage --target-type room --target-id <room-id> \
  --start <iso> --end <iso> --status planned,confirmed --json
```

`add` ergänzt, `set` ersetzt die gesamte Menge. Die CLI ergänzt `club_id` pro Ziel.

Datei zuerst hochladen, dann fachlich verknüpfen:

```bash
comvenio data upload ./flyer.pdf --context event --context-id <event-id> --json
comvenio event attachment add <event-id> \
  --attachment-type flyer \
  --attachment-id <file-id> \
  --title "Festflyer" \
  --json
```

Anhangstypen: `content`, `counter`, `protocol`, `tournament`, `title_picture`, `flyer`, `news`, `menu`, `shoppinglist`, `canva_embed`.

Tags:

```bash
comvenio event tag category-add --name "Sportart" --json
comvenio event tag add --name "Darts" --category-id <category-id> --json
comvenio event tag assign <event-id> --tag-id <tag-id> --json
comvenio event tag assigned <event-id> --json
```

Bei `tag category-update` und `tag update` lädt die CLI zuerst den bestehenden
Datensatz und ergänzt `club_id` sowie bei Tags die erforderliche `category_id`.
Dadurch funktionieren Teiländerungen sicher mit Flags oder einer Patch-Datei.

### Einladungen und Anmeldungen

| Zweck | CLI |
|---|---|
| Mitglieder einladen | `event invitation mine|list|show|add|groups|departments|org-groups|update|status|delete|notified` |
| Clubs einladen | `event club-invitation list|attending|incoming|accepted|show|add|external|self-join|update|respond|delete` |
| Teilnehmer verwalten | `event registration list|add|stats|show|update|adjust|delete|aggregate` |

Mitglied einladen:

```bash
comvenio event invitation add <event-id> --user-id <user-id> --json
comvenio event invitation status <invitation-id> --status accepted --json
```

Gruppenweise Einladung:

```json
{"event_id":"<event-id>","group_ids":["<group-id>"]}
```

```bash
comvenio event invitation groups --file groups.json --json
```

Für `departments` heißt die Liste `department_ids`, für `org-groups` heißt sie `org_group_ids`.

Comvenio-Club einladen:

```json
{
  "event_id": "<event-id>",
  "invited_club_id": "<club-id>",
  "invitation_type": "public",
  "message": "Wir freuen uns auf euch."
}
```

```bash
comvenio event club-invitation add --file club-invitation.json --json
```

Externen Club per E-Mail einladen:

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

```bash
comvenio event club-invitation external --file external-invitation.json --json
```

Manuelle Anmeldung:

```json
{
  "attendee_count": 3,
  "contact_name": "Erika Beispiel",
  "contact_email": "erika@example.org",
  "contact_phone": "+49...",
  "notes": "Kommt gegen 18 Uhr",
  "orders": [
    {"menu_item_id":"<menu-item-id>","quantity":2,"note":"ohne Zwiebeln"}
  ]
}
```

```bash
comvenio event registration add <event-id> --file registration.json --json
comvenio event registration stats <event-id> --json
```

Admin-Korrektur:

```json
{"admin_adjustment_count":10,"admin_adjustment_reason":"Helfer ohne Online-Anmeldung"}
```

```bash
comvenio event registration adjust <registration-id> --file adjustment.json --json
```

### Sponsoren, Budget, Design, Texte, DJ und externer Spielplan

| Bereich | CLI |
|---|---|
| Event-Sponsoren | `event sponsor list|add|delete|tier-list|tier-add|tier-update|tier-delete|tier-sync` |
| Sponsor und Programmpunkt | `event sponsor-program list|by-program|add|delete` |
| Budget-Link | `event budget show|set|delete` |
| Event-Theme und Assets | `event design theme-show|theme-set|theme-delete|asset-list|asset-upload|asset-delete` |
| Public-Hub-Texte | `event copy set|reset` |
| DJ | `event dj settings|requests|settings-set|request-status|reset` |
| Externer Spielplan | `event external-sync list|add|show|update|delete|matches|run|stats|provider-run` |

Sponsor-Stammdaten werden zuerst über `comvenio sponsor` verwaltet. Danach wird der Advertiser mit dem Event verknüpft:

```bash
comvenio event sponsor add <event-id> \
  --advertiser-id <advertiser-id> \
  --area <area-id> \
  --tier gold \
  --sort-order 10 \
  --json
```

Sponsor mit Programmpunkt verknüpfen:

```bash
comvenio event sponsor-program add <sponsor-link-id> \
  --program-item-id <program-item-id> \
  --label "präsentiert von" \
  --json
```

Theme setzen:

```json
{
  "name": "Sommerfest 2026",
  "base_brief": "Warm, familiär, Vereinsfarben im Mittelpunkt",
  "css_vars": {"--event-primary":"#123456","--event-accent":"#f59e0b"},
  "reference_image_ids": ["<file-id>"],
  "mood_tags": ["sommerlich", "familiär"]
}
```

```bash
comvenio event design theme-set <event-id> --file theme.json --json
comvenio event design asset-upload <event-id> --file ./flyer.png --asset-type FLYER --json
comvenio event design asset-delete <event-id> --asset-id <asset-id> --json
```

Public-Hub-Texte werden schlüsselweise gemergt:

```json
{"copy":{"hero_kicker":"Vereinsfest","program_title":"Unser Programm"}}
```

```bash
comvenio event copy set <event-id> --file copy.json --json
comvenio event copy reset <event-id> --key program_title --json
```

Externe Team-Synchronisation:

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

```bash
comvenio event external-sync add --file sync.json --json
comvenio event external-sync run --json
```

## Geländeplan liegt unter `plan`

Geländepläne sind Event-Funktionalität, aber wegen ihres Umfangs eine eigene CLI-Domäne:

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

`guest.json` enthält `{"name":"Gastverein","logo_file_id":"<file-id-oder-null>"}`;
bei `guest update` sind beide Felder optional.

Weitere Plan-Befehle: `zone list|link|unlink`, `table duplicate`, `detail`, `export`, `illustrate`, `compose`.

## Verbindungen zu anderen CLI-Domänen

| Aufgabe | Richtiger Befehl |
|---|---|
| Dateien/Galerie hochladen | `comvenio data upload ... --context event --context-id <event-id>` |
| Datei fachlich als Flyer/Titelbild verknüpfen | `comvenio event attachment add ...` |
| Sponsor-Stammdaten und Verträge | `comvenio sponsor ...` |
| Sponsor einem Event zuweisen | `comvenio event sponsor add ...` |
| Räume, Gebäude und Objekte verwalten | `comvenio object ...` |
| Buchungen bestätigen oder ablehnen | `comvenio booking ...` |
| Ressource mit Event verknüpfen | `comvenio event resource ...` |
| Aufgaben und Schichten | `comvenio task ...` auf dem Task-Kontext der EventArea |
| Speisekarten | `comvenio menu ...` |
| Speisekarte einem Event-Bereich zuweisen | `comvenio event menu list|assign|unassign` |
| Geländeplan | `comvenio plan ...` |

## Rechte

Die Rechte werden ausschließlich serverseitig geprüft.

| Operation | Recht oder Regel |
|---|---|
| Sichtbare Events lesen | Visibility-Filter; teilweise `view_events` für Katalog-/Serienfunktionen |
| Event/Vorlage/Serie erstellen | `create_events` |
| Event und Unterressourcen verwalten | `manage_events` |
| Eigene Notiz bearbeiten/löschen | Nur der Ersteller |
| Eigene Einladung beantworten | Eigentümer-/Visibility-Regel |
| Plan, Kontakte, Sponsoren, Ressourcen, Design, DJ | `manage_events` |

Ein `403` bedeutet fehlendes Recht. Ein `404` kann bei nicht sichtbaren Daten absichtlich statt `403` erscheinen.

## Bewusst nicht als Club-CLI-Command gespiegelt

| API-Gruppe | Grund |
|---|---|
| `/internal/...` | Service-zu-Service-Vertrag mit internem API-Key. |
| Systemweite Copy-Defaults mutieren | Plattformadministration, nicht Vereinsverwaltung. |
| Rein öffentliche Share-, Public-Hub- und Token-Formular-Routen | Sie verwalten den Club nicht. Admin-Funktionen haben eigene Commands. |
| Kalender-Abos | Der aktuelle Router verarbeitet Standard-JWT direkt und ist noch nicht zuverlässig mit opaken `cvn_`-Tokens kompatibel. Nicht per direktem API-Aufruf umgehen. |
| Legacy-Map-Upsert | Durch die aktuelle `comvenio plan`-Domäne ersetzt. |

## Sicherheitsregeln für Agenten

- Frage vor `delete`, `clear`, `set` mit leerer Liste und `dj reset` nach einer ausdrücklichen Bestätigung, wenn der Nutzer die Löschung nicht bereits klar beauftragt hat.
- Nutze keine fremde Club-ID in JSON-Dateien. Das CLI setzt `club_id` bei eindeutigen Verträgen aus dem Login-Kontext.
- Verwende bei mehrtägigen Festen Programmpunkte am Child-Event. Der Parent zeigt nur das Aggregat.
- Lösche nie die Default-Area.
- Nutze `resource set` nur, wenn die komplette Zielmenge bekannt ist. `resource add` ist additiv.
- Lade Dateien mit `data upload` hoch und verknüpfe sie anschließend mit `event attachment add`.
- Zeige dem Nutzer Namen statt UUIDs, sobald Namen in den Antworten verfügbar sind.
