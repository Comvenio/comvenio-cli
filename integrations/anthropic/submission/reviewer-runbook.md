# Comvenio – Claude Connector Directory Reviewer-Runbook

Dieses Runbook prüft ausschließlich synthetische Daten im vorbereiteten Reviewverein. Zugangsdaten werden im Directory-Portal als verschlüsselte Submission-Secrets hinterlegt und stehen nicht in diesem Repository.

## Verbindung

1. `https://comvenio-cli-production.up.railway.app/mcp` als Streamable-HTTP-Connector verbinden.
2. Vor Einreichung die Verfügbarkeit des permanenten Directory-Slugs `comvenio` im Portal bestätigen.
3. Public Read ohne Anmeldung mit veröffentlichten Events und News prüfen.
4. Eigene Rechte oder sichtbare Aktionen abfragen und OAuth-CIMD mit öffentlichem Client, `none` und PKCE S256 abschließen.
5. Bei mehreren Vereinen den synthetischen Reviewverein ausdrücklich wählen.

## Konten

- `member`: vollständig befülltes Mitglied ohne Verwaltungsrechte und ohne MFA.
- `manager`: vollständig befülltes Verwaltungskonto ohne MFA.

## Sicherheits- und Datenschutzfälle

1. Nicht erlaubte Tools und Widget-Aktionen müssen beim `member` vollständig verborgen sein.
2. Ein absichtlicher Backend-403 muss sicher normalisiert werden und darf keine Mutation auslösen.
3. Ein Cross-Tenant-Aufruf mit fremder `club_id` muss vor dem Fachservice scheitern.
4. Nicht veröffentlichte News, private Termine und Mitgliederdaten dürfen im v1-Umfang weder als Tool angeboten noch offengelegt werden.
5. Nach Grant-Widerruf muss der nächste private Aufruf eine neue Anmeldung verlangen.
6. Toolargumente, Tokens, Mitgliederdaten und Resultinhalte dürfen nicht in Telemetrie erscheinen.

## Tool-Sync und Oberflächen

- Jedes veröffentlichte Tool im MCP Inspector und als Claude Custom Connector mit Happy Path und Permission-Denial ausführen.
- Kalender- und News-App mit demselben Build auf Claude Web, Desktop und Mobile prüfen.
- Drei bis fünf unterschiedliche PNG-Carousel-Bilder mit mindestens 1000 Pixeln Breite enthalten
  ausschließlich die jeweilige App-Antwort mit synthetischen Daten; die Prompts stehen separat im
  Profil. Beide veröffentlichten Widgets sind mindestens einmal vertreten.
- Externe News-Links sind nicht vorab freigegeben und behalten deshalb Claudes Bestätigungsdialog.

Ein offenes Finding blockiert nur die Claude-Publikation. Der ChatGPT-Freigabestatus wird dadurch nicht automatisch verändert.
