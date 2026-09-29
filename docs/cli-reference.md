---
id: cli-reference
kategorie: thema
domaenen: [schema, help, verify, plan]
stichwoerter: [cli, referenz, befehle, schema, verify]
---

# comvenio CLI — Übersicht

## Wozu

Dieser Artikel ist der Einstieg in das comvenio CLI: die Grundregeln jedes
Aufrufs, die Bereiche im Überblick mit Verweis auf ihren eigenen Artikel,
sowie die Themenbefehle `schema` und `verify`, die kein eigenes Thema,
sondern jeden anderen Bereich begleiten. Die vollständige Workflow-Coverage
mit bekannten Lücken und bewussten Ausschlüssen je Bereich steht in
[`coverage.md`](coverage.md).

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und
welche Scopes sie brauchen, zeigt `comvenio action list --json`.

Jeder Befehl braucht eine gültige Anmeldung; Ausnahmen und Details stehen im
Artikel zu Anmeldung und Vereinskontext. Welche Befehle darüber hinaus
erlaubt sind, ergibt sich aus den Scopes der Anmeldung und der Rolle im
Verein — die serverseitige Prüfung entscheidet, nicht das CLI selbst.

## Abläufe

### Grundregeln

```bash
comvenio <command> --help
comvenio <command> ... --json
```

- Für automatisierte Aufrufe immer `--json` verwenden. Erfolgreiche
  Antworten landen auf der Standardausgabe, Fehler auf der Fehlerausgabe.
- Die Anmeldung läuft über den Browser mit sicherer Speicherung im
  jeweiligen Betriebssystem.
- Rechte werden serverseitig geprüft: `401` bedeutet in der Regel eine
  ungültige oder abgelaufene Anmeldung, `403` ein fehlendes Recht, `404` eine
  unbekannte Ressource.
- Gibt es für eine Aufgabe keine passende Action, ist das eine Lücke im
  Connector — sie wird dort geschlossen, nicht umgangen.
- Änderungen werden nicht automatisch wiederholt; nur lesende Abfragen haben
  einen begrenzten Wiederholungsversuch bei vorübergehenden Fehlern.

### Bereiche und ihre Actions

Jeder Bereich hat einen eigenen Artikel. Der Weg zu seinen Actions ist immer
derselbe: `comvenio action list` zeigt, was für die aktuelle Anmeldung
freigegeben ist (`--json` zeigt zusätzlich Eingaben und Scopes), und
`comvenio action call <action-id> --input '<json>'` führt sie aus.

| Bereich | Artikel |
|---|---|
| Anmeldung, Vereinskontext, freigegebene Actions, Vereinsprofil und -design | [`auth-club.md`](auth-club.md) |
| öffentliche Vereins-Homepage: Vorschau, Anwenden, Anzeigen | [`homepage.md`](homepage.md) |
| Mitglieder, Familien, Mitgliedschaftszeiten, Teams | [`mitglieder-teams.md`](mitglieder-teams.md) |
| eigene Rollen, Berechtigungsmatrix, Zuweisungen, effektive Rechte | [`rollen-rechte.md`](rollen-rechte.md) |
| Veranstaltungen, Vorlagen, Serien | [`veranstaltungen.md`](veranstaltungen.md) |
| Reservierungen, Objekte, Gebäude, Räume, Buchungsregeln | [`buchungen-objekte.md`](buchungen-objekte.md) |
| Aufgaben, Kontexte, Zuweisungen, Notizen, Checklisten | [`aufgaben.md`](aufgaben.md) |
| Speisekarten, Zutaten, Einkaufslisten | [`speisekarten.md`](speisekarten.md) |
| Sitzungsserien, Protokolle, Agenda, Abstimmungen, Beschlüsse | [`meetings.md`](meetings.md) |
| Jahresplan, Budgetposten, Buchungen | [`finanzen.md`](finanzen.md) |
| Dateien, Ordner, strukturierte Exporte | [`dateien.md`](dateien.md) |
| Rich-News, Vorschau, Veröffentlichung, Videos | [`vereinsnews.md`](vereinsnews.md) |
| Geländepläne, Zonen, Tische, Marker, Gäste | [`veranstaltungen.md`](veranstaltungen.md) |
| Serien, Ausführungen, Teilnehmer, Spielplan, Ergebnisse | [`turniere.md`](turniere.md) |
| lokale Sponsoren, Produkte, Verträge, Zuordnungen | [`sponsoring.md`](sponsoring.md) |
| Vereinsgebiet: Einteilungen, Zonen, Übersicht | [`zonen.md`](zonen.md) |
| Club-Agent: Chat, Funktionen, Freigaben | [`club-agent.md`](club-agent.md) |
| Wochenvorschau: Flyer und Vorlagen | [`wochenvorschau.md`](wochenvorschau.md) |

