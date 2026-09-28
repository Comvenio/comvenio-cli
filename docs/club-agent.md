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
von Claude oder ChatGPT) und über die Web-App; App, Voice und weitere Kanäle sind Oberflächen
desselben Assistenten. Er ist keine alternative Datenquelle und kein generischer Durchgriff: Jeder
Zugriff läuft mit der Identität der angemeldeten Person, und der Dienst prüft Verein und Rechte
erneut.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie
brauchen, zeigt `comvenio action list --json`. Was der Club-Agent im Dialog oder eine Funktion
direkt ausführen darf, richtet sich zusätzlich nach der Vereinsrolle. Ist der Club-Agent für den
Verein noch nicht eingerichtet, muss das zuerst ein Administrator des Vereins in der Web-App
erledigen; der Dienst antwortet in diesem Fall ohne interne Diagnose- oder Trace-Daten. Freigaben
und Dauerfreigaben entstehen und enden ausschließlich in Web oder App, nie im Terminal —
Dauerfreigaben im Reiter „Fähigkeiten & Routinen“.

## Abläufe

### Mit dem Club-Agenten arbeiten

Der Club-Agent hat keine eigene CLI-Action. Angesprochen wird er über den verbundenen
KI-Assistenten — dort läuft derselbe Dialog wie im Web-Chat: Direkte Daten- und Aktionsanfragen
liefern strukturierte, deterministische Vereinsdaten und sind für einfache Fragen zu Events, News,
Aufgaben, Mitgliedern oder anderen einzelnen Bereichen vorzuziehen; der eigentliche Agent
übernimmt darüber hinaus Beratung, Planung, proaktive Hinweise und mehrstufige Aufgaben. Der
Assistent sieht dabei nur, was Anmeldung, Verein und Vereinsrolle freigeben. Schreibt der Agent im
Dialog etwas, legt er automatisch eine Freigabe-Anfrage an — ein getipptes „Ja“ gibt dabei nichts
frei, weder im Assistenten-Chat noch im Web-Chat.

### Freigaben und Verwaltung

Offene und entschiedene Freigaben, Dauerfreigaben, Konfiguration, Skill-Pakete, Routinen,
Watch-Rules, Journal und Memory werden ausschließlich in Web oder App bedient — Freigaben über den
im Dialog genannten Direktlink, Dauerfreigaben im Reiter „Fähigkeiten & Routinen“.

### Verfügbarkeit

Der Zugang zum Club-Agenten über einen KI-Assistenten verursacht keinen eigenen Aufpreis; die
zentralen Produkt- und Vereinsfreigaben gelten unabhängig vom Kanal. Ist der Club-Agent für einen
bestimmten Kanal nicht freigeschaltet, verbirgt das ausschließlich den Club-Agent-Dialog auf
diesem Kanal; die freigegebenen Actions der übrigen Themen bleiben davon unberührt nutzbar.

## Beispiele

Der Club-Agent selbst kennt keine `comvenio`-Befehle. Welche Actions der Assistent im Dialog
verwenden kann, zeigt die Anmeldung:

```bash
comvenio action list --json
```

Vollständige Aufrufbeispiele der einzelnen Actions stehen in den jeweiligen Themen-Artikeln (etwa
Aufgaben, Termine, Mitglieder).

## Befehle und Actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Fehler

- `CLUB_AGENT_NOT_READY` — der Club-Agent ist für den Verein noch nicht eingerichtet. Mehr:
  `comvenio help fehler CLUB_AGENT_NOT_READY`.
- `SCOPE_REQUIRED` — der Anmeldung fehlt ein für den Dialog oder eine Action nötiger Scope. Mehr:
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt den Dialog oder die Action nicht. Mehr:
  `comvenio help fehler PERMISSION_DENIED`.
