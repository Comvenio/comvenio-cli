---
id: meetings
kategorie: thema
domaenen: [meeting]
stichwoerter: [meetings, protokolle, tagesordnung, beschlüsse, abstimmungen, teilnehmer, vorstandssitzung]
---

# Meetings und Protokolle

## Wozu

Die Actions der Domäne `meeting` decken die fachlichen Abläufe rund um Vereinssitzungen ab:
Meeting-Serien anlegen, für einen konkreten Termin ein Protokoll führen, die Tagesordnung steuern,
Notizen und Teilnehmer erfassen, Entscheidungen und Abstimmungen durchführen, Beschlüsse verwalten und
am Ende die offizielle Reinschrift veröffentlichen.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen,
zeigt `comvenio action list --json`.

- Schreibende Actions (Serien, Protokolle, Tagesordnung, Notizen, Teilnehmer, Entscheidungen,
  Abstimmungen, Beschlüsse, Reinschrift) erfordern das Recht `manage_meetings` beziehungsweise die
  jeweilige granulare Meeting-Berechtigung.
- Stimmberechtigt bei einer Abstimmung sind nur Teilnehmer, die als anwesend erfasst sind.
- `--json` ist für Skripte und Agenten die verbindliche Ausgabeform.
- Umfangreiche Eingaben lassen sich statt `--input '<json>'` auch mit `--file <pfad>` (JSON)
  übergeben.
- Ein Fehler ist kein leeres Ergebnis: Die CLI gibt einen Fehler des Dienstes mit einem Exit-Code
  ungleich null zurück.

Jede Teilaktion einer mehrteiligen Action wird über `"operation": "<name>"` in `--input` gewählt. Eine
kritische (`critical_write`) Teilaktion liefert zuerst eine Vorschau mit `preview_id` und
`confirmation_token`; erst `comvenio action confirm --preview-id … --confirmation-token …
--idempotency-key …` führt sie aus.

## Abläufe

### Meeting-Serie anlegen

1. Serie mit Abteilung, Titel und Standardwerten für Protokolltyp, Genehmigungspflicht und
   Protokollstil anlegen (`create`, unkritisch).
2. Serien auflisten oder eine einzelne ansehen (`list`, `show`, unkritisch), ändern (`update`,
   unkritisch) oder löschen (`delete`, kritisch).

```bash
comvenio action call cai.meeting.01.series_list_show_create_update_delete \
  --input '{"operation":"create","series":{"department_id":"<department-id>","title":"Monatliche Vorstandssitzung","description":"Regeltermin des Vorstands","meeting_type":"Vorstandssitzung","default_protocol_type":"formal","default_requires_approval":true,"default_protocol_summary_style":"results"}}' --json

comvenio action call cai.meeting.01.series_list_show_create_update_delete \
  --input '{"operation":"list","limit":20,"offset":0}' --json
```

Zulässige Werte für den Protokollstil: `results`, `detailed`, `decision`, `short`, `action`, `custom`.

### Protokoll für einen Termin anlegen

1. Zu einem konkreten Veranstaltungstermin ein Protokoll mit Meeting-Serie, Termin, Abteilung und Titel
   anlegen (`create`, unkritisch).
2. Protokoll auflisten oder ansehen (`list`, `show`, unkritisch).

```bash
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"create","protocol":{"meeting_id":"<meeting-series-id>","event_id":"<event-id>","department_id":"<department-id>","title":"Vorstandssitzung Juli 2026","protocol_type":"formal","requires_approval":true,"allow_public_join":false}}' --json
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"show","protocol_id":"<protocol-id>"}' --json
```

Der Lebenszyklus eines Protokolls verläuft: Vorbereitung offen → Vorbereitung durch die Verwaltung →
Tagesordnung fertig → in Sitzung → abgeschlossen → Reinschrift wird erstellt → wartet auf Freigabe →
veröffentlicht. Beim Wechsel in den Sitzungsstatus setzt Comvenio den Beginnzeitpunkt, beim Abschluss
den Endzeitpunkt.

