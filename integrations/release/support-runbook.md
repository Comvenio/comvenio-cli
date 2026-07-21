# Comvenio AI Connector – Support- und Rollback-Runbook

Stand: 21. Juli 2026. Zielregion: Deutschland. Der Connector ist ohne Comvenio-Aufpreis vorgesehen.

## Nutzerhilfe

Endnutzer erhalten Hilfe unter `support@comvenio.de` zu Verbindung, Vereinsauswahl, effektiven Rechten, Widerruf, Vorschau und Bestätigung sowie Datenschutz. Der Log-Service ist ausschließlich für Master-Admins bestimmt, nicht an den MCP angebunden und für Endnutzer weder direkt noch über Support-Tools einsehbar.

Die sichtbaren Tools und Widget-Aktionen werden aus dem aktuellen Capability-Snapshot abgeleitet. Jeder Fachaufruf wird zusätzlich durch das autoritative Backend-RBAC geprüft. Eine sichtbare Aktion ist daher keine dauerhafte Berechtigungszusage.

## Verbindung widerrufen

1. Den eigenen OAuth-Grant über `DELETE https://api.comvenio.app/auth/oauth/grants/{grant_id}` entfernen.
2. Alternativ ein Token über `POST https://api.comvenio.app/auth/oauth/revoke` widerrufen.
3. Prüfen, dass der nächste private MCP-Aufruf spätestens nach fünf Sekunden abgelehnt wird.
4. Bei ausbleibender Wirkung sofort den Rollback auslösen.

## Sofortige Rollback-Trigger

- Critical/High-Security- oder Datenschutzbefund
- Tenant-Isolation-Fehler
- OAuth-Widerruf ohne Wirkung
- umgehbare Bestätigung
- falsche öffentliche Datenfreigabe
- Fehlerquote über 5 % für 15 Minuten
- p95-Latenz über 8 Sekunden für 30 Minuten bei Inline-Tools

## Verbindliche Rollback-Reihenfolge

1. Schreibende Tools serverseitig deaktivieren.
2. Betroffene Widgets auf Read-only setzen.
3. Betroffenes Providerlisting pausieren.
4. Grants nur bei Tokenrisiko widerrufen.
5. Incident mit Owner, Zeitlinie, Auswirkung, Eindämmung und Folgemaßnahmen dokumentieren.

Öffentliche Read-only-Tools bleiben nur aktiv, wenn der Vorfall sie nachweislich nicht betrifft. Ein Provider darf unabhängig vom anderen pausiert werden; die gemeinsamen Sicherheits- und Datenschutz-Gates bleiben für beide verbindlich.

## Release- und Pilotnachweise

Der Release bleibt blockiert, bis der reale Pilot im Verein des Auftraggebers mindestens sieben Kalendertage, mindestens 30 erfolgreiche Interaktionen, mindestens 95 % Erfolgsquote, alle Pflichtszenarien, null Datenleck und null Confirmation-Bypass belegt. Critical/High-Findings sind nicht waiverfähig; offene Medium-Findings benötigen Mitigation und Owner. Product, Security, Privacy, Release und Pilot müssen signieren; Security und Release sind getrennte Personen.
