---
id: meetings
kategorie: thema
domaenen: [meeting]
stichwoerter: [meetings, protokolle, tagesordnung, beschlüsse, abstimmungen, teilnehmer, vorstandssitzung]
---

# Meetings und Protokolle

## Wozu

`comvenio meeting` deckt die fachlichen Abläufe rund um Vereinssitzungen ab: Meeting-Serien anlegen,
für einen konkreten Termin ein Protokoll führen, die Tagesordnung steuern, Notizen und Teilnehmer
erfassen, Entscheidungen und Abstimmungen durchführen, Beschlüsse verwalten und am Ende die
offizielle Reinschrift veröffentlichen.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

- Schreibende Aktionen (Serien, Protokolle, Tagesordnung, Notizen, Teilnehmer, Entscheidungen,
  Abstimmungen, Beschlüsse, Reinschrift) erfordern das Recht `manage_meetings` beziehungsweise die
  jeweilige granulare Meeting-Berechtigung.
- Stimmberechtigt bei einer Abstimmung sind nur Teilnehmer, die als anwesend erfasst sind.
- `--club <club-id>` überschreibt den Verein aus dem lokalen Anmeldestatus.
- `--json` ist für Skripte und Agenten die verbindliche Ausgabeform.
- Umfangreiche Eingaben werden als JSON-Datei mit `--file <payload.json>` übergeben; die Felder
  gehen unverändert an den Vertrag der jeweiligen Aktion.
- Ein Fehler ist kein leeres Ergebnis: Die CLI gibt einen Fehler des Dienstes mit einem Exit-Code
  ungleich null zurück.

## Abläufe

### Meeting-Serie anlegen

1. Serie mit Verein, Abteilung, Titel und Standardwerten für Protokolltyp, Genehmigungspflicht und
   Protokollstil anlegen.
2. Serien auflisten oder eine einzelne ansehen, bei Bedarf ändern oder löschen.

### Protokoll für einen Termin anlegen

1. Zu einem konkreten Veranstaltungstermin ein Protokoll mit Meeting-Serie, Termin, Verein, Abteilung
   und Titel anlegen.
2. Protokoll auflisten oder ansehen.

Der Lebenszyklus eines Protokolls verläuft: Vorbereitung offen → Vorbereitung durch die Verwaltung →
Tagesordnung fertig → in Sitzung → abgeschlossen → Reinschrift wird erstellt → wartet auf Freigabe →
veröffentlicht. Beim Wechsel in den Sitzungsstatus setzt Comvenio den Beginnzeitpunkt, beim Abschluss
den Endzeitpunkt.

3. Protokoll zur nächsten Phase weiterschalten oder eine Phase zurücknehmen.
4. Änderungen seit einem Zeitpunkt abfragen.
5. Vor der Veröffentlichung den Validierungsstatus prüfen und veröffentlichen.

Wichtige Bedingungen: Der Wechsel von „Reinschrift wird erstellt" zu „wartet auf Freigabe" verlangt,
dass zu jedem behandelten Tagesordnungspunkt ein Reinschrift-Eintrag existiert. Die Veröffentlichung
verlangt, dass alle Prüfer bestätigt haben. Eine Phase zurückzunehmen ist nicht in jeder Phase erlaubt.

### Tagesordnung und Live-Status

1. Tagesordnungspunkt mit Titel, Beschreibung und geschätzter Dauer anlegen.
2. Tagesordnung auflisten, einen Punkt ansehen, ändern, löschen oder neu sortieren.
3. Punkt starten, abschließen oder überspringen; einen Übernahme-Punkt aus einer Vorserie dabei mit
   dem passenden Protokoll verknüpfen, weil ein Tagesordnungspunkt mehreren Protokollen zugeordnet
   sein kann.
4. Punkt freigeben.

### Notizen

1. Notizen eines Tagesordnungspunkts oder eines gesamten Protokolls auflisten.
2. Notiz mit Protokoll, Tagesordnungspunkt, Verein, Inhalt und Notiztyp anlegen.
3. Notiz ändern oder löschen.

Fachliche Notiztypen: Verwaltung, Diskussion, Notiz, Zusammenfassung. Der Typ „Aufgaben-Update"
entsteht ausschließlich automatisch aus dem Aufgaben-Workflow und ist nicht für manuelle Notizen
vorgesehen.

### Teilnehmer und Validierung

1. Teilnehmer eines Protokolls auflisten.
2. Teilnehmer hinzufügen — mit Benutzer, Mitglied oder mindestens einem Namen als Identität.
3. Rolle oder Anwesenheit eines Teilnehmers ändern — mehr lässt sich an einem bestehenden Teilnehmer
   nicht anpassen; Teilnehmer entfernen.
