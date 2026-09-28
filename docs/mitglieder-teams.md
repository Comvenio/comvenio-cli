---
id: mitglieder-teams
kategorie: thema
domaenen: [member, team]
stichwoerter: [mitglieder, teams, mannschaften, kader, familien, mitgliedsstatus, saison, ressourcen-prioritäten]
---

# Mitglieder und Teams

## Wozu

Mit `comvenio member` und `comvenio team` verwaltet ein Verein seine Mitglieder, Familien,
Mitgliedsstatus und Mitgliedschaftszeiträume sowie die dauerhaften Team-Stammdaten samt Kader und
Ressourcen-Prioritäten. `comvenio teams` ergänzt das um die saisonale Mannschaftsverwaltung: Saisons
mit Lebenszyklus, Saison-Kader, Wettbewerbe, iCal-Abonnements, Spielplan-Synchronisation und
Mannschaftstermine.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

- Mitglieder, Teams, Kader und Ressourcen-Prioritäten lesen erfordert die Mitglieder-Sichtberechtigung
  im Verein.
- Mitglieder, Familien, Mitgliedsstatus, Mitgliedschaftszeiträume und Team-Stammdaten anlegen, ändern
  oder löschen erfordert das Recht `manage_members` im Verein.
- Mannschaftstermine anlegen oder ändern erfordert das Saisonrecht (Mannschaften verwalten) oder die
  Rolle als aktiver Trainer oder Teammanager der Saison.
- `--club <club-id>` überschreibt den Verein aus der lokalen Anmeldung.
- `--json` liefert die unveränderte Antwort für Skripte und Agenten.
- Umfangreiche Eingaben werden als UTF-8-JSON-Datei mit `--file <pfad>` übergeben.

## Abläufe

### Mitglieder verwalten

1. Mitglieder auflisten oder ein einzelnes ansehen.
2. Neues Mitglied mit Vor- und Nachname sowie E-Mail-Adresse anlegen.
3. Mitglied ändern oder entfernen.

`member add` kann zusätzlich einen Mitgliedsstatus und eine Familie zuordnen. Diese beiden
Verknüpfungen lassen sich über ein späteres Update nicht mehr ändern — dafür bestehen die eigenen
Status- und Familien-Zeitraum-Abläufe.

### Familien

1. Familien auflisten oder eine einzelne ansehen.
2. Familie mit Name und verantwortlichem Mitglied anlegen.
3. Familie ändern oder löschen.

```bash
comvenio member family-list --json
comvenio member family-show <family-id> --json
comvenio member family-add --file family.json --json
comvenio member family-update <family-id> --file family-update.json --json
comvenio member family-delete <family-id> --json
```

Der Verein wird beim Anlegen automatisch aus dem angemeldeten Kontext gesetzt.

### Mitgliedsstatus

1. Status auflisten, ansehen, anlegen, ändern oder löschen.

```bash
comvenio member status-list --json
comvenio member status-show <status-id> --json
comvenio member status-add --file status.json --json
comvenio member status-update <status-id> --file status-update.json --json
comvenio member status-delete <status-id> --json
```

Statuswerte wie „Aktiv" sind vereinseigene Datensätze mit Name, Beschreibung, Rabattfähigkeit und
Priorität — kein festes, vereinsübergreifend vorgegebenes Set.

### Mitgliedschaftszeiträume

1. Zeiträume eines Mitglieds auflisten oder einen einzelnen ansehen.
2. Zeitraum mit Eintrittsdatum anlegen, bei Bedarf mit Austrittsdatum, Grund und Notiz.
3. Zeitraum ändern oder löschen.

```bash
comvenio member period-list <member-id> --json
comvenio member period-show <period-id> --json
comvenio member period-add --file period.json --json
comvenio member period-update <period-id> --file period-update.json --json
comvenio member period-delete <period-id> --json
```

Beim Anlegen ergänzt das CLI den Verein automatisch aus dem Kontext; ein Update darf Eintritts- und
Austrittsdatum, Grund und Notiz enthalten.

### Mitglieder im Bulk importieren

