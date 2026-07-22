# Changelog

Alle wichtigen Änderungen am Comvenio CLI werden in dieser Datei dokumentiert.
Die Einträge folgen
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) und verwenden
[Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Added

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
- Der Railway-Healthcheck nutzt `/health`; die Produktfreigabe bleibt unabhängig
  davon über `/ready` gesperrt, bis Katalog, OAuth und Capability-Gates erfüllt sind.
- Das Paket ist gegen eine versehentliche Veröffentlichung bei npm geschützt.

