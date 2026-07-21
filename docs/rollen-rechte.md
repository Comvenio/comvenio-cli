# Rollen und Berechtigungen

Der Top-Level-Command `role` verwaltet Custom Roles, deren Berechtigungsmatrix sowie direkte und positionsbasierte Rollenzuweisungen. Schreibende Aktionen benötigen serverseitig `manage_roles`.

Geschützte Standardrollen sind lesbar, aber unveränderlich. Es gibt bewusst kein öffentliches `--force`.

## Rollen lesen und verwalten

```bash
comvenio role list --json
comvenio role show <role-id> --json
comvenio role create --name "Kassenwart" --description "Darf Vereinsfinanzen verwalten" --json
comvenio role update <role-id> --description "Aktualisierte Beschreibung" --json
comvenio role delete <role-id> --json
comvenio role restore <role-id> --json
```

Rollennamen sind innerhalb eines Clubs nach Entfernen äußerer Leerzeichen und unabhängig von Groß-/Kleinschreibung eindeutig. Ein Konflikt liefert HTTP `409`; vorhandene Dubletten werden nicht automatisch zusammengeführt.

## Permission-Definitionen und Matrix

Alle verfügbaren Permission-Keys:

```bash
comvenio role permission-defs --json
comvenio role permissions show --role-id <role-id> --json
```

Genau einen Wert ändern:

```bash
comvenio role permission set \
  --role-id <role-id> \
  --permission-key manage_events \
  --allowed true \
  --json
```

Eine Matrix-Datei ist ein JSON-Objekt mit booleschen Werten:

```json
{
  "manage_events": true,
  "manage_finances": false
}
```

Alternativ ist die Hülle `{ "values": { ... } }` zulässig; `{ "permissions": { ... } }` bleibt als Lesealias kompatibel.

Standardmäßig werden nur gelieferte Keys geändert:

```bash
comvenio role permissions apply --role-id <role-id> --file matrix.json --json
```

`--replace` ist ein vollständiger Ersatz. Nicht gelieferte Keys werden `false`. Ohne `--yes` zeigt das CLI den vollständigen Vorher-/Nachher-Diff und führt keinen Write aus. Mit `--yes` liest es denselben Stand im aktuellen Lauf erneut und sichert den Write über `expected_before` gegen parallele Änderungen ab:

```bash
comvenio role permissions apply --role-id <role-id> --file matrix.json --replace --json
comvenio role permissions apply --role-id <role-id> --file matrix.json --replace --yes --json
```

## Direkte Rollenzuweisungen

Zuweisungen akzeptieren ausschließlich eine stabile `member_id` und einen expliziten Scope.

```bash
comvenio role assign \
  --member-id <member-id> \
  --role-id <role-id> \
  --scope club \
  --json

comvenio role assign \
  --member-id <member-id> \
  --role-id <role-id> \
  --scope department \
  --department-id <department-id> \
  --json
```

`club` verbietet `--department-id`; `department` verlangt das Flag. Fehler werden vor dem Write erkannt.

```bash
comvenio role assignments --json
comvenio role assignments --member-id <member-id> --json
comvenio role assignments --role-id <role-id> --json
comvenio role assignments --department-id <department-id> --json
comvenio role unassign <assignment-id> --json
comvenio role assignment-restore <assignment-id> --json
```

## Rollen an Positionen koppeln

```bash
comvenio role position-link \
  --position-id <position-id> \
  --role-id <role-id> \
  --department-id <department-id> \
  --json

comvenio role position-list --position-id <position-id> --json
comvenio role position-unlink <assignment-id> --json
comvenio role position-restore <assignment-id> --json
```

Die Positionsverknüpfung beschreibt die fachliche Zuordnung. Effektive Rechte kennzeichnen daraus entstandene Mitgliedszuweisungen mit der Quelle `position`.

## Effektive Rechte mit Provenienz

```bash
comvenio role effective --member-id <member-id> --json
comvenio role effective --member-id <member-id> --department-id <department-id> --json
```

Die Antwort wird serverseitig berechnet. `permissions` enthält das zusammengeführte Ergebnis; `sources` zeigt für jede beteiligte Rolle den Permission-Key, das Ergebnis, Rolle, Scope und die Quelle `direct` oder `position`.

Ohne `--department-id` gelten nur Club-Zuweisungen. Mit Abteilung werden Club-Zuweisungen und Zuweisungen genau dieser Abteilung berücksichtigt.

## Sicherheitsgrenzen

- Keine Mutation geschützter Rollen oder ihrer Matrix.
- Kein öffentliches Force-Delete und keine Club-weiten Wipe-Aktionen.
- Delete, Unassign und Position-Unlink sind Soft-Deletes; Restore bleibt jeweils ein eigener, expliziter Zustand.
- Kritische Mutationen liefern maschinenlesbar Ziel, Ist-Stand, Diff, Risiko und `run_id`.
- Keine Zuweisung über Namen oder E-Mail-Adressen.
- Keine automatische Wiederholung schreibender Requests.
- Jeder Matrix-Ersatz benötigt eine sichtbare Vorschau und explizite Bestätigung.
