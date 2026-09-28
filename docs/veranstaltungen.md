---
id: veranstaltungen
kategorie: thema
domaenen: [event, plan]
stichwoerter: [veranstaltung, event, termin, serie, vorlage, dauertermin, bereich, programm, einladung, anmeldung, sponsor, festtag]
---

# Veranstaltungen

## Wozu

Mit den `event`-Actions verwaltest du Veranstaltungen deines Vereins vollständig: von der Vorlage über wiederkehrende Termine und mehrtägige Feste bis zu Bereichen, Programm, Einladungen, Anmeldungen, Sponsoren und Design.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen, zeigt `comvenio action list --json`. Felder und Eingaben siehst du auch offline, ohne Anmeldung: `comvenio schema event --json`, `comvenio schema plan --json` und `comvenio help veranstaltungen`. Was du tatsächlich darfst, bestimmt zusätzlich deine Rolle im Verein — das Recht wird ausschließlich serverseitig geprüft.

| Operation | Recht oder Regel |
|---|---|
| Sichtbare Events lesen | Sichtbarkeitsfilter; für Katalog- und Serienfunktionen teilweise zusätzlich `view_events` |
| Event, Vorlage oder Serie erstellen | `create_events` |
| Event und Unterressourcen (Bereiche, Programm, Kontakte, Ressourcen, Sponsoren, Design, DJ) verwalten | `manage_events` |
| Geländeplan verwalten (`plan`) | ebenfalls `manage_events` |
| Eigene Bereichsnotiz bearbeiten oder löschen | nur die Person, die sie angelegt hat |
| Eigene Einladung beantworten | Eigentümer- und Sichtbarkeitsregel |

Ein `403` bedeutet fehlendes Recht. Ein `404` kann bei nicht sichtbaren Daten absichtlich statt `403` erscheinen.

### Sicherheitsregeln für Agenten

- Rufe keine Comvenio-API direkt auf — nutze ausschließlich die freigegebenen `event`- und `plan`-Actions (`comvenio action call …`). Fehlt eine Action, muss das CLI erweitert werden.
- Frage vor `delete`, `remove`, `clear`, `unassign` und vergleichbar kritischen Vorgängen nach einer ausdrücklichen Bestätigung, wenn die Löschung nicht bereits klar beauftragt ist — das CLI selbst verlangt bei diesen Actions ohnehin erst eine Vorschau, danach `comvenio action confirm`.
- Gib `club_id` nie im `--input` an — der Verein kommt aus der Anmeldung, das CLI lehnt `club_id` in der Eingabe ab.
- Lege bei mehrtägigen Festen Programmpunkte am Child-Event an; der Parent zeigt nur das Aggregat.
- Lösche nie die automatisch erzeugte Default-Area.
- Nutze `resource … --input '{"operation":"set", …}'` nur, wenn die vollständige Zielmenge bekannt ist; `operation=add` ist additiv.
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

1. Vorlage anlegen: `comvenio action call cai.event.07.template_list_create_clone_instantiate --input '{"operation":"create","template":{"department_id":"<department-id>","title":"Darttraining","event_type":"training","visibility_scope":"member","organizer_type":"member","description":"Wöchentliches Training"}}'`.
2. Serie aus der Vorlage definieren: `comvenio action call cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n --input '{"operation":"create","series":{"name":"Darttraining Mittwoch","department_id":"<department-id>","event_type":"training","visibility_scope":"member","timezone":"Europe/Berlin","rrule":"FREQ=WEEKLY;BYDAY=WE","dtstart":"2026-01-07T19:00:00+01:00","duration_minutes":120}}'`. Die Wiederholung steht als RRULE in `rrule` (z. B. `FREQ=WEEKLY;BYDAY=WE`), nicht mehr als einzelne Frequenz-/Wochentag-Flags.
3. Konkreten Zeitraum materialisieren: Aufruf ohne Bestätigung liefert eine Vorschau — `comvenio action call cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n --input '{"operation":"materialize","series_id":"<series-id>","range":{"from":"2026-01-01","to":"2026-03-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true}}'`. Preview prüfen, danach `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>`. `materialize` ist idempotent und überspringt vorhandene Termine.

### Einzelnes Event anlegen und veröffentlichen