4. Teilnehmer validieren oder die Validierung zurücknehmen.

### Entscheidungen und Abstimmungen

Eine Entscheidung entsteht immer an einem Tagesordnungspunkt und darf nur für einen gerade
behandelten Punkt angelegt werden. Die vollständigen Entscheidungsdaten eines Tagesordnungspunkts
liefert der Tagesordnungspunkt selbst — eine eigene Liste oder Detailansicht einzelner
Entscheidungen gibt es nicht.

1. Entscheidung mit Protokoll, Tagesordnungspunkt, Abteilung, Verein, Titel, Art und Gültigkeitsbeginn
   anlegen.
2. Bei Bedarf Abstimmungsoptionen einzeln oder als Sammlung ergänzen.
3. Abstimmung öffnen, Stimmen abgeben — direkt, in Sammlung oder per Vollmacht —, Abstimmung
   schließen, Ergebnisse und stimmberechtigte Teilnehmer einsehen.
4. Entscheidung ändern, absagen oder zu einem Beschluss mit Beschlussnummer erheben.

Offline-Auszählungen laufen über eine eigene Aktion: Ohne Inkrement setzt die Angabe den absoluten
Zählerstand, mit Inkrement wird ein Delta addiert, auch negativ. Bei einer Mehrfachauswahl entfernt
das Zurückziehen einer einzelnen Option nur die eigene Stimme für diese Option; das vollständige
Zurückziehen entfernt alle eigenen Stimmen dieser Entscheidung.

### Beschlüsse

1. Beschlüsse eines Vereins auflisten, optional gefiltert nach Abteilung, Kategorie oder mit
   abgelaufenen Beschlüssen; Beschlüsse eines Protokolls auflisten.
2. Einzelnen Beschluss und seine Historie ansehen.
3. Beschluss anlegen, ändern, genehmigen oder ablehnen, löschen.

Beschlussstatus: neu, angenommen, abgelehnt, abgelaufen. Eine Ablehnung verlangt eine Begründung; bei
einer Genehmigung ist die Begründung optional.

### Reinschrift und Anhänge

Reinschrift-Einträge sind die offizielle Fassung eines Protokolls in der Phase „Reinschrift wird
erstellt".

1. Einträge eines Protokolls oder zu einem Tagesordnungspunkt auflisten, einzelnen Eintrag ansehen.
2. Eintrag mit Protokoll und Inhalt anlegen, optional als KI-unterstützt markiert.
3. Eintrag ändern oder löschen.
4. Anhänge eines Eintrags auflisten, eine bereits vorhandene Datei verknüpfen oder einen Anhang
   entfernen.

Ein Anhang verknüpft eine bereits hochgeladene Datei über ihre Datei-Kennung; der Upload selbst
läuft nicht über diese Aktionen.

### Bewusst ausgeschlossene Abläufe

Folgende Bereiche sind bewusst kein Bestandteil dieser Club-Admin-Abläufe: interne
System-zu-System-Wartung mit eigenem Authentifizierungsvertrag, der Browser- und Einladungszugang für
Teilnehmende (öffentliche und persönliche Zugangslinks), private KI-Assistenz-Entwürfe mit eigenem
Bestätigungs- und Berechtigungskontext, sowie automatisch erzeugte Aufgaben-Update-Notizen.

## Beispiele

Meeting-Serie anlegen (`meeting-series.json`):

```json
{
  "club_id": "<club-id>",
  "department_id": "<department-id>",
  "title": "Monatliche Vorstandssitzung",
  "description": "Regeltermin des Vorstands",
  "meeting_type": "Vorstandssitzung",
  "default_protocol_type": "formal",
  "default_requires_approval": true,
  "default_protocol_summary_style": "results"
}
```

```bash
comvenio meeting series-create --file meeting-series.json --json
comvenio meeting series-list --json
```

Zulässige Werte für den Protokollstil: `results`, `detailed`, `decision`, `short`, `action`, `custom`.

Protokoll für einen Termin anlegen:

```json
{
  "meeting_id": "<meeting-series-id>",
  "event_id": "<event-id>",
  "club_id": "<club-id>",
  "department_id": "<department-id>",
  "title": "Vorstandssitzung Juli 2026",
  "protocol_type": "formal",
  "requires_approval": true,
  "allow_public_join": false
}
```

```bash
comvenio meeting protocol-create --file protocol.json --json
comvenio meeting protocol-show <protocol-id> --json
comvenio meeting protocol-advance <protocol-id> --json
comvenio meeting protocol-validation <protocol-id> --json
comvenio meeting protocol-publish <protocol-id> --json
```

Tagesordnungspunkt anlegen und steuern:

