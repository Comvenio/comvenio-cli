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

Anmeldung mit `comvenio login`; welche Scopes eine einzelne Action braucht, zeigt `comvenio action list --json`. Zum Hochladen in eine bestimmte Abteilung ist dort das Dateirecht nötig — ohne dieses Recht schlägt der Upload in diese Abteilung fehl.

## Abläufe

### Kontext und Sichtbarkeit

Jede Datei kann einem fachlichen Kontext zugeordnet werden: `none`, `club`, `department`, `event`, `object`, `task`, `news`, `paper`, `newsletter`, `tournament`, `protocol`, `agenda_item`, `agenda_item_note`, `protocol_entry`, `user_avatar`, `message_attachment`, `feedback`, `certificate`, `certificate_template`, `letter`, `event_sponsor`, `advertiser`, `sponsorship_product`, `sponsorship_assignment`.

- `context_id` ist die ID der fachlichen Entität.
- `sub_context_id` verfeinert den Kontext, zum Beispiel auf einen Event-Bereich.
- `context_label` gruppiert Dateien innerhalb eines Kontexts, zum Beispiel `gallery`, `title_picture`, `flyer` oder `contract`.
- Die Sichtbarkeit ist `private` (Standard) oder `public`.

### Datei hochladen

1. Zielkontext und, falls nötig, Unterkontext bestimmen (siehe oben).
2. Für die Kontexte `club`, `none` und `department` optional eine Abteilung wählen — ohne `--department` landet die Datei in der **Standard-Abteilung** des Vereins und erscheint dort im DataShare. `--department none` lädt bewusst ohne Abteilung hoch; die Datei ist dann **nicht** im DataShare sichtbar. Andere Kontexte (`event`, `news`, `certificate`, …) folgen eigenen Regeln des Servers.
3. Hochladen — das CLI führt reservieren, direkt hochladen und finalisieren in einem Schritt aus. Das Limit beträgt 200 MB.

Der Upload funktioniert auch aus der eigenständigen Programmversion; Dateiinhalte werden dabei als stabiler Byte-Body übertragen.

### Video für mobiles Autoplay optimieren

Mobile Browser starten große Videos oft nicht automatisch — eine kleine, tonlose MP4 mit vorangestelltem moov-Atom (faststart) läuft dagegen zuverlässig automatisch und stumm an. Mit `--optimize-video` re-encodiert der Upload das Video automatisch, bevor es hochgeladen wird:

1. `ffmpeg` muss verfügbar sein — ohne `ffmpeg` bricht der Befehl vor jedem Upload mit einer klaren Fehlermeldung ab.
2. Nur Video-Dateien (`.mp4`, `.mov`, `.webm`, `.mkv`) lassen sich optimieren; andere Endungen brechen den Befehl vorher ab.
3. Das Original bleibt unverändert auf der Festplatte; die optimierte Kopie entsteht temporär unter demselben Dateinamen und wird nach dem Upload automatisch gelöscht.

Die Optimierung erzeugt H.264 (Profile main, Level 4.0, yuv420p), maximal 1280 px Breite, **ohne Tonspur** und mit vorangestelltem moov-Atom. Die Konsole zeigt die Größenänderung an; bei `--json` steht dieselbe Information zusätzlich strukturiert in der Antwort.

### Kontext nachträglich ändern

Nur angegebene Felder werden geändert. Der Wert `none` setzt ein Feld ausdrücklich auf leer und entfernt so eine bestehende Zuordnung.

### Datei-Lifecycle

- Löschen verschiebt eine Datei standardmäßig in den Papierkorb.
- Wiederherstellen holt eine weich gelöschte Datei zurück.
- Endgültiges Löschen ist nicht rückgängig zu machen.
- Speicherverbrauch und Papierkorb lassen sich je Verein oder je Abteilung abfragen; der Papierkorb einer Abteilung kann gezielt geleert werden.

### Ordner lesen, suchen und verwalten

