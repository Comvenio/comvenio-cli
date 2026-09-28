---
id: wochenvorschau
kategorie: thema
domaenen: [weekly-preview]
stichwoerter: [wochenvorschau, flyer, vorlage, template, telegram, plan]
---

# Wochenvorschau

## Wozu

Die Wochenvorschau erstellt automatisch einen Entwurf mit den anstehenden Terminen einer Abteilung
— zur Freigabe im Agent-Messenger und danach zum Veröffentlichen. Vorlagen bestimmen dabei das
Design des Entwurfs.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie
brauchen, zeigt `comvenio action list --json`. Gleiche Rechte wie der Knopf in der Web-App: die
Vereinsrolle braucht das Recht, Vereinseinstellungen zu verwalten, oder das Recht, Veranstaltungen
der jeweiligen Abteilung zu verwalten.

## Abläufe

### Wochenvorschau erstellen

1. `comvenio action call cai.club.11.weekly_preview_create --input '{"department_id":"<department-id>","range":"next_week","telegram":false}'`
   erstellt eine Vorschau für die kommende Woche.
2. Ohne `"team_ids"` fließen alle Mannschaften der Abteilung ein; mit
   `"team_ids":["<team-id-a>","<team-id-b>"]` nur die genannten. `"event_ids"` wählt statt eines
   Zeitraums einzelne Termine aus.
3. `"range"` ist `next_week` oder `next_7_days`; mit `"telegram": true` geht der Entwurf nach der
   Freigabe zusätzlich an die verknüpften Telegram-Chats.
4. Die Action ist `critical_write`: Der Aufruf liefert zunächst eine Vorschau mit `preview_id` und
   `confirmation_token`, dazu Lauf- und Plan-ID; der Entwurf selbst entsteht erst mit der
   Bestätigung und liegt danach im Agent-Messenger zur Freigabe.
5. Vorschau prüfen, dann bestätigen:
   `comvenio action confirm --preview-id <preview-id> --confirmation-token <confirmation-token> --idempotency-key <schlüssel>`.
   Der Idempotenzschlüssel macht eine Wiederholung sicher: Bricht die Bestätigung durch
   Zeitüberschreitung ab, hat der Dienst eventuell trotzdem weitergearbeitet — derselbe Schlüssel
   liefert dann denselben Lauf statt einen zweiten.

### Wochenvorschauen eines Plans ansehen

1. `comvenio action call cai.club.12.weekly_preview_list --input '{"plan_id":"<plan-id>","limit":20}'`
   (die Plan-ID stammt aus der Antwort von `weekly_preview_create`, `limit` ist Pflicht).
2. Je Eintrag stehen Datum, Terminzahl und Stand: „wartet auf Freigabe“, „veröffentlicht: <Link>“
   oder — wenn der Freigabelink abgelaufen ist — „veröffentlicht (Link abgelaufen)“.

### Vorlagen

Noch nicht als Action verfügbar — in der Web-App erledigen.

## Beispiele

```bash
comvenio action call cai.club.11.weekly_preview_create --input '{"department_id":"<department-id>","range":"next_week","telegram":false}'
comvenio action confirm --preview-id <preview-id> --confirmation-token <confirmation-token> --idempotency-key <schlüssel>
comvenio action call cai.club.11.weekly_preview_create --input '{"department_id":"<department-id>","team_ids":["<team-id-a>","<team-id-b>"],"range":"next_7_days","telegram":true}'
comvenio action call cai.club.12.weekly_preview_list --input '{"plan_id":"<plan-id>","limit":20}'
```

## Befehle und Actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Fehler

- `CONFIRMATION_REQUIRED` — `weekly_preview_create` ist `critical_write` und legt ohne
  Bestätigung nur eine Vorschau an; erst `comvenio action confirm` löst sie aus. Mehr:
  `comvenio help fehler CONFIRMATION_REQUIRED`.
- `CONFIRMATION_EXPIRED` — die Vorschau ist abgelaufen, bevor sie bestätigt wurde; `create` erneut
  aufrufen. Mehr: `comvenio help fehler CONFIRMATION_EXPIRED`.
- `OUTCOME_UNKNOWN` — `action confirm` hat die Zeitgrenze überschritten oder endete mit einem
  Serverfehler; die Wochenvorschau kann trotzdem entstanden sein — nicht einfach wiederholen, erst
  mit `weekly_preview_list` prüfen. Mehr: `comvenio help fehler OUTCOME_UNKNOWN`.
- `VALIDATION_FAILED` — `department_id` fehlt, `range` ist ungültig, oder ein Feld passt nicht zum
  Eingabeschema. Mehr: `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — der Plan ist unter der angegebenen Kennung nicht bekannt. Mehr:
  `comvenio help fehler NOT_FOUND`.
- `SCOPE_REQUIRED` — der Anmeldung fehlt `club.write` (zum Erstellen) oder `club.read` (zum
  Ansehen). Mehr: `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt das Erstellen oder Ansehen nicht. Mehr:
  `comvenio help fehler PERMISSION_DENIED`.
