---
id: fehlerbilder
kategorie: uebersicht
domaenen: []
stichwoerter: [fehler, fehlerbilder, fehlercodes, ursache]
---

# comvenio CLI — Fehlerbild → Ursache → richtiger Weg

> Dieselben Stolpersteine kosten sonst wiederholt Zeit. Hier stehen sie nach
> dem Meldungstext, den man tatsächlich sieht.

## Grundsatz: nur noch die Browser-Anmeldung

Der Weg ist `comvenio login` (Browser, OAuth) und danach
`comvenio action list|call|confirm`. Ältere, klassische Befehle laufen unter
dieser Anmeldung **nicht** — das ist Absicht, kein Fehler: Ein
Entwicklungs-Token ist der alte Weg, die Browser-Anmeldung der einzige
vorgesehene. Fehlt eine Funktion als Action, wird sie über das
Issue-Formular gemeldet.

**Die Standard-Anmeldung fordert alle Scopes an.** Was tatsächlich erlaubt
ist, entscheiden weiterhin die Rollen im Verein. Wer den Zugriff bewusst
begrenzen will, schränkt ihn ein, zum Beispiel auf reines Lesen:

```bash
comvenio login --scopes club.read,role.read.self
```

Meldet eine Action `Fehler SCOPE_REQUIRED`, stammt die Anmeldung meist noch
aus der Zeit vor dieser Voreinstellung oder wurde bewusst eingeschränkt: den
angezeigten `comvenio login`-Befehl ausführen.

Welche Scopes eine Action braucht, zeigt `comvenio action list --json`
(Sicherheitsangaben je Aktion). Die aktuell erteilten Scopes der Verbindung
zeigt `~/.comvenio-cli-state.json` (nicht geheim).

## Aufbau einer Fehlermeldung

Jede Meldung beginnt mit einem stabilen Code, nennt die Ursache in einem Satz
und den nächsten Befehl:

```text
Fehler SCOPE_REQUIRED: Deiner Anmeldung fehlt eine Berechtigung für diese Aktion. …
→ comvenio login --scopes admin.write,club.read,club.write
Mehr: comvenio help fehler SCOPE_REQUIRED
Anfrage-ID: …
```

`--json` liefert dasselbe als Objekt mit Code, Meldung, Ursache, nächstem
Befehl, Hilfeverweis, Anfrage-ID und Sprache. Die Sprache wählt `--lang de|en`,
sonst die Spracheinstellung des Systems, sonst Deutsch. Alle Codes mit ihren
Texten stehen in [fehler/katalog.json](fehler/katalog.json); zu jedem Code
gehört außerdem ein eigener Artikel unter `fehler/` mit Bedeutung, typischen
Ursachen und Lösung.

## Fehlerbilder

| Meldung (Auszug) | Ursache | Richtig |
|---|---|---|
| `Fehler OAUTH_ONLY` (früher: „Dieser klassische Befehl läuft nicht über die OAuth-Anmeldung") | Klassischer Befehl unter der Browser-Anmeldung. | `comvenio action list` → passende Action mit `comvenio action call <id> --input '{…}'`. Gibt es keine: als Wunsch über das Issue-Formular melden. |
| `Fehler SCOPE_REQUIRED` (früher: „… in deinem aktuellen Vereins- und Rechtekontext nicht verfügbar.") | Der Anmeldung fehlt der genannte Scope — etwa ein Schreib-Scope für eine bestätigungspflichtige Action. | Den angezeigten Befehl `comvenio login --scopes …` ausführen; er enthält die bisherigen und die fehlenden Scopes. |
| `Fehler PERMISSION_DENIED` | Die Scopes stimmen, aber die Rolle im Verein erlaubt die Aktion nicht. | Das Recht vergibt ein Administrator des Vereins. |
| `Fehler ACTION_NOT_LISTED` | Die Action steht nicht in der Tool-Liste dieser Verbindung. **Direkt nach einer neuen Version** auch vorübergehend. | `comvenio action list` prüfen; nach einer neuen Version eine Minute warten und wiederholen. |
| „Der Fachservice hat keine freigegebene Antwortform geliefert." | Die Antwort passt nicht zum veröffentlichten Vertrag der Action — ein Fehler auf Comvenio-Seite, nicht bei dir. | Nicht umgehen; als Fehlerbericht melden (Issue-Formular) mit Action-Kennung und Uhrzeit. |
| `Fehler AUTH_REQUIRED` mit dem Zusatz, die Verbindung trage nicht mehr | Die Anmeldung ist abgelaufen oder wurde widerrufen. | `comvenio login` (mit denselben `--scopes`). |
| Beim Anmelden wird nach einem Entwicklungs-Token gefragt / der Wert fehlt | Alter Weg. | Nicht verwenden; `comvenio login` ohne Token ausführen. |
| `Fehler OUTCOME_UNKNOWN` | Eine schreibende Action (etwa `action confirm`) endete mit Zeitüberschreitung oder Serverfehler — womöglich nachdem Comvenio sie schon ausgeführt hatte. | **Nicht wiederholen**, sonst entsteht der Eintrag womöglich doppelt. Erst den Stand mit der passenden Lese-Action prüfen. |
| `Fehler UNKNOWN_ERROR` | Ein Fall ohne Beschreibung. | Als Fehlerbericht melden (Issue-Formular) mit Anfrage-ID und Uhrzeit. |
