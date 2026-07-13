# Gebäude, Objekte und Buchungen per CLI

Diese Referenz ist eigenständig. Sie beschreibt die belegten Club-Admin-Routen des `object-service` für Gebäude, Räume, Objekte, Buchungsregeln, Wartungsregeln, Reservierungen, Teilnehmer, Verknüpfungen und Statistiken.

## Rechte und Grundregeln

- Lesezugriffe verlangen Clubmitgliedschaft.
- Gebäude, Räume, Objekte und Regeln zu ändern erfordert `manage_objects` im passenden Club- oder Abteilungs-Scope.
- Buchungen zu genehmigen oder abzulehnen erfordert `confirm_object_bookings`; die eigene Buchung darf nicht per Owner-Bypass genehmigt werden.
- Buchungen zu ändern, zu stornieren oder zu löschen ist für den Owner oder einen Admin mit `confirm_object_bookings` erlaubt.
- `--file` erwartet UTF-8-JSON. `--json` gibt die API-Antwort unverändert aus.

## Hierarchie

```text
Gebäude
└── Raum
    └── Objekt
        ├── Buchungsregeln
        ├── Task-Regeln
        └── Buchungen
            ├── Teilnehmer
            └── Verknüpfungen zu weiteren Buchungen
```

Ein Objekt besitzt optional `room_id`; es besitzt kein direktes `building_id`. Ein Raum mit `booking: true` erzeugt serverseitig ein Standard-Objekt vom Typ `event`.

## Gebäude

| Zweck | CLI | Backend |
|---|---|---|
| Liste | `comvenio object building list [--with-rooms]` | `GET /object/buildings/club/{club_id}` |
| Detail | `comvenio object building show <id> [--with-rooms]` | `GET /object/buildings/{id}` |
| Anlegen | `comvenio object building create --file building.json` | `POST /object/buildings/` |
| Ändern | `comvenio object building update <id> --file patch.json` | `PATCH /object/buildings/{id}` |
| Entfernen | `comvenio object building delete <id> [--force]` | `DELETE /object/buildings/{id}` |

Beispiel:

```json
{
  "department_id": "UUID",
  "name": "Vereinsheim",
  "description": "Hauptstandort",
  "address": "Musterweg 1, 12345 Musterstadt"
}
```

Das reale Backend verwendet für Updates `PATCH`, nicht `PUT`. Das Update-Schema braucht `id`, `club_id` und `department_id`; die CLI lädt das bestehende Gebäude und ergänzt diese Felder.

## Räume

| Zweck | CLI | Backend |
|---|---|---|
| Liste | `comvenio object room list` | `GET /object/rooms/club/{club_id}` |
| Detail | `comvenio object room show <id>` | `GET /object/rooms/{id}` |
| Anlegen | `comvenio object room create --file room.json` | `POST /object/rooms/` |
| Ändern | `comvenio object room update <id> --file patch.json` | `PATCH /object/rooms/` |
| Entfernen | `comvenio object room delete <id> [--force]` | `DELETE /object/rooms/{id}` |

```json
{
  "building_id": "UUID",
  "name": "Dart-Raum",
  "capacity": 24,
  "booking": true
}
```

Beim Raum-Update steht die ID im Body; die CLI ergänzt sie aus dem Positionsargument.

## Buchbare Objekte

| Zweck | CLI |
|---|---|
| Liste | `comvenio object list [--type static|portable|event] [--with-all]` |
| Detail | `comvenio object show <id> [--with-all]` |
| Anlegen | `comvenio object create --file object.json` |
| Ändern | `comvenio object update <id> --file patch.json` |
| Entfernen | `comvenio object delete <id> [--force]` |

Create-Beispiel:

```json
{
  "department_id": "UUID",
  "room_id": "UUID",
  "name": "Dartboard 1",
  "description": "Board an Bahn 1",
  "type": "static",
  "booking_granularity": "30min",
  "min_duration_minutes": 30,
  "max_duration_minutes": 180,
  "approval_required": false,
  "max_participants": 8
}
```

Objekttypen: `static`, `portable`, `event`. Buchungsraster: `15min`, `30min`, `hourly`, `timedate`. Bei den drei Slot-basierten Rastern sind `min_duration_minutes` und `max_duration_minutes` Pflicht; bei `timedate` normalisiert das Backend beide auf `null`.

`--force` setzt `?force=true` und kaskadiert Soft-Delete auf Kind-Entitäten. Ohne `--force` kann das Backend bei bestehenden Kindern mit 409 ablehnen.

## Buchungs- und Task-Regeln

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

Buchungsregel:

```json
{
  "object_id": "UUID",
  "weekday": "tuesday",
  "start_time": "18:00",
  "end_time": "22:00",
  "valid_from_month": null,
  "valid_from_day": null,
  "valid_until_month": null,
  "valid_until_day": null
}
```

Bulk erwartet ein JSON-Array solcher Objekte. Die CLI ergänzt pro Eintrag `club_id`. Beim aktuellen Update-Schema müssen `start_time`, `end_time` und alle saisonalen Optional-Felder vorhanden sein; nicht verwendete saisonale Felder erhalten `null`.

Task-Regel:

```json
{
  "object_id": "UUID",
  "title": "Board prüfen",
  "description": "Spitzen und Beleuchtung prüfen",
  "priority": "medium",
  "due_offset_days": 0
}
```

