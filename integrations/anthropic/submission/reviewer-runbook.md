# Comvenio – Claude Connector Directory Reviewer-Runbook

Dieses Runbook prüft ausschließlich synthetische Daten im vorbereiteten Reviewverein. Zugangsdaten werden im Directory-Portal als verschlüsselte Submission-Secrets hinterlegt und stehen nicht in diesem Repository.

## Verbindung

1. `https://mcp.comvenio.app/mcp` als Streamable-HTTP-Connector verbinden.
2. Vor Einreichung die Verfügbarkeit des permanenten Directory-Slugs `comvenio` im Portal bestätigen.
3. Public Read ohne Anmeldung mit veröffentlichten Events und News prüfen.
4. Eigene Rechte oder sichtbare Aktionen abfragen und OAuth-CIMD mit öffentlichem Client, `none` und PKCE S256 abschließen.
5. Bei mehreren Vereinen den synthetischen Reviewverein ausdrücklich wählen.
6. „Welche offenen Aufgaben habe ich diese Woche?“ abfragen. Claude muss
   `cv_my_tasks_read` mit dem Zeitraum und `task.read` verwenden, ohne Domain,
   Club-ID oder Mitglieds-ID zu erfragen.
7. „Erinnere mich morgen um 18 Uhr an meine erste offene Aufgabe“ abfragen.
   Claude muss `cv_my_task_reminder_write` mit `task.read` verwenden;
   `task.write` darf für diese persönliche Präferenz nicht erforderlich sein.
   Club, Benutzer und Empfänger dürfen nicht als Toolargument
   gesendet werden; ausschließlich das verbundene Reviewkonto erhält die
   Erinnerung. Ohne `task.read` bleibt das Tool verborgen. Das Löschen
   verwendet dieselbe Task-ID und keine separate Reminder-ID.

## Konten

- `member`: vollständig befülltes Mitglied ohne Verwaltungsrechte und ohne MFA.
- `manager`: vollständig befülltes Verwaltungskonto ohne MFA.

## Sicherheits- und Datenschutzfälle

1. Nicht erlaubte Tools und Widget-Aktionen müssen beim `member` vollständig verborgen sein.
2. Ein absichtlicher Backend-403 muss sicher normalisiert werden und darf keine Mutation auslösen.
3. Ein Cross-Tenant-Aufruf mit fremder `club_id` muss vor dem Fachservice scheitern.
4. `cv_my_tasks_read` darf keine `club_id` oder `member_id` als Argument akzeptieren und nur Aufgaben des OAuth-gebundenen Mitglieds liefern.
5. `cv_my_task_reminder_write` darf keine Empfänger-ID akzeptieren. Ein
   Backend-403 oder eine fremde Task-ID muss sicher normalisiert werden und
   darf keine fremden Details offenlegen. Ersetzte oder gelöschte Reminder und
   Reminder nach Verlust der aktiven Mitgliedschaft dürfen nicht zugestellt
   werden.
6. Entwürfe, private Termine und Mitgliederdaten dürfen nur bei passendem
   Scope, aktuellem Capability-Snapshot und erfolgreichem Backend-RBAC-Recheck
   angeboten werden. Ohne diese Freigabe bleiben Tool und Widget-Aktion
   verborgen.
7. Nach Grant-Widerruf muss der nächste private Aufruf eine neue Anmeldung verlangen.
8. Toolargumente, Tokens, Mitgliederdaten und Resultinhalte dürfen nicht in Telemetrie erscheinen.

## Tool-Sync und Oberflächen

- Jedes veröffentlichte Tool im MCP Inspector und als Claude Custom Connector mit Happy Path und Permission-Denial ausführen.
- Event/Kalender, Mitgliederverwaltung, Buchung, News und
  Bestätigungs-App mit demselben Build auf Claude Web, Desktop und Mobile
  prüfen.
- Drei bis fünf unterschiedliche PNG-Carousel-Bilder mit mindestens 1000 Pixeln Breite enthalten
  ausschließlich die jeweilige App-Antwort mit synthetischen Daten; die Prompts stehen separat im
  Profil. Alle fünf veröffentlichten Widgets sind genau nachvollziehbar
  vertreten.
- Kritische Schreibaktionen müssen zuerst die standardisierte
  Wirkungsvorschau liefern. `action_confirm` darf nur den exakt gebundenen,
  noch gültigen Intent einmalig ausführen; Replay und Rechteverlust werden
  fail-closed abgelehnt.
- Externe News-Links sind nicht vorab freigegeben und behalten deshalb Claudes Bestätigungsdialog.
- Alle Claude-Fälle aus
  `integrations/release/response-quality-suite.json` werden ausgeführt. Eine
  aktive Verbindung darf keine erneute Club-ID- oder Domain-Abfrage auslösen.
  Leere Ergebnisse werden ausdrücklich als leer benannt; fehlende Scopes und
  Backend-Ablehnungen bleiben handlungsfähig und frei von internen Kennungen.
- `cv_club_agent_converse` darf nur bei gültigem, signiertem
  Capability-Release für Verein und Kanal sichtbar sein. Ohne Freigabe darf
  Claude die Fähigkeit weder behaupten noch einen ungeprüften Agentenpfad
  aufrufen.

Ein offenes Finding blockiert nur die Claude-Publikation. Der ChatGPT-Freigabestatus wird dadurch nicht automatisch verändert.
