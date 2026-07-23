# Changelog

Alle wichtigen Änderungen am Comvenio CLI werden in dieser Datei dokumentiert.
Die Einträge folgen
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) und verwenden
[Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Added

- Geschütztes MCP-Tool `cv_my_tasks_read` für die eigenen, OAuth-gebundenen
  Aufgaben in einem expliziten Zeitfenster mit `task.read`, Backend-RBAC,
  Datenschutz-Minimierung und Scope-basiertem Verbergen bis zur erneuten
  OAuth-Autorisierung.
- Private, frei wählbare Aufgaben-Erinnerungen über Web, CLI und das
  providerneutrale MCP-Tool `cv_my_task_reminder_write`. Empfänger werden
  ausschließlich aus dem authentifizierten Subjekt abgeleitet; das Schema
  akzeptiert keine Benutzer- oder Empfänger-ID. Der Versand prüft unmittelbar
  zuvor die aktuelle Reminder-Generation, Aufgabenexistenz und aktive
  Mitgliedschaft erneut.
- CLI-Kommandos `task reminder set|list|delete` für die eigenen
  Aufgaben-Erinnerungen.
- GitHub-Actions-Qualitätsgate für Lockfile-Installation, TypeScript-Vertrag,
  vollständige Tests, repository-lokale Connector-Verträge sowie CLI- und
  MCP-Build.
- Ausführbarer, fail-closed Remote-MCP-Prozess für Railway mit Streamable HTTP,
  OAuth-Resource-Metadaten, Liveness- und Readiness-Trennung sowie Graceful Shutdown.
- Railway-Konfiguration für den getrennten MCP-Build und Start auf `0.0.0.0:$PORT`.
- Source-Available-Lizenz für die ausschließliche Verwendung mit Comvenio.
- Strukturierte Formulare für Fehler, Wünsche und Supportfragen.
- Privater Meldeweg und Sicherheitsrichtlinie für Schwachstellen.
- Beitragsrichtlinie für Issues und Pull Requests.

### Changed

- Standard-MCP-Clients wie Claude und Codex können ohne den proprietären
  `X-Comvenio-Provider`-Header initialisieren. Authentifizierte Provider werden
  weiterhin aus dem geprüften OAuth-Principal abgeleitet; Client- und
  Provider-Metadaten beeinflussen keine Berechtigungen.
- `cv_whoami_read` benötigt keine Domain oder Club-ID mehr. ChatGPT, Claude und
  Codex können den im OAuth-Grant gebundenen Verein ohne Eingabe auflösen und
  damit öffentliche Termine des verbundenen Vereins abrufen; abweichende
  Vereins-IDs bleiben fail-closed.
- `cv_permissions_explain_read` und `cv_schema_read` leiten den Vereins- und
  Abteilungskontext nun ebenfalls ausschließlich aus OAuth ab und akzeptieren
  keine vom Modell gelieferte Club-ID mehr.
- Alle Runtime-Tools deklarieren ihre Authentifizierung pro Tool über
  `securitySchemes` einschließlich des `_meta`-Kompatibilitätsspiegels.
- MCP-Aufgabenergebnisse verwenden eine explizite Output-Allowlist und geben
  keine Zuweisungs-, Mitglieds-, Benutzer-, Audit- oder System-IDs an Provider
  weiter.
- Der Railway-Healthcheck nutzt `/health`; die Produktfreigabe bleibt unabhängig
  davon über `/ready` gesperrt, bis Katalog, OAuth und Capability-Gates erfüllt sind.
- Das Paket ist gegen eine versehentliche Veröffentlichung bei npm geschützt.

