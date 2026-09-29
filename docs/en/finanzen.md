---
id: finanzen
kategorie: thema
domaenen: [finance]
stichwoerter: [finance, accounting, annual plan, budget position, entry, cents]
---

# Club accounting

## Purpose

The finance commands cover the club's accounting: the annual plan, the budget positions under it
and the entries booked against those positions — so a club's income and expenses for a year can be
planned, recorded and reported on.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club has enabled and which scopes they need is
shown by `comvenio action list --json`. For agents, `--json` is the binding output form.

- The club comes from the sign-in; `--club <club-id>` is only a check and stops when it is not
  the club of the sign-in.

> **Not to be confused with:** `cai.booking.*` is room booking, `cai.sponsor.*` is the local
> sponsor. Neither has anything to do with accounting.

## Workflows

### Managing the annual plan

1. List plans: `comvenio finance plan-list` (action: `cai.finance.01.plan_list`).
2. View a single plan: `comvenio finance plan-show --year <year>` (action:
   `cai.finance.02.plan_show`).
3. Create a plan: `comvenio finance plan-create --year <year> --capital <cents> --notes "<text>"`
   (action: `cai.finance.03.plan_create`).
4. Update a plan: `comvenio finance plan-update --year <year> --capital <cents>` (action:
   `cai.finance.04.plan_update`).
5. Close a year: `comvenio finance plan-close --year <year>` (action:
   `cai.finance.05.plan_close`); add `--force` for open positions. After that, the service rejects
   changes to positions and entries — including reversing an automatic entry.
6. Reopen a closed year: `comvenio finance plan-reopen --year <year> --reason "<reason>"`.
   `--reason` is required (at least 3 characters); this step has no action yet.
7. Copy a plan into a new year: `comvenio finance plan-copy <source-year> --year <target-year>`
   (action: `cai.finance.07.plan_copy`). Recurring positions are carried over automatically;
   one-off ones only with `--include-non-recurring` or via a selection in `--positions`. Positions
   whose event does not exist in the target year are reported under `unlinked_positions` — those
   still need linking.

`--year <year>` is required for every `plan-*` command, for `position-list`/`position-create` and
for `summary` — there is no default. `[id]` means the position or entry ID depending on the
action, and for `plan-copy` it is the **source year**.

### Managing budget positions

1. List positions: `comvenio finance position-list --year <year>`, optionally filtered with
   `--department <department-id>` (action: `cai.finance.08.position_list`).
2. Create a position: `comvenio finance position-create --year <year> --name <name> --category
   <category> --expense <cents>` (action: `cai.finance.09.position_create`).
3. View a single position: `comvenio finance position-show <position-id>` (action:
   `cai.finance.10.position_show`).
4. Update a position: `comvenio finance position-update <position-id> --expense <cents>` (action:
   `cai.finance.11.position_update`).
5. Delete a position: `comvenio finance position-delete <position-id>` (action:
   `cai.finance.12.position_delete`).
6. Adopt the purchasing estimate as the planned value: `comvenio finance position-import-shopping
   <position-id>` (action: `cai.finance.13.position_import_shopping`); without `--overwrite` an
   already set planned value stays as is, and the response states under `applied` and `reason`
   whether it was adopted.

For the rarer fields (`position_number`, `context_type`, `context_id`, `parent_position_id`,
`recurring`, prior-year values), use a JSON file: `--file <payload.json>`; individual options
override individual fields from the file.

### Viewing the summary

1. Per plan: `comvenio finance summary --year <year>` (action: `cai.finance.14.summary`,
   sub-operation `total`).
2. Per department (a different endpoint, not a filter): `comvenio finance summary --year <year>
   --department <department-id>` (sub-operation `by_department`).

### Managing entries

1. List a position's entries: `comvenio finance entry-list <position-id>`, optionally filtered
   with `--source-type <source>` (entered by hand, from purchasing, from sponsoring) (action:
   `cai.finance.15.entry_list`).
2. Create an entry: `comvenio finance entry-create <position-id> --description "<text>" --expense
   <cents> --date <date>` or `--revenue <cents>` instead of `--expense` (action:
   `cai.finance.16.entry_create`). An entry is income or expense — never both, never neither, and
   the amount is greater than zero; this is checked before the network call.
3. View a single entry: `comvenio finance entry-show <entry-id>` (action:
   `cai.finance.17.entry_show`).
4. Update an entry: `comvenio finance entry-update <entry-id> --expense <cents>` (action:
   `cai.finance.18.entry_update`).
5. Approve an entry: `comvenio finance entry-approve <entry-id>`, optionally with `--notes
   "<text>"` (action: `cai.finance.20.entry_approve`).
6. Delete an entry: `comvenio finance entry-delete <entry-id>` (action:
   `cai.finance.19.entry_delete`).

**Amounts are cents, always whole numbers.** €45.50 is `4550`. Writing `45.50` means euros — the
CLI rejects that instead of silently creating a 45-cent entry.

### What this does not (yet) cover

| Area | Status |
|---|---|
| Dashboard, cash report, tax report | exists, coming here later |
| Event finances, purchasing bridge, sponsoring deal | exists read-only, coming here later |
| Investment planning, funding sources, scenarios | exists, intentionally not planned here |
| Stripe: Connect, invoices, payouts, subscriptions | exists, intentionally not planned here |
| Membership fees, donations, club invoices, chart of accounts | not implemented yet — there is nothing to operate there |

## Examples

```bash
comvenio finance plan-create --year 2026 --capital 500000 --notes "2026 budget"
comvenio finance plan-close --year 2026 --force --notes "Year-end close"
comvenio finance plan-reopen --year 2026 --reason "Supplementary entry for hall rent"
comvenio finance plan-copy 2025 --year 2026 --include-non-recurring
comvenio finance position-create --year 2026 --name "Summer party" --category Events --expense 120000
comvenio finance entry-create <position-id> --description "Beverages" --expense 4550 --date 2026-07-01
comvenio finance entry-approve <entry-id> --notes "Receipt on file"
comvenio finance summary --year 2026 --department <department-id>
```

