# Turniere – eigenständige CLI-Referenz

Stand: 13. Juli 2026 · Quelle: `src/commands/tournament.ts`

Das CLI verwaltet V3-Turniere über Turnierserien und konkrete Ausführungen. Ein Match paart Teilnehmer (`team`, `individual` oder `pair`), nicht zwingend ein Comvenio-Team.

## Actions

| Bereich | Actions |
|---|---|
| Serien/Ausführungen | `series-list`, `series-show`, `series-create`, `series-update`, `series-delete`, `execution-create`, `execution-link` |
| Turnier | `list`, `show`, `update`, `delete`, `status`, `start`, `reset`, `preview` |
| Teilnehmer | `participants`, `mannschaft`/`participant`, `participant-withdraw`, `participant-reinstate`, `participant-remove` |
| Auslosung | `draw`, `draw-confirm`, `redraw` |
| Spiele | `matches`, `matches-clear`, `schedule-generate`, `match-schedule`, `match-delete`, `match-result`, `deadline` |
| Wertung | `standings` |

Statuswerte für `tournament status`: `draft`, `registration`, `draw`, `scheduled`, `active`, `completed`, `cancelled`, `archived`.

## Turnierserie anlegen

```json
{
  "title": "Vereins-Dartmeisterschaft",
  "description": "Jährliches Vereinsturnier",
  "sport_key": "darts",
  "format_family": "group_knockout",
  "template_key": "darts_group_knockout",
  "participation_mode": "internal",
  "eligible_scope": "club",
  "eligible_department_ids": [],
  "rules_config": {},
  "default_phase_pipeline": [],
  "is_public": true
}
```

```bash
comvenio tournament series-create --file series.json --json
comvenio tournament series-list --json
comvenio tournament series-show <series-id> --json
comvenio tournament series-update <series-id> --file series-update.json --json
comvenio tournament series-delete <series-id> --json
```

Die Club-ID ergänzt das CLI. Serien-Create ist vollständig enthalten; ältere Hinweise, die das Gegenteil behaupten, sind veraltet.

## Ausführung aus einer Serie

```json
{
  "title": "Vereins-Dartmeisterschaft 2026",
  "tournament_mode": "group_knockout",
  "start_date": "2026-09-05T10:00:00+02:00",
  "end_date": "2026-09-05T20:00:00+02:00",
  "registration_deadline": "2026-08-31T23:59:59+02:00",
  "min_teams": 4,
  "max_teams": 32,
  "team_size": 1
}
```

```bash
comvenio tournament execution-create <series-id> --file execution.json --json
comvenio tournament execution-link <tournament-id> --event <event-id> --json
comvenio tournament execution-link <tournament-id> --clear-event --json
```

`execution-link` verbindet eine Ausführung mit einem Event oder entfernt diese Verbindung.

## Turnier und Teilnehmer

```bash
comvenio tournament list --json
comvenio tournament show <tournament-id> --json
comvenio tournament update <tournament-id> --file tournament-update.json --json
comvenio tournament delete <tournament-id> --json
comvenio tournament status <tournament-id> --status registration --json

comvenio tournament participants <tournament-id> --json
comvenio tournament mannschaft <tournament-id> --name "SV Motzing AH" --seed 1 --json
comvenio tournament participant <tournament-id> --name "Max Muster" --kind individual --json
comvenio tournament participant <tournament-id> --name "Doppel A" --kind pair --json
```

`mannschaft` ist ein Alias für `participant` mit Default `--kind team`. Die Anmeldestatus-Vorgabe ist `confirmed` und kann mit `--status` geändert werden.

Teilnehmer zurückziehen oder entfernen:

```bash
comvenio tournament participant-withdraw <tournament-id> --participant <participant-id> --mode cancel --json
comvenio tournament participant-withdraw <tournament-id> --participant <participant-id> --mode walkover --json
comvenio tournament participant-reinstate <tournament-id> --participant <participant-id> --json
comvenio tournament participant-remove <tournament-id> --participant <participant-id> --json
```

- `cancel` annulliert offene Spiele und eignet sich vor einem Re-Draw.
- `walkover` wertet offene Spiele für den Gegner.
- Ohne `--mode` entscheidet der Backend-Default abhängig vom Turnierzustand.
- `remove` ist die stärkere Soft-Delete-Operation.

## Auslosung

Beispiel `draw.json`:

