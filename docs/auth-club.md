---
id: auth-club
kategorie: thema
domaenen: [login, logout, whoami, action, club]
stichwoerter: [login, anmeldung, verein, club, scopes, rechte]
---

# Anmeldung und Vereinskontext

## Wozu

Vor jeder Arbeit mit dem CLI wird eine Anmeldung hergestellt und der
Vereinskontext geprüft. Dieser Artikel beschreibt Anmeldung, Abmeldung,
Identitätsprüfung, die freigegebenen Actions sowie das Lesen und Ändern von
Vereinsprofil, Einstellungen, Abteilungen und Design.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und
welche Scopes sie brauchen, zeigt `comvenio action list --json`.

Eine gültige Anmeldung ist Voraussetzung für jeden weiteren Befehl. Die
Anmeldung entscheidet nur, *dass* jemand angemeldet ist; *was* erlaubt ist,
ergibt sich aus den angeforderten Scopes und zusätzlich aus der Rolle im
Verein. Schreibende Schritte am Vereinsprofil oder an den Einstellungen
brauchen das Recht, Vereinseinstellungen zu verwalten.

## Abläufe

### Anmelden

```bash
comvenio login
comvenio login --scopes club.read,event.read --json
```

`login` öffnet den Systembrowser und meldet über eine offene,
PKCE-gesicherte OAuth-Anmeldung an. Ohne `--scopes` fordert `login` alle
Scopes an; was tatsächlich erlaubt ist, entscheiden weiterhin die Rollen im
Verein. `--scopes` schränkt die Anmeldung bewusst ein, etwa auf reines Lesen.

Zugangsdaten werden nicht offen im CLI-Zustand gespeichert: Unter Windows
schützt der Betriebssystem-Zugangsdatenspeicher den Eintrag für den aktuellen
Benutzer, unter macOS die Schlüsselbundverwaltung, unter Linux der jeweilige
Secret-Dienst. Die Datei `~/.comvenio-cli-state.json` enthält ausschließlich
nicht geheime Angaben wie Umgebung, Verein, Client-Kennung und Scopes. Vor dem
Speichern wird der im Anmelde-Vorgang tatsächlich zugeordnete Verein geprüft.

Optionen:

| Flag | Bedeutung |
|---|---|
| `--scopes <csv>` | Anmeldung auf diese Scopes einschränken (ohne Angabe: alle) |
| `--json` | maschinenlesbare Ausgabe |

Die Datei `~/.comvenio-cli-state.json` darf grundsätzlich nie eingecheckt,
protokolliert oder in einer Antwort ausgegeben werden.

### Mit Actions arbeiten

```bash
comvenio action list --json
comvenio action call cai.event.01.list \
  --input '{"range":{"from":"2026-07-24","to":"2026-08-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true}}' \
  --json
```

`action list` liefert nur Actions, die für die aktuelle Anmeldung, den Verein,
die Scopes und die aktuellen Rechte tatsächlich sichtbar sind. Action-Kennung
und Eingabeschema stammen aus dem serverseitigen Vertrag der jeweiligen
Action. Schreibende Actions erhalten einen Wiederholungsschutz; kritische
Änderungen brauchen zusätzlich `action confirm` mit einer kurzlebigen
Vorschau. Verein, Nutzeridentität und Scopes lassen sich dabei nicht über die
Eingabe überschreiben — `club_id` gehört deshalb nie in `--input`.

### Identität prüfen

```bash
comvenio whoami --json
```

Die Ausgabe enthält unter anderem Nutzerkennung, E-Mail, Name, Vereinskennung
und Umgebung. Bei einem kurzzeitigen Ausfall der Identitätsprüfung darf
`whoami` zwischengespeicherte Angaben zeigen; ein abgelaufener oder
fehlender Zugang wird davon unabhängig weiterhin korrekt gemeldet.

### Abmelden

```bash
comvenio logout --json
```

`logout` widerruft die Anmeldung serverseitig und entfernt anschließend den
lokalen Zugangsdatensatz. Schlägt der serverseitige Widerruf vorübergehend
fehl, erscheint eine Warnung; die lokale Anmeldung wird trotzdem entfernt.

### Vereinsinformationen lesen

Noch nicht als Action verfügbar — in der Web-App erledigen. Dort stehen Name,
Kurzname, Adresse, E-Mail, Telefon, Website und Gründungsdatum des Vereins.

### Öffentliche Vereinsorgane und Impressum prüfen

Noch nicht als Action verfügbar — in der Web-App erledigen. Dort lassen sich
freigegebene Vereinsorgane mit ihren Positionen und die öffentlichen
Impressumsangaben des Vereins einsehen.

### Vereinsprofil und Einstellungen ändern

```bash
comvenio action call cai.club.03.settings --input '{}' --json
comvenio action call cai.club.02.update \
  --input '{"changes":{"name":"Neuer Vereinsname"}}' \
  --json
comvenio action call cai.club.04.settings_update \
  --input '{"settings":{"notifications":{"weekly_digest":true}}}' \
  --json
```

`cai.club.02.update` übergibt in `changes` einen teilweisen Profil-Datensatz.
Gültige Felder sind unter anderem Name, Beschreibung, Adresse, Ort,
Postleitzahl, Land, Region, Telefonnummer, E-Mail, Website, Gründungsdatum,
Adressen zu sozialen Netzwerken, Standardsprache, Standard-Zeitzone und die
verantwortliche Person. `cai.club.04.settings_update` führt mit `settings`
eine Feld-für-Feld-Zusammenführung durch für Bereiche wie Funktionen,
Datenschutzeinstellungen, Kontaktangaben, Sucheinstellungen,
Benachrichtigungen, Spracheinstellungen, Zahlungseinstellungen und eigene
Einstellungen.

