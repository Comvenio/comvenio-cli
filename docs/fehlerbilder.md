# comvenio CLI — Fehlerbild → Ursache → richtiger Weg

Stand: 28. September 2026

> **Wozu:** Dieselben Stolpersteine kosteten wiederholt Stunden. Hier stehen sie nach dem **Meldungstext**,
> den man sieht. Neue Fälle als Zeile ergänzen, belegt an Code oder Meldung.

## Grundsatz: nur noch OAuth

Der Weg ist `comvenio login` (Browser, OAuth) und danach `comvenio action list|call|confirm`.
Klassische Befehle (`comvenio teams …`, `comvenio club info` …) laufen unter OAuth **nicht** — das ist Absicht, kein Fehler: Der Geräte-Token ist der alte Weg,
OAuth der einzige vorgesehene. Fehlt eine Funktion als Action, bitte über das Issue-Formular melden.

**Die Standard-Anmeldung fordert alle Scopes an** (`DEFAULT_SCOPES`, `src/oauth/client.ts`).
Was du tatsächlich darfst, entscheiden weiter deine Rollen im Verein. Wer den Zugriff
bewusst begrenzen will, schränkt ihn ein, z. B. nur lesen:

```bash
comvenio login --scopes club.read,role.read.self
```

Meldet eine Action `Fehler SCOPE_REQUIRED`, stammt die Anmeldung meist noch aus der Zeit vor
dieser Voreinstellung oder wurde bewusst eingeschränkt: den angezeigten `comvenio login`-Befehl ausführen.

Welche Scopes eine Action braucht, zeigt `comvenio action list --json` (Sicherheitsangaben je Tool). Die aktuelle Verbindung zeigt
`~/.comvenio-cli-state.json` → `connector.scopes` (nicht geheim).

## Aufbau einer Fehlermeldung

Jede Meldung beginnt mit einem stabilen Code, nennt die Ursache in einem Satz und den nächsten Befehl:

```text
Fehler SCOPE_REQUIRED: Deiner Anmeldung fehlt eine Berechtigung für diese Aktion. …
→ comvenio login --scopes admin.write,club.read,club.write
Mehr: comvenio help fehler SCOPE_REQUIRED
Anfrage-ID: …
```

`--json` liefert dasselbe als Objekt `{ code, message, cause, next_command, help, request_id, lang }`.
Die Sprache wählt `--lang de|en`, sonst `LANG`/`LC_ALL`, sonst Deutsch. Alle Codes mit ihren Texten
stehen in [fehler/katalog.json](fehler/katalog.json).

## Fehlerbilder

| Meldung (Auszug) | Ursache | Richtig |
|---|---|---|
| `Fehler OAUTH_ONLY` (früher: `Dieser klassische Befehl läuft nicht über die OAuth-Anmeldung`) | Klassischer Befehl unter OAuth. | `comvenio action list` → passende `cai.*`-Action mit `comvenio action call <id> --input '{…}'`. Gibt es keine: als Wunsch über das Issue-Formular melden. |
| `Fehler SCOPE_REQUIRED` (früher: `… in deinem aktuellen Vereins- und Rechtekontext nicht verfügbar.`) | Der Anmeldung fehlt der genannte Scope — etwa ein Schreib-Scope für eine bestätigungspflichtige Action. | Den angezeigten Befehl `comvenio login --scopes …` ausführen; er enthält die bisherigen und die fehlenden Scopes. |
| `Fehler PERMISSION_DENIED` | Die Scopes stimmen, aber deine Rolle im Verein erlaubt die Aktion nicht. | Das Recht vergibt ein Administrator deines Vereins. |
| `Fehler ACTION_NOT_LISTED` | Die Action steht nicht in der Tool-Liste dieser Verbindung. **Direkt nach einer neuen Version** auch vorübergehend. | `comvenio action list` prüfen; nach einer neuen Version eine Minute warten und wiederholen. |
| `Der Fachservice hat keine freigegebene Antwortform geliefert.` | Die Antwort passt nicht zum veröffentlichten Vertrag der Action — ein Fehler auf Comvenio-Seite, nicht bei dir. | Nicht umgehen; als Fehlerbericht melden (Issue-Formular im Repository) mit Action-ID und Uhrzeit. |
| `Fehler AUTH_REQUIRED` mit Zusatz `Die Verbindung trägt nicht mehr (abgelaufen oder widerrufen)` | OAuth-Grant abgelaufen. | `comvenio login` (mit denselben `--scopes`). |
| Beim Login nach `--device-token` gefragt / Wert fehlt | Alter Weg. | Nicht verwenden; `comvenio login` ohne Token. |
| `Fehler OUTCOME_UNKNOWN` | Eine schreibende Action (etwa `action confirm`) endete mit Zeitüberschreitung (Grenze 15 Sekunden) oder Serverfehler — womöglich nachdem Comvenio sie schon ausgeführt hatte. | **Nicht wiederholen**, sonst entsteht der Eintrag womöglich doppelt. Erst den Stand mit der passenden Lese-Action prüfen. |
| `Fehler UNKNOWN_ERROR` | Ein Fall ohne Beschreibung. | Als Fehlerbericht melden (Issue-Formular) mit Anfrage-ID und Uhrzeit. |
