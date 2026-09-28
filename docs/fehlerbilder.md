# comvenio CLI — Fehlerbild → Ursache → richtiger Weg

Stand: 28. September 2026 · Quellen: `src/commands/action.ts`, `src/oauth/client.ts`,
`packages/comvenio-client/src/legacy.ts`, `apps/mcp-server/src/domain-runtime.ts`,
`apps/mcp-server/src/widgets/confirmation/policy.ts`, `packages/auth/src/capabilities/visibility.ts`

> **Wozu:** Dieselben Stolpersteine kosteten wiederholt Stunden. Hier stehen sie nach dem **Meldungstext**,
> den man sieht. Neue Fälle als Zeile ergänzen, belegt an Code oder Meldung.

## Grundsatz: nur noch OAuth

Der Weg ist `comvenio login` (Browser, OAuth) und danach `comvenio action list|call|confirm`.
Klassische Befehle (`comvenio teams …`, `comvenio club info` …) brauchen einen Geräte-Token und
laufen unter OAuth **nicht** — das ist Absicht, kein Fehler: Der Geräte-Token ist der alte Weg,
OAuth der einzige vorgesehene. Fehlt eine Funktion als Action, wird sie
im Connector ergänzt ([connector-aktion-hinzufuegen.md](connector-aktion-hinzufuegen.md)).

**Die Standard-Anmeldung bringt nur Leserechte:** `club.read`, `role.read.self`
(`DEFAULT_SCOPES`, `src/oauth/client.ts`). Wer schreiben will, meldet sich mit den nötigen
Scopes an, z. B.:

```bash
comvenio login --scopes club.read,role.read.self,admin.write
```

Welche Scopes eine Action braucht, steht in ihrer Definition (`required_scopes`, etwa
`ADMIN_WRITE = ["admin.write"]`). Die aktuelle Verbindung zeigt
`~/.comvenio-cli-state.json` → `connector.scopes` (nicht geheim).

## Fehlerbilder

| Meldung (Auszug) | Ursache | Richtig |
|---|---|---|
| `Für diesen Befehl fehlt ein Geräte-Token` / `Dieser klassische Befehl läuft nicht über die OAuth-Anmeldung` | Klassischer Befehl unter OAuth. | `comvenio action list` → passende `cai.*`-Action mit `comvenio action call <id> --input '{…}'`. Gibt es keine: im Connector ergänzen. |
| `Diese Comvenio-Ressource ist in deinem aktuellen Vereins- und Rechtekontext nicht verfügbar.` bei einer **schreibenden** Action | Meist fehlt der OAuth-Verbindung ein Schreib-Scope: Die Bestätigungsvorschau verlangt `*.write` oder `admin.write` (`ConfirmationWidgetCapabilityPolicy`). Seltener: Der Dienst antwortet 403/404. | `connector.scopes` im State prüfen; fehlt der Scope → `comvenio login --scopes …,admin.write`. Erscheint die Anfrage nicht in den Logs des Fachdienstes, lag es am Connector, nicht am Dienst. |
| `Diese Action ist im aktuellen OAuth-, Vereins- und Rechtekontext nicht freigegeben.` | Die Action steht nicht in der Tool-Liste dieser Verbindung. **Direkt nach einem Connector-Deploy** auch vorübergehend. | `comvenio action list` prüfen; nach einem Deploy eine Minute warten und wiederholen. |
| `Der Fachservice hat keine freigegebene Antwortform geliefert.` | Das Antwortschema der Action (`schemas.ts`, `contract(input, output)`) ist strenger als das, was der Dienst speichert (Beispiel 2026-09-28: `sidebar_color_mode` kannte nur `match\|custom`, der Dienst speichert auch `light\|dark`). | Antwortschema an den **gespeicherten** Stand anpassen (Lesevertrag großzügig, Schreibvertrag streng). Nicht umgehen. |
| Feld fehlt in der Antwort, obwohl der Dienst es liefert | Die Redaktion (`privacy.ts`, etwa `redactClubSettings`) wählt Felder aus. | Feld in der Redaktion freigeben, wenn es fachlich öffentlich ist; Test dazu. |
| `Die Connector-Verbindung trägt nicht mehr (abgelaufen oder widerrufen)` | OAuth-Grant abgelaufen. | `comvenio login` (mit denselben `--scopes`). |
| Beim Login nach `--device-token` gefragt / Wert fehlt | Alter Weg. | Nicht verwenden; `comvenio login` ohne Token. |

## Wo die Anfrage landet (Betrieb)

| Dienst (Railway, Projekt `comvenio`) | Zweck |
|---|---|
| `comvenio-cli` | Connector für das **lokale CLI** — Ressource `https://mcp.comvenio.app/cli`, vom Cloudflare-Gateway an `comvenio-cli-production` weitergeleitet |
| `Comvenio-MCP` | Anbindung für ChatGPT-/Claude-Plugins |

Railway-Status und Logs ohne Repo-Verknüpfung: in einem Hilfsordner
`railway link --project comvenio --environment production --service <dienst>`, dann
`railway deployment list`, `railway logs --deployment` (Start) bzw. `railway logs --since 30m`.
Direkte Datenbankzugriffe nur lesend und nur auf Schema-Metadaten.

## Vereins-Beschränkung

Schreiben und Lesen nur im Comvenio-Verein (PROD `0ec34e70-…`, DEV `476bc619-…`). Jede Ausnahme
braucht die ausdrückliche Bestätigung der Projektleitung und wird als DECISION-Note am Vorgang festgehalten —
auch „nur lesen“.
