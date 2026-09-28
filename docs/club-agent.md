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
CLI, MCP/ChatGPT, Claude, App, Web, Voice und weitere Kanäle sind dabei nur Oberflächen desselben
Assistenten. Er ist keine alternative Datenquelle und kein generischer Durchgriff: Jeder Zugriff
läuft mit der Identität der angemeldeten Person, und der Dienst prüft Verein und Rechte erneut.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

Anmeldung per `comvenio login` — die Standardanmeldung deckt alle Scopes ab, mit `--scopes`
einschränkbar. Was Chat und Funktionen tatsächlich ausführen dürfen, richtet sich zusätzlich nach
der Vereinsrolle. Ist der Club-Agent für den Verein noch nicht eingerichtet, muss das zuerst ein
Administrator des Vereins in der Web-App erledigen; der Dienst antwortet in diesem Fall ohne
interne Diagnose- oder Trace-Daten. Freigaben und Dauerfreigaben entstehen und enden
ausschließlich in Web oder App, nie im Terminal — Dauerfreigaben im Reiter
„Fähigkeiten & Routinen“.

## Abläufe

### Die drei Ausführungsebenen

Der Club-Agent kombiniert drei Ebenen: Direkte Daten- und Aktionsbefehle liefern strukturierte,
deterministische Vereinsdaten und sind für einfache Fragen zu Events, News, Aufgaben, Mitgliedern
oder anderen einzelnen Bereichen vorzuziehen. Domain-Skills bündeln bekannte Vereinsabläufe und
erzwingen deren fachliche Vorbedingungen, Risiko- und Freigaberegeln. Der eigentliche Agent
übernimmt Beratung, Planung, proaktive Hinweise und mehrstufige Aufgaben; eine hinterlegte
Werkzeug- und Fähigkeitsübersicht bestimmt dabei, welche Skills tatsächlich ausführbar sind.

### Im Dialog mit dem Club-Agenten sprechen

1. Nachricht senden: `comvenio agent chat "<Nachricht>"`.
2. Die Antwort enthält eine Session-ID.
3. Für Rückfragen und Korrekturen dieselbe Session weiterverwenden:
   `comvenio agent chat "<Nachricht>" --session <session-id>`.

Das CLI sendet dabei ausschließlich die Nachricht, den gebundenen Verein, einen festen
Gesprächskontext und optional die Session-ID; eine Benutzer-ID, Rollen, Berechtigungen oder
Zielpersonen lassen sich nicht mitgeben. Schreibt der Agent im Dialog etwas, legt er automatisch
eine Freigabe-Anfrage an — die Antwort nennt sofort deren Direktlink, im JSON-Modus im Feld
`approval_refs`; ein getipptes „Ja“ gibt dabei nichts frei, weder im Terminal noch im Web-Chat.

### Freigaben lesen

1. Offene Freigaben auflisten: `comvenio agent approval list`.
2. Entschiedene der letzten 7 Tage: `comvenio agent approval list --state decided`.
3. Details zu einer Freigabe: `comvenio agent approval show <id>`.
4. Direktlink ausgeben lassen (entscheidet nichts): `comvenio agent approval approve <id>` bzw.
   `comvenio agent approval reject <id>`.
5. Entschieden wird ausschließlich über den ausgegebenen Link in Web oder App — ein getipptes „Ja“
   gibt nichts frei, weder im Terminal noch im Web-Chat. Eine Entscheidung über die
   Geräte-Token-Anmeldung des CLI lehnt der Dienst ab.

### Funktionen direkt aufrufen

Jede freigegebene Funktion lässt sich auch ohne Chat aufrufen — mit derselben Prüfung wie der
Knopf im Web und der Agent selbst (Eingabeschema, Recht, Freigabe). Welche Funktionen es gibt und
welche Angaben sie brauchen, liefert der Dienst zur Laufzeit; eine neue Funktion braucht dafür kein
neues CLI.

1. Freigegebene Funktionen ansehen: `comvenio function list`.
2. Funktion ausführen: `comvenio function run <funktion> --args '{"…":"…"}'`.
3. Stand eines Laufs prüfen: `comvenio function show <lauf-id>`.
4. Mit `--idempotency-key <schlüssel>` ist eine Wiederholung sicher: derselbe Schlüssel liefert
   denselben Lauf statt einen zweiten.
5. Braucht die Funktion eine Freigabe, gibt `run` deren Direktlink aus; entschieden wird auch hier
   nur in Web oder App.

### Verfügbarkeit

Der CLI- und Funktionszugang zum Club-Agenten verursacht keinen eigenen Aufpreis; die zentralen
Produkt- und Vereinsfreigaben gelten unabhängig vom Kanal — CLI oder ein anderer Zugang umgehen
sie nicht. Ist der Club-Agent für einen bestimmten Kanal nicht freigeschaltet, verbirgt das
ausschließlich den Club-Agent-Dialog auf diesem Kanal; direkte Vereins-Actions bleiben davon
unberührt nutzbar.

### Was die CLI noch nicht verwaltet

`agent chat` deckt die dialogische Nutzung ab, `agent approval` das Lesen von Freigaben. Die
administrativen Club-Agent-Workflows — Konfiguration, Skill-Pakete, Routinen, Watch-Rules, Journal
und Memory — sind noch nicht als eigene, abgesicherte CLI-Actions umgesetzt.

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

**agent** — Kern vorhanden, einzelne Abläufe fehlen

- `comvenio agent chat`
- `comvenio agent approval`
- `comvenio function`
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
