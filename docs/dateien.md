---
id: dateien
kategorie: thema
domaenen: [data]
stichwoerter: [dateien, ordner, papierkorb, upload, freigaben, papers, export]
---

# DataShare — Dateien, Ordner und Papers

## Wozu

DataShare verwaltet die Dateien, Ordner und den Papierkorb eines Vereins, ordnet sie einem fachlichen Kontext wie einer Veranstaltung oder einer News zu und macht ausgewählte Dokumente als veröffentlichbare „Papers" verfügbar. Den Inhalt einer heruntergeladenen Datei wertet der bedienende Agent selbst aus — dafür gibt es keine eigene Action.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen, zeigt `comvenio action list --json`. Zum Hochladen in eine bestimmte Abteilung ist dort das Dateirecht nötig — ohne dieses Recht schlägt der Upload in diese Abteilung fehl.

## Abläufe

### Kontext und Sichtbarkeit

Jede Datei kann einem fachlichen Kontext zugeordnet werden: `none`, `club`, `department`, `event`, `object`, `task`, `news`, `paper`, `newsletter`, `tournament`, `protocol`, `agenda_item`, `agenda_item_note`, `protocol_entry`, `user_avatar`, `message_attachment`, `feedback`, `certificate`, `certificate_template`, `letter`, `event_sponsor`, `advertiser`, `sponsorship_product`, `sponsorship_assignment`.

- `context_id` ist die ID der fachlichen Entität.
- `sub_context_id` verfeinert den Kontext, zum Beispiel auf einen Event-Bereich.
- `context_label` gruppiert Dateien innerhalb eines Kontexts, zum Beispiel `gallery`, `title_picture`, `flyer` oder `contract`.
- Die Sichtbarkeit ist `private` (Standard) oder `public`.
- `department_id` grenzt eine Abfrage oder eine Änderung zusätzlich auf eine Abteilung ein; ohne Angabe gilt der gesamte Club-Kontext.

### Datei hochladen (`cai.data.06.upload`)

1. Zielkontext und, falls nötig, Unterkontext bestimmen (siehe oben).
2. Für die Kontexte `club`, `none` und `department` optional eine Abteilung über `department_id` wählen — ohne Angabe landet die Datei in der **Standard-Abteilung** des Vereins und erscheint dort im DataShare. Andere Kontexte (`event`, `news`, `certificate`, …) folgen eigenen Regeln des Servers.
3. Die Action überträgt keine Datei von deinem Rechner. `source_file_id` ist die Kennung einer Datei, die schon in der Dateiablage des Vereins liegt (in der Web-App hochgeladen; die Kennung zeigt `cai.data.01.list`). `filename`, `content_type` und `expected_size` müssen zu dieser Datei passen. Das Limit beträgt 200 MB. Eine Datei direkt vom eigenen Rechner hochladen: Noch nicht als Action verfügbar — in der Web-App erledigen.

### Video für mobiles Autoplay optimieren

Noch nicht als Action verfügbar — in der Web-App erledigen.

### Kontext nachträglich ändern (`cai.data.03.update`)

`changes` überträgt nur die tatsächlich zu ändernden Felder (`context_type`, `context_id`, `sub_context_id`, `context_label`); mindestens ein Feld ist Pflicht. Der Wert `null` setzt ein Feld ausdrücklich auf leer und entfernt so eine bestehende Zuordnung.

### Datei-Lifecycle

- `cai.data.09.move` verschiebt eine Datei in einen anderen Ordner; `target_folder_id: null` verschiebt sie auf die oberste Ebene.
- `cai.data.10.visibility` setzt die Sichtbarkeit über `operation`: `private` ist ein normaler Schreibzugriff, `public` gilt als `critical_write`.
- `cai.data.07.delete` verschiebt eine Datei standardmäßig in den Papierkorb (`operation: soft_delete`); endgültiges Löschen (`operation: hard_delete`) ist `critical_write` und nicht rückgängig zu machen — der Aufruf liefert zunächst nur eine Vorschau mit `preview_id` und `confirmation_token`, erst `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>` mit diesen Werten führt die Löschung aus.
- `cai.data.08.restore` holt eine weich gelöschte Datei zurück.
- `cai.data.11.stats` liefert Speicherverbrauch je Verein oder je Abteilung.
- `cai.data.12.empty_trash` (`critical_write`) leert den Papierkorb einer Abteilung gezielt und läuft über dieselbe Vorschau-/Bestätigungsfolge.

