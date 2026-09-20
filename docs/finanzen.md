# Vereins-Buchhaltung

Die Finance-CLI deckt die Vereins-Buchhaltung des `finance-service` ab: den Jahresplan, die Budgetposten darunter und die Buchungen an den Posten.

```bash
comvenio finance <action> [id] [optionen]
```

Für Agenten ist `--json` die verbindliche Ausgabeform.

> **Nicht verwechseln:** `comvenio booking` ist die Raumbuchung des `object-service`, `comvenio sponsor` der lokale Sponsor. Mit der Buchhaltung hat beides nichts zu tun.

## Grundregeln

- `--club <id>` überschreibt den Club aus dem lokalen Login-State.
- `--year <jahr>` ist Pflicht bei allen `plan-*`, bei `position-list`/`position-create` und bei `summary`. Der Plan ist das Jahr — es gibt keinen Vorgabewert.
- `[id]` bezeichnet je nach Aktion die Positions- oder Buchungs-ID; bei `plan-copy` das **Quelljahr**.
- **Beträge sind Cent, immer ganze Zahlen.** 45,50 € sind `4550`. Wer `45.50` schreibt, meint Euro — die CLI lehnt das ab, statt klaglos eine Buchung über 45 Cent anzulegen.
- `--file <payload.json>` ist die Grundlage, einzelne Optionen überschreiben einzelne Felder daraus. Für den Alltag braucht es keine Datei.
- Ein HTTP-Fehler ist kein leeres Ergebnis. Die CLI gibt Backend-Fehler mit Exit-Code ungleich null zurück.

## Jahresplan

```bash
comvenio finance plan-list
comvenio finance plan-show   --year 2026
comvenio finance plan-create --year 2026 --capital 500000 --notes "Haushalt 2026"
comvenio finance plan-update --year 2026 --capital 550000
comvenio finance plan-close  --year 2026
comvenio finance plan-reopen --year 2026
comvenio finance plan-copy 2025 --year 2026     # Quelle als Argument, Ziel in --year
```

`plan-close` schliesst das Jahr ab. Danach weisen Änderungen an Positionen und Buchungen der Dienst mit `409` ab — auch das Stornieren einer Auto-Buchung (RTS-Bug `d5327bb5`). `plan-reopen` macht es rückgängig.

## Budgetposten

```bash
comvenio finance position-list   --year 2026
comvenio finance position-list   --year 2026 --department DEPARTMENT_UUID
comvenio finance position-create --year 2026 --name Sommerfest --category Feste --expense 120000
comvenio finance position-show   POSITION_UUID
comvenio finance position-update POSITION_UUID --expense 135000
comvenio finance position-delete POSITION_UUID
comvenio finance position-import-shopping POSITION_UUID
```

`position-import-shopping` übernimmt die Einkaufsschätzung aus dem `supply-service` als Planwert.

Für die selteneren Felder — `position_number`, `context_type`, `context_id`, `parent_position_id`, `recurring`, die Vorjahreswerte — eine JSON-Datei nehmen:

```bash
comvenio finance position-create --year 2026 --file posten.json
```

## Zusammenfassung

```bash
comvenio finance summary --year 2026
comvenio finance summary --year 2026 --department DEPARTMENT_UUID
```

Mit `--department` ist es ein **anderer Endpunkt**, kein Filter: Der Dienst rechnet die Summe je Abteilung.

## Buchungen

```bash
comvenio finance entry-list   POSITION_UUID
comvenio finance entry-list   POSITION_UUID --source-type supply
comvenio finance entry-create POSITION_UUID --description "Getränke" --expense 4550 --date 2026-07-01
comvenio finance entry-create POSITION_UUID --description "Standgebühr" --revenue 25000 --date 2026-07-02
comvenio finance entry-show   ENTRY_UUID
comvenio finance entry-update ENTRY_UUID --expense 4990
comvenio finance entry-approve ENTRY_UUID
comvenio finance entry-delete ENTRY_UUID
```

**Eine Buchung ist Einnahme oder Ausgabe — nie beides, nie keines, und der Betrag ist grösser als null.** Die CLI prüft das vor dem Netz, damit ein Tippfehler einen Satz ergibt statt eines `422` aus dem Dienst.

`--source-type` filtert nach Herkunft: von Hand erfasst, aus dem Einkauf, aus dem Sponsoring.

## Was diese CLI (noch) nicht kann

| Bereich | Lage |
|---|---|
| Dashboard, Kassenbericht, Steuerbericht | im Dienst vorhanden, CLI folgt in Welle 2 |
| Event-Finanzen, Supply-Brücke, Sponsoring-Deal | im Dienst vorhanden (lesend), CLI folgt in Welle 3 |
| Investitionsplanung, Förderquellen, Szenarien | im Dienst vorhanden, kein CLI |
| Stripe: Connect, Rechnungen, Auszahlungen, Abos | im Dienst vorhanden, kein CLI |
| Beiträge, Spenden, Vereinsrechnungen, Kontenrahmen | **im Dienst nur Platzhalter** (`HTTP 501`) — es gibt dort nichts zu bedienen |
| `/internal/supply-poll`, `/internal/sync-sponsoring` | Dienst-zu-Dienst, kein Bedienweg für Menschen |

> **Zur Vorgeschichte.** Bis zum 2026-09-20 gab es diesen Befehl nicht — das CLI kannte den `finance-service` überhaupt nicht, obwohl das Gateway ihn längst routete und die Vereins-Buchhaltung seit dem 2026-09-03 voll implementiert war. Verdeckt hat das die eigene Abdeckungsdatei: Sie führte finance als Backend-Lücke mit `HTTP 501`, was bei ihrer Entstehung stimmte. Wer daraufhin nicht nachsieht, findet auch nichts.
