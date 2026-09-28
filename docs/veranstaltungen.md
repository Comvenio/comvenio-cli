---
id: veranstaltungen
kategorie: thema
domaenen: [event, plan]
stichwoerter: [veranstaltung, event, termin, serie, vorlage, dauertermin, bereich, programm, einladung, anmeldung, sponsor, festtag]
---

# Veranstaltungen

## Wozu

Mit den `event`-Befehlen verwaltest du Veranstaltungen deines Vereins vollständig: von der Vorlage über wiederkehrende Termine und mehrtägige Feste bis zu Bereichen, Programm, Einladungen, Anmeldungen, Sponsoren und Design.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

Nutze vor jeder Event-Arbeit `comvenio schema event --json` und `comvenio event --help`, um Felder und Unterbefehle zu sehen. Anmeldung über `comvenio login`; ohne `--scopes` fordert sie alle Scopes an, `--scopes` schränkt sie ein. Was du tatsächlich darfst, bestimmt zusätzlich deine Rolle im Verein — das Recht wird ausschließlich serverseitig geprüft.

| Operation | Recht oder Regel |
|---|---|
| Sichtbare Events lesen | Sichtbarkeitsfilter; für Katalog- und Serienfunktionen teilweise zusätzlich `view_events` |
| Event, Vorlage oder Serie erstellen | `create_events` |
| Event und Unterressourcen (Bereiche, Programm, Kontakte, Ressourcen, Sponsoren, Design, DJ) verwalten | `manage_events` |
| Eigene Bereichsnotiz bearbeiten oder löschen | nur die Person, die sie angelegt hat |
| Eigene Einladung beantworten | Eigentümer- und Sichtbarkeitsregel |

Ein `403` bedeutet fehlendes Recht. Ein `404` kann bei nicht sichtbaren Daten absichtlich statt `403` erscheinen.

### Sicherheitsregeln für Agenten

- Rufe keine Comvenio-API direkt auf — nutze ausschließlich die `event`-Befehle. Fehlt ein Befehl, muss das CLI erweitert werden.
- Frage vor `delete`, `clear`, `set` mit leerer Liste und `dj reset` nach einer ausdrücklichen Bestätigung, wenn die Löschung nicht bereits klar beauftragt ist.
- Nutze keine fremde Club-ID in JSON-Dateien — `club_id` kommt bei eindeutigen Verträgen aus dem Login-Kontext.
- Lege bei mehrtägigen Festen Programmpunkte am Child-Event an; der Parent zeigt nur das Aggregat.
- Lösche nie die automatisch erzeugte Default-Area.
- Nutze `resource set` nur, wenn die vollständige Zielmenge bekannt ist; `resource add` ist additiv.
- Lade Dateien zuerst mit `data upload` hoch und verknüpfe sie danach mit `event attachment add`.
- Zeige Namen statt Kennungen an, sobald Namen aus den Antworten verfügbar sind.

## Abläufe

### Begriffe

| Begriff | Bedeutung |
|---|---|
| Veranstaltung | Ein konkreter Termin. |
| Vorlage | Ein Event mit `is_template=true`, das nicht als konkreter Termin gilt. |
| Regeltermin | `RECURRING` + `AUTO`, zum Beispiel ein wöchentliches Training. |
| Jährliches Event | `YEARLY_TEMPLATE` + `MANUAL`; der nächste konkrete Termin wird bewusst geplant. |
| Dauertermin | Sammelbegriff für Regeltermine und jährliche Events. |
| Parent-Event | Mehrtägiges Gesamtfest (`event_complexity=multi_day`); es muss öffentlich sein. |
| Child-Event | Ein konkreter Festtag unter einem Parent-Event. |
| Default-Area | Automatisch erzeugter allgemeiner Bereich eines Events; darf nicht gelöscht werden. |
| EventArea | Echter Arbeitsbereich wie Bühne, Bar oder Küche. |
| Attachment | Fachliche Verknüpfung eines bestehenden Datei-, News- oder Menü-Datensatzes mit einem Event. |

