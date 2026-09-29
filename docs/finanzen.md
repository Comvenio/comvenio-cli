---
id: finanzen
kategorie: thema
domaenen: [finance]
stichwoerter: [finanzen, buchhaltung, jahresplan, budgetposten, buchung, cent]
---

# Vereins-Buchhaltung

## Wozu

Die Finanzbefehle decken die Vereins-Buchhaltung ab: den Jahresplan, die Budgetposten darunter und
die Buchungen an den Posten — damit Ausgaben und Einnahmen eines Vereinsjahres geplant, gebucht
und ausgewertet werden können.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie
brauchen, zeigt `comvenio action list --json`. Für Agenten ist `--json` die verbindliche
Ausgabeform.

- Der Verein kommt aus der Anmeldung; `--club <club-id>` dient nur der Kontrolle und bricht ab,
  wenn er nicht der Verein der Anmeldung ist.

> **Nicht verwechseln:** `cai.booking.*` ist die Raumbuchung, `cai.sponsor.*` der lokale
> Sponsor. Mit der Buchhaltung hat beides nichts zu tun.

## Abläufe

### Jahresplan führen

1. Pläne ansehen: `comvenio finance plan-list` (Action: `cai.finance.01.plan_list`).
2. Einzelnen Plan ansehen: `comvenio finance plan-show --year <jahr>` (Action:
   `cai.finance.02.plan_show`).
3. Plan anlegen: `comvenio finance plan-create --year <jahr> --capital <cent> --notes "<Text>"`
   (Action: `cai.finance.03.plan_create`).
4. Plan ändern: `comvenio finance plan-update --year <jahr> --capital <cent>` (Action:
   `cai.finance.04.plan_update`).
5. Jahr abschließen: `comvenio finance plan-close --year <jahr>` (Action:
   `cai.finance.05.plan_close`); bei offenen Posten zusätzlich `--force`. Danach weist der Dienst
   Änderungen an Positionen und Buchungen ab — auch das Stornieren einer automatischen Buchung.
6. Abgeschlossenes Jahr wieder öffnen: `comvenio finance plan-reopen --year <jahr> --reason
   "<Begründung>"`. `--reason` ist Pflicht (mindestens 3 Zeichen); für diesen Schritt gibt es noch
   keine Action.
7. Plan in ein neues Jahr kopieren: `comvenio finance plan-copy <quelljahr> --year <zieljahr>`
   (Action: `cai.finance.07.plan_copy`). Wiederkehrende Posten werden von selbst übernommen;
   einmalige nur mit `--include-non-recurring` oder über eine Auswahl in `--positions`. Posten,
   deren Veranstaltung es im Zieljahr nicht gibt, meldet die Antwort unter `unlinked_positions` —
   die bleiben zu verknüpfen.

`--year <jahr>` ist Pflicht bei allen `plan-*`, bei `position-list`/`position-create` und bei
`summary` — es gibt keinen Vorgabewert. `[id]` bezeichnet je nach Aktion die Positions- oder
Buchungs-ID, bei `plan-copy` das Quelljahr.

### Budgetposten führen

1. Posten ansehen: `comvenio finance position-list --year <jahr>`, wahlweise gefiltert mit
   `--department <department-id>` (Action: `cai.finance.08.position_list`).
2. Posten anlegen: `comvenio finance position-create --year <jahr> --name <Name> --category
   <Kategorie> --expense <cent>` (Action: `cai.finance.09.position_create`).
3. Einzelnen Posten ansehen: `comvenio finance position-show <position-id>` (Action:
   `cai.finance.10.position_show`).
4. Posten ändern: `comvenio finance position-update <position-id> --expense <cent>` (Action:
   `cai.finance.11.position_update`).
5. Posten löschen: `comvenio finance position-delete <position-id>` (Action:
   `cai.finance.12.position_delete`).
6. Einkaufsschätzung als Planwert übernehmen: `comvenio finance position-import-shopping
   <position-id>` (Action: `cai.finance.13.position_import_shopping`); ohne `--overwrite` bleibt
   ein bereits gesetzter Planwert stehen, die Antwort sagt unter `applied` und `reason`, ob
   übernommen wurde.

Für seltenere Felder (`position_number`, `context_type`, `context_id`, `parent_position_id`,
`recurring`, Vorjahreswerte) eine JSON-Datei angeben: `--file <payload.json>`; einzelne Optionen
überschreiben dabei einzelne Felder aus der Datei.

