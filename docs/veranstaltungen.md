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

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen, zeigt `comvenio action list --json`. Die Felder eines Bereichs zeigt `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"event"}'`; offline, ohne Anmeldung, hilft `comvenio help veranstaltungen`. Was du tatsächlich darfst, bestimmt zusätzlich deine Rolle im Verein — das Recht wird ausschließlich serverseitig geprüft.

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

1. Sponsor-Stammdaten legst du über die Sponsoring-Actions an (siehe eigener Artikel); die Verknüpfung mit dem Event läuft über `comvenio action call cai.event.18.sponsor_and_sponsor_program_workflows --input '{"operation":"link_add","event_id":"<event-id>","link":{"advertiser_id":"<advertiser-id>","tier":"gold"}}'`.
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

## Begriffe und Zusammenhänge

- **Veranstaltung** — Ein konkreter Termin.
- **Vorlage** — Ein Event mit `is_template=true`, das nicht als konkreter Termin gilt.
- **Regeltermin** — `RECURRING` + `AUTO`, zum Beispiel ein wöchentliches Training.
- **Jährliches Event** — `YEARLY_TEMPLATE` + `MANUAL`; der nächste konkrete Termin wird bewusst geplant.
- **Dauertermin** — Sammelbegriff für Regeltermine und jährliche Events.
- **Parent-Event** — Mehrtägiges Gesamtfest (`event_complexity=multi_day`); es muss öffentlich sein.
- **Child-Event** — Ein konkreter Festtag unter einem Parent-Event.
- **Default-Area** — Automatisch erzeugter allgemeiner Bereich eines Events; darf nicht gelöscht werden.
- **EventArea** — Echter Arbeitsbereich wie Bühne, Bar oder Küche.
- **Attachment** — Fachliche Verknüpfung eines bestehenden Datei-, News- oder Menü-Datensatzes mit einem Event.
- **Serie** — die Regel, nach der aus einer Vorlage wiederkehrende Termine entstehen (RRULE in
  `rrule`, etwa `FREQ=WEEKLY;BYDAY=WE`). Eine Serie selbst ist kein Termin; erst `materialize`
  legt die konkreten Veranstaltungen für einen Zeitraum an.
- **Bereich** — Oberbegriff für Default-Area und EventArea: der Ort innerhalb einer
  Veranstaltung, an dem Mitglieder eingeteilt, Leitungen benannt und Notizen hinterlegt werden.

Wichtige Werte: `event_type` (`party`, `meeting`, `excursion`, `training`, `competition`, `other`) ·
`visibility_scope` (`public`, `member`, `private`, `department`, `invite_only`) ·
`status` (`draft`, `planned`, `confirmed`, `archived`, `cancelled` — es gibt keinen Status `published`) ·
`organizer_type` (`member`, `external`) · `event_complexity` (`simple`, `multi_day`) ·
`invitation_status` (`invited`, `accepted`, `rejected`, `waitlist`) ·
`club_invitation_status` (`pending`, `accepted`, `declined`, `cancelled`) ·
`resource_target` (`object`, `room`, `building`).

Zusammenhang: Vorlage → Serie → materialisierte Termine; ein Parent-Event bündelt Child-Events,
und jede Veranstaltung trägt ihre Bereiche, ihr Programm, Einladungen und Anmeldungen.

Abgrenzung: Ein **Turnier** ist keine Veranstaltung. Es wird im Artikel „Turniere“ als
Ausführung einer Turnierserie angelegt und kann optional mit einem Termin verknüpft werden. Auch
eine **Sitzung** mit Protokoll, Tagesordnung und Beschlüssen gehört nicht hierher, sondern zum
Artikel „Meetings“; sie hängt an einem konkreten Veranstaltungstermin, ihr Inhalt lebt aber im
Protokoll.

## Häufige Fragen

**Ist eine Vorlage schon ein Termin?**
Nein. Eine Vorlage (`is_template=true`) beschreibt, wie ein Termin aussehen soll. Termine entstehen
erst aus einer Serie mit `materialize` oder als einzelnes Event mit `cai.event.03.create`.

**Warum finde ich keinen Status `published`?**
Den gibt es nicht. Veröffentlichen (`cai.event.05.publish`) setzt `status=confirmed`; mit
`make_public=true` wird die Veranstaltung zusätzlich öffentlich (`visibility_scope=public`).

**Wo lege ich das Programm eines mehrtägigen Festes an?**
Am jeweiligen Child-Event, also am Festtag. Das Parent-Event zeigt nur das Aggregat aller Festtage.

**Ist ein Turnier eine Veranstaltung mit `event_type=competition`?**
Nein. Turniere verwaltest du über die `tournament`-Actions als Ausführung einer Turnierserie.
Ein Termin mit `event_type=competition` ist nur ein Kalendereintrag; eine Turnier-Ausführung lässt
sich mit einem solchen Termin verknüpfen.

**Darf ich die Default-Area löschen?**
Nein. Sie entsteht automatisch mit jeder Veranstaltung und bleibt bestehen; eigene Bereiche wie
Bühne oder Bar legst du zusätzlich als EventArea an.

## So geht's in der Web-App

<!-- gen:docs web-app -->

### Abschnitt „Dabei sein"

Menüpfad: Web-App → Abschnitt „Dabei sein" (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Sich anmelden — offen für alle oder nur mit Einladung.

- Ändern der Zahl der Begleitpersonen → setzt, wie viele mitkommen
- Klick auf die Anmeldung → meldet an — mit Begleitpersonen und, falls vorhanden, dem Einladungsmerkmal

### Abschnitt „Auf dem Fest"

Menüpfad: Web-App → Abschnitt „Auf dem Fest" (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Was gibt es auf dem Gelände — Bühnen, Stände, Treffpunkte?

- Klick auf eine Bereichskarte → öffnet die Bereichsseite (führt zu: „Bereich (öffentlich)“)

### Abschnitt „Momente"

Menüpfad: Web-App → Abschnitt „Momente" (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Was Gäste vom Fest zeigen und erzählen.

- Klick auf den Beitragsknopf → öffnet die Eingabe für einen Gästebeitrag

### Abschnitt „Galerie"

Menüpfad: Web-App → Abschnitt „Galerie" (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Die Bilder vom Fest.

- Klick auf ein Bild → öffnet die Grossansicht