1. Event anlegen: `comvenio action call cai.event.03.create --input '{"event":{"department_id":"<department-id>","title":"Sommerfest","event_type":"party","visibility_scope":"public","organizer_type":"member","start_time":"2026-08-15T16:00:00+02:00","end_time":"2026-08-16T01:00:00+02:00","description":"Sommerfest am Vereinsheim","location":"Vereinsheim","event_complexity":"simple"}}'`.
2. Event lesen: `comvenio action call cai.event.02.show --input '{"event_id":"<event-id>"}'`. Events auflisten (Zeitraum ist Pflicht): `comvenio action call cai.event.01.list --input '{"range":{"from":"2026-08-01","to":"2026-09-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true},"limit":50}'`.
3. Event aktualisieren: `comvenio action call cai.event.04.update --input '{"event_id":"<event-id>","changes":{"description":"Neuer Text"}}'`.
4. Event veröffentlichen (kritisch — erst Vorschau, dann Bestätigung): `comvenio action call cai.event.05.publish --input '{"event_id":"<event-id>","make_public":true}'`, danach `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>`. `publish` setzt `status=confirmed`; `make_public=true` setzt zusätzlich `visibility_scope=public`.
5. Event löschen (kritisch): `comvenio action call cai.event.06.delete --input '{"event_id":"<event-id>"}'`, danach `comvenio action confirm …`.

### Mehrtägige Feste mit Festtagen

1. Parent-Event mit `event_complexity=multi_day` anlegen (siehe oben); es muss öffentlich sein.
2. Festtage verwalten: `comvenio action call cai.event.27.child_list_create_invitation_summary --input '{"operation":"list","event_id":"<parent-event-id>"}'`, zum Anlegen `--input '{"operation":"create","event_id":"<parent-event-id>","child":{"title":"Samstag","event_type":"party","visibility_scope":"public","organizer_type":"member","start_time":"2026-08-15T16:00:00+02:00","end_time":"2026-08-16T01:00:00+02:00"}}'`.
3. Programmpunkte am jeweiligen Child-Event anlegen — der Parent zeigt nur das Aggregat.
4. Bereiche zwischen Festtagen kopieren (kritisch): `comvenio action call cai.event.09.area_list_add_show_update_delete_bulk_copy --input '{"operation":"copy","source_event_id":"<child-event-id>","target_event_ids":["<other-child-event-id>"]}'`, danach `comvenio action confirm …`.

### Bereiche einrichten, besetzen und dokumentieren

1. Bereich anlegen: `comvenio action call cai.event.09.area_list_add_show_update_delete_bulk_copy --input '{"operation":"add","event_id":"<event-id>","area":{"name":"Bühne","description":"Programm und Technik","color":"#7c3aed","is_public":true,"area_category":"stage"}}'`, oder mehrere in einem Aufruf (kritisch) mit `operation=bulk` und `areas`. Bereichsfelder sind `name`, `description`, `color`, `is_public`, `public_description` und `area_category`; ob ein Bereich die Default-Area ist, entsteht automatisch beim Event und lässt sich über die Action nicht setzen.
2. Bereich ändern: `operation=update` mit `area_id` und `changes`. Bereich löschen (kritisch): `operation=delete` mit `area_id`, danach `comvenio action confirm …`.
3. Mitglieder zuweisen: `comvenio action call cai.event.10.assignment_list_add_remove_clear --input '{"operation":"add","area_id":"<area-id>","event_id":"<event-id>","member_id":"<member-id>"}'`; entfernen (kritisch) mit `operation=remove` und `member_id`, leeren (kritisch) mit `operation=clear`.
4. Bereichsleitung anlegen: `comvenio action call cai.event.11.lead_list_add_update_delete --input '{"operation":"add","area_id":"<area-id>","lead":{"member_id":"<member-id>","role":"Bereichsleitung"}}'`.
5. Notiz hinterlegen: `comvenio action call cai.event.12.area_note_list_add_update_delete --input '{"operation":"add","area_id":"<area-id>","note":{"content":"Stromanschluss geprüft","is_public":false}}'`. Notizen auflisten braucht `limit` und `offset`: `--input '{"operation":"list","area_id":"<area-id>","limit":20,"offset":0}'`.

### Programm und Kontakte pflegen

1. Programmpunkt anlegen: `comvenio action call cai.event.13.program_list_add_update_delete_reorder --input '{"operation":"add","event_id":"<event-id>","item":{"title":"Eröffnung","description":"Begrüßung durch den Vorstand","start_time":"2026-08-15T18:00:00+02:00","end_time":"2026-08-15T18:15:00+02:00","location":"Hauptbühne","sort_order":10}}'`.
2. Reihenfolge ändern (kritisch): `--input '{"operation":"reorder","event_id":"<event-id>","item_ids":["<program-item-1>","<program-item-2>"]}'` — `item_ids` trägt die neue Reihenfolge, danach `comvenio action confirm …`.
3. Kontakt anlegen: `comvenio action call cai.event.14.contact_list_add_update_delete --input '{"operation":"add","event_id":"<event-id>","contact":{"name":"Max Mustermann","role":"Technik","email":"max@example.org","phone_number":"+49...","is_public":false}}'`.

