---
id: buchungen-objekte
kategorie: thema
domaenen: [booking, object]
stichwoerter: [buchungen, objekte, gebäude, räume, reservierungen, buchungsregeln, statistiken]
---

# Gebäude, Objekte und Buchungen

## Wozu

Über die Actions der Domäne `object` verwaltet ein Verein seine Gebäude, Räume und buchbaren Objekte
samt Buchungs- und Task-Regeln. Über die Actions der Domäne `booking` legt er Reservierungen für diese
Objekte an, genehmigt oder lehnt sie ab, verknüpft zusammengehörige Buchungen und wertet Auslastung und
Gastgebühren aus.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen,
zeigt `comvenio action list --json`.

- Lesezugriffe auf Gebäude, Räume, Objekte und Buchungen verlangen Vereinsmitgliedschaft.
- Gebäude, Räume, Objekte, Buchungs- und Task-Regeln zu ändern erfordert `manage_objects` im
  passenden Verein- oder Abteilungs-Scope.
- Buchungen zu genehmigen oder abzulehnen erfordert `confirm_object_bookings`; die eigene Buchung darf
  dabei nicht im Vorbeigehen selbst genehmigt werden.
- Eine Buchung zu ändern, zu stornieren oder zu löschen darf der Buchende selbst oder ein Admin mit
  `confirm_object_bookings`.
- Rückwirkende Buchungen und Buchungen im Namen eines anderen Mitglieds erfordern ebenfalls
  `confirm_object_bookings`.
- Statistiken zu Gastgebühren erfordern `confirm_object_bookings` oder `manage_objects`.
- `--json` gibt die Antwort unverändert aus; umfangreiche Eingaben lassen sich statt `--input '<json>'`
  auch mit `--file <pfad>` (UTF-8-JSON) übergeben.

Jede Teilaktion einer mehrteiligen Action wird über `"operation": "<name>"` in `--input` gewählt. Eine
kritische (`critical_write`) Teilaktion liefert zuerst eine Vorschau mit `preview_id` und
`confirmation_token`; erst `comvenio action confirm --preview-id … --confirmation-token=…
--idempotency-key …` führt sie aus.

## Abläufe

### Hierarchie verstehen

Ein Gebäude enthält Räume, ein Raum enthält Objekte, ein Objekt trägt Buchungsregeln, Task-Regeln und
Buchungen; eine Buchung wiederum kann Teilnehmer und Verknüpfungen zu weiteren Buchungen haben. Ein
Objekt besitzt optional einen Raum, aber kein direktes Gebäude.

### Gebäude verwalten

1. Gebäude auflisten oder ein einzelnes ansehen — unkritisch.
2. Gebäude mit Abteilung, Name, Beschreibung und Adresse anlegen oder ändern — unkritisch.
3. Gebäude löschen — kritisch, verlangt `force: true`.

```bash
comvenio action call cai.object.06.building_list_show_create_update_delete \
  --input '{"operation":"create","building":{"department_id":"<department-id>","name":"Vereinsheim","description":"Hauptstandort","address":"Musterweg 1, 12345 Musterstadt"}}' --json

comvenio action call cai.object.06.building_list_show_create_update_delete \
  --input '{"operation":"list","with_rooms":true}' --json

comvenio action call cai.object.06.building_list_show_create_update_delete \
  --input '{"operation":"delete","building_id":"<building-id>","force":true}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

### Räume verwalten

1. Räume auflisten oder einen einzelnen ansehen — unkritisch.
2. Raum mit Gebäude, Name, Kapazität und Buchbarkeit anlegen oder ändern — unkritisch.
3. Raum löschen — kritisch, verlangt `force: true`.

```bash
comvenio action call cai.object.07.room_list_show_create_update_delete \
  --input '{"operation":"create","room":{"building_id":"<building-id>","name":"Dart-Raum","capacity":24,"booking":true}}' --json

