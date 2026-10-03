---
id: auth-club
kategorie: thema
domaenen: [login, logout, whoami, action, club]
stichwoerter: [login, anmeldung, verein, club, scopes, rechte, maschinen-grant, automation, ci]
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

### CLI installieren

Die CLI ist Source-Available und wird aus dem öffentlichen Repository gebaut;
es gibt kein npm-Paket. Voraussetzung sind `git` und [Bun](https://bun.sh).

```bash
git clone https://github.com/Comvenio/comvenio-cli.git
cd comvenio-cli
bun install
bun run build
mkdir -p ~/.local/bin && mv comvenio ~/.local/bin/
comvenio help
```

`bun run build` erzeugt eine eigenständige Datei `comvenio` (unter Windows
`comvenio.exe`), die ohne Bun läuft; der Ordner muss im Suchpfad (`PATH`)
liegen. Aktualisieren: im Ordner `git pull`, dann `bun install` und
`bun run build` wiederholen und die Datei ersetzen. `comvenio --version`
nennt Datum und Commit des Baus (etwa `0.1.0+2026-09-29.abc1234`); zeigt
`comvenio help` keine Themenliste, ist eine veraltete Fassung installiert.

### Anmelden

```bash
comvenio login
comvenio login --scopes club.read,event.read --json
comvenio login --scopes club.read,role.read.self,member.read.basic,team.read,event.read,task.read --json
```

`login` öffnet den Systembrowser und meldet über eine offene,
PKCE-gesicherte OAuth-Anmeldung an. Ohne `--scopes` fordert `login` alle
Scopes an; was tatsächlich erlaubt ist, entscheiden weiterhin die Rollen im
Verein. `--scopes` schränkt die Anmeldung bewusst ein, etwa auf reines Lesen:
Nur-Lese-Scopes enden auf `.read` (das dritte Beispiel oben). Welche Scopes
eine Action braucht, steht im Abschnitt „Befehle und Actions“ jedes Themas.

Alle Scopes: `public.read`, `club.read`, `club.write`, `member.read.basic`, `member.read.details`, `member.write`, `team.read`, `team.write`, `role.read.self`, `role.write`, `event.read`, `event.write`, `booking.read`, `booking.write`, `object.read`, `object.write`, `content.read`, `content.write`, `task.read`, `task.write`, `supply.read`, `supply.write`, `meeting.read`, `meeting.write`, `sponsor.read`, `sponsor.write`, `finance.read`, `finance.write`, `files.read`, `files.write`, `files.export`, `files.import`, `admin.write`, `connector.grants`.

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

### Ohne Browser anmelden (Maschinen-Grant)

Skripte, CI-Läufe und Server melden sich nicht über den Browser an, sondern
mit einem Maschinen-Grant des Vereins. Ein Vereinsadmin mit dem Recht,
Vereinseinstellungen zu verwalten, legt ihn in der Web-App unter
Vereinseinstellungen → „Automation“ an: Name, wenige Scopes und ein Ablauf
von 30, 90 oder 365 Tagen. Client-ID (`cvg_client_…`) und Secret (`cvgs_…`)
werden genau einmal angezeigt.

```bash
export COMVENIO_CLIENT_ID=cvg_client_…
export COMVENIO_CLIENT_SECRET=cvgs_…
comvenio whoami --json
comvenio action list --json
```

Sind beide Variablen gesetzt, holen `whoami` und `action list|call|confirm`
damit einen kurzlebigen Zugang und halten ihn nur im Speicher; es wird nichts
in die Datei `~/.comvenio-cli-state.json` oder den Zugangsdatenspeicher
geschrieben, und die Variablen haben Vorrang vor einer gespeicherten
Anmeldung. Das Secret wird nie als Argument angenommen, weil es sonst in der
Shell-Historie stünde; im CI gehört es in die geschützten Geheimnisse des
Laufs. Ein Grant für die Testumgebung braucht zusätzlich
`COMVENIO_ENV=dev` (ohne Angabe gilt `prod`).

Der Grant handelt mit den Rechten der Person, die ihn angelegt hat, und nie
mit mehr als seinen Scopes; verliert sie Rechte, verliert der Grant sie mit.
`admin.write`, `role.write`, `connector.grants` und `member.read.details`
sind für Maschinen-Grants gesperrt. Kritische Actions verlangen auch hier den
zweiten Schritt `action confirm`. Die übrigen Befehle ohne Action laufen mit
einem Maschinen-Grant nicht.

Ist ein Grant widerrufen oder abgelaufen oder wurde sein Secret erneuert,
meldet die CLI `AUTH_REQUIRED`; fehlt eine der beiden Variablen, nennt die
Meldung sie.

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

### KI-Assistenten verbinden (Connector)

Claude, ChatGPT und andere Assistenten mit MCP-Unterstützung arbeiten ohne
CLI direkt mit Comvenio. Im Assistenten einen eigenen Connector
(„Custom Connector“ bzw. „Connector hinzufügen“) mit der Adresse
`https://mcp.comvenio.app/mcp` anlegen; der Assistent öffnet danach die
Comvenio-Anmeldung im Browser, dort Verein wählen und die angefragten Scopes
bestätigen. Der Connector nutzt dieselben Actions, Scopes und Bestätigungen
wie die CLI; Verein und Rechte kommen aus dieser Anmeldung und der Rolle im
Verein. Die Kundenhilfe (`comvenio_hilfe`) steht dort auch ohne Anmeldung
bereit. Trennen: den Connector im Assistenten entfernen.

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
  --input '{"settings":{"notification_settings":{"notification_frequency":"weekly"}}}' \
  --json
```

`cai.club.02.update` übergibt in `changes` einen teilweisen Profil-Datensatz.
Gültige Felder sind unter anderem Name, Beschreibung, Adresse, Ort,
Postleitzahl, Land, Region, Telefonnummer, E-Mail, Website, Gründungsdatum,
Adressen zu sozialen Netzwerken, Standardsprache, Standard-Zeitzone und die
verantwortliche Person. `cai.club.04.settings_update` führt mit `settings`
eine Feld-für-Feld-Zusammenführung durch für diese Bereiche:
`organization_type`, `design_settings`, `features`, `homepage_config`,
`privacy_settings`, `contact_info`, `seo_settings`, `notification_settings`
und `locale_settings`.

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
`comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"design"}'`.