Wichtige Werte: `event_type` (`party`, `meeting`, `excursion`, `training`, `competition`, `other`) ·
`visibility_scope` (`public`, `member`, `private`, `department`, `invite_only`) ·
`status` (`draft`, `planned`, `confirmed`, `archived`, `cancelled` — es gibt keinen Status `published`) ·
`organizer_type` (`member`, `external`) · `event_complexity` (`simple`, `multi_day`) ·
`invitation_status` (`invited`, `accepted`, `rejected`, `waitlist`) ·
`club_invitation_status` (`pending`, `accepted`, `declined`, `cancelled`) ·
`resource_target` (`object`, `room`, `building`).

### Vorlage, Serie und Termine materialisieren

1. Vorlage anlegen: `comvenio event template create --title "Darttraining" --event-type training --visibility-scope member --organizer-type member --department-id <department-id> --description "Wöchentliches Training" --json`.
2. Serie aus der Vorlage definieren: `comvenio event series create <template-id> --start-time <iso> --frequency weekly --weekdays WE --duration-minutes 120 --json`.
3. Konkreten Zeitraum materialisieren: `comvenio event series materialize <series-id> --start <iso> --end <iso> --json`. `materialize` ist idempotent und überspringt vorhandene Termine.
4. Für „Ende offen" `--open-end` statt `--duration-minutes` verwenden — das übermittelt ausdrücklich `duration_minutes=null`, die erzeugten Termine haben `end_time=null`. Den Zeitraum der Serie unabhängig davon mit `--until <iso>` begrenzen. Ohne eines der beiden Dauer-Flags bleibt die bisherige Standarddauer bestehen.

### Einzelnes Event anlegen und veröffentlichen

1. Event anlegen: `comvenio event create --file event.json --json` (Flags sind ebenso möglich; Werte aus der Datei ergänzen die Flags).
2. Event lesen oder auflisten: `comvenio event show <event-id>`, `comvenio event list [--month|--start|--end|--complexity]`.
3. Event aktualisieren: `comvenio event update <event-id> --file patch.json --json`.
4. Event veröffentlichen: `comvenio event publish <event-id> [--public]` — setzt `status=confirmed`; mit `--public` zusätzlich `visibility_scope=public`.
5. Event löschen: `comvenio event delete <event-id>`.

### Mehrtägige Feste mit Festtagen

1. Parent-Event mit `event_complexity=multi_day` anlegen; es muss öffentlich sein.
2. Festtage verwalten: `comvenio event child list|create|invitation-summary <parent-id>`.
3. Programmpunkte am jeweiligen Child-Event anlegen — der Parent zeigt nur das Aggregat.
4. Bereiche zwischen Festtagen kopieren: `comvenio event area copy --file area-copy.json --json`.

### Bereiche einrichten, besetzen und dokumentieren

1. Bereich anlegen: `comvenio event area add <event-id> --name "Bühne" --description "Programm und Technik" --color "#7c3aed" --area-category stage --public --json`, oder mehrere in einem Aufruf mit `comvenio event area bulk --file areas.json --json`.
2. Mitglieder zuweisen: `comvenio event assignment add <area-id> --member-id <member-id> --json`; entfernen mit `comvenio event assignment remove <area-id> --member-id <member-id> --json`, leeren mit `clear`; Event- und Club-ID werden automatisch über die Area aufgelöst.
3. Bereichsleitung anlegen: `comvenio event lead add <area-id> --file lead.json --json`.
4. Notiz hinterlegen: `comvenio event area-note add <area-id> --notes "Stromanschluss geprüft" --json`.

### Programm und Kontakte pflegen

1. Programmpunkt anlegen: `comvenio event program add <event-id> --area <area-id> --title "Eröffnung" --start-time <iso> --end-time <iso> --sort-order 10 --json`.
2. Reihenfolge ändern: `comvenio event program reorder <event-id> --file reorder.json --json`.
3. Kontakt anlegen: `comvenio event contact add <event-id> --file contact.json --json`.

### Dateien, Ressourcen und Tags verknüpfen

