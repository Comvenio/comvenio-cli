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

Anmeldung per `comvenio login`; welche Scopes ein einzelner Befehl braucht, zeigt
`comvenio action list --json`. Für Agenten ist `--json` die verbindliche Ausgabeform.

- `--club <club-id>` überschreibt den Verein aus dem lokalen Anmeldestatus.

> **Nicht verwechseln:** `comvenio booking` ist die Raumbuchung, `comvenio sponsor` der lokale
> Sponsor. Mit der Buchhaltung hat beides nichts zu tun.

## Abläufe

### Jahresplan führen

1. Pläne ansehen: `comvenio finance plan-list`.
2. Einzelnen Plan ansehen: `comvenio finance plan-show --year <jahr>`.
3. Plan anlegen: `comvenio finance plan-create --year <jahr> --capital <cent> --notes "<Text>"`.
4. Plan ändern: `comvenio finance plan-update --year <jahr> --capital <cent>`.
5. Jahr abschließen: `comvenio finance plan-close --year <jahr>`; bei offenen Posten zusätzlich
   `--force`. Danach weist der Dienst Änderungen an Positionen und Buchungen ab — auch das
   Stornieren einer automatischen Buchung.
6. Abgeschlossenes Jahr wieder öffnen: `comvenio finance plan-reopen --year <jahr> --reason "<Begründung>"`.
   `--reason` ist Pflicht (mindestens 3 Zeichen).
7. Plan in ein neues Jahr kopieren: `comvenio finance plan-copy <quelljahr> --year <zieljahr>`.
   Wiederkehrende Posten werden von selbst übernommen; einmalige nur mit
   `--include-non-recurring` oder über eine Auswahl in `--positions`. Posten, deren Veranstaltung
   es im Zieljahr nicht gibt, meldet die Antwort unter `unlinked_positions` — die bleiben zu
   verknüpfen.

`--year <jahr>` ist Pflicht bei allen `plan-*`, bei `position-list`/`position-create` und bei
`summary` — es gibt keinen Vorgabewert. `[id]` bezeichnet je nach Aktion die Positions- oder
Buchungs-ID, bei `plan-copy` das Quelljahr.

### Budgetposten führen

1. Posten ansehen: `comvenio finance position-list --year <jahr>`, wahlweise gefiltert mit
   `--department <department-id>`.
2. Posten anlegen: `comvenio finance position-create --year <jahr> --name <Name> --category <Kategorie> --expense <cent>`.
3. Einzelnen Posten ansehen: `comvenio finance position-show <position-id>`.
4. Posten ändern: `comvenio finance position-update <position-id> --expense <cent>`.
5. Posten löschen: `comvenio finance position-delete <position-id>`.
6. Einkaufsschätzung als Planwert übernehmen: `comvenio finance position-import-shopping <position-id>`;
   ohne `--overwrite` bleibt ein bereits gesetzter Planwert stehen, die Antwort sagt unter
   `applied` und `reason`, ob übernommen wurde.

Für seltenere Felder (`position_number`, `context_type`, `context_id`, `parent_position_id`,
`recurring`, Vorjahreswerte) eine JSON-Datei angeben: `--file <payload.json>`; einzelne Optionen
überschreiben dabei einzelne Felder aus der Datei.

### Zusammenfassung ansehen

1. Je Plan: `comvenio finance summary --year <jahr>`.
2. Je Abteilung (eigener Endpunkt, kein Filter): `comvenio finance summary --year <jahr> --department <department-id>`.

### Buchungen führen

1. Buchungen eines Postens ansehen: `comvenio finance entry-list <position-id>`, wahlweise
   gefiltert mit `--source-type <quelle>` (von Hand erfasst, aus dem Einkauf, aus dem Sponsoring).
2. Buchung anlegen: `comvenio finance entry-create <position-id> --description "<Text>" --expense <cent> --date <datum>`
   oder mit `--revenue <cent>` statt `--expense`. Eine Buchung ist Einnahme oder Ausgabe — nie
   beides, nie keines, und der Betrag ist größer als null; das wird vor dem Netzaufruf geprüft.
3. Einzelne Buchung ansehen: `comvenio finance entry-show <entry-id>`.
4. Buchung ändern: `comvenio finance entry-update <entry-id> --expense <cent>`.
5. Buchung freigeben: `comvenio finance entry-approve <entry-id>`, wahlweise mit `--notes "<Text>"`.
6. Buchung löschen: `comvenio finance entry-delete <entry-id>`.

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

## Befehle und Actions

<!-- gen:docs befehle -->

**finance** — Kern vorhanden, einzelne Abläufe fehlen

- `comvenio finance plan list|show|create|update|close|reopen|copy`
- `comvenio finance position list|create|show|update|delete|import-shopping`
- `comvenio finance summary (je Plan und je Abteilung)`
- `comvenio finance entry list|create|show|update|delete|approve`
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
