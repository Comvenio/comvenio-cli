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

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen, zeigt `comvenio action list --json`. Schreibende Rollen-Actions verlangen serverseitig das Recht `manage_roles`. Geschützte Standardrollen des Vereins lassen sich lesen, aber nicht ändern — dafür gibt es bewusst keinen erzwingenden Sonderweg.

## Abläufe

### Rolle anlegen und pflegen

`cai.role.03.create` legt eine Rolle mit `name` und `description` an. Rollennamen sind innerhalb eines Vereins nach Entfernen äußerer Leerzeichen und unabhängig von Groß-/Kleinschreibung eindeutig; ein Namenskonflikt liefert einen Konfliktfehler, vorhandene Dubletten werden dabei nicht automatisch zusammengeführt. `cai.role.04.update` ändert `name` und/oder `description` (mindestens ein Feld). `cai.role.05.delete` ist `critical_write`. Eine gelöschte Rolle wiederherzustellen: Noch nicht als Action verfügbar — in der Web-App erledigen.

### Berechtigungsmatrix setzen

1. `cai.role.06.permission_defs` liefert die verfügbaren Berechtigungs-Schlüssel; `cai.role.08.permissions_show_apply` mit `operation: show` die aktuelle Matrix einer Rolle.
2. `cai.role.07.permission_set` ändert genau einen Wert gezielt (`permission_key`, `allowed`) — `reversible_write`.
3. `cai.role.08.permissions_show_apply` mit `operation: apply` wendet eine ganze Matrix (`values`) an; ohne `replace` ist das additiv, nur gelieferte Schlüssel werden geändert, mit `replace: true` setzt es alle nicht gelieferten Schlüssel ausdrücklich auf „nicht erlaubt". Beide Ausprägungen dieser Action sind laut Freigabeliste `critical_write`: Der Aufruf liefert zunächst nur eine Vorschau mit `preview_id` und `confirmation_token`; erst `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>` mit diesen Werten führt die Änderung aus und sichert sie gegen zwischenzeitliche parallele Änderungen ab.

### Rolle direkt zuweisen (`cai.role.09.assign`)

Eine Zuweisung akzeptiert ausschließlich eine stabile Mitglieds-ID (`member_id`) und einen ausdrücklichen Geltungsbereich (`scope`): `club` oder `department`. Der Club-Geltungsbereich verbietet eine Abteilungsangabe, der Abteilungs-Geltungsbereich verlangt `department_id`; Fehler dabei werden schon vor dem eigentlichen Schreiben erkannt. `cai.role.10.unassign` ist `critical_write`. Eine entfernte Zuweisung wiederherzustellen: Noch nicht als Action verfügbar — in der Web-App erledigen.

### Rolle an eine Position koppeln

`cai.role.12.position_link` beschreibt die fachliche Zuordnung: Wer diese Position innehat, erhält die verknüpfte Rolle automatisch. `cai.role.14.position_list` listet die Kopplungen einer Position. `cai.role.13.position_unlink` ist `critical_write`. Eine entkoppelte Position wiederherzustellen: Noch nicht als Action verfügbar — in der Web-App erledigen.

### Effektive Rechte nachvollziehen

Noch nicht als Action verfügbar — in der Web-App erledigen.

### Sicherheitsgrenzen

- Geschützte Standardrollen und ihre Matrix lassen sich nicht ändern.
- Es gibt kein öffentliches erzwungenes Löschen und keine vereinsweiten Aufräum-Aktionen.
- Eine Zuweisung läuft ausschließlich über die Mitglieds-ID, nie über Namen oder E-Mail-Adresse.
- Schreibende Aufrufe werden nicht automatisch wiederholt.
- Kritische Actions liefern maschinenlesbar Ziel, Ist-Stand, Unterschied, Risiko und eine Vorschau-Kennung; erst `action confirm` mit dieser Kennung und einem stabilen `--idempotency-key` führt die Änderung aus.

## Beispiele