1. Datei hochladen: `comvenio data upload ./flyer.pdf --context event --context-id <event-id> --json`.
2. Datei fachlich verknüpfen: `comvenio event attachment add <event-id> --attachment-type flyer --attachment-id <file-id> --title "Festflyer" --json`. Anhangstypen: `content`, `counter`, `protocol`, `tournament`, `title_picture`, `flyer`, `news`, `menu`, `shoppinglist`, `canva_embed`.
3. Ressource verknüpfen: `comvenio event resource add <event-id> --file resources.json --json` (ergänzt) oder `comvenio event resource set <event-id> --file resources.json --json` (ersetzt die gesamte Menge); entfernen mit `comvenio event resource remove <event-id> --target-type room --target-id <room-id> --json`. Auslastung prüfen: `comvenio event resource usage --target-type room --target-id <room-id> --start <iso> --end <iso> --status planned,confirmed --json`.
4. Tag-Kategorie und Tag anlegen, dann zuweisen: `comvenio event tag category-add --name "Sportart" --json`, `comvenio event tag add --name "Darts" --category-id <category-id> --json`, `comvenio event tag assign <event-id> --tag-id <tag-id> --json`; zugewiesene Tags ansehen: `comvenio event tag assigned <event-id> --json`.

### Mitglieder und Vereine einladen, Anmeldungen erfassen

1. Mitglied einladen: `comvenio event invitation add <event-id> --user-id <user-id> --json`; Status setzen: `comvenio event invitation status <invitation-id> --status accepted --json`.
2. Gruppenweise einladen: `comvenio event invitation groups --file groups.json --json` (für Abteilungen `departments`/`department_ids`, für Organisationsgruppen `org-groups`/`org_group_ids`).
3. Comvenio-Club einladen: `comvenio event club-invitation add --file club-invitation.json --json`; externen Club per E-Mail: `comvenio event club-invitation external --file external-invitation.json --json`.
4. Manuelle Anmeldung erfassen: `comvenio event registration add <event-id> --file registration.json --json`; Statistik: `comvenio event registration stats <event-id> --json`; Admin-Korrektur: `comvenio event registration adjust <registration-id> --file adjustment.json --json`.

### Sponsoren, Design, Texte, DJ und externen Spielplan pflegen

1. Sponsor-Stammdaten zuerst über `comvenio sponsor` anlegen, danach mit dem Event verknüpfen: `comvenio event sponsor add <event-id> --advertiser-id <advertiser-id> --area <area-id> --tier gold --sort-order 10 --json`.
2. Sponsor mit Programmpunkt verknüpfen: `comvenio event sponsor-program add <sponsor-link-id> --program-item-id <program-item-id> --label "präsentiert von" --json`.
3. Event-Theme setzen und Assets hochladen: `comvenio event design theme-set <event-id> --file theme.json --json`, `comvenio event design asset-upload <event-id> --file ./flyer.png --asset-type FLYER --json`; Asset entfernen: `comvenio event design asset-delete <event-id> --asset-id <asset-id> --json`.
4. Public-Hub-Texte schlüsselweise mergen: `comvenio event copy set <event-id> --file copy.json --json`; einzelnen Schlüssel zurücksetzen: `comvenio event copy reset <event-id> --key program_title --json`.
5. DJ-Einstellungen und -Wünsche verwalten: `comvenio event dj settings|requests|settings-set|request-status|reset`.
6. Externe Team-Synchronisation anlegen und ausführen: `comvenio event external-sync add --file sync.json --json`, danach `comvenio event external-sync run --json`.

### Geländeplan

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

`guest.json` enthält `{"name": "Gastverein", "logo_file_id": "<file-id-oder-null>"}`;
bei `guest update` sind beide Felder optional.

Weitere Plan-Befehle: `zone list|link|unlink`, `table duplicate`, `detail`, `export`, `illustrate`, `compose`.

## Beispiele

Minimaler `event.json`-Vertrag:

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

Zusätzliche Felder beim Anlegen und Aktualisieren sind unter anderem `organizer_member_id`, `external_name`, `external_email`, `has_protocol_support`, `has_counter_support`, `has_purchase_support`, `invitation_mode` und `feature_profile`. Nur beim Aktualisieren verfügbar sind `actual_visitors`, `actual_revenue` und `actual_costs`.

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

Bereichsleitung:

```json
{"member_id": "<member-id>", "title": "Bereichsleitung", "is_default": true}
```

Ein vollständiger Programm-Payload:

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

Reihenfolge ändern (`items` enthält die neue Sortierung):

