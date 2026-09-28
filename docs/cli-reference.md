---
id: cli-reference
kategorie: thema
domaenen: [schema, verify, plan]
stichwoerter: [cli, referenz, befehle, schema, verify]
---

# comvenio CLI — Übersicht

## Wozu

Dieser Artikel ist der Einstieg in das comvenio CLI: die Grundregeln jedes
Aufrufs, die Top-Level-Befehle im Überblick mit Verweis auf ihren eigenen
Artikel, sowie die Themenbefehle `schema` und `verify`, die kein eigenes
Thema, sondern jeden anderen Befehl begleiten.

## Voraussetzungen und Rechte

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
- Standard ist die Browser-Anmeldung mit sicherer Speicherung im jeweiligen
  Betriebssystem; ein opakes Token ist nur ein expliziter
  Entwicklungs-/Automationsfallback und wird nie inhaltlich ausgewertet.
- Rechte werden serverseitig geprüft: `401` bedeutet in der Regel eine
  ungültige oder abgelaufene Anmeldung, `403` ein fehlendes Recht, `404` eine
  unbekannte Ressource.
- Gibt es für eine Aufgabe keinen passenden Befehl, ist das eine Lücke im
  CLI — sie wird dort geschlossen, nicht umgangen.
- Änderungen werden nicht automatisch wiederholt; nur lesende Abfragen haben
  einen begrenzten Wiederholungsversuch bei vorübergehenden Fehlern.

### Themen und ihre Befehle

Jeder Top-Level-Befehl gehört zu einem Thema mit eigenem Artikel:

| Befehl | Bereich | Artikel |
|---|---|---|
| `login`, `logout`, `whoami`, `action`, `club` | Anmeldung, Vereinskontext, freigegebene Actions, Vereinsprofil und -design | [`auth-club.md`](auth-club.md) |
| `homepage` | öffentliche Vereins-Homepage: Vorschau, Anwenden, Anzeigen | [`homepage.md`](homepage.md) |
| `member`, `team` | Mitglieder, Familien, Mitgliedschaftszeiten, Teams | [`mitglieder-teams.md`](mitglieder-teams.md) |
| `role` | eigene Rollen, Berechtigungsmatrix, Zuweisungen, effektive Rechte | [`rollen-rechte.md`](rollen-rechte.md) |
| `event` | Veranstaltungen, Vorlagen, Serien | [`veranstaltungen.md`](veranstaltungen.md) |
| `booking`, `object` | Reservierungen, Objekte, Gebäude, Räume, Buchungsregeln | [`buchungen-objekte.md`](buchungen-objekte.md) |
| `task` | Aufgaben, Kontexte, Zuweisungen, Notizen, Checklisten | [`aufgaben.md`](aufgaben.md) |
| `recipe`, `ingredient`, `ingredient-category`, `shopping`, `template`, `menu` | Speisekarten, Zutaten, Einkaufslisten | [`speisekarten.md`](speisekarten.md) |
| `meeting` | Sitzungsserien, Protokolle, Agenda, Abstimmungen, Beschlüsse | [`meetings.md`](meetings.md) |
| `finance` | Jahresplan, Budgetposten, Buchungen | [`finanzen.md`](finanzen.md) |
| `data` | Dateien, Ordner, strukturierte Exporte | [`dateien.md`](dateien.md) |
| `news` | Rich-News, Vorschau, Veröffentlichung, Videos | [`vereinsnews.md`](vereinsnews.md) |
| `plan` | Geländepläne, Zonen, Tische, Marker, Gäste | [`veranstaltungen.md`](veranstaltungen.md) |
| `tournament` | Serien, Ausführungen, Teilnehmer, Spielplan, Ergebnisse | [`turniere.md`](turniere.md) |
| `sponsor` | lokale Sponsoren, Produkte, Verträge, Zuordnungen | [`sponsoring.md`](sponsoring.md) |
| `zone`, `task-zones` | Vereinsgebiet: Einteilungen, Zonen, Übersicht | [`zonen.md`](zonen.md) |
| `agent` | Club-Agent: Chat, Funktionen, Freigaben | [`club-agent.md`](club-agent.md) |
| `weekly-preview` | Wochenvorschau: Flyer und Vorlagen | [`wochenvorschau.md`](wochenvorschau.md) |

### Schemas abfragen

```bash
comvenio schema --json
comvenio schema event --json
```

