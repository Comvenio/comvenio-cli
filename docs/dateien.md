# DataShare – Dateien, Ordner und Papers

Stand: 13. Juli 2026 · Quellen: `src/commands/data.ts`, `src/util/upload.ts`, `src/schema/data.json`

DataShare verwaltet Club-Dateien, Ordner, Papierkorb, Ordnerrechte, Event-Bereichsfreigaben und veröffentlichbare Dokumente („Papers“). Der bedienende Agent analysiert heruntergeladene Inhalte selbst; es gibt keine `analyze`-Action.

## Kontext und Sichtbarkeit

Dateien können einem fachlichen Kontext zugeordnet werden:

`none`, `club`, `department`, `event`, `object`, `task`, `news`, `paper`, `newsletter`, `tournament`, `protocol`, `agenda_item`, `agenda_item_note`, `protocol_entry`, `user_avatar`, `message_attachment`, `feedback`, `certificate`, `certificate_template`, `letter`, `event_sponsor`, `advertiser`, `sponsorship_product`, `sponsorship_assignment`.

- `context_id` ist die ID der fachlichen Entität.
- `sub_context_id` verfeinert sie, zum Beispiel auf einen Event-Bereich.
- `context_label` gruppiert Dateien innerhalb eines Kontexts, zum Beispiel `gallery`, `title_picture`, `flyer` oder `contract`.
- Sichtbarkeit ist `private` (Default) oder `public`.

## Dateien lesen

```bash
comvenio data list --context event --context-id <event-id> --json
comvenio data show <file-id> --json
comvenio data url <file-id> --json
comvenio data download <file-id> --out ./bild.jpg --json
```

`list` benötigt immer `--context` und `--context-id`. `url` liefert eine kurzlebige presigned URL, `download` schreibt die Bytes auf den lokalen Pfad.

## Upload

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

Das CLI führt den vollständigen Presign-Flow aus: reservieren, direkt hochladen, finalisieren. Das Limit beträgt 200 MB. `--sub-context-id` und `--department` werden im Upload-Vertrag mitgesendet. Der Upload funktioniert auch aus der kompilierten Standalone-Binary; Dateiinhalte werden als stabiler Byte-Body übertragen.

### Video-Optimierung fürs mobile Autoplay (`--optimize-video`)

Mobile Chrome (und Safari/iOS) autoplayen große Videos oft nicht — eine kleine, audio-freie MP4 mit vorangestelltem moov-Atom (faststart) läuft dagegen zuverlässig inline/muted an. `--optimize-video` re-encodiert das Video vor dem Hochladen automatisch:

```bash
comvenio data upload ./festumzug.mp4 \
  --context event \
  --context-id <event-id> \
  --public \
  --optimize-video \
  --json
```

Voraussetzung: `ffmpeg` muss im PATH verfügbar sein (`winget install Gyan.FFmpeg`). Ohne `ffmpeg` bricht der Befehl mit einer klaren Fehlermeldung ab, bevor irgendetwas hochgeladen wird.

Das Original bleibt auf der Festplatte unangetastet — die optimierte Kopie entsteht in einem temporären Verzeichnis (gleicher Dateiname) und wird nach dem Upload automatisch gelöscht. Optimierung: H.264 (Profile main, Level 4.0, yuv420p), maximal 1280 px Breite, **ohne Tonspur** (Pflicht für stummes Autoplay) und `+faststart`. `--optimize-video` funktioniert nur mit Video-Dateien (`.mp4`/`.mov`/`.webm`/`.mkv`) — bei anderen Endungen bricht der Befehl vor dem Upload ab. Die Konsole zeigt „Video optimiert: X MB -> Y MB"; bei `--json` steht die gleiche Information zusätzlich unter `optimized.inputSizeBytes`/`optimized.outputSizeBytes` in der Antwort.

## Kontext nachträglich ändern

```bash
comvenio data update <file-id> \
  --context news \
  --context-id <news-id> \
  --label gallery \
  --json
```

Nur angegebene Felder werden geändert. Der Wert `none` sendet explizit `null` und entfernt die Zuordnung:

```bash
comvenio data update <file-id> --sub-context-id none --label none --json
```