Ordner lassen sich nach Unterordnern und Dateien auflisten, per Stichwort durchsuchen und über ihren Pfad (Breadcrumb) einordnen. `root` und der Wert `none` stehen bei Ordner-Angaben für die oberste Ebene.

Ordner können angelegt, umbenannt, verschoben, geschützt und gelöscht werden; Löschen und Wiederherstellen wirken standardmäßig rekursiv auf den gesamten Unterbaum.

### Ordnerrechte setzen

Rechte werden einem Ordner als Objekt mit `subject_type`, `subject_id`, `can_read` und `can_write` zugeordnet; aktuell ist ausschließlich `subject_type=user` produktiv. Sobald ein Ordner oder einer seiner Vorfahren explizite Rechte trägt, ist der geschützte Bereich nur für passende Subjekte lesbar oder schreibbar. Unterordner können eigene, abweichende Rechte definieren. Rechte lassen sich auch gesammelt als Liste anlegen.

### Dateien zwischen Event-Bereichen teilen

Ein Titelbild oder ein Flyer kann zusätzlich in mehreren Event-Bereichen erscheinen, ohne dafür mehrfach hochgeladen zu werden. Für mehrere Bereiche gemeinsam liefert eine eigene Abfrage die passende Bild-/Datei-Zuordnung je Bereich; ohne Einschränkung auf bestimmte Bereiche bezieht sich die Abfrage auf den gesamten Club-Kontext.

### Papers veröffentlichen

Ein Paper verknüpft eine vorhandene Datei mit einem veröffentlichbaren Dokument-Datensatz. Dokumenttypen sind `protokoll`, `flyer`, `anleitung`, `zeitung`, `bericht`, `speisekarte` und `sonstiges`; der fachliche Kontext eines Papers ist `event`, `object`, `task`, `supply` oder `custom`. Ein vollständiges Update ersetzt alle Felder — es erwartet dieselben Angaben wie beim Anlegen.

### Mitglieder- und Buchungsdaten exportieren

Nur die Bereiche `members` und `bookings` sowie die Formate `csv` und `xlsx` sind zulässig; andere Werte brechen schon vor der Anfrage mit einem Eingabefehler ab.

## Beispiele

```bash
comvenio data list --context event --context-id <event-id> --json
comvenio data show <file-id> --json
comvenio data url <file-id> --json
comvenio data download <file-id> --out ./bild.jpg --json
```

`list` benötigt immer `--context` und `--context-id`. `url` liefert eine kurzlebige, signierte Adresse; `download` schreibt die Bytes auf den lokalen Pfad.

```bash
comvenio data upload ./bild.jpg \
  --context event \
  --context-id <event-id> \
  --sub-context-id <event-area-id> \
  --department <department-id> \
  --label gallery \
  --public \
  --json
```

```bash
comvenio data upload ./festumzug.mp4 \
  --context event \
  --context-id <event-id> \
  --public \
  --optimize-video \
  --json
```

```bash
comvenio data update <file-id> \
  --context news \
  --context-id <news-id> \
  --label gallery \
  --json

comvenio data update <file-id> --sub-context-id none --label none --json
```

```bash
comvenio data move <file-id> --folder <folder-id> --json
comvenio data move <file-id> --folder root --json
comvenio data visibility <file-id> --visibility public --json
comvenio data delete <file-id> --json
comvenio data restore <file-id> --json
comvenio data delete <file-id> --hard --json

comvenio data stats --json
comvenio data stats --department <department-id> --json
comvenio data empty-trash --department <department-id> --folder root --json
```

```bash
comvenio data children --parent root --json
comvenio data children --parent <folder-id> --include-deleted --json
comvenio data search --query "Vertrag" --folder root --json
comvenio data search --query "Protokoll" --folder <folder-id> --no-recursive --json
comvenio data breadcrumb <folder-id> --json

comvenio data folder-create --name "Vorstand" --parent root --protected true --json
comvenio data folder-rename <folder-id> --name "Vorstand 2027" --json
comvenio data folder-move <folder-id> --parent <new-parent-id> --json
comvenio data folder-protect <folder-id> --protected false --json
comvenio data folder-delete <folder-id> --json
comvenio data folder-restore <folder-id> --json
```

