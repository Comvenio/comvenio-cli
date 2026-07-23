# Aufgaben – CLI-Referenz

Stand: 23. Juli 2026 · Quelle: `src/commands/task.ts`

Eine Aufgabe benötigt einen `task_context_id`. Der Context beschreibt, worauf sich die Aufgabe bezieht; die referenzierte Entität steht in `context_id` des Contexts.

## Enums

| Feld | Werte |
|---|---|
| `status` | `open`, `in_progress`, `completed`, `cancelled` |
| `priority` | `low`, `medium`, `high` |
| `context_type` | `club`, `event`, `object`, `meeting`, `supply` |

## Context finden oder anlegen

```bash
comvenio task context list --json

comvenio task context create \
  --context-type event \
  --ref-id <event-id> \
  --json
```

`--ref-id` ist die ID der referenzierten Entität, nicht die spätere `task_context_id`. Für `task create` wird die `id` aus der Context-Antwort als `--context-id` verwendet.

## Aufgaben lesen

```bash
comvenio task list --json
comvenio task list --mine --json
comvenio task show <task-id> --json
comvenio task show <task-id> --subtasks --json
comvenio task show <task-id> --chain --json
```

- `--mine` liefert die dem aktuellen Benutzer zugewiesenen Aufgaben.
- `--subtasks` lädt die Unteraufgaben anstelle des normalen Details.
- `--chain` lädt die Aufgabenkette anstelle des normalen Details.
- `--subtasks` hat Vorrang vor `--chain`, wenn beide gesetzt werden.

## Aufgabe anlegen

```bash
comvenio task create \
  --title "Getränkestand besetzen" \
  --context-id <task-context-id> \
  --description "Zwei Schichten einteilen" \
  --priority high \
  --status open \
  --department-id <department-id> \
  --due-date 2026-07-20T18:00:00+02:00 \
  --json
```

Pflicht sind `--title` und `--context-id`. `--due-date` ist ein ISO-Zeitpunkt.

## Aufgabe ändern, abbrechen oder löschen

```bash
comvenio task update <task-id> --title "Neuer Titel" --priority medium --json
comvenio task update <task-id> --status in_progress --json
comvenio task update <task-id> --status cancelled --json
comvenio task update <task-id> --file task-update.json --json
comvenio task delete <task-id> --json
```

Der Update-Endpoint verwendet `PUT`; das CLI sendet nur gesetzte Flags oder den Body aus `--file`.
`completed` und `cancelled` dürfen laut Backend-Statusguard nicht wieder auf `open` gesetzt werden.
Zum Abschließen ist `task done` der bequemere Weg, weil er zusätzlich `completed_at` setzt.

Mehrere Aufgaben inklusive Checklisten und Zuweisungen lassen sich gemeinsam anlegen:

```bash
comvenio task bulk --file tasks.json --json
```

```json
{
  "items": [
    {
      "task": {
        "club_id": "UUID",
        "task_context_id": "UUID",
        "title": "Dartboards aufbauen",
        "priority": "high"
      },
      "checklist_items": [{ "title": "Werkzeug prüfen", "order_index": 0 }],
      "assignments": [{ "member_id": "UUID", "is_responsible": true }]
    }
  ]
}
```

## Mitglied zuweisen

```bash
comvenio task assign <task-id> --member-id <member-id> --responsible --json
```

`--member-id` erwartet ausdrücklich eine Member-ID, keine User-ID. `--responsible` setzt die Zuweisung als hauptverantwortlich.

Zuweisungen können vollständig gelesen und verwaltet werden:

```bash
comvenio task assignment list <task-id> --json
comvenio task assignment show <assignment-id> --json
comvenio task assignment update <assignment-id> --file assignment-update.json --json
comvenio task assignment delete <assignment-id> --json
```

## Contexts, Notizen und Checklisten

```bash
comvenio task context show <context-id> --json
comvenio task context update <context-id> --file context-update.json --json
comvenio task context delete <context-id> --json

comvenio task note list <task-id> --json
comvenio task note add <task-id> --file note.json --json
comvenio task note update <note-id> --file note-update.json --json
comvenio task note delete <note-id> --json

comvenio task checklist list <task-id> --json
comvenio task checklist add <task-id> --file checklist-item.json --json
comvenio task checklist update <item-id> --file checklist-item-update.json --json
comvenio task checklist toggle <item-id> --json
comvenio task checklist reorder <task-id> --file reorder.json --json
comvenio task checklist delete <item-id> --json
```

Unterressourcen verwenden bewusst `--file`, damit der jeweils aktuelle Backend-Body ohne verlustreiche
Flag-Abbildung übergeben werden kann. Die geprüften Routen stehen zusätzlich im Offline-Schema
`comvenio schema task --json` und in [`coverage.md`](coverage.md).

## Aufgabe abschließen

```bash
comvenio task done <task-id> --json
```

Der Befehl setzt `status=completed` und `completed_at` auf den aktuellen ISO-Zeitpunkt.

## Eigene Aufgaben-Erinnerung

Jeder angemeldete Nutzer kann für eine sichtbare Aufgabe genau seine eigene,
frei gewählte Erinnerung setzen, anzeigen und löschen:

```bash
comvenio task reminder set <task-id> \
  --remind-at 2026-07-25T18:00:00+02:00 \
  --comment "Getränkebestellung prüfen" \
  --json

comvenio task reminder list <task-id> --json
comvenio task reminder delete <task-id> --json
```

`--remind-at` muss ein gültiger zukünftiger RFC-3339-Zeitpunkt sein. Eine
Club-, Mitglieds-, Benutzer- oder Empfänger-ID ist für diese Kommandos nicht
erforderlich und wird nicht gesendet. Der Automation-Service liest die Aufgabe
mit dem aktuellen Actor-Token, übernimmt den Vereinskontext aus der
autorisierten Task-Service-Antwort und stellt die Erinnerung ausschließlich dem
JWT-Subjekt zu. Ein erneutes `set` für dieselbe Aufgabe ersetzt die bestehende
persönliche Erinnerung idempotent. Unmittelbar vor dem Versand prüft das
Backend aktuelle Reminder-Generation, Aufgabenexistenz und aktive
Mitgliedschaft erneut. Ersetzte, gelöschte oder nach einem Vereinsaustritt
nicht mehr zulässige Reminder werden nicht zugestellt.

Für den persönlichen Reminder genügt der OAuth-Scope `task.read`, weil der
Nutzer keine gemeinsame Aufgabe ändert, sondern nur seine eigene Präferenz.
`task.write` ist dafür ausdrücklich nicht erforderlich.

## Abgrenzung

Interne Automation-Routen, Poll-/Matrix-Spezialmodelle und serviceweite Admin-Cleanup-Endpunkte sind
keine allgemeinen Club-Admin-Actions. Der vorgesehene Aufgaben-, Context-, Zuweisungs-, Notiz- und
Checklisten-Workflow ist über das CLI erreichbar.
