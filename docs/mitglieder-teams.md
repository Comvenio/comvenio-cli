---
id: mitglieder-teams
kategorie: thema
domaenen: [member, team]
stichwoerter: [mitglieder, teams, mannschaften, kader, familien, mitgliedsstatus, saison, ressourcen-prioritäten]
---

# Mitglieder und Teams

## Wozu

Über die Actions der Domänen `member`, `team` und `teams` verwaltet ein Verein seine Mitglieder, Familien,
Mitgliedsstatus und Mitgliedschaftszeiträume sowie die dauerhaften Team-Stammdaten samt Kader und
Ressourcen-Prioritäten, dazu die saisonale Mannschaftsverwaltung — Saisons, Saison-Kader, Wettbewerbe,
iCal-Synchronisation und Mannschaftstermine.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen,
zeigt `comvenio action list --json`.

- Mitglieder, Teams, Kader und Ressourcen-Prioritäten lesen erfordert die Mitglieder-Sichtberechtigung
  im Verein.
- Mitglieder, Familien, Mitgliedsstatus, Mitgliedschaftszeiträume und Team-Stammdaten anlegen, ändern
  oder löschen erfordert das Recht `manage_members` im Verein.
- `--json` liefert die unveränderte Antwort für Skripte und Agenten.
- Umfangreiche Eingaben lassen sich statt `--input '<json>'` auch mit `--file <pfad>` (UTF-8-JSON)
  übergeben.

## Abläufe

### Mitglieder verwalten

1. Mitglieder auflisten oder ein einzelnes ansehen.
2. Neues Mitglied mit Vor- und Nachname sowie E-Mail-Adresse anlegen.
3. Mitglied ändern oder entfernen (Entfernen ist kritisch: erst Vorschau, dann Bestätigung).

```bash
comvenio action call cai.member.01.list --input '{"limit":20,"offset":0}' --json
comvenio action call cai.member.02.show --input '{"member_id":"<member-id>"}' --json
comvenio action call cai.member.03.add \
  --input '{"member":{"first_name":"Max","last_name":"Muster","email":"max@example.org"}}' --json
comvenio action call cai.member.04.update \
  --input '{"member_id":"<member-id>","changes":{"phone_number":"+49 123 456789"}}' --json
comvenio action call cai.member.05.remove --input '{"member_id":"<member-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

`member.add` kann zusätzlich `membership_status_id` und `family_id` setzen. Diese beiden Verknüpfungen
lassen sich über ein späteres Update nicht mehr ändern — dafür bestehen die eigenen Status- und
Zeitraum-Abläufe unten.

### Mitglieder im Bulk importieren

1. Importdatei zuvor hochladen (siehe Artikel „DataShare — Dateien, Ordner und Papers") und die
   Datei-Kennung notieren.
2. Import mit dieser Datei-Kennung auslösen — kritisch: Vorschau prüfen, dann bestätigen.

```bash
comvenio action call cai.member.06.import --input '{"file_id":"<file-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

### Familien

1. Familien auflisten oder eine einzelne ansehen.
2. Familie mit Name und verantwortlichem Mitglied anlegen, ändern.
3. Familie löschen — kritisch.

```bash
comvenio action call cai.member.07.family_list --input '{}' --json
comvenio action call cai.member.08.family_show --input '{"family_id":"<family-id>"}' --json
comvenio action call cai.member.09.family_add \
  --input '{"family":{"name":"Familie Muster","notes":"Familienbeitrag","responsible_member_id":"<member-id>"}}' --json
comvenio action call cai.member.10.family_update \
  --input '{"family_id":"<family-id>","changes":{"notes":"Neue Notiz"}}' --json
comvenio action call cai.member.11.family_delete --input '{"family_id":"<family-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

Pflichtfelder beim Anlegen: Name und verantwortliches Mitglied.

### Mitgliedsstatus

1. Status auflisten, ansehen, anlegen oder ändern.
2. Status löschen — kritisch.

```bash
comvenio action call cai.member.12.status_list --input '{}' --json
comvenio action call cai.member.13.status_show --input '{"status_id":"<status-id>"}' --json
comvenio action call cai.member.14.status_add \
  --input '{"status":{"name":"Aktiv","description":"Aktives Vereinsmitglied","is_discount_eligible":false,"priority":100}}' --json
comvenio action call cai.member.15.status_update \
  --input '{"status_id":"<status-id>","changes":{"priority":80}}' --json
