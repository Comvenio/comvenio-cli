---
id: sponsoring
kategorie: thema
domaenen: [sponsor]
stichwoerter: [sponsoring, sponsor, werbepartner, vertrag, zuordnung]
---

# Lokales Sponsoring

## Wozu

Mit dem Sponsoring-Bereich verwaltet ein Verein seine lokalen Sponsoren, deren Angebote (Sponsoring-Produkte), die Zuordnung eines Sponsors zu einem Produkt samt Vertragskonditionen sowie die zugehörigen verantwortlichen Vereinsmitglieder und Vertragsdokumente.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

Anmeldung mit `comvenio login`; welche Scopes eine einzelne Action braucht, zeigt `comvenio action list --json`. Sponsoren, Produkte und Zuordnungen gehören immer zu einem Verein und meist zu einer Abteilung.

## Abläufe

### Die vier Ebenen

Das Sponsoring-Modell besteht aus vier Ebenen: ein **Sponsor** (Werbepartner) mit Logo und verantwortlichen Vereinsmitgliedern wird einem **Sponsoring-Produkt** zugeordnet; die **Zuordnung** trägt Preis, Laufzeit und Status; ein Produkt kann mehrere **Vertragsversionen** mit eigenen Konditionen haben, und jede Zuordnung kann eigene, private Vertragsdokumente tragen.

### Sponsor anlegen

1. Pflichtangaben sind Abteilung, Name und E-Mail-Adresse.
2. Wird beim Anlegen zusätzlich eine Datei angegeben, lädt das CLI sie als öffentliches Sponsorlogo hoch und verknüpft die Datei-ID direkt mit dem Sponsor.
3. Logo, Kontaktperson und weitere Angaben lassen sich danach jederzeit aktualisieren.

### Sponsoring-Produkt anlegen

Ein Produkt beschreibt ein Angebot des Clubs, etwa „Trikotsponsor", „Bandenwerbung" oder ein „Gold-Paket". Preise werden in Cent angegeben; ohne ausdrückliche Angabe gelten beim Anlegen die Währung `EUR`, das Abrechnungsintervall `year` und eine Laufzeit von zwölf Monaten. Ein Produkt kann später als inaktiv markiert werden, ohne bestehende Zuordnungen zu verlieren.

### Vertragsversion eines Produkts

Eine neue Vertragsversion bildet geänderte Konditionen ab, ohne ältere Verträge zu überschreiben — ältere Versionen bleiben als Historie erhalten. Eine neue Version kann eine vorherige ausdrücklich ablösen und deren Gültigkeit begrenzen; eine interne Notiz lässt sich mitspeichern. Vertragsdateien sind immer privat. Zum Ändern oder Löschen einer Version ist neben der Produkt-ID stets die konkrete Versions-ID anzugeben; das Ändern setzt dabei nur die angegebenen Felder und lässt sich in derselben Aktion zusätzlich um eine neue Vertragsdatei ergänzen. Löschen entfernt eine Version per Soft-Delete, andere Versionen bleiben unberührt.

### Sponsor einem Produkt zuordnen

Eine Zuordnung verbindet einen Sponsor mit einem Produkt für einen Zeitraum und optional eine Menge; Preis oder Gesamtpreis können dabei die Produktvorgabe überschreiben. Eine Zuordnung lässt sich später anpassen oder mit einer Notiz und einem Enddatum beenden. Gelöschte Zuordnungen lassen sich auf Wunsch mit anzeigen.

### Vertragsdokument einer Zuordnung hochladen

Unterschriebene Vertragsdokumente werden einer einzelnen Zuordnung zugeordnet, sind privat gespeichert und tragen die Sponsor-ID als Unterkontext.

### Verantwortliche Vereinsmitglieder

Einem Sponsor lassen sich verantwortliche Mitglieder mit einer Rolle zuweisen; eines davon kann als primärer Kontakt markiert werden. Dabei wird ausdrücklich eine Mitglieds-ID erwartet, keine Benutzer-ID.

### Datei-Sichtbarkeit

Logos sind standardmäßig öffentlich, damit Event- und Vereinsseiten sie zeigen können. Produktverträge und unterschriebene Zuordnungsdokumente sind dagegen immer privat. Uploads laufen über den gemeinsamen Datei-Mechanismus, siehe [dateien.md](dateien.md).

