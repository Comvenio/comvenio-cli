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

Eine gültige Anmeldung ist Voraussetzung für jeden weiteren Befehl. Die
Anmeldung entscheidet nur, *dass* jemand angemeldet ist; *was* erlaubt ist,
ergibt sich aus den angeforderten Scopes und zusätzlich aus der Rolle im
Verein. Schreibende Schritte am Vereinsprofil oder an den Einstellungen
brauchen das Recht, Vereinseinstellungen zu verwalten.

## Abläufe

### Anmelden

```bash
comvenio login
comvenio login --env dev --json
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
| `--device-token <token>` | nur Entwicklung/Automation; opakes Token als Alternative zur Browser-Anmeldung |
| `--env prod\|dev\|local` | Betriebsziel, Standard `prod` |
| `--scopes <csv>` | Anmeldung auf diese Scopes einschränken (ohne Angabe: alle) |
| `--club <id>` | nur mit `--device-token`: Vereinskontext ausdrücklich setzen |
| `--json` | maschinenlesbare Ausgabe |

Für eine rein lokale Testumgebung ohne öffentlich erreichbares, gesichertes
Gateway ist die Browser-Anmeldung bewusst gesperrt; dort ist `--device-token`
erforderlich. Dieser Ausweichweg speichert das opake Token weiterhin im
Zustand — die Datei `~/.comvenio-cli-state.json` darf deshalb grundsätzlich
nie eingecheckt, protokolliert oder in einer Antwort ausgegeben werden.

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
Eingabe überschreiben.

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

Bei einer Browser-Anmeldung widerruft `logout` die Anmeldung serverseitig und
entfernt anschließend den lokalen Zugangsdatensatz. Schlägt der serverseitige
Widerruf vorübergehend fehl, erscheint eine Warnung; die lokale Anmeldung wird
trotzdem entfernt. Ein ausdrücklich gesetztes Entwicklungs-Token wird dabei
nicht serverseitig widerrufen.

### Vereinsinformationen lesen

```bash
comvenio club info --json
comvenio club info --club <club-id> --json
```

Die menschenlesbare Ansicht zeigt Name, Kurzname, Adresse, E-Mail, Telefon,
Website und Gründungsdatum, soweit vorhanden; für automatisierte Arbeit ist
die maschinenlesbare Ausgabe maßgeblich.

### Öffentliche Vereinsorgane und Impressum prüfen

```bash
comvenio club group-list --json
comvenio club position-list --json
comvenio club public-organ <group-id> --json
comvenio club public-organ <group-id> --avatars --json
comvenio club public-legal --json
```

Diese Abfrage liefert nur ausdrücklich freigegebene Organe aktiver Vereine.
Standardpositionen werden ausgeschlossen; Mitglieder ohne eine andere
aktuelle Position erscheinen nicht. Die Antwort enthält Namen und
Positionsbeschreibungen, aber keine privaten Kontaktdaten. Öffentliche
Profilbilder werden ausschließlich mit `--avatars` angefordert; fehlende
Bilder sind erlaubt. Die Freigabe eines Organs wird getrennt verwaltet — diese
Lesebefehle verändern sie nicht. `public-legal` prüft die öffentlichen
Vereinsangaben samt aufgelöstem Verantwortlichen; fehlende Angaben werden
nicht durch erfundene Daten ersetzt.

### Vereinsprofil und Einstellungen ändern

```bash
comvenio club update --file club-update.json --json
comvenio club settings --json
comvenio club settings-update --file settings-update.json --json
```

`club update` übergibt einen teilweisen Profil-Datensatz. Gültige Felder sind
unter anderem Name, Beschreibung, Adresse, Ort, Postleitzahl, Land, Region,
Telefonnummer, E-Mail, Website, Gründungsdatum, Adressen zu sozialen Netzwerken,
Standardsprache, Standard-Zeitzone und die verantwortliche Person.
`settings-update` führt eine Feld-für-Feld-Zusammenführung durch für
Bereiche wie Funktionen, Datenschutzeinstellungen, Kontaktangaben,
Sucheinstellungen, Benachrichtigungen, Spracheinstellungen,
Zahlungseinstellungen und eigene Einstellungen.

### Abteilungen verwalten

```bash
comvenio club department-list --json
comvenio club department-list --tree --json
comvenio club department-show <department-id> --json
comvenio club department-add --file department.json --json
comvenio club department-update <department-id> --file department-update.json --json
comvenio club department-delete <department-id> --json
```

Beispiel für `department.json`:

```json
{
  "name": "Dart",
  "description": "Dart-Abteilung",
  "slug": "dart",
  "color_theme_1": "#123456",
  "parent_department_id": null,
  "is_default": false
}
```

Beim Ändern sind zusätzlich die verantwortliche Person und eine neue
übergeordnete Abteilung erlaubt. Der Verein wird beim Anlegen aus dem
aktiven Anmeldekontext übernommen, nicht aus der Datei.

### Vereinsdesign setzen

`club design` führt die Design-Einstellungen zusammen: nicht angegebene
Felder bleiben erhalten.

```bash
comvenio club design \
  --template modern \
  --public-template flex \
  --primary "#123456" \
  --accent "#e7b23c" \
  --font modern \
  --spacing balanced \
  --dry-run --json