### Ordner lesen, suchen und verwalten

`cai.data.17.children` listet Unterordner und Dateien, `cai.data.18.search` durchsucht einen Ordner per Stichwort, `cai.data.19.breadcrumb` liefert den Pfad. `root` und der Wert `null` stehen bei Ordner-Angaben für die oberste Ebene.

Ordner lassen sich anlegen (`cai.data.20.folder_create`), umbenennen (`cai.data.21.folder_rename`), verschieben (`cai.data.22.folder_move`) und schützen (`cai.data.23.folder_protect`) — alles `reversible_write`. Löschen (`cai.data.24.folder_delete`) ist `critical_write` und wirkt standardmäßig rekursiv auf den gesamten Unterbaum; Wiederherstellen (`cai.data.25.folder_restore`) ist wieder `reversible_write`.

### Ordnerrechte setzen

Rechte werden einem Ordner als Objekt mit `subject_type`, `subject_id`, `can_read` und `can_write` zugeordnet; aktuell ist ausschließlich `subject_type=user` produktiv, `group` ist für später reserviert. Sobald ein Ordner oder einer seiner Vorfahren explizite Rechte trägt, ist der geschützte Bereich nur für passende Subjekte lesbar oder schreibbar. `cai.data.26.folder_rights` liest die Rechte eines Ordners, `cai.data.27.folder_right_add` fügt eines hinzu (`reversible_write`). Ein gesammeltes Anlegen als Liste (`cai.data.28.folder_right_bulk`) und das Entfernen eines einzelnen Rechts (`cai.data.29.folder_right_delete`) sind jeweils `critical_write` und laufen über die Vorschau-/Bestätigungsfolge.

### Dateien zwischen Event-Bereichen teilen

Ein Titelbild oder ein Flyer kann zusätzlich in mehreren Event-Bereichen erscheinen, ohne dafür mehrfach hochgeladen zu werden. `cai.data.13.area_media` liefert für mehrere Bereiche gemeinsam die passende Bild-/Datei-Zuordnung je Bereich. `cai.data.14.area_shares` zeigt die Bereiche einer Datei, `cai.data.15.area_share_add` ergänzt welche (`reversible_write`), `cai.data.16.area_share_remove` entfernt eines (`critical_write`).

### Papers veröffentlichen

Ein Paper verknüpft eine vorhandene Datei mit einem veröffentlichbaren Dokument-Datensatz. Dokumenttypen sind `protokoll`, `flyer`, `anleitung`, `zeitung`, `bericht`, `speisekarte` und `sonstiges`; der fachliche Kontext eines Papers ist `event`, `object`, `task`, `supply` oder `custom`. `cai.data.30.papers` listet, `cai.data.31.paper_show` zeigt ein Paper, `cai.data.32.paper_add` legt eines an (`reversible_write`), `cai.data.33.paper_update` ersetzt es vollständig — es erwartet dieselben Angaben wie beim Anlegen. `cai.data.34.paper_delete` ist `critical_write`.

### Mitglieder- und Buchungsdaten exportieren

`cai.data.35.export_members_bookings` liefert über `operation` entweder `members` oder `bookings`, jeweils im Format `csv` oder `xlsx`; beide Ausprägungen sind `critical_write` und laufen über die Vorschau-/Bestätigungsfolge.

### Abgrenzung

Fachworkflows, die eigene Publikations- oder Newsletter-Regeln haben, bleiben in ihren eigenen
Themenbereichen; DataShare verwaltet nur deren Dateien und Kontexte, nicht die fachliche Logik
dahinter.

## Beispiele

```bash
comvenio action list --json

comvenio action call cai.data.01.list \
  --input '{"context_type":"event","context_id":"<event-id>","include_deleted":false,"limit":50,"offset":0}'
comvenio action call cai.data.02.show --input '{"file_id":"<file-id>"}'
comvenio action call cai.data.04.url --input '{"file_id":"<file-id>"}'
comvenio action call cai.data.05.download --input '{"file_id":"<file-id>","preferred_name":"bild.jpg"}'
```