Ordnerrecht als JSON:

```json
{
  "folder_id": "<folder-id>",
  "subject_type": "user",
  "subject_id": "<user-id>",
  "can_read": true,
  "can_write": true
}
```

```bash
comvenio data folder-right-add --file right.json --json
comvenio data folder-rights <folder-id> --json
comvenio data folder-right-delete <right-id> --json
comvenio data folder-right-bulk --file rights.json --json
```

```bash
comvenio data area-share-add <file-id> --area-ids <area-id-1>,<area-id-2> --json
comvenio data area-shares <file-id> --json
comvenio data area-share-remove <file-id> --area-id <area-id-1> --json

comvenio data area-media \
  --area-ids <area-id-1>,<area-id-2> \
  --label title_picture \
  --json
```

Paper-Datensatz als JSON:

```json
{
  "title": "Protokoll der Jahreshauptversammlung",
  "description": "Beschlüsse vom 10. Juli 2026",
  "document_type": "protokoll",
  "context_type": "event",
  "context_id": "<event-id>",
  "file_id": "<file-id>",
  "published_at": "2026-07-13T12:00:00+02:00"
}
```

```bash
comvenio data paper-add --file paper.json --json
comvenio data papers --json
comvenio data papers --context event --context-id <event-id> --type protokoll --json
comvenio data paper-show <paper-id> --json
comvenio data paper-update <paper-id> --file paper.json --json
comvenio data paper-delete <paper-id> --json
```

```bash
comvenio data export members --format csv --out ./mitglieder.csv --json
comvenio data export members --format xlsx --out ./mitglieder.xlsx --json
comvenio data export bookings --format csv --out ./buchungen.csv --json
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**data** — vollständig

- `comvenio data list`
- `comvenio data show`
- `comvenio data update`
- `comvenio data url`
- `comvenio data download`
- `comvenio data upload`
- `comvenio data delete`
- `comvenio data restore`
- `comvenio data move`
- `comvenio data visibility`
- `comvenio data stats`
- `comvenio data empty-trash`
- `comvenio data area-media`
- `comvenio data area-shares`
- `comvenio data area-share-add`
- `comvenio data area-share-remove`
- `comvenio data children`
- `comvenio data search`
- `comvenio data breadcrumb`
- `comvenio data folder-create`
- `comvenio data folder-rename`
- `comvenio data folder-move`
- `comvenio data folder-protect`
- `comvenio data folder-delete`
- `comvenio data folder-restore`
- `comvenio data folder-rights`
- `comvenio data folder-right-add`
- `comvenio data folder-right-bulk`
- `comvenio data folder-right-delete`
- `comvenio data papers`
- `comvenio data paper-show`
- `comvenio data paper-add`
- `comvenio data paper-update`
- `comvenio data paper-delete`
- `comvenio data export members|bookings`
- Felder und Werte: `comvenio schema data --json`
<!-- /gen:docs -->

## Fehler

- `NOT_FOUND` — die Datei-, Ordner- oder Paper-ID gehört zu keinem sichtbaren Eintrag oder wurde entfernt. Mehr: `comvenio help fehler NOT_FOUND`
- `VALIDATION_FAILED` — Kontext, Format oder ein anderes Feld passt nicht zur Action, etwa ein nicht erlaubtes Export-Format. Mehr: `comvenio help fehler VALIDATION_FAILED`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt Upload, Verwaltung oder Zugriff auf einen geschützten Ordner nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Scope für Lesen oder Schreiben von Dateien. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `TENANT_MISMATCH` — die angefragte Datei oder der Ordner stammt aus einem anderen Verein als dem verbundenen. Mehr: `comvenio help fehler TENANT_MISMATCH`
- `CONFLICT` — die Datei oder der Ordner wurde inzwischen geändert, gelöscht oder erlaubt die Aktion in ihrem aktuellen Zustand nicht. Mehr: `comvenio help fehler CONFLICT`