## Concepts and how they connect

- **Annual plan** — the budget of one club year, addressed with `--year <year>`. It carries the
  available capital (`--capital`) and all budget items of that year. A plan is open or closed;
  once closed it no longer accepts changes to items or entries.
- **Budget item** (position) — a planned income or expense within an annual plan, such as
  "Summer party" in the category "Festivities". The planned value sits on the item; what actually
  moved is shown by the entries on it.
- **Entry** (booking) — an actual money movement on exactly one budget item: income or expense,
  never both. An entry always hangs on an item, never directly on the annual plan.
- **Approval** — confirmation of an entry by an authorised person (`entry-approve`). Approved
  entries count as checked; corrections afterwards go through a reversal rather than a silent
  edit.
- **Department** (`department_id`) — assigns items and summaries to one part of the club, such as
  the football department. Without a department an item belongs to the whole club;
  `summary --department` evaluates only that department.
- **Amounts in cents** — every amount is a whole number of cents: `4550` is €45.50. Capital,
  planned values and entries all use the same unit.
- **Recurring item** — an item that `plan-copy` carries into the next year on its own; one-off
  items only on request.

How they connect: annual plan → budget items → entries. The summary (`summary`) totals the items
of one year, for the whole plan or per department.

## Frequently asked questions

**Does room booking (`cai.booking`) have anything to do with bookkeeping?**
No. `cai.booking.*` reserves rooms and objects; an entry in bookkeeping is a money movement on a
budget item and goes through `comvenio finance entry-*`.

**Is a sponsor (`cai.sponsor`) the same as an income entry?**
No. `cai.sponsor.*` maintains the club's sponsors. A sponsor's money only appears in bookkeeping as
an entry on an item — recognisable by the source sponsoring (`entry-list --source-type`).

**Why can a closed year no longer be changed?**
Closing (`plan-close`) freezes the items and entries of that year so the figures that were reported
do not shift afterwards. Every change ends with `CONFLICT`. For a late entry, reopen the year with
`plan-reopen --year <year> --reason "<reason>"`; the reason stays on record.

**Why does the CLI reject `45.50`?**
Amounts are cents. `45.50` looks like euros; rather than silently booking 45 cents, the CLI stops
with `VALIDATION_FAILED`. The correct value is `4550`.

**Why do I have to pass `--year` on every command?**
A club keeps several annual plans side by side and there is no default — so an entry never lands in
the wrong year by accident.

## How it works in the web app

<!-- gen:docs web-app -->

The descriptions below come from the German interface specifications and quote the labels as the web app shows them.

### Bereich als Sicht — Knoten im eigenen Zeitraum, Zeitraum der Abteilung, Buchen mit Budget, Kontofreigabe und Journal mit Budget

Menu path: Web-App → Bereich als Sicht — Knoten im eigenen Zeitraum, Zeitraum der Abteilung, Buchen mit Budget, Kontofreigabe und Journal mit Budget (open item — add the menu path manually)

Purpose: Wie steht eine Abteilung in ihrem eigenen Zeitraum — und worauf lief jede Buchung?

- Klick auf „<Fenster des Zeitraums>“ oder „Haushaltsjahr <Jahr>“ im Kopf → Die Ansicht wechselt zwischen dem Fenster des Zeitraums und dem Haushaltsjahr; vorgewählt ist das laufende Fenster des Zeitraums.
- Auswahl eines anderen Fensters im Feld „Zeitraum“ neben dem Umschalter → Die Ansicht zeigt das gewählte Fenster (z. B. App-Jahr 2025/26).
- Klick auf „Posten“ im Kopf der Sicht → Der Dialog für einen Posten im Fenster öffnet sich.
- Klick auf „Posten speichern“ im Dialog → Je berührtem Haushalt entsteht ein Teil mit dem Monatsanteil; neu oder beim Bearbeiten werden alle Teile gemeinsam geändert (D49).
- Klick auf „Rahmen setzen“ bzw. „Rahmen ändern“ im Kopf der Sicht → Der Rahmen-Dialog des Fensters öffnet sich (Anatomie wie der Saisonrahmen-Dialog). (leads to: Dialog Rahmen des Fensters)
- Klick auf „Rahmen speichern“ im Rahmen-Dialog des Fensters → Der Rahmen des Knotens im Fenster wird gesetzt, als neue Version.
- Klick auf „Abrechnung“ im Kopf der Sicht → Die Abrechnung des Knotens im Fenster öffnet sich (Anatomie C3 der Organigramm-Spezifikation, dazu Ergebnis und Rahmenvorschlag). (leads to: Abrechnung des Fensters)
- Klick auf „Weitere Aktionen“ › „Zeitraum der Abteilung“ → Der Zeitraum-Dialog öffnet sich.
- Klick auf „Zeitraum speichern“ im Zeitraum-Dialog → Der Zeitraum der Abteilung wird gesetzt und gilt für ihre Unterknoten.
- Klick auf „Erneut laden“ im Zustand error → Der Sichtbaum wird erneut abgefragt.
- Klick auf „Organigramm“ in der Brotkrume → Das Organigramm erscheint wieder. (leads to: zurück (Organigramm))
- Klick auf „Buchen“ im Dialog → Die Buchung entsteht im Haushalt auf dem gewählten Posten; bei „ungeplant“ auf dem Posten „Ungeplant · <Rubrik>“, der bei Bedarf entsteht.
- Klick auf „Knoten freigeben“, Wahl des Knotens und „Freigeben“ → Der Knoten und sein Teilbaum dürfen ab jetzt auf dieses Konto buchen.
- Klick auf „Zurücknehmen“ an einer Freigabe und Bestätigen in der Zeile → Der Knoten darf ab jetzt nicht mehr auf dieses Konto buchen; bestehende Buchungen bleiben.
- Wahl von „ungeplant“ im Filter des Journals → Das Journal zeigt nur Buchungen auf Posten „Ungeplant“.
- Klick auf die Budget-Angabe einer Zeile → Die Section Budgetplanung öffnet den Knoten der Buchung in seiner Sicht (Zeitraum oder Haushalt).

