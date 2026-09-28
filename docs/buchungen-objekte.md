---
id: buchungen-objekte
kategorie: thema
domaenen: [booking, object]
stichwoerter: [buchungen, objekte, gebäude, räume, reservierungen, buchungsregeln, statistiken]
---

# Gebäude, Objekte und Buchungen

## Wozu

Über `comvenio object` verwaltet ein Verein seine Gebäude, Räume und buchbaren Objekte samt
Buchungs- und Wartungsregeln. Über `comvenio booking` legt er Reservierungen für diese Objekte an,
genehmigt oder lehnt sie ab, verknüpft zusammengehörige Buchungen und wertet Auslastung und
Gastgebühren aus.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

- Lesezugriffe auf Gebäude, Räume, Objekte und Buchungen verlangen Vereinsmitgliedschaft.
- Gebäude, Räume, Objekte, Buchungs- und Task-Regeln zu ändern erfordert `manage_objects` im
  passenden Verein- oder Abteilungs-Scope.
- Buchungen zu genehmigen oder abzulehnen erfordert `confirm_object_bookings`; die eigene Buchung
  darf dabei nicht im Vorbeigehen selbst genehmigt werden.
- Eine Buchung zu ändern, zu stornieren oder zu löschen darf der Buchende selbst oder ein Admin mit
  `confirm_object_bookings`.
- Rückwirkende Buchungen und Buchungen im Namen eines anderen Mitglieds erfordern ebenfalls
  `confirm_object_bookings`.
- Statistiken zu Gastgebühren erfordern `confirm_object_bookings` oder `manage_objects`.
- `--file` erwartet UTF-8-JSON, `--json` gibt die Antwort unverändert aus.

## Abläufe

### Hierarchie verstehen

Ein Gebäude enthält Räume, ein Raum enthält Objekte, ein Objekt trägt Buchungsregeln, Task-Regeln und
Buchungen; eine Buchung wiederum kann Teilnehmer und Verknüpfungen zu weiteren Buchungen haben. Ein
Objekt besitzt optional einen Raum, aber kein direktes Gebäude. Ein Raum mit aktivierter Buchbarkeit
erzeugt beim Anlegen automatisch ein Standardobjekt vom Typ „Veranstaltung".

### Gebäude verwalten

1. Gebäude auflisten (optional mit Räumen) oder ein einzelnes ansehen.
2. Gebäude mit Abteilung, Name, Beschreibung und Adresse anlegen.
3. Gebäude ändern oder entfernen.

| Zweck | Befehl |
|---|---|
| Liste | `comvenio object building list [--with-rooms]` |
| Detail | `comvenio object building show <id> [--with-rooms]` |
| Anlegen | `comvenio object building create --file building.json` |
| Ändern | `comvenio object building update <id> --file patch.json` |
| Entfernen | `comvenio object building delete <id> [--force]` |

### Räume verwalten

1. Räume auflisten oder einen einzelnen ansehen.
2. Raum mit Gebäude, Name, Kapazität und Buchbarkeit anlegen.
3. Raum ändern oder entfernen.

| Zweck | Befehl |
|---|---|
| Liste | `comvenio object room list` |
| Detail | `comvenio object room show <id>` |
| Anlegen | `comvenio object room create --file room.json` |
| Ändern | `comvenio object room update <id> --file patch.json` |
| Entfernen | `comvenio object room delete <id> [--force]` |

### Buchbare Objekte verwalten

1. Objekte auflisten — optional gefiltert nach Typ (fest, portabel, Veranstaltung) — oder ein
   einzelnes mit allen Details ansehen.
2. Objekt mit Abteilung, optionalem Raum, Name, Beschreibung, Typ, Buchungsraster, Dauergrenzen,
   Genehmigungspflicht und maximaler Teilnehmerzahl anlegen.
3. Objekt ändern oder entfernen.

