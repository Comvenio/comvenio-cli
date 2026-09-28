---
id: turniere
kategorie: thema
domaenen: [tournament]
stichwoerter: [turniere, auslosung, spielplan, ergebnisse, tabelle, wettkampf]
---

# Turniere

## Wozu

`comvenio tournament` verwaltet Turniere über Turnierserien und ihre konkreten Ausführungen: Teilnehmer
anmelden, auslosen, Spielplan erzeugen, Ergebnisse erfassen und die Tabelle einsehen. Ein Spiel paart
Teilnehmer — Team, Einzelperson oder Doppel/Paar —, nicht zwingend ein festes Comvenio-Team.

## Voraussetzungen und Rechte

- Turniere anzulegen, zu ändern oder zu löschen sowie Teilnehmer, Auslosung, Spielplan und Ergebnisse
  zu bearbeiten ist eine Vereinsverwaltungsaufgabe und erfordert eine Anmeldung mit den entsprechenden
  Schreibrechten.
- Öffentliche Anmeldung und Zuschauer-Einsicht laufen über die Web-Oberfläche, nicht über dieses CLI.
- `--json` liefert die maschinenlesbare Ausgabe für Skripte und Agenten.
- Umfangreiche Eingaben werden als JSON-Datei mit `--file <pfad>` übergeben.

## Abläufe

### Turnierserie anlegen

1. Serie mit Titel, Sportart, Format-Familie, Vorlage, Teilnahmeart, berechtigtem Bereich und
   Regelkonfiguration anlegen.
2. Serien auflisten, einzelne ansehen, ändern oder löschen.

Der Verein wird vom CLI automatisch ergänzt.

### Ausführung aus einer Serie anlegen

Ein Turnier entsteht immer als konkrete Ausführung einer Serie — es gibt bewusst keinen zweiten,
serienlosen Weg, ein Turnier anzulegen.

1. Ausführung mit Titel, Turniermodus, Start- und Endzeitpunkt, Anmeldeschluss sowie Mindest- und
   Höchstteilnehmerzahl aus einer Serie erzeugen.
2. Ausführung optional mit einem Termin verknüpfen oder die Verknüpfung wieder entfernen.

### Turnier steuern

1. Turniere auflisten, einzelnes ansehen, ändern oder löschen.
2. Status setzen: Entwurf, Anmeldung, Auslosung, geplant, aktiv, abgeschlossen, abgesagt, archiviert.
3. Turnier starten, zurücksetzen oder eine lokale Vorschau erzeugen.

### Teilnehmer verwalten

1. Teilnehmer eines Turniers auflisten.
2. Mannschaft, Einzelperson oder Paar anmelden; der Anmeldestatus ist standardmäßig bestätigt und
   lässt sich beim Anmelden übersteuern.
3. Teilnehmer zurückziehen — annulierend vor einer Neuauslosung oder als Wertung zugunsten des
   Gegners — oder wieder einsetzen.
4. Teilnehmer vollständig entfernen (stärkere, weiche Löschung).

Ohne ausdrückliche Angabe der Rückzugsart entscheidet der aktuelle Turnierzustand über das Vorgehen.

### Auslosen

1. Auslosung mit Strategie, Geschwindigkeit, öffentlicher Sichtbarkeit, festen Zuordnungen,
   Rückrunden-Option, automatischer Trennung gleicher Vereine sowie K.-o.-Konfiguration (qualifizierte
   Teilnehmer je Gruppe, Spiel um Platz drei, vollständige Platzierungsspiele, Platzierungsmodus)
   anlegen; das erzeugt zunächst eine Auslosungs-Sitzung.
2. Auslosung bestätigen — das materialisiert die Spiele. Eine Bestätigung ist additiv.
3. Für eine vollständig neue Auslosung den zusammengesetzten Ablauf nutzen: Er setzt zurück, löscht
   alle bisherigen Spiele, legt eine neue Auslosungs-Sitzung an und bestätigt sie in einem Schritt.

Zurückgezogene Teilnehmer werden bei keiner der drei Varianten erneut gezogen.

### Spielplan erzeugen und einzelne Spiele setzen

1. Spiele eines Turniers auflisten.
2. Spielplan automatisch erzeugen — mit Spiel- und Pausendauer, Anzahl der Felder/Bahnen und erstem
   Anstoß; zunächst als Probelauf, dann verbindlich. Automatische Objektbuchungen lassen sich dabei
   abschalten.