### Bereichsbudget

Menu path: Finance Hub → Reiter Bereichsbudget direkt nach Buchhaltung

Purpose: Wie steht der Bereich im Zeitraum, was bleibt am Ende, wer trägt was, und was wurde beschlossen?

- Auswahl von Tag und Monat „Finanzjahr beginnt am“ → setzt den Beginn des Finanzjahrs des Vereins
- Auswahl von Tag und Monat „Saisonjahr beginnt am“ → setzt den Beginn des Saisonjahrs des Vereins
- Klick auf „Speichern“ → speichert Beginn von Finanz- und Saisonjahr für den Verein
- Klick auf „Abbrechen“ oder Schließen → verwirft die Änderungen

### Buchhaltungs-Tab — Event-Verknüpfung

Menu path: Finance Hub → Buchhaltung → Drill-Down bis zur Position oder zum Festival-Elternposten

Purpose: Zu welchem Event gehört dieser Posten, stimmt das, und wie bringe ich es in Ordnung?

- Klick auf „Zur Position“ an einer Positionszeile des Streifens → öffnet genau diese Position im Jahr ihres Plans — eine Leaf-Position mit ihrer Leaf-Ansicht, einen Elternposten mit seiner Teilposten-Tabelle; gesammelte Planwert-Änderungen werden vorher gesendet
- Klick auf „Erneut prüfen“ → fragt die Konfliktliste noch einmal an
- Klick auf „Erneut laden“ neben „Event: Name nicht abrufbar“ → fragt die Eventauswahl des Vereins noch einmal an
- Klick auf „Aus Einkaufsliste übernehmen“ → öffnet den bestehenden Einkaufslisten-Dialog (Vereins-Buchhaltung 09 §4.5)
- Klick auf „Verknüpfen“ (seit 04 für alle vier Arten) → öffnet die Auswahl von Event und Rolle für eine EVENT-Position oder einen EVENT-Elternposten ohne Event
- Klick auf „Verknüpfung ändern“ → öffnet die Auswahl mit dem aktuellen Event und der aktuellen Rolle, um umzuhängen oder die Rolle zu wechseln
- Klick auf „Verknüpfung lösen“ → fragt vor dem Lösen der Verknüpfung nach; der Klick selbst ändert nichts
- Klick auf „Zur Hauptposition (Plan <Jahr>)“ → öffnet die Hauptposition desselben Events im Jahr ihres Plans; gesammelte Planwert-Änderungen werden vorher gesendet
- Eingabe und Auswahl im Feld „Event“ (Suche über den Titel) → bestimmt das Event, mit dem die Position verknüpft werden soll
- Auswahl „Hauptposition“ oder „Vorverkauf“ → legt fest, ob die Position der Posten des Eventjahrs ist oder der Vorverkauf im Plan davor
- Klick auf „Verknüpfen“ bzw. „Speichern“, im abgeschlossenen Plan „Bestätigen und verknüpfen“ bzw. „Bestätigen und speichern“ → verknüpft die Position mit dem gewählten Event in der gewählten Rolle oder hängt sie um; im abgeschlossenen Plan mit ausdrücklicher Bestätigung
- Klick auf „Abbrechen“ oder Schließen des Dialogs → verwirft die Auswahl
- Klick auf „Verknüpfung lösen“, im abgeschlossenen Plan „Bestätigen und lösen“ → löst die Verknüpfung; die Position bleibt ein Event-Posten ohne Event mit Rolle Hauptposition, keine Zahl ändert sich
- Klick auf „Abbrechen“ oder Schließen des Dialogs → bricht das Lösen ab

### Buchungen eines Kontos — prüfungssicher

Menu path: Finance-Hub → Buchhaltung → Konto (Leaf-Ansicht aus A2)

Purpose: Was ist auf diesem Konto gebucht, ist es fertig und belegt — und wie korrigiere ich es richtig?

- Klick auf „Freigeben“ unter dem Stand einer offenen Buchung → Die Buchung wird von einer zweiten Person freigegeben und damit festgeschrieben.
- Klick auf „Stornieren“ im Zeilenmenü → Der Storno-Dialog öffnet sich; es wird nichts gesendet.
- Klick auf „Versionen“ im Zeilenmenü → Der Versionen-Dialog öffnet sich und lädt das Protokoll.
- Klick auf „Beleg nachreichen“ unter „fehlt“ oder im Zeilenmenü → Der Beleg-Dialog öffnet sich; es wird nichts gesendet.
- Klick auf „Neu laden“ in der Meldung des Zustands error → Die Buchungen der Position werden erneut abgerufen; geschrieben wird nichts.
- Klick auf „Zur Jahresübersicht“ im Kopf des Kontos oder im Satz des Zustands not_found → Die Jahresübersicht der Buchhaltung wird gezeigt; gesammelte Planwertänderungen werden vorher gesendet wie bei jedem Ebenenwechsel. (leads to: zurück (zur Jahresübersicht der Buchhaltung))
- Klick auf „Buchen“ → Der Beleg wird hochgeladen, dann entsteht eine manuelle Buchung mit Nummer, Geldkonto und Beleg oder Eigenbeleg.
- Klick auf „Sphäre ändern“ → Der Sphären-Dialog öffnet sich; es wird nichts gesendet.
- Klick auf „Stornieren“ im Dialog → Es entsteht eine Gegenbuchung mit umgekehrter Richtung auf demselben Konto und Geldkonto; die Buchung selbst bleibt unverändert.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird gesendet. (leads to: zurück (zum Konto))
- Klick auf „Neu laden“ im Dialog → Das Protokoll wird erneut abgerufen.
- Klick auf „Schließen“ oder Escape → Der Dialog schließt. (leads to: zurück (zum Konto))
- Klick auf „Beleg anhängen“ → Die Datei wird in den Kontext finance_receipt des Plans hochgeladen und abgeschlossen, dann an die Buchung gehängt; die Buchung selbst ändert sich nicht.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird angehängt. (leads to: zurück (zum Konto oder zum Prüferpaket))
- Klick auf „Sphäre ändern“ im Dialog → Die Position bekommt die gewählte Sphäre; keine Zahl ändert sich.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird gesendet. (leads to: zurück (zum Konto))