```bash
comvenio action call cai.data.06.upload --input '{
  "source_file_id": "<file-id>",
  "filename": "bild.jpg",
  "content_type": "image/jpeg",
  "expected_size": 245000,
  "context_type": "event",
  "context_id": "<event-id>",
  "sub_context_id": "<event-area-id>",
  "context_label": "gallery",
  "visibility": "public",
  "department_id": "<department-id>"
}'
```

```bash
comvenio action call cai.data.03.update --input '{
  "file_id": "<file-id>",
  "changes": { "context_type": "news", "context_id": "<news-id>", "context_label": "gallery" }
}'

comvenio action call cai.data.03.update --input '{
  "file_id": "<file-id>",
  "changes": { "sub_context_id": null, "context_label": null }
}'
```

```bash
comvenio action call cai.data.09.move --input '{"file_id":"<file-id>","target_folder_id":"<folder-id>"}'
comvenio action call cai.data.09.move --input '{"file_id":"<file-id>","target_folder_id":null}'
comvenio action call cai.data.10.visibility --input '{"operation":"public","file_id":"<file-id>"}'
comvenio action call cai.data.07.delete --input '{"operation":"soft_delete","file_id":"<file-id>"}'
comvenio action call cai.data.08.restore --input '{"file_id":"<file-id>"}'

comvenio action call cai.data.07.delete --input '{"operation":"hard_delete","file_id":"<file-id>"}'
# Antwort liefert preview_id, confirmation_token, Ziel, Ist-Stand, Unterschied und Risiko
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>

comvenio action call cai.data.11.stats --input '{}'
comvenio action call cai.data.11.stats --input '{"department_id":"<department-id>"}'
comvenio action call cai.data.12.empty_trash --input '{"department_id":"<department-id>","folder_id":null}'
```

```bash
comvenio action call cai.data.17.children --input '{"parent_id":null,"include_deleted":false,"limit":50,"offset":0}'
comvenio action call cai.data.18.search --input '{"folder_id":null,"query":"Vertrag","recursive":true,"limit":50,"offset":0}'
comvenio action call cai.data.19.breadcrumb --input '{"folder_id":"<folder-id>"}'

comvenio action call cai.data.20.folder_create --input '{"parent_id":null,"name":"Vorstand","is_protected":true}'
comvenio action call cai.data.21.folder_rename --input '{"folder_id":"<folder-id>","new_name":"Vorstand 2027"}'
comvenio action call cai.data.22.folder_move --input '{"folder_id":"<folder-id>","new_parent_id":"<new-parent-id>"}'
comvenio action call cai.data.23.folder_protect --input '{"folder_id":"<folder-id>","protect":false}'
comvenio action call cai.data.24.folder_delete --input '{"folder_id":"<folder-id>","recursive":true}'
comvenio action call cai.data.25.folder_restore --input '{"folder_id":"<folder-id>","recursive":true}'
```

Ordnerrecht als Eingabe:

```bash
comvenio action call cai.data.27.folder_right_add --input '{
  "right": {
    "folder_id": "<folder-id>",
    "subject_type": "user",
    "subject_id": "<user-id>",
    "can_read": true,
    "can_write": true
  }
}'

comvenio action call cai.data.26.folder_rights --input '{"folder_id":"<folder-id>"}'
comvenio action call cai.data.29.folder_right_delete --input '{"right_id":"<right-id>"}'
comvenio action call cai.data.28.folder_right_bulk --input '{
  "rights": [
    { "folder_id": "<folder-id>", "subject_type": "user", "subject_id": "<user-id>", "can_read": true, "can_write": false }
  ]
}'
```

```bash
comvenio action call cai.data.15.area_share_add --input '{"file_id":"<file-id>","area_ids":["<area-id-1>","<area-id-2>"]}'
comvenio action call cai.data.14.area_shares --input '{"file_id":"<file-id>"}'
comvenio action call cai.data.16.area_share_remove --input '{"file_id":"<file-id>","area_id":"<area-id-1>"}'

comvenio action call cai.data.13.area_media --input '{"area_ids":["<area-id-1>","<area-id-2>"],"label":"title_picture"}'
```

Paper-Datensatz als Eingabe:

