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

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen, zeigt `comvenio action list --json`. Sponsoren, Produkte und Zuordnungen gehören immer zu einem Verein und zu einer Abteilung (`department_id`).

## Abläufe

### Die vier Ebenen

Das Sponsoring-Modell besteht aus vier Ebenen: ein **Sponsor** (Werbepartner) mit Logo und verantwortlichen Vereinsmitgliedern wird einem **Sponsoring-Produkt** zugeordnet; die **Zuordnung** trägt Preis, Laufzeit und Status; ein Produkt kann mehrere **Vertragsversionen** mit eigenen Konditionen haben, und jede Zuordnung kann eigene, private Vertragsdokumente tragen.

### Sponsor anlegen (`cai.sponsor.03.add`)

Pflichtangaben sind Abteilung (`department_id`), Name und E-Mail-Adresse. Ein Logo wird nicht beim Anlegen übergeben, sondern danach separat gesetzt: erst die Datei hochladen (siehe [dateien.md](dateien.md)), dann deren Datei-ID mit `cai.sponsor.06.logo` verknüpfen — das Setzen des Logos ist `critical_write`. Kontaktperson und weitere Angaben lassen sich mit `cai.sponsor.04.update` (`operation: update`) jederzeit aktualisieren; ein Wechsel der Abteilung läuft über `operation: move_department` und ist `critical_write`.

### Sponsoring-Produkt anlegen (`cai.sponsor.08.product_add`)

Ein Produkt beschreibt ein Angebot des Clubs, etwa „Trikotsponsor", „Bandenwerbung" oder ein „Gold-Paket", und gehört ebenfalls zu einer Abteilung (`department_id`). Preise werden in Cent angegeben; ohne ausdrückliche Angabe gelten beim Anlegen die Währung `EUR`, das Abrechnungsintervall `year` und eine Laufzeit von zwölf Monaten. Ein Produkt kann später über `cai.sponsor.09.product_update` (`operation: update`, Feld `is_active`) als inaktiv markiert werden, ohne bestehende Zuordnungen zu verlieren; eine andere Abteilung läuft wieder über `operation: move_department` (`critical_write`).

### Vertragsversion eines Produkts

Eine neue Vertragsversion (`cai.sponsor.12.contract_add`) bildet geänderte Konditionen ab, ohne ältere Verträge zu überschreiben — ältere Versionen bleiben als Historie erhalten. Die Vertragsdatei wird zuerst hochgeladen (siehe [dateien.md](dateien.md)); ihre Datei-ID ist als `contract_file_id` Pflicht. Eine neue Version kann eine vorherige ausdrücklich ablösen und deren Gültigkeit begrenzen; eine interne Notiz lässt sich mitspeichern. Zum Ändern (`cai.sponsor.13.contract_update`, `operation: update`) oder Austauschen der Datei (`operation: replace_file`) ist neben der Produkt-ID stets die konkrete Versions-ID anzugeben. Löschen (`cai.sponsor.14.contract_delete`) entfernt eine Version per Soft-Delete und ist `critical_write`; andere Versionen bleiben unberührt.

### Sponsor einem Produkt zuordnen (`cai.sponsor.16.assign`)

Eine Zuordnung verbindet einen Sponsor mit einem Produkt für einen Zeitraum und optional eine Menge; Preis oder Gesamtpreis können dabei die Produktvorgabe überschreiben. Das Anlegen ist `critical_write`: der Aufruf liefert zunächst nur eine Vorschau mit `preview_id` und `confirmation_token`, erst `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>` führt die Zuordnung aus. Eine Zuordnung lässt sich später über `cai.sponsor.17.assignment_update` anpassen oder mit `cai.sponsor.18.cancel` mit einer Notiz und einem Enddatum beenden — beides ebenfalls `critical_write`. `cai.sponsor.15.assignment_list` zeigt gelöschte Zuordnungen auf Wunsch mit an.

### Vertragsdokument einer Zuordnung hochladen (`cai.sponsor.20.doc_upload`)

Unterschriebene Vertragsdokumente werden mit einer einzelnen Zuordnung als Datei-Übertragung (`asset`: `source_file_id`, `filename`, `content_type`, `expected_size`) direkt übergeben, sind privat gespeichert und tragen ein Label. `cai.sponsor.19.doc_list` listet die Dokumente einer Zuordnung.

### Verantwortliche Vereinsmitglieder

