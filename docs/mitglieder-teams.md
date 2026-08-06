# Mitglieder und Teams per CLI

Diese Referenz ist eigenständig. Sie beschreibt die belegten Club-Admin-Workflows des `member-service`, die über `comvenio team` erreichbar sind. Für die allgemeine Mitgliederverwaltung existiert zusätzlich `comvenio member`.

## Voraussetzungen und Rechte

- Lesen von Teams, Kadern und Ressourcen-Prioritäten erfordert die Mitglieder-Sichtberechtigung im Club.
- Create, Update und Delete erfordern `manage_members` im Club.
- `--club <uuid>` überschreibt den Club aus dem lokalen CLI-State.
- `--json` liefert die unveränderte API-Antwort für Agenten und Skripte.
- Komplexe Bodies werden als UTF-8-JSON über `--file <pfad>` übergeben.

## Mitglieder

```bash
comvenio member list --json
comvenio member show <member-id> --json
comvenio member add --first-name Max --last-name Muster --email max@example.org --json
comvenio member update <member-id> --phone "+49 123 456789" --json
comvenio member remove <member-id> --json
```

`member add` kann zusätzlich `--membership-status-id` und `--family-id` setzen. Diese beiden
Beziehungen sind nicht Bestandteil von `MemberUpdate`; das CLI sendet deshalb keine vom Backend
nicht unterstützten Felder.

## Familien

```bash
comvenio member family-list --json
comvenio member family-show <family-id> --json
comvenio member family-add --file family.json --json
comvenio member family-update <family-id> --file family-update.json --json
comvenio member family-delete <family-id> --json
```

`family.json`:

```json
{
  "name": "Familie Muster",
  "notes": "Familienbeitrag",
  "responsible_member_id": "UUID"
}
```

Die Club-ID setzt das CLI. `name` und `responsible_member_id` sind beim Anlegen Pflicht.

## Mitgliedsstatus

```bash
comvenio member status-list --json
comvenio member status-show <status-id> --json
comvenio member status-add --file status.json --json
comvenio member status-update <status-id> --file status-update.json --json
comvenio member status-delete <status-id> --json
```

`status.json`:

```json
{
  "name": "Aktiv",
  "description": "Aktives Vereinsmitglied",
  "is_discount_eligible": false,
  "priority": 100
}
```

Statuswerte sind club-spezifische Datensätze und kein festes Enum.

## Mitgliedschaftszeiträume

```bash
comvenio member period-list <member-id> --json
comvenio member period-show <period-id> --json
comvenio member period-add --file period.json --json
comvenio member period-update <period-id> --file period-update.json --json
comvenio member period-delete <period-id> --json
```

`period.json`:

```json
{
  "member_id": "UUID",
  "joined_at": "2020-01-01",
  "left_at": null,
  "reason": null,
  "note": "Wiedereintritt"
}
```

Die Club-ID wird beim Anlegen aus dem CLI-Kontext ergänzt. Updates dürfen `joined_at`, `left_at`,
`reason` und `note` enthalten.

## Bulk-Import

```bash
comvenio member import --file import.json --json
```

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

Für den ersten Lauf `preview: true` verwenden. Die Club-ID in der Datei wird ignoriert und durch
den aktiven CLI-Club ersetzt. `reconcile_absent_members: true` kann fehlende Bestandsmitglieder als
ausgetreten markieren und ist deshalb erst nach geprüftem Preview zu verwenden.

## Team-Workflows

| Zweck | CLI | Backend |
|---|---|---|
| Teams des Clubs | `comvenio team list` | `GET /member/teams/by-club/{club_id}` |
| Team mit Kader und Prioritäten | `comvenio team show <team-id>` | `GET /member/teams/{team_id}` |
| Team anlegen | `comvenio team create --file team.json` | `POST /member/teams/` |
| Team ändern | `comvenio team update <team-id> --file patch.json` | `PATCH /member/teams/{team_id}` |
| Team entfernen | `comvenio team delete <team-id>` | `DELETE /member/teams/{team_id}` |

`team create` setzt `club_id` immer aus dem aktiven Club. Beispiel `team.json`:

```json
{
  "department_id": "UUID",
  "name": "Dart 1",
  "sport_type": "OTHER",
  "gender": "MIXED",
  "season": "2026/27",
  "required_resource_count": 2,
  "buffer_before_minutes": 30,
  "buffer_after_minutes": 15
}
```

Erforderlich sind `department_id`, `name` und `sport_type`. Gültige Sportarten: `FOOTBALL`, `TENNIS`, `HANDBALL`, `BASKETBALL`, `VOLLEYBALL`, `TABLE_TENNIS`, `OTHER`. Geschlecht: `MALE`, `FEMALE`, `MIXED`.

