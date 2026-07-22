# Comvenio – OpenAI Reviewer Runbook

Dieses Runbook prüft das öffentliche ChatGPT-Plugin mit enthaltener Comvenio MCP-App. Sämtliche Beispiele und Screenshots verwenden ausschließlich synthetische Daten des Reviewvereins.

## Voraussetzungen

- Universeller MCP-Endpunkt: `https://comvenio-cli-production.up.railway.app/mcp`
- OAuth-Metadaten: `https://comvenio-cli-production.up.railway.app/.well-known/oauth-protected-resource`
- Zwei Konten im Reviewverein: `member` und `manager`
- Beide Konten sind ohne MFA, SMS-, E-Mail- oder sonstige Nachprüfung nutzbar.
- Zugangsdaten stehen ausschließlich im verschlüsselten Submission-Secret; dieses Repository enthält keine Zugangsdaten.

## Prüffolge

1. Frage ohne Verbindung nach veröffentlichten Terminen und News. Erwartet werden nur minimierte öffentliche Daten ohne interne IDs oder Entwürfe.
2. Fordere die Erklärung der eigenen Rechte oder sichtbaren Aktionen an. ChatGPT muss OAuth Authorization Code mit PKCE S256 starten.
3. Wähle den Reviewverein explizit. Private Tools dürfen vor der eindeutigen Vereinsbindung nicht erscheinen.
4. Nutze das `member`-Konto. Verwaltungsaktionen müssen in Tool-Liste und Widgets vollständig verborgen bleiben.
5. Entziehe im Backend testweise eine Berechtigung und wiederhole die Rechteabfrage. Der aktuelle Backend-RBAC-Recheck muss sicher ablehnen und darf keine fremden Details offenlegen.
6. Widerrufe den Grant. Der nächste private Aufruf muss erneut eine Verbindung verlangen.
7. Öffne Kalender- und News-Widget jeweils auf ChatGPT Web und Mobile. Fachvertrag und erlaubte Aktionen müssen identisch sein; Layout, Fokus und Touchziele müssen funktionieren.
8. Führe jeden Fall sowie die fünf positiven und drei negativen Beispiele aus `tool-test-plan.json` aus und vergleiche die Antwort mit der benannten synthetischen Fixture.

## Datenschutz- und Sicherheitsabbruch

Die Review-Sitzung ist sofort abzubrechen, falls Produktivdaten, fremde Vereinsdaten, Rohkontakte, Token, Login-Secrets, Log-Service-Daten oder nicht autorisierte Aktionen sichtbar werden. Das Submission-Paket bleibt bis zur gemeinsamen Signatur `OPENAI_GLOBAL_RESIDENCY_ACCEPTED` durch Product Owner und Privacy Reviewer blockiert.

## Erwartete Fehlerzustände

- OAuth-Abbruch: keine private Antwort und keine Mutation.
- Rechtewechsel oder Backend-403: sichere Fehlermeldung, alte Aktionen verschwinden.
- Mobile Layoutabweichung oder CSP-/Assetfehler: Submission blockiert.
- OpenAI Review-Finding: nur OpenAI-Submission blockiert; der unabhängige Claude-Prozess bleibt unverändert.
