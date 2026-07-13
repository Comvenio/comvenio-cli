# comvenio CLI – eigenständige Referenz

Stand: 13. Juli 2026 · CLI-Version: `0.1.0`

Diese Referenz ist für Agents gedacht, die weder Backend-Quellcode noch interne AI-docs sehen. Sie beschreibt ausschließlich tatsächlich verdrahtete Top-Level-Commands. Die vollständige Coverage einschließlich bekannter Lücken und bewusster Ausschlüsse steht in [`coverage.md`](coverage.md); maschinenlesbar ist sie in `src/schema/coverage.json` enthalten.

## Grundregeln

```bash
comvenio <command> --help
comvenio <command> ... --json
```

- Nutze für Agenten-Aufrufe immer `--json`. Erfolgreiche JSON-Antworten landen auf stdout, Fehler auf stderr.
- Das Device-Token ist opak und beginnt mit `cvn_`. Es wird niemals dekodiert.
- Club-Kontext kommt aus dem Login-State. `--club <id>` überschreibt ihn bei Commands, die das Flag anbieten.
- Rechte werden serverseitig geprüft. `401` bedeutet in der Regel ungültiges/abgelaufenes Token, `403` fehlendes Recht, `404` unbekannte Ressource.
- Gibt es keine CLI-Action, ist ein direkter API-Aufruf kein Ersatz. Die Lücke muss im CLI geschlossen werden.
- Mutationen werden nicht automatisch wiederholt. Nur lesende GET-Aufrufe haben einen begrenzten Retry bei vorübergehenden Fehlern.

## Die 22 Top-Level-Commands

| Command | Vorhandener CLI-Scope | Detailreferenz |
|---|---|---|
| `login` | Device-Token prüfen und lokalen State speichern | [`auth-club.md`](auth-club.md) |
| `logout` | lokalen State entfernen | [`auth-club.md`](auth-club.md) |
| `whoami` | aktuelle Identität und Club-Kontext anzeigen | [`auth-club.md`](auth-club.md) |
| `club` | `info`, `design` | [`auth-club.md`](auth-club.md), [`homepage.md`](homepage.md) |
| `member` | `list`, `show`, `add`, `update`, `remove` | `comvenio member --help` |
| `team` | `list`, `member list|add|remove` | `comvenio team --help` |
| `event` | Event-Core, Vorlagen, Serien und Event-Hub-Unterressourcen | [`veranstaltungen.md`](veranstaltungen.md) |
| `booking` | `list`, `show`, `approve`, `reject` | `comvenio booking --help` |
| `object` | buchbare Objekte auflisten | `comvenio object --help` |
| `task` | Aufgaben, Zuweisung und Task-Kontexte | [`aufgaben.md`](aufgaben.md) |
| `recipe` | Rezepte vollständig verwalten | [`speisekarten.md`](speisekarten.md) |
| `template` | globale Gerichts- und Zutatenvorlagen durchsuchen | [`speisekarten.md`](speisekarten.md) |
| `menu` | Karten, Einträge, CSS, deklaratives Apply und Export | [`speisekarten.md`](speisekarten.md) |
| `meeting` | Sitzungs-/Protokollfunktionen; aktuellen Stand aus Coverage lesen | [`coverage.md`](coverage.md) |
| `homepage` | `preview`, `apply`, `show` | [`homepage.md`](homepage.md) |
| `schema` | verfügbare Domain-Schemas offline ausgeben | `comvenio schema --json` |
| `verify` | visuelle Prüfung für URL, Event, Menü, Homepage, News, Urkunde | `comvenio verify --help` |
| `data` | Dateien, Ordner, Papers und strukturierte Exporte | [`dateien.md`](dateien.md) |
| `news` | Rich-News, Vorschau, Veröffentlichung und Videos | [`vereinsnews.md`](vereinsnews.md) |
| `plan` | Geländepläne, Zonen, Tische, Marker, Gäste, Illustration | `comvenio plan --help` |
| `tournament` | Serien, Ausführungen, Teilnehmer, Draw, Spielplan und Ergebnisse | [`turniere.md`](turniere.md) |
| `sponsor` | lokale Sponsoren, Produkte, Verträge, Zuordnungen, Verantwortliche | [`sponsoring.md`](sponsoring.md) |

## Authentifizierung

```bash
comvenio login --token cvn_xxxxxxxx --json
comvenio whoami --json
comvenio club info --json
comvenio logout --json
```

Der State liegt unter `~/.comvenio-cli-state.json`. Er enthält das Token; nicht ausgeben, einchecken oder weitergeben.

## Schema und Coverage

```bash
comvenio schema --json
comvenio schema event --json
```

`schema` beantwortet die Frage „Welche Felder und Enums darf ich senden?“. `src/schema/coverage.json` beantwortet die andere Frage „Welche Workflows kann das CLI ausführen und welche noch nicht?“. Die Coverage-Registry ist bewusst unabhängig vom Backend lesbar.

## Häufige sichere Arbeitsmuster

### Erst lesen, dann ändern

```bash
comvenio event show <event-id> --json
comvenio news show <news-id> --json
comvenio task show <task-id> --json
```

Bei Vollersatz-Operationen wie News-Update liest das CLI vorhandene Daten und merged die angegebenen Felder. Trotzdem sollte ein Agent vor einer Mutation den aktuellen Stand prüfen.

### Komplexe Payloads als Datei

Mehrteilige Strukturen werden über `--file <payload.json>` übergeben. Die jeweilige Domain-Doku beschreibt das erwartete JSON. Verwende keine undokumentierten Felder aus Vermutungen.

### Vorschau vor Veröffentlichung

```bash
comvenio news preview --file news.json --json
comvenio homepage preview --file homepage.json --json
comvenio tournament preview <id> --json
comvenio verify event <event-id> --json
```

Vorschau und Verifier sind kein Freigabeersatz. Live-Mutationen erst nach fachlicher oder visueller Prüfung ausführen.

## Bewusst entfernte Generatoren

`menu generate`, `menu design`, `homepage generate` und `homepage design` sind keine nutzbaren Generatoren. Diese Actions brechen absichtlich mit einer Erklärung ab. Der bedienende Agent komponiert Inhalt und Design selbst und persistiert sie deklarativ:

- Menü: `menu create` + `menu add-item` oder `menu apply --file`, Design über `menu style`.
- Homepage: `homepage preview --file` + `homepage apply --file`, Theme über `club design`.

Das CLI ruft dafür kein Backend-LLM auf.

## Coverage richtig lesen

- `covered`: Der vorgesehene Club-Admin-Workflow ist verfügbar; technische Public-/Internal-Routen müssen nicht gespiegelt werden.
- `core-partial`: Nutzbarer Kern vorhanden, aber mindestens ein wichtiger Admin-Workflow fehlt.
- `intentional-exclusion`: bewusst kein operativer CLI-Workflow.

Die Registry zählt keine Backend-Routen. Sie bewertet Bedien-Workflows, nennt vorhandene Actions, belegte CLI-Lücken, Ausschlussgründe sowie Prüfdatum und Quellpfade.