```bash
comvenio action call cai.data.32.paper_add --input '{
  "paper": {
    "title": "Protokoll der Jahreshauptversammlung",
    "description": "Beschlüsse vom 10. Juli 2026",
    "document_type": "protokoll",
    "context_type": "event",
    "context_id": "<event-id>",
    "file_id": "<file-id>",
    "published_at": "2026-07-13T12:00:00+02:00"
  }
}'

comvenio action call cai.data.30.papers --input '{"context_type":"event","context_id":"<event-id>","document_type":"protokoll","limit":50,"offset":0}'
comvenio action call cai.data.31.paper_show --input '{"paper_id":"<paper-id>"}'
comvenio action call cai.data.34.paper_delete --input '{"paper_id":"<paper-id>"}'
```

```bash
comvenio action call cai.data.35.export_members_bookings --input '{"operation":"members","format":"csv"}'
comvenio action call cai.data.35.export_members_bookings --input '{"operation":"bookings","format":"xlsx"}'
```

## Befehle und Actions

<!-- gen:docs befehle -->

**data**

- `cai.data.01.list` — list (lesen)
- `cai.data.02.show` — show (lesen)
- `cai.data.03.update` — update (ändern)
- `cai.data.04.url` — reference (lesen)
- `cai.data.05.download` — download (lesen)
- `cai.data.06.upload` — upload (ändern)
- `cai.data.07.delete` — soft_delete, hard_delete (ändern, ändern mit Bestätigung)
- `cai.data.08.restore` — restore (ändern)
- `cai.data.09.move` — move (ändern)
- `cai.data.10.visibility` — private, public (ändern, ändern mit Bestätigung)
- `cai.data.11.stats` — stats (lesen)
- `cai.data.12.empty_trash` — empty (ändern mit Bestätigung)
- `cai.data.13.area_media` — list (lesen)
- `cai.data.14.area_shares` — list (lesen)
- `cai.data.15.area_share_add` — add (ändern)
- `cai.data.16.area_share_remove` — remove (ändern mit Bestätigung)
- `cai.data.17.children` — list (lesen)
- `cai.data.18.search` — search (lesen)
- `cai.data.19.breadcrumb` — show (lesen)
- `cai.data.20.folder_create` — create (ändern)
- `cai.data.21.folder_rename` — rename (ändern)
- `cai.data.22.folder_move` — move (ändern)
- `cai.data.23.folder_protect` — protect (ändern)
- `cai.data.24.folder_delete` — delete (ändern mit Bestätigung)
- `cai.data.25.folder_restore` — restore (ändern)
- `cai.data.26.folder_rights` — list (lesen)
- `cai.data.27.folder_right_add` — add (ändern)
- `cai.data.28.folder_right_bulk` — bulk (ändern mit Bestätigung)
- `cai.data.29.folder_right_delete` — delete (ändern mit Bestätigung)
- `cai.data.30.papers` — list (lesen)
- `cai.data.31.paper_show` — show (lesen)
- `cai.data.32.paper_add` — create (ändern)
- `cai.data.33.paper_update` — update (ändern)
- `cai.data.34.paper_delete` — delete (ändern mit Bestätigung)
- `cai.data.35.export_members_bookings` — members, bookings (ändern mit Bestätigung)
- Felder und Werte: `comvenio schema data --json`
<!-- /gen:docs -->

## Fehler

- `NOT_FOUND` — die Datei-, Ordner- oder Paper-ID gehört zu keinem sichtbaren Eintrag oder wurde entfernt. Mehr: `comvenio help fehler NOT_FOUND`
- `VALIDATION_FAILED` — Kontext, Format oder ein anderes Feld passt nicht zur Action, etwa ein nicht erlaubtes Export-Format. Mehr: `comvenio help fehler VALIDATION_FAILED`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt Upload, Verwaltung oder Zugriff auf einen geschützten Ordner nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Scope für Lesen oder Schreiben von Dateien. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `TENANT_MISMATCH` — die angefragte Datei oder der Ordner stammt aus einem anderen Verein als dem verbundenen. Mehr: `comvenio help fehler TENANT_MISMATCH`
- `CONFLICT` — die Datei oder der Ordner wurde inzwischen geändert, gelöscht oder erlaubt die Aktion in ihrem aktuellen Zustand nicht. Mehr: `comvenio help fehler CONFLICT`
- `OUTCOME_UNKNOWN` — bei einer ändernden Action blieb die Serverantwort aus; vor einer Wiederholung mit einer lesenden Action prüfen, ob die Änderung schon angekommen ist. Mehr: `comvenio help fehler OUTCOME_UNKNOWN`