### Zusammenfassung ansehen

1. Je Plan: `comvenio finance summary --year <jahr>` (Action: `cai.finance.14.summary`,
   Teilaktion `total`).
2. Je Abteilung (eigener Endpunkt, kein Filter): `comvenio finance summary --year <jahr>
   --department <department-id>` (Teilaktion `by_department`).

### Buchungen führen

1. Buchungen eines Postens ansehen: `comvenio finance entry-list <position-id>`, wahlweise
   gefiltert mit `--source-type <quelle>` (von Hand erfasst, aus dem Einkauf, aus dem Sponsoring)
   (Action: `cai.finance.15.entry_list`).
2. Buchung anlegen: `comvenio finance entry-create <position-id> --description "<Text>" --expense
   <cent> --date <datum>` oder mit `--revenue <cent>` statt `--expense` (Action:
   `cai.finance.16.entry_create`). Eine Buchung ist Einnahme oder Ausgabe — nie beides, nie
   keines, und der Betrag ist größer als null; das wird vor dem Netzaufruf geprüft.
3. Einzelne Buchung ansehen: `comvenio finance entry-show <entry-id>` (Action:
   `cai.finance.17.entry_show`).
4. Buchung ändern: `comvenio finance entry-update <entry-id> --expense <cent>` (Action:
   `cai.finance.18.entry_update`).
5. Buchung freigeben: `comvenio finance entry-approve <entry-id>`, wahlweise mit `--notes
   "<Text>"` (Action: `cai.finance.20.entry_approve`).
6. Buchung löschen: `comvenio finance entry-delete <entry-id>` (Action:
   `cai.finance.19.entry_delete`).

**Beträge sind Cent, immer ganze Zahlen.** 45,50 € sind `4550`. Wer `45.50` schreibt, meint Euro —
die CLI lehnt das ab, statt klaglos eine Buchung über 45 Cent anzulegen.

### Was hier (noch) nicht geht

| Bereich | Lage |
|---|---|
| Dashboard, Kassenbericht, Steuerbericht | vorhanden, folgt hier später |
| Event-Finanzen, Einkaufs-Brücke, Sponsoring-Deal | lesend vorhanden, folgt hier später |
| Investitionsplanung, Förderquellen, Szenarien | vorhanden, hier bewusst nicht vorgesehen |
| Stripe: Connect, Rechnungen, Auszahlungen, Abos | vorhanden, hier bewusst nicht vorgesehen |
| Beiträge, Spenden, Vereinsrechnungen, Kontenrahmen | noch nicht umgesetzt — es gibt dort nichts zu bedienen |

## Beispiele

```bash
comvenio finance plan-create --year 2026 --capital 500000 --notes "Haushalt 2026"
comvenio finance plan-close --year 2026 --force --notes "Jahresabschluss"
comvenio finance plan-reopen --year 2026 --reason "Nachtragsbuchung Hallenmiete"
comvenio finance plan-copy 2025 --year 2026 --include-non-recurring
comvenio finance position-create --year 2026 --name Sommerfest --category Feste --expense 120000
comvenio finance entry-create <position-id> --description "Getränke" --expense 4550 --date 2026-07-01
comvenio finance entry-approve <entry-id> --notes "Beleg liegt vor"
comvenio finance summary --year 2026 --department <department-id>
```

## Begriffe und Zusammenhänge

- **Jahresplan** — der Haushalt eines Vereinsjahres, angesprochen über `--year <jahr>`. Er trägt
  das verfügbare Kapital (`--capital`) und alle Budgetposten des Jahres. Ein Plan ist offen oder
  abgeschlossen; abgeschlossen nimmt er keine Änderungen an Posten und Buchungen mehr an.
- **Budgetposten** (Position) — eine geplante Einnahme oder Ausgabe innerhalb eines Jahresplans,
  etwa „Sommerfest“ in der Kategorie „Feste“. Der Planwert steht am Posten; was tatsächlich
  geflossen ist, zeigen die Buchungen daran.
- **Buchung** (Eintrag) — ein tatsächlicher Geldfluss an genau einem Budgetposten: Einnahme oder
  Ausgabe, nie beides. Eine Buchung hängt immer an einem Posten, nie direkt am Jahresplan.