3. Protokoll zur nächsten Phase weiterschalten (`advance`, kritisch) oder eine Phase zurücknehmen
   (`revert`, kritisch).
4. Änderungen seit einem Zeitpunkt abfragen (`updates`, unkritisch).
5. Vor der Veröffentlichung den Validierungsstatus prüfen (`validation`, unkritisch) und
   veröffentlichen (`publish`, kritisch).

```bash
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"advance","protocol_id":"<protocol-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"validation","protocol_id":"<protocol-id>"}' --json
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"publish","protocol_id":"<protocol-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Wichtige Bedingungen: Der Wechsel von „Reinschrift wird erstellt" zu „wartet auf Freigabe" verlangt,
dass zu jedem behandelten Tagesordnungspunkt ein Reinschrift-Eintrag existiert. Die Veröffentlichung
verlangt, dass alle Prüfer bestätigt haben. Eine Phase zurückzunehmen ist nicht in jeder Phase erlaubt.

### Tagesordnung und Live-Status

Bei dieser Action ist jede Teilaktion kritisch — auch das Auflisten und Ansehen zeigt zuerst eine
Vorschau und verlangt eine Bestätigung.

1. Tagesordnungspunkt mit Titel, Beschreibung und geschätzter Dauer anlegen.
2. Tagesordnung auflisten, einen Punkt ansehen, ändern, löschen oder neu sortieren.
3. Punkt starten, abschließen oder überspringen; einen Übernahme-Punkt aus einer Vorserie dabei mit
   `protocol_id` dem passenden Protokoll zuordnen, weil ein Tagesordnungspunkt mehreren Protokollen
   zugeordnet sein kann.
4. Punkt freigeben (`approve`).

```bash
comvenio action call cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr \
  --input '{"operation":"create","protocol_id":"<protocol-id>","agenda_item":{"title":"Kassenbericht","description":"Auswertung des zweiten Quartals","estimated_duration_minutes":20,"is_hidden":false}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr \
  --input '{"operation":"reorder","protocol_id":"<protocol-id>","agenda_item_ids":["<top-id-1>","<top-id-2>"]}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr \
  --input '{"operation":"start","protocol_id":"<protocol-id>","agenda_item_id":"<top-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

### Notizen

1. Notizen eines Tagesordnungspunkts (`list`) oder eines gesamten Protokolls (`list_protocol`)
   auflisten — unkritisch.
2. Notiz mit Protokoll, Tagesordnungspunkt, Inhalt und Notiztyp anlegen (`create`, unkritisch); ändern
   (`update`, unkritisch) oder löschen (`delete`, kritisch).

```bash
comvenio action call cai.meeting.04.note_list_list_protocol_create_update_delete \
  --input '{"operation":"create","note":{"protocol_id":"<protocol-id>","agenda_item_id":"<top-id>","content":"Kassenbericht liegt vor","note_type":"summary"}}' --json
comvenio action call cai.meeting.04.note_list_list_protocol_create_update_delete \
  --input '{"operation":"list_protocol","protocol_id":"<protocol-id>"}' --json
```

Fachliche Notiztypen: Verwaltung, Diskussion, Notiz, Zusammenfassung. Der Typ „Aufgaben-Update"
entsteht ausschließlich automatisch aus dem Aufgaben-Workflow und ist nicht für manuelle Notizen
vorgesehen.

### Teilnehmer und Validierung

1. Teilnehmer eines Protokolls auflisten (`list`, unkritisch).
2. Teilnehmer hinzufügen (`add`, unkritisch) — mit Benutzer, Mitglied oder mindestens einem Namen als
   Identität.
3. Rolle oder Anwesenheit eines Teilnehmers ändern (`update`, unkritisch) — mehr lässt sich an einem
   bestehenden Teilnehmer nicht anpassen; Teilnehmer entfernen (`remove`, kritisch).