### Abschnitt „Geländeplan"

Menüpfad: Web-App → Abschnitt „Geländeplan" (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Wo ist was — und wo sitze ich?

- Wahl eines Plans → zeigt diesen Plan
- Klick auf eine Zone mit eigenem Detailplan → zeigt den Detailplan dieser Zone
- Wahl eines Gastes in der Suche → hebt dessen Zone hervor und markiert die zugehörigen Tische

### Abschnitt „Aktuelles"

Menüpfad: Web-App → Abschnitt „Aktuelles" (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Was gibt es Neues zur Veranstaltung?

- Klick auf eine Beitragskarte → klappt den vollen Text auf

### Abschnitt „Programm"

Menüpfad: Web-App → Abschnitt „Programm" (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Was findet wann statt?

- Klick auf einen Programmpunkt → öffnet die Einzelheiten — Beschreibung und Partner
- Klick auf den Verweis eines Programmpunkts → führt zum hinterlegten Ziel (führt zu: wechselnd)

### Abschnitt „Entdecken"

Menüpfad: Web-App → Abschnitt „Entdecken" (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Der Einstieg: Was läuft gerade, was kommt gleich, und — bei einem Fest — welche Tage gibt es?

- Klick auf einen Festtag → öffnet die öffentliche Seite dieses Tages (führt zu: „Öffentlicher Event-Hub“)

### Planer — Arbeitsplatz eines Bereichs

Menüpfad: Web-App → Planer — Arbeitsplatz eines Bereichs (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Kein eigener Abschnitt der Schiene, sondern eine Ebene tiefer: Wer in „Bereiche" einen Arbeitsort öffnet, landet hier. Einbettung an genau einer Stelle — PlannerBereichePage.tsx:423.

- der Knopf „Zurück zu Bereiche-Liste" → schliesst den Arbeitsplatz und zeigt wieder die Bereichsliste
- ein Eintrag der Schiene → wechselt den Inhalt rechts; die Wahl liegt beim Aufrufer
- „Speichern" → schreibt den Bereich; Zeiten nur, wenn er öffentlich ist, sonst werden beide auf leer gesetzt
- „Lösch-Job starten" im rot umrandeten Block → reicht den Bereich an den Aufrufer weiter, der den Auftrag stellt
- „Hinzufügen" nach Wahl eines Mitglieds → legt die Leitung an; die erste wird automatisch hauptverantwortlich
- „Als Haupt setzen" an einer Zeile → macht diese Leitung zur hauptverantwortlichen
- das Papierkorb-Zeichen → entfernt die Leitung ohne Rückfrage
- „Zuweisen" → weist das gewählte Mitglied dem Bereich zu
- das Papierkorb-Zeichen → hebt die Zuweisung auf, ohne Rückfrage
- „Neue Person" — oder der Eintrag im leeren Suchergebnis („Keine passende Person — lege unten eine neue an.") → öffnet einen Dialog „Neue Person anlegen"; nach dem Anlegen wird die Person sofort diesem Bereich zugewiesen

### Planer — Bereich: Live-Feed