## Datei-Lifecycle

```bash
comvenio data move <file-id> --folder <folder-id> --json
comvenio data move <file-id> --folder root --json
comvenio data visibility <file-id> --visibility public --json
comvenio data delete <file-id> --json
comvenio data restore <file-id> --json
comvenio data delete <file-id> --hard --json
```

- `delete` verschiebt standardmäßig in den Papierkorb.
- `restore` stellt eine weich gelöschte Datei wieder her.
- `--hard` löscht endgültig und ist nicht rückgängig zu machen.

Speicher und Papierkorb:

```bash
comvenio data stats --json
comvenio data stats --department <department-id> --json
comvenio data empty-trash --department <department-id> --folder root --json
```

## Ordner lesen und suchen

```bash
comvenio data children --parent root --json
comvenio data children --parent <folder-id> --include-deleted --json
comvenio data search --query "Vertrag" --folder root --json
comvenio data search --query "Protokoll" --folder <folder-id> --no-recursive --json
comvenio data breadcrumb <folder-id> --json
```

`children` liefert Unterordner und Dateien. `search` liefert Treffer mit Pfadinformation. `root` und `none` stehen bei Ordner-Flags für die oberste Ebene.

## Ordner verwalten

```bash
comvenio data folder-create --name "Vorstand" --parent root --protected true --json
comvenio data folder-rename <folder-id> --name "Vorstand 2027" --json
comvenio data folder-move <folder-id> --parent <new-parent-id> --json
comvenio data folder-protect <folder-id> --protected false --json
comvenio data folder-delete <folder-id> --json
comvenio data folder-restore <folder-id> --json
```

Löschen und Wiederherstellen sind standardmäßig rekursiv. `--no-recursive` schaltet das ab.

## Ordnerrechte

Rechte werden als JSON übergeben. Aktuell ist `subject_type=user` produktiv; `group` ist reserviert.

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
```

Bulk-Create erwartet ein JSON-Array aus denselben Objekten:

```bash
comvenio data folder-right-bulk --file rights.json --json
```

Sobald ein Ordner oder ein Vorfahre explizite Rechte besitzt, ist der geschützte Bereich nur für passende Subjekte lesbar/schreibbar. Unterordner können eigene Rechte definieren.

## Dateien zwischen Event-Bereichen teilen

Ein Titelbild oder Flyer kann zusätzlich in mehreren Event-Bereichen erscheinen:

```bash
comvenio data area-share-add <file-id> --area-ids <area-id-1>,<area-id-2> --json
comvenio data area-shares <file-id> --json
comvenio data area-share-remove <file-id> --area-id <area-id-1> --json
```

Die Media-Map für mehrere Bereiche:

```bash
comvenio data area-media \
  --area-ids <area-id-1>,<area-id-2> \
  --label title_picture \
  --json
```

`area-media` benötigt den Club-Kontext; ohne `--area-ids` wird die Anfrage nicht auf einzelne Bereiche eingeschränkt.

## Papers

Papers verknüpfen eine vorhandene Datei mit einem veröffentlichbaren Dokument-Metadatensatz.

Document Types: `protokoll`, `flyer`, `anleitung`, `zeitung`, `bericht`, `speisekarte`, `sonstiges`.

Paper Context Types: `event`, `object`, `task`, `supply`, `custom`.

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

`paper-update` ist ein Vollersatz und erwartet dieselben Felder wie `paper-add`.

## CSV/XLSX-Export

```bash
comvenio data export members --format csv --out ./mitglieder.csv --json
comvenio data export members --format xlsx --out ./mitglieder.xlsx --json
comvenio data export bookings --format csv --out ./buchungen.csv --json
```

Nur `members` und `bookings` sowie die Formate `csv` und `xlsx` sind zulässig. Andere Werte brechen vor dem Request mit einem Eingabefehler ab.

## Bewusste Grenze

DataShare führt keine Inhaltsanalyse aus. Der Agent lädt die Datei und wertet sie selbst aus. Publikations- und Newsletter-spezifische Fachworkflows bleiben in ihren eigenen Domänen; DataShare verwaltet deren Dateien und Kontexte.