### Hilfe im Programm

```bash
comvenio help
comvenio help zonen
comvenio help fehler SCOPE_REQUIRED
comvenio help suche buchung
```

`comvenio help` zeigt dieselben Artikel wie diese Dokumentation — offline, ohne Anmeldung und in der
Fassung, die zum installierten Programm gehört. Ein Thema lässt sich über seinen Namen oder einen
seiner Befehle aufrufen (`comvenio help zone`). `--lang en` oder eine englische Umgebung wählen die
englische Fassung, `--json` liefert `{ id, title, lang, markdown, related }`. Jede Fehlermeldung
verweist mit `comvenio help fehler <CODE>` auf ihren Artikel.

### Schemas abfragen

```bash
comvenio action call cai.schema.01.list_domains --input '{}' --json
comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"event"}' --json
```

Die Schema-Actions beantworten die Frage „Welche Felder und Werte darf ich
senden?" für einen Bereich; die Eingabe jeder einzelnen Action nennt
`comvenio action list --json`. Undokumentierte Felder aus Vermutung zu senden
ist nicht vorgesehen — bei Unsicherheit wird zuerst das passende Schema geprüft.

### Erst lesen, dann ändern

```bash
comvenio action call cai.task.02.show --input '{"task_id":"<task-id>"}' --json
```

Bei Vollersatz-Änderungen liest der Fachservice vorhandene Daten und führt
die angegebenen Felder zusammen. Trotzdem sollte vor jeder Änderung der
aktuelle Stand mit der passenden Lese-Action geprüft werden.

### Komplexe Eingaben als JSON

Mehrteilige Strukturen werden als JSON in `--input '<json>'` übergeben. Der
jeweilige Themenartikel beschreibt das erwartete JSON; undokumentierte
Felder aus Vermutungen werden nicht verwendet.

### Vorschau vor Veröffentlichung

```bash
comvenio action call cai.homepage.01.preview \
  --input '{"tabs":[{"label":"Start","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"clear_existing":false}' \
  --json
comvenio action call cai.verify.04.homepage \
  --input '{"operation":"live","viewports":["mobile","desktop"],"audit":true,"wait_ms":500}' \
  --json
```

Vorschau und Prüfung ersetzen keine Freigabe. Veröffentlichende oder
verändernde Schritte laufen erst nach fachlicher oder visueller Prüfung.

### Prüfen mit `verify`

```bash
comvenio action call cai.verify.01.url \
  --input '{"target_url":"https://verein.web.comvenio.app","viewports":["mobile","desktop"],"audit":true,"wait_ms":500}' \
  --json
comvenio action call cai.verify.04.homepage \
  --input '{"operation":"live","viewports":["mobile","desktop"],"audit":true,"wait_ms":500}' \
  --json
```

Die `verify`-Actions prüfen eine Adresse, eine Veranstaltung, eine
Speisekarte, die Homepage, eine News oder eine Urkunde visuell und melden
Befunde statt nur einer bestandenen/nicht bestandenen Aussage. Details je
Bereich stehen im jeweiligen Themenartikel.

### Bewusst entfernte Generatoren

Inhalte werden nicht automatisch erzeugt — Comvenio komponiert Inhalt und
Design stattdessen bewusst und speichert sie deklarativ:

- Speisekarte: Karte und Einträge anlegen oder aus einer Datei anwenden,
  Design über den eigenen Stil-Befehl.
- Homepage: Vorschau per Action erzeugen, dann anwenden (siehe
  [`homepage.md`](homepage.md)); das Thema über das Vereinsdesign setzen
  (`cai.club.05.design`, siehe [`auth-club.md`](auth-club.md)).