1. Importdatei mit `preview: true` vorbereiten und probeweise einlesen.
2. Ergebnis der Vorschau prüfen.
3. Erst nach geprüfter Vorschau den echten Import auslösen; `reconcile_absent_members: true`
   markiert fehlende Bestandsmitglieder als ausgetreten und gehört deshalb nur in diesen zweiten
   Schritt.

Der Verein in der Importdatei wird ignoriert und durch den angemeldeten Verein ersetzt.

### Teams verwalten (Stammdaten)

1. Teams des Vereins auflisten oder ein Team mit Kader und Ressourcen-Prioritäten ansehen.
2. Team mit Abteilung, Name und Sportart anlegen.
3. Team teilweise ändern oder entfernen.

| Zweck | Befehl |
|---|---|
| Teams des Vereins | `comvenio team list` |
| Team mit Kader und Prioritäten | `comvenio team show <team-id>` |
| Team anlegen | `comvenio team create --file team.json` |
| Team ändern | `comvenio team update <team-id> --file patch.json` |
| Team entfernen | `comvenio team delete <team-id>` |

Gültige Sportarten: Fußball, Tennis, Handball, Basketball, Volleyball, Tischtennis, Sonstiges.
Geschlecht: männlich, weiblich, gemischt.

### Kader eines Teams

1. Kader lesen.
2. Mitglied mit Rolle (Spieler, Kapitän, Trainer, Co-Trainer, Manager) hinzufügen, optional mit
   Rückennummer und Position.
3. Zuordnung ändern oder entfernen.

`member_id` ist die Mitglieds-ID im Verein, nicht die Benutzer-ID. Eine doppelte Zuordnung desselben
Mitglieds zum selben Team weist Comvenio als Konflikt zurück.

### Ressourcen-Prioritäten

Ressourcen-Prioritäten ordnen einem Team buchbare Objekte zu, etwa Hallen, Plätze oder Equipment.

1. Prioritäten eines Teams lesen.
2. Priorität anlegen mit Objekt und Rang (Standard 1), Buchungsdauer in Minuten (Standard 120) und
   optionaler Notiz.
3. Priorität ändern oder entfernen.

| Zweck | Befehl |
|---|---|
| Prioritäten lesen | `comvenio team resource list <team-id>` |
| Priorität anlegen | `comvenio team resource add <team-id> --object-id <id> --priority 1` |
| Priorität ändern | `comvenio team resource update <team-id> --priority-id <id> --priority 2` |
| Priorität entfernen | `comvenio team resource remove <team-id> --priority-id <id>` |

### Saisonale Mannschaften (`comvenio teams`)

Der Namespace `comvenio teams` ist die saisonale Mannschaftsverwaltung. Er ergänzt die dauerhaften
Team-Stammdaten um Saisons mit Lebenszyklus Entwurf → Aktiv → Abgeschlossen, Saison-Kader,
Wettbewerbe, iCal-Abonnements und Spielplan-Synchronisation — und ersetzt die Stammdaten nicht.

1. Mannschaft anlegen, anzeigen, auflisten (optional gefiltert nach Abteilung, mit oder ohne
   Unterabteilungen), ändern oder archivieren.
2. Saison einer Mannschaft anlegen, anzeigen, auflisten, nachträglich korrigieren sowie aktivieren
   oder abschließen.
3. Saison-Kader aufnehmen, ändern, austragen; Kader einer Vorsaison per Vorschau prüfen oder gezielt
   übernehmen.
4. Wettbewerbe der Saison anlegen, auflisten, ändern oder entfernen.
5. iCal-Quelle anlegen, per Vorschau prüfen, aktivieren, deaktivieren.
6. Synchronisation sofort auslösen, den Sync-Verlauf einsehen; Klärungsfälle aus der Synchronisation
   auflisten und auflösen.
7. Mannschaftstermine — Training, Spiel, Ausflug, Sonstiges — eintragen, ändern, absagen oder löschen.