- **Freigabe** — die Bestätigung einer Buchung durch eine berechtigte Person
  (`entry-approve`). Freigegebene Buchungen gelten als geprüft; Korrekturen laufen danach über
  einen Storno statt über eine stille Änderung.
- **Abteilung** (`department_id`) — ordnet Posten und Zusammenfassungen einem Teil des Vereins
  zu, etwa der Fußballabteilung. Ohne Abteilung gilt der Posten für den Gesamtverein;
  `summary --department` wertet nur diese Abteilung aus.
- **Cent-Beträge** — jeder Betrag ist eine ganze Zahl in Cent: `4550` sind 45,50 €. Kapital,
  Planwerte und Buchungen verwenden dieselbe Einheit.
- **Wiederkehrender Posten** — ein Posten, den `plan-copy` in das nächste Jahr von selbst
  übernimmt; einmalige Posten nur auf Wunsch.

Zusammenhang: Jahresplan → Budgetposten → Buchungen. Die Zusammenfassung (`summary`) fasst die
Posten eines Jahres zusammen, für den ganzen Plan oder je Abteilung.

## Häufige Fragen

**Hat die Raumbuchung (`cai.booking`) etwas mit der Buchhaltung zu tun?**
Nein. `cai.booking.*` reserviert Räume und Objekte; eine Buchung in der Buchhaltung ist ein
Geldfluss an einem Budgetposten und läuft über `comvenio finance entry-*`.

**Ist ein Sponsor (`cai.sponsor`) dasselbe wie eine Einnahme-Buchung?**
Nein. `cai.sponsor.*` pflegt die Sponsoren des Vereins. Geld eines Sponsors erscheint in der
Buchhaltung erst als Buchung an einem Posten — erkennbar an der Quelle Sponsoring
(`entry-list --source-type`).

**Warum lässt sich ein abgeschlossenes Jahr nicht mehr ändern?**
Der Abschluss (`plan-close`) friert Posten und Buchungen des Jahres ein, damit der Stand, über den
berichtet wurde, nicht nachträglich wandert. Jede Änderung endet mit `CONFLICT`. Für eine
Nachtragsbuchung das Jahr mit `plan-reopen --year <jahr> --reason "<Begründung>"` wieder öffnen;
die Begründung bleibt nachvollziehbar.

**Warum lehnt die CLI `45.50` ab?**
Beträge sind Cent. `45.50` sieht nach Euro aus; statt stillschweigend 45 Cent zu buchen, bricht die
CLI mit `VALIDATION_FAILED` ab. Richtig ist `4550`.

**Warum muss ich bei jedem Befehl `--year` angeben?**
Ein Verein führt mehrere Jahrespläne nebeneinander, und es gibt keinen Vorgabewert — so landet
eine Buchung nie versehentlich im falschen Jahr.

## Befehle und Actions

<!-- gen:docs befehle -->

**finance**