Buchungsraster: 15 Minuten, 30 Minuten, stündlich, frei nach Datum/Uhrzeit. Bei den drei
zeitrasterbasierten Varianten sind Mindest- und Höchstdauer Pflicht; beim freien Raster werden beide
automatisch verworfen.

Ein Löschen mit erzwungener Kaskade entfernt auch abhängige Einträge (Regeln, Buchungen); ohne diese
Bestätigung lehnt Comvenio das Löschen bei bestehenden Abhängigkeiten ab.

| Zweck | Befehl |
|---|---|
| Liste | `comvenio object list [--type static\|portable\|event] [--with-all]` |
| Detail | `comvenio object show <id> [--with-all]` |
| Anlegen | `comvenio object create --file object.json` |
| Ändern | `comvenio object update <id> --file patch.json` |
| Entfernen | `comvenio object delete <id> [--force]` |

### Buchungs- und Task-Regeln pflegen

1. Buchungsregeln eines Objekts auflisten, einzeln ansehen, anlegen, im Sammellauf anlegen, ändern
   oder löschen.
2. Task-Regeln eines Objekts auflisten, ansehen, anlegen, ändern oder löschen.

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

Eine Buchungsregel legt Objekt, Wochentag, Start- und Endzeit sowie optionale saisonale Gültigkeit
(Monat/Tag von, Monat/Tag bis) fest. Beim Sammellauf ergänzt das CLI den Verein je Eintrag; beim
Ändern müssen Start- und Endzeit sowie alle saisonalen Felder mitgegeben werden, ungenutzte
saisonale Felder bleiben leer.

Eine Task-Regel legt Objekt, Titel, Beschreibung, Priorität und einen Fälligkeits-Versatz in Tagen
nach Buchungsende fest — kein Wiederholungsintervall, sondern eine einmalige Fälligkeit je Buchung.

### Buchungen verwalten

1. Buchungen des Vereins auflisten — optional nur offene oder nach Status gefiltert — oder Buchungen
   eines bestimmten Objekts auflisten; einzelne Buchung ansehen.
2. Buchung mit Objekt, Titel, Start- und Endzeit sowie optionalem Kommentar anlegen; der Verein wird
   automatisch ergänzt.
3. Buchung genehmigen, ablehnen oder stornieren; dafür liest das CLI vorher die aktuelle Buchung,
   damit die geforderten Vereins- und Objektangaben vollständig mitgeschickt werden.
4. Buchung ändern — Titel, Kommentar, Zeiten oder Status; die Objekt-Zuordnung bleibt dabei bewusst
   bestehen.
5. Buchung mit Soft-Delete entfernen.
6. Mehrere zusammengehörige Buchungen — etwa eine Hauptbuchung mit portablen Objekten — in einem
   Sammellauf anlegen.

| Zweck | Befehl |
|---|---|
| Club-Liste | `comvenio booking list [--pending\|--status <v>]` |
| Objekt-Liste | `comvenio booking list --object-id <id>` |
| Detail | `comvenio booking show <id>` |
| Anlegen | `comvenio booking create --file booking.json` |
| Ändern | `comvenio booking update <id> --file patch.json` |
| Genehmigen | `comvenio booking approve <id>` |
| Ablehnen | `comvenio booking reject <id>` |
| Stornieren | `comvenio booking cancel <id>` |
| Soft-Delete | `comvenio booking delete <id>` |
| Sammelbuchung | `comvenio booking bulk --file bulk.json` |

Für eine Admin-Buchung im Namen eines anderen Mitglieds wird das verantwortliche Mitglied explizit
mitgegeben; das erfordert wie rückwirkende Buchungen die entsprechende Berechtigung.

### Teilnehmer einer Buchung

1. Teilnehmer einer Buchung auflisten oder einzeln ansehen.
2. Teilnehmer mit Mitglieds-Kennung oder als Gast mit Name und E-Mail-Adresse hinzufügen; alternativ
   mehrere Mitgliedergruppen auf einmal hinzufügen.
