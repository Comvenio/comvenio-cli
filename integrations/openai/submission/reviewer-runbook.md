# Comvenio – OpenAI Reviewer Runbook

Dieses Runbook prüft das öffentliche ChatGPT-Plugin mit enthaltener Comvenio MCP-App. Sämtliche Beispiele und Screenshots verwenden ausschließlich synthetische Daten des Reviewvereins.

## Voraussetzungen

- Universeller MCP-Endpunkt: `https://mcp.comvenio.app/mcp`
- OAuth-Metadaten: `https://mcp.comvenio.app/.well-known/oauth-protected-resource`
- Zwei Konten im Reviewverein: `member` und `manager`
- Beide Konten sind ohne MFA, SMS-, E-Mail- oder sonstige Nachprüfung nutzbar.
- Zugangsdaten stehen ausschließlich im verschlüsselten Submission-Secret; dieses Repository enthält keine Zugangsdaten.

## Prüffolge

1. Frage ohne Verbindung nach veröffentlichten Terminen und News. Erwartet werden nur minimierte öffentliche Daten ohne interne IDs oder Entwürfe.
2. Fordere die Erklärung der eigenen Rechte oder sichtbaren Aktionen an. ChatGPT muss OAuth Authorization Code mit PKCE S256 starten.
3. Wähle den Reviewverein explizit. Private Tools dürfen vor der eindeutigen Vereinsbindung nicht erscheinen.
4. Frage nach den öffentlichen Terminen „meines Vereins“. ChatGPT muss `cv_whoami_read` ohne Eingabe und danach `public_events` mit der gebundenen `club_id` aufrufen, ohne Domain, Slug oder Club-ID nachzufragen.
5. Frage „Welche offenen Aufgaben habe ich diese Woche?“. ChatGPT muss `cv_my_tasks_read` direkt mit Zeitgrenzen aufrufen; Verein, Domain, Club-ID und Mitglieds-ID dürfen nicht nachgefragt oder als Toolargument gesendet werden. Der Grant benötigt `task.read`.
6. Nutze das `member`-Konto. Es dürfen nur die eigenen zugewiesenen Aufgaben im Zeitfenster erscheinen; Verwaltungsaktionen müssen in Tool-Liste und Widgets vollständig verborgen bleiben.
7. Bitte um „Erinnere mich morgen um 18 Uhr an meine erste offene Aufgabe“.
   ChatGPT muss `cv_my_task_reminder_write` mit `task.read` verwenden.
   `task.write` darf für diese persönliche Präferenz nicht erforderlich sein.
   Das Toolargument darf weder `club_id` noch `user_id`,
   `member_id` oder eine Empfängerliste enthalten. Nur das verbundene
   Reviewkonto darf die Benachrichtigung erhalten. Ohne `task.read` muss das
   Tool vollständig verborgen bleiben.
8. Lösche dieselbe Erinnerung über dieselbe Task-ID wieder. Die Toolargumente
   dürfen keine Reminder-ID oder fremde Identität enthalten.
9. Entziehe im Backend testweise eine Berechtigung und wiederhole die Rechteabfrage. Der aktuelle Backend-RBAC-Recheck muss sicher ablehnen und darf keine fremden Details offenlegen.
   Ein bereits geplanter Reminder darf nach Verlust der aktiven
   Clubmitgliedschaft nicht mehr zugestellt werden.
10. Widerrufe den Grant. Der nächste private Aufruf muss erneut eine Verbindung verlangen.
11. Öffne Event/Kalender, Mitgliederverwaltung, Buchung, News und
    Bestätigungs-Widget jeweils auf ChatGPT Web und Mobile. Fachvertrag und
    erlaubte Aktionen müssen identisch sein; Layout, Fokus und Touchziele
    müssen funktionieren.
12. Führe jeden Fall sowie die fünf positiven und drei negativen Beispiele aus `tool-test-plan.json` aus und vergleiche die Antwort mit der benannten synthetischen Fixture.
13. Starte eine kritische Schreibaktion. ChatGPT muss zuerst die
    Wirkungsvorschau anzeigen. `action_confirm` darf nur Vorschau, Token und
    unveränderten Idempotenzschlüssel verwenden; Replay oder Rechteentzug vor
    dem zweiten Schritt dürfen keine Mutation auslösen.
14. Führe alle Fälle aus `integrations/release/response-quality-suite.json`
    für OpenAI aus. Eine aktive Verbindung darf niemals eine erneute Club-ID-
    oder Domain-Abfrage verursachen. Leere Ergebnisse müssen ausdrücklich als
    leer benannt werden; fehlende Scopes und Backend-Ablehnungen müssen
    handlungsfähig, aber ohne interne Kennungen erklärt werden.
15. Bitte den Club-Agenten um eine mehrstufige Priorisierung. Das Tool
    `cv_club_agent_converse` darf nur erscheinen, wenn das signierte
    Capability-Release für den ausgewählten Verein und Kanal gültig ist.
    Andernfalls darf ChatGPT weder die Fähigkeit behaupten noch einen
    ungeprüften Agentenpfad ausführen.

## Datenschutz- und Sicherheitsabbruch

Die Review-Sitzung ist sofort abzubrechen, falls Produktivdaten, fremde Vereinsdaten, Rohkontakte, Token, Login-Secrets, Log-Service-Daten oder nicht autorisierte Aktionen sichtbar werden. Das Submission-Paket bleibt bis zur gemeinsamen Signatur `OPENAI_GLOBAL_RESIDENCY_ACCEPTED` durch Product Owner und Privacy Reviewer blockiert.

## Erwartete Fehlerzustände

- OAuth-Abbruch: keine private Antwort und keine Mutation.
- Rechtewechsel oder Backend-403: sichere Fehlermeldung, alte Aktionen verschwinden.
- Mobile Layoutabweichung oder CSP-/Assetfehler: Submission blockiert.
- OpenAI Review-Finding: nur OpenAI-Submission blockiert; der unabhängige Claude-Prozess bleibt unverändert.