Einem Sponsor lassen sich mit `cai.sponsor.22.responsible_add` (Abteilung, Sponsor, Mitglieds-ID, Rolle, `is_primary`) verantwortliche Mitglieder zuweisen; eines davon kann als primärer Kontakt markiert werden. Dabei wird ausdrücklich eine Mitglieds-ID erwartet, keine Benutzer-ID. `cai.sponsor.23.responsible_update` ändert eine Zuweisung, `cai.sponsor.24.responsible_remove` entfernt sie (`critical_write`); `cai.sponsor.21.responsible_list` listet nach Sponsor oder Mitglied gefiltert.

### Datei-Sichtbarkeit

Logos sind standardmäßig öffentlich, damit Event- und Vereinsseiten sie zeigen können. Produktverträge und unterschriebene Zuordnungsdokumente sind dagegen immer privat. Uploads laufen über den gemeinsamen Datei-Mechanismus, siehe [dateien.md](dateien.md).

### Abgrenzung

Ein globaler Anzeigenmarktplatz oder eine Plattform-Abrechnung gehören bewusst nicht zum lokalen Sponsoring. Die Verwaltung von Sponsoren, Produkten, Vertragsversionen, Zuordnungen und Verantwortlichen ist vollständig über die hier beschriebenen Actions erreichbar.

## Beispiele

```bash
comvenio action call cai.sponsor.03.add --input '{
  "department_id": "<department-id>",
  "company_name": "Muster GmbH",
  "contact_email": "sponsor@example.org",
  "website_url": "https://example.org",
  "contact_person": "<contact-person>",
  "contact_phone": "+49 123 456789",
  "organization_type": "crafts"
}'

comvenio action call cai.sponsor.01.list --input '{"limit":50}'
comvenio action call cai.sponsor.02.show --input '{"sponsor_id":"<sponsor-id>"}'
comvenio action call cai.sponsor.04.update --input '{"operation":"update","sponsor_id":"<sponsor-id>","changes":{"contact_person":"<contact-person>"}}'
comvenio action call cai.sponsor.06.logo --input '{"sponsor_id":"<sponsor-id>","logo_file_id":"<file-id>"}'
comvenio action call cai.sponsor.05.delete --input '{"sponsor_id":"<sponsor-id>"}'
```

```bash
comvenio action call cai.sponsor.08.product_add --input '{
  "department_id": "<department-id>",
  "name": "Gold-Paket",
  "description": "Logo auf Website, Plakat und Bande",
  "conditions": "Laufzeit mindestens zwölf Monate",
  "default_unit_price_cents": 150000,
  "currency": "EUR",
  "billing_interval": "year",
  "default_duration_months": 12,
  "sort_order": 10
}'

comvenio action call cai.sponsor.07.product_list --input '{"include_inactive":false,"limit":50}'
comvenio action call cai.sponsor.09.product_update --input '{"operation":"update","product_id":"<product-id>","changes":{"default_unit_price_cents":175000}}'
comvenio action call cai.sponsor.09.product_update --input '{"operation":"update","product_id":"<product-id>","changes":{"is_active":false}}'
comvenio action call cai.sponsor.10.product_delete --input '{"product_id":"<product-id>"}'
```

```bash
comvenio action call cai.sponsor.12.contract_add --input '{
  "product_id": "<product-id>",
  "contract_file_id": "<file-id>",
  "label": "Konditionen 2027",
  "valid_from": "2027-01-01T00:00:00+01:00",
  "unit_price_cents": 175000,
  "currency": "EUR",
  "billing_interval": "year",
  "duration_months": 12
}'

comvenio action call cai.sponsor.11.contract_list --input '{"product_id":"<product-id>","limit":50}'

comvenio action call cai.sponsor.13.contract_update --input '{
  "operation": "update",
  "product_id": "<product-id>",
  "contract_version_id": "<version-id>",
  "changes": { "unit_price_cents": 185000, "valid_until": "2027-12-31T23:59:59+01:00" }
}'

comvenio action call cai.sponsor.14.contract_delete --input '{"product_id":"<product-id>","contract_version_id":"<version-id>"}'
```

Optionale Versionsverkettung in `contract_add`: `supersedes_version_id` benennt die abgelöste Version, `superseded_valid_until` begrenzt sie, `valid_until` begrenzt die neue Version, `note` speichert eine interne Notiz.

```bash
comvenio action call cai.sponsor.16.assign --input '{
  "department_id": "<department-id>",
  "sponsor_id": "<sponsor-id>",
  "product_id": "<product-id>",
  "quantity": 1,
  "starts_at": "2027-01-01T00:00:00+01:00",
  "ends_at": "2027-12-31T23:59:59+01:00"
}'
# Antwort liefert preview_id, confirmation_token, Ziel, Ist-Stand, Unterschied und Risiko
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>

comvenio action call cai.sponsor.15.assignment_list --input '{"sponsor_id":"<sponsor-id>","status":"active","include_deleted":false,"limit":50}'
comvenio action call cai.sponsor.17.assignment_update --input '{"assignment_id":"<assignment-id>","changes":{"quantity":2}}'
comvenio action call cai.sponsor.18.cancel --input '{"assignment_id":"<assignment-id>","cancellation_note":"Vertrag beendet","ends_at":"2027-06-30T23:59:59+02:00"}'
```