### Buchung im Detail

Menu path: Web-App → Buchung im Detail (open item — add the menu path manually)

Purpose: Was ist mit dieser Buchung — und was ist jetzt zu tun?

- Klick auf die Journalnummer oder die Beschreibung einer Buchung in einer Liste der Buchhaltung (Kassenbericht, Kontenblatt, offene Punkte, Buchungen eines Knotens); nicht im Kontenblatt des Bereichsbudgets → Die Buchhaltung zeigt die Detailansicht dieser Buchung; die Liste bleibt als Rückweg gemerkt. (leads to: Detailansicht (diese Spezifikation))
- Klick auf „Zurück“ im Kopf der Detailansicht → Die Liste, aus der die Detailansicht geöffnet wurde, steht wieder da. (leads to: vorige Liste)
- Klick auf „Korrigieren“ in der Detailansicht → Der Korrektur-Dialog öffnet mit den Werten der Buchung.
- Klick auf „Korrektur speichern“ → Die Buchung wird geändert (PATCH mit nur den geänderten Feldern und dem Grund); eine offene Beanstandung wird CORRECTED; der Verlauf zeigt die neue Version.
- Klick auf „Abbrechen“ oder Escape im Korrektur-Dialog → Der Dialog schließt, nichts wird gesendet.
- Klick auf „Stornieren“ bzw. „Stornieren und neu buchen“ → Die Buchung wird storniert (Gegenbuchung); eine offene Beanstandung wird REVERSED; auf Wunsch öffnet der Buchungsdialog mit vorbelegten Werten, der Posten ist wählbar.
- Klick auf „Übertrag stornieren“ → Der Dialog „Übertrag stornieren“ („Sektion Prüfung“) öffnet sich; stornieren nimmt beide Buchungen des Vorgangs zurück.
- Klick auf „Beleg nachreichen“ → Der Beleg hängt an der Buchung; eine offene Beanstandung wird CORRECTED.
- Klick auf „Beanstanden“ → Die Buchung trägt eine offene Beanstandung; Freigabe und Abschluss warten auf ihre Erledigung.
- Klick auf „Beanstandung zurückziehen“ → Die Beanstandung wird WITHDRAWN und bleibt im Verlauf.
- Klick auf „Freigeben“ → Die Buchung ist freigegeben (zweite Person).
- Klick auf „Zum Event“ → Der Event-Hub öffnet dieses Event (Shortcut-System zwischen Hubs). (leads to: Event-Hub (Bestand))
- Klick auf „Korrigieren“ in der Zeile einer eigenen beanstandeten Buchung im Kassenbericht → Die Detailansicht der Buchung öffnet. Erlaubt allowed_actions.correct, öffnet der Korrektur-Dialog gleich mit; sonst ist „Stornieren und neu buchen“ hervorgehoben. (leads to: Detailansicht (diese Spezifikation))

### Budget im Organigramm

Menu path: Web-App → Budget im Organigramm (open item — add the menu path manually)

Purpose: Wie steht jeder Knoten des Organigramms im Rahmen — und wo muss nachgesteuert werden?