3. Teilnehmerstatus ändern (eingeladen, angenommen, abgelehnt) oder Teilnehmer entfernen.

```powershell
comvenio booking participant list <reservation-id>
comvenio booking participant show <participant-id>
comvenio booking participant add <reservation-id> --member-id <id>
comvenio booking participant add <reservation-id> --guest --guest-name "Max Muster" --guest-email "max@example.org"
comvenio booking participant add-groups <reservation-id> --file groups.json
comvenio booking participant update <participant-id> --status accepted
comvenio booking participant remove <participant-id>
```

### Buchungen verknüpfen

1. Verknüpfungen einer Buchung auflisten oder alle Verknüpfungen des Vereins ansehen.
2. Hauptbuchung mit einer weiteren Buchung verknüpfen.
3. Verknüpfung entfernen.

```powershell
comvenio booking link list <reservation-id>
comvenio booking link club
comvenio booking link add --file link.json
comvenio booking link remove <link-id>
```

Wird die Hauptbuchung storniert, kann Comvenio verknüpfte portable Buchungen automatisch mit
stornieren.

### Statistiken auswerten

1. Objektstatistik für ein Jahr oder einen Monat abrufen — Gesamtzahl, Jahresvergleich, Monatswerte
   und Teilnehmerkennzahlen.
2. Gaststatistik über einen Zeitraum abrufen — aggregierte Gastgebühren je verantwortlichem Mitglied.

### Bewusste Abgrenzung

Nicht Teil dieses Bereichs sind interne System-zu-System-Routen mit eigenem Authentifizierungsvertrag,
ein anonymer öffentlicher Ausschnitt einzelner hervorgehobener Objekte sowie technische
Sammelabfragen und Datei-Exporte — das sind keine regulären Verwaltungsaktionen. Tags für Objekte
sind ein eigener, hier nicht behandelter Teilbereich.

Der maschinenlesbare Vertrag für Buchungen ist per `comvenio schema booking --json` abrufbar; für
Objekte folgt das, sobald die Domäne im zentralen Schema-Index freigeschaltet ist.

## Beispiele

Gebäude anlegen (`building.json`):

```json
{
  "department_id": "<department-id>",
  "name": "Vereinsheim",
  "description": "Hauptstandort",
  "address": "Musterweg 1, 12345 Musterstadt"
}
```

```bash
comvenio object building create --file building.json --json
comvenio object building list --with-rooms --json
```

Raum anlegen (`room.json`):

```json
{
  "building_id": "<building-id>",
  "name": "Dart-Raum",
  "capacity": 24,
  "booking": true
}
```

```bash
comvenio object room create --file room.json --json
```

Objekt anlegen (`object.json`):

