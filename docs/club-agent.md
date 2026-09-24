# Club-Agent

Der Club-Agent ist Comvenios vereinseigener, kanalunabhängiger Assistent. Er
läuft im `ai-service`; CLI, MCP/ChatGPT, Claude, App, Web, Voice und spätere
Kanäle sind nur Oberflächen.

## Drei Ausführungsebenen

1. Direkte Daten- und Aktionsbefehle liefern strukturierte, deterministische
   Vereinsdaten. Sie sind für einfache Fragen zu Events, News, Aufgaben,
   Mitgliedern oder anderen einzelnen Bereichen vorzuziehen.
2. Domain Skills bündeln bekannte Vereinsabläufe und erzwingen deren
   fachliche Vorbedingungen, Risiko- und Freigaberegeln.
3. Der Club-Agent nutzt LangGraph für Beratung, Planung, proaktive Hinweise
   und mehrstufige Aufgaben. Seine Tool Registry und Capability Map bestimmen,
   welche Skills tatsächlich ausführbar sind.

Der Club-Agent ist keine alternative Datenquelle und kein generischer
API-Passthrough. Alle Zugriffe erfolgen mit der Identität des angemeldeten
Benutzers; die Backend-Services prüfen Verein und RBAC erneut.

## Dialog über die CLI

```powershell
comvenio agent chat "Plane die Helfereinteilung für unser Sommerfest."
```

Die Antwort enthält eine Session-ID. Für Rückfragen und Korrekturen
wird dieselbe Session weiterverwendet:

```powershell
comvenio agent chat "Nimm lieber Samstag statt Freitag." `
  --session 12121212-1212-4212-8212-121212121212
```

## Freigaben

Schreibt der Agent etwas, legt er eine Freigabe-Anfrage an. Ein getipptes
„Ja“ gibt nichts frei — weder im Terminal noch im Web. Die Antwort nennt
den Direktlink der Anfrage; `--json` enthält sie als `approval_refs`.

```powershell
comvenio agent approval list                # offene Freigaben
comvenio agent approval list --state decided # entschieden, letzte 7 Tage
comvenio agent approval show <id>
comvenio agent approval approve <id>        # gibt nur den Direktlink aus
```

Entschieden wird ausschließlich in Web oder App: `approve` und `reject`
geben den Link aus, und der Dienst lehnt eine Entscheidung mit dem
Geräte-Token ab (`decision_requires_app`). Dauerfreigaben entstehen und
enden ebenfalls nur dort, im Reiter „Fähigkeiten & Routinen“.

Für Agenten und Skripte:

```powershell
comvenio agent chat "Welche Risiken siehst du für Samstag?" --json
```

Das CLI sendet ausschließlich Nachricht, gebundenen Verein, festen
Gesprächskontext und optional die Session-ID. `user_id`, Rollen,
Berechtigungen oder Zielpersonen können nicht mitgegeben werden.

## Verfügbarkeit

Der Connector verursacht keinen eigenen Comvenio-Aufpreis. Für einen
Club-Agent-Turn gelten weiterhin die zentralen Produkt- und
Vereinsfreigaben des `ai-service`; der CLI- oder MCP-Kanal umgeht diese
Regeln nicht. Ist der Club-Agent für einen Verein noch nicht eingerichtet,
antwortet der Dienst ohne interne Diagnose- oder Trace-Daten.

Der MCP-Server registriert `cv_club_agent_converse` nur, wenn die
actor-gebundene Runtime-Map unter
`/ai/club-agents/{club_id}/capabilities?hub=club_agent_dm&channel=mcp`
mindestens eine vollständig freigegebene Capability mit
`advertisable`, `agent_selectable`, `user_invocable` und
`externally_exposed` enthält. Eine fehlende, abgelehnte oder ungültige
Gate-Antwort verbirgt ausschließlich den Club-Agent-Dialog; direkte
Vereins-Tools bleiben nutzbar.

## Noch offene CLI-Administration

`agent chat` deckt die dialogische Nutzung ab, `agent approval` das Lesen
von Freigaben. Die administrativen Club-Agent-Workflows (Konfiguration,
Skill-Pakete, Routinen, Watch-Rules, Journal und Memory) bleiben in der Coverage-Registry
explizit als `core-partial` sichtbar, bis sie als sichere CLI-Actions
implementiert sind.