- Auswahl im Feld „Plan“ → Das Organigramm zeigt den gewählten Vereinsplan; vorgewählt ist der Plan, dessen Zeitraum heute enthält.
- Klick auf den Pfeil vor einem Knoten mit Unterknoten → Die Unterknoten werden ein- oder ausgeblendet; Abteilungen mit Recht starten aufgeklappt.
- Klick auf den Namen eines Knotens → Die Knotenansicht mit Rahmen, Teilrahmen und Posten des Knotens öffnet sich.
- Klick auf „Abrechnung“ → Die Abrechnung des Knotens mit Rahmenverlauf, Soll und Ist je Rubrik und je Unterknoten öffnet sich.
- Klick auf „Erneut laden“ in der Störung des Organigramms → Das Organigramm wird erneut vom Finanzdienst abgerufen.
- Klick auf „Rahmen ändern“ bzw. „Rahmen setzen“ am Kopf → Der Dialog für den Rahmen des Knotens öffnet sich.
- Klick auf „Teilrahmen“ im Kopf → Der Dialog zum Verteilen der Teilrahmen auf alle Unterknoten öffnet sich.
- Klick auf „Rubriken“ → Der Rubrikenkatalog der Abteilung öffnet sich.
- Klick auf „Posten“ → Der Posten-Dialog öffnet sich leer mit dem Knoten vorbelegt.
- „Bearbeiten“ im Menü ⋮ eines Postens → Der Posten-Dialog öffnet sich vorbelegt.
- „Aufteilen“ im Menü ⋮ eines Postens → Der Aufteilen-Dialog öffnet sich mit den bestehenden Unterposten.
- „Löschen“ im Menü ⋮ eines Postens → Der Posten wird mit seinen Unterposten aus dem Plan entfernt (weich gelöscht, 01 §4.5).
- Klick auf „Organigramm“ in der Brotkrume → Das Organigramm des Plans erscheint wieder. (leads to: zurück (Organigramm))
- Klick auf „Erneut laden“ in der Störung der Knotenansicht → Die Knotenansicht wird erneut vom Finanzdienst abgerufen.
- Klick auf „Zurück“ in der Brotkrume der Abrechnung → Die Ansicht vor der Abrechnung erscheint wieder. (leads to: zurück)
- Klick auf „Erneut laden“ in der Störung der Abrechnung → Die Abrechnung wird erneut vom Finanzdienst abgerufen.
- Klick auf „Stand ablegen“ rechts in der Brotkrume der Abrechnung → Der Dialog „Stand ablegen“ öffnet sich mit vorbelegter Bezeichnung.
- Klick auf „Löschen“ an einem Stand oder in der Meldung zur fehlenden Datei → Der Stand wird gelöscht und seine Datei weich entfernt.
- Klick auf „Erneut laden“ in der Störung der Stände → Die Liste der Stände wird erneut abgerufen.
- Klick auf „Erneut ablegen“ → Legt die bereits hochgeladene Datei ab, ohne sie ein zweites Mal hochzuladen.
- Klick auf „Abbrechen“ oder Schließen des Dialogs → Schließt den Dialog; ist eine hochgeladene Datei nicht abgelegt, wird sie weich gelöscht.
- Klick auf „Nachtrag speichern“ (aktiver Plan) oder „Rahmen speichern“ (Entwurf) → Der Rahmen des Knotens wird gesetzt; im aktiven Plan als Nachtrag mit Grund festgehalten.
- Klick auf „Abbrechen“ oder Escape im Rahmen-Dialog → Der Dialog schließt, nichts wird gesendet.
- Klick auf „Teilrahmen speichern“ → Für jeden geänderten Unterknoten wird der Rahmen gesetzt; im aktiven Plan als Nachtrag mit demselben Grund.
- Klick auf „Abbrechen“ oder Escape im Teilrahmen-Dialog → Der Dialog schließt, nichts wird gesendet.
- Klick auf „Speichern“ im Posten-Dialog → Der Posten wird im Vereinsplan beim gewählten Knoten mit Rubrik angelegt oder geändert.
- Klick auf „Abbrechen“ oder Escape im Posten-Dialog → Der Dialog schließt, nichts wird gesendet.
- Klick auf „Abbrechen“ oder Escape im Aufteilen-Dialog → Der Dialog schließt, nichts wird gesendet.
- Klick auf „Rubrik“ mit Namenseingabe → Die Rubrik wird dem Katalog der Abteilung hinzugefügt.
- Klick auf eine eigene Rubrik, Namen ändern, Enter → Die Rubrik heißt neu; alle Posten mit dieser Rubrik tragen den neuen Namen.
- Klick auf das Löschsymbol einer eigenen Rubrik → Die Rubrik wird aus dem Katalog entfernt.
- Klick auf „Fertig“ oder Escape im Rubriken-Dialog → Der Dialog schließt.

### Saison in der Budgetplanung

Menu path: Web-App → Saison in der Budgetplanung (open item — add the menu path manually)

Purpose: Wie steht jeder Knoten in seiner Saison — über die Haushaltsjahre hinweg, die sie berührt?

- Klick auf „Haushalt“ oder „Saison“ im Umschalter → Die Section zeigt den Haushaltsplan (Bestand) oder die Saison; bei Saison ersetzt die Saisonwahl die Planwahl.
- Auswahl im Feld „Saison“ → Kopf und Organigramm zeigen die gewählte Saison; vorgewählt ist die Saison, die heute enthält, sonst die jüngste.
- Klick auf einen berührten Haushalt oder „Posten im Haushalt <Label>“ im Saisonkopf eines Knotens → Die Section wechselt in die Sicht Haushalt mit diesem Plan und, aus dem Saisonkopf, diesem Knoten.
- Klick auf „Saisonrahmen setzen“ am Saisonkopf oder in einer Kindzeile → Der Saisonrahmen-Dialog öffnet für diesen Knoten.
- Klick auf „Saisonrahmen speichern“ → Der Saisonrahmen des Knotens wird gesetzt und als Version festgehalten.
- Klick auf „Abbrechen“ oder Escape im Saisonrahmen-Dialog → Der Dialog schließt, nichts wird gesendet.
- Klick auf „Vorschlag übernehmen“ im Rahmen-Dialog des Haushalts → Das Betragsfeld des Rahmen-Dialogs zeigt den Vorschlag; gespeichert wird erst mit „Rahmen speichern“ bzw. „Nachtrag speichern“.

### Offene Punkte und Struktur

Menu path: Web-App → Offene Punkte und Struktur (open item — add the menu path manually)

Purpose: Was ist in der Buchhaltung offen, und wie verteilt sich das Geld über den Verein?

- Klick auf die Karte oder „Offene Punkte ansehen“ → Die Buchhaltung öffnet mit der Ansicht „Offene Punkte“. (leads to: Buchhaltung, Ansicht Offene Punkte)
- Klick auf „Übersicht“, „Struktur“ oder „Offene Punkte“ im Kopf der Buchhaltung → Die Buchhaltung zeigt die gewählte Ansicht; Übersicht ist der Bestand.
- Klick auf eine Zeile der offenen Punkte → Eine Buchung öffnet ihre Detailansicht, ein Kassenbericht seine Ansicht in der Buchhaltung. (leads to: Buchung im Detail („Buchung im Detail“) oder Kassenbericht (Bestand))
- Klick auf „Bestätigen“ an einem Punkt „Umbuchung zu bestätigen“ → Die Umbuchung ist bestätigt und gebucht; der Punkt verschwindet.
- Klick auf „Ablehnen“ an einem Punkt „Umbuchung zu bestätigen“ → Die Umbuchung ist abgelehnt; nichts wird gebucht; der Punkt verschwindet.
- Klick auf einen Knoten in der Struktur → Unter dem Organigramm stehen die Buchungen des Teilbaums dieses Knotens.

### Sektion Prüfung