```json
{
  "strategy": "manual",
  "speed": "normal",
  "public_show_enabled": false,
  "fixed_assignments": [
    { "participant_id": "<id-1>", "group_key": "A" },
    { "participant_id": "<id-2>", "group_key": "B" }
  ],
  "double_round": false,
  "auto_separate_same_club": true,
  "knockout_config": {
    "qualified_per_group": 2,
    "third_place_match": true,
    "play_all_placements": false,
    "placement_mode": "direct"
  }
}
```

```bash
comvenio tournament draw <tournament-id> --file draw.json --json
comvenio tournament draw-confirm <tournament-id> --json
```

`draw` legt zunächst eine Draw-Session an. `draw-confirm` materialisiert die Spiele. Eine Bestätigung ist additiv; für eine vollständige neue Auslosung deshalb den atomaren CLI-Workflow verwenden:

```bash
comvenio tournament redraw <tournament-id> --file draw.json --json
```

`redraw` führt Reset, Löschen aller alten Spiele, neue Draw-Session und Bestätigung nacheinander aus. Zurückgezogene Teilnehmer werden nicht erneut gezogen.

## Spielplan und Zeiten

```bash
comvenio tournament matches <tournament-id> --json
comvenio tournament schedule-generate <tournament-id> \
  --match-minutes 15 --break-minutes 3 --field-count 2 \
  --first-kickoff 2026-09-05T10:00:00+02:00 --dry-run --json

comvenio tournament schedule-generate <tournament-id> \
  --match-minutes 15 --break-minutes 3 --field-count 2 \
  --first-kickoff 2026-09-05T10:00:00+02:00 --json
```

`--no-auto-book` verhindert automatische Objektbuchungen. Einzelne Spiele werden gezielt gesetzt:

```bash
comvenio tournament match-schedule <match-id> \
  --start 2026-09-05T10:00:00+02:00 \
  --end 2026-09-05T10:15:00+02:00 \
  --location "Board 1" --status proposed --match-number 1 --json
```

Administrative Bereinigung:

```bash
comvenio tournament match-delete <match-id> --json
comvenio tournament matches-clear <tournament-id> --phase group --json
comvenio tournament reset <tournament-id> --json
```

`--phase` erlaubt `group`, `finals` oder `all`.

## Ergebnisse

Fußball-/Tor-Ergebnis:

```bash
comvenio tournament match-result <match-id> --home 3 --away 1 --json
```

Tennis-/Satz-Ergebnis:

```bash
comvenio tournament match-result <match-id> --sets "6:2,7:6(9:7)" --json
comvenio tournament match-result <match-id> --sets "7:6(7:4),1:6,MTB2:10" --json
```

Sonderwertungen:

```bash
comvenio tournament match-result <match-id> --walkover --winner home --json
comvenio tournament match-result <match-id> --result-no-show --winner away --json
comvenio tournament match-result <match-id> --retired --winner away --sets "6:3,2:1" --json
comvenio tournament match-result <match-id> --result-no-contest --json
```

Nur eine Sonderwertung pro Aufruf ist erlaubt. `--retired` benötigt einen Teil-Score. `--walkover`, `--result-no-show` und `--retired` benötigen `--winner home|away`. Die Präfixe `result-` vermeiden die reservierte CAC-Semantik von `--no-*`.

## Ergebnis-Deadline

```bash
comvenio tournament deadline <tournament-id> --phase group \
  --at 2026-09-05T18:00:00+02:00 --json
comvenio tournament deadline <tournament-id> --policy manual --json
comvenio tournament deadline <tournament-id> --policy auto_no_contest --json
comvenio tournament deadline <tournament-id> --show --json
```

Ohne `--at` oder `--policy` zeigt `deadline` ebenfalls die Konfiguration und überfällige offene Spiele.

## Tabelle und Vorschau

```bash
comvenio tournament standings <tournament-id> --json
comvenio tournament preview <tournament-id> --json
comvenio tournament preview <tournament-id> --open
```

Die Vorschau wird lokal als eigenständige HTML-Datei gerendert und verändert das Turnier nicht.

## Abgrenzung

Die V3-Domäne erstellt ein Turnier kanonisch als Ausführung einer Serie über `execution-create`.
Der Backend-`POST /tournaments` verlangt ebenfalls eine `series_id`; das CLI bietet dafür bewusst
keine redundante zweite Create-Action. Serien und Ausführungen haben vollständige Read-/Update-/Delete-
Workflows. Öffentliche Anmeldung und Zuschauer-Reads gehören zur Web-/Self-Service-Oberfläche.
