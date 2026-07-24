# Authentifizierung und Club-Kontext

Stand: 23. Juli 2026 · Quellen: `src/index.ts`, `src/auth.ts`, `src/oauth/`, `src/commands/whoami.ts`, `src/commands/club.ts`

## Login

```bash
comvenio login
comvenio login --env dev --json
comvenio login --scopes club.read,event.read --json
```

`login` öffnet den Systembrowser und verwendet OAuth 2.1 Authorization Code
mit PKCE. Der native Public Client
`{issuer}/oauth/clients/comvenio-cli` akzeptiert ausschließlich einen
ephemeren Callback unter `http://127.0.0.1:{port}/oauth/callback`. Seine
Ressource `{MCP_PUBLIC_ORIGIN}/cli` ist strikt von der Provider-Ressource am
MCP-Origin getrennt.

Access- und Refresh-Tokens werden nicht im CLI-State gespeichert. Der
kurzlebige Backend-Actor wird ausschließlich intern im MCP-Gateway erzeugt und
nie an das CLI ausgegeben. Unter Windows schützt DPAPI den Credential-Eintrag für den
aktuellen Benutzer; unter macOS wird der Keychain und unter Linux der Secret
Service verwendet. `~/.comvenio-cli-state.json` enthält nur nicht geheime
Metadaten wie Gateway, Umgebung, Verein, Client-ID und Scopes. Vor der
Speicherung prüft `cv_whoami_read` über den `/cli`-Connector den autoritativ im
OAuth-Grant gebundenen Verein.

Optionen:

| Flag | Bedeutung |
|---|---|
| `--device-token <token>` | nur Entwicklung/Automation; opakes `cvn_`-Token |
| `--token <token>` | veralteter Alias für `--device-token` |
| `--env prod|dev|local` | Betriebsziel, Standard `prod` |
| `--gateway <url>` | Gateway-Basis explizit überschreiben |
| `--connector <url>` | zugehörigen MCP-Origin für ein eigenes Gateway setzen |
| `--scopes <csv>` | minimale benötigte OAuth-Scopes anfordern |
| `--club <id>` | nur im Device-Token-Modus: Club-Kontext überschreiben |
| `--json` | maschinenlesbare Ausgabe |

Für lokale Entwicklung ohne öffentliches HTTPS-Gateway ist OAuth bewusst
gesperrt. Dort ist `--device-token` erforderlich. Dieser Legacy-Fallback
speichert das opake Token weiterhin im State; das State-File darf daher
grundsätzlich nie committed, protokolliert oder in Nutzerantworten ausgegeben
werden.

## OAuth-Aktionen

```bash
comvenio action list --json
comvenio action call cai.event.01.list \
  --input '{"range":{"from":"2026-07-24","to":"2026-08-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true}}' \
  --json
```

`action list` liefert nur Actions, die für Grant, Verein, Scopes und aktuelle
RBAC-Capabilities tatsächlich sichtbar sind. Die Action-ID und ihr
Eingabeschema stammen aus dem serverseitigen Capability-Vertrag. Schreibende
Actions erhalten einen Idempotenzschlüssel; kritische Änderungen erfordern
zusätzlich `action confirm` mit der kurzlebigen serverseitigen Vorschau.
`club_id`, Benutzeridentität und Scopes können nicht aus der CLI-Eingabe
überschrieben werden.

## Identität prüfen

```bash
comvenio whoami --json
```

Die JSON-Ausgabe enthält `userId`, `email`, `name`, `clubId`, `environment`, `gatewayBaseUrl` und `stateFile`. Bei einem vorübergehenden Ausfall des Benutzer-Service darf `whoami` gecachte Identitätsfelder anzeigen. `401` und `403` werden jedoch nicht verschluckt.

## Abmelden

```bash
comvenio logout --json
```