comvenio club design --file design-settings.json --json
```

| Flag | Wirkung |
|---|---|
| `--template <name>` | internes Vereinsbereich-Thema |
| `--public-template <id>` | Vorlage der öffentlichen Homepage |
| `--primary`, `--accent`, `--secondary` | Markenfarben als Hex-Wert |
| `--font <pair>` | erlaubte Schriftkombination |
| `--spacing <mode>` | Abstandsmodus |
| `--file <json>` | vollständiges teilweises Design-Objekt |
| `--css-file <css>` | begrenztes eigenes CSS |
| `--tokens-file <json>` | Design-Tokens wie Palette, Rundung und Typografie |
| `--header-layout`, `--header-surface`, `--header-density` | öffentliche Kopfzeile |
| `--header-sticky <true\|false>` | Sticky-Verhalten der Kopfzeile |
| `--clear-header` | eigene Kopfzeilen-Konfiguration entfernen |
| `--dry-run` | Nutzlast anzeigen, nichts schreiben |

Vor jeder Design-Änderung erst `--dry-run --json`, anschließend die
Homepage-Vorschau und -Prüfung verwenden. Der vollständige Ablauf für die
öffentliche Seite steht im Artikel zur Vereins-Homepage.

### Vereinslogo pflegen

```bash
comvenio club logo --json                          # aktuelles Logo (Metadaten)
comvenio club logo-upload --file wappen.png --json  # neues Logo hochladen
```

Das zuletzt hochgeladene Logo gilt sofort überall, wo die Plattform das
Vereinslogo zeigt: Kopfzeile der Homepage, Bild-Widget mit Vereinslogo als
Quelle, Vereinsauswahl. Ein Bild mit transparentem Hintergrund wirkt auf
farbigen Flächen am besten. Ein gewöhnlicher Datei-Upload ersetzt das Logo
**nicht** — die Logo-Auswahl berücksichtigt nur Dateien, die über
`logo-upload` hochgeladen wurden.

## Beispiele

Anmeldung mit eingeschränkten Scopes, danach Identität und Verein prüfen:

```bash
comvenio login --scopes club.read,event.read --json
comvenio whoami --json
comvenio club info --json
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
comvenio club department-add --file department.json --json
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**login** — vollständig

- `comvenio login`
- `comvenio login --device-token`

**logout** — vollständig

- `comvenio logout`

**whoami** — vollständig

- `comvenio whoami`

**action** — vollständig

- `comvenio action list`
- `comvenio action call`
- `comvenio action confirm`

**club** — vollständig

- `comvenio club info`
- `comvenio club update`
- `comvenio club settings`
- `comvenio club settings-update`
- `comvenio club design`
- `comvenio club logo`
- `comvenio club logo-upload`
- `comvenio club contact-requests`
- `comvenio club contact-request-done`
- `comvenio club contact-request-reopen`
- `comvenio club contact-request-delete`
- `comvenio club department-list`
- `comvenio club department-show`
- `comvenio club department-add`
- `comvenio club department-update`
- `comvenio club department-delete`
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
- `OAUTH_ONLY` — ein klassischer Befehl läuft nicht über die aktuelle
  Anmeldung; die passende Action verwenden. `comvenio help fehler OAUTH_ONLY`.
- `CLUB_SELECTION_REQUIRED` — der aktuellen Verbindung ist kein Verein
  zugeordnet. `comvenio help fehler CLUB_SELECTION_REQUIRED`.
- `ACTION_NOT_LISTED` — die Action steht gerade nicht in der freigegebenen
  Liste; kurz nach einer neuen Version kann das vorübergehend so sein.
  `comvenio help fehler ACTION_NOT_LISTED`.
