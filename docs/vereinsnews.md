# Vereinsnews – eigenständige CLI-Referenz

Stand: 13. Juli 2026 · Quelle: `src/commands/news.ts`

Der bedienende Agent schreibt die News selbst als Rich-HTML. Das CLI ruft keinen Textgenerator auf. Der Standard-Workflow ist: Bilder finden, `news.json` komponieren, Vorschau prüfen, als Entwurf anlegen und anschließend veröffentlichen.

## Status und Sichtbarkeit

| Feld/Flag | Bedeutung |
|---|---|
| `is_draft=true` / `--draft` | nur für berechtigte Redakteure sichtbar |
| `is_draft=false` / `--publish` | veröffentlicht; `published_at` wird gesetzt |
| `visibility_scope` | `public`, `member` oder `department`; Standard `member` |
| `design_source` | `apply` erzwingt `cli` |
| `is_pinned` / `--pinned` | News anpinnen |

Ohne `--publish` bleibt eine neu angelegte News standardmäßig ein Entwurf.

## Lesen

```bash
comvenio news list --json
comvenio news show <news-id> --json
```

`list` zeigt unter anderem Titel, Entwurf/Live, Design-Quelle, Sichtbarkeit und ID.

## Direkt anlegen

```bash
comvenio news create \
  --title "Sommerfest 2026" \
  --teaser "Drei Tage voller Sport und Musik" \
  --content "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p>" \
  --visibility public \
  --cover <file-id> \
  --draft \
  --json
```

Pflicht sind `--title` und `--content`. Für aufwendiges Rich-HTML ist `apply --file` übersichtlicher.

## Deklaratives `news.json`

```json
{
  "title": "Sommerfest 2026",
  "teaser": "Drei Tage voller Sport und Musik",
  "visibility_scope": "public",
  "cover_image_file_id": "<file-id>",
  "cover_url": "<kurzlebige-presigned-url-nur-fuer-preview>",
  "content": "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p><figure><img src=\"<presigned-url>\" data-comvenio-file-id=\"<file-id>\" alt=\"Festplatz\"></figure>"
}
```

`cover_url`, `club_name`, `author_name` und `preview_date` sind reine Vorschau-Felder und werden vor dem Persistieren entfernt. Dauerhafte Bilder im HTML brauchen `data-comvenio-file-id`; dadurch kann die Anwendung abgelaufene URLs neu signieren.

## Vorschau und Apply

```bash
comvenio news preview --file news.json --json
comvenio news preview --file news.json --open
comvenio news preview --file news.json --local --out ./news-preview.html --json

comvenio news apply --file news.json --draft --json
comvenio news apply --file news.json --publish --json
```

- Die Standard-Vorschau erzeugt eine kurzlebige URL im echten Layout und verändert keine News.
- `--local` schreibt eine Offline-Näherung; sie ist nicht maßgeblich für das Live-Layout.
- `apply` erzwingt `design_source=cli`.
- Erst Vorschau prüfen, dann `apply`.

## Aktualisieren, veröffentlichen, löschen

```bash
comvenio news update <news-id> --title "Neuer Titel" --json
comvenio news update <news-id> --file news.json --json
comvenio news publish <news-id> --json
comvenio news delete <news-id> --json
```

Das Backend-Update ist ein Vollersatz. Das CLI liest deshalb zuerst die vorhandene News und merged angegebene Felder, damit etwa eine Live-News nicht unbeabsichtigt wieder zum Entwurf wird.

## Bilder aus DataShare

```bash
comvenio data list --context event --context-id <event-id> --json
comvenio data url <file-id> --json
comvenio data download <file-id> --out ./foto.jpg --json
```

Wenn eine Datei vor der News-Erstellung hochgeladen wurde, kann sie danach zugeordnet werden:

```bash
comvenio data update <file-id> --context news --context-id <news-id> --label gallery --json
```

Der vollständige Datei- und Ordner-Workflow steht in [`dateien.md`](dateien.md).

## Lokale Videos

```bash
comvenio news video slideshow --params slideshow.json --out fest.mp4 --json
comvenio news video result --params result.json --out ergebnis.mp4 --json
comvenio news video teaser --params teaser.json --out teaser.mp4 --json
comvenio news video highlight --params highlight.json --out highlight.mp4 --json
```

Vorlagen:

| Template | Pflichtfelder | Häufige optionale Felder |
|---|---|---|
| `slideshow` | `title`, `images[]` (mindestens 2), `brandColor` | `subtitle`, `overlays[]`, `durationPerImage`, `logoPath` |
| `result` | `homeTeam`, `awayTeam`, `homeScore`, `awayScore`, `brandColor` | `competition`, `scorers[]`, `date`, `logoPath` |
| `teaser` | `title`, `date`, `brandColor` | `location`, `ctaText`, `backgroundImage`, `logoPath` |
| `highlight` | `title`, `brandColor` | `subtitle`, `orgName`, `dateRange`, `kicker`, `itemsHeading`, `items[]` (max. 3), `partners[]` (max. 2, siehe unten), `partnersBackdrop`, `noteText`, `closingText`, `background`, `logo`, `heroImage`, `sponsors[]`, `greenColor`/`creamColor`/`goldColor`, `logoPath` |

`highlight` ist generisch (loopfähiger Auftakt-Clip, kein vereinsspezifischer Code) und kann
optional eine **Partner-/Gastro-Szene** zeigen: `partners[]` ist ein Array aus max. 2 Karten
`{ name, subtitle?, logo? }` (`logo` ist ein lokaler Bildpfad), `partnersBackdrop` ein optionales,
dezentes Deko-Motiv im Hintergrund der Karten. Die Szene erscheint nur, wenn `partners` gesetzt
ist, und liegt zwischen der Programm-Liste (`items[]`) und dem Hinweistext (`noteText`); das Video
wird dadurch automatisch ca. 4,3 Sekunden länger — kein manuelles `--duration` nötig.

Beispiel:

```json
{
  "title": "Sommerfest",
  "images": ["C:/bilder/1.jpg", "C:/bilder/2.jpg"],
  "brandColor": "#174a7e",
  "durationPerImage": 4
}
```

Beispiel `highlight` mit optionaler Partner-Szene:

```json
{
  "title": "Sommerfest",
  "brandColor": "#174a7e",
  "items": [{ "label": "Samstag", "text": "Fassanstich um 18 Uhr" }],
  "partners": [
    { "name": "Partnername", "subtitle": "Kurzbeschreibung", "logo": "C:/bilder/partner-logo.png" }
  ],
  "partnersBackdrop": "C:/bilder/partner-backdrop.png"
}
```

Mit `--upload` lädt das CLI das gerenderte MP4 hoch und liefert ein HTML-Embed-Snippet:

```bash
comvenio news video slideshow --params slideshow.json \
  --upload --context news --context-id <news-id> --json
```

Das Video-Upload-Limit beträgt 200 MB. Das Rendern läuft lokal im `remotion/`-Unterprojekt; fehlende Abhängigkeiten werden nicht still installiert.

## Rich-HTML-Regeln

- Semantische Struktur mit Überschriften, Absätzen, Listen, Tabellen, `figure` und `figcaption` verwenden.
- Bilder mit stabilem `data-comvenio-file-id` versehen; eine presigned URL allein läuft ab.
- Für Videos `<video controls preload="metadata">` verwenden; `autoplay` ist nicht zulässig.
- Für YouTube ausschließlich `https://www.youtube-nocookie.com/embed/...` verwenden.
- Keine Skripte, Event-Handler oder unbekannte iframe-Hosts einbetten.