comvenio action call cai.object.07.room_list_show_create_update_delete \
  --input '{"operation":"delete","room_id":"<room-id>","force":true}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

### Buchbare Objekte verwalten

1. Objekte auflisten — optional gefiltert nach Typ (`static`, `portable`, `event`) — oder ein einzelnes
   ansehen — unkritisch.
2. Objekt mit Abteilung, optionalem Raum, Name, Beschreibung, Typ, Buchungsraster, Dauergrenzen,
   Genehmigungspflicht und maximaler Teilnehmerzahl anlegen oder ändern — unkritisch.
3. Objekt löschen — kritisch, verlangt `force: true`.

```bash
comvenio action call cai.object.01.list --input '{"type":"static","limit":20,"offset":0}' --json
comvenio action call cai.object.02.show --input '{"object_id":"<object-id>"}' --json

comvenio action call cai.object.03.create \
  --input '{"department_id":"<department-id>","room_id":"<room-id>","is_default":false,"object":{"name":"Dartboard 1","description":"Board an Bahn 1","type":"static","booking_granularity":"30min","min_duration_minutes":30,"max_duration_minutes":180,"approval_required":false,"max_participants":8}}' --json

comvenio action call cai.object.05.delete --input '{"object_id":"<object-id>","force":true}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

Buchungsraster: `15min`, `30min`, `hourly`, `timedate` (frei nach Datum/Uhrzeit). Bei den drei
zeitrasterbasierten Varianten sind Mindest- und Höchstdauer sinnvoll anzugeben; beim freien Raster
bleiben sie leer. `force: true` löscht ein Objekt auch mit abhängigen Einträgen (Regeln, Buchungen)
mit.

### Buchungs- und Task-Regeln pflegen

1. Buchungsregeln eines Objekts auflisten, einzeln ansehen — unkritisch; anlegen oder im Sammellauf
   anlegen — unkritisch; ändern — unkritisch; löschen — kritisch.
2. Task-Regeln eines Objekts auflisten, ansehen, anlegen, ändern — unkritisch; löschen — kritisch.

```bash
comvenio action call cai.object.08.booking_rule_list_show_create_bulk_update_delete \
  --input '{"operation":"create","rule":{"object_id":"<object-id>","weekday":"tuesday","start_time":"18:00","end_time":"22:00"}}' --json

comvenio action call cai.object.08.booking_rule_list_show_create_bulk_update_delete \
  --input '{"operation":"delete","rule_id":"<rule-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.object.09.task_rule_list_show_create_update_delete \
  --input '{"operation":"create","rule":{"object_id":"<object-id>","title":"Board prüfen","description":"Spitzen und Beleuchtung prüfen","priority":"medium","due_offset_days":0}}' --json
```

Eine Buchungsregel legt Objekt, Wochentag, Start- und Endzeit sowie optionale saisonale Gültigkeit
(Monat/Tag von, Monat/Tag bis) fest. Eine Task-Regel legt Objekt, Titel, Beschreibung, Priorität und
einen Fälligkeits-Versatz in Tagen nach Buchungsende fest — kein Wiederholungsintervall, sondern eine
einmalige Fälligkeit je Buchung.

### Buchungen verwalten

1. Buchungen des Vereins (`list`, mit Zeitraum `from`/`to`/`timezone`) oder eines bestimmten Objekts
   (`list_object`) auflisten; einzelne Buchung ansehen (`show`) — unkritisch.
2. Buchung mit Objekt, Titel, Start- und Endzeit, Zeitzone und Status anlegen — kritisch.
3. Buchung ändern, genehmigen, ablehnen, stornieren oder löschen — jeweils kritisch.

```bash
comvenio action call cai.booking.01.list \
  --input '{"operation":"list","from":"2026-07-01T00:00:00+02:00","to":"2026-07-31T23:59:59+02:00","timezone":"Europe/Berlin","limit":20,"offset":0}' --json

