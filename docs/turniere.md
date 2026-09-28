---
id: turniere
kategorie: thema
domaenen: [tournament]
stichwoerter: [turniere, auslosung, spielplan, ergebnisse, tabelle, wettkampf]
---

# Turniere

## Wozu

Die Actions der Domäne `tournament` verwalten Turniere über Turnierserien und ihre konkreten
Ausführungen: Teilnehmer anmelden, auslosen, Spielplan erzeugen, Ergebnisse erfassen und die Tabelle
einsehen. Ein Spiel paart Teilnehmer — Team, Einzelperson oder Doppel/Paar —, nicht zwingend ein festes
Comvenio-Team.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen,
zeigt `comvenio action list --json`.

- Turniere anzulegen, zu ändern oder zu löschen sowie Teilnehmer, Auslosung, Spielplan und Ergebnisse
  zu bearbeiten ist eine Vereinsverwaltungsaufgabe und erfordert eine Anmeldung mit den entsprechenden
  Schreibscopes.
- Öffentliche Anmeldung und Zuschauer-Einsicht laufen über die Web-Oberfläche, nicht über dieses CLI.
- `--json` liefert die maschinenlesbare Ausgabe für Skripte und Agenten; umfangreiche Eingaben lassen
  sich statt `--input '<json>'` auch mit `--file <pfad>` übergeben.

Eine kritische (`critical_write`) Action liefert zuerst eine Vorschau mit `preview_id` und
`confirmation_token`; erst `comvenio action confirm --preview-id … --confirmation-token …
--idempotency-key …` führt sie aus.

## Abläufe

### Turnierserie anlegen

1. Serie mit Titel, Sportart, Format-Familie, Vorlage, Teilnahmeart, berechtigtem Bereich und
   Regelkonfiguration anlegen — unkritisch.
2. Serien auflisten, einzelne ansehen — unkritisch; ändern — unkritisch; löschen — kritisch.

```bash
comvenio action call cai.tournament.03.series_create \
  --input '{"series":{"title":"Vereins-Dartmeisterschaft","description":"Jährliches Vereinsturnier","sport_key":"darts","format_family":"group_knockout","template_key":"darts_group_knockout","participation_mode":"internal","eligible_scope":"club","eligible_department_ids":[],"rules_config":{},"default_phase_pipeline":[],"is_public":true}}' --json

comvenio action call cai.tournament.01.series_list --input '{"limit":20,"offset":0}' --json
comvenio action call cai.tournament.02.series_show --input '{"series_id":"<series-id>"}' --json
comvenio action call cai.tournament.04.series_update \
  --input '{"series_id":"<series-id>","changes":{"is_public":false}}' --json

comvenio action call cai.tournament.05.series_delete --input '{"series_id":"<series-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

### Ausführung aus einer Serie anlegen

Ein Turnier entsteht immer als konkrete Ausführung einer Serie — es gibt bewusst keinen zweiten,
serienlosen Weg, ein Turnier anzulegen.

1. Ausführung mit Titel, Turniermodus, Start- und Endzeitpunkt, Anmeldeschluss sowie Mindest- und
   Höchstteilnehmerzahl aus einer Serie erzeugen — unkritisch.
2. Ausführung optional mit einem Termin verknüpfen oder die Verknüpfung wieder entfernen (`event_id`
   auf `null`) — unkritisch.

```bash
comvenio action call cai.tournament.06.execution_create \
  --input '{"series_id":"<series-id>","execution":{"title":"Vereins-Dartmeisterschaft 2026","tournament_mode":"group_knockout","start_date":"2026-09-05T10:00:00+02:00","end_date":"2026-09-05T20:00:00+02:00","registration_deadline":"2026-08-31T23:59:59+02:00","min_teams":4,"max_teams":32,"team_size":1}}' --json

comvenio action call cai.tournament.07.execution_link \
  --input '{"tournament_id":"<tournament-id>","event_id":"<event-id>"}' --json
