# comvenio CLI – eigenständige Referenz

Stand: 20. Juli 2026 · CLI-Version: `0.1.0`

Diese Referenz ist für Agents gedacht, die weder Backend-Quellcode noch interne AI-docs sehen. Sie beschreibt ausschließlich tatsächlich verdrahtete Top-Level-Commands. Die vollständige Coverage einschließlich bekannter Lücken und bewusster Ausschlüsse steht in [`coverage.md`](coverage.md); maschinenlesbar ist sie in `src/schema/coverage.json` enthalten.

## Grundregeln

```bash
comvenio <command> --help
comvenio <command> ... --json
```

- Nutze für Agenten-Aufrufe immer `--json`. Erfolgreiche JSON-Antworten landen auf stdout, Fehler auf stderr.
- Standard ist OAuth 2.1 mit PKCE und sicherem Betriebssystem-Credential-Speicher.
- Das opake `cvn_`-Device-Token ist nur ein expliziter Entwicklungs-/Automationsfallback und wird niemals dekodiert.
- Im OAuth-Modus kommen Club, Benutzer und effektive Rechte ausschließlich aus
  Grant und Backend-RBAC. `--club` ist dort nicht zulässig.
- Rechte werden serverseitig geprüft. `401` bedeutet in der Regel ungültiges/abgelaufenes Token, `403` fehlendes Recht, `404` unbekannte Ressource.
- Gibt es keine CLI-Action, ist ein direkter API-Aufruf kein Ersatz. Die Lücke muss im CLI geschlossen werden.
- Mutationen werden nicht automatisch wiederholt. Nur lesende GET-Aufrufe haben einen begrenzten Retry bei vorübergehenden Fehlern.

## Die 26 Top-Level-Commands

| Command | Vorhandener CLI-Scope | Detailreferenz |
|---|---|---|
| `login` | OAuth-Grant herstellen; optional Device-Token-Fallback | [`auth-club.md`](auth-club.md) |
| `logout` | OAuth-Grant widerrufen und lokale Anmeldung entfernen | [`auth-club.md`](auth-club.md) |
| `whoami` | aktuelle Identität und Club-Kontext anzeigen | [`auth-club.md`](auth-club.md) |
| `action` | freigegebene kanonische Connector-Actions auflisten, ausführen und bestätigen | [`auth-club.md`](auth-club.md) |
| `club` | Profil, Settings, Abteilungen und `design` | [`auth-club.md`](auth-club.md), [`homepage.md`](homepage.md) |
| `member` | Mitglieder, Familien, Status, Mitgliedschaftszeiten und Import | [`mitglieder-teams.md`](mitglieder-teams.md) |
| `team` | Team-CRUD, Mitglieder und Ressourcen-Prioritäten | [`mitglieder-teams.md`](mitglieder-teams.md) |
| `role` | Custom Roles, Berechtigungsmatrix, Zuweisungen und effektive Rechte | [`rollen-rechte.md`](rollen-rechte.md) |
| `event` | Event-Core, Vorlagen, Serien und Event-Hub-Unterressourcen | [`veranstaltungen.md`](veranstaltungen.md) |
| `booking` | Reservierungen lesen und verwalten | [`buchungen-objekte.md`](buchungen-objekte.md) |
| `object` | Objekt-, Gebäude-, Raum-, Buchungsregel- und Task-Regel-CRUD | [`buchungen-objekte.md`](buchungen-objekte.md) |
| `task` | Aufgaben, Contexts, Zuweisungen, Notizen und Checklisten | [`aufgaben.md`](aufgaben.md) |
| `recipe` | Rezepte vollständig verwalten | [`speisekarten.md`](speisekarten.md) |
| `ingredient` | Club-Zutaten lesen und verwalten | [`speisekarten.md`](speisekarten.md) |
| `ingredient-category` | Kategorienbaum und Zutaten-Zuordnungen | [`speisekarten.md`](speisekarten.md) |
| `shopping` | Einkaufslisten, Positionen und Generierung aus Rezept/Karte | [`speisekarten.md`](speisekarten.md) |
| `template` | globale Gerichts- und Zutatenvorlagen durchsuchen | [`speisekarten.md`](speisekarten.md) |
| `menu` | Karten, Einträge, CSS, deklaratives Apply und Export | [`speisekarten.md`](speisekarten.md) |
| `meeting` | Sitzungsserien, Protokolle, Agenda, Teilnehmer, Abstimmungen, Beschlüsse und Einträge | [`meetings.md`](meetings.md) |
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
comvenio login --json
comvenio whoami --json
comvenio action list --json
comvenio logout --json
```

Der State liegt unter `~/.comvenio-cli-state.json`. OAuth-Secrets liegen
ausschließlich im geschützten Betriebssystemspeicher. Weil der explizite
Device-Token-Fallback weiterhin möglich ist, darf das State-File dennoch nie
ausgegeben, eingecheckt oder weitergegeben werden.

Die vollständige OAuth-Ausführungsfläche ist `comvenio action`. Bestehende
menschenfreundliche Domänenbefehle verwenden während der Migration weiterhin
den expliziten Device-Token-Kompatibilitätsmodus; sie dürfen keinen
Connector-Token direkt an einen Domain-Service senden.

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
comvenio homepage preview --file homepage.json --ttl-hours 24 --json
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