comvenio action call cai.member.16.status_delete --input '{"status_id":"<status-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

Statuswerte wie „Aktiv" sind vereinseigene Datensätze mit Name, Beschreibung, Rabattfähigkeit und
Priorität — kein festes, vereinsübergreifend vorgegebenes Set.

### Mitgliedschaftszeiträume

1. Zeiträume eines Mitglieds auflisten oder einen einzelnen ansehen.
2. Zeitraum mit Eintrittsdatum anlegen, bei Bedarf mit Austrittsdatum, Grund und Notiz; ändern.
3. Zeitraum löschen — kritisch.

```bash
comvenio action call cai.member.17.period_list --input '{"member_id":"<member-id>"}' --json
comvenio action call cai.member.18.period_show --input '{"period_id":"<period-id>"}' --json
comvenio action call cai.member.19.period_add \
  --input '{"period":{"member_id":"<member-id>","joined_at":"2020-01-01","note":"Wiedereintritt"}}' --json
comvenio action call cai.member.20.period_update \
  --input '{"period_id":"<period-id>","changes":{"left_at":"2026-06-30","reason":"Kündigung"}}' --json
comvenio action call cai.member.21.period_delete --input '{"period_id":"<period-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

### Teams verwalten (Stammdaten)

1. Teams des Vereins auflisten oder ein Team mit Kader und Ressourcen-Prioritäten ansehen.
2. Team mit Abteilung, Name und Sportart anlegen; teilweise ändern.
3. Team löschen — kritisch.

```bash
comvenio action call cai.team.01.list --input '{}' --json
comvenio action call cai.team.02.show --input '{"team_id":"<team-id>"}' --json
comvenio action call cai.team.03.create \
  --input '{"team":{"department_id":"<department-id>","name":"Dart 1","sport_type":"OTHER","gender":"MIXED","season":"2026/27","required_resource_count":2,"buffer_before_minutes":30,"buffer_after_minutes":15}}' --json
comvenio action call cai.team.04.update \
  --input '{"team_id":"<team-id>","changes":{"name":"Dart Erste","home_location":"Vereinsheim","required_resource_count":3}}' --json
comvenio action call cai.team.05.delete --input '{"team_id":"<team-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

Gültige Sportarten: `FOOTBALL`, `HANDBALL`, `BASKETBALL`, `VOLLEYBALL`, `TENNIS`, `TABLE_TENNIS`,
`OTHER`. Geschlecht: `MALE`, `FEMALE`, `MIXED`.

### Kader eines Teams

Diese Action ist als Ganzes kritisch — auch das Lesen des Kaders zeigt zuerst eine Vorschau und
verlangt eine Bestätigung.

```bash
comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"list","team_id":"<team-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"add","team_id":"<team-id>","member_id":"<member-id>","role":"PLAYER"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"update","team_id":"<team-id>","member_id":"<member-id>","changes":{"role":"CAPTAIN"}}' --json
comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"remove","team_id":"<team-id>","member_id":"<member-id>"}' --json
```

`member_id` ist die Mitglieds-ID im Verein, nicht die Benutzer-ID. Eine doppelte Zuordnung desselben
Mitglieds zum selben Team weist Comvenio als Konflikt zurück. Rollen: `PLAYER`, `CAPTAIN`, `COACH`,
`ASSISTANT_COACH`, `MANAGER`; optional zusätzlich Rückennummer (`jersey_number`) und Position.

### Ressourcen-Prioritäten

Ressourcen-Prioritäten ordnen einem Team buchbare Objekte zu, etwa Hallen, Plätze oder Equipment. Auch
diese Action ist als Ganzes kritisch — jede Teilaktion verlangt Vorschau und Bestätigung.