### Dateien, Ressourcen und Tags verknüpfen

1. Eine Datei zunächst über die Datei-Actions hochladen (siehe eigener Artikel „Dateien"), danach fachlich verknüpfen: `comvenio action call cai.event.16.attachment_list_show_add_update_delete --input '{"operation":"add","event_id":"<event-id>","attachment":{"file_id":"<file-id>","attachment_type":"flyer","title":"Festflyer","is_public":true}}'`. Gebräuchliche Anhangstypen: `content`, `counter`, `protocol`, `tournament`, `title_picture`, `flyer`, `news`, `menu`, `shoppinglist`, `canva_embed`.
2. Ressource verknüpfen: `operation=add` ergänzt (`resource*:object` mit `target_type`, `target_id`, optional `quantity`/`notes`), `operation=set` ersetzt die gesamte Menge (`resources*:array`); entfernen (kritisch) mit `operation=remove` und `target_type`/`target_id`. Auslastung prüfen: `operation=usage` mit `target_type`, `target_id`, `range`, optional `status`.
3. Tag-Kategorie und Tag anlegen, dann zuweisen: `comvenio action call cai.event.17.tag_category_and_assignment_workflows --input '{"operation":"category_add","category":{"name":"Sportart"}}'`, `--input '{"operation":"tag_add","tag":{"name":"Darts","category_id":"<category-id>"}}'`, `--input '{"operation":"assign","event_id":"<event-id>","tag_id":"<tag-id>"}'`; zugewiesene Tags ansehen mit `operation=assigned`. `category_update` und `tag_update` erwarten die vollständigen Teiländerungen in `changes`.

### Mitglieder und Vereine einladen, Anmeldungen erfassen

1. Mitglied einladen: `comvenio action call cai.event.19.invitation_and_club_invitation_workflows --input '{"operation":"member_add","invitation":{"event_id":"<event-id>","member_id":"<member-id>"}}'`; Status setzen: `--input '{"operation":"member_status","invitation_id":"<invitation-id>","status":"accepted"}'`.
2. Gruppenweise einladen: `--input '{"operation":"member_add_groups","event_id":"<event-id>","group_ids":["<group-id>"]}'` (für Abteilungen `member_add_departments`/`department_ids`, für Organisationsgruppen `member_add_org_groups`/`organization_group_ids`).
3. Comvenio-Club einladen: `--input '{"operation":"club_add","event_id":"<event-id>","invited_club_id":"<club-id>","invitation_type":"public","message":"Wir freuen uns auf euch."}'`; externen Club per E-Mail einladen (kritisch): `--input '{"operation":"club_external","event_id":"<event-id>","external_email":"kontakt@example.org","external_club_name":"Dartfreunde Beispiel","invitation_type":"public"}'`, danach `comvenio action confirm …`.
4. Manuelle Anmeldung erfassen: `--input '{"operation":"add","event_id":"<event-id>","registration":{"participant_count":3,"notes":"Kommt gegen 18 Uhr"}}'` über `cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate`; Statistik mit `operation=stats`; Admin-Korrektur (kritisch) mit `operation=adjust`, `registration_id`, `participant_count`, `reason`.

### Sponsoren, Design, Texte, DJ und externen Spielplan pflegen

1. Sponsor-Stammdaten legst du über die Sponsoring-Actions an (siehe eigener Artikel); die Verknüpfung mit dem Event läuft über `comvenio action call cai.event.18.sponsor_and_sponsor_program_workflows --input '{"operation":"link_add","event_id":"<event-id>","link":{"sponsor_id":"<sponsor-id>","tier":"gold"}}'`.
2. Sponsor mit Programmpunkt verknüpfen: `--input '{"operation":"program_add","link_id":"<sponsor-link-id>","item_id":"<program-item-id>"}'`.
3. Event-Theme setzen: `comvenio action call cai.event.22.design_theme_and_asset_workflows --input '{"operation":"theme_set","event_id":"<event-id>","theme":{"primary_color":"#123456","accent_color":"#f59e0b","font_family":"Inter"}}'`. Asset hochladen (kritisch, Datei vorher über die Datei-Actions hochladen): `--input '{"operation":"asset_upload","event_id":"<event-id>","file_id":"<file-id>","asset_type":"FLYER"}'`, danach `comvenio action confirm …`; Asset entfernen ebenfalls kritisch mit `operation=asset_delete`.
4. Public-Hub-Texte schlüsselweise mergen: `comvenio action call cai.event.23.copy_set_reset --input '{"operation":"set","event_id":"<event-id>","values":{"hero_kicker":"Vereinsfest","program_title":"Unser Programm"}}'`; einzelnen Schlüssel zurücksetzen (kritisch): `--input '{"operation":"reset","event_id":"<event-id>","key":"program_title"}'`.
5. DJ-Einstellungen und -Wünsche: `comvenio action call cai.event.24.dj_settings_and_request_workflows --input '{"operation":"settings","event_id":"<event-id>"}'`, Wünsche mit `operation=requests`, Einstellungen ändern mit `operation=settings_set`, Wunsch-Status mit `operation=request_status` und `status` (`played`, `rejected`, `pending`), zurücksetzen (kritisch) mit `operation=reset`.
6. Externe Team-Synchronisation anlegen und ausführen: `comvenio action call cai.event.25.external_sync_workflows --input '{"operation":"add","sync":{"provider_id":"nuliga_tennis","external_club_id":"<provider-club-id>"}}'`, danach ausführen (kritisch) mit `operation=run`, danach `comvenio action confirm …`.

### Geländeplan

Geländepläne sind Event-Funktionalität, aber wegen ihres Umfangs eine eigene Action-Domäne. Lesende und einfach schreibende Vorgänge (`list`, `show`, `create`, `update`, `link`, `duplicate`) laufen direkt; kritische Vorgänge (`delete`, `unlink`, `export`, `illustrate`, `compose`) liefern erst eine Vorschau, dann `comvenio action confirm --preview-id … --confirmation-token … --idempotency-key …`.

```bash
comvenio action call cai.plan.01.list --input '{"event_id":"<event-id>"}'
comvenio action call cai.plan.03.create --input '{"event_id":"<event-id>","plan":{"name":"Hauptgelände"}}'
comvenio action call cai.plan.04.update --input '{"plan_id":"<plan-id>","changes":{"name":"Hauptgelände Nord"}}'
comvenio action call cai.plan.05.delete --input '{"plan_id":"<plan-id>"}'   # kritisch

comvenio action call cai.plan.06.zone_list_create_update_delete_link_unlink \
  --input '{"operation":"create","plan_id":"<plan-id>","zone":{"name":"Festzelt","length_m":20,"width_m":10}}'

comvenio action call cai.plan.07.table_create_duplicate_update_delete \
  --input '{"operation":"create","table":{"event_id":"<event-id>","capacity":8,"length_m":2.2,"width_m":0.8}}'

comvenio action call cai.plan.08.marker_create_update_delete \
  --input '{"operation":"create","marker":{"event_id":"<event-id>","marker_type":"parking","label":"Parken"}}'

comvenio action call cai.plan.09.guest_list_add_update_delete \
  --input '{"operation":"add","event_id":"<event-id>","guest":{"name":"Gastverein"}}'

comvenio action call cai.plan.10.detail --input '{"zone_id":"<zone-id>","detail_plan":{"name":"Zeltplan Detail"}}'
comvenio action call cai.plan.11.export --input '{"event_id":"<event-id>","format":"pdf","hide_zone_ids":[],"hide_marker_ids":[],"hide_tables":false,"hide_labels":false}'   # kritisch
```

## Beispiele

Event-Objekt beim Anlegen (`event`-Feld von `cai.event.03.create`):

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

Weitere Felder sind unter anderem `organizer_member_id`, `external_name`, `external_email`, `has_protocol_support`, `has_counter_support`, `has_purchase_support` und `feature_profile`. `status` lässt sich nur beim Aktualisieren setzen.

Mehrere Bereiche in einem Aufruf (`cai.event.09…`, `operation=bulk`, kritisch):

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

Bereichsleitung (`lead`-Feld):

```json
{"member_id": "<member-id>", "role": "Bereichsleitung"}
```

Programmpunkt (`item`-Feld von `cai.event.13…`, `operation=add`):

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

Reihenfolge ändern (`item_ids` trägt die neue Sortierung):

```json
{"operation": "reorder", "event_id": "<event-id>", "item_ids": ["<program-item-1>", "<program-item-2>"]}
```

Kontakt (`contact`-Feld):

```json
{
  "name": "Max Mustermann",
  "role": "Technik",
  "phone_number": "+49...",
  "email": "max@example.org",
  "is_public": false
}
```

Ressourcen-Payload — `operation=add` ergänzt, `operation=set` ersetzt die gesamte Menge:

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

Einladung an Gruppen, Abteilungen oder Organisationsgruppen:

```json
{"operation": "member_add_groups", "event_id": "<event-id>", "group_ids": ["<group-id>"]}
```

Comvenio-Club einladen:

```json
{
  "operation": "club_add",
  "event_id": "<event-id>",
  "invited_club_id": "<club-id>",
  "invitation_type": "public",
  "message": "Wir freuen uns auf euch."
}
```

Externen Club per E-Mail einladen (kritisch):

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

Manuelle Anmeldung:

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

Admin-Korrektur einer Anmeldung (kritisch):

```json
{"operation": "adjust", "registration_id": "<registration-id>", "participant_count": 10, "reason": "Helfer ohne Online-Anmeldung"}
```

Event-Theme setzen:

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

Public-Hub-Texte werden schlüsselweise gemergt:

```json
{"operation": "set", "event_id": "<event-id>", "values": {"hero_kicker": "Vereinsfest", "program_title": "Unser Programm"}}
```

Externe Team-Synchronisation anlegen:

```json
{"operation": "add", "sync": {"provider_id": "nuliga_tennis", "external_club_id": "<provider-club-id>", "active": true}}
```

Geländeplan-Zone:

```json
{"operation": "create", "plan_id": "<plan-id>", "zone": {"name": "Festzelt", "length_m": 20, "width_m": 10}}
```

### Verbindungen zu anderen Bereichen

| Aufgabe | Wo |
|---|---|
| Dateien/Galerie hochladen | eigener Artikel „Dateien" |
| Datei fachlich als Flyer/Titelbild verknüpfen | `cai.event.16…`, `operation=add` |
| Sponsor-Stammdaten und Verträge | eigener Artikel „Sponsoring" |
| Sponsor einem Event zuweisen | `cai.event.18…`, `operation=link_add` |
| Räume, Gebäude und Objekte verwalten | eigener Artikel „Buchungen und Objekte" |
| Buchungen bestätigen oder ablehnen | eigener Artikel „Buchungen und Objekte" |
| Ressource mit Event verknüpfen | `cai.event.15…` |
| Aufgaben und Schichten | eigener Artikel „Aufgaben" auf dem Bereichs-Kontext |
| Speisekarten | eigener Artikel „Speisekarten" |
| Speisekarte einem Event-Bereich zuweisen | `cai.event.28.menu_list_assign_unassign` |
| Geländeplan | `cai.plan…` |

### Bewusst nicht abgebildet

| Bereich | Grund |
|---|---|
| Systemweite Copy-Defaults ändern | Plattformadministration, nicht Vereinsverwaltung. |
| Rein öffentliche Share-, Public-Hub- und Formularseiten | Sie verwalten den Club nicht; Admin-Funktionen haben eigene Actions. |
| Kalender-Abos | Für diesen Weg ist der Anmeldevertrag noch nicht ausgelegt. Nicht per direktem Aufruf umgehen. |
| Alte Geländeplan-Darstellung | Durch die aktuelle `plan`-Domäne ersetzt. |

## Befehle und Actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Fehler

- `AUTH_REQUIRED` — deine Anmeldung ist abgelaufen oder fehlt, bevor eine Event- oder Plan-Action läuft. Siehe `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — die Anmeldung trägt nicht den nötigen Scope für diese Action. Siehe `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — deine Rolle im Verein erlaubt zum Beispiel `create_events` oder `manage_events` nicht. Siehe `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — Event, Bereich, Vorlage, Serie oder Plan existiert nicht oder ist für dich nicht sichtbar. Siehe `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — ein Pflichtfeld fehlt oder hat das falsche Format in der Eingabe. Siehe `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — ein Bereich, eine Ressource oder ein Termin lässt die Aktion im aktuellen Zustand nicht zu. Siehe `comvenio help fehler CONFLICT`.
- `CONFIRMATION_REQUIRED` — eine kritische Action wie das Löschen eines Bereichs braucht zuerst `comvenio action confirm` mit der Vorschau. Siehe `comvenio help fehler CONFIRMATION_REQUIRED`.
- `OUTCOME_UNKNOWN` — eine schreibende Action hat nach der Bestätigung nicht rechtzeitig geantwortet; Stand prüfen statt wiederholen. Siehe `comvenio help fehler OUTCOME_UNKNOWN`.
- `OAUTH_ONLY` — nur wenn ein alter, klassischer Befehl statt einer Action verwendet wird. Siehe `comvenio help fehler OAUTH_ONLY`.
