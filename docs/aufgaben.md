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

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen, zeigt `comvenio action list --json`.

## Abläufe

### Enums

| Feld | Werte |
|---|---|
| `status` | `open`, `in_progress`, `completed`, `cancelled` |
| `priority` | `low`, `medium`, `high` |
| `context_type` | `club`, `event`, `object`, `meeting`, `supply` |

### Aufgabe anlegen (`cai.task.05.create`)

1. Zuerst einen Context finden (`cai.task.11.context_list_show_create_update_delete`, `operation: list`) oder anlegen (`operation: create`): Der Context beschreibt, worauf sich die Aufgabe bezieht.
2. Die `id` aus der Context-Antwort als `task_context_id` für die Aufgabe verwenden. Für eine Aufgabe ohne Bezug zu Veranstaltung, Objekt, Meeting oder Vorrat gilt `context_type: club` mit der Vereinskennung als `context_id` (zeigt `comvenio whoami --json`); ein vorhandener Vereins-Context aus der Liste wird wiederverwendet.
3. Aufgabe mit `title` und `task_context_id` anlegen; beides ist Pflicht. Ein Fälligkeitsdatum (`due_date`) wird als ISO-Zeitpunkt angegeben.
4. Optional ein Mitglied zuweisen (siehe unten).

Mehrere Aufgaben lassen sich inklusive Checklisten und Zuweisungen in einem Aufruf gemeinsam anlegen (`cai.task.06.bulk`); das ist `critical_write` und läuft über die Vorschau-/Bestätigungsfolge.

### Aufgabe ändern, abbrechen oder abschließen

`cai.task.07.update` ersetzt nur die tatsächlich gesetzten Felder in `changes`. `completed` und `cancelled` dürfen nicht wieder auf `open` zurückgesetzt werden. Zum Abschließen ist `cai.task.09.done` bequemer als ein Statuswechsel per Update: Er setzt den Status auf `completed`; der Abschlusszeitpunkt (`completed_at`) wird dabei ausdrücklich mitgegeben. `cai.task.10.delete` ist `critical_write`.

### Mitglied zuweisen (`cai.task.08.assign`)

Eine Zuweisung erwartet ausdrücklich eine Mitglieds-ID (`member_id`), keine Benutzer-ID, sowie optional `is_responsible`. Zuweisungen lassen sich über `cai.task.12.assignment_list_show_update_delete` vollständig lesen und aktualisieren (`reversible_write`); das Entfernen (`operation: delete`) ist `critical_write`.

### Contexts, Notizen und Checklisten pflegen

- `cai.task.11.context_list_show_create_update_delete` verwaltet Contexts; Löschen ist `critical_write`.
- `cai.task.13.note_list_add_update_delete` verwaltet Notizen (`content`); Löschen ist `critical_write`.
- `cai.task.14.checklist_list_add_update_toggle_delete_reorder` verwaltet Checklisten-Einträge, inklusive Umschalten (`toggle`, erledigt/offen); Löschen und Neusortieren (`reorder`) sind `critical_write`.

### Eigene Aufgaben-Erinnerung setzen

Noch nicht als Action verfügbar — in der Web-App erledigen.

### Abgrenzung

Interne Automatisierungsrouten, spezielle Abstimmungs- und Planungsmatrix-Modelle sowie übergreifende Aufräum-Endpunkte sind keine allgemeinen Vereins-Actions. Der übliche Aufgaben-, Context-, Zuweisungs-, Notiz- und Checklisten-Workflow ist vollständig über die hier beschriebenen Actions erreichbar.

## Beispiele

```bash
comvenio action call cai.task.11.context_list_show_create_update_delete \
  --input '{"operation":"list","limit":50,"offset":0}'

comvenio action call cai.task.11.context_list_show_create_update_delete \
  --input '{"operation":"create","context":{"context_type":"event","context_id":"<event-id>","is_default":false}}'
```

```bash
comvenio action call cai.task.01.list --input '{"operation":"list","limit":50,"offset":0}'
comvenio action call cai.task.01.list --input '{"operation":"mine","limit":50,"offset":0}'
comvenio action call cai.task.02.show --input '{"task_id":"<task-id>"}'
comvenio action call cai.task.03.show_subtasks --input '{"task_id":"<task-id>"}'
comvenio action call cai.task.04.show_chain --input '{"task_id":"<task-id>"}'
```

`operation: mine` liefert die dem aktuellen Benutzer zugewiesenen Aufgaben.

```bash
comvenio action call cai.task.05.create --input '{
  "task": {
    "title": "Getränkestand besetzen",
    "task_context_id": "<task-context-id>",
    "description": "Zwei Schichten einteilen",
    "priority": "high",
    "status": "open",
    "department_id": "<department-id>",
    "due_date": "2026-07-20T18:00:00+02:00"
  }
}'
```

