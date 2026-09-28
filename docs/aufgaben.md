---
id: aufgaben
kategorie: thema
domaenen: [task]
stichwoerter: [aufgaben, checklisten, zuweisungen, erinnerung, notizen]
---

# Aufgaben

## Wozu

Mit Aufgaben lassen sich Arbeiten im Verein planen, Mitgliedern zuweisen, mit Checklisten und Notizen begleiten und abschließen — jede Aufgabe bezieht sich dabei auf einen fachlichen Kontext wie einen Verein, eine Veranstaltung, ein Objekt, eine Sitzung oder eine Versorgung.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

Anmeldung mit `comvenio login`; welche Scopes eine einzelne Action braucht, zeigt `comvenio action list --json`. Für die eigene, persönliche Aufgaben-Erinnerung genügt bereits der Lese-Scope `task.read` — ein Schreib-Scope ist dafür ausdrücklich nicht nötig, weil dabei keine gemeinsame Aufgabe geändert wird, sondern nur die eigene Präferenz.

## Abläufe

### Enums

| Feld | Werte |
|---|---|
| `status` | `open`, `in_progress`, `completed`, `cancelled` |
| `priority` | `low`, `medium`, `high` |
| `context_type` | `club`, `event`, `object`, `meeting`, `supply` |

### Aufgabe anlegen

1. Zuerst einen Context finden oder anlegen: Der Context beschreibt, worauf sich die Aufgabe bezieht; die referenzierte Entität steht dabei in der Context-eigenen Referenz (`--ref-id`), nicht in der ID, die `task create` später braucht.
2. Die `id` aus der Context-Antwort als `--context-id` für die Aufgabe verwenden.
3. Aufgabe mit Titel und Kontext-ID anlegen; beides ist Pflicht.
4. Optional ein Mitglied zuweisen (siehe unten).

Mehrere Aufgaben lassen sich inklusive Checklisten und Zuweisungen in einem Aufruf gemeinsam anlegen.

### Aufgabe ändern, abbrechen oder abschließen

Das Ändern ersetzt nur die tatsächlich gesetzten Felder. `completed` und `cancelled` dürfen nicht wieder auf `open` zurückgesetzt werden. Zum Abschließen ist ein eigener Befehl bequemer als ein Statuswechsel per Update, weil er zusätzlich den Abschlusszeitpunkt setzt.

### Mitglied zuweisen

Eine Zuweisung erwartet ausdrücklich eine Mitglieds-ID, keine Benutzer-ID. Eine Zuweisung kann als hauptverantwortlich markiert werden. Zuweisungen lassen sich vollständig lesen, aktualisieren und wieder entfernen.

### Contexts, Notizen und Checklisten pflegen

Contexts, Notizen und Checklisten-Einträge werden über eine Datei übergeben, damit sich der jeweils aktuelle Datenkörper ohne verlustreiche Einzelfeld-Abbildung setzen lässt. Checklisten-Einträge lassen sich zusätzlich umschalten (erledigt/offen) und neu sortieren.

### Eigene Aufgaben-Erinnerung setzen

Jeder angemeldete Nutzer kann für eine für ihn sichtbare Aufgabe genau eine eigene, frei gewählte Erinnerung setzen, anzeigen und löschen:

1. Erinnerungszeitpunkt als gültigen, zukünftigen Zeitstempel angeben.
2. Optional einen eigenen Kommentar mitgeben.
3. Ein erneutes Setzen für dieselbe Aufgabe ersetzt die bestehende persönliche Erinnerung idempotent.

Unmittelbar vor dem Versand prüft Comvenio Aufgabenexistenz und aktive Mitgliedschaft erneut und übernimmt den Vereinskontext automatisch aus der Aufgabe. Eine ersetzte, gelöschte oder nach einem Vereinsaustritt nicht mehr zulässige Erinnerung wird nicht zugestellt; zugestellt wird sie ausschließlich dem eigenen Konto. Eine Club-, Mitglieds- oder Empfänger-ID ist für diese Befehle nicht nötig und wird auch nicht gesendet.