```bash
comvenio action call cai.role.01.list --input '{}'
comvenio action call cai.role.02.show --input '{"role_id":"<role-id>"}'
comvenio action call cai.role.03.create --input '{"role":{"name":"Kassenwart","description":"Darf Vereinsfinanzen verwalten"}}'
comvenio action call cai.role.04.update --input '{"role_id":"<role-id>","changes":{"description":"Aktualisierte Beschreibung"}}'
comvenio action call cai.role.05.delete --input '{"role_id":"<role-id>"}'
# Antwort liefert preview_id, confirmation_token, Ziel, Ist-Stand, Unterschied und Risiko
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.role.06.permission_defs --input '{}'
comvenio action call cai.role.08.permissions_show_apply --input '{"operation":"show","role_id":"<role-id>"}'

comvenio action call cai.role.07.permission_set --input '{"role_id":"<role-id>","permission_key":"manage_events","allowed":true}'
```

Matrix als Eingabe:

```bash
comvenio action call cai.role.08.permissions_show_apply --input '{
  "operation": "apply",
  "role_id": "<role-id>",
  "values": [
    { "permission_key": "manage_events", "allowed": true },
    { "permission_key": "manage_finances", "allowed": false }
  ],
  "replace": false
}'
# Antwort liefert preview_id, confirmation_token, Ziel, Ist-Stand, Unterschied und Risiko
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.role.09.assign --input '{"member_id":"<member-id>","role_id":"<role-id>","scope":"club"}'

comvenio action call cai.role.09.assign --input '{
  "member_id": "<member-id>",
  "role_id": "<role-id>",
  "scope": "department",
  "department_id": "<department-id>"
}'

comvenio action call cai.role.11.assignments --input '{"selector":{"type":"club"}}'
comvenio action call cai.role.11.assignments --input '{"selector":{"type":"member","member_id":"<member-id>"}}'
comvenio action call cai.role.11.assignments --input '{"selector":{"type":"role","role_id":"<role-id>"}}'
comvenio action call cai.role.11.assignments --input '{"selector":{"type":"department","department_id":"<department-id>"}}'
comvenio action call cai.role.10.unassign --input '{"assignment_id":"<assignment-id>"}'
```

```bash
comvenio action call cai.role.12.position_link --input '{
  "position_id": "<position-id>",
  "role_id": "<role-id>",
  "department_id": "<department-id>"
}'

comvenio action call cai.role.14.position_list --input '{"position_id":"<position-id>"}'
comvenio action call cai.role.13.position_unlink --input '{"assignment_id":"<assignment-id>"}'
```

## Befehle und Actions

<!-- gen:docs befehle -->

**role**

- `cai.role.01.list` — list (lesen)
- `cai.role.02.show` — show (lesen)
- `cai.role.03.create` — create (ändern)
- `cai.role.04.update` — update (ändern)
- `cai.role.05.delete` — delete (ändern mit Bestätigung)
- `cai.role.06.permission_defs` — permission-defs (lesen)
- `cai.role.07.permission_set` — permission set (ändern)
- `cai.role.08.permissions_show_apply` — permissions show|apply (ändern mit Bestätigung)
- `cai.role.09.assign` — assign (ändern)
- `cai.role.10.unassign` — unassign (ändern mit Bestätigung)
- `cai.role.11.assignments` — assignments (lesen)
- `cai.role.12.position_link` — position-link (ändern)
- `cai.role.13.position_unlink` — position-unlink (ändern mit Bestätigung)
- `cai.role.14.position_list` — position-list (lesen)
- Felder und Werte: `comvenio schema role --json`
<!-- /gen:docs -->

## Fehler

- `CONFLICT` — der Rollenname ist innerhalb des Vereins schon vergeben, oder eine Matrix wurde seit der letzten Vorschau geändert. Mehr: `comvenio help fehler CONFLICT`
- `VALIDATION_FAILED` — ein Geltungsbereich passt nicht zur Abteilungsangabe, oder ein Feld hat das falsche Format. Mehr: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — Rolle, Zuweisung oder Positionskopplung existiert nicht oder ist nicht sichtbar. Mehr: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt das Verwalten von Rollen nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Scope zum Verwalten von Rollen. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `OUTCOME_UNKNOWN` — bei einer ändernden Action blieb die Serverantwort aus; vor einer Wiederholung mit einer lesenden Action prüfen, ob die Änderung schon angekommen ist. Mehr: `comvenio help fehler OUTCOME_UNKNOWN`