Menu path: Finance-Hub → Seitenleiste Überblick → Prüfung

Purpose: Was sieht ein Prüfer in diesem Plan, und was fehlt noch?

- Auswahl eines Plans in der Planwahl rechts im Kopf → Die Sektion zeigt den gewählten Plan; jeder Reiter lädt seine Daten für ihn.
- Klick auf „Journal“, „Kasse & Konten“, „Sphären“ oder „Prüferpaket“ → Der gewählte Reiter wird gezeigt; der Hub merkt ihn sich für den nächsten Besuch.
- Klick auf „Neu laden“ in der Meldung des Rahmens → Die Pläne des Vereins werden erneut abgerufen.
- Klick auf „Zur Buchhaltung“ im Leersatz des Rahmens → Die Sektion Buchhaltung öffnet sich, dort beginnt der erste Plan. (leads to: wechselnd (Sektion Buchhaltung des Hubs))
- Klick auf „Alle“, „Ohne Beleg“ oder „Spät erfasst“, auf „Ohne Beleg zeigen“ oder „Spät erfasste zeigen“ im Streifen, oder Änderung von „Von“ und „Bis“ → Das Journal wird mit Zeitraum und Filter ab Nummer 1 neu abgerufen.
- Klick auf „Weitere 200 laden“ → Die nächsten 200 Buchungen werden abgerufen und unten angehängt.
- Klick auf eine Zeile des Journals → Die Buchhaltung öffnet das Konto der Buchung und hebt die Buchung hervor. (leads to: „Buchungen eines Kontos — prüfungssicher“)
- Klick auf „Neu laden“ in der Meldung des Journals → Die erste Seite des Journals wird erneut abgerufen.
- Klick auf „Geldkonto“ im Kopf des Abgleichs oder im Leersatz → Der Dialog „Neues Geldkonto“ öffnet sich.
- Klick auf „Auszug eintragen“ (Bank, Zahlungsanbieter) oder „Anfangsbestand“ (Kasse) in einer Zeile des Abgleichs → Der Dialog für Anfangsbestand und Auszug öffnet sich; bei einer Kasse ohne die Felder des Auszugs; bei einem abgeleiteten Anfangsbestand mit Stichtag und Anfangsbestand nur zum Lesen.
- Auswahl in „Konto“ über dem Kassenbuch oder Klick auf „Kassenbuch“ in einer Zeile des Abgleichs → Das Kontobuch des gewählten Kontos wird abgerufen.
- Auswahl in „Monat“ über dem Kassenbuch → Das geladene Kontobuch zeigt nur die Tage des gewählten Monats; die Anfangszeile nennt den Bestand davor.
- Klick auf „Neu laden“ in der Meldung des Reiters → Abgleich und Kontobuch werden erneut abgerufen.
- Klick auf „Anlegen“ im Dialog → Ein neues Geldkonto des Vereins entsteht; ab jetzt verlangt jede neue manuelle Buchung ein Geldkonto.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird gesendet. (leads to: zurück (zum Reiter Kasse & Konten))
- Klick auf „Geld umbuchen“ im Kopf der Karte „Abgleich der Geldkonten“ → Der Dialog „Geld umbuchen“ öffnet sich.
- Wahl in „Konto: Alle | <Konto>“ im Kopf der Karte → Die Liste zeigt nur Überträge von oder nach dem gewählten Konto.
- Klick auf „Stornieren“ in einer Zeile der Karte oder auf die Übertragszeile im Kassenbuch → Der Dialog „Übertrag stornieren“ öffnet sich.
- Klick auf „Erneut laden“ in der Störung der Karte → Die Überträge werden erneut abgerufen.
- Klick auf „Umbuchen“ im Dialog → Zwei Buchungen auf „Geldtransit“ — Ausgabe am Von-Konto, Einnahme am Nach-Konto — als ein Übertrag.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird gesendet. (leads to: zurück (zum Reiter Kasse & Konten))
- Klick auf „Stornieren“ im Dialog → Beide Buchungen des Übertrags werden gegengebucht; der Übertrag steht auf „Storniert“.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird gesendet. (leads to: zurück (zur Karte, zum Kassenbuch oder zum Detail))
- Klick auf „Speichern“ im Dialog → Anfangsbestand und Auszug des Kontos für diesen Plan werden gespeichert; Abgleich und Kassenbuch rechnen neu.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird gesendet. (leads to: zurück (zum Reiter Kasse & Konten))
- Auswahl in „Sphäre wählen“ in einer Zeile der Tabelle → Die Position bekommt die gewählte Sphäre; die Zeile verschwindet aus der Tabelle, die Kacheln rechnen neu.
- Klick auf „Neu laden“ in der Meldung des Reiters → Der Bericht nach Sphären wird erneut abgerufen.
- Klick auf „Export erstellen“ im Kopf der Export-Karte → Der Dialog „Export für die Betriebsprüfung“ öffnet sich.
- Klick auf „Herunterladen“ in der Zeile eines Stands → Die gespeicherten Bytes des Stands werden abgerufen und als ZIP gespeichert; die Oberfläche vergleicht die Prüfsumme mit dem sha256 des Stands aus AuditExportRead (die Kopfzeile X-Content-SHA256 gibt der Dienst per CORS nicht frei).
- Klick auf „Beleg nachreichen“ in einer Zeile → Der Beleg-Dialog der Buchung öffnet sich über dem Prüferpaket; nach dem Anhängen verschwindet die Zeile aus der Liste.
- Klick auf „Alle zeigen“ unter der Liste → Alle Buchungen ohne Beleg und darunter die Eigenbelege mit Begründung werden gezeigt.
- Klick auf „Bearbeiten“ in der Karte Verfahrensdokumentation → Der Dialog „Vereinsteil — neue Fassung“ öffnet sich.
- Klick auf „Als PDF“ in der Karte Verfahrensdokumentation → Im Browser entsteht ein PDF aus Systemteil und aktueller Fassung des Vereinsteils; leere Abschnitte stehen als „noch nicht beschrieben“.
- Klick auf „Frühere Fassungen“ und dann auf eine Fassung → Die gewählte Fassung wird abgerufen und als PDF mit dem heutigen Systemteil erzeugt.
- Klick auf „Neu laden“ in einer Karte des Prüferpakets → Die Daten der Karte werden erneut abgerufen.
- Klick auf „Export erstellen“ im Dialog → Der Dienst baut den Export nach dem Beschreibungsstandard und speichert ihn als unveränderlichen Stand.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird erstellt. (leads to: zurück (zum Prüferpaket))
- Klick auf „Als Fassung <n> speichern“ → Eine neue Fassung des Vereinsteils wird gespeichert; frühere bleiben unverändert.
- Klick auf „Neu laden“ im Satz des Zustands conflict → Die neueste Fassung wird abgerufen; die eigenen Eingaben bleiben daneben sichtbar.
- Klick auf „Abbrechen“ oder Escape → Der Dialog schließt, nichts wird gespeichert. (leads to: zurück (zum Prüferpaket))

