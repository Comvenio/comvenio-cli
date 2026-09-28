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

Meldet eine Action trotzdem „nicht verfügbar“, stammt die Anmeldung meist noch aus der Zeit vor
dieser Voreinstellung: einmal `comvenio login` ohne `--scopes` ausführen.

Welche Scopes eine Action braucht, zeigt `comvenio action list --json` (Sicherheitsangaben je Tool). Die aktuelle Verbindung zeigt
`~/.comvenio-cli-state.json` → `connector.scopes` (nicht geheim).

## Fehlerbilder

| Meldung (Auszug) | Ursache | Richtig |
|---|---|---|
| `Für diesen Befehl fehlt ein Geräte-Token` / `Dieser klassische Befehl läuft nicht über die OAuth-Anmeldung` | Klassischer Befehl unter OAuth. | `comvenio action list` → passende `cai.*`-Action mit `comvenio action call <id> --input '{…}'`. Gibt es keine: als Wunsch über das Issue-Formular melden. |
| `Diese Comvenio-Ressource ist in deinem aktuellen Vereins- und Rechtekontext nicht verfügbar.` bei einer **schreibenden** Action | Meist fehlt der Anmeldung ein Schreib-Scope: Die Bestätigungsvorschau verlangt `*.write` oder `admin.write`. Seltener fehlt dir im Verein das Recht selbst. | `connector.scopes` im State prüfen; fehlt der Scope → `comvenio login --scopes …,admin.write`. Hast du den Scope, fehlt das Vereinsrecht — das vergibt ein Administrator des Vereins. |
| `Diese Action ist im aktuellen OAuth-, Vereins- und Rechtekontext nicht freigegeben.` | Die Action steht nicht in der Tool-Liste dieser Verbindung. **Direkt nach einem Connector-Deploy** auch vorübergehend. | `comvenio action list` prüfen; nach einem Deploy eine Minute warten und wiederholen. |
| `Der Fachservice hat keine freigegebene Antwortform geliefert.` | Die Antwort passt nicht zum veröffentlichten Vertrag der Action — ein Fehler auf Comvenio-Seite, nicht bei dir. | Nicht umgehen; als Fehlerbericht melden (Issue-Formular im Repository) mit Action-ID und Uhrzeit. |
| `Die Connector-Verbindung trägt nicht mehr (abgelaufen oder widerrufen)` | OAuth-Grant abgelaufen. | `comvenio login` (mit denselben `--scopes`). |
| Beim Login nach `--device-token` gefragt / Wert fehlt | Alter Weg. | Nicht verwenden; `comvenio login` ohne Token. |
