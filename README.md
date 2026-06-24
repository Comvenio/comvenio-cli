# comvenio-cli

Das offizielle Comvenio Club-CLI. Ein Club-Admin (oder dessen KI-Agent)
authentifiziert sich per opakem Device-Token (`cvn_...`) und spricht damit das
Comvenio-Gateway an. Phase 1 (dieser Stand) = Fundament + Auth; die
Domänen-Commands (Mitglieder, Veranstaltungen, Buchungen, Aufgaben, Speisekarte,
Homepage) folgen in den Strängen comvenio-cli-04..09.

Stack: **Bun + cac + TypeScript**. Bau-Vorbild: `comvenio-tools/rts-cli`.

## Installation

```bash
bun install
bun run build        # erzeugt die Binary "comvenio" (bzw. comvenio.exe auf Windows)
```

Die Binary ist eigenständig (`bun build --compile`) — keine Bun-Laufzeit nötig,
um sie auszuführen.

## Verwendung

```bash
# Einloggen — Token in der Web-App unter "CLI-Zugriff" erzeugen
comvenio login --token cvn_a1b2c3...            # PROD (Default)
comvenio login --token cvn_... --env dev        # DEV-Gateway (apidev.comvenio.app)
comvenio login --token cvn_... --club <club-id> # Club-ID explizit setzen

# Aktuellen Login prüfen
comvenio whoami
comvenio whoami --json

# Vereinsdaten anzeigen
comvenio club info
comvenio club info --json

# Abmelden (State-File löschen)
comvenio logout
```

### `--env`-Mapping

| `--env`          | Gateway                       |
|------------------|-------------------------------|
| `prod` (Default) | `https://api.comvenio.app`    |
| `dev`            | `https://apidev.comvenio.app` |
| `local`          | `http://localhost`            |

`--gateway <url>` überschreibt die Basis direkt.

## Konzept

- **Token opak:** Das `cvn_`-Token wird vom CLI nie dekodiert. Gültigkeit prüft
  ausschließlich der Server.
- **State-File:** `~/.comvenio-cli-state.json` (Merge-Semantik — wird nie ganz
  überschrieben).
- **Agent-freundlich:** Jeder Command kennt `--json` (maschinenlesbar auf
  stdout). Fehler gehen auf stderr mit Exit-Code != 0
  (`AuthError`→2, `HttpError`→3, sonst 1).
- **Retry:** Nur GETs werden bei transienten Gateway-Fehlern (502/503/504/429)
  und Timeout (15s) bis zu 3× wiederholt. Mutationen nie.

## Architektur

```
src/
  index.ts            # cac-Einstieg: login/logout + Dispatcher-Wiring + Exit-Mapping
  auth.ts             # State-File lesen/mergen/löschen, AuthError
  http.ts             # createClient(state) → service(svc, path), Bearer, GET-Retry, HttpError
  format.ts           # output(data, json, textFn), renderTable, truncate
  commands/
    whoami.ts         # GET /user/users/me (best-effort)
    club.ts           # club <action>-Dispatcher → club info → GET /club/clubs/{id}
```