### Abteilungen verwalten

```bash
comvenio action call cai.club.06.department_list --input '{}' --json
comvenio action call cai.club.06.department_list --input '{"tree":true}' --json
comvenio action call cai.club.07.department_show \
  --input '{"department_id":"<department-id>"}' \
  --json
comvenio action call cai.club.08.department_add \
  --input '{"department":{"name":"Dart","description":"Dart-Abteilung","slug":"dart","color_theme_1":"#123456","parent_department_id":null,"is_default":false}}' \
  --json
comvenio action call cai.club.09.department_update \
  --input '{"department_id":"<department-id>","changes":{"name":"Dart"}}' \
  --json
```

Beim Ändern sind zusätzlich die verantwortliche Person und eine neue
übergeordnete Abteilung erlaubt. Der Verein wird beim Anlegen aus dem
aktiven Anmeldekontext übernommen.

Löschen ist kritisch und läuft über Vorschau und Bestätigung:

```bash
comvenio action call cai.club.10.department_delete \
  --input '{"department_id":"<department-id>"}' \
  --json
# Antwort enthält preview_id und confirmation_token
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <token> \
  --idempotency-key <key>
```

### Vereinsdesign setzen

`cai.club.05.design` führt die Design-Einstellungen in `design_settings`
zusammen: nicht angegebene Felder bleiben erhalten. Die vollständigen Felder
— Farben, Schrift, Abstand, eigenes CSS, Kopfzeile — stehen im Schema:
`comvenio schema design --json`.

```bash
comvenio action call cai.club.05.design \
  --input '{"design_settings":{"homepage_theme":"modern","homepage_template":"flex","primary_color":"#123456","accent_color":"#e7b23c"}}' \
  --json
```

Vor jeder Design-Änderung anschließend die Homepage-Vorschau und -Prüfung
verwenden. Der vollständige Ablauf für die öffentliche Seite steht im Artikel
zur Vereins-Homepage.

### Vereinslogo pflegen

Noch nicht als Action verfügbar — in der Web-App erledigen. Das zuletzt dort
hochgeladene Logo gilt sofort überall, wo die Plattform das Vereinslogo
zeigt: Kopfzeile der Homepage, Bild-Widget mit Vereinslogo als Quelle,
Vereinsauswahl.

## Beispiele

Anmeldung mit eingeschränkten Scopes, danach Identität prüfen:

```bash
comvenio login --scopes club.read,event.read --json
comvenio whoami --json
```

Bestehende Action mit Eingabe aufrufen:

```bash
comvenio action list --json
comvenio action call cai.event.01.list \
  --input '{"range":{"from":"2026-07-24","to":"2026-08-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true}}' \
  --json
```

Neue Abteilung anlegen:

```bash
comvenio action call cai.club.08.department_add \
  --input '{"department":{"name":"Dart","description":"Dart-Abteilung","slug":"dart","color_theme_1":"#123456","parent_department_id":null,"is_default":false}}' \
  --json
```

## Befehle und Actions

<!-- gen:docs befehle -->

**login**

- Noch keine Action — dieser Bereich läuft über die Web-App.

**logout**

- Noch keine Action — dieser Bereich läuft über die Web-App.

**whoami**

- `cai.whoami.01.whoami` — whoami (lesen)

**action**

- Noch keine Action — dieser Bereich läuft über die Web-App.

**club**

- `cai.club.02.update` — update (ändern)
- `cai.club.03.settings` — settings (lesen)
- `cai.club.04.settings_update` — settings-update (ändern)
- `cai.club.05.design` — design (ändern)
- `cai.club.06.department_list` — department-list (lesen)
- `cai.club.07.department_show` — department-show (lesen)
- `cai.club.08.department_add` — department-add (ändern)
- `cai.club.09.department_update` — department-update (ändern)
- `cai.club.10.department_delete` — department-delete (ändern mit Bestätigung)
<!-- /gen:docs -->

## Fehler

- `AUTH_REQUIRED` — die Anmeldung ist abgelaufen, wurde widerrufen oder fehlt.
  `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — der angeforderten Anmeldung fehlt der Scope für diese
  Aktion; der nächste Befehl zeigt die passende erneute Anmeldung.
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt die
  Aktion nicht; das Recht vergibt ein Administrator des Vereins.
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — die Eingabe passt nicht zum Schema der Action, etwa
  ein fehlendes Pflichtfeld in `changes`, `settings` oder `department`.
  `comvenio help fehler VALIDATION_FAILED`.
- `OUTCOME_UNKNOWN` — `action confirm` (etwa bei `department_delete`) endete
  mit Zeitüberschreitung oder Serverfehler; nicht wiederholen, erst den Stand
  prüfen. `comvenio help fehler OUTCOME_UNKNOWN`.
- `OAUTH_ONLY` — ein alter Befehl läuft nicht über die Anmeldung; die
  passende Action verwenden. `comvenio help fehler OAUTH_ONLY`.
- `CLUB_SELECTION_REQUIRED` — der aktuellen Verbindung ist kein Verein
  zugeordnet. `comvenio help fehler CLUB_SELECTION_REQUIRED`.
- `ACTION_NOT_LISTED` — die Action steht gerade nicht in der freigegebenen
  Liste; kurz nach einer neuen Version kann das vorübergehend so sein.
  `comvenio help fehler ACTION_NOT_LISTED`.