`schema` beantwortet die Frage „Welche Felder und Werte darf ich senden?" für
einen Bereich. Undokumentierte Felder aus Vermutung zu senden ist nicht
vorgesehen — bei Unsicherheit wird zuerst das passende Schema geprüft.

### Erst lesen, dann ändern

```bash
comvenio event show <event-id> --json
comvenio news show <news-id> --json
comvenio task show <task-id> --json
```

Bei Vollersatz-Änderungen liest das CLI vorhandene Daten und führt die
angegebenen Felder zusammen. Trotzdem sollte vor jeder Änderung der
aktuelle Stand geprüft werden.

### Komplexe Eingaben als Datei

Mehrteilige Strukturen werden über eine Datei übergeben. Der jeweilige
Themenartikel beschreibt das erwartete JSON; undokumentierte Felder aus
Vermutungen werden nicht verwendet.

### Vorschau vor Veröffentlichung

```bash
comvenio news preview --file news.json --json
comvenio homepage preview --file homepage.json --ttl-hours 24 --json
comvenio tournament preview <id> --json
comvenio verify event <event-id> --json
```

Vorschau und Prüfung ersetzen keine Freigabe. Veröffentlichende oder
verändernde Schritte laufen erst nach fachlicher oder visueller Prüfung.

### Prüfen mit `verify`

```bash
comvenio verify --help
comvenio verify url <adresse> --json
comvenio verify homepage --audit --json
```

`verify` prüft eine Adresse, eine Veranstaltung, eine Speisekarte, die
Homepage, eine News oder eine Urkunde visuell und meldet Befunde mit einem
klaren Exit-Code statt nur einer bestandenen/nicht bestandenen Aussage.
Details je Bereich stehen im jeweiligen Themenartikel.

### Bewusst entfernte Generatoren

`menu generate`, `menu design`, `homepage generate` und `homepage design`
erzeugen keinen Inhalt automatisch — diese Aufrufe brechen absichtlich mit
einer Erklärung ab. Inhalt und Design werden stattdessen bewusst komponiert
und deklarativ gespeichert:

- Speisekarte: Karte und Einträge anlegen oder aus einer Datei anwenden,
  Design über den eigenen Stil-Befehl.
- Homepage: Vorschau aus einer Datei erzeugen, dann anwenden; das Thema über
  das Vereinsdesign setzen.

Es gibt dabei keinen zusätzlichen Hintergrund-Aufruf, der Inhalte erfindet.

## Beispiele

Schema eines Bereichs abrufen und Struktur erst lesen, dann prüfen:

```bash
comvenio schema event --json
comvenio event show <event-id> --json
comvenio verify event <event-id> --json
```

Öffentliche Adresse visuell prüfen:

```bash
comvenio verify url https://verein.web.comvenio.app --json
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**schema** — Kern vorhanden, einzelne Abläufe fehlen

- `comvenio schema list domains`
- `comvenio schema show domain schema`

**verify** — vollständig

- `comvenio verify url`
- `comvenio verify event`
- `comvenio verify menu`
- `comvenio verify homepage`
- `comvenio verify news`
- `comvenio verify certificate`

**plan** — vollständig

- `comvenio plan list`
- `comvenio plan show`
- `comvenio plan create`
- `comvenio plan update`
- `comvenio plan delete`
- `comvenio plan zone list|create|update|delete|link|unlink`
- `comvenio plan table create|duplicate|update|delete`
- `comvenio plan marker create|update|delete`
- `comvenio plan guest list|add|update|delete`
- `comvenio plan detail`
- `comvenio plan export`
- `comvenio plan illustrate`
- `comvenio plan compose`
<!-- /gen:docs -->

## Fehler

- `AUTH_REQUIRED` — die Anmeldung ist abgelaufen, wurde widerrufen oder
  fehlt; erneut anmelden. `comvenio help fehler AUTH_REQUIRED`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt den Befehl nicht.
  `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — die angegebene Kennung gehört zu keinem sichtbaren oder
  vorhandenen Eintrag. `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — eine Eingabedatei passt nicht zum Schema des
  Bereichs. `comvenio help fehler VALIDATION_FAILED`.
- `USAGE_ERROR` — ein Argument oder eine Option fehlt, passt nicht zusammen
  oder hat das falsche Format. `comvenio help fehler USAGE_ERROR`.