3. Einzelnes Spiel gezielt terminieren — mit Start- und Endzeit, Ort, Status und Spielnummer.
4. Bei Bedarf einzelne Spiele löschen, alle Spiele einer Phase (Gruppenphase, Finalrunde oder
   vollständig) bereinigen, oder das gesamte Turnier zurücksetzen.

### Ergebnisse erfassen

1. Fußball- oder torbasiertes Ergebnis mit Heim- und Auswärtstoren erfassen.
2. Tennis- oder satzbasiertes Ergebnis mit Satzfolge erfassen, einschließlich Tiebreak- und
   Match-Tiebreak-Notation.
3. Sonderwertung erfassen — kampflos, Nichtantreten, Aufgabe mit Teil-Ergebnis, oder beiderseitige
   Nichtwertung. Pro Spiel ist nur eine Sonderwertung zulässig; kampflos, Nichtantreten und Aufgabe
   verlangen zusätzlich die Angabe des Siegers.

### Ergebnis-Deadline festlegen

1. Deadline für eine Phase mit einem Zeitpunkt setzen oder die Richtlinie festlegen — manuell oder
   automatische Nichtwertung.
2. Aktuelle Konfiguration und überfällige offene Spiele einsehen.

### Tabelle und Vorschau

1. Aktuelle Tabelle abrufen.
2. Lokale Vorschau erzeugen und optional direkt öffnen — sie verändert das Turnier nicht.

### Abgrenzung

Öffentliche Anmeldung und Zuschauer-Einsicht gehören zur Web-Oberfläche, nicht zu diesem CLI-Bereich.

## Beispiele

Turnierserie anlegen (`series.json`):

```json
{
  "title": "Vereins-Dartmeisterschaft",
  "description": "Jährliches Vereinsturnier",
  "sport_key": "darts",
  "format_family": "group_knockout",
  "template_key": "darts_group_knockout",
  "participation_mode": "internal",
  "eligible_scope": "club",
  "eligible_department_ids": [],
  "rules_config": {},
  "default_phase_pipeline": [],
  "is_public": true
}
```

```bash
comvenio tournament series-create --file series.json --json
comvenio tournament series-list --json
comvenio tournament series-show <series-id> --json
comvenio tournament series-update <series-id> --file series-update.json --json
comvenio tournament series-delete <series-id> --json
```

Ausführung aus einer Serie anlegen (`execution.json`):

```json
{
  "title": "Vereins-Dartmeisterschaft 2026",
  "tournament_mode": "group_knockout",
  "start_date": "2026-09-05T10:00:00+02:00",
  "end_date": "2026-09-05T20:00:00+02:00",
  "registration_deadline": "2026-08-31T23:59:59+02:00",
  "min_teams": 4,
  "max_teams": 32,
  "team_size": 1
}
```

```bash
comvenio tournament execution-create <series-id> --file execution.json --json
comvenio tournament execution-link <tournament-id> --event <event-id> --json
```

Turnier steuern:

```bash
comvenio tournament list --json
comvenio tournament show <tournament-id> --json
comvenio tournament update <tournament-id> --file tournament-update.json --json
comvenio tournament delete <tournament-id> --json
comvenio tournament status <tournament-id> --status registration --json
```

Teilnehmer anmelden:

```bash
comvenio tournament participants <tournament-id> --json
comvenio tournament mannschaft <tournament-id> --name "SV Motzing AH" --seed 1 --json
comvenio tournament participant <tournament-id> --name "Max Muster" --kind individual --json
comvenio tournament participant <tournament-id> --name "Doppel A" --kind pair --json
```

Teilnehmer zurückziehen:

```bash
comvenio tournament participant-withdraw <tournament-id> --participant <participant-id> --mode cancel --json
comvenio tournament participant-withdraw <tournament-id> --participant <participant-id> --mode walkover --json
comvenio tournament participant-reinstate <tournament-id> --participant <participant-id> --json
comvenio tournament participant-remove <tournament-id> --participant <participant-id> --json
```

Auslosen (`draw.json`):

```json
{
  "strategy": "manual",
  "speed": "normal",
  "public_show_enabled": false,
  "fixed_assignments": [
    { "participant_id": "<id-1>", "group_key": "A" },
    { "participant_id": "<id-2>", "group_key": "B" }
  ],
  "double_round": false,
  "auto_separate_same_club": true,
  "knockout_config": {
    "qualified_per_group": 2,
    "third_place_match": true,
    "play_all_placements": false,
    "placement_mode": "direct"
  }
}
```