4. Teilnehmer validieren (`validate`, unkritisch) oder die Validierung zurücknehmen (`unvalidate`,
   kritisch).

```bash
comvenio action call cai.meeting.05.participant_list_add_update_remove_validate_unvalidate \
  --input '{"operation":"add","protocol_id":"<protocol-id>","participant":{"member_id":"<member-id>","role":"member"}}' --json
comvenio action call cai.meeting.05.participant_list_add_update_remove_validate_unvalidate \
  --input '{"operation":"validate","participant_id":"<participant-id>"}' --json
```

### Entscheidungen und Abstimmungen

Eine Entscheidung entsteht immer an einem Tagesordnungspunkt und darf nur für einen gerade behandelten
Punkt angelegt werden. Die vollständigen Entscheidungsdaten eines Tagesordnungspunkts liefert die
Teilaktion `agenda` — eine eigene Liste oder Detailansicht einzelner Entscheidungen gibt es nicht. Jede
Teilaktion außer `agenda` ist kritisch.

1. Entscheidung mit Tagesordnungspunkt, Titel, Art und Gültigkeitsbeginn anlegen (`create`).
2. Bei Bedarf Abstimmungsoptionen einzeln (`option_add`) oder als Sammlung (`options_add`) ergänzen.
3. Abstimmung öffnen, Stimmen abgeben — direkt, in Sammlung oder per Vollmacht —, Abstimmung schließen,
   Ergebnisse (`results`, unkritisch) und stimmberechtigte Teilnehmer (`eligible`, unkritisch)
   einsehen.
4. Entscheidung ändern (`update`), absagen (`cancel`, verlangt `cancel_reason`) oder zu einem Beschluss
   mit Beschlussnummer erheben (`promote`).

```bash
comvenio action call cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote \
  --input '{"operation":"create","agenda_item_id":"<top-id>","decision":{"title":"Budget 2027 freigeben","decision_type":"voting","voting_visibility":"public","valid_from":"2026-07-13T19:30:00+02:00","voting_eligibility":"all_participants","allow_proxy_voting":true,"is_offline_voting":false,"allow_multiple_choice":false}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.07.voting_open_close_results_eligible_tally \
  --input '{"operation":"open","decision_id":"<decision-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract \
  --input '{"operation":"cast","decision_id":"<decision-id>","vote":{"option_id":"<option-id>"}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.07.voting_open_close_results_eligible_tally \
  --input '{"operation":"close","decision_id":"<decision-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
comvenio action call cai.meeting.07.voting_open_close_results_eligible_tally \
  --input '{"operation":"results","decision_id":"<decision-id>"}' --json
```

Offline-Auszählungen laufen über `voting_tally`: Ohne `increment` setzt `count` den absoluten
Zählerstand, mit `increment: true` wird ein Delta addiert. Bei einer Mehrfachauswahl entfernt das
Zurückziehen einer einzelnen Option (`option_retract`) nur die eigene Stimme für diese Option; das
vollständige Zurückziehen (`retract`) entfernt alle eigenen Stimmen dieser Entscheidung.

### Beschlüsse

1. Beschlüsse eines Vereins auflisten, optional gefiltert nach Abteilung, Kategorie oder mit
   abgelaufenen Beschlüssen (`list`); Beschlüsse eines Protokolls auflisten (`list_protocol`) —
   unkritisch.
2. Einzelnen Beschluss (`show`) und seine Historie (`history`) ansehen — unkritisch.
3. Beschluss anlegen, ändern, genehmigen oder ablehnen, löschen — jeweils kritisch.

