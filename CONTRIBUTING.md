# Zum Comvenio CLI beitragen

Vielen Dank, dass Sie das Comvenio CLI verbessern möchten. Das Repository ist
öffentlich einsehbar, das CLI bleibt jedoch ausschließlich für die Verwendung
mit Comvenio bestimmt.

## Vor einem Issue

1. Prüfen Sie, ob bereits ein passendes Issue existiert.
2. Entfernen Sie Zugriffstoken, Passwörter und personenbezogene Vereinsdaten.
3. Melden Sie Sicherheitsprobleme ausschließlich über den privaten Weg in
   [SECURITY.md](SECURITY.md).

Nutzen Sie anschließend das passende
[Issue-Formular](https://github.com/Comvenio/comvenio-cli/issues/new/choose).

## Entwicklung lokal prüfen

Voraussetzungen sind Git und Bun.

```bash
git clone https://github.com/Comvenio/comvenio-cli.git
cd comvenio-cli
bun install
bun run typecheck
bun test
bun run build
```

Produktoperationen und manuelle Prüfungen erfolgen ausschließlich über das
`comvenio` CLI. Direkte Aufrufe von Comvenio-APIs sind kein zulässiger Ersatz
für fehlende CLI-Funktionen.

## Pull Requests

1. Erstellen Sie einen kleinen, thematisch eindeutigen Branch.
2. Beschreiben Sie Problem, Änderung und Auswirkungen.
3. Ergänzen oder aktualisieren Sie Tests und öffentliche Dokumentation.
4. Führen Sie Typecheck, Tests und Build aus.
5. Öffnen Sie einen Pull Request gegen `main`.

Ein Pull Request darf keine Tokens, Kundendaten oder internen Zugangsdaten
enthalten.

## Lizenz der Beiträge

Mit einem Beitrag bestätigen Sie, dass Sie ihn einreichen dürfen und Comvenio
ihn gemäß der Beitragsregel in [LICENSE](LICENSE) verwenden, bearbeiten und
unter der Comvenio CLI Source-Available License veröffentlichen darf.

