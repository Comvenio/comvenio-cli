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

## Bewusste Abgrenzung

Nicht Teil dieses Admin-CLI-Scopes sind externe Provider-Synchronisationen (`fussball.de`, `NuLiga`) und die interne Route `/internal/teams/{team_id}/booking-info`. Provider-Importe haben externe Abhängigkeiten; interne Routen verwenden Service-Authentifizierung statt Club-Admin-JWT.

Maschinenlesbare Verträge: `comvenio schema team --json`, sobald die Domain im zentralen Schema-Index freigeschaltet ist; die Quelldatei liegt bereits unter `src/schema/team.json`.