### Übersicht nach Organigramm

Menu path: Web-App → Übersicht nach Organigramm (open item — add the menu path manually)

Purpose: Die Jahresübersicht zeigt die Konten des Haushalts gegliedert nach dem Organigramm, mit Einnahmen und Ausgaben als zwei Seiten und Veranstaltungen mit Ergebnis.

- Klick auf eine Knotenzeile oder ihren Pfeil → Unter der Zeile erscheinen die eigenen Konten des Knotens auf zwei Seiten und seine Veranstaltungen; ein zweiter Klick klappt zu. Unterknoten stehen darunter, wenn der Knoten aufgeklappt ist.
- Klick auf „Alle aufklappen“ im Kopf der Karte → Alle Knoten des Baums klappen auf.
- Klick auf „Zuklappen“ im Kopf der Karte → Alle Knoten klappen zu; die Knoten der obersten Ebene bleiben als Zeilen sichtbar.
- Umschalter „Plan / Ist | Nur Ist“ im Kopf der Karte → Nur Ist blendet die Planzahlen und Abweichungen aus: in Knotenzeilen „von <Plan>“, auf den Seiten die Spalte Plan.
- Klick auf „Position für <Knoten>“ im Leersatz eines aufgeklappten Knotens → Der bestehende Dialog „Position“ öffnet sich mit der Abteilung des Knotens vorgewählt; bei einer Mannschaft mit ihrer Abteilung (der Dialog kennt keine Mannschaften), beim Verein „vereinsweit“.
- Klick auf „Erneut laden“ in der Störung der Karte → Baum und Positionen werden erneut abgerufen.
- Umschalter „Nach Rubrik | Nach Seite“ im Kopf der Karte → Die Karte zeigt die gewählte Sicht; die Wahl wird je Verein im Browser gemerkt.
- Klick auf „Erneut laden“ in der Störung der Buchungen eines Kontos → Die Buchungen dieses Kontos werden erneut abgerufen.
- Klick auf „Weitere <n> Buchungen“ unter den ersten 20 → Alle Buchungen des Kontos stehen in der Liste.
- Klick auf „Konten nach Organigramm“ oder den Knotennamen in der Krume → Der Baum erscheint wieder mit demselben Klappzustand. (leads to: zurück)

### Belegerfassung im Finance-Hub

Menu path: Web-App → Belegerfassung im Finance-Hub (open item — add the menu path manually)

Purpose: Der Arbeitsplatz des Kassiers für alles, was als Beleg hereinkommt: zuordnen, buchen, Auslagen anerkennen und ausgleichen.

- Klick auf „Zur Buchhaltung“ → Wechsel in den Bereich Buchhaltung des Finance-Hubs. (leads to: Finance-Hub, Bereich Buchhaltung)
- Klick auf „<N> Buchungen ohne Beleg ansehen“ → Wechsel in die Buchhaltung, Offene Punkte gefiltert auf fehlende Belege. (leads to: Finance-Hub, Buchhaltung › Offene Punkte (fehlende Belege))
- Klick auf „Meine Auslagen“ → Wechsel in „Mein Bereich“ › Meine Auslagen des Vereins. (leads to: „Meine Auslagen (Web)“)
- Klick auf „Belege hochladen“ oder mobil der Kamera-Knopf der Hub-Hülle → Jede Datei wird in den Beleg-Eingang geladen und als Eingangsbeleg RECEIPT angelegt; die Analyse startet im Hintergrund.
- Klick auf „Erneut laden“ im Störungskasten → Liste und Kennzahlen werden neu abgerufen.
- Klick auf „Hier anhängen“ an einem Kandidaten → Die Datei wird in den Plan der Buchung umgehängt und dort als Beleg angehängt; der Eingangsbeleg ist erledigt.
- Klick auf „Doch neu buchen“ → Das Detail zeigt statt der Kandidaten den Entwurf (K2).
- Klick auf „Buchung anlegen“ im Entwurf → Eine manuelle Buchung mit dem Beleg entsteht; sie wartet auf die Freigabe einer zweiten Person.
- Klick auf „Anerkennen“ → Der Anspruch ist anerkannt und steht in „Offene Erstattungen“; gebucht wird noch nichts.
- Klick auf „Ablehnen …“ → Der Eingangsbeleg ist abgelehnt; die Datei bleibt als Nachweis im Eingang, das Mitglied kann nicht mehr zurückziehen.
- Klick auf die Event-Marke oder „Event angeben“ im Detail → Das Event des Belegs wird gesetzt, geändert oder entfernt; Kandidaten und Postenwahl richten sich neu danach.
- Klick auf „Noch einmal lesen“ → Der Beleg geht zurück in „Wird gelesen …“; das Ergebnis ersetzt das vorige.
- Klick auf „Ausgleichen“ in einer Zeile der offenen Erstattungen → Der Ausgleichsdialog öffnet sich, vorbelegt nach Wunschweg.
- Klick auf „Kopieren“ neben der Bankverbindung → Die IBAN liegt in der Zwischenablage für das Banking des Kassiers.
- Klick auf „Ausgleich buchen“ → Die Quittung wird in den Plan des Tages umgehängt und eine Ausgabe mit ihr gebucht; der Anspruch ist ausgeglichen, das Mitglied wird benachrichtigt.