### Abgrenzung

Ein globaler Anzeigenmarktplatz oder eine Plattform-Abrechnung gehören bewusst nicht zum lokalen Sponsoring. Die Verwaltung von Sponsoren, Produkten, Vertragsversionen, Zuordnungen und Verantwortlichen ist vollständig über die hier beschriebenen Actions erreichbar.

## Beispiele

```bash
comvenio sponsor add \
  --department-id <department-id> \
  --name "Muster GmbH" \
  --email sponsor@example.org \
  --website https://example.org \
  --contact-person "<contact-person>" \
  --contact-phone "+49 123 456789" \
  --organization-type crafts \
  --file ./logo.png \
  --json

comvenio sponsor list --json
comvenio sponsor list --department-id <department-id> --json
comvenio sponsor show <sponsor-id> --json
comvenio sponsor update <sponsor-id> --contact-person "<contact-person>" --json
comvenio sponsor logo <sponsor-id> --file ./neues-logo.svg --json
comvenio sponsor delete <sponsor-id> --json
```

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

comvenio sponsor product-list --json
comvenio sponsor product-list --include-inactive --json
comvenio sponsor product-update <product-id> --price-cents 175000 --json
comvenio sponsor product-update <product-id> --inactive --json
comvenio sponsor product-delete <product-id> --json
```

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

Optionale Versionsverkettung: `--supersedes-version <id>` benennt die abgelöste Version, `--superseded-valid-until <iso>` begrenzt sie, `--valid-until <iso>` begrenzt die neue Version, `--note <text>` speichert eine interne Notiz.

```bash
comvenio sponsor assign \
  --department-id <department-id> \
  --sponsor <sponsor-id> \
  --product <product-id> \
  --quantity 1 \
  --starts-at 2027-01-01T00:00:00+01:00 \
  --ends-at 2027-12-31T23:59:59+01:00 \
  --json

comvenio sponsor assignment-list --json
comvenio sponsor assignment-list --sponsor <sponsor-id> --status active --json
comvenio sponsor assignment-update <assignment-id> --quantity 2 --json
comvenio sponsor cancel <assignment-id> --note "Vertrag beendet" --ends-at <iso> --json
```

`--include-deleted` erweitert `assignment-list` um gelöschte Zuordnungen.

```bash
comvenio sponsor doc-upload <assignment-id> --file ./unterschrieben.pdf --json
comvenio sponsor doc-list <assignment-id> --json
```

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

## Befehle und Actions

<!-- gen:docs befehle -->

**sponsor** — vollständig

- `comvenio sponsor list`
- `comvenio sponsor show`
- `comvenio sponsor add`
- `comvenio sponsor update`
- `comvenio sponsor delete`
- `comvenio sponsor logo`
- `comvenio sponsor product-list`
- `comvenio sponsor product-add`
- `comvenio sponsor product-update`
- `comvenio sponsor product-delete`
- `comvenio sponsor contract-list`
- `comvenio sponsor contract-add`
- `comvenio sponsor contract-update`
- `comvenio sponsor contract-delete`
- `comvenio sponsor assignment-list`
- `comvenio sponsor assign`
- `comvenio sponsor assignment-update`
- `comvenio sponsor cancel`
- `comvenio sponsor doc-list`
- `comvenio sponsor doc-upload`
- `comvenio sponsor responsible-list`
- `comvenio sponsor responsible-add`
- `comvenio sponsor responsible-update`
- `comvenio sponsor responsible-remove`
- Felder und Werte: `comvenio schema sponsor --json`
<!-- /gen:docs -->

## Fehler

- `VALIDATION_FAILED` — eine Pflichtangabe wie Abteilung, Name oder E-Mail fehlt oder ein Feld hat das falsche Format. Mehr: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — Sponsor, Produkt, Vertragsversion oder Zuordnung existiert nicht oder ist nicht sichtbar. Mehr: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt die Sponsoring-Verwaltung in dieser Abteilung nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Scope für Sponsoring-Aktionen. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — Produkt, Vertragsversion oder Zuordnung wurden inzwischen geändert oder erlauben die Aktion in ihrem aktuellen Zustand nicht. Mehr: `comvenio help fehler CONFLICT`
