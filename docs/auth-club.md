# Authentifizierung und Club-Kontext

Stand: 13. Juli 2026 · Quellen: `src/index.ts`, `src/auth.ts`, `src/commands/whoami.ts`, `src/commands/club.ts`

## Login

```bash
comvenio login --token cvn_xxxxxxxx --json
comvenio login --token cvn_xxxxxxxx --club <club-id> --json
```

Das Token ist opak, muss mit `cvn_` beginnen und wird vor dem Speichern gegen die aktuelle Benutzeridentität geprüft. Das CLI dekodiert es nicht. Erfolgreicher Login speichert Token, Gateway, Umgebung, Benutzer und Club-Kontext in `~/.comvenio-cli-state.json`.

Optionen:

| Flag | Bedeutung |
|---|---|
| `--token <token>` | Pflicht; opakes Device-Token |
| `--env prod|dev|local` | Betriebsziel, Standard `prod` |
| `--gateway <url>` | Gateway-Basis explizit überschreiben |
| `--club <id>` | Club-Kontext explizit setzen statt `main_club_id` |
| `--json` | maschinenlesbare Ausgabe |

Das State-File enthält ein Geheimnis. Niemals committen, protokollieren oder in Nutzerantworten ausgeben.

## Identität prüfen

```bash
comvenio whoami --json
```

Die JSON-Ausgabe enthält `userId`, `email`, `name`, `clubId`, `environment`, `gatewayBaseUrl` und `stateFile`. Bei einem vorübergehenden Ausfall des Benutzer-Service darf `whoami` gecachte Identitätsfelder anzeigen. `401` und `403` werden jedoch nicht verschluckt.

## Abmelden

```bash
comvenio logout --json
```

`logout` entfernt nur das lokale State-File. Der Befehl widerruft das Device-Token nicht serverseitig.

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