```bash
comvenio action call cai.team.07.resource_list_add_update_remove \
  --input '{"operation":"list","team_id":"<team-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.team.07.resource_list_add_update_remove \
  --input '{"operation":"add","team_id":"<team-id>","object_id":"<object-id>","priority":1,"booking_duration_minutes":120,"notes":"Dienstagstraining"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

### Saisonale Mannschaften

Die saisonale Mannschaftsverwaltung ergänzt die dauerhaften Team-Stammdaten um Saisons mit Lebenszyklus
Entwurf → Aktiv → Abgeschlossen, Saison-Kader, Wettbewerbe, iCal-Abonnements,
Spielplan-Synchronisation und Mannschaftstermine — sie ersetzt die Stammdaten nicht. Lesen ist ohne
Bestätigung möglich; alles, was ändert, ist kritisch und läuft über Vorschau und
`comvenio action confirm`.

1. Mannschaften auflisten (`cai.teams.01.list`, optional mit `department_id`), eine ansehen
   (`cai.teams.02.show`), anlegen (`cai.teams.03.create` mit `department_id`, `name`, `sport_type`),
   ändern (`cai.teams.04.update`, nur geänderte Felder unter `changes`) oder archivieren
   (`cai.teams.05.archive`).
2. Saisons einer Mannschaft auflisten (`cai.teams.06.season_list`), anlegen (`cai.teams.07.season_create`
   mit `name`, optional `starts_on`, `ends_on`, `default_visibility` `PUBLIC` oder `MEMBERS`), korrigieren
   (`cai.teams.08.season_correct`), aktivieren (`cai.teams.09.season_activate`) und abschließen
   (`cai.teams.10.season_complete`).
3. Saison-Kader pflegen: auflisten (`cai.teams.11.roster_list`), Mitglied aufnehmen
   (`cai.teams.12.roster_add` mit `member_id`, optional `role` `PLAYER`, `CAPTAIN`, `COACH`,
   `ASSISTANT_COACH`, `MANAGER`, `jersey_number`, `position`), ändern (`cai.teams.13.roster_update`),
   entfernen (`cai.teams.14.roster_remove`). Kader aus einer Vorsaison übernehmen: erst
   `cai.teams.15.roster_carry_over_preview` mit `source_season_id` ansehen, dann
   `cai.teams.16.roster_carry_over` mit den gewählten `member_ids`.
4. Wettbewerbe der Saison: auflisten (`cai.teams.17.competition_list`), anlegen
   (`cai.teams.18.competition_create`, `type` `LEAGUE`, `CUP`, `FRIENDLY`, `TOURNAMENT`, `OTHER`),
   ändern (`cai.teams.19.competition_update`), löschen (`cai.teams.20.competition_delete`).
5. Spielplan per iCal abonnieren: Abonnements auflisten (`cai.teams.21.ical_list`), mit `url` anlegen
   (`cai.teams.22.ical_create`), Vorschau erzeugen (`cai.teams.23.ical_preview`) und mit deren
   `preview_token` aktivieren (`cai.teams.24.ical_activate`); abschalten mit `cai.teams.25.ical_deactivate`.
6. Synchronisation sofort anstoßen (`cai.teams.26.sync_now`), Läufe ansehen (`cai.teams.27.sync_runs`
   mit `limit`, `offset`), offene Klärungen auflisten (`cai.teams.28.clarification_list`) und entscheiden
   (`cai.teams.29.clarification_resolve` mit `resolution`, etwa
   `{"type":"POSSIBLE_DUPLICATE","action":"KEEP_EXISTING"}`).
7. Mannschaftstermine auflisten (`cai.teams.30.termin_list`) und anlegen (`cai.teams.31.termin_create`,
   `kind` `MATCH`, `TRAINING`, `EXCURSION`, `OTHER`, dazu `start_time`; ein Spiel braucht `opponent`;
   Wiederholung über `repeat` mit Wochentagen). Einen von Hand angelegten Termin ändern
   (`cai.teams.32.termin_update` mit `event_id`). Es ändern sich die gesendeten Felder; ein neuer
   Beginn ohne Ende verschiebt das Ende mit, die Dauer bleibt. `null` leert Gegner, Heimrecht,
   Wettbewerb, Ort und Notiz (ein Spiel braucht Gegner und Heimrecht). Den Titel baut der Dienst
   bei einem Spiel immer aus Gegner und Heimrecht neu, auch wenn `termin` leer ist;
   bei den anderen Arten nur, wenn `title` mitkommt. Er steht dann mit dem Mannschaftsnamen davor
   („F-Jugend: …“). Bei einem Serientermin gilt `scope`: `THIS` ändert dieses Vorkommen — Gegner,
   Heimrecht, Wettbewerb und Ankündigung gehören aber zur ganzen Serie: Ein geänderter Wert wird mit
   `THIS` abgelehnt (422 `TERMIN_SERIES_FIELD_NEEDS_FOLLOWING`), derselbe Wert geht durch;
   `FOLLOWING` beendet die Serie vor diesem Vorkommen und legt ab hier eine neue an, die Folgetermine
   bekommen dabei neue Kennungen. Zeitpunkte als ISO-Zeitpunkt mit Zeitzone, etwa
   `2026-09-12T15:00:00+02:00` für 15 Uhr deutscher Sommerzeit. Welche Saison gerade läuft, zeigt
   `cai.teams.06.season_list` (Status `AKTIV`); deren `id` ist die `team_season_id`.

```bash
comvenio action call cai.teams.06.season_list --input '{"team_id":"<team-id>"}' --json