```

### Turnier steuern

1. Turniere auflisten, einzelnes ansehen — unkritisch.
2. Ändern — unkritisch; löschen — kritisch.
3. Status setzen (Entwurf, Anmeldung, Auslosung, geplant, aktiv, abgeschlossen, abgesagt, archiviert)
   — kritisch.
4. Turnier starten oder zurücksetzen — kritisch.

```bash
comvenio action call cai.tournament.08.list --input '{"limit":20,"offset":0}' --json
comvenio action call cai.tournament.09.show \
  --input '{"tournament_id":"<tournament-id>","timezone":"Europe/Berlin"}' --json
comvenio action call cai.tournament.10.update \
  --input '{"tournament_id":"<tournament-id>","changes":{"title":"Vereins-Dartmeisterschaft 2026 — Finaltag"}}' --json

comvenio action call cai.tournament.12.status \
  --input '{"tournament_id":"<tournament-id>","status":"registration"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.tournament.19.start --input '{"tournament_id":"<tournament-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

### Teilnehmer verwalten

1. Teilnehmer eines Turniers auflisten — unkritisch.
2. Mannschaft (`cai.tournament.14.mannschaft`, Teilnehmerart fest `team`) oder Einzelperson/Paar
   (`cai.tournament.15.participant`) anmelden — unkritisch; der Anmeldestatus ist standardmäßig
   `confirmed` und lässt sich beim Anmelden übersteuern.
3. Teilnehmer zurückziehen (`mode: cancel` — annullierend vor einer Neuauslosung — oder
   `mode: walkover` — als Wertung zugunsten des Gegners) — kritisch — oder wieder einsetzen —
   unkritisch.
4. Teilnehmer vollständig entfernen (stärkere, weiche Löschung) — kritisch.

```bash
comvenio action call cai.tournament.13.participants --input '{"tournament_id":"<tournament-id>","limit":100}' --json

comvenio action call cai.tournament.14.mannschaft \
  --input '{"tournament_id":"<tournament-id>","name":"SV Motzing AH","participant_kind":"team","registration_status":"confirmed","seed":1}' --json
comvenio action call cai.tournament.15.participant \
  --input '{"tournament_id":"<tournament-id>","name":"Max Muster","participant_kind":"individual","registration_status":"confirmed"}' --json

comvenio action call cai.tournament.16.participant_withdraw \
  --input '{"tournament_id":"<tournament-id>","participant_id":"<participant-id>","mode":"walkover"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.tournament.17.participant_reinstate \
  --input '{"tournament_id":"<tournament-id>","participant_id":"<participant-id>"}' --json
comvenio action call cai.tournament.18.participant_remove \
  --input '{"tournament_id":"<tournament-id>","participant_id":"<participant-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Ohne ausdrückliche Angabe der Rückzugsart entscheidet der aktuelle Turnierzustand über das Vorgehen.

### Auslosen

1. Auslosung mit Strategie, feste Zuordnungen sowie K.-o.-Konfiguration anlegen — unkritisch; das
   erzeugt zunächst eine Auslosungs-Sitzung.
2. Auslosung bestätigen — kritisch, materialisiert die Spiele. Eine Bestätigung ist additiv.
3. Für eine vollständig neue Auslosung: `redraw` — kritisch, setzt zurück, löscht alle bisherigen
   Spiele, legt eine neue Auslosungs-Sitzung an und bestätigt sie in einem Schritt.

```bash
comvenio action call cai.tournament.26.draw \
  --input '{"tournament_id":"<tournament-id>","draw_plan":{"strategy":"manual","fixed_assignments":[{"participant_id":"<id-1>","group_key":"A"},{"participant_id":"<id-2>","group_key":"B"}],"knockout_config":{"qualified_per_group":2,"third_place_match":true,"play_all_placements":false,"placement_mode":"direct"}}}' --json

comvenio action call cai.tournament.27.draw_confirm --input '{"tournament_id":"<tournament-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.tournament.23.redraw \
  --input '{"tournament_id":"<tournament-id>","draw_plan":{"strategy":"manual"}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Zurückgezogene Teilnehmer werden bei keiner der drei Varianten erneut gezogen.

### Spielplan erzeugen und einzelne Spiele setzen

1. Spiele eines Turniers auflisten.
2. Spielplan automatisch erzeugen — mit Spiel- und Pausendauer, Anzahl der Felder/Bahnen und erstem
   Anstoß; erst mit `dry_run: true` als Probelauf, dann verbindlich — kritisch. Automatische
   Objektbuchungen lassen sich mit `auto_book: false` abschalten.
3. Einzelnes Spiel gezielt terminieren — mit Start- und Endzeit, Ort, Status und Spielnummer —
   unkritisch.
4. Bei Bedarf einzelne Spiele löschen (kritisch), alle Spiele einer Phase bereinigen (kritisch), oder
   das gesamte Turnier zurücksetzen (kritisch).

```bash
comvenio action call cai.tournament.20.matches \
  --input '{"tournament_id":"<tournament-id>","timezone":"Europe/Berlin","limit":100}' --json

comvenio action call cai.tournament.28.schedule_generate \
  --input '{"tournament_id":"<tournament-id>","match_minutes":15,"break_minutes":3,"field_count":2,"first_kickoff":"2026-09-05T10:00:00+02:00","dry_run":true}' --json

comvenio action call cai.tournament.28.schedule_generate \
  --input '{"tournament_id":"<tournament-id>","match_minutes":15,"break_minutes":3,"field_count":2,"first_kickoff":"2026-09-05T10:00:00+02:00","dry_run":false}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.tournament.29.match_schedule \
  --input '{"match_id":"<match-id>","starts_at":"2026-09-05T10:00:00+02:00","ends_at":"2026-09-05T10:15:00+02:00","location":"Board 1","match_number":1,"schedule_status":"proposed"}' --json

comvenio action call cai.tournament.30.match_delete --input '{"match_id":"<match-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
comvenio action call cai.tournament.21.matches_clear \
  --input '{"tournament_id":"<tournament-id>","phase":"group"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

### Ergebnisse erfassen

`match_result` ist unkritisch (Ergebnisse lassen sich vor der endgültigen Bestätigung des Spielplans
im Entwurf korrigieren).

1. Fußball- oder torbasiertes Ergebnis mit Heim- und Auswärtstoren erfassen.
2. Tennis- oder satzbasiertes Ergebnis über `score` mit Satzfolge erfassen, einschließlich Tiebreak-
   und Match-Tiebreak-Notation.
3. Sonderwertung erfassen — kampflos (`walkover`), Nichtantreten (`no_show`), Aufgabe (`retired`) mit
   Teil-Ergebnis, oder beiderseitige Nichtwertung (`no_contest`). Pro Spiel ist nur eine Sonderwertung
   zulässig; kampflos, Nichtantreten und Aufgabe verlangen zusätzlich `winner_side_id`.

```bash
comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"played","score_home":3,"score_away":1}' --json

comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"walkover","winner_side_id":"home"}' --json

comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"retired","winner_side_id":"away","score":{"sets":"6:3,2:1"}}' --json
```

### Ergebnis-Deadline festlegen

1. Aktuelle Konfiguration einsehen (`show`, unkritisch).
2. Deadline für eine Phase mit einem Zeitpunkt setzen (`set_deadline`, unkritisch) oder die Richtlinie
   festlegen — manuell oder automatische Nichtwertung (`set_policy`, unkritisch).

```bash
comvenio action call cai.tournament.32.deadline \
  --input '{"operation":"show","tournament_id":"<tournament-id>","phase":"group"}' --json
comvenio action call cai.tournament.32.deadline \
  --input '{"operation":"set_deadline","tournament_id":"<tournament-id>","phase":"group","deadline_at":"2026-09-05T18:00:00+02:00"}' --json
comvenio action call cai.tournament.32.deadline \
  --input '{"operation":"set_policy","tournament_id":"<tournament-id>","policy":"auto_no_contest"}' --json
```

### Tabelle und Vorschau

1. Aktuelle Tabelle abrufen — unkritisch.
2. Lokale Vorschau als HTML erzeugen — kritisch; sie verändert das Turnier nicht, zählt aber als
   Export.

```bash
comvenio action call cai.tournament.24.standings --input '{"tournament_id":"<tournament-id>"}' --json