| Zweck | Befehl |
|---|---|
| Mannschaften listen | `comvenio teams list [--department-id <id> [--include-descendants]]` |
| Mannschaft anzeigen | `comvenio teams show <team-id>` |
| Mannschaft anlegen | `comvenio teams create --name … --department-id … --sport-type … --yes` |
| Mannschaft ändern | `comvenio teams update <team-id> … --yes` |
| Mannschaft archivieren | `comvenio teams archive <team-id> --yes` |
| Saisons listen | `comvenio teams season list <team-id>` |
| Saison anzeigen | `comvenio teams season show <season-id> --team <team-id>` |
| Saison anlegen | `comvenio teams season create <team-id> --name … --yes` |
| Saison korrigieren | `comvenio teams season update <season-id> --reason … … --yes` |
| Saison aktivieren/abschließen | `comvenio teams season activate\|complete <season-id> --yes` |
| Kader anzeigen | `comvenio teams roster show <season-id>` |
| Kadermitglied aufnehmen | `comvenio teams roster add <season-id> --member-id … --yes` |
| Kadereintrag ändern | `comvenio teams roster update <roster-id> … --yes` |
| Kadermitglied austragen | `comvenio teams roster remove <roster-id> --yes` |
| Kader-Übernahme (Vorschau) | `comvenio teams roster carry-over <season-id> --source <id> --preview` |
| Kader selektiv übernehmen | `comvenio teams roster carry-over <season-id> --source <id> [--members a,b] --yes` |
| Wettbewerbe listen | `comvenio teams competition list <season-id>` |
| Wettbewerb anlegen | `comvenio teams competition create <season-id> --name … --yes` |
| Wettbewerb ändern/entfernen | `comvenio teams competition update\|delete <competition-id> --yes` |
| iCal-Quellen listen | `comvenio teams ical list <season-id>` |
| iCal-Quelle speichern | `comvenio teams ical create <season-id> --url … --yes` |
| iCal-Vorschau | `comvenio teams ical preview <subscription-id>` |
| iCal aktivieren | `comvenio teams ical activate <subscription-id> --preview-token … --yes` |
| iCal deaktivieren | `comvenio teams ical deactivate <subscription-id> --yes` |
| Sofort synchronisieren | `comvenio teams sync now <subscription-id> --yes` |
| Sync-Verlauf | `comvenio teams sync runs <subscription-id> [--limit --offset]` |
| Klärungsfälle listen | `comvenio teams sync clarifications <season-id>` |
| Klärungsfall auflösen | `comvenio teams sync resolve <clarification-id> --file resolution.json --yes` |
| Termine der Saison | `comvenio teams termin list <season-id> [--kind training\|spiel\|ausflug\|sonstiges]` |
| Termin anzeigen | `comvenio teams termin show <season-id> <event-id>` |
| Termin eintragen | `comvenio teams termin create <season-id> --kind … --start … [--repeat di,do --until …] --yes` |
| Termin ändern | `comvenio teams termin update <season-id> <event-id> … [--scope this\|following] --yes` |
| Termin absagen | `comvenio teams termin cancel <season-id> <event-id> [--reason …] [--scope this\|following] --yes` |
| Termin löschen | `comvenio teams termin delete <season-id> <event-id> [--scope this\|series] --yes` |

Verhaltensvertrag: Jede Lese- und Schreibaktion unterstützt `--json`. Wichtige Mutationen (Anlegen,
Archivieren, Lebenszyklus-Wechsel, Aktivierung, Deaktivierung, Sofortlauf, Klärungsauflösung sowie
Kader- und Wettbewerbs-Schreibaktionen) zeigen zuerst eine vollständige Zusammenfassung und schreiben
ohne ausdrückliche Bestätigung nichts. Saisonbezogene Schreibaktionen verlangen immer die konkrete
Ziel-ID, nie einen Sammel-Scope. iCal-Quell-URLs erscheinen in Ausgaben und Zusammenfassungen nur
maskiert.

Die Aktivierung einer iCal-Quelle folgt immer derselben Kette: Quelle anlegen → Vorschau abrufen
(liefert einen kurzlebigen Vorschau-Token) → mit diesem Token aktivieren. Ändert sich das Abonnement,
verfällt der Token; die Vorschau muss dann neu abgerufen werden. Ein Klärungsfall wird mit Art und
Maßnahme aufgelöst, zum Beispiel eine mehrdeutige Heimrolle mit Bestätigung und dem zusätzlichen
Hinweis, die Ressourcenzuordnung danach neu abzugleichen.