- `cai.finance.01.plan_list` — list (lesen) · Scopes: `finance.read`
- `cai.finance.02.plan_show` — show (lesen) · Scopes: `finance.read`
- `cai.finance.03.plan_create` — create (ändern) · Scopes: `finance.write`
- `cai.finance.04.plan_update` — update (ändern) · Scopes: `finance.write`
- `cai.finance.05.plan_close` — close (ändern mit Bestätigung) · Scopes: `finance.write`
- `cai.finance.07.plan_copy` — copy (ändern mit Bestätigung) · Scopes: `finance.write`
- `cai.finance.08.position_list` — list (lesen) · Scopes: `finance.read`
- `cai.finance.09.position_create` — create (ändern) · Scopes: `finance.write`
- `cai.finance.10.position_show` — show (lesen) · Scopes: `finance.read`
- `cai.finance.11.position_update` — update (ändern) · Scopes: `finance.write`
- `cai.finance.12.position_delete` — delete (ändern mit Bestätigung) · Scopes: `finance.write`
- `cai.finance.13.position_import_shopping` — import (ändern) · Scopes: `finance.write`
- `cai.finance.14.summary` — total, by_department (lesen) · Scopes: `finance.read`
- `cai.finance.15.entry_list` — list (lesen) · Scopes: `finance.read`
- `cai.finance.16.entry_create` — create (ändern) · Scopes: `finance.write`
- `cai.finance.17.entry_show` — show (lesen) · Scopes: `finance.read`
- `cai.finance.18.entry_update` — update (ändern mit Bestätigung) · Scopes: `finance.write`
- `cai.finance.19.entry_delete` — delete (ändern mit Bestätigung) · Scopes: `finance.write`
- `cai.finance.20.entry_approve` — approve (ändern mit Bestätigung) · Scopes: `finance.write`
- `cai.finance.21.plan_period` — list, create, show, update, positions, position_create, summary, journal, entries_without_receipt, sphere_report, audit_check, audit_labels, audit_label_set, dashboard (lesen, ändern) · Scopes: `finance.read`, `finance.write`
- `cai.finance.22.plan_lifecycle` — close, next_period (ändern mit Bestätigung) · Scopes: `finance.write`
- `cai.finance.23.settings` — show, update (lesen, ändern) · Scopes: `finance.read`, `finance.write`
- `cai.finance.24.money_account` — list, create, update, opening, opening_versions, cash_book, reconciliation, grants, grant_set, grant_revoke, transfers, transfer_show, transfer_create, transfer_reverse, booking_accounts (lesen, ändern, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.25.entry_correction` — entry_create, entry_create_unplanned, reverse, receipt, versions, receipt_scan_create, receipt_candidates, receipt_attach, receipt_book, receipt_reject, receipt_event_set, receipt_withdraw, receipt_file, position_link_set, position_link_remove, tax_sphere, objection_create, objections, objection_withdraw (ändern, ändern mit Bestätigung, lesen) · Scopes: `finance.write`, `finance.read`
- `cai.finance.26.cash_report` — list, create, show, submit, reject, entries, approve_entries, approve, tax_report (lesen, ändern, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.27.department_transfer` — list, account_choices, show, create, confirm, reject, withdraw, reverse (lesen, ändern, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.28.plan_result` — result, open_items, open_item_create, open_item_update, open_item_delete, resolutions, resolution_create, resolution_update, resolution_delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.29.procedure_doc` — show, version, save (lesen, ändern) · Scopes: `finance.read`, `finance.write`
- `cai.finance.30.audit_export` — list, create, download (lesen, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.31.finance_views` — receipt_inbox, receipt_scan, event, event_reconciliation, series_comparison, department_history, link_options, event_links, event_link_view, location_links, analysis_ranking, analysis_target, object (lesen) · Scopes: `finance.read`
- `cai.finance.32.investment_plan` — list, create, show, update, delete, dashboard, feasibility, funding_summary, loan_details (lesen, ändern, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.33.investment_item` — list, create, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.34.investment_funding` — list, create, update, delete, loan_show, loan_create, loan_update (lesen, ändern, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.35.investment_scenario` — list, create, from_template, show, update, delete, auto_generate, cashflow_list, cashflow_create, cashflow_update, cashflow_delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.36.budget_organigram` — tree, frame_set, frame_versions, statement, rubrics, rubric_create, rubric_update, rubric_delete, position_split (lesen, ändern mit Bestätigung, ändern) · Scopes: `finance.read`, `finance.write`
- `cai.finance.37.budget_season` — seasons, season_tree, season_frame_set, season_frame_versions, frame_proposal (lesen, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
- `cai.finance.38.entry_detail` — entry, open_items (lesen) · Scopes: `finance.read`
- `cai.finance.39.budget_period` — show, set, tree, frame_set, frame_versions, statement, window_position_create, window_position_update (lesen, ändern mit Bestätigung) · Scopes: `finance.read`, `finance.write`
<!-- /gen:docs -->

## Fehler

- `CONFLICT` — das Jahr ist abgeschlossen; Änderungen an Positionen und Buchungen weist der Dienst
  ab, bis es wieder geöffnet ist. Mehr: `comvenio help fehler CONFLICT`.
- `VALIDATION_FAILED` — ein Betrag ist nicht in Cent, eine Buchung ist weder Einnahme noch Ausgabe
  oder beides, oder ein Pflichtfeld fehlt. Mehr: `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — Plan, Posten oder Buchung sind unter der angegebenen Kennung nicht bekannt. Mehr:
  `comvenio help fehler NOT_FOUND`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt die Buchhaltungsaktion nicht. Mehr:
  `comvenio help fehler PERMISSION_DENIED`.

Ein Backend-Fehler ist kein leeres Ergebnis: Die CLI gibt ihn mit Exit-Code ungleich null zurück.
