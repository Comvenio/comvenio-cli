# Comvenio – Claude Connector Directory Submission-Checkliste

Stand: 23. Juli 2026
Status: **BLOCKED – noch nicht absenden**

Diese Checkliste ergänzt das maschinenlesbare Connector-Profil und das Reviewer-Runbook. Sie
enthält keine Zugangsdaten oder Tokens. Submission-Secrets werden ausschließlich verschlüsselt im
Anthropic-Portal hinterlegt.

## Portal und Organisation

- Submission-Portal: `https://claude.ai/admin-settings/directory/submissions/new`
- Einreichung aus der berechtigten Comvenio Team- oder Enterprise-Organisation.
- Directory-Management-Zugriff und permanenter Slug `comvenio` sind im Portal zu bestätigen.
- Ziel ist ein Remote MCP mit MCP Apps, kein Claude-Code-Plugin.

## Listing-Daten

- Name: `Comvenio`
- Tagline: `Dein Verein. Dein KI-Agent. Direkt im Chat.`
- Kategorie: `Productivity`
- MCP-URL: `https://mcp.comvenio.app/mcp`
- Website: `https://www.comvenio.app`
- Dokumentation: `https://www.comvenio.app/hilfe`
- Datenschutz: `https://www.comvenio.app/datenschutz`
- Nutzungsbedingungen: `https://www.comvenio.app/agb`
- Support: `support@comvenio.de`

Die vollständige Kurzbeschreibung und alle technischen Felder stehen in
`connector-profile.json`. Capability-Angaben entsprechen der Runtime:
`tools=true`, `resources=true`, `mcp_apps=true`, `prompts=false`.

## OAuth/CIMD

- Der Authorization Server bewirbt CIMD, öffentlichen Client mit `none` und PKCE S256.
- DCR und Anthropic-held Client-Secrets sind kein Bestandteil der V1-Einreichung.
- Die beim echten Claude-Verbindungsaufbau beobachtete CIMD-`client_id`-URL und ihr geprüfter
  SHA-256-Dokumentfingerprint müssen ohne Wildcard in Auth-Service und Gateway gepinnt werden.
- Erst danach müssen `/ready`, OAuth-Ende-zu-Ende, Rechteverlust und Widerruf erfolgreich geprüft
  werden. Die Client-ID wird nicht aus Beispielen oder Claude-Code-Dokumentation geraten.

## MCP-Apps-Carousel

Das Portal verlangt drei bis fünf unterschiedliche PNG-Bilder mit mindestens 1000 Pixeln Breite.
Jedes Bild zeigt ausschließlich die App-Antwort mit synthetischen Daten; der Prompt wird getrennt
im Portal hinterlegt. Video und GIF sind ausgeschlossen.

Aktueller Stand: Es gibt noch keine freigegebene Submission-Evidence. Die vorhandenen Dateien
`event-mobile.png` und `news-desktop.png` sind Planungsmockups. Sie zeigen Schreib- beziehungsweise
Entwurfsfunktionen, die nicht zum veröffentlichten `personal_productivity_v1`-Umfang gehören, und werden im
Connector-Profil deshalb bewusst nicht referenziert. Drei bis fünf reale Runtime-Captures fehlen.

Mitgliederverwaltung, Buchung und universelle Bestätigung sind noch nicht veröffentlicht und
dürfen deshalb nicht als dritter Screenshot verwendet werden. Beide veröffentlichten Widgets
müssen im Carousel mindestens einmal vertreten sein.

## Review-Evidence

- Jedes produktiv veröffentlichte Tool im MCP Inspector und als Claude Custom Connector testen.
- Pro Tool Happy Path und Permission-Denial dokumentieren.
- Event/Kalender und News mit demselben Build auf Claude Web, Desktop und Mobile prüfen.
- Vollständig befüllte synthetische `member`- und `manager`-Konten ohne MFA als verschlüsselte
  Submission-Secrets bereitstellen.
- Datenverarbeitung, First-Party-API, Datenschutz und Supportfragen im Portal vollständig
  beantworten.
- Offene Security-, Privacy- oder Provider-Findings schließen.

## Absende-Gate

Die Einreichung ist nur zulässig, wenn
`bun run gen:anthropic-submission:check` in der freigegebenen Testumgebung erfolgreich ist, der
Anthropic-Preflight `state=ready` liefert, `/ready` HTTP 200 meldet und der zentrale Releasebericht
Anthropic in `submittable_providers` enthält. Bis dahin bleibt
`DIRECTORY_PORTAL_EVIDENCE_PENDING` aktiv.
