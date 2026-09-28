---
id: vereinsnews
kategorie: thema
domaenen: [news]
stichwoerter: [news, club news, editorial, publish, video]
---

# Club news

## Purpose

Club news lets a club publish updates as rich-HTML posts, either as a draft or live right away, and either public, member-only or department-only. The serving agent writes the text itself; the CLI does not call any text generator for it.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Sign in with `comvenio login`; which scopes a given action needs is shown by `comvenio action list --json`. A draft (`is_draft=true`) is only visible to authorized editors; a news post only becomes visible to its visibility group once it is published.

## Workflows

### Status and visibility

| Field/flag | Meaning |
|---|---|
| `is_draft=true` / `--draft` | only visible to authorized editors |
| `is_draft=false` / `--publish` | published; the publication timestamp is set |
| `visibility_scope` | `public`, `member` or `department`; default `member` |
| `design_source` | forced to `cli` when applying from a file |
| `is_pinned` / `--pinned` | pins the news post |

Without `--publish`, a newly created news post defaults to a draft.

### Standard workflow: find images → compose news → check → publish

1. Find images in DataShare, or upload them there first (see [dateien.md](dateien.md)).
2. Compose the news declaratively as a file: title, teaser, visibility, cover image and rich-HTML content.
3. Check the preview in the real layout before anything is saved.
4. Create it as a draft or publish it directly.

Pure preview fields such as a short-lived image address, club name, author name and preview date are removed before permanent storage. Images in the HTML need a stable file identifier in addition to the address, so the application can re-sign an expired address automatically.

For a simple news post without an elaborate layout, creating it directly with title and content as flags is enough — both are required; for elaborate rich HTML, the file-based route is clearer.

### Updating without losing the status

The server-side update is a full replacement of all fields. The CLI therefore first reads the existing news post and merges the given changes with the current state — so a news post that is already live is not accidentally turned back into a draft when updated.

### Assigning images from DataShare

A file that was already uploaded before the news post was created can be assigned to it afterwards.

### Rich-HTML rules

- Use a semantic structure: headings, paragraphs, lists, tables, and a captioned image.
- Give images a stable file identifier; a short-lived signed address alone expires.
- For videos, use the standard control with a metadata preview; autoplay is not allowed.
- For YouTube, use only the privacy-friendly embed address `https://www.youtube-nocookie.com/embed/...`.
- Do not embed scripts, event handlers or unknown embedded addresses.

### Generating local videos

Short videos for club news can be rendered locally from templates: an image slideshow, a match result, an announcement teaser, or a generic highlight opener. Each template requires certain mandatory fields and allows further optional fields such as subtitle, overlays, brand color or logo.

The highlight template is deliberately generic (a loopable opener clip with no club-specific code) and can optionally show a partner or catering scene: up to two partner cards with name, subtitle and logo, plus a subtle backdrop motif. This scene only appears when partners are given, and sits between the program list and a closing note; the video becomes automatically about 4.3 seconds longer as a result, with no need to adjust the duration manually.

With an additional option, the CLI uploads the rendered video directly and returns a ready HTML embed snippet for the news post. The video upload limit is 200 MB. Rendering runs locally; missing dependencies are not installed automatically.

## Examples

```bash
comvenio news list --json
comvenio news show <news-id> --json
```

`list` shows, among other things, title, draft/live, design source, visibility and ID.

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

Declarative `news.json`:

```json
{
  "title": "Sommerfest 2026",
  "teaser": "Drei Tage voller Sport und Musik",
  "visibility_scope": "public",
  "cover_image_file_id": "<file-id>",
  "cover_url": "<short-lived-signed-address-preview-only>",
  "content": "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p><figure><img src=\"<signed-address>\" data-comvenio-file-id=\"<file-id>\" alt=\"Festplatz\"></figure>"
}
```

```bash
comvenio news preview --file news.json --json
comvenio news preview --file news.json --open
comvenio news preview --file news.json --local --out ./news-preview.html --json

comvenio news apply --file news.json --draft --json
comvenio news apply --file news.json --publish --json
```

The standard preview generates a short-lived address in the real layout and does not change any news post; `--local` writes an offline approximation that is not authoritative for the live layout.

```bash
comvenio news update <news-id> --title "Neuer Titel" --json
comvenio news update <news-id> --file news.json --json
comvenio news publish <news-id> --json
comvenio news delete <news-id> --json
```

```bash
comvenio data list --context event --context-id <event-id> --json
comvenio data url <file-id> --json
comvenio data download <file-id> --out ./foto.jpg --json

comvenio data update <file-id> --context news --context-id <news-id> --label gallery --json
```

```bash
comvenio news video slideshow --params slideshow.json --out fest.mp4 --json
comvenio news video result --params result.json --out ergebnis.mp4 --json
comvenio news video teaser --params teaser.json --out teaser.mp4 --json
comvenio news video highlight --params highlight.json --out highlight.mp4 --json
```

Templates:

| Template | Required fields | Common optional fields |
|---|---|---|
| `slideshow` | title, at least two images, brand color | subtitle, overlays, duration per image, logo |
| `result` | home and away team, home and away score, brand color | competition, scorers, date, logo |
| `teaser` | title, date, brand color | location, call-to-action text, background image, logo |
| `highlight` | title, brand color | subtitle, club name, date range, kicker text, program list heading, program items (max. 3), partners (max. 2), backdrop motif, note text, closing text, background image, logo, hero image, sponsor logos, custom color scheme |

```json
{
  "title": "Sommerfest",
  "images": ["C:/bilder/1.jpg", "C:/bilder/2.jpg"],
  "brandColor": "#174a7e",
  "durationPerImage": 4
}
```

Highlight with an optional partner scene:

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

```bash
comvenio news video slideshow --params slideshow.json \
  --upload --context news --context-id <news-id> --json
```

## Commands and actions

<!-- gen:docs befehle -->

**news** — complete

- `comvenio news list`
- `comvenio news show`
- `comvenio news create`
- `comvenio news update`
- `comvenio news delete`
- `comvenio news apply`
- `comvenio news preview`
- `comvenio news publish`
- `comvenio news video slideshow|result|teaser`
<!-- /gen:docs -->

## Errors

- `VALIDATION_FAILED` — title, content or a video template field is missing or has the wrong format. More: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — the news ID belongs to no visible post or it was deleted. More: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow creating, editing or publishing news. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the write scope for news. More: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — the news post was changed in the meantime, for example already published or deleted. More: `comvenio help fehler CONFLICT`