Ein Team-Update ist partiell. Beispiel:

```json
{
  "name": "Dart Erste",
  "home_location": "Vereinsheim",
  "required_resource_count": 3
}
```

## Team-Mitglieder

| Zweck | CLI | Backend |
|---|---|---|
| Kader lesen | `comvenio team member list <team-id>` | `GET /member/teams/{team_id}/members` |
| Mitglied hinzufügen | `comvenio team member add <team-id> --member-id <id> --role PLAYER` | `POST /member/teams/{team_id}/members` |
| Mitglied ändern | `comvenio team member update <team-id> --member-id <id> --role CAPTAIN` | `PATCH /member/teams/{team_id}/members/{member_id}` |
| Mitglied entfernen | `comvenio team member remove <team-id> --member-id <id>` | `DELETE /member/teams/{team_id}/members/{member_id}` |

Optionen für Add und Update:

- `--role`: `PLAYER`, `CAPTAIN`, `COACH`, `ASSISTANT_COACH`, `MANAGER`
- `--jersey-number <n>`
- `--position <text>`
- alternativ `--file` mit `member_id`, `role`, `jersey_number`, `position`

`member_id` ist die Mitglieds-ID des Clubs, nicht die User-ID. Das Backend verhindert doppelte Team-Zuordnungen mit HTTP 409.

## Ressourcen-Prioritäten

Ressourcen-Prioritäten ordnen einem Team buchbare Objekte zu, etwa Hallen, Plätze oder Equipment.

| Zweck | CLI | Backend |
|---|---|---|
| Prioritäten lesen | `comvenio team resource list <team-id>` | `GET /member/teams/{team_id}/resource-priorities` |
| Priorität anlegen | `comvenio team resource add <team-id> --object-id <id> --priority 1` | `POST /member/teams/{team_id}/resource-priorities` |
| Priorität ändern | `comvenio team resource update <team-id> --priority-id <id> --priority 2` | `PATCH /member/teams/{team_id}/resource-priorities/{priority_id}` |
| Priorität entfernen | `comvenio team resource remove <team-id> --priority-id <id>` | `DELETE /member/teams/{team_id}/resource-priorities/{priority_id}` |

Felder: `object_id`, `priority` (Standard 1), `booking_duration_minutes` (Standard 120) und `notes`. Beispiel:

```powershell
comvenio team resource add $teamId --object-id $halleId --priority 1 --booking-duration-minutes 120 --notes "Dienstagstraining"
```

## Saisonale Mannschaften (`comvenio teams`)

Der Namespace `comvenio teams` ist die saisonale Mannschaftsverwaltung (Saisons mit Lebenszyklus
`ENTWURF → AKTIV → ABGESCHLOSSEN`, Saison-Kader, Wettbewerbe, iCal-Abonnements und
Spielplan-Synchronisation). Er ergänzt `comvenio team` (dauerhafte Stammdaten) und ersetzt es nicht.

Verhaltensvertrag:

- Jede Lese- und Schreibaktion unterstützt `--json`.
- Exitcodes: `0` Erfolg, `2` Validierung/unbekanntes Ziel, `3` fehlende Berechtigung,
  `4` Konflikt, `5` Transport-/Servicefehler.
- Wichtige Mutationen (create, archive, Lifecycle, Aktivierung, Deaktivierung, Sofortlauf,
  Klärungsauflösung, Kader-/Wettbewerbs-Writes) zeigen zuerst eine vollständige
  Parameterzusammenfassung und senden **ohne `--yes` keinen Write**.
- Saisonbezogene Writes verlangen immer die konkrete Ziel-ID (`<season-id>`,
  `<roster-id>`, `<subscription-id>`, …) — nie einen Aggregat-Scope.
- iCal-Quell-URLs erscheinen in Ausgaben und Zusammenfassungen nur maskiert.