```json
{"items": [{"id": "<program-item-1>", "sort_order": 10}, {"id": "<program-item-2>", "sort_order": 20}]}
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

`priority` ist `normal`, `important` oder `emergency`; `visibility` ist `public`, `members` oder `admin`.

Ressourcen-Payload — `add` ergänzt, `set` ersetzt die gesamte Menge, die Club-ID wird pro Ziel ergänzt:

```json
{
  "targets": [
    {"target_type": "room", "target_id": "<room-id>", "event_area_id": "<area-id>"},
    {"target_type": "object", "target_id": "<object-id>"}
  ]
}
```

Einladung an Gruppen, Abteilungen oder Organisationsgruppen:

```json
{"event_id": "<event-id>", "group_ids": ["<group-id>"]}
```

Comvenio-Club einladen:

```json
{
  "event_id": "<event-id>",
  "invited_club_id": "<club-id>",
  "invitation_type": "public",
  "message": "Wir freuen uns auf euch."
}
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

Manuelle Anmeldung mit Bestellungen:

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

Admin-Korrektur einer Anmeldung:

```json
{"admin_adjustment_count": 10, "admin_adjustment_reason": "Helfer ohne Online-Anmeldung"}
```

Event-Theme setzen:

```json
{
  "name": "Sommerfest 2026",
  "base_brief": "Warm, familiär, Vereinsfarben im Mittelpunkt",
  "css_vars": {"--event-primary": "#123456", "--event-accent": "#f59e0b"},
  "reference_image_ids": ["<file-id>"],
  "mood_tags": ["sommerlich", "familiär"]
}
```

Public-Hub-Texte werden schlüsselweise gemergt:

```json
{"copy": {"hero_kicker": "Vereinsfest", "program_title": "Unser Programm"}}
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

### Verbindungen zu anderen Bereichen

| Aufgabe | Richtiger Befehl |
|---|---|
| Dateien/Galerie hochladen | `comvenio data upload ... --context event --context-id <event-id>` |
| Datei fachlich als Flyer/Titelbild verknüpfen | `comvenio event attachment add ...` |
| Sponsor-Stammdaten und Verträge | `comvenio sponsor ...` |
| Sponsor einem Event zuweisen | `comvenio event sponsor add ...` |
| Räume, Gebäude und Objekte verwalten | `comvenio object ...` |
| Buchungen bestätigen oder ablehnen | `comvenio booking ...` |
| Ressource mit Event verknüpfen | `comvenio event resource ...` |
| Aufgaben und Schichten | `comvenio task ...` auf dem Task-Kontext des Bereichs |
| Speisekarten | `comvenio menu ...` |
| Speisekarte einem Event-Bereich zuweisen | `comvenio event menu list|assign|unassign` |
| Geländeplan | `comvenio plan ...` |

### Bewusst nicht abgebildet

| Bereich | Grund |
|---|---|
| Systemweite Copy-Defaults ändern | Plattformadministration, nicht Vereinsverwaltung. |
| Rein öffentliche Share-, Public-Hub- und Formularseiten | Sie verwalten den Club nicht; Admin-Funktionen haben eigene Befehle. |
| Kalender-Abos | Für diesen Weg ist der CLI-Anmeldevertrag noch nicht ausgelegt. Nicht per direktem Aufruf umgehen. |
| Alte Geländeplan-Darstellung | Durch die aktuelle `plan`-Domäne ersetzt. |

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**event** — vollständig

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
- Felder und Werte: `comvenio schema event --json`

**plan** — vollständig

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

## Fehler

- `AUTH_REQUIRED` — deine Anmeldung ist abgelaufen oder fehlt, bevor ein Event-Befehl läuft. Siehe `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — die Anmeldung trägt nicht den nötigen Scope für diese Event-Aktion. Siehe `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — deine Rolle im Verein erlaubt zum Beispiel `create_events` oder `manage_events` nicht. Siehe `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — Event, Bereich, Vorlage oder Serie existiert nicht oder ist für dich nicht sichtbar. Siehe `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — ein Pflichtfeld fehlt oder hat das falsche Format, etwa im Event- oder Bereichs-JSON. Siehe `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — ein Bereich, eine Ressource oder ein Termin lässt die Aktion im aktuellen Zustand nicht zu. Siehe `comvenio help fehler CONFLICT`.
- `CONFIRMATION_REQUIRED` — eine kritische Änderung wie das Löschen eines Bereichs muss zuerst bestätigt werden. Siehe `comvenio help fehler CONFIRMATION_REQUIRED`.
