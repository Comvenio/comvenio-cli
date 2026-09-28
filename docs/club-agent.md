---
id: club-agent
kategorie: thema
domaenen: [agent]
stichwoerter: [club-agent, chat, funktionen, freigabe, freigaben, session, dauerfreigabe]
---

# Club-Agent

## Wozu

Der Club-Agent ist Comvenios vereinseigener, kanalunabhängiger Assistent für Beratung, Planung
und mehrstufige Aufgaben im Verein — etwa eine Helfereinteilung planen oder eine Aufgabe anlegen.
Er ist keine alternative Datenquelle und kein generischer Durchgriff: Jeder Zugriff läuft mit der
Identität der angemeldeten Person, und der Dienst prüft Verein und Rechte erneut.

## Voraussetzungen und Rechte

Anmeldung per `comvenio login` — die Standardanmeldung deckt alle Scopes ab, mit `--scopes`
einschränkbar. Was Chat und Funktionen tatsächlich ausführen dürfen, richtet sich zusätzlich nach
der Vereinsrolle. Ist der Club-Agent für den Verein noch nicht eingerichtet, muss das zuerst ein
Administrator des Vereins in der Web-App erledigen. Freigaben und Dauerfreigaben entstehen und
enden ausschließlich in Web oder App, nie im Terminal.

## Abläufe

### Im Dialog mit dem Club-Agenten sprechen

1. Nachricht senden: `comvenio agent chat "<Nachricht>"`.
2. Die Antwort enthält eine Session-ID.
3. Für Rückfragen und Korrekturen dieselbe Session weiterverwenden:
   `comvenio agent chat "<Nachricht>" --session <session-id>`.

### Freigaben lesen

1. Offene Freigaben auflisten: `comvenio agent approval list`.
2. Entschiedene der letzten 7 Tage: `comvenio agent approval list --state decided`.
3. Details zu einer Freigabe: `comvenio agent approval show <id>`.
4. Direktlink ausgeben lassen (entscheidet nichts): `comvenio agent approval approve <id>` bzw.
   `comvenio agent approval reject <id>`.
5. Entschieden wird ausschließlich über den ausgegebenen Link in Web oder App — ein getipptes „Ja“
   im Terminal gibt nichts frei.

### Funktionen direkt aufrufen

1. Freigegebene Funktionen ansehen: `comvenio function list`.
2. Funktion ausführen: `comvenio function run <funktion> --args '{"…":"…"}'`.
3. Stand eines Laufs prüfen: `comvenio function show <lauf-id>`.
4. Mit `--idempotency-key <schlüssel>` ist eine Wiederholung sicher: derselbe Schlüssel liefert
   denselben Lauf statt einen zweiten.
5. Braucht die Funktion eine Freigabe, gibt `run` deren Direktlink aus; entschieden wird auch hier
   nur in Web oder App.

## Beispiele

```bash
comvenio agent chat "Plane die Helfereinteilung für unser Sommerfest."
comvenio agent chat "Nimm lieber Samstag statt Freitag." --session <session-id>
comvenio agent approval list
comvenio agent approval list --state decided
comvenio agent approval show <id>
comvenio function list
comvenio function run task.create --args '{"title":"Protokoll verschicken"}'
comvenio function show <lauf-id>
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**agent** — Kern vorhanden, einzelne Abläufe fehlen

- `comvenio agent chat`
- `comvenio agent approval`
- `comvenio agent function`
<!-- /gen:docs -->

## Fehler

- `CLUB_AGENT_NOT_READY` — der Club-Agent ist für den Verein noch nicht eingerichtet. Mehr:
  `comvenio help fehler CLUB_AGENT_NOT_READY`.
- `SCOPE_REQUIRED` — der Anmeldung fehlt ein für Chat oder Funktionen nötiger Scope. Mehr:
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt die Funktion oder die Freigabe nicht. Mehr:
  `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — Session, Freigabe, Funktion oder Lauf sind unter der angegebenen Kennung nicht
  bekannt. Mehr: `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — `--args` passt nicht zum Eingabeschema der Funktion. Mehr:
  `comvenio help fehler VALIDATION_FAILED`.