```bash
comvenio action call cai.task.06.bulk --input '{
  "items": [
    {
      "task": { "title": "Dartboards aufbauen", "task_context_id": "<task-context-id>", "priority": "high" },
      "checklist_items": [{ "title": "Werkzeug prüfen", "order_index": 0 }],
      "assignments": [{ "member_id": "<member-id>", "is_responsible": true }]
    }
  ]
}'
# Antwort liefert preview_id, confirmation_token, Ziel, Ist-Stand, Unterschied und Risiko
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token=<confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.task.07.update --input '{"task_id":"<task-id>","changes":{"title":"Neuer Titel","priority":"medium"}}'
comvenio action call cai.task.07.update --input '{"task_id":"<task-id>","changes":{"status":"in_progress"}}'
comvenio action call cai.task.07.update --input '{"task_id":"<task-id>","changes":{"status":"cancelled"}}'
comvenio action call cai.task.09.done --input '{"task_id":"<task-id>","completed_at":"2026-07-20T19:00:00+02:00"}'

comvenio action call cai.task.10.delete --input '{"task_id":"<task-id>"}'
# Antwort liefert preview_id, confirmation_token, Ziel, Ist-Stand, Unterschied und Risiko
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token=<confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.task.08.assign --input '{"task_id":"<task-id>","assignment":{"member_id":"<member-id>","is_responsible":true}}'

comvenio action call cai.task.12.assignment_list_show_update_delete --input '{"operation":"list","task_id":"<task-id>"}'
comvenio action call cai.task.12.assignment_list_show_update_delete --input '{"operation":"show","assignment_id":"<assignment-id>"}'
comvenio action call cai.task.12.assignment_list_show_update_delete --input '{"operation":"update","assignment_id":"<assignment-id>","is_responsible":false}'
comvenio action call cai.task.12.assignment_list_show_update_delete --input '{"operation":"delete","assignment_id":"<assignment-id>"}'
```

```bash
comvenio action call cai.task.11.context_list_show_create_update_delete --input '{"operation":"show","context_id":"<context-id>"}'
comvenio action call cai.task.11.context_list_show_create_update_delete --input '{"operation":"update","context_id":"<context-id>","is_default":true}'
comvenio action call cai.task.11.context_list_show_create_update_delete --input '{"operation":"delete","context_id":"<context-id>"}'

comvenio action call cai.task.13.note_list_add_update_delete --input '{"operation":"list","task_id":"<task-id>"}'
comvenio action call cai.task.13.note_list_add_update_delete --input '{"operation":"add","task_id":"<task-id>","content":"Getränkebestellung geprüft"}'
comvenio action call cai.task.13.note_list_add_update_delete --input '{"operation":"update","note_id":"<note-id>","content":"Aktualisierter Text"}'
comvenio action call cai.task.13.note_list_add_update_delete --input '{"operation":"delete","note_id":"<note-id>"}'

comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"list","task_id":"<task-id>"}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"add","task_id":"<task-id>","item":{"title":"Getränke bestellen","order_index":0}}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"update","item_id":"<item-id>","changes":{"title":"Getränke bestellen (60 Kästen)"}}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"toggle","item_id":"<item-id>"}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"delete","item_id":"<item-id>"}'
comvenio action call cai.task.14.checklist_list_add_update_toggle_delete_reorder --input '{"operation":"reorder","task_id":"<task-id>","ordered_ids":["<item-id-1>","<item-id-2>"]}'
```

Löschende und neusortierende Checklisten-Aufrufe, das Löschen von Context, Notiz oder Zuweisung und `bulk` sind `critical_write` und laufen über dieselbe Vorschau-/Bestätigungsfolge wie oben bei `cai.task.10.delete` gezeigt. Die geprüften Felder je Action zeigt zusätzlich `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"task"}'`.

## Befehle und Actions

<!-- gen:docs befehle -->

**task**

- `cai.task.01.list` — list, mine (lesen) · Scopes: `task.read`, `club.read`
- `cai.task.02.show` — show (lesen) · Scopes: `task.read`
- `cai.task.03.show_subtasks` — show (lesen) · Scopes: `task.read`
- `cai.task.04.show_chain` — show (lesen) · Scopes: `task.read`
- `cai.task.05.create` — create (ändern) · Scopes: `task.write`
- `cai.task.06.bulk` — create (ändern mit Bestätigung) · Scopes: `task.write`
- `cai.task.07.update` — update (ändern) · Scopes: `task.write`
- `cai.task.08.assign` — assign (ändern) · Scopes: `task.write`
- `cai.task.09.done` — complete (ändern) · Scopes: `task.write`
- `cai.task.10.delete` — delete (ändern mit Bestätigung) · Scopes: `task.write`
- `cai.task.11.context_list_show_create_update_delete` — list, show, create, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `task.read`, `task.write`
- `cai.task.12.assignment_list_show_update_delete` — list, show, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `task.read`, `task.write`
- `cai.task.13.note_list_add_update_delete` — list, add, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `task.read`, `task.write`
- `cai.task.14.checklist_list_add_update_toggle_delete_reorder` — list, add, update, toggle, delete, reorder (lesen, ändern, ändern mit Bestätigung) · Scopes: `club.read`, `task.write`
- Felder und Werte: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"task"}'` (`club_id` setzt die Anmeldung — nie in `--input`)
<!-- /gen:docs -->

## Fehler

- `VALIDATION_FAILED` — ein Pflichtfeld wie Titel oder Kontext-ID fehlt, oder ein Statuswechsel ist unzulässig (etwa zurück auf `open`). Mehr: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — Aufgabe, Context, Zuweisung, Notiz oder Checklisten-Eintrag existiert nicht oder ist nicht sichtbar. Mehr: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt diese Aufgaben-Aktion nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der nötige Aufgaben-Scope, etwa zum Schreiben. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — die Aufgabe wurde inzwischen geändert oder erlaubt den gewünschten Statuswechsel in ihrem aktuellen Zustand nicht. Mehr: `comvenio help fehler CONFLICT`
- `OUTCOME_UNKNOWN` — bei einer ändernden Action blieb die Serverantwort aus; vor einer Wiederholung mit einer lesenden Action prüfen, ob die Änderung schon angekommen ist. Mehr: `comvenio help fehler OUTCOME_UNKNOWN`
