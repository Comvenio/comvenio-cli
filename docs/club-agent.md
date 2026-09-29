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
Erreichbar ist er über einen mit dem Comvenio-Connector verbundenen KI-Assistenten (etwa im Chat
von Claude oder ChatGPT), aus dem Terminal mit `comvenio agent chat` und über die Web-App; App,
Voice und weitere Kanäle sind Oberflächen desselben Assistenten. Er ist keine alternative Datenquelle und kein generischer Durchgriff: Jeder
Zugriff läuft mit der Identität der angemeldeten Person, und der Dienst prüft Verein und Rechte
erneut.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; `comvenio agent chat` braucht den Scope `club.read`, den jede
Anmeldung ohne `--scopes` enthält. Welche Actions dein Verein freigibt und welche Scopes sie
brauchen, zeigt `comvenio action list --json`. Was der Club-Agent im Dialog ausführen darf,
richtet sich zusätzlich nach der Vereinsrolle. Ist der Club-Agent für den
Verein noch nicht eingerichtet, muss das zuerst ein Administrator des Vereins in der Web-App
erledigen; der Dienst antwortet in diesem Fall ohne interne Diagnose- oder Trace-Daten. Freigaben
und Dauerfreigaben entstehen und enden ausschließlich in Web oder App, nie im Terminal —
Dauerfreigaben im Reiter „Fähigkeiten & Routinen“.

## Abläufe

### Mit dem Club-Agenten arbeiten

Aus dem Terminal sprichst du mit `comvenio agent chat "<nachricht>"` mit dem Club-Agenten; der
Verein kommt aus deiner Anmeldung. Ohne `--session` beginnt eine neue Unterhaltung, mit
`--session <id>` setzt du die vorige fort — die Session steht in jeder Antwort. Nennt `--session`
keine deiner Unterhaltungen, beginnt der Club-Agent eine neue und der Befehl sagt es dir. Die
Antwort nennt zu jeder Freigabe, die der Zug angelegt oder berührt hat, eine Zeile mit dem
Freigabe-Link und zu jedem Lauf eine Zeile mit seinem Stand; mit `--json` kommt dasselbe als
Objekt mit `session_id`, `response`, `run_refs` und `approval_refs`. Ein lokaler KI-Agent liest die
Freigabe-Links aus `approval_refs` und gibt sie an dich weiter — er gibt nie selbst frei.

Über einen verbundenen KI-Assistenten läuft derselbe Dialog wie im Web-Chat: Direkte Daten- und Aktionsanfragen
liefern strukturierte, deterministische Vereinsdaten und sind für einfache Fragen zu Events, News,
Aufgaben, Mitgliedern oder anderen einzelnen Bereichen vorzuziehen; der eigentliche Agent
übernimmt darüber hinaus Beratung, Planung, proaktive Hinweise und mehrstufige Aufgaben. Der
Assistent sieht dabei nur, was Anmeldung, Verein und Vereinsrolle freigeben. Schreibt der Agent im
Dialog etwas, legt er automatisch eine Freigabe-Anfrage an — ein getipptes „Ja“ gibt dabei nichts
frei, weder im Assistenten-Chat noch im Terminal noch im Web-Chat.

### Freigaben und Verwaltung

Offene und entschiedene Freigaben, Dauerfreigaben, Funktionen, Automationen, Konfiguration,
Skill-Pakete, Routinen, Watch-Rules, Journal und Memory werden ausschließlich in Web oder App
bedient — Freigaben über den im Dialog genannten Direktlink oder unter „Mein Agent“, Spur „Braucht
dich“; Funktionen und Dauerfreigaben im Admin-Reiter „Fähigkeiten & Routinen“; Automationen unter
„Automatisierungen“. Die früheren Befehle `comvenio agent approval`, `comvenio function` und
`comvenio automation` gibt es im CLI nicht mehr; ein Aufruf endet mit `USAGE_ERROR` und nennt den
Ort in der Web-App.

### Verfügbarkeit

Der Zugang zum Club-Agenten über einen KI-Assistenten verursacht keinen eigenen Aufpreis; die
zentralen Produkt- und Vereinsfreigaben gelten unabhängig vom Kanal. Ist der Club-Agent für einen
bestimmten Kanal nicht freigeschaltet, verbirgt das ausschließlich den Club-Agent-Dialog auf
diesem Kanal; die freigegebenen Actions der übrigen Themen bleiben davon unberührt nutzbar.

## Beispiele

Eine neue Unterhaltung beginnen und sie fortsetzen:

```bash
comvenio agent chat "Was steht diese Woche im Verein an?"
comvenio agent chat "Und am Wochenende?" --session <session-id>
```

Maschinenlesbar für lokale KI-Agenten — Freigabe-Links stehen in `approval_refs`:

```bash
comvenio agent chat "Lege die Wochenvorschau für die Fußballabteilung an." --json
```

```json
{
  "session_id": "<session-id>",
  "response": "Die Wochenvorschau ist angelegt und wartet auf deine Freigabe.",
  "run_refs": [{ "run_id": "<lauf-id>", "kind": "command_run", "state": "awaiting_approval" }],
  "approval_refs": [{ "approval_id": "<freigabe-id>", "state": "open", "approval_url": "<freigabe-link>" }]
}
```

Welche Actions der Assistent im Dialog verwenden kann, zeigt die Anmeldung:

```bash
comvenio action list --json
```

Vollständige Aufrufbeispiele der einzelnen Actions stehen in den jeweiligen Themen-Artikeln (etwa
Aufgaben, Termine, Mitglieder).

## Befehle und Actions

<!-- gen:docs befehle -->

**agent**

- Noch keine Action — dieser Bereich läuft über die Web-App.
<!-- /gen:docs -->

## Fehler

- `AUTH_REQUIRED` — keine gültige Anmeldung; `comvenio login` ausführen. Mehr:
  `comvenio help fehler AUTH_REQUIRED`.
- `CLUB_AGENT_NOT_READY` — der Club-Agent ist für den Verein noch nicht eingerichtet. Mehr:
  `comvenio help fehler CLUB_AGENT_NOT_READY`.
- `SCOPE_REQUIRED` — der Anmeldung fehlt ein für den Dialog oder eine Action nötiger Scope. Mehr:
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt den Dialog oder die Action nicht. Mehr:
  `comvenio help fehler PERMISSION_DENIED`.
- `UPSTREAM_TIMEOUT` — der Club-Agent hat nicht rechtzeitig geantwortet; die Nachricht kann
  trotzdem angekommen sein. Mehr: `comvenio help fehler UPSTREAM_TIMEOUT`.
- `USAGE_ERROR` — etwa ein Aufruf von `comvenio function`, `comvenio automation` oder
  `comvenio agent approval`; die Meldung nennt den Ort in der Web-App. Mehr:
  `comvenio help fehler USAGE_ERROR`.