```bash
comvenio tournament draw <tournament-id> --file draw.json --json
comvenio tournament draw-confirm <tournament-id> --json
comvenio tournament redraw <tournament-id> --file draw.json --json
```

Spielplan erzeugen:

```bash
comvenio tournament matches <tournament-id> --json
comvenio tournament schedule-generate <tournament-id> \
  --match-minutes 15 --break-minutes 3 --field-count 2 \
  --first-kickoff 2026-09-05T10:00:00+02:00 --dry-run --json

comvenio tournament schedule-generate <tournament-id> \
  --match-minutes 15 --break-minutes 3 --field-count 2 \
  --first-kickoff 2026-09-05T10:00:00+02:00 --json
```

Einzelnes Spiel terminieren und bereinigen:

```bash
comvenio tournament match-schedule <match-id> \
  --start 2026-09-05T10:00:00+02:00 \
  --end 2026-09-05T10:15:00+02:00 \
  --location "Board 1" --status proposed --match-number 1 --json

comvenio tournament match-delete <match-id> --json
comvenio tournament matches-clear <tournament-id> --phase group --json
comvenio tournament reset <tournament-id> --json
```

Ergebnisse erfassen:

```bash
comvenio tournament match-result <match-id> --home 3 --away 1 --json
comvenio tournament match-result <match-id> --sets "6:2,7:6(9:7)" --json
comvenio tournament match-result <match-id> --walkover --winner home --json
comvenio tournament match-result <match-id> --retired --winner away --sets "6:3,2:1" --json
```

Deadline festlegen:

```bash
comvenio tournament deadline <tournament-id> --phase group --at 2026-09-05T18:00:00+02:00 --json
comvenio tournament deadline <tournament-id> --policy auto_no_contest --json
comvenio tournament deadline <tournament-id> --show --json
```

Tabelle und Vorschau:

```bash
comvenio tournament standings <tournament-id> --json
comvenio tournament preview <tournament-id> --open
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**tournament** — vollständig

- `comvenio tournament series-list`
- `comvenio tournament series-show`
- `comvenio tournament series-create`
- `comvenio tournament series-update`
- `comvenio tournament series-delete`
- `comvenio tournament execution-create`
- `comvenio tournament execution-link`
- `comvenio tournament list`
- `comvenio tournament show`
- `comvenio tournament update`
- `comvenio tournament delete`
- `comvenio tournament status`
- `comvenio tournament participants`
- `comvenio tournament mannschaft`
- `comvenio tournament participant`
- `comvenio tournament participant-withdraw`
- `comvenio tournament participant-reinstate`
- `comvenio tournament participant-remove`
- `comvenio tournament start`
- `comvenio tournament matches`
- `comvenio tournament matches-clear`
- `comvenio tournament reset`
- `comvenio tournament redraw`
- `comvenio tournament standings`
- `comvenio tournament preview`
- `comvenio tournament draw`
- `comvenio tournament draw-confirm`
- `comvenio tournament schedule-generate`
- `comvenio tournament match-schedule`
- `comvenio tournament match-delete`
- `comvenio tournament match-result`
- `comvenio tournament deadline`
<!-- /gen:docs -->

## Fehler

- `PERMISSION_DENIED` — die Anmeldung trägt nicht die nötigen Schreibrechte, um Turnier, Teilnehmer,
  Auslosung, Spielplan oder Ergebnisse zu bearbeiten. Siehe `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — ein Feld fehlt oder passt nicht, etwa eine unvollständige Serie, eine
  Ergebnisangabe ohne den nötigen Sieger, oder mehr als eine Sonderwertung in einem Aufruf. Siehe
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — die angegebene Serien-, Turnier-, Teilnehmer- oder Spiel-ID gehört zu keinem
  sichtbaren Eintrag. Siehe `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — eine Aktion widerspricht dem aktuellen Turnierzustand, etwa ein Ergebnis für ein
  bereits abgeschlossenes Spiel oder eine Auslosung ohne vorherigen Reset bei bestehendem Spielplan.
  Siehe `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — die Anmeldung wurde ohne den für eine Turnier-Schreibaktion nötigen Scope
  erteilt. Siehe `comvenio help fehler SCOPE_REQUIRED`.
