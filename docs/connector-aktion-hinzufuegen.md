# Eine OAuth-Action im Connector ergänzen — Checkliste

Stand: 28. September 2026 · Vorbild: `cai.teams.30.termin_list` / `cai.teams.31.termin_create` (#160)

Fehlt dem CLI eine Funktion, wird sie als Action im Connector ergänzt — nicht per direktem
API-Aufruf umgangen und nicht als klassischer Befehl (der läuft unter OAuth nicht).

## 1. Die vier Stellen im Tool-Set (z. B. `apps/mcp-server/src/tools/identity-club-member-team-role/`)

| Datei | Was |
|---|---|
| `types.ts` | Action-ID in die Liste (`cai.<domäne>.<nr>.<name>`, fortlaufend nummeriert) |
| `definitions.ts` | `definition({ action_id, domain, source_action, scopes, permission, risk, routes })` — Route **exakt** wie im Dienst (`/team-seasons/{team_season_id}/termine`) |
| `handlers.ts` | `request(client, context, METHOD, "<dienst>", path, { body })` |
| `schemas.ts` | `contract(input, output)` — Eingabe streng (`.strict()`), Ausgabe großzügig (`.strip()`, freie Namen als begrenzte Strings) |

`risk: "critical_write"` bedeutet Vorschau plus `action confirm` und verlangt einen Schreib-Scope
in der Anmeldung (siehe [fehlerbilder.md](fehlerbilder.md)).

## 2. Vertragstests nachziehen (zählen die Actions fest)

- `packages/connector-contracts/tests/actions.contract.test.ts`
  - `directActionIds` `toHaveLength(n)` und `new Set(...).size` um die Anzahl erhöhen, Kommentar mit Anlass
  - die neuen IDs in `additiveActionIds` eintragen (alphabetisch in ihrer Gruppe)
  - `summary` → `discovered_actions` / `published_domain_actions` erhöhen
  - Domänenzählung (z. B. K7 „exactly N inventoried actions“ und `teams: N`)
- eigener Vertragstest in `apps/mcp-server/tests/<thema>.contract.test.ts` (Route, `risk_class`, Eingabe, Ausgabe)

## 3. Erzeugte Dateien neu schreiben

```bash
bun run gen:provider-submissions   # Anbieterprofile, Testpläne, Fixtures (Tool-Anzahl)
bun run gen:connector-release      # Release-Artefakte (eval, quality, gate report)
```

## 4. Alle CI-Schritte lokal (die GitHub-CI kann am Budget scheitern)

```bash
for s in typecheck test:cli test:mcp test:contracts gen:coverage:check \
  gen:openai-submission:check gen:anthropic-submission:draft:check \
  gen:connector-release:check gen:provider-submissions:check build:mcp; do
  bun run $s >/tmp/ci-$s.log 2>&1; echo "$s exit $?"; done
```

## 5. Ausliefern und prüfen

PR auf `main` → Merge → Railway rollt `comvenio-cli` aus (`railway deployment list --service comvenio-cli`).
Danach `comvenio action list | rg <action>`; die erste Minute nach dem Deploy kann eine Action
noch als „nicht freigegeben“ erscheinen.

## Häufige Rotstellen

| Rot | Grund |
|---|---|
| `Expected length: 399 / Received: 397` in Provider-Tests | Schritt 3 vergessen |
| `Statisches OpenAI-Profil weicht vom generierten Profil ab` | Schritt 3 vergessen |
| `covers all 303 legacy actions …` | neue ID nicht in `additiveActionIds` oder Zählung nicht erhöht |
| `Property 'routes' does not exist on type 'K7ActionDefinition'` im eigenen Test | Felder heißen `backend_routes`, `risk_class`, `confirmation` |
| `Coverage-Registry muss N Top-Level-Commands enthalten` | neuer Top-Level-Command: Zahl in `scripts/gen-coverage.ts` und `src/coverage/domains.json` nachziehen, `bun run gen:coverage` |