<!-- /gen:docs web-app -->

## Commands and actions

<!-- gen:docs befehle -->

**finance**

- `cai.finance.01.plan_list` — list (read) · Scopes: `finance.read`
- `cai.finance.02.plan_show` — show (read) · Scopes: `finance.read`
- `cai.finance.03.plan_create` — create (change) · Scopes: `finance.write`
- `cai.finance.04.plan_update` — update (change) · Scopes: `finance.write`
- `cai.finance.05.plan_close` — close (change with confirmation) · Scopes: `finance.write`
- `cai.finance.07.plan_copy` — copy (change with confirmation) · Scopes: `finance.write`
- `cai.finance.08.position_list` — list (read) · Scopes: `finance.read`
- `cai.finance.09.position_create` — create (change) · Scopes: `finance.write`
- `cai.finance.10.position_show` — show (read) · Scopes: `finance.read`
- `cai.finance.11.position_update` — update (change) · Scopes: `finance.write`
- `cai.finance.12.position_delete` — delete (change with confirmation) · Scopes: `finance.write`
- `cai.finance.13.position_import_shopping` — import (change) · Scopes: `finance.write`
- `cai.finance.14.summary` — total, by_department (read) · Scopes: `finance.read`
- `cai.finance.15.entry_list` — list (read) · Scopes: `finance.read`
- `cai.finance.16.entry_create` — create (change) · Scopes: `finance.write`
- `cai.finance.17.entry_show` — show (read) · Scopes: `finance.read`
- `cai.finance.18.entry_update` — update (change with confirmation) · Scopes: `finance.write`
- `cai.finance.19.entry_delete` — delete (change with confirmation) · Scopes: `finance.write`
- `cai.finance.20.entry_approve` — approve (change with confirmation) · Scopes: `finance.write`
- `cai.finance.21.plan_period` — list, create, show, update, positions, position_create, summary, journal, entries_without_receipt, sphere_report, audit_check, audit_labels, audit_label_set, dashboard (read, change) · Scopes: `finance.read`, `finance.write`
- `cai.finance.22.plan_lifecycle` — close, next_period (change with confirmation) · Scopes: `finance.write`
- `cai.finance.23.settings` — show, update (read, change) · Scopes: `finance.read`, `finance.write`
- `cai.finance.24.money_account` — list, create, update, opening, opening_versions, cash_book, reconciliation, grants, grant_set, grant_revoke, transfers, transfer_show, transfer_create, transfer_reverse, booking_accounts (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.25.entry_correction` — entry_create, entry_create_unplanned, reverse, receipt, versions, receipt_scan_create, receipt_candidates, receipt_attach, receipt_book, receipt_reject, receipt_event_set, receipt_withdraw, receipt_file, position_link_set, position_link_remove, tax_sphere, objection_create, objections, objection_withdraw (change, change with confirmation, read) · Scopes: `finance.write`, `finance.read`
- `cai.finance.26.cash_report` — list, create, show, submit, reject, entries, approve_entries, approve, tax_report (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.27.department_transfer` — list, account_choices, show, create, confirm, reject, withdraw, reverse (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.28.plan_result` — result, open_items, open_item_create, open_item_update, open_item_delete, resolutions, resolution_create, resolution_update, resolution_delete (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.29.procedure_doc` — show, version, save (read, change) · Scopes: `finance.read`, `finance.write`
- `cai.finance.30.audit_export` — list, create, download (read, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.31.finance_views` — receipt_inbox, receipt_scan, event, event_reconciliation, series_comparison, department_history, link_options, event_links, event_link_view, location_links, analysis_ranking, analysis_target, object (read) · Scopes: `finance.read`
- `cai.finance.32.investment_plan` — list, create, show, update, delete, dashboard, feasibility, funding_summary, loan_details (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.33.investment_item` — list, create, update, delete (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.34.investment_funding` — list, create, update, delete, loan_show, loan_create, loan_update (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.35.investment_scenario` — list, create, from_template, show, update, delete, auto_generate, cashflow_list, cashflow_create, cashflow_update, cashflow_delete (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.36.budget_organigram` — tree, frame_set, frame_versions, statement, rubrics, rubric_create, rubric_update, rubric_delete, position_split (read, change with confirmation, change) · Scopes: `finance.read`, `finance.write`
- `cai.finance.37.budget_season` — seasons, season_tree, season_frame_set, season_frame_versions, frame_proposal (read, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.38.entry_detail` — entry, open_items (read) · Scopes: `finance.read`
- `cai.finance.39.budget_period` — show, set, tree, frame_set, frame_versions, statement, window_position_create, window_position_update (read, change with confirmation) · Scopes: `finance.read`, `finance.write`
<!-- /gen:docs -->

## Errors

- `CONFLICT` — the year is closed; the service rejects changes to positions and entries until it
  is reopened. More: `comvenio help fehler CONFLICT`.
- `VALIDATION_FAILED` — an amount is not in cents, an entry is neither income nor expense or both,
  or a required field is missing. More: `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — plan, position or entry are not known under the given identifier. More:
  `comvenio help fehler NOT_FOUND`.
- `PERMISSION_DENIED` — the club role does not allow the accounting action. More:
  `comvenio help fehler PERMISSION_DENIED`.

A backend error is not an empty result: the CLI returns it with a non-zero exit code.