### Abgrenzung

Interne Automatisierungsrouten, Spezialmodelle für Turnierspielpläne und übergreifende Aufräum-Endpunkte sind keine allgemeinen Vereins-Actions. Der übliche Aufgaben-, Context-, Zuweisungs-, Notiz- und Checklisten-Workflow ist vollständig über das CLI erreichbar.

## Beispiele

```bash
comvenio task context list --json

comvenio task context create \
  --context-type event \
  --ref-id <event-id> \
  --json
```

```bash
comvenio task list --json
comvenio task list --mine --json
comvenio task show <task-id> --json
comvenio task show <task-id> --subtasks --json
comvenio task show <task-id> --chain --json
```

`--mine` liefert die dem aktuellen Benutzer zugewiesenen Aufgaben. `--subtasks` lädt die Unteraufgaben, `--chain` die Aufgabenkette anstelle des normalen Details; `--subtasks` hat Vorrang, wenn beide gesetzt sind.

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

```json
{
  "items": [
    {
      "task": {
        "club_id": "<club-id>",
        "task_context_id": "<task-context-id>",
        "title": "Dartboards aufbauen",
        "priority": "high"
      },
      "checklist_items": [{ "title": "Werkzeug prüfen", "order_index": 0 }],
      "assignments": [{ "member_id": "<member-id>", "is_responsible": true }]
    }
  ]
}
```

```bash
comvenio task bulk --file tasks.json --json
```

```bash
comvenio task update <task-id> --title "Neuer Titel" --priority medium --json
comvenio task update <task-id> --status in_progress --json
comvenio task update <task-id> --status cancelled --json
comvenio task update <task-id> --file task-update.json --json
comvenio task delete <task-id> --json
comvenio task done <task-id> --json
```

```bash
comvenio task assign <task-id> --member-id <member-id> --responsible --json

comvenio task assignment list <task-id> --json
comvenio task assignment show <assignment-id> --json
comvenio task assignment update <assignment-id> --file assignment-update.json --json
comvenio task assignment delete <assignment-id> --json
```

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

Die geprüften Felder je Route zeigt zusätzlich `comvenio schema task --json`.

```bash
comvenio task reminder set <task-id> \
  --remind-at 2026-07-25T18:00:00+02:00 \
  --comment "Getränkebestellung prüfen" \
  --json

comvenio task reminder list <task-id> --json
comvenio task reminder delete <task-id> --json
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**task** — vollständig

- `comvenio task list`
- `comvenio task show`
- `comvenio task show --subtasks`
- `comvenio task show --chain`
- `comvenio task create`
- `comvenio task bulk`
- `comvenio task update`
- `comvenio task assign`
- `comvenio task done`
- `comvenio task delete`
- `comvenio task reminder set|list|delete`
- `comvenio task context list|show|create|update|delete`
- `comvenio task assignment list|show|update|delete`
- `comvenio task note list|add|update|delete`
- `comvenio task checklist list|add|update|toggle|delete|reorder`
- Felder und Werte: `comvenio schema task --json`
<!-- /gen:docs -->

## Fehler

- `VALIDATION_FAILED` — ein Pflichtfeld wie Titel oder Kontext-ID fehlt, oder ein Statuswechsel ist unzulässig (etwa zurück auf `open`). Mehr: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — Aufgabe, Context, Zuweisung, Notiz oder Checklisten-Eintrag existiert nicht oder ist nicht sichtbar. Mehr: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt diese Aufgaben-Aktion nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der nötige Aufgaben-Scope, etwa zum Schreiben. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — die Aufgabe wurde inzwischen geändert oder erlaubt den gewünschten Statuswechsel in ihrem aktuellen Zustand nicht. Mehr: `comvenio help fehler CONFLICT`