Für Mannschaftstermine gilt das Saisonrecht (Mannschaften verwalten) oder die Rolle als aktiver
Trainer oder Teammanager der Saison. Start- und Endzeit gelten in Ortszeit Berlin. Eine Wiederholung
legt eine Serie bis zu einem Enddatum oder bis Saisonende an; ein Spiel braucht zusätzlich einen
Gegner sowie die Angabe Heim- oder Auswärtsspiel. Eine allgemeine Ankündigung lässt sich gezielt
ein- oder ausschalten. Fehlermeldungen des Dienstes erscheinen als Satz mit Code, etwa ein Hinweis,
dass einem Spiel der Gegner fehlt; fehlt das Saisonrecht, weist Comvenio die Änderung zurück, hat der
Termin bereits begonnen, meldet Comvenio einen Konflikt. Termine, die aus dem Spielplan-Abgleich
stammen, erscheinen in der Übersicht, lassen sich dort aber nicht bearbeiten.

### Abgrenzung

Externe Synchronisationen mit Verbandsplattformen (etwa Fußball- oder Tennis-Verbandsportale) und
eine interne System-zu-System-Route für Buchungsinformationen sind nicht Teil dieses CLI-Bereichs:
Provider-Importe hängen von externen Anbietern ab, die interne Route verwendet eine eigene,
nicht nutzerbezogene Authentifizierung.

Der maschinenlesbare Vertrag für Teams ist per `comvenio schema team --json` abrufbar, sobald die
Domäne im zentralen Schema-Index freigeschaltet ist.

## Beispiele

Mitglied anlegen und ändern:

```bash
comvenio member list --json
comvenio member show <member-id> --json
comvenio member add --first-name Max --last-name Muster --email max@example.org --json
comvenio member update <member-id> --phone "+49 123 456789" --json
comvenio member remove <member-id> --json
```

Familie anlegen (`family.json`):

```json
{
  "name": "Familie Muster",
  "notes": "Familienbeitrag",
  "responsible_member_id": "<member-id>"
}
```

```bash
comvenio member family-add --file family.json --json
```

Mitgliedsstatus anlegen (`status.json`):

```json
{
  "name": "Aktiv",
  "description": "Aktives Vereinsmitglied",
  "is_discount_eligible": false,
  "priority": 100
}
```

```bash
comvenio member status-add --file status.json --json
```

Mitgliedschaftszeitraum anlegen (`period.json`):

```json
{
  "member_id": "<member-id>",
  "joined_at": "2020-01-01",
  "left_at": null,
  "reason": null,
  "note": "Wiedereintritt"
}
```

```bash
comvenio member period-add --file period.json --json
```

Bulk-Import mit Vorschau (`import.json`):

```json
{
  "preview": true,
  "import_date": "2026-07-13",
  "reconcile_absent_members": false,
  "present_member_ids": [],
  "rows": [
    {
      "row_index": 1,
      "first_name": "Max",
      "last_name": "Muster",
      "email": "max@example.org",
      "joined_at": "2020-01-01",
      "membership_status_name": "Aktiv",
      "department_names": ["Dart"]
    }
  ]
}
```

```bash
comvenio member import --file import.json --json
```

Team anlegen (`team.json`):

```json
{
  "department_id": "<department-id>",
  "name": "Dart 1",
  "sport_type": "OTHER",
  "gender": "MIXED",
  "season": "2026/27",
  "required_resource_count": 2,
  "buffer_before_minutes": 30,
  "buffer_after_minutes": 15
}
```

```bash
comvenio team create --file team.json --json
comvenio team list --json
comvenio team show <team-id> --json
```

Team teilweise ändern:

```json
{
  "name": "Dart Erste",
  "home_location": "Vereinsheim",
  "required_resource_count": 3
}
```

```bash
comvenio team update <team-id> --file team-update.json --json
```

Kader pflegen:

```bash
comvenio team member list <team-id> --json
comvenio team member add <team-id> --member-id <member-id> --role PLAYER --json
comvenio team member update <team-id> --member-id <member-id> --role CAPTAIN --json
comvenio team member remove <team-id> --member-id <member-id> --json
```