```json
{
  "department_id": "<department-id>",
  "room_id": "<room-id>",
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

```bash
comvenio object create --file object.json --json
comvenio object list --type static --with-all --json
comvenio object delete <object-id> --force --json
```

Buchungsregel anlegen (`rule.json`):

```json
{
  "object_id": "<object-id>",
  "weekday": "tuesday",
  "start_time": "18:00",
  "end_time": "22:00",
  "valid_from_month": null,
  "valid_from_day": null,
  "valid_until_month": null,
  "valid_until_day": null
}
```

```bash
comvenio object booking-rule create --file rule.json --json
comvenio object booking-rule bulk --file rules.json --json
```

Task-Regel anlegen (`task-rule.json`):

```json
{
  "object_id": "<object-id>",
  "title": "Board prüfen",
  "description": "Spitzen und Beleuchtung prüfen",
  "priority": "medium",
  "due_offset_days": 0
}
```

```bash
comvenio object task-rule create --file task-rule.json --json
```

Buchung anlegen (`booking.json`):

```json
{
  "object_id": "<object-id>",
  "title": "Darttraining",
  "start_time": "2026-07-21T18:00:00+02:00",
  "end_time": "2026-07-21T20:00:00+02:00",
  "comment": "Ligavorbereitung",
  "status": "requested"
}
```

```bash
comvenio booking create --file booking.json --json
comvenio booking list --pending --json
comvenio booking approve <booking-id> --json
comvenio booking cancel <booking-id> --json
```

Sammelbuchung mit portablem Objekt (`bulk.json`):

```json
{
  "object_id": "<haupt-objekt-id>",
  "start_time": "2026-07-21T18:00:00+02:00",
  "end_time": "2026-07-21T20:00:00+02:00",
  "title": "Darttraining",
  "group_ids": ["<gruppen-id>"],
  "portable_reservations": [
    {
      "object_id": "<portables-objekt-id>",
      "start_time": "2026-07-21T17:45:00+02:00",
      "end_time": "2026-07-21T20:15:00+02:00",
      "title": "Mobiles Oche"
    }
  ]
}
```

```bash
comvenio booking bulk --file bulk.json --json
```

Teilnehmer verwalten:

```bash
comvenio booking participant add <reservation-id> --member-id <member-id> --json
comvenio booking participant add <reservation-id> --guest --guest-name "Max Muster" --guest-email "max@example.org" --json
comvenio booking participant update <participant-id> --status accepted --json
```

Buchungen verknüpfen (`link.json`):

```json
{
  "primary_reservation_id": "<haupt-buchung-id>",
  "linked_reservation_id": "<verknüpfte-buchung-id>"
}
```

```bash
comvenio booking link add --file link.json --json
comvenio booking link list <reservation-id> --json
```

Statistiken abrufen:

```bash
comvenio booking stats object <object-id> --year 2026 --month 7 --json
comvenio booking stats guests --from 2026-01-01 --to 2026-12-31 --json
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**booking** — vollständig

- `comvenio booking list`
- `comvenio booking show`
- `comvenio booking create`
- `comvenio booking update`
- `comvenio booking approve`
- `comvenio booking reject`
- `comvenio booking cancel`
- `comvenio booking delete`
- `comvenio booking bulk`
- `comvenio booking participant list|show|add|add-groups|update|remove`
- `comvenio booking link list|club|add|remove`
- `comvenio booking stats object|guests`
- Felder und Werte: `comvenio schema booking --json`

**object** — vollständig

- `comvenio object list`
- `comvenio object show`
- `comvenio object create`
- `comvenio object update`
- `comvenio object delete`
- `comvenio object building list|show|create|update|delete`
- `comvenio object room list|show|create|update|delete`
- `comvenio object booking-rule list|show|create|bulk|update|delete`
- `comvenio object task-rule list|show|create|update|delete`
- Felder und Werte: `comvenio schema object --json`
<!-- /gen:docs -->

## Fehler

- `PERMISSION_DENIED` — es fehlt `manage_objects` für eine Änderung an Gebäude, Raum, Objekt oder
  Regel, oder `confirm_object_bookings` für Genehmigung, Ablehnung oder eine rückwirkende Buchung.
  Siehe `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — ein Feld fehlt oder passt nicht, etwa ein fehlendes Dauerlimit bei einem
  zeitrasterbasierten Objekt oder ein unvollständiger Regel-Body. Siehe
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — die angegebene Gebäude-, Raum-, Objekt-, Regel- oder Buchungs-ID gehört zu keinem
  sichtbaren Eintrag im verbundenen Verein. Siehe `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — ein Objekt mit bestehenden Kind-Einträgen wird ohne erzwungene Kaskade gelöscht, oder
  eine Buchung überschneidet sich mit einer bestehenden Reservierung. Siehe
  `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — die Anmeldung wurde ohne den für eine Schreibaktion nötigen Scope erteilt. Siehe
  `comvenio help fehler SCOPE_REQUIRED`.
