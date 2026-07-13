# Lokales Sponsoring – eigenständige CLI-Referenz

Stand: 13. Juli 2026 · Quelle: `src/commands/sponsor.ts`

Das Sponsoring-Modell besteht aus vier Ebenen:

```text
Sponsor (Advertiser)
  ├─ Logo
  ├─ Verantwortliche Vereinsmitglieder
  └─ Zuordnung zu einem Sponsoring-Produkt
       ├─ Preis/Laufzeit/Status
       ├─ Vertragsversionen des Produkts
       └─ private Vertragsdokumente der Zuordnung
```

Lokale Sponsoren, Produkte und Zuordnungen sind immer einem Club und meist einer Abteilung zugeordnet.

## Actions

| Bereich | Actions |
|---|---|
| Sponsor | `list`, `show`, `add`, `update`, `delete`, `logo` |
| Angebot/Produkt | `product-list`, `product-add`, `product-update`, `product-delete` |
| Vertragsversion | `contract-list`, `contract-add`, `contract-update`, `contract-delete` |
| Sponsor-Zuordnung | `assignment-list`, `assign`, `assignment-update`, `cancel` |
| Dokumente | `doc-list`, `doc-upload` |
| Verantwortliche | `responsible-list`, `responsible-add`, `responsible-update`, `responsible-remove` |

## Sponsor anlegen

```bash
comvenio sponsor add \
  --department-id <department-id> \
  --name "Muster GmbH" \
  --email sponsor@example.org \
  --website https://example.org \
  --contact-person "Erika Muster" \
  --contact-phone "+49 123 456789" \
  --organization-type crafts \
  --file ./logo.png \
  --json
```

Pflicht sind `--department-id`, `--name` und `--email`. Wird beim Anlegen `--file` angegeben, lädt das CLI die Datei als öffentliches Sponsorlogo hoch und verknüpft ihre File-ID.

```bash
comvenio sponsor list --json
comvenio sponsor list --department-id <department-id> --json
comvenio sponsor show <sponsor-id> --json
comvenio sponsor update <sponsor-id> --contact-person "Max Muster" --json
comvenio sponsor logo <sponsor-id> --file ./neues-logo.svg --json
comvenio sponsor delete <sponsor-id> --json
```

## Sponsoring-Produkt

Ein Produkt beschreibt ein Club-Angebot wie „Trikotsponsor“, „Bandenwerbung“ oder „Gold-Paket“.

```bash
comvenio sponsor product-add \
  --department-id <department-id> \
  --name "Gold-Paket" \
  --description "Logo auf Website, Plakat und Bande" \
  --conditions "Laufzeit mindestens zwölf Monate" \
  --price-cents 150000 \
  --currency EUR \
  --billing-interval year \
  --duration-months 12 \
  --sort-order 10 \
  --json
```

Preise werden in Cent angegeben. Ohne explizite Werte gelten beim Anlegen `EUR`, `year` und zwölf Monate.

```bash
comvenio sponsor product-list --json
comvenio sponsor product-list --include-inactive --json
comvenio sponsor product-update <product-id> --price-cents 175000 --json
comvenio sponsor product-update <product-id> --inactive --json
comvenio sponsor product-delete <product-id> --json
```

## Vertragsversion eines Produkts

Vertragsversionen bilden neue Konditionen ab, ohne alte Verträge zu überschreiben.

```bash
comvenio sponsor contract-add <product-id> \
  --file ./gold-paket-2027.pdf \
  --label "Konditionen 2027" \
  --valid-from 2027-01-01T00:00:00+01:00 \
  --price-cents 175000 \
  --currency EUR \
  --billing-interval year \
  --duration-months 12 \
  --json

comvenio sponsor contract-list <product-id> --json

comvenio sponsor contract-update <product-id> \
  --contract-version <version-id> \
  --price-cents 185000 \
  --valid-until 2027-12-31T23:59:59+01:00 \
  --json

comvenio sponsor contract-delete <product-id> --contract-version <version-id> --json
```

Optionale Versionsverkettung:

- `--supersedes-version <id>` benennt die abgelöste Version.
- `--superseded-valid-until <iso>` begrenzt die alte Version.
- `--valid-until <iso>` begrenzt die neue Version.
- `--note <text>` speichert eine interne Notiz.

Vertragsdateien sind privat.

`contract-update` ändert nur die angegebenen Felder. Mit `--file` lädt das CLI zuerst eine neue
private Vertragsdatei hoch und setzt deren `contract_file_id` in derselben Mutation.
`contract-delete` entfernt die Version per Soft-Delete; andere historische Versionen bleiben
erhalten. Beide Actions benötigen neben der Product-ID explizit
`--contract-version <version-id>`.

## Sponsor einem Produkt zuordnen

```bash
comvenio sponsor assign \
  --department-id <department-id> \
  --sponsor <sponsor-id> \
  --product <product-id> \
  --quantity 1 \
  --starts-at 2027-01-01T00:00:00+01:00 \
  --ends-at 2027-12-31T23:59:59+01:00 \
  --json
```

Optional können `--price-cents` oder `--total-price-cents` die Produktvorgabe überschreiben.

```bash
comvenio sponsor assignment-list --json
comvenio sponsor assignment-list --sponsor <sponsor-id> --status active --json
comvenio sponsor assignment-update <assignment-id> --quantity 2 --json
comvenio sponsor cancel <assignment-id> --note "Vertrag beendet" --ends-at <iso> --json
```

`--include-deleted` erweitert die Liste um gelöschte Zuordnungen.

## Vertragsdokument einer Zuordnung

```bash
comvenio sponsor doc-upload <assignment-id> --file ./unterschrieben.pdf --json
comvenio sponsor doc-list <assignment-id> --json
```

Zuordnungsdokumente werden privat mit `context_type=sponsorship_assignment` gespeichert. Die Sponsor-ID wird als Unterkontext verwendet.

## Verantwortliche Vereinsmitglieder

```bash
comvenio sponsor responsible-add <sponsor-id> \
  --department-id <department-id> \
  --member <member-id> \
  --role responsible \
  --primary \
  --json

comvenio sponsor responsible-list --sponsor <sponsor-id> --json
comvenio sponsor responsible-update <responsible-assignment-id> --role contact --json
comvenio sponsor responsible-remove <responsible-assignment-id> --json
```

`--member` erwartet eine Member-ID, nicht eine User-ID.

## Datei-Sichtbarkeit

- Logos sind standardmäßig öffentlich, damit Event- und Clubseiten sie anzeigen können.
- Produktverträge und unterschriebene Zuordnungsdokumente sind privat.
- Uploads laufen über den gemeinsamen DataShare-Mechanismus; Details stehen in [`dateien.md`](dateien.md).

## Scope-Grenze

Globaler Anzeigenmarktplatz und Plattform-Abrechnung sind bewusst kein lokales Club-Sponsoring.
Die lokale Sponsor-, Produkt-, Vertragsversions-, Zuordnungs- und Verantwortlichenverwaltung ist
vollständig über die oben dokumentierten Actions erreichbar.