Bei OAuth widerruft `logout` den Refresh-Grant serverseitig und entfernt
anschließend Credential-Eintrag und State. Schlägt der Remote-Widerruf
vorübergehend fehl, wird dies als Warnung ausgegeben; die lokale Anmeldung wird
trotzdem entfernt. Ein explizites Device-Token wird nicht serverseitig
widerrufen.

## Club-Informationen

```bash
comvenio club info --json
comvenio club info --club <club-id> --json
```

Die menschenlesbare Ansicht zeigt Name, Kurzname, Adresse, E-Mail, Telefon, Website und Gründungsdatum, soweit vorhanden. Für Agents ist die JSON-Ausgabe maßgeblich.

## Club-Profil und Settings

```bash
comvenio club update --file club-update.json --json
comvenio club settings --json
comvenio club settings-update --file settings-update.json --json
```

`club update` übergibt einen partiellen `ClubUpdate`-Body. Gültige Profilfelder sind unter anderem
`name`, `description`, `address`, `city`, `postal_code`, `country`, `state`, `phone_number`,
`email_address`, `website_url`, `founded_date`, Social-URLs, `default_language`,
`default_timezone` und `responsible_member_id`. `settings-update` verwendet den Deep-Merge-`PUT`
für Bereiche wie `features`, `privacy_settings`, `contact_info`, `seo_settings`,
`notification_settings`, `locale_settings`, `payment_settings`, `custom_settings` und
`letterhead_config`.

## Abteilungen

```bash
comvenio club department-list --json
comvenio club department-list --tree --json
comvenio club department-show <department-id> --json
comvenio club department-add --file department.json --json
comvenio club department-update <department-id> --file department-update.json --json
comvenio club department-delete <department-id> --json
```

Beispiel für `department.json`:

```json
{
  "name": "Dart",
  "description": "Dart-Abteilung",
  "slug": "dart",
  "color_theme_1": "#123456",
  "parent_department_id": null,
  "is_default": false
}
```

Beim Update sind zusätzlich `responsible_member_id` und ein neuer `parent_department_id` erlaubt.
Die Club-ID wird beim Anlegen aus dem aktiven CLI-Kontext genommen und nicht aus der Datei.

## Club-Design

`club design` verändert `design_settings` per Deep-Merge: Nicht angegebene Schlüssel bleiben erhalten.

```bash
comvenio club design \
  --template modern \
  --public-template flex \
  --primary "#123456" \
  --accent "#e7b23c" \
  --font modern \
  --spacing balanced \
  --dry-run --json

comvenio club design --file design-settings.json --json
```

Wichtige Flags:

| Flag | Wirkung |
|---|---|
| `--template <name>` | Club-Hub-Theme |
| `--public-template <id>` | öffentliches Website-Template |
| `--primary`, `--accent`, `--secondary` | Markenfarben als `#RRGGBB` |
| `--font <pair>` | erlaubtes Font-Pair |
| `--spacing <mode>` | Abstandsmodus |
| `--file <json>` | vollständiges partielles `design_settings`-Objekt |
| `--css-file <css>` | scoped Agent-CSS; Server-Sicherheitsgate bleibt maßgeblich |
| `--tokens-file <json>` | Design-Tokens wie Palette, Radius und Typografie |
| `--header-layout`, `--header-surface`, `--header-density` | öffentlicher Header |
| `--header-sticky <true|false>` | Sticky-Verhalten |
| `--clear-header` | eigene Header-Konfiguration entfernen |
| `--dry-run` | Payload anzeigen, nichts schreiben |

Vor jeder Design-Mutation zuerst `--dry-run --json`, anschließend die Homepage-Vorschau und den Homepage-Verifier verwenden. Der vollständige Frontend-Workflow steht in [`homepage.md`](homepage.md).

## Abgrenzung

Homepage-Inhalte bleiben im eigenständigen `homepage`-Command; Mitglieder und Teams haben ebenfalls
eigene Commands. Die aktuelle Workflow-Coverage steht in [`coverage.md`](coverage.md).