Menüpfad: Web-App → Planer — Bereich: Live-Feed (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Kurze Meldungen während des Fests, die zu diesem einen Arbeitsort gehören — „Bier alle", „Auftritt verschiebt sich um zwanzig Minuten". Es ist kein Beitragswesen, sondern ein Funkkanal.

- eines der Merkzeichen über dem Feld → ordnet die Meldung einer Art zu (Voreinstellung „info")
- der Schalter neben den Kategorien → die Meldung wird beim Absenden gleich angepinnt
- „Senden" → schreibt die Meldung in den Kanal und leert das Feld
- das Pin-Zeichen an einer Meldung → pinnt sie an oder löst den Pin
- das Papierkorb-Zeichen → entfernt die Meldung ohne Rückfrage

### Planer — Bereich: Titelbild, Flyer und Galerie

Menüpfad: Web-App → Planer — Bereich: Titelbild, Flyer und Galerie (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Alles Bildmaterial, das nur zu diesem Arbeitsort gehört: ein Titelbild, beliebig viele Flyer (auch PDF) und die Galerie. Je Datei wird hier entschieden, ob sie im öffentlichen Hub erscheint.

- „Alle teilen" → öffnet die Bereichsauswahl für Titelbild und alle Flyer zusammen
- der Knopf am Titelbild, oder eine Datei darauf ziehen → ersetzt das bisherige Titelbild
- der Teilen-Knopf am Titelbild → öffnet die Bereichsauswahl für dieses eine Bild
- das Augen-Symbol → schaltet zwischen öffentlich und privat
- das Papierkorb-Symbol → fragt nach und entfernt das Bild dann unwiderruflich
- „Von diesem Bereich lösen" → nimmt dieses Bild aus diesem Bereich heraus, ohne es zu löschen
- der Knopf oder Ziehen auf die Ablage → lädt eine oder mehrere Dateien; die Bereichsfrage kommt auch hier vorher
- „Alle teilen" im Kopf der Flyer-Ablage → wendet sämtliche Flyer auf die gewählten Bereiche an
- das Augen-Symbol an einer Kachel → schaltet diese Datei öffentlich oder privat
- das Papierkorb-Symbol → fragt nach („*Dateiname* wird unwiderruflich entfernt.") und löscht dann
- ein Klick auf ein Bild → zeigt es gross, mit einem Schliessen-Zeichen

### Bereich (öffentlich)

Menüpfad: Web-App → Bereich (öffentlich) (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Was gibt es an dieser Bühne, an diesem Stand, in diesem Zelt?

- Klick auf ein Bild oder einen Flyer → öffnet die Grossansicht

### Musikwünsche (Gästeseite)

Menüpfad: Web-App → Musikwünsche (Gästeseite) (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Einen Titel wünschen — oder dem Wunsch eines anderen zustimmen.

- Tippen im Suchfeld → sucht im Titelkatalog
- Klick auf das Abspielzeichen eines Treffers → spielt die Hörprobe
- Klick auf einen Katalogtreffer → legt den Wunsch an
- Klick auf das Herz bei einem Wunsch → gibt eine Stimme oder nimmt sie zurück

### DJ-Verwaltung

Menüpfad: Web-App → DJ-Verwaltung (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Was die Gäste sich wünschen — und was davon gespielt wird.

- Umlegen eines der vier Schalter → speichert die Einstellung sofort
- Klick auf die Zusage bei einem Wunsch → markiert den Titel als gespielt
- Klick auf die Absage bei einem Wunsch → lehnt den Wunsch ab
- Klick auf das Zurücksetzen → leert die Wunschliste des Festtags
- Klick auf den Code-Knopf → zeigt den Code, über den Gäste zur Wunschseite kommen
- Klick auf „Gästeseite öffnen" → zeigt, was die Gäste sehen (führt zu: „Musikwünsche (Gästeseite)“)
- Klick auf den Monitor-Weg → öffnet die Anzeige für den Bildschirm neben der DJ-Kabine (führt zu: „Live-Monitor“)

### Event-Einstieg

Menüpfad: Web-App → Event-Einstieg (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Entscheiden, welche der fünf Event-Oberflächen jemand zu sehen bekommt.

- Betreten des öffentlichen Eingangs bei zusammengesetzter Veranstaltung, ohne Anmeldung, oder über einen der vier Sonderwege → zeigt den immersiven öffentlichen Hub (führt zu: „Öffentlicher Event-Hub“)
- Betreten des öffentlichen Eingangs bei einer einfachen Veranstaltung, angemeldet → zeigt die schlanke Detailansicht im Vereinsgewand (führt zu: „Termin — die Ansicht im Vereinsgewand“)
- Betreten des Verwaltungseingangs mit Berechtigung, bei zusammengesetzter Veranstaltung → zeigt den Event-Planer (führt zu: „Event-Planer“)
- Betreten des Verwaltungseingangs mit Berechtigung, bei einfacher Veranstaltung → zeigt die schlanke Verwaltungsansicht (führt zu: „Termin verwalten“)
- Betreten des Verwaltungseingangs einer Kind-Veranstaltung → leitet zur Verwaltung des Elternteils um (führt zu: „Event-Einstieg“)
- Betreten des Verwaltungseingangs ohne Verwaltungsrecht, aber mit Helfer-Zugang → leitet zum Helfer-Hub um (führt zu: „Helfer-Hub“)
- Betreten eines geschützten Eingangs ohne Anmeldung, oder ohne Verwaltungsrecht und ohne Helfer-Zugang → leitet auf die öffentliche Seite um (führt zu: „Öffentlicher Event-Hub“)
- Betreten des Helfer-Eingangs → zeigt den Helfer-Hub (führt zu: „Helfer-Hub“)

### Helfer-Hub

Menüpfad: Web-App → Helfer-Hub (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Was habe ich zu tun, wann, und wo?

- Klick auf einen der drei Abschnitte → zeigt dessen Inhalt
- Wahl einer Veranstaltung oder „alle" → schränkt Schichten und Aufgaben auf einen Festtag ein
- Wahl einer Phase im Aufgabenabschnitt → zeigt nur Aufgaben dieser Phase
- Klick auf den Weg zur öffentlichen Seite → verlässt den Helfer-Hub (führt zu: „Öffentlicher Event-Hub“)
- Klick auf den Weg zur Planung → öffnet die Verwaltung der Veranstaltung (führt zu: „Event-Einstieg“)

### Live-Monitor

Menüpfad: Web-App → Live-Monitor (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Eine Fläche, die niemand bedient: Sie läuft auf einem Beamer oder Fernseher und zeigt, was gerade passiert — Gästebeiträge, Live-Ticker und die Musikwarteschlange. Dunkler Grund, grosse Schrift, automatischer Wechsel.

- die Umschalter „Rotation" und „Grid" → wechselt zwischen einem grossen Beitrag und bis zu drei nebeneinander
- die Marken 1, 2, 3, 5, 10 hinter der Aufschrift „Letzte" → begrenzt, wie viele der neuesten Beiträge gezeigt werden
- das Vollbildsymbol rechts → schaltet den Browser in den Vollbildmodus und zurück

### Momente-Seite

Menüpfad: Web-App → Momente-Seite (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Ein Gast scannt einen Code am Tisch und will einen Moment teilen.

- Klick auf den Beitragsknopf — oben rechts oder schwebend → öffnet die Eingabe

### Öffentlicher Event-Hub

Menüpfad: Web-App → Öffentlicher Event-Hub (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Die Veranstaltung so zeigen, wie Gäste sie sehen sollen — im Gewand der Veranstaltung, nicht der Plattform.

- Klick auf einen Eintrag der Schiene → rollt zum Abschnitt
- Klick auf das Menüzeichen → öffnet die vollständige Abschnittsliste

### Offene Schichten

Menüpfad: Web-App → Offene Schichten (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Wo werden noch Leute gebraucht — und wie trage ich mich ein?

- Klick auf den Eintragen-Knopf einer Zeile → trägt die eigene Person für die Schicht ein

### Event-Planer

Menüpfad: Web-App → Event-Planer (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Der Arbeitsplatz für ein Fest. Er legt sich als eigene Ebene über die Anwendung (position: fixed, ganzer Bildschirm) und hält drei Dinge zusammen: die Kopfleiste mit Zustand und Aussenwegen, die Hierarchiekarte für den Festtag, und darunter Schiene plus den gewählten Abschnitt.

- Knopf „Zurück zum Verein" → verlässt den Planer und kehrt in den Vereinsbereich zurück
- Knopf „Worker Hub" → verlässt den Planer und zeigt die Helferoberfläche (führt zu: „Helfer-Hub“)
- Knopf „Public-Vorschau" → öffnet die öffentliche Seite in einem neuen Fenster (führt zu: „Öffentlicher Event-Hub“)
- Knopf „Veröffentlichen" → setzt die Veranstaltung auf bestätigt — und bei einem mehrtägigen Elternteil zusätzlich alle Festtage, die noch Entwurf sind
- Knopf „Mit veröffentlichen" → setzt alle Entwurfs-Festtage auf bestätigt
- Lupensymbol rechts in der Kopfleiste → keine — der Knopf trägt keine Rückmeldung und tut nichts
- Glockensymbol rechts in der Kopfleiste → keine — wie die Lupe ohne Rückmeldung und ohne Beschriftung
- Kachel „Gesamtes Fest" in der Hierarchiekarte → hebt die Wahl des Festtags auf; die Abschnitte arbeiten danach auf dem Elternteil
- eine der Tageskacheln → setzt den Festtag; die Abschnitte arbeiten danach auf diesem Kind
- Knopf „Bereiche" über dem Inhalt → öffnet die Schiene als Schublade (führt zu: „Planer-Schiene“)
- Knopf „Zurück zu {Bereich}" → stellt Abschnitt, Festtag, Bereich und Unterbereich des vorigen Eintrags wieder her

### Planer — Teilnahme & Einladungen

Menüpfad: Web-App → Planer — Teilnahme & Einladungen (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Wer sich angemeldet hat, wer eingeladen ist, wer noch antworten muss. Anmeldungen entstehen woanders (öffentlicher Auftritt); hier werden sie gesichtet, ihr Zustand geändert, ausgegeben — und Einladungen an Mitglieder verschickt.

- eine der vier Marken „Alle Tage", „Tag 1", „Tag 2", „Tag 3" → keine. Der gewählte Wert wird ausschliesslich zur Einfärbung gelesen; die Anmeldungsliste kennt ihn nicht
- Auswahlfeld mit vier Werten — Alle, Bestätigt, Abgesagt, Nur Einladungen → filtert die Tabelle
- Knopf „CSV-Export" → erzeugt eine Datei mit sechs Spalten aus der gefilterten Ansicht und lädt sie herunter
- Knopf „Mitglieder einladen" → öffnet den Dialog
- Knopf im Dialog → legt je Mitglied eine Einladung an, dazu je Abteilung, Gruppe und Organ einen Sammelauftrag; leert danach die Auswahl und schliesst den Dialog
- Aktionsschaltfläche an einer Anmeldezeile, dann Bestätigen oder Absagen → setzt den Zustand der Anmeldung
- Knopf „Externe einladen" / „Einladen - mehrere Tage" → keine. Der Knopf ist gesperrt

### Planer — Aufgaben

Menüpfad: Web-App → Planer — Aufgaben (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Aufgaben eines Festes planen und ihren Stand steuern — in drei Ansichten (Tafel, Zeitstrahl, Kalender), gefiltert nach Festphase, zugeordnet zu Arbeitsorten und Menschen.

- Knopf „Aufgabe hinzufügen" → öffnet den Dialog, mit der gewählten Phase vorbelegt (in „Alle" und „Ohne Phase" bleibt sie leer)
- die Leiste unter dem Kopf → schaltet den sichtbaren Datenbereich um; auch den Ladeweg — mit Auswahl drei Abrufe (Aufgaben, Zuweisungen, Kontext), ohne Auswahl zwei je Arbeitsort plus den Kontext
- fünf Reiter — Alle, Vorbereitung, Live, Nachbereitung, Ohne Phase → filtert Tafel, Zeitstrahl, Kalender und drei der vier Kacheln
- drei Knöpfe — Board, Zeithorizont, Kalender → wechselt zwischen tafel, zeitleiste und kalender
- Titel oder Knopf „Details" an einer Karte, ein Eintrag auf dem Zeitstrahl, in einer Tagesgruppe oder im Kalender → ersetzt die ganze Fläche durch die Detailansicht („Aufgabe — Detailansicht“, eigene Spezifikation)
- Stiftsymbol an einer Karte → öffnet den Dialog mit den Werten dieser Aufgabe
- Papierkorb an einer Karte → löscht die Aufgabe sofort
- einer der zwei Statusknöpfe an einer Karte → setzt den Status
- „Erstellen" beziehungsweise „Speichern" → legt die Aufgabe an oder aktualisiert sie
- zwei Wege — einen Menschen aus der Schiene auf eine Karte ziehen und ablegen, oder den Knopf „Zuweisen" an der Karte → weist zu — und fügt den Menschen zugleich dem Arbeitsort hinzu, wenn er noch nicht dort war

### Planer — Bereiche

Menüpfad: Web-App → Planer — Bereiche (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Arbeitsorte und Gewerke eines Fests anlegen — und als Rahmen für die Arbeit an einem einzelnen Ort dienen.

- Knopf im Kopf → öffnet den Anlege-Dialog
- der Knopf im Schrittvorschlag → öffnet den Arbeitsplatz dieses Bereichs
- ein Auswahlfeld an der Karte; ein Klick auf ein Namenskürzel entfernt die Zuweisung wieder → weist einen Menschen diesem Arbeitsort zu beziehungsweise nimmt ihn heraus
- Stiftsymbol an einer Karte → öffnet den Dialog mit den Werten dieses Bereichs
- der Bestätigungsknopf im Dialog → legt den Bereich an oder aktualisiert ihn
- der Bestätigungsknopf im Kopier-Dialog → legt den Bereich in allen gewählten Festtagen an und überträgt, was angehakt ist; ein gleichnamiger Bereich wird wiederverwendet statt doppelt angelegt
- Bestätigen im Löschdialog → stösst einen Auftrag an, der den Bereich samt verknüpfter Daten im Hintergrund entfernt; war er gerade geöffnet, kehrt die Fläche zur Übersicht zurück

### Planer — Dashboard

Menüpfad: Web-App → Planer — Dashboard (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Der Einstieg: Was steht an, wie weit ist das Fest, und wo geht es weiter.

- ein Knopf an einer Empfehlung → springt in den genannten Abschnitt
- ein Knopf im Leitstand → springt in den betroffenen Abschnitt
- Knopf im leeren „Festtage im Blick" → springt in den Abschnitt Festtage
- eine Festtagszeile → wechselt auf diesen Festtag
- Knopf an der Kontakttafel → springt in den Abschnitt Kontakte
- ein Eintrag der Werkzeugliste → springt in den Abschnitt

### Planer — Design-Studio

Menüpfad: Web-App → Planer — Design-Studio (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Der Auftritt eines Festes: Farben, Schriften, Abstände, Titelbild, Flyer, die Reihenfolge der Blöcke im öffentlichen Hub und seine Texte. Alles wirkt auf denselben öffentlichen Auftritt.

- Knopf „Auftritt speichern" im Kopf → legt den Auftritt an oder aktualisiert ihn
- Knopf „Public Preview" im Kopf → öffnet den öffentlichen Auftritt in einem neuen Tab
- einer der sechs Reiter → tauscht den Inhaltsbereich aus
- Feld „Stichwort" plus Knopf zum Hinzufügen → hängt ein Stichwort an; jedes erscheint als Marke mit Löschkreuz
- Knopf im Reiter „Auftritt" → schlägt aus Stimmung und Stichworten einen Satz Farben und Formwerte vor
- Knopf im Reiter „Auftritt", danach der Löschdialog → entfernt den Auftritt
- eine der Stilvorgaben → bestimmt die Anmutung der erzeugten Bilder
- Knopf „Hochladen" an einer der beiden Karten → ersetzt das Bild durch eine eigene Datei
- Knopf an einer der beiden Karten → erzeugt das Bild aus Stimmung, Stichworten, Stilvorgabe und Zusatzwunsch
- Papierkorb an einer der beiden Karten → löscht das Bild
- eine der Phasen (vor dem Fest, live, danach) → zeigt die Reihenfolge für genau diese Phase
- einen Block an seinem Griff ziehen → ändert die Reihenfolge im öffentlichen Hub
- Schalter an einem Block → blendet ihn im öffentlichen Hub aus; sein Name erscheint durchgestrichen
- Knopf → stellt die Voreinstellung dieser Phase wieder her
- einer der Abschnittsreiter → wählt den Hub-Abschnitt, dessen Texte bearbeitet werden
- eine der vier Phasen — vor dem Fest, live, danach, immer → wählt, für welche Phase der Text gilt
- Knopf im Reiter „Public-Texte" → verwirft den eigenen Text für dieses Feld
- Umschalter Desktop / Mobil → ändert die Breite der Live-Vorschau

### Planer — Festtage

Menüpfad: Web-App → Planer — Festtage (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Die einzelnen Tage eines mehrtägigen Fests anlegen, ihre Bereitschaft ablesen und von dort in die Arbeit springen.

- zwei Schaltflächen — „Einmal fürs Fest" und „Pro Festtag" → schreibt sofort am Gesamtfest, ohne Rückfrage
- vier Knöpfe je Karte — der vorgeschlagene nächste Schritt und die drei festen „Bereiche", „Ablauf", „Aufgaben" → wechselt auf diesen Festtag und öffnet dort den genannten Abschnitt
- Knopf im Kopf oder im Leerzustand → öffnet den Dialog mit vorgeschlagenen Zeiten — eine Stunde nach dem Ende des letzten Tages, dann acht Stunden lang; ohne vorherigen Tag ab dem Beginn des Fests
- Stiftsymbol an einer Karte → öffnet denselben Dialog mit den Werten dieses Tages
- „Hinzufügen" beziehungsweise „Speichern" → legt den Tag an oder aktualisiert ihn
- Papierkorb an einer Karte → löscht den Tag samt seiner Planung

### Planer — Gäste-Beiträge

Menüpfad: Web-App → Planer — Gäste-Beiträge (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Beiträge, die Gäste am Fest einstellen, prüfen: freigeben oder ausblenden.

- vier anklickbare Marken — Alle, Zur Prüfung, Veröffentlicht, Ausgeblendet → schränkt die Liste ein; die Voreinstellung ist „Alle"
- Knopf „Freigeben" → gibt den Beitrag frei und holt die Familie nach
- Knopf „Ausblenden" an einem veröffentlichten Beitrag, „Ablehnen" an einem noch nicht veröffentlichten → dieselbe Aktion in beiden Fällen — nur die Beschriftung wechselt

### Planer — Galerie

Menüpfad: Web-App → Planer — Galerie (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Bilder des Fests sammeln und je Bild entscheiden, ob es öffentlich erscheint.

- drei Wege — Knopf im Kopf, Knopf im Schrittvorschlag, Knopf im Leerzustand; dazu Ziehen und Ablegen auf das Raster → lädt die Dateien nacheinander hoch — die neuen Bilder sind zunächst privat
- Augensymbol an einer Kachel → schaltet dieses eine Bild um
- Papierkorb an einer Kachel → entfernt das Bild unwiderruflich

### Planer — Konfiguration

Menüpfad: Web-App → Planer — Konfiguration (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Modus, Sichtbarkeit, Anmeldung und aktive Werkzeuge des Fests — jede Sektion mit eigenem Speichern-Knopf.

- der Speichern-Knopf dieser Karte → schreibt Titel, Zeitraum, Ort und Beschreibung
- der Speichern-Knopf dieser Karte → schreibt die Sichtbarkeit — unter Umgehung der Typprüfung
- der Speichern-Knopf dieser Karte → sendet Frist, Höchstzahl und die Begleitpersonen-Regel — die der Dienst verwirft. Die Meldung sagt trotzdem „gespeichert"
- der Speichern-Knopf dieser Karte → schreibt das Merkmalsprofil

### Planer — Ansprechpartner

Menüpfad: Web-App → Planer — Ansprechpartner (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Wer beim Fest ansprechbar ist — mit Rolle, Telefon, E-Mail, Zuordnung zu einem Arbeitsort, einer Dringlichkeitsstufe, Sichtbarkeit und freien Notizen. Ein Kontakt kann an ein Vereinsmitglied gebunden sein; dann kommen Name und Erreichbarkeit von dort.

- Knopf „Ansprechpartner hinzufügen" im Kopfbereich → öffnet den Dialog ohne Vorbelegung
- die Leiste unter dem Kopf → schaltet den sichtbaren Datenbereich um — Kennzahlen, Block und Kartenraster folgen der Wahl
- Knopf an einer Gesamtfest-Karte → legt eine eigene Kopie dieses Kontakts für den Festtag an — mit Name, Rolle, Erreichbarkeit, Arbeitsort, Dringlichkeitsstufe und Sichtbarkeit
- Stiftsymbol an einer Kontaktkarte → öffnet den Dialog mit den Werten dieses Kontakts
- Papierkorb an einer Kontaktkarte → löscht den Kontakt
- jeder Anschlag im Feld „Rolle / Funktion" — ein Auswahlfeld mit zwanzig Vorschlägen und freier Eingabe → setzt die Dringlichkeitsstufe neu — Notfall bei Ersthelfer, Sanitäter, Sicherheitsdienst, Feuerwehr oder Polizei; Wichtig bei Festleitung, Verantwortlichen, Bereichs- leitung, Festbüro, Ordner, Hausmeister, Technik, Schicht-, Einlass-, Catering- oder Barleitung
- Bestätigen im Dialog → legt den Kontakt an oder aktualisiert ihn, samt Notizen

### Planer — Live-Regie

Menüpfad: Web-App → Planer — Live-Regie (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Kurze Hinweise an Gäste senden, wichtige davon oben halten und den Verlauf der Durchführung sichern. Die Fläche heisst in der Oberfläche „Live-Regie", nicht „Live-Ticker" — der Abschnittsname in der Schiene lautet „Live-Ticker".

- Knopf „Moments-QR" → öffnet den Dialog „Moment teilen — QR-Code & Link" mit dem QR-Code, über den Gäste eigene Momente beitragen
- Knopf „Live-Monitor" → öffnet /club/<verein>/event/<fest>/monitor in einem neuen Tab
- Knopf „Splitscreen (TV)" → öffnet denselben Monitor mit ?layout=split in einem neuen Tab — Momente links, Musikwünsche rechts
- Knopf „Erneut versuchen" im Kanalzustand → setzt den Merker zurück; der Anlegeversuch läuft erneut
- Knopf „Bild" → keine. Der Knopf ist dauerhaft gesperrt und ohne Klickverhalten — eine angekündigte, nicht gebaute Funktion. Er sieht aus wie die anderen Bedienelemente daneben
- Knopf „Pinnen" / „Wird gepinnt" → merkt vor, dass die nächste Meldung angepinnt wird
- eine der Kennzeichnungs-Marken → setzt die Art der Meldung; die gewählte wird farbig gefüllt
- Knopf „Senden" → legt die Nachricht mit Kennzeichnung, Art „manual" und der Kennung des Kontexts an; war der Pin vorgemerkt, wird sie danach angepinnt
- Pin-Knopf an einer Meldung → pinnt an oder löst den Pin
- Papierkorb an einer Meldung → löscht die Meldung — ohne Rückfrage

### Planer — Musikwünsche

Menüpfad: Web-App → Planer — Musikwünsche (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Gäste wünschen sich Titel und stimmen darüber ab; hier wird die Warteschlange abgearbeitet und die Regeln dafür gesetzt.

- Knopf „DJ-Panel öffnen" → verlässt die Anwendung und öffnet die öffentliche Verwaltungsseite in einem neuen Fenster
- Knopf „QR-Code & Link" → öffnet einen Dialog mit QR-Code und Adresse für die Gäste
- Knopf „Playlist-Monitor" → verlässt die Anwendung und öffnet die Warteschlangen-Anzeige für einen eigenen Bildschirm
- Schalter „Musikwünsche aktivieren" → schaltet das Merkmal des Fests — und beim Einschalten zugleich die Funktion selbst, falls die noch aus war
- Schalter „Public-Seite anzeigen" → blendet die Seite ein oder aus, ohne das Merkmal zu ändern
- Schalter „Wünsche offen" → Ist er zu, können Gäste nichts Neues einreihen
- Schalter „Voting offen" → Ist er zu, bleibt die Reihenfolge sichtbar, aber Stimmen ändern sich nicht mehr
- Schalter „Explicit erlauben" → erlaubt als anstössig gekennzeichnete Titel beim Vorschlagen
- Plus und Minus an „Wünsche pro Gast" → begrenzt, wie viele offene Wünsche ein Gast gleichzeitig haben darf
- Plus und Minus an „Cooldown (Minuten)" → legt fest, wie lange ein gespielter Titel gesperrt bleibt (0 schaltet die Sperre ab)
- Knopf „Gespielt" an einer Zeile → nimmt den Titel aus der Warteschlange und trägt ihn unter „Bereits gespielt" ein — damit beginnt seine Wartezeit
- Knopf „Ablehnen" an einer Zeile → nimmt den Wunsch aus der Warteschlange

### Planer — News

Menüpfad: Web-App → Planer — News (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Mitteilungen an die Teilnehmer schreiben, anpinnen und im Verlauf behalten.

- Nadelsymbol an einer Karte → hebt die Mitteilung nach oben und markiert sie
- das Sendesymbol an der Karte, links neben der Nadel → macht den Entwurf zur veröffentlichten Mitteilung und setzt, falls noch keiner da ist, den Zeitpunkt auf jetzt
- Papierkorb an einer Karte → löscht die Mitteilung
- Knopf im Kopf, im Schrittvorschlag oder im Leerzustand → öffnet den Verfassen-Dialog — immer leer
- Knopf „KI-Assistent" (leerer Entwurf) oder „KI optimieren" (vorhandenen Text überarbeiten) → öffnet den Schreibassistenten; sein Ergebnis fliesst in Titel, Inhalt und gegebenenfalls ein Titelbild zurück
- der Bestätigungsknopf im Dialog → legt die Mitteilung an — als Entwurf oder veröffentlicht, je nach Schalter

### Planer — Programm

Menüpfad: Web-App → Planer — Programm (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Was wann und wo passiert — Programmpunkte je Arbeitsort, mit Zeiten, Bildern, Turnierbezug und Sponsoren.

- „Im Festtag bearbeiten" an einer Karte oder „Festtag Öffnen" im Ablaufblock → wechselt auf diesen Festtag und bleibt im Abschnitt Programm
- Knopf „Programmpunkt" im Kopf, oder „Ersten Programmpunkt anlegen" im Leerzustand → öffnet den Dialog ohne Vorbelegung
- die Leiste unter dem Kopf → schränkt Kacheln, Konflikterkennung und Ablauf auf einen Ort ein
- zwei Knöpfe — „Line-up" und „Liste" → wechselt zwischen zeitleiste und liste
- „Bild hochladen" für das Header-Visual, ebenso für den Flyer → legt die Datei ab und merkt sich ihre Kennung am Programmpunkt
- das Feld „Turnier referenzieren" → bindet den Programmpunkt an ein Turnier — und schreibt beim Speichern dessen Zuordnung zum Fest, Beginn und Ende dorthin zurück
- das Mehrfachfeld „Sponsoren" → verknüpft; legt dabei bei Bedarf eine Bereichs-Zuordnung an
- Stiftsymbol an einer Karte → öffnet den Dialog mit den Werten dieses Punkts
- „Erstellen" beziehungsweise „Speichern" → legt an oder aktualisiert — und bis zu zwei weitere Schreibvorgänge: die Sponsoren-Zuordnung, danach das Turnier
- Papierkorb an einer Karte → löscht den Punkt sofort

### Planer — Ressourcen

Menüpfad: Web-App → Planer — Ressourcen (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Räume und Gebäude aus dem Vereinsbestand für das Fest reservieren und Arbeitsorten zuordnen.

- Knopf „Ressource verknüpfen" im Kopf → öffnet den Dialog, mit dem gewählten Arbeitsort vorbelegt
- die Leiste unter dem Kopf → schränkt Kacheln, Schrittvorschlag und Liste auf einen Ort ein
- Knopf „Verknüpfen" → legt die Verknüpfung an — ohne den gewählten Bereich
- Papierkorb an einer Zeile → entfernt die Verknüpfung sofort

### Planer — Einsatzplanung

Menüpfad: Web-App → Planer — Einsatzplanung (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Einsatzfenster je Arbeitsort planen und Menschen darauf verteilen. Die Fläche heisst in der Oberfläche „Wer arbeitet wann wo?"; der Abschnittsname in der Schiene lautet „Schichtplan".

- Knopf „Als PDF teilen", danach eine von zwei Formen — „Als Tabelle" oder „Als Zeitstrahl" → erzeugt das Dokument in der gewählten Form
- Knopf „Schicht hinzufügen" → öffnet den Dialog ohne Vorbelegung
- die Arbeitsort-Leiste unter dem Kopf → schränkt die Anzeige auf einen Arbeitsort ein
- Knopf in der Kopfzeile eines Arbeitsorts → öffnet den Dialog mit diesem Arbeitsort vorbelegt
- zwei Wege — einen Menschen aus der Liste auf die Schicht ziehen und ablegen, oder ihn im Auswahlfeld der Schichtzeile wählen → weist ihn dieser Schicht zu
- Löschkreuz an der Marke eines zugewiesenen Menschen → nimmt die Zuweisung zurück
- Bestätigen im Dialog → legt die Schicht an oder aktualisiert sie
- Stiftsymbol an einer Schichtzeile → öffnet den Dialog mit den Werten dieser Schicht
- Papierkorb an einer Schichtzeile → löscht die Schicht

### Planer-Schiene

Menüpfad: Web-App → Planer-Schiene (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Die linke Leiste des Planers. Sie zeigt, wo man ist, in welcher Phase das Fest steckt, und führt zu den 21 Abschnitten.

- ein Eintrag der Liste → öffnet diesen Abschnitt; die Schiene bleibt stehen
- Symbolknopf oben in der Schiene → wechselt zwischen 280 und 64 Pixel Breite
- Fusszeile „Zurück zum Verein" (aufgeklappt) beziehungsweise ein Pfeilsymbol unten (eingeklappt) → verlässt den Planer und kehrt in den Vereinsbereich zurück
- Fusszeile „Hilfe & Tipps" → öffnet die Hilfe

### Planer — Speisekarte

Menüpfad: Web-App → Planer — Speisekarte (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Speisekarten des Vereins einem Fest zuordnen — und auf Arbeitsort-Ebene ihre Gerichte bearbeiten.

- der anklickbare Hinweisstreifen „Speisekarten pflegen" → verlässt die Anwendung und öffnet den Versorgungsbereich des Vereins in einem neuen Fenster
- Knopf „Speisekarte hinzufügen" im Kopf oder im Leerzustand → öffnet den Dialog
- der Bestätigungsknopf im Dialog → weist die gewählte Karte zu — oder legt eine neue an und weist sie zu
- Knopf „Vollständige Karte ansehen" über jeder Karte → öffnet die öffentliche Ansicht der Karte — mit Vereinslogo, ihrer Gestaltung und dem QR-Code
- Papierkorb an einer Karte → nimmt die Zuweisung zurück

### Planer — Sponsoren

Menüpfad: Web-App → Planer — Sponsoren (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Sponsoren aus dem Vereinsbestand dem Fest zuordnen, ihnen eine Stufe geben — und aus den Sponsoring-Angeboten des Vereins sammelweise übernehmen.

- Knopf „Sponsor hinzufügen" im Kopf oder im Schrittvorschlag → öffnet den Dialog mit der Stufe „Partner" vorbelegt
- die Leiste unter dem Kopf → schränkt Kacheln, Schrittvorschlag und Liste auf einen Ort ein
- Knopf „Übernehmen" im Panel → legt für jeden Sponsor mit aktivem Angebot eine Verknüpfung an, mit der Stufe des Angebots; vorhandene bleiben
- der Bestätigungsknopf im Dialog → legt die Verknüpfung an
- Löschsymbol an einer Sponsorenkarte → nimmt die Zuordnung zurück

### Planer — Stammdaten

Menüpfad: Web-App → Planer — Stammdaten (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Titel, Zeitraum, Ort, Beschreibung, Status und Sichtbarkeit — und, ganz unten, das Löschen der Veranstaltung.

- jede Eingabe in einem Textfeld → merkt die Änderung vor, ohne zu speichern
- das Verlassen eines Textfelds → schreibt die vorgemerkten Änderungen
- das Feld „Status" → schreibt sofort, nicht erst beim Verlassen
- das Feld „Sichtbarkeit" → schreibt sofort
- Knopf „Veranstaltung löschen" beziehungsweise „Tag löschen" → stösst einen Auftrag an; das Löschen selbst passiert danach im Hintergrund

### Planer — Turniere

Menüpfad: Web-App → Planer — Turniere (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Turnierserien und ihre Ausführungen mit einem Fest verknüpfen — und von dort aus in den Turnier-Hub wechseln, wo sie tatsächlich verwaltet werden.

- Knopf „Tournament Hub" im Kopf → verlässt den Planer und öffnet den Turnierbereich des Vereins
- Knopf „Serie erstellen" im Kopf → verlässt den Planer und öffnet das Anlegen einer Serie, mit diesem Fest vorbelegt
- Knopf „Aufnehmen" → verknüpft die Serie mit dem Fest — und alle ihre noch unverknüpften Ausführungen gleich mit — und schaltet den Turnier-Abschnitt des Fests ein
- Knopf „Festtag öffnen" → wechselt auf diesen Festtag, bleibt im Planer
- Knopf „Turnier in Festtag erstellen" → verlässt den Planer und öffnet das Anlegen einer Serie, mit dem gewählten Festtag vorbelegt
- Knopf „Programmpunkt" an einer Ausführung → legt einen Programmpunkt an — im Standard-Arbeitsort, und wenn es keinen gibt, im ersten beliebigen — und schreibt Zuordnung, Beginn und Ende ins Turnier zurück
- Knopf „Kopplung entfernen" → löst die Ausführung vom Fest
- Knopf „Planner" an einer Serienzeile → verlässt den Planer und öffnet die Serienplanung
- Knopf „Public" an einer Ausführung → verlässt den Planer und öffnet die öffentliche Ansicht dieser Ausführung
- Knopf „Verwalten" an einer Ausführung → verlässt den Planer und öffnet die Turnierverwaltung

### Schichtplan (Helferansicht)

Menüpfad: Web-App → Schichtplan (Helferansicht) (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Wer arbeitet wann und wo — und wo ist noch Platz für mich?

- Tippen im Suchfeld → zeigt nur passende Schichten
- Umlegen des Schalters „nur meine" → zeigt nur die eigenen Schichten
- Klick auf den Eintragen-Knopf einer Schicht → trägt die eigene Person ein
- Klick auf den Austragen-Knopf einer eigenen Schicht → nimmt die eigene Zuweisung zurück
- Wahl einer Ausgabeform — Tabelle oder Zeitschiene → erzeugt ein Dokument des Plans

<!-- /gen:docs web-app -->

## Befehle und Actions

<!-- gen:docs befehle -->

**event**

- `cai.event.01.list` — list (lesen) · Scopes: `event.read`
- `cai.event.02.show` — show (lesen) · Scopes: `event.read`
- `cai.event.03.create` — create (ändern) · Scopes: `event.write`
- `cai.event.04.update` — update (ändern) · Scopes: `event.write`
- `cai.event.05.publish` — publish (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.event.06.delete` — delete (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.event.07.template_list_create_clone_instantiate` — list, create, clone, instantiate (lesen, ändern) · Scopes: `event.read`, `event.write`
- `cai.event.08.series_list_show_create_materialize_promote_recurring_promote_yearly_n` — list, show, create, update, delete, materialize, materialize_next, promote_recurring, promote_yearly (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.09.area_list_add_show_update_delete_bulk_copy` — list, add, show, update, delete, bulk, copy (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.10.assignment_list_add_remove_clear` — list, add, remove, clear (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.11.lead_list_add_update_delete` — list, add, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.12.area_note_list_add_update_delete` — list, add, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.13.program_list_add_update_delete_reorder` — list, add, update, delete, reorder (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.14.contact_list_add_update_delete` — list, add, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.15.resource_list_add_set_remove_link_show_link_update_link_delete_usage_u` — list, add, set, remove, link_show, link_update, link_delete, usage, usage_batch (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.16.attachment_list_show_add_update_delete` — list, show, add, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.17.tag_category_and_assignment_workflows` — category_list, category_show, category_add, category_update, category_delete, tag_list, tag_show, tag_add, tag_update, tag_delete, assigned, assignment_list, assign, unassign, clear (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.18.sponsor_and_sponsor_program_workflows` — link_list, link_add, link_delete, tier_list, tier_add, tier_update, tier_delete, tier_sync, program_by_sponsor, program_by_item, program_add, program_delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.19.invitation_and_club_invitation_workflows` — member_mine, member_list, member_show, member_add, member_add_groups, member_add_departments, member_add_org_groups, member_update, member_status, member_delete, member_notified, club_list, club_attending, club_incoming, club_accepted, club_show, club_add, club_external, club_self_join, club_update, club_respond, club_delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.20.registration_list_add_stats_show_update_adjust_delete_aggregate` — list, add, stats, show, update, adjust, delete, aggregate (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.22.design_theme_and_asset_workflows` — theme_show, theme_set, theme_delete, asset_list, asset_upload, asset_delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`, `files.write`
- `cai.event.23.copy_set_reset` — set, reset (ändern, ändern mit Bestätigung) · Scopes: `event.write`
- `cai.event.24.dj_settings_and_request_workflows` — settings, requests, settings_set, request_status, reset (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.25.external_sync_workflows` — list, add, show, update, delete, matches, run, stats, provider_run (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.event.26.instance_previous_next_compare_clone_next` — previous, next, compare, clone_next (lesen, ändern) · Scopes: `event.read`, `event.write`
- `cai.event.27.child_list_create_invitation_summary` — list, create, invitation_summary (lesen, ändern) · Scopes: `event.read`, `event.write`
- `cai.event.28.menu_list_assign_unassign` — list, assign, unassign (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- Felder und Werte: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"event"}'` (`club_id` setzt die Anmeldung — nie in `--input`)

**plan**

- `cai.plan.01.list` — list (lesen) · Scopes: `event.read`
- `cai.plan.02.show` — show (lesen) · Scopes: `event.read`
- `cai.plan.03.create` — create (ändern) · Scopes: `event.write`
- `cai.plan.04.update` — update (ändern) · Scopes: `event.write`
- `cai.plan.05.delete` — delete (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.plan.06.zone_list_create_update_delete_link_unlink` — list, create, update, delete, link, unlink (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.plan.07.table_create_duplicate_update_delete` — create, duplicate, update, delete (ändern, ändern mit Bestätigung) · Scopes: `event.write`
- `cai.plan.08.marker_create_update_delete` — create, update, delete (ändern, ändern mit Bestätigung) · Scopes: `event.write`
- `cai.plan.09.guest_list_add_update_delete` — list, add, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.plan.10.detail` — create (ändern) · Scopes: `event.write`
- `cai.plan.11.export` — export (ändern mit Bestätigung) · Scopes: `files.export`, `event.read`
- `cai.plan.12.illustrate` — illustrate (ändern mit Bestätigung) · Scopes: `files.export`, `event.read`
- `cai.plan.13.compose` — compose (ändern mit Bestätigung) · Scopes: `files.write`, `event.write`
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
- `USAGE_ERROR` — auch, wenn ein Befehl aufgerufen wird, den es im CLI nicht mehr gibt; `comvenio action list` zeigt die passende Action. Siehe `comvenio help fehler USAGE_ERROR`.