```bash
comvenio action call cai.club.05.design \
  --input '{"design_settings":{"homepage_theme":"modern","homepage_template":"flex","primary_color":"#123456","accent_color":"#e7b23c"}}' \
  --json
```

Schriften für Web und App legen die Schriftrollen in `tokens.type` fest:
`source: plattform` für die Familien der Schriftpaare (Merriweather, Lato,
Oswald, Open Sans, Nunito, Montserrat, Source Sans 3), `source: system` für
`serif`, `sans-serif` oder `system-ui`, `source: verein` für eine hochgeladene
Vereinsschrift mit `font_id` aus `design_settings.fonts`. Die App lädt
Vereinsschriften nur als TTF.

```bash
comvenio action call cai.club.05.design \
  --input '{"design_settings":{"tokens":{"type":{"heading":{"family":"Merriweather","source":"plattform","weight":700},"body":{"family":"Lato","source":"plattform"}}}}}' \
  --json
```

### Vereinsschrift hochladen

`cai.club.15.font_upload` lädt eine eigene Schrift (TTF oder WOFF2, höchstens
2 MB, mit Lizenzangabe) hoch und trägt sie in `design_settings.fonts` ein. Die
Antwort nennt die `font_id`; sie gehört danach in `tokens.type` mit
`source: verein`. Eine Schrift derselben Familie wird ersetzt, Rollen, die
sie nutzten, zeigen danach auf die neue Datei; mehr als zwei Familien nimmt der
Verein nicht auf. Die App lädt nur TTF.

```bash
comvenio action call cai.club.15.font_upload \
  --file ./JagaSerif.ttf \
  --input '{"club_id":"<club-id>","family":"Jaga Serif","lizenz":"SIL OFL 1.1"}' \
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

- `cai.whoami.01.whoami` — whoami (lesen) · Scopes: `club.read`

**action**

- Noch keine Action — dieser Bereich läuft über die Web-App.

**club**

- `cai.club.02.update` — update (ändern) · Scopes: `admin.write`
- `cai.club.03.settings` — settings (lesen) · Scopes: `club.read`
- `cai.club.04.settings_update` — settings-update (ändern) · Scopes: `admin.write`
- `cai.club.05.design` — design (ändern) · Scopes: `admin.write`
- `cai.club.06.department_list` — department-list (lesen) · Scopes: `club.read`
- `cai.club.07.department_show` — department-show (lesen) · Scopes: `club.read`
- `cai.club.08.department_add` — department-add (ändern) · Scopes: `admin.write`
- `cai.club.09.department_update` — department-update (ändern) · Scopes: `admin.write`
- `cai.club.10.department_delete` — department-delete (ändern mit Bestätigung) · Scopes: `admin.write`
- `cai.club.13.forum_board_list` — forum-board-list (lesen) · Scopes: `club.read`
- `cai.club.14.forum_thread_list` — forum-thread-list (lesen) · Scopes: `club.read`
- `cai.club.15.font_upload` — font-upload (ändern) · Scopes: `club.read`, `admin.write`, `files.import`, `files.write`
<!-- /gen:docs -->

## Fehler

- `AUTH_REQUIRED` — die Anmeldung ist abgelaufen, wurde widerrufen oder fehlt.
  Beim Maschinen-Grant: eine der Variablen `COMVENIO_CLIENT_ID` oder
  `COMVENIO_CLIENT_SECRET` fehlt (die Meldung nennt sie), oder der Grant ist
  widerrufen, abgelaufen oder hat ein neues Secret.
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
- `USAGE_ERROR` — auch ein Befehl, den es im CLI nicht mehr gibt; die
  passende Action verwenden. `comvenio help fehler USAGE_ERROR`.
- `CLUB_SELECTION_REQUIRED` — der aktuellen Verbindung ist kein Verein
  zugeordnet. `comvenio help fehler CLUB_SELECTION_REQUIRED`.
- `ACTION_NOT_LISTED` — die Action steht gerade nicht in der freigegebenen
  Liste; kurz nach einer neuen Version kann das vorübergehend so sein.
  `comvenio help fehler ACTION_NOT_LISTED`.