Es gibt dabei keinen zusätzlichen Hintergrund-Aufruf, der Inhalte erfindet.

## Beispiele

Schema eines Bereichs abrufen, dann eine Aufgabe lesen:

```bash
comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"task"}' --json
comvenio action call cai.task.02.show --input '{"task_id":"<task-id>"}' --json
```

Öffentliche Adresse visuell prüfen:

```bash
comvenio action call cai.verify.01.url \
  --input '{"target_url":"https://verein.web.comvenio.app","viewports":["mobile","desktop"],"audit":true,"wait_ms":500}' \
  --json
```

## Befehle und Actions

<!-- gen:docs befehle -->

**schema**

- `cai.schema.01.list_domains` — list (lesen) · Scopes: `club.read`
- `cai.schema.02.show_domain_schema` — show (lesen) · Scopes: `club.read`

**help**

- Noch keine Action — dieser Bereich läuft über die Web-App.

**verify**

- `cai.verify.01.url` — verify (lesen) · Scopes: `club.read`, `files.export`
- `cai.verify.02.event` — verify (lesen) · Scopes: `event.read`, `files.export`
- `cai.verify.03.menu` — verify (lesen) · Scopes: `supply.read`, `files.export`
- `cai.verify.04.homepage` — live, preview (lesen) · Scopes: `club.read`, `files.export`, `club.write`
- `cai.verify.05.news` — verify (lesen) · Scopes: `content.read`, `files.export`
- `cai.verify.06.certificate` — verify (lesen) · Scopes: `member.read.details`, `files.export`

**plan**

- `cai.plan.01.list` — list (lesen) · Scopes: `event.read`
- `cai.plan.02.show` — show (lesen) · Scopes: `event.read`
- `cai.plan.03.create` — create (ändern) · Scopes: `event.write`
- `cai.plan.04.update` — update (ändern) · Scopes: `event.write`
- `cai.plan.05.delete` — delete (ändern mit Bestätigung) · Scopes: `event.write`
- `cai.plan.06.zone_list_create_update_delete_link_unlink` — list, create, update, delete, link, unlink (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.plan.07.table_create_duplicate_update_delete` — create, duplicate, update, delete (ändern, ändern mit Bestätigung) · Scopes: `event.write`
- `cai.plan.08.marker_create_update_delete` — create, update, delete (ändern, ändern mit Bestätigung) · Scopes: `event.write`
- `cai.plan.09.guest_list_add_update_delete` — list, add, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `event.read`, `event.write`
- `cai.plan.10.detail` — create (ändern) · Scopes: `event.write`
- `cai.plan.11.export` — export (ändern mit Bestätigung) · Scopes: `files.export`, `event.read`
- `cai.plan.12.illustrate` — illustrate (ändern mit Bestätigung) · Scopes: `files.export`, `event.read`
- `cai.plan.13.compose` — compose (ändern mit Bestätigung) · Scopes: `files.write`, `event.write`
<!-- /gen:docs -->

## Fehler

- `AUTH_REQUIRED` — die Anmeldung ist abgelaufen, wurde widerrufen oder
  fehlt; erneut anmelden. `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Scope für diese Action; der
  angezeigte `comvenio login --scopes …`-Befehl behebt es.
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt die Action nicht.
  `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — die angegebene Kennung gehört zu keinem sichtbaren oder
  vorhandenen Eintrag. `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — die Eingabe passt nicht zum Schema der Action.
  `comvenio help fehler VALIDATION_FAILED`.
- `OUTCOME_UNKNOWN` — eine ändernde Action (etwa `action confirm` bei
  `homepage apply` oder `plan`-Löschungen) endete mit Zeitüberschreitung
  oder Serverfehler; nicht wiederholen, erst den Stand prüfen.
  `comvenio help fehler OUTCOME_UNKNOWN`.
- `USAGE_ERROR` — ein Argument oder eine Option fehlt, passt nicht zusammen
  oder hat das falsche Format — oder den Befehl gibt es im CLI nicht mehr;
  dann mit `comvenio action list` die passende Action suchen.
  `comvenio help fehler USAGE_ERROR`.