comvenio action call cai.booking.02.show --input '{"reservation_id":"<reservation-id>","timezone":"Europe/Berlin"}' --json

comvenio action call cai.booking.03.create \
  --input '{"object_id":"<object-id>","title":"Darttraining","start_time":"2026-07-21T18:00:00+02:00","end_time":"2026-07-21T20:00:00+02:00","timezone":"Europe/Berlin","status":"requested","comment":"Ligavorbereitung"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.booking.05.approve --input '{"reservation_id":"<reservation-id>","object_id":"<object-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.booking.07.cancel \
  --input '{"reservation_id":"<reservation-id>","object_id":"<object-id>","reason":"Platz gesperrt"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

Für eine Admin-Buchung im Namen eines anderen Mitglieds wird `resp_member_id` explizit mitgegeben; das
erfordert wie rückwirkende Buchungen die entsprechende Berechtigung.

### Mehrere Buchungen im Sammellauf anlegen

Mehrere zusammengehörige Buchungen — etwa eine Hauptbuchung mit portablen Objekten — lassen sich in
einem Sammellauf anlegen — kritisch.

```bash
comvenio action call cai.booking.09.bulk \
  --input '{"object_id":"<haupt-objekt-id>","title":"Darttraining","start_time":"2026-07-21T18:00:00+02:00","end_time":"2026-07-21T20:00:00+02:00","timezone":"Europe/Berlin","status":"requested","group_ids":["<gruppen-id>"],"portable_reservations":[{"object_id":"<portables-objekt-id>","start_time":"2026-07-21T17:45:00+02:00","end_time":"2026-07-21T20:15:00+02:00","title":"Mobiles Oche"}]}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

### Teilnehmer einer Buchung

1. Teilnehmer einer Buchung auflisten oder einzeln ansehen — unkritisch.
2. Teilnehmer mit Mitglieds-Kennung oder als Gast mit Name und E-Mail-Adresse hinzufügen — unkritisch;
   alternativ mehrere Mitgliedergruppen auf einmal hinzufügen — kritisch.
3. Teilnehmerstatus ändern (eingeladen, angenommen, abgelehnt, storniert) — unkritisch; Teilnehmer
   entfernen — kritisch.

```bash
comvenio action call cai.booking.10.participant_list_show_add_add_groups_update_remove \
  --input '{"operation":"add","reservation_id":"<reservation-id>","participant":{"member_id":"<member-id>"}}' --json

comvenio action call cai.booking.10.participant_list_show_add_add_groups_update_remove \
  --input '{"operation":"add","reservation_id":"<reservation-id>","participant":{"is_guest":true,"guest_name":"Max Muster","guest_email":"max@example.org"}}' --json

comvenio action call cai.booking.10.participant_list_show_add_add_groups_update_remove \
  --input '{"operation":"update","participant_id":"<participant-id>","status":"accepted"}' --json
```

### Buchungen verknüpfen

1. Verknüpfungen einer Buchung auflisten oder alle Verknüpfungen des Vereins ansehen — unkritisch.
2. Hauptbuchung mit einer weiteren Buchung verknüpfen — unkritisch.
3. Verknüpfung entfernen — kritisch.

```bash
comvenio action call cai.booking.11.link_list_club_add_remove \
  --input '{"operation":"add","primary_reservation_id":"<haupt-buchung-id>","linked_reservation_id":"<verknüpfte-buchung-id>"}' --json

comvenio action call cai.booking.11.link_list_club_add_remove \
  --input '{"operation":"list","reservation_id":"<reservation-id>"}' --json
```

Wird die Hauptbuchung storniert, kann Comvenio verknüpfte portable Buchungen automatisch mit
stornieren.

### Statistiken auswerten

1. Objektstatistik für ein Jahr oder einen Monat abrufen — unkritisch.
2. Gaststatistik über einen Zeitraum abrufen — aggregierte Gastgebühren je verantwortlichem Mitglied —
   unkritisch.

```bash
comvenio action call cai.booking.12.stats_object_guests \
  --input '{"operation":"object","object_id":"<object-id>","year":2026,"month":7}' --json
comvenio action call cai.booking.12.stats_object_guests \
  --input '{"operation":"guests","from_date":"2026-01-01T00:00:00+02:00","to_date":"2026-12-31T23:59:59+01:00","limit":50}' --json
```

### Noch nicht als Action verfügbar

Interne System-zu-System-Routen mit eigenem Authentifizierungsvertrag, ein anonymer öffentlicher
Ausschnitt einzelner hervorgehobener Objekte sowie technische Sammelabfragen und Datei-Exporte sind
bewusst kein Bestandteil dieser Actions. Tags für Objekte sind ein eigener, hier nicht behandelter
Teilbereich.

## Beispiele

Gebäude und Raum anlegen:

```bash
comvenio action call cai.object.06.building_list_show_create_update_delete \
  --input '{"operation":"create","building":{"department_id":"<department-id>","name":"Vereinsheim","description":"Hauptstandort","address":"Musterweg 1, 12345 Musterstadt"}}' --json
comvenio action call cai.object.07.room_list_show_create_update_delete \
  --input '{"operation":"create","room":{"building_id":"<building-id>","name":"Dart-Raum","capacity":24,"booking":true}}' --json
```

Objekt anlegen und mit erzwungener Kaskade löschen:

```bash
comvenio action call cai.object.03.create \
  --input '{"department_id":"<department-id>","room_id":"<room-id>","is_default":false,"object":{"name":"Dartboard 1","description":"Board an Bahn 1","type":"static","booking_granularity":"30min","min_duration_minutes":30,"max_duration_minutes":180,"approval_required":false,"max_participants":8}}' --json
comvenio action call cai.object.05.delete --input '{"object_id":"<object-id>","force":true}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

Buchungsregel anlegen:

```bash
comvenio action call cai.object.08.booking_rule_list_show_create_bulk_update_delete \
  --input '{"operation":"create","rule":{"object_id":"<object-id>","weekday":"tuesday","start_time":"18:00","end_time":"22:00"}}' --json
```

Buchung anlegen, genehmigen und stornieren:

```bash
comvenio action call cai.booking.03.create \
  --input '{"object_id":"<object-id>","title":"Darttraining","start_time":"2026-07-21T18:00:00+02:00","end_time":"2026-07-21T20:00:00+02:00","timezone":"Europe/Berlin","status":"requested","comment":"Ligavorbereitung"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.booking.05.approve --input '{"reservation_id":"<reservation-id>","object_id":"<object-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

Sammelbuchung mit portablem Objekt:

```bash
comvenio action call cai.booking.09.bulk \
  --input '{"object_id":"<haupt-objekt-id>","title":"Darttraining","start_time":"2026-07-21T18:00:00+02:00","end_time":"2026-07-21T20:00:00+02:00","timezone":"Europe/Berlin","status":"requested","group_ids":["<gruppen-id>"],"portable_reservations":[{"object_id":"<portables-objekt-id>","start_time":"2026-07-21T17:45:00+02:00","end_time":"2026-07-21T20:15:00+02:00","title":"Mobiles Oche"}]}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

Statistiken abrufen:

```bash
comvenio action call cai.booking.12.stats_object_guests \
  --input '{"operation":"object","object_id":"<object-id>","year":2026,"month":7}' --json
```

## Befehle und Actions

<!-- gen:docs befehle -->

**booking**

- `cai.booking.01.list` — list, list_object (lesen) · Scopes: `booking.read`
- `cai.booking.02.show` — show (lesen) · Scopes: `booking.read`
- `cai.booking.03.create` — create (ändern mit Bestätigung) · Scopes: `booking.write`, `object.read`
- `cai.booking.04.update` — update (ändern mit Bestätigung) · Scopes: `booking.write`, `object.read`
- `cai.booking.05.approve` — approve (ändern mit Bestätigung) · Scopes: `booking.write`
- `cai.booking.06.reject` — reject (ändern mit Bestätigung) · Scopes: `booking.write`
- `cai.booking.07.cancel` — cancel (ändern mit Bestätigung) · Scopes: `booking.write`
- `cai.booking.08.delete` — delete (ändern mit Bestätigung) · Scopes: `booking.write`
- `cai.booking.09.bulk` — create (ändern mit Bestätigung) · Scopes: `booking.write`, `object.read`
- `cai.booking.10.participant_list_show_add_add_groups_update_remove` — list, show, add, add_groups, update, remove (lesen, ändern, ändern mit Bestätigung) · Scopes: `booking.read`, `booking.write`
- `cai.booking.11.link_list_club_add_remove` — list, club, add, remove (lesen, ändern, ändern mit Bestätigung) · Scopes: `booking.read`, `booking.write`
- `cai.booking.12.stats_object_guests` — object, guests (lesen) · Scopes: `booking.read`
- Felder und Werte: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"booking"}'` (`club_id` setzt die Anmeldung — nie in `--input`)