Ressourcen-Priorität anlegen:

```bash
comvenio team resource list <team-id> --json
comvenio team resource add <team-id> --object-id <object-id> --priority 1 \
  --booking-duration-minutes 120 --notes "Dienstagstraining" --json
```

Saisonale Mannschaft und Saison anlegen:

```bash
comvenio teams list --department-id <department-id> --include-descendants --json
comvenio teams create --name "Dart 1" --department-id <department-id> --sport-type OTHER --yes --json
comvenio teams season create <team-id> --name "2026/27" --yes --json
comvenio teams season activate <season-id> --yes --json
```

Saison-Kader übernehmen:

```bash
comvenio teams roster carry-over <season-id> --source <vorsaison-id> --preview --json
comvenio teams roster carry-over <season-id> --source <vorsaison-id> --members <member-id-a>,<member-id-b> --yes --json
```

iCal-Quelle aktivieren:

```bash
comvenio teams ical create <season-id> --url "https://verband.example/kalender.ics" --yes --json
comvenio teams ical preview <subscription-id> --json
comvenio teams ical activate <subscription-id> --preview-token <token> --yes --json
comvenio teams sync now <subscription-id> --yes --json
```

Klärungsfall auflösen (`resolution.json`):

```json
{
  "type": "AMBIGUOUS_HOME_ROLE",
  "action": "CONFIRM_HOME",
  "trigger_resource_reconcile": true
}
```

```bash
comvenio teams sync resolve <clarification-id> --file resolution.json --yes --json
```

Mannschaftstermin eintragen:

```bash
comvenio teams termin create <season-id> --kind training --start 2026-10-06T19:00 \
  --repeat di,do --until 2026-12-18 --yes --json

comvenio teams termin create <season-id> --kind spiel --start 2026-10-11T15:00 \
  --opponent "SV Nachbarort" --home --yes --json

comvenio teams termin cancel <season-id> <event-id> --reason "Platz gesperrt" --scope this --yes --json
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**member** — vollständig

- `comvenio member list`
- `comvenio member show`
- `comvenio member add`
- `comvenio member update`
- `comvenio member remove`
- `comvenio member import`
- `comvenio member family-list`
- `comvenio member family-show`
- `comvenio member family-add`
- `comvenio member family-update`
- `comvenio member family-delete`
- `comvenio member status-list`
- `comvenio member status-show`
- `comvenio member status-add`
- `comvenio member status-update`
- `comvenio member status-delete`
- `comvenio member period-list`
- `comvenio member period-show`
- `comvenio member period-add`
- `comvenio member period-update`
- `comvenio member period-delete`
- Felder und Werte: `comvenio schema member --json`

**team** — vollständig

- `comvenio team list`
- `comvenio team show`
- `comvenio team create`
- `comvenio team update`
- `comvenio team delete`
- `comvenio team member list|add|update|remove`
- `comvenio team resource list|add|update|remove`
- Felder und Werte: `comvenio schema team --json`
<!-- /gen:docs -->

## Fehler

- `PERMISSION_DENIED` — die Vereinsrolle erlaubt das Anlegen, Ändern oder Löschen von Mitgliedern,
  Familien, Teams oder Kadereinträgen nicht, obwohl die Anmeldung die nötigen Scopes trägt. Siehe
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — ein Feld in der übergebenen Datei fehlt, ist nicht erlaubt oder hat das
  falsche Format, etwa beim Anlegen eines Mitglieds, einer Familie oder eines Teams. Siehe
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — die angegebene Mitglieds-, Familien-, Team-, Saison- oder Kader-ID gehört zu keinem
  sichtbaren Eintrag im verbundenen Verein. Siehe `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — ein Mitglied ist bereits demselben Team zugeordnet, oder eine Mannschaftsänderung
  widerspricht dem aktuellen Saisonzustand. Siehe `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — die Anmeldung wurde ohne den für eine Schreibaktion nötigen Scope erteilt. Siehe
  `comvenio help fehler SCOPE_REQUIRED`.