comvenio action call cai.teams.12.roster_add \
  --input '{"team_season_id":"<saison-id>","member_id":"<member-id>","role":"CAPTAIN","jersey_number":7}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.teams.07.season_create \
  --input '{"team_id":"<team-id>","season":{"name":"Saison 2026/27","starts_on":"2026-08-01","ends_on":"2027-06-30"}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.teams.31.termin_create \
  --input '{"team_season_id":"<saison-id>","termin":{"kind":"MATCH","opponent":"SV Beispiel","home_state":"HOME","start_time":"2026-09-12T15:00:00+02:00"}}' --json

comvenio action call cai.teams.32.termin_update \
  --input '{"team_season_id":"<saison-id>","event_id":"<termin-id>","termin":{"location":"Sportplatz Motzing"}}' --json
```

## Beispiele

Mitglied anlegen und ändern:

```bash
comvenio action call cai.member.01.list --input '{"limit":20,"offset":0}' --json
comvenio action call cai.member.03.add \
  --input '{"member":{"first_name":"Max","last_name":"Muster","email":"max@example.org"}}' --json
comvenio action call cai.member.04.update \
  --input '{"member_id":"<member-id>","changes":{"phone_number":"+49 123 456789"}}' --json
```

Familie anlegen:

```bash
comvenio action call cai.member.09.family_add \
  --input '{"family":{"name":"Familie Muster","notes":"Familienbeitrag","responsible_member_id":"<member-id>"}}' --json
```

Mitgliedsstatus anlegen:

```bash
comvenio action call cai.member.14.status_add \
  --input '{"status":{"name":"Aktiv","description":"Aktives Vereinsmitglied","is_discount_eligible":false,"priority":100}}' --json
```

Mitgliedschaftszeitraum anlegen:

```bash
comvenio action call cai.member.19.period_add \
  --input '{"period":{"member_id":"<member-id>","joined_at":"2020-01-01","note":"Wiedereintritt"}}' --json
```

Team anlegen, Kader und Ressourcen-Priorität pflegen:

```bash
comvenio action call cai.team.03.create \
  --input '{"team":{"department_id":"<department-id>","name":"Dart 1","sport_type":"OTHER","gender":"MIXED","season":"2026/27","required_resource_count":2,"buffer_before_minutes":30,"buffer_after_minutes":15}}' --json

comvenio action call cai.team.06.member_list_add_update_remove \
  --input '{"operation":"add","team_id":"<team-id>","member_id":"<member-id>","role":"PLAYER"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.team.07.resource_list_add_update_remove \
  --input '{"operation":"add","team_id":"<team-id>","object_id":"<object-id>","priority":1,"booking_duration_minutes":120,"notes":"Dienstagstraining"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token=<token> \
  --idempotency-key <schlüssel> --json
```

## Befehle und Actions

<!-- gen:docs befehle -->

**member**

- `cai.member.01.list` — list (lesen) · Scopes: `member.read.basic`
- `cai.member.02.show` — show (lesen) · Scopes: `member.read.details`
- `cai.member.03.add` — add (ändern) · Scopes: `admin.write`
- `cai.member.04.update` — update (ändern) · Scopes: `admin.write`
- `cai.member.05.remove` — remove (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.member.06.import` — import (ändern mit Bestätigung) · Scopes: `files.import`
- `cai.member.07.family_list` — family-list (lesen) · Scopes: `member.read.details`
- `cai.member.08.family_show` — family-show (lesen) · Scopes: `member.read.details`
- `cai.member.09.family_add` — family-add (ändern) · Scopes: `admin.write`
- `cai.member.10.family_update` — family-update (ändern) · Scopes: `admin.write`
- `cai.member.11.family_delete` — family-delete (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.member.12.status_list` — status-list (lesen) · Scopes: `member.read.basic`
- `cai.member.13.status_show` — status-show (lesen) · Scopes: `member.read.details`
- `cai.member.14.status_add` — status-add (ändern) · Scopes: `admin.write`
- `cai.member.15.status_update` — status-update (ändern) · Scopes: `admin.write`
- `cai.member.16.status_delete` — status-delete (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.member.17.period_list` — period-list (lesen) · Scopes: `member.read.basic`
- `cai.member.18.period_show` — period-show (lesen) · Scopes: `member.read.details`
- `cai.member.19.period_add` — period-add (ändern) · Scopes: `admin.write`
- `cai.member.20.period_update` — period-update (ändern) · Scopes: `admin.write`
- `cai.member.21.period_delete` — period-delete (ändern mit Bestätigung) · Scopes: `admin.write`
- Felder und Werte: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"member"}'` (`club_id` setzt die Anmeldung — nie in `--input`)

**team**

- `cai.team.01.list` — list (lesen) · Scopes: `club.read`
- `cai.team.02.show` — show (lesen) · Scopes: `club.read`
- `cai.team.03.create` — create (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.team.04.update` — update (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.team.05.delete` — delete (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.team.06.member_list_add_update_remove` — member list|add|update|remove (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.team.07.resource_list_add_update_remove` — resource list|add|update|remove (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.01.list` — list (lesen) · Scopes: `club.read`
- `cai.teams.02.show` — show (lesen) · Scopes: `club.read`
- `cai.teams.03.create` — create (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.04.update` — update (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.05.archive` — archive (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.06.season_list` — season list (lesen) · Scopes: `club.read`
- `cai.teams.07.season_create` — season create (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.08.season_correct` — season update (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.09.season_activate` — season activate (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.10.season_complete` — season complete (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.11.roster_list` — roster show (lesen) · Scopes: `club.read`
- `cai.teams.12.roster_add` — roster add (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.13.roster_update` — roster update (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.14.roster_remove` — roster remove (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.15.roster_carry_over_preview` — roster carry-over --preview (lesen) · Scopes: `club.read`
- `cai.teams.16.roster_carry_over` — roster carry-over (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.17.competition_list` — competition list (lesen) · Scopes: `club.read`
- `cai.teams.18.competition_create` — competition create (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.19.competition_update` — competition update (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.20.competition_delete` — competition delete (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.21.ical_list` — ical list (lesen) · Scopes: `club.read`
- `cai.teams.22.ical_create` — ical create (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.23.ical_preview` — ical preview (ändern) · Scopes: `admin.write`
- `cai.teams.24.ical_activate` — ical activate (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.25.ical_deactivate` — ical deactivate (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.26.sync_now` — sync now (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.27.sync_runs` — sync runs (lesen) · Scopes: `club.read`
- `cai.teams.28.clarification_list` — sync clarifications (lesen) · Scopes: `club.read`
- `cai.teams.29.clarification_resolve` — sync resolve (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.teams.30.termin_list` — termin list (lesen) · Scopes: `club.read`
- `cai.teams.31.termin_create` — termin create (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.teams.32.termin_update` — termin update (ändern mit Bestätigung) · Scopes: `club.write`
- Felder und Werte: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"team"}'` (`club_id` setzt die Anmeldung — nie in `--input`)
<!-- /gen:docs -->

## Fehler

- `PERMISSION_DENIED` — die Vereinsrolle erlaubt das Anlegen, Ändern oder Löschen von Mitgliedern,
  Familien, Teams oder Kadereinträgen nicht, obwohl die Anmeldung die nötigen Scopes trägt. Siehe
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — ein Feld in der Eingabe fehlt, ist nicht erlaubt oder hat das falsche Format,
  etwa beim Anlegen eines Mitglieds, einer Familie oder eines Teams. Siehe
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — die angegebene Mitglieds-, Familien-, Team- oder Kader-ID gehört zu keinem sichtbaren
  Eintrag im verbundenen Verein. Siehe `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — ein Mitglied ist bereits demselben Team zugeordnet, oder eine Änderung widerspricht dem
  aktuellen Zustand. Siehe `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — die Anmeldung wurde ohne den für eine Schreibaktion nötigen Scope erteilt. Siehe
  `comvenio help fehler SCOPE_REQUIRED`.
- `OUTCOME_UNKNOWN` — eine kritische Action (Löschen, Kader- oder Ressourcen-Prioritäts-Änderungen)
  wurde nach `action confirm` nicht eindeutig bestätigt; vor einer Wiederholung erst mit einem
  Lesebefehl den Stand prüfen. Siehe `comvenio help fehler OUTCOME_UNKNOWN`.
- `USAGE_ERROR` — ein Befehl, den es im CLI nicht mehr gibt; mit `comvenio action list` die
  passende Action suchen. Siehe `comvenio help fehler USAGE_ERROR`.
