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

Die Antwort enthält eine Session-ID. Für Rückfragen, Korrekturen und
Freigaben muss dieselbe Session weiterverwendet werden:

```powershell
comvenio agent chat "Ja, bereite den Aufruf vor." `
  --session 12121212-1212-4212-8212-121212121212
```

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

## Noch offene CLI-Administration

`agent chat` deckt die dialogische Nutzung ab. Die administrativen
Club-Agent-Workflows (Konfiguration, Skill-Pakete, Routinen, Watch-Rules,
Freigabe-Cockpit, Journal und Memory) bleiben in der Coverage-Registry
explizit als `core-partial` sichtbar, bis sie als sichere CLI-Actions
implementiert sind.