| Zweck | CLI | Backend |
|---|---|---|
| Mannschaften listen | `comvenio teams list [--department-id <id> [--include-descendants]]` | `GET /member/teams/by-club/{club_id}` bzw. `GET /member/teams/by-department/{id}` |
| Mannschaft anzeigen | `comvenio teams show <team-id>` | `GET /member/teams/{team_id}` |
| Mannschaft anlegen | `comvenio teams create --name … --department-id … --sport-type … --yes` | `POST /member/teams/` |
| Mannschaft ändern | `comvenio teams update <team-id> … --yes` | `PATCH /member/teams/{team_id}` |
| Mannschaft archivieren | `comvenio teams archive <team-id> --yes` | `PATCH /member/teams/{team_id}` (`archived_at`) |
| Saisons listen | `comvenio teams season list <team-id>` | `GET /member/teams/{team_id}/seasons` |
| Saison anzeigen | `comvenio teams season show <season-id> --team <team-id>` | Saisonliste des Teams (kein Einzel-Read-Endpunkt) |
| Saison anlegen | `comvenio teams season create <team-id> --name … --yes` | `POST /member/teams/{team_id}/seasons` |
| Saison korrigieren | `comvenio teams season update <season-id> --reason … … --yes` | `POST /member/team-seasons/{id}/historical-corrections` |
| Saison aktivieren/abschließen | `comvenio teams season activate\|complete <season-id> --yes` | `POST /member/team-seasons/{id}/transitions/{t}` |
| Kader anzeigen | `comvenio teams roster show <season-id>` | `GET /member/team-seasons/{id}/members` |
| Kadermitglied aufnehmen | `comvenio teams roster add <season-id> --member-id … --yes` | `POST /member/team-seasons/{id}/members` |
| Kadereintrag ändern | `comvenio teams roster update <roster-id> … --yes` | `PATCH /member/team-season-members/{roster_id}` |
| Kadermitglied austragen | `comvenio teams roster remove <roster-id> --yes` | `DELETE /member/team-season-members/{roster_id}` |
| Kader-Übernahme (Vorschau) | `comvenio teams roster carry-over <season-id> --source <id> --preview` | `POST /member/team-seasons/{id}/roster-preview` |
| Kader selektiv übernehmen | `comvenio teams roster carry-over <season-id> --source <id> [--members a,b] --yes` | `POST /member/team-seasons/{id}/roster-carry-over` |
| Wettbewerbe listen | `comvenio teams competition list <season-id>` | `GET /member/team-seasons/{id}/competitions` |
| Wettbewerb anlegen | `comvenio teams competition create <season-id> --name … --yes` | `POST /member/team-seasons/{id}/competitions` |
| Wettbewerb ändern/entfernen | `comvenio teams competition update\|delete <competition-id> --yes` | `PATCH`/`DELETE /member/team-season-competitions/{id}` |
| iCal-Quellen listen | `comvenio teams ical list <season-id>` | `GET /event/team-seasons/{id}/calendar-subscriptions` |
| iCal-Quelle speichern | `comvenio teams ical create <season-id> --url … --yes` | `POST /event/team-seasons/{id}/calendar-subscriptions` |
| iCal-Vorschau | `comvenio teams ical preview <subscription-id>` | `POST /event/calendar-subscriptions/{id}/preview` |
| iCal aktivieren | `comvenio teams ical activate <subscription-id> --preview-token … --yes` | `POST /event/calendar-subscriptions/{id}/activate` |
| iCal deaktivieren | `comvenio teams ical deactivate <subscription-id> --yes` | `POST /event/calendar-subscriptions/{id}/deactivate` |
| Sofort synchronisieren | `comvenio teams sync now <subscription-id> --yes` | `POST /event/calendar-subscriptions/{id}/sync` |
| Sync-Verlauf | `comvenio teams sync runs <subscription-id> [--limit --offset]` | `GET /event/calendar-subscriptions/{id}/runs` |
| Klärungsfälle listen | `comvenio teams sync clarifications <season-id>` | `GET /event/team-seasons/{id}/sync-clarifications` |
| Klärungsfall auflösen | `comvenio teams sync resolve <clarification-id> --file resolution.json --yes` | `POST /event/sync-clarifications/{id}/resolve` |

Die Aktivierung folgt immer der Kette `ical create` → `ical preview` (liefert `preview_token`) →
`ical activate --preview-token`. Ein geändertes Abonnement verwirft den Token; die Vorschau ist dann
neu abzurufen. `sync resolve` erwartet eine Auflösung mit `type` und `action`, zum Beispiel
`{"type": "AMBIGUOUS_HOME_ROLE", "action": "CONFIRM_HOME", "trigger_resource_reconcile": true}`.

## Bewusste Abgrenzung

Nicht Teil dieses Admin-CLI-Scopes sind externe Provider-Synchronisationen (`fussball.de`, `NuLiga`) und die interne Route `/internal/teams/{team_id}/booking-info`. Provider-Importe haben externe Abhängigkeiten; interne Routen verwenden Service-Authentifizierung statt Club-Admin-JWT.

Maschinenlesbare Verträge: `comvenio schema team --json`, sobald die Domain im zentralen Schema-Index freigeschaltet ist; die Quelldatei liegt bereits unter `src/schema/team.json`.