comvenio action call cai.tournament.25.preview \
  --input '{"tournament_id":"<tournament-id>","output_format":"html"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

### Noch nicht als Action verfügbar / Abgrenzung

Öffentliche Anmeldung und Zuschauer-Einsicht gehören zur Web-Oberfläche, nicht zu diesem
Actions-Bereich.

## Beispiele

Turnierserie anlegen und Ausführung erzeugen:

```bash
comvenio action call cai.tournament.03.series_create \
  --input '{"series":{"title":"Vereins-Dartmeisterschaft","description":"Jährliches Vereinsturnier","sport_key":"darts","format_family":"group_knockout","template_key":"darts_group_knockout","participation_mode":"internal","eligible_scope":"club","eligible_department_ids":[],"rules_config":{},"default_phase_pipeline":[],"is_public":true}}' --json

comvenio action call cai.tournament.06.execution_create \
  --input '{"series_id":"<series-id>","execution":{"title":"Vereins-Dartmeisterschaft 2026","tournament_mode":"group_knockout","start_date":"2026-09-05T10:00:00+02:00","end_date":"2026-09-05T20:00:00+02:00","registration_deadline":"2026-08-31T23:59:59+02:00","min_teams":4,"max_teams":32,"team_size":1}}' --json
```

Teilnehmer anmelden und zurückziehen:

```bash
comvenio action call cai.tournament.14.mannschaft \
  --input '{"tournament_id":"<tournament-id>","name":"SV Motzing AH","participant_kind":"team","registration_status":"confirmed","seed":1}' --json

comvenio action call cai.tournament.16.participant_withdraw \
  --input '{"tournament_id":"<tournament-id>","participant_id":"<participant-id>","mode":"walkover"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Auslosen und bestätigen:

```bash
comvenio action call cai.tournament.26.draw \
  --input '{"tournament_id":"<tournament-id>","draw_plan":{"strategy":"manual","fixed_assignments":[{"participant_id":"<id-1>","group_key":"A"},{"participant_id":"<id-2>","group_key":"B"}],"knockout_config":{"qualified_per_group":2,"third_place_match":true,"play_all_placements":false,"placement_mode":"direct"}}}' --json
comvenio action call cai.tournament.27.draw_confirm --input '{"tournament_id":"<tournament-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Spielplan erzeugen (Probelauf, dann verbindlich):

```bash
comvenio action call cai.tournament.28.schedule_generate \
  --input '{"tournament_id":"<tournament-id>","match_minutes":15,"break_minutes":3,"field_count":2,"first_kickoff":"2026-09-05T10:00:00+02:00","dry_run":true}' --json
comvenio action call cai.tournament.28.schedule_generate \
  --input '{"tournament_id":"<tournament-id>","match_minutes":15,"break_minutes":3,"field_count":2,"first_kickoff":"2026-09-05T10:00:00+02:00","dry_run":false}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Ergebnisse erfassen:

```bash
comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"played","score_home":3,"score_away":1}' --json
comvenio action call cai.tournament.31.match_result \
  --input '{"match_id":"<match-id>","result_type":"walkover","winner_side_id":"home"}' --json
```

Deadline festlegen und Tabelle abrufen:

```bash
comvenio action call cai.tournament.32.deadline \
  --input '{"operation":"set_deadline","tournament_id":"<tournament-id>","phase":"group","deadline_at":"2026-09-05T18:00:00+02:00"}' --json