`assignment_update` und `cancel` sind ebenfalls `critical_write` und laufen über dieselbe Vorschau-/Bestätigungsfolge.

```bash
comvenio action call cai.sponsor.20.doc_upload --input '{
  "assignment_id": "<assignment-id>",
  "asset": {
    "source_file_id": "<file-id>",
    "filename": "unterschrieben.pdf",
    "content_type": "application/pdf",
    "expected_size": 512000
  },
  "label": "Unterschriebener Vertrag"
}'

comvenio action call cai.sponsor.19.doc_list --input '{"assignment_id":"<assignment-id>","limit":50}'
```

```bash
comvenio action call cai.sponsor.22.responsible_add --input '{
  "department_id": "<department-id>",
  "sponsor_id": "<sponsor-id>",
  "member_id": "<member-id>",
  "role": "responsible",
  "is_primary": true
}'

comvenio action call cai.sponsor.21.responsible_list --input '{"sponsor_id":"<sponsor-id>","limit":50}'
comvenio action call cai.sponsor.23.responsible_update --input '{"responsible_id":"<responsible-assignment-id>","changes":{"role":"contact"}}'
comvenio action call cai.sponsor.24.responsible_remove --input '{"responsible_id":"<responsible-assignment-id>"}'
```

## Befehle und Actions

<!-- gen:docs befehle -->

**sponsor**

- `cai.sponsor.01.list` — list (lesen)
- `cai.sponsor.02.show` — show (lesen)
- `cai.sponsor.03.add` — add (ändern)
- `cai.sponsor.04.update` — update, move_department (ändern mit Bestätigung)
- `cai.sponsor.05.delete` — delete (ändern mit Bestätigung)
- `cai.sponsor.06.logo` — set (ändern mit Bestätigung)
- `cai.sponsor.07.product_list` — list (lesen)
- `cai.sponsor.08.product_add` — add (ändern)
- `cai.sponsor.09.product_update` — update, move_department (ändern, ändern mit Bestätigung)
- `cai.sponsor.10.product_delete` — delete (ändern mit Bestätigung)
- `cai.sponsor.11.contract_list` — list (lesen)
- `cai.sponsor.12.contract_add` — add (ändern)
- `cai.sponsor.13.contract_update` — update, replace_file (ändern)
- `cai.sponsor.14.contract_delete` — delete (ändern mit Bestätigung)
- `cai.sponsor.15.assignment_list` — list (lesen)
- `cai.sponsor.16.assign` — assign (ändern mit Bestätigung)
- `cai.sponsor.17.assignment_update` — update (ändern mit Bestätigung)
- `cai.sponsor.18.cancel` — cancel (ändern mit Bestätigung)
- `cai.sponsor.19.doc_list` — list (lesen)
- `cai.sponsor.20.doc_upload` — upload (ändern)
- `cai.sponsor.21.responsible_list` — list (lesen)
- `cai.sponsor.22.responsible_add` — add (ändern)
- `cai.sponsor.23.responsible_update` — update (ändern)
- `cai.sponsor.24.responsible_remove` — remove (ändern mit Bestätigung)
- Felder und Werte: `comvenio schema sponsor --json`
<!-- /gen:docs -->

## Fehler

- `VALIDATION_FAILED` — eine Pflichtangabe wie Abteilung, Name oder E-Mail fehlt oder ein Feld hat das falsche Format. Mehr: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — Sponsor, Produkt, Vertragsversion oder Zuordnung existiert nicht oder ist nicht sichtbar. Mehr: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt die Sponsoring-Verwaltung in dieser Abteilung nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Scope für Sponsoring-Aktionen. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — Produkt, Vertragsversion oder Zuordnung wurden inzwischen geändert oder erlauben die Aktion in ihrem aktuellen Zustand nicht. Mehr: `comvenio help fehler CONFLICT`
- `OUTCOME_UNKNOWN` — bei einer ändernden Action (etwa `assign`, `cancel` oder `delete`) blieb die Serverantwort aus; vor einer Wiederholung mit einer lesenden Action prüfen, ob die Änderung schon angekommen ist. Mehr: `comvenio help fehler OUTCOME_UNKNOWN`