```bash
comvenio action call cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli \
  --input '{"operation":"list","category":"satzung","valid_only":true,"limit":20,"offset":0}' --json

comvenio action call cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli \
  --input '{"operation":"approve","resolution_id":"<resolution-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli \
  --input '{"operation":"decline","resolution_id":"<resolution-id>","reason":"Formfehler in der Beschlussvorlage"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Beschlussstatus: neu, angenommen, abgelehnt, abgelaufen. Eine Ablehnung verlangt eine Begründung; bei
einer Genehmigung ist die Begründung optional.

### Reinschrift und Anhänge

Reinschrift-Einträge sind die offizielle Fassung eines Protokolls in der Phase „Reinschrift wird
erstellt".

1. Einträge eines Protokolls (`list`) oder zu einem Tagesordnungspunkt (`show_agenda`) auflisten,
   einzelnen Eintrag ansehen (`show`) — unkritisch.
2. Eintrag mit Tagesordnungspunkt und Inhalt anlegen (`create`, unkritisch), optional als
   KI-unterstützt markiert; ändern (`update`, unkritisch) oder löschen (`delete`, kritisch).
3. Anhänge eines Eintrags auflisten (`list`, unkritisch), eine bereits vorhandene Datei über ihre
   Datei-Kennung verknüpfen (`add`, kritisch) oder einen Anhang entfernen (`remove`, kritisch).

```bash
comvenio action call cai.meeting.10.entry_list_show_show_agenda_create_update_delete \
  --input '{"operation":"create","agenda_item_id":"<top-id>","entry":{"protocol_id":"<protocol-id>","content":"Kassenbericht einstimmig zur Kenntnis genommen.","is_ai_generated":false}}' --json

comvenio action call cai.meeting.11.attachment_list_add_remove \
  --input '{"operation":"add","entry_id":"<entry-id>","file_id":"<file-id>","title":"Kassenbericht Q2"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Der Upload der Anhangsdatei selbst läuft nicht über diese Action — sie muss zuvor hochgeladen sein