**object**

- `cai.object.01.list` — list (lesen) · Scopes: `object.read`
- `cai.object.02.show` — show (lesen) · Scopes: `object.read`
- `cai.object.03.create` — create (ändern) · Scopes: `object.write`
- `cai.object.04.update` — update (ändern) · Scopes: `object.write`
- `cai.object.05.delete` — delete (ändern mit Bestätigung) · Scopes: `object.write`
- `cai.object.06.building_list_show_create_update_delete` — list, show, create, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `object.read`, `object.write`
- `cai.object.07.room_list_show_create_update_delete` — list, show, create, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `object.read`, `object.write`
- `cai.object.08.booking_rule_list_show_create_bulk_update_delete` — list, list_object, show, create, bulk, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `object.read`, `object.write`
- `cai.object.09.task_rule_list_show_create_update_delete` — list, list_object, show, create, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `object.read`, `object.write`
- Felder und Werte: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"object"}'` (`club_id` setzt die Anmeldung — nie in `--input`)
<!-- /gen:docs -->

## Fehler

- `PERMISSION_DENIED` — es fehlt `manage_objects` für eine Änderung an Gebäude, Raum, Objekt oder
  Regel, oder `confirm_object_bookings` für Genehmigung, Ablehnung oder eine rückwirkende Buchung.
  Siehe `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — ein Feld fehlt oder passt nicht, etwa ein fehlendes `force: true` beim Löschen
  oder ein unvollständiger Regel-Body. Siehe `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — die angegebene Gebäude-, Raum-, Objekt-, Regel- oder Buchungs-ID gehört zu keinem
  sichtbaren Eintrag im verbundenen Verein. Siehe `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — ein Objekt mit bestehenden Kind-Einträgen wird ohne `force: true` gelöscht, oder eine
  Buchung überschneidet sich mit einer bestehenden Reservierung. Siehe
  `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — die Anmeldung wurde ohne den für eine Schreibaction nötigen Scope erteilt. Siehe
  `comvenio help fehler SCOPE_REQUIRED`.
- `OUTCOME_UNKNOWN` — eine kritische Action (Anlegen, Ändern, Genehmigen, Löschen) wurde nach
  `action confirm` nicht eindeutig bestätigt; vor einer Wiederholung erst mit einem Lesebefehl den
  Stand prüfen. Siehe `comvenio help fehler OUTCOME_UNKNOWN`.
- `USAGE_ERROR` — ein Befehl, den es im CLI nicht mehr gibt; mit `comvenio action list` die
  passende Action suchen. Siehe `comvenio help fehler USAGE_ERROR`.
