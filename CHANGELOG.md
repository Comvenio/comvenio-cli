# Changelog

Alle wichtigen Änderungen am Comvenio CLI werden in dieser Datei dokumentiert.
Die Einträge folgen
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) und verwenden
[Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Fixed

- Scheitert die Anmeldung mit einem Maschinen-Grant (`AUTH_REQUIRED`), nennt
  das CLI nicht mehr `comvenio login`, sondern nur den Weg über die
  Vereinseinstellungen › Automation.
- `whoami` zeigt ohne übertragenen Namen nicht mehr „? <?>“, sondern wessen
  Anmeldung es ist (OAuth oder Maschinen-Grant), dazu die Scopes der Verbindung.
- Fehlt einem Grant `club.read`, endet `whoami` mit `SCOPE_REQUIRED` samt Hinweis
  statt mit `UNKNOWN_ERROR`.
- Ist der Connector nicht erreichbar (Name nicht auflösbar, Verbindung
  abgelehnt), lautet der Fehler `UPSTREAM_UNAVAILABLE` statt `UNKNOWN_ERROR`.

### Added

- Neue Action `cai.homepage.05.convert` (Scope `club.write`, lesend): wandelt
  die Homepage-Gerüste des angemeldeten Vereins vom alten Format
  (`data-widget-slot`) in benannte Slots um — der Algorithmus des
  entfallenen Befehls `homepage convert` unverändert, jetzt Teil desselben
  Werkzeugs wie `cai.homepage.01-04`. Antwort: `tabs` (direkt für
  `cai.homepage.02.apply` verwendbar), dazu ein Bericht (`umgewandelt`,
  `offene_stellen`, `katalogklassen_verschoben`, `befunde`, `hinweise`).
  Nichts wird angewendet — das bleibt `cai.homepage.02.apply` nach
  ausdrücklicher Freigabe. Idempotent: ein zweiter Lauf auf bereits
  umgewandelten Gerüsten meldet einen leeren Bericht.
- `gen:schema` liest — sobald vorhanden — Widget- und Vorlagen-Erklärungen aus
  `widget-erklaerungen.json` (Frontend/web-page, neben `widget-felder.json`)
  und schreibt sie als `beschreibung` je Widget und `template_beschreibung`
  je Vorlage in `src/schema/homepage.json`. `gen:docs` erzeugt daraus in
  `docs/homepage.md`/`docs/en/homepage.md` die neuen Abschnitte „Widgets“ und
  „Vorlagen“; `check:docs` meldet jedes Widget ohne Erklärung einzeln. Die
  Quelldatei existiert im Frontend noch nicht — bis dahin zeigen beide
  Abschnitte ehrlich eine offene Stelle statt erfundenen Texts.
- Anmeldung ohne Browser mit einem Maschinen-Grant des Vereins: Sind
  `COMVENIO_CLIENT_ID` und `COMVENIO_CLIENT_SECRET` gesetzt, holen `whoami` und
  `action list|call|confirm` per Client-Credentials einen kurzlebigen Zugang und
  halten ihn nur im Speicher (keine Zustandsdatei, kein Zugangsdatenspeicher).
  `COMVENIO_ENV=dev` wählt die Testumgebung. Fehlt eine der Variablen, endet der
  Aufruf mit `AUTH_REQUIRED` und nennt sie. Der MCP-Gateway nimmt
  Maschinen-Tokens nur am CLI-Kanal an und nie mit einem gesperrten Scope.
- Warnzeile für Geräte-Token: Läuft ein Aufruf mit gespeichertem Geräte-Token,
  schreibt das CLI eine Zeile auf stderr mit dem Fristende („Dein Geräte-Token
  läuft am TT.MM.JJJJ aus — stell auf comvenio login um.“). Das Datum kommt aus
  dem Token-Status des Kontos und wird einen Tag in der Zustandsdatei gehalten;
  `--json`-Ausgaben bleiben unverändert. Nach dem Fristende lehnt der Server
  Geräte-Token ab.
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

- `comvenio agent chat` spricht über den Connector (`cv_club_agent_converse` am
  CLI-Kanal) mit der Anmeldung aus `comvenio login`; `--club` entfällt, der
  Verein kommt aus der Anmeldung. Die Antwort nennt je Freigabe den Link und je
  Lauf den Stand, mit `--json` als `run_refs` und `approval_refs`.
- `cv_club_agent_converse` liefert zusätzlich `run_refs` und `approval_refs`,
  wenn ein Zug Läufe oder Freigaben berührt; `session_id` und `response`
  bleiben unverändert.
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

### Removed

- **Breaking:** Geräte-Token gibt es im CLI nicht mehr (ohne Frist, D-GTA-20).
  `login --device-token` und `--token` enden mit `USAGE_ERROR`; angemeldet wird
  nur noch mit `comvenio login` im Browser, Skripte und Server nutzen einen
  Maschinen-Grant (`COMVENIO_CLIENT_ID`/`COMVENIO_CLIENT_SECRET`). Ein
  gespeicherter Geräte-Block wird beim ersten Start entfernt und einmal
  gemeldet; eine OAuth-Verbindung bleibt.
- Die klassischen Domänenbefehle (`club`, `member`, `event`, `homepage` und
  weitere), der Legacy-Client, der Fehlercode `OAUTH_ONLY`, der Befehl
  `schema` und die Coverage-Registry. Ein Aufruf endet mit `USAGE_ERROR` und
  verweist auf `comvenio action list`. Das CLI kennt nur noch `login`,
  `logout`, `whoami`, `action`, `agent chat`, `finance` und `help`.
- Die Warnzeile zum Fristende; die Frist entfiel.
- `comvenio agent approval`, `comvenio function` und `comvenio automation`.
  Freigaben, Funktionen und Automationen bleiben in Web-App und App; ein Aufruf
  endet mit `USAGE_ERROR` und nennt den Ort in der Web-App.