(siehe Artikel „DataShare — Dateien, Ordner und Papers").

### Noch nicht als Action verfügbar

Interne System-zu-System-Wartung mit eigenem Authentifizierungsvertrag, der Browser- und
Einladungszugang für Teilnehmende (öffentliche und persönliche Zugangslinks) sowie private
KI-Assistenz-Entwürfe mit eigenem Bestätigungs- und Berechtigungskontext sind bewusst kein Bestandteil
dieser Actions — sie laufen in der Web-App.

## Beispiele

Meeting-Serie anlegen:

```bash
comvenio action call cai.meeting.01.series_list_show_create_update_delete \
  --input '{"operation":"create","series":{"department_id":"<department-id>","title":"Monatliche Vorstandssitzung","description":"Regeltermin des Vorstands","meeting_type":"Vorstandssitzung","default_protocol_type":"formal","default_requires_approval":true,"default_protocol_summary_style":"results"}}' --json
```

Protokoll anlegen und veröffentlichen:

```bash
comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"create","protocol":{"meeting_id":"<meeting-series-id>","event_id":"<event-id>","department_id":"<department-id>","title":"Vorstandssitzung Juli 2026","protocol_type":"formal","requires_approval":true,"allow_public_join":false}}' --json

comvenio action call cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat \
  --input '{"operation":"publish","protocol_id":"<protocol-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Entscheidung anlegen und Abstimmung durchführen:

```bash
comvenio action call cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote \
  --input '{"operation":"create","agenda_item_id":"<top-id>","decision":{"title":"Budget 2027 freigeben","decision_type":"voting","voting_visibility":"public","valid_from":"2026-07-13T19:30:00+02:00","voting_eligibility":"all_participants","allow_proxy_voting":true,"is_offline_voting":false,"allow_multiple_choice":false}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.07.voting_open_close_results_eligible_tally \
  --input '{"operation":"open","decision_id":"<decision-id>"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json

comvenio action call cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract \
  --input '{"operation":"cast","decision_id":"<decision-id>","vote":{"option_id":"<option-id>"}}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

Beschluss ablehnen:

```bash
comvenio action call cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli \
  --input '{"operation":"decline","resolution_id":"<resolution-id>","reason":"Formfehler in der Beschlussvorlage"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> \
  --idempotency-key <schlüssel> --json
```

## Begriffe und Zusammenhänge

- **Meeting-Serie** — der wiederkehrende Rahmen einer Sitzung, etwa die Vorstandssitzung einer
  Abteilung, mit Standardwerten für Protokolltyp, Genehmigungspflicht und Protokollstil.
- **Protokoll** — die Aufzeichnung einer einzelnen Sitzung zu einem konkreten Veranstaltungstermin.
  Es durchläuft Phasen von der Vorbereitung über die Sitzung bis zur veröffentlichten Reinschrift.
- **Tagesordnung** — die Punkte einer Sitzung mit Titel, Beschreibung und geschätzter Dauer; jeder
  Punkt wird gestartet, abgeschlossen oder übersprungen.
- **Teilnehmer** — wer an der Sitzung beteiligt ist, mit Rolle und Anwesenheit. Nur anwesende
  Teilnehmer sind stimmberechtigt.
- **Entscheidung** — wird an einem gerade behandelten Tagesordnungspunkt angelegt, mit Titel, Art
  und Gültigkeitsbeginn; sie kann eine Abstimmung mit Optionen tragen.
- **Abstimmung** — das Verfahren an einer Entscheidung: öffnen, Stimmen abgeben (direkt, in
  Sammlung oder per Vollmacht), schließen, Ergebnis einsehen.
- **Beschluss** — eine Entscheidung, die mit Beschlussnummer erhoben wurde (`promote`). Beschlüsse
  sind vereinsweit auffindbar, haben eine Historie und einen Status (neu, angenommen, abgelehnt,
  abgelaufen).
- **Reinschrift** — die offizielle Fassung des Protokolls, ein Eintrag je behandeltem
  Tagesordnungspunkt; veröffentlicht wird sie erst nach Bestätigung aller Prüfer.

Zusammenhang: Meeting-Serie → Protokoll je Termin → Tagesordnung → Entscheidungen (mit
Abstimmung) → Beschlüsse; am Ende Reinschrift und Veröffentlichung. Den Termin selbst verwaltet
„Veranstaltungen“.

## Häufige Fragen

**Was ist der Unterschied zwischen einer Entscheidung und einem Beschluss?**
Eine Entscheidung entsteht in der Sitzung an einem Tagesordnungspunkt, gegebenenfalls mit
Abstimmung. Zum Beschluss wird sie erst durch `promote` mit Beschlussnummer; erst dann erscheint
sie in der vereinsweiten Beschlussliste mit Status und Historie.

**Warum kann ich keine Entscheidung zu einem späteren Tagesordnungspunkt anlegen?**
Eine Entscheidung darf nur für den Punkt angelegt werden, der gerade behandelt wird. Starte den
Punkt zuerst in der Tagesordnung.

**Warum darf ein Teilnehmer nicht abstimmen?**
Stimmberechtigt sind nur Teilnehmer, die als anwesend erfasst sind. Setze die Anwesenheit über die
Teilnehmer-Action (`update`); wer stimmberechtigt ist, zeigt `eligible`.

**Warum lässt sich das Protokoll nicht veröffentlichen?**
Die Veröffentlichung verlangt, dass alle Prüfer bestätigt haben; schon der Wechsel zu „wartet auf
Freigabe“ verlangt einen Reinschrift-Eintrag zu jedem behandelten Punkt. `validation` zeigt, was
noch fehlt.

**Ist ein Termin mit `event_type=meeting` schon eine Sitzung?**
Nein. Der Termin steht im Kalender; Tagesordnung, Entscheidungen und Beschlüsse entstehen erst im
Protokoll, das zu diesem Termin angelegt wird.

## So geht's in der Web-App

<!-- gen:docs web-app -->

Web-App-Führung folgt, sobald UI-Spezifikationen mit Code-Ankern vorliegen.

<!-- /gen:docs web-app -->

## Befehle und Actions

<!-- gen:docs befehle -->

**meeting**

- `cai.meeting.01.series_list_show_create_update_delete` — list, show, create, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.02.protocol_list_show_create_update_delete_advance_revert_updates_validat` — list, show, create, update, delete, advance, revert, updates, validation, publish (lesen, ändern, ändern mit Bestätigung) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.03.agenda_list_show_create_update_delete_reorder_start_complete_skip_appr` — list, show, create, update, delete, reorder, start, complete, skip, approve (lesen, ändern mit Bestätigung) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.04.note_list_list_protocol_create_update_delete` — list, list_protocol, create, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.05.participant_list_add_update_remove_validate_unvalidate` — list, add, update, remove, validate, unvalidate (lesen, ändern, ändern mit Bestätigung) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.06.decision_create_agenda_update_cancel_option_add_options_add_promote` — create, agenda, update, cancel, option_add, options_add, promote (ändern mit Bestätigung, lesen) · Scopes: `meeting.write`, `meeting.read`
- `cai.meeting.07.voting_open_close_results_eligible_tally` — open, close, results, eligible, tally (ändern mit Bestätigung, lesen) · Scopes: `meeting.write`, `meeting.read`
- `cai.meeting.08.vote_cast_cast_bulk_proxy_proxy_bulk_option_retract_retract` — cast, cast_bulk, proxy, proxy_bulk, option_retract, retract (ändern mit Bestätigung) · Scopes: `meeting.write`
- `cai.meeting.09.resolution_list_list_protocol_show_history_create_update_approve_decli` — list, list_protocol, show, history, create, update, approve, decline, delete (lesen, ändern mit Bestätigung) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.10.entry_list_show_show_agenda_create_update_delete` — list, show, show_agenda, create, update, delete (lesen, ändern, ändern mit Bestätigung) · Scopes: `meeting.read`, `meeting.write`
- `cai.meeting.11.attachment_list_add_remove` — list, add, remove (lesen, ändern mit Bestätigung) · Scopes: `meeting.read`, `meeting.write`, `files.write`
- Felder und Werte: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"meeting"}'` (`club_id` setzt die Anmeldung — nie in `--input`)
<!-- /gen:docs -->

## Fehler

- `PERMISSION_DENIED` — die Vereinsrolle trägt nicht das Recht `manage_meetings` oder die passende
  granulare Meeting-Berechtigung für die versuchte Action. Siehe
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — ein Pflichtfeld fehlt oder hat das falsche Format, etwa beim Anlegen einer
  Serie, eines Protokolls, einer Entscheidung oder eines Beschlusses. Siehe
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — die angegebene Serien-, Protokoll-, Tagesordnungs-, Entscheidungs- oder Beschluss-ID
  gehört zu keinem sichtbaren Eintrag. Siehe `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — eine Action widerspricht dem aktuellen Zustand, etwa ein Phasenwechsel, der die nötigen
  Voraussetzungen noch nicht erfüllt, oder eine Abstimmung, die bereits geschlossen ist. Siehe
  `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — die Anmeldung wurde ohne den für eine Meeting-Schreibaction nötigen Scope erteilt.
  Siehe `comvenio help fehler SCOPE_REQUIRED`.
- `OUTCOME_UNKNOWN` — eine kritische Action (Löschen, Phasenwechsel, Abstimmung, Beschluss) wurde nach
  `action confirm` nicht eindeutig bestätigt; vor einer Wiederholung erst mit einem Lesebefehl den
  Stand prüfen. Siehe `comvenio help fehler OUTCOME_UNKNOWN`.
- `USAGE_ERROR` — ein Befehl, den es im CLI nicht mehr gibt; mit `comvenio action list` die
  passende Action suchen. Siehe `comvenio help fehler USAGE_ERROR`.