```json
{
  "title": "Kassenbericht",
  "description": "Auswertung des zweiten Quartals",
  "estimated_duration_minutes": 20,
  "is_hidden": false
}
```

```bash
comvenio meeting agenda-create <protocol-id> --file top.json --json
```

```json
{
  "item_positions": {
    "<top-id-1>": 0,
    "<top-id-2>": 1
  }
}
```

```bash
comvenio meeting agenda-reorder <protocol-id> --file order.json --json
comvenio meeting agenda-start <top-id> --protocol <protocol-id> --json
comvenio meeting agenda-complete <top-id> --protocol <protocol-id> --json
```

`--protocol` ist bei einem Übernahme-Tagesordnungspunkt wichtig, weil dieser mehreren Protokollen
zugeordnet sein kann.

Notiz anlegen:

```bash
comvenio meeting note-create --file note.json --json
comvenio meeting note-list <top-id> --json
```

Teilnehmer hinzufügen und validieren:

```bash
comvenio meeting participant-add <protocol-id> --file participant.json --json
comvenio meeting participant-validate <participant-id> --json
```

Entscheidung anlegen und Abstimmung durchführen:

```json
{
  "agenda_item_id": "<top-id>",
  "protocol_id": "<protocol-id>",
  "department_id": "<department-id>",
  "club_id": "<club-id>",
  "title": "Budget 2027 freigeben",
  "decision_type": "voting",
  "voting_visibility": "public",
  "valid_from": "2026-07-13T19:30:00+02:00",
  "voting_eligibility": "all_participants",
  "allow_proxy_voting": true,
  "is_offline_voting": false,
  "allow_multiple_choice": false
}
```

```bash
comvenio meeting decision-create <top-id> --file decision.json --json
comvenio meeting voting-open <decision-id> --json
comvenio meeting vote-cast <decision-id> --file vote.json --json
comvenio meeting voting-close <decision-id> --json
comvenio meeting voting-results <decision-id> --json
comvenio meeting voting-tally <decision-id> --option <option-id> --count -1 --increment --json
comvenio meeting decision-promote <decision-id> --number 12 --json
```

Beschluss genehmigen oder ablehnen:

```bash
comvenio meeting resolution-list --department <department-id> --category satzung --json
comvenio meeting resolution-approve <resolution-id> --json
comvenio meeting resolution-decline <resolution-id> --file decline.json --json
```

Reinschrift-Eintrag mit Anhang anlegen:

```bash
comvenio meeting entry-create <top-id> --file entry.json --json
comvenio meeting attachment-add <entry-id> --file attachment.json --json
```

## Befehle und Actions

<!-- gen:docs befehle -->

**meeting** — vollständig

- `comvenio meeting series list|show|create|update|delete`
- `comvenio meeting protocol list|show|create|update|delete|advance|revert|updates|validation|publish`
- `comvenio meeting agenda list|show|create|update|delete|reorder|start|complete|skip|approve`
- `comvenio meeting note list|list-protocol|create|update|delete`
- `comvenio meeting participant list|add|update|remove|validate|unvalidate`
- `comvenio meeting decision create|agenda|update|cancel|option-add|options-add|promote`
- `comvenio meeting voting open|close|results|eligible|tally`
- `comvenio meeting vote cast|cast-bulk|proxy|proxy-bulk|option-retract|retract`
- `comvenio meeting resolution list|list-protocol|show|history|create|update|approve|decline|delete`
- `comvenio meeting entry list|show|show-agenda|create|update|delete`
- `comvenio meeting attachment list|add|remove`
- Felder und Werte: `comvenio schema meeting --json`
<!-- /gen:docs -->

## Fehler

- `PERMISSION_DENIED` — die Vereinsrolle trägt nicht das Recht `manage_meetings` oder die passende
  granulare Meeting-Berechtigung für die versuchte Aktion. Siehe
  `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — ein Pflichtfeld fehlt oder hat das falsche Format, etwa beim Anlegen einer
  Serie, eines Protokolls, einer Entscheidung oder eines Beschlusses. Siehe
  `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — die angegebene Serien-, Protokoll-, Tagesordnungs-, Entscheidungs- oder Beschluss-ID
  gehört zu keinem sichtbaren Eintrag. Siehe `comvenio help fehler NOT_FOUND`.
- `CONFLICT` — eine Aktion widerspricht dem aktuellen Zustand, etwa ein Phasenwechsel, der die
  nötigen Voraussetzungen noch nicht erfüllt, oder eine Abstimmung, die bereits geschlossen ist.
  Siehe `comvenio help fehler CONFLICT`.
- `SCOPE_REQUIRED` — die Anmeldung wurde ohne den für eine Meeting-Schreibaktion nötigen Scope
  erteilt. Siehe `comvenio help fehler SCOPE_REQUIRED`.