comvenio action call cai.tournament.24.standings --input '{"tournament_id":"<tournament-id>"}' --json
```

## Befehle und Actions

<!-- gen:docs befehle -->

**tournament**

- `cai.tournament.01.series_list` — list (lesen) · Scopes: `event.read`
- `cai.tournament.02.series_show` — show (lesen) · Scopes: `event.read`
- `cai.tournament.03.series_create` — create (ändern) · Scopes: `event.write`
- `cai.tournament.04.series_update` — update (ändern) · Scopes: `event.write`
- `cai.tournament.05.series_delete` — delete (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.06.execution_create` — create (ändern) · Scopes: `event.write`
- `cai.tournament.07.execution_link` — link (ändern) · Scopes: `event.write`
- `cai.tournament.08.list` — list (lesen) · Scopes: `event.read`
- `cai.tournament.09.show` — show (lesen) · Scopes: `event.read`
- `cai.tournament.10.update` — update (ändern) · Scopes: `event.write`
- `cai.tournament.11.delete` — delete (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.12.status` — set (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.13.participants` — list (lesen) · Scopes: `event.read`
- `cai.tournament.14.mannschaft` — create (ändern) · Scopes: `event.write`
- `cai.tournament.15.participant` — create (ändern) · Scopes: `event.write`
- `cai.tournament.16.participant_withdraw` — withdraw (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.17.participant_reinstate` — reinstate (ändern) · Scopes: `event.write`
- `cai.tournament.18.participant_remove` — remove (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.19.start` — start (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.20.matches` — list (ändern) · Scopes: `event.write`
- `cai.tournament.21.matches_clear` — clear (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.22.reset` — reset (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.23.redraw` — redraw (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.24.standings` — show (lesen) · Scopes: `event.read`
- `cai.tournament.25.preview` — export (ändern mit Bestätigung) · Scopes: `event.read`, `files.export`
- `cai.tournament.26.draw` — create (ändern) · Scopes: `event.write`
- `cai.tournament.27.draw_confirm` — confirm (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.28.schedule_generate` — generate (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.29.match_schedule` — set (ändern) · Scopes: `event.write`
- `cai.tournament.30.match_delete` — delete (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.tournament.31.match_result` — set (ändern) · Scopes: `event.write`
- `cai.tournament.32.deadline` — show, set_deadline, set_policy (lesen, ändern) · Scopes: `event.read`, `event.write`
<!-- /gen:docs -->

## Fehler

- `PERMISSION_DENIED` — die Anmeldung trägt nicht die nötigen Schreibrechte, um Turnier, Teilnehmer,
  Auslosung, Spielplan oder Ergebnisse zu bearbeiten. Siehe `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — ein Feld fehlt oder passt nicht, etwa eine unvollständige Serie, eine
  Ergebnisangabe ohne den nötigen Sieger, oder mehr als eine Sonderwertung in einem Aufruf. Siehe
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — die angegebene Serien-, Turnier-, Teilnehmer- oder Spiel-ID gehört zu keinem
  sichtbaren Eintrag. Siehe `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — eine Action widerspricht dem aktuellen Turnierzustand, etwa ein Ergebnis für ein
  bereits abgeschlossenes Spiel oder eine Auslosung ohne vorherigen Reset bei bestehendem Spielplan.
  Siehe `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — die Anmeldung wurde ohne den für eine Turnier-Schreibaction nötigen Scope
  erteilt. Siehe `comvenio help fehler SCOPE_REQUIRED`.
- `OUTCOME_UNKNOWN` — eine kritische Action (Status setzen, Starten, Zurücksetzen, Löschen, Auslosung
  bestätigen, Spielplan verbindlich erzeugen) wurde nach `action confirm` nicht eindeutig bestätigt;
  vor einer Wiederholung erst mit einem Lesebefehl den Stand prüfen. Siehe
  `comvenio help fehler OUTCOME_UNKNOWN`.
- `OAUTH_ONLY` — ein alter, klassischer Befehl (`comvenio tournament …`) läuft nicht mehr; die
  entsprechende Action verwenden. Siehe `comvenio help fehler OAUTH_ONLY`.
