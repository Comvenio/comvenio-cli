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

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

Gleiche Endpunkte und Rechte wie der Knopf in der Web-App: die Vereinsrolle braucht das Recht,
Vereinseinstellungen zu verwalten, oder das Recht, Veranstaltungen der jeweiligen Abteilung zu
verwalten. Anmeldung per `comvenio login`; welche Scopes im Einzelnen nötig sind, zeigt
`comvenio action list --json`.

## Abläufe

### Wochenvorschau erstellen

1. `comvenio weekly-preview create --department <department-id>` erstellt eine Vorschau für die
   kommende Woche (Standard `--range next_week`, wahlweise `--range next_7_days`).
2. Ohne `--teams` fließen alle Mannschaften der Abteilung ein; mit `--teams <id-a>,<id-b>` nur die
   genannten.
3. Mit `--telegram` geht der Entwurf nach der Freigabe zusätzlich an die verknüpften
   Telegram-Chats.
4. Die Antwort nennt Lauf- und Plan-ID; der Entwurf selbst liegt im Agent-Messenger zur Freigabe.
5. Der Aufruf setzt immer einen Idempotenzschlüssel — von Hand mit `--idempotency-key <schlüssel>`
   oder sonst automatisch erzeugt. Bricht der Aufruf durch Zeitüberschreitung ab, hat der Dienst
   eventuell trotzdem weitergearbeitet: mit demselben Schlüssel erneut aufrufen liefert den
   ursprünglichen Lauf statt einen zweiten.

### Wochenvorschauen eines Plans ansehen

1. `comvenio weekly-preview list --plan <plan-id>` (die Plan-ID stammt aus `create`).
2. Je Zeile stehen Datum, Terminzahl und Stand: „wartet auf Freigabe“, „veröffentlicht: <Link>“
   oder — wenn der Freigabelink abgelaufen ist — „veröffentlicht (Link abgelaufen)“.

### Vorlagen verwalten

1. Vorlagen ansehen: `comvenio weekly-preview template list`, wahlweise gefiltert mit
   `--department <department-id>`. Ohne Vorlagen gilt die Systemvorlage.
2. Einzelne Vorlage ansehen: `comvenio weekly-preview template show <id>`.
3. Vorlage anlegen: `comvenio weekly-preview template set --name "<Name>" --department <department-id> --file design.json`
   (`--name` ist beim Anlegen Pflicht).
4. Vorlage ändern: `comvenio weekly-preview template set <id> --name "<neuer Name>"` bzw. mit
   `--file design.json`. `--department` gilt nur beim Anlegen — eine Vorlage wechselt ihre
   Abteilung nicht. Ohne `--name` und ohne `--file` gibt es nichts zu ändern.
5. Vorlage löschen: `comvenio weekly-preview template delete <id>`.

Ein lokales Vorschaubild der Vorlage (`template preview`) gibt es hier noch nicht — das folgt mit
dem Bild-Teil dieser Funktion.

## Beispiele

```bash
comvenio weekly-preview create --department <department-id>
comvenio weekly-preview create --department <department-id> --teams <team-id-a>,<team-id-b> --range next_7_days --telegram
comvenio weekly-preview list --plan <plan-id>
comvenio weekly-preview template list --department <department-id>
comvenio weekly-preview template set --name "Sommerdesign" --department <department-id> --file design.json
comvenio weekly-preview template delete <template-id>
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**weekly-preview** — Kern vorhanden, einzelne Abläufe fehlen

- `comvenio weekly-preview create`
- `comvenio weekly-preview list`
- `comvenio weekly-preview template list`
- `comvenio weekly-preview template show`
- `comvenio weekly-preview template set`
- `comvenio weekly-preview template delete`
<!-- /gen:docs -->

## Fehler

- `OUTCOME_UNKNOWN` — `create` hat die Zeitgrenze überschritten; die Wochenvorschau kann trotzdem
  entstanden sein. Mehr: `comvenio help fehler OUTCOME_UNKNOWN`.
- `VALIDATION_FAILED` — `--department` fehlt, `--range` ist ungültig, oder `template set` bekommt
  beim Anlegen keinen `--name`. Mehr: `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — Plan oder Vorlage sind unter der angegebenen Kennung nicht bekannt. Mehr:
  `comvenio help fehler NOT_FOUND`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt das Erstellen oder Verwalten von Vorlagen nicht.
  Mehr: `comvenio help fehler PERMISSION_DENIED`.