`due_offset_days` ist ein Fälligkeits-Offset nach Buchungsende, kein Wiederholungsintervall.

## Buchungen

| Zweck | CLI | Backend |
|---|---|---|
| Club-Liste | `comvenio booking list [--pending|--status <v>]` | `GET /object/object-reservations/club/{club_id}` |
| Objekt-Liste | `comvenio booking list --object-id <id>` | `GET /object/object-reservations/object/{object_id}` |
| Detail | `comvenio booking show <id>` | `GET /object/object-reservations/{id}` |
| Anlegen | `comvenio booking create --file booking.json` | `POST /object/object-reservations/` |
| Ändern | `comvenio booking update <id> --file patch.json` | `PATCH /object/object-reservations/{id}` |
| Genehmigen | `comvenio booking approve <id>` | `PATCH` mit `status=approved` |
| Ablehnen | `comvenio booking reject <id>` | `PATCH` mit `status=rejected` |
| Stornieren | `comvenio booking cancel <id>` | `PATCH` mit `status=cancelled` |
| Soft-Delete | `comvenio booking delete <id>` | `DELETE /object/object-reservations/{id}` |
| Sammelbuchung | `comvenio booking bulk --file bulk.json` | `POST /object/object-reservations/bulk` |

Create-Beispiel:

```json
{
  "object_id": "UUID",
  "title": "Darttraining",
  "start_time": "2026-07-21T18:00:00+02:00",
  "end_time": "2026-07-21T20:00:00+02:00",
  "comment": "Ligavorbereitung",
  "status": "requested"
}
```

Die CLI setzt `club_id`. Für Admin-Buchungen im Namen eines anderen Mitglieds kann `resp_member_id` angegeben werden. Rückwirkende Buchungen und `resp_member_id` erfordern `confirm_object_bookings`.

Das Backend verlangt bei jedem PATCH `club_id` und `object_id`. Die CLI liest deshalb vor Update, Approve, Reject und Cancel die aktuelle Reservierung und ergänzt beide IDs. Ein Update kann `title`, `comment`, `start_time`, `end_time` oder `status` ändern; die Objekt-ID bleibt bewusst die bestehende.

Bulk-Beispiel:

```json
{
  "object_id": "HAUPT-OBJEKT-UUID",
  "start_time": "2026-07-21T18:00:00+02:00",
  "end_time": "2026-07-21T20:00:00+02:00",
  "title": "Darttraining",
  "group_ids": ["GRUPPE-UUID"],
  "portable_reservations": [
    {
      "object_id": "PORTABLE-OBJEKT-UUID",
      "start_time": "2026-07-21T17:45:00+02:00",
      "end_time": "2026-07-21T20:15:00+02:00",
      "title": "Mobiles Oche"
    }
  ]
}
```

## Teilnehmer

```powershell
comvenio booking participant list <reservation-id>
comvenio booking participant show <participant-id>
comvenio booking participant add <reservation-id> --member-id <id>
comvenio booking participant add <reservation-id> --guest --guest-name "Max Muster" --guest-email "max@example.org"
comvenio booking participant add-groups <reservation-id> --file groups.json
comvenio booking participant update <participant-id> --status accepted
comvenio booking participant remove <participant-id>
```

`groups.json` enthält `{ "group_ids": ["UUID"] }`. Teilnehmerstatus: `invited`, `accepted`, `rejected`. Gäste ohne `member_id` brauchen `is_guest: true` und `guest_name`. Das Teilnehmer-Update verwendet die belegte Route `PUT /object-reservations/participants/{id}` und die CLI ergänzt `id` sowie `club_id`.

## Buchungsverknüpfungen

```powershell
comvenio booking link list <reservation-id>
comvenio booking link club
comvenio booking link add --file link.json
comvenio booking link remove <link-id>
```

```json
{
  "primary_reservation_id": "UUID",
  "linked_reservation_id": "UUID"
}
```

Links verbinden eine Hauptbuchung mit einer weiteren Buchung. Beim Stornieren der Hauptbuchung kann das Backend verknüpfte portable Buchungen kaskadierend stornieren. Alle Link-Routen benötigen `club_id` als Query-Parameter; die CLI ergänzt ihn.

## Statistiken

```powershell
comvenio booking stats object <object-id> [--year 2026] [--month 7]
comvenio booking stats guests [--from 2026-01-01] [--to 2026-12-31]
```

Objektstatistiken liefern Gesamtzahl, Jahresvergleich, Monatswerte und Teilnehmerkennzahlen. Gaststatistiken aggregieren Gästegebühren je verantwortlichem Mitglied und erfordern `confirm_object_bookings` oder `manage_objects`.

## Bewusste Abgrenzung

Ausgeschlossen sind `/internal/*`-Routen mit Service-Key, der anonyme Public-Highlight-Endpunkt sowie technische Batch-Lookups und Datei-Exports. Sie sind keine regulären Club-Admin-Mutationen. Tags sind ein separater Objekt-Teilbereich und nicht Bestandteil dieses zentralen Buchungs-/Objekt-Scopes.

Maschinenlesbare Verträge liegen in `src/schema/object.json` und `src/schema/booking.json`. `comvenio schema booking --json` ist direkt verfügbar; `object` wird nutzbar, sobald die Domain im zentralen Schema-Index freigeschaltet ist.
