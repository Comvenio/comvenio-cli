---
id: rollen-rechte
kategorie: thema
domaenen: [role]
stichwoerter: [rollen, rechte, berechtigungen, zuweisung, positionen]
---

# Rollen und Berechtigungen

## Wozu

Mit Rollen legt ein Verein eigene Rollen mit einer Berechtigungsmatrix an und weist sie Mitgliedern direkt oder über eine Position zu — und kann jederzeit nachvollziehen, welche Rechte ein Mitglied woher hat.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

Anmeldung mit `comvenio login`; welche Scopes eine einzelne Action braucht, zeigt `comvenio action list --json`. Schreibende Rollen-Aktionen verlangen serverseitig das Recht `manage_roles`. Geschützte Standardrollen des Vereins lassen sich lesen, aber nicht ändern — dafür gibt es bewusst keinen erzwingenden Sonderweg.

## Abläufe

### Rolle anlegen und pflegen

Rollennamen sind innerhalb eines Vereins nach Entfernen äußerer Leerzeichen und unabhängig von Groß-/Kleinschreibung eindeutig. Ein Namenskonflikt liefert einen Konfliktfehler; vorhandene Dubletten werden dabei nicht automatisch zusammengeführt. Eine gelöschte Rolle lässt sich wiederherstellen.

### Berechtigungsmatrix setzen

1. Verfügbare Berechtigungs-Schlüssel und die aktuelle Matrix einer Rolle abrufen.
2. Entweder genau einen Wert gezielt ändern oder eine ganze Matrix-Datei anwenden.
3. Eine Matrix-Datei ist standardmäßig additiv: Nur gelieferte Schlüssel werden geändert. Ein vollständiger Ersatz setzt alle nicht gelieferten Schlüssel ausdrücklich auf „nicht erlaubt".
4. Ohne ausdrückliche Bestätigung zeigt das CLI nur den vollständigen Vorher-/Nachher-Unterschied und führt keine Änderung aus. Mit Bestätigung liest es denselben Stand im selben Lauf erneut und sichert die Änderung gegen zwischenzeitliche parallele Änderungen ab.

Eine Matrix-Datei ist ein JSON-Objekt mit wahr/falsch-Werten je Berechtigungs-Schlüssel; alternativ ist eine Hülle mit dem Feld `values` zulässig. Eine Hülle mit dem Feld `permissions` bleibt zum Lesen kompatibel, gilt aber als veraltet.

### Rolle direkt zuweisen

Eine Zuweisung akzeptiert ausschließlich eine stabile Mitglieds-ID und einen ausdrücklichen Geltungsbereich: entweder den gesamten Verein oder eine bestimmte Abteilung. Der Vereins-Geltungsbereich verbietet eine Abteilungsangabe, der Abteilungs-Geltungsbereich verlangt sie; Fehler dabei werden schon vor dem eigentlichen Schreiben erkannt. Eine Zuweisung, ein Entfernen und ein Entkoppeln von einer Position sind jeweils Soft-Deletes — die Wiederherstellung ist ein eigener, ausdrücklicher Schritt.

### Rolle an eine Position koppeln

Die Kopplung an eine Position beschreibt die fachliche Zuordnung: Wer diese Position innehat, erhält die verknüpfte Rolle automatisch. Effektive Rechte, die daraus entstehen, tragen die Quelle „Position" statt „direkt".

### Effektive Rechte nachvollziehen

Die effektiven Rechte eines Mitglieds werden serverseitig zusammengeführt: Ohne Abteilungsangabe zählen nur Vereins-Zuweisungen, mit Abteilungsangabe zusätzlich die Zuweisungen genau dieser Abteilung. Für jede beteiligte Rolle zeigt die Antwort den Berechtigungs-Schlüssel, das Ergebnis, die Rolle, den Geltungsbereich und ob das Recht direkt oder über eine Position zustande kam.

### Sicherheitsgrenzen

- Geschützte Standardrollen und ihre Matrix lassen sich nicht ändern.
- Es gibt kein öffentliches erzwungenes Löschen und keine vereinsweiten Aufräum-Aktionen.
- Löschen, Entfernen und Entkoppeln sind Soft-Deletes; Wiederherstellen bleibt jeweils ein eigener Zustand.
- Kritische Änderungen liefern maschinenlesbar Ziel, Ist-Stand, Unterschied, Risiko und eine Vorgangs-Kennung.
- Eine Zuweisung läuft ausschließlich über die Mitglieds-ID, nie über Namen oder E-Mail-Adresse.
- Schreibende Aufrufe werden nicht automatisch wiederholt.
- Jeder vollständige Matrix-Ersatz verlangt eine sichtbare Vorschau und eine ausdrückliche Bestätigung.

## Beispiele

```bash
comvenio role list --json
comvenio role show <role-id> --json
comvenio role create --name "Kassenwart" --description "Darf Vereinsfinanzen verwalten" --json
comvenio role update <role-id> --description "Aktualisierte Beschreibung" --json
comvenio role delete <role-id> --json
comvenio role restore <role-id> --json
```

```bash
comvenio role permission-defs --json
comvenio role permissions show --role-id <role-id> --json

comvenio role permission set \
  --role-id <role-id> \
  --permission-key manage_events \
  --allowed true \
  --json
```

Matrix-Datei:

```json
{
  "manage_events": true,
  "manage_finances": false
}
```

```bash
comvenio role permissions apply --role-id <role-id> --file matrix.json --json
comvenio role permissions apply --role-id <role-id> --file matrix.json --replace --json
comvenio role permissions apply --role-id <role-id> --file matrix.json --replace --yes --json
```

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

comvenio role assignments --json
comvenio role assignments --member-id <member-id> --json
comvenio role assignments --role-id <role-id> --json
comvenio role assignments --department-id <department-id> --json
comvenio role unassign <assignment-id> --json
comvenio role assignment-restore <assignment-id> --json
```

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

```bash
comvenio role effective --member-id <member-id> --json
comvenio role effective --member-id <member-id> --department-id <department-id> --json
```

## Befehle und Actions

<!-- gen:docs befehle -->

**role** — vollständig

- `comvenio role list`
- `comvenio role show`
- `comvenio role create`
- `comvenio role update`
- `comvenio role delete`
- `comvenio role permission-defs`
- `comvenio role permission set`
- `comvenio role permissions show|apply`
- `comvenio role assign`
- `comvenio role unassign`
- `comvenio role assignments`
- `comvenio role position-link`
- `comvenio role position-unlink`
- `comvenio role position-list`
- `comvenio role effective`
- Felder und Werte: `comvenio schema role --json`
<!-- /gen:docs -->

## Fehler

- `CONFLICT` — der Rollenname ist innerhalb des Vereins schon vergeben, oder eine Matrix wurde seit der letzten Vorschau geändert. Mehr: `comvenio help fehler CONFLICT`
- `VALIDATION_FAILED` — ein Geltungsbereich passt nicht zur Abteilungsangabe, oder ein Feld hat das falsche Format. Mehr: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — Rolle, Zuweisung oder Positionskopplung existiert nicht oder ist nicht sichtbar. Mehr: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt das Verwalten von Rollen nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Scope zum Verwalten von Rollen. Mehr: `comvenio help fehler SCOPE_REQUIRED`
