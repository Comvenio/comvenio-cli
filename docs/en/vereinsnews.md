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

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by `comvenio action list --json`. A draft (`is_draft=true`) is only visible to authorized editors; a news post only becomes visible to its visibility group once it is published.

## Workflows

### Status and visibility

| Field | Meaning |
|---|---|
| `operation: draft` (on `create`/`apply`) | only visible to authorized editors; `reversible_write` |
| `operation: publish` (on `create`/`apply`) | published; the publication timestamp is set; `critical_write` |
| `visibility_scope` | `public`, `member` or `department`; default `member` |
| `design_source` | default `cli` |
| `is_pinned` | pins the news post |

### Standard workflow: find images → compose news → check → publish

1. Find images in DataShare, or upload them there first (see [dateien.md](dateien.md)); their file IDs (`cover_image_file_id`, images in the HTML) come from this step.
2. Compose the news post as an object (`cai.news.03.create` or `cai.news.06.apply`): title, content, teaser, visibility, cover image.
3. Check the layout preview before anything is saved — `cai.news.07.preview` renders in the real layout and writes nothing.
4. Create it with `operation: draft` or publish it directly with `operation: publish`. `publish` is `critical_write`: the call first returns only a confirmation preview with `preview_id` and `confirmation_token`; only `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>` with these values carries out the publication.

Pure preview fields such as a short-lived image address, club name and author name are part of the input to `cai.news.07.preview`, not of the permanent news post itself. Images in the HTML need a stable file identifier in addition to the address, so the application can re-sign an expired address automatically.

### Updating an existing news post (`cai.news.04.update`)

`changes` only carries the fields that actually change — everything else stays as is, so a news post that is already live is not reset to a draft. `update` is `critical_write` and runs through the same confirmation preview described above. An already created news post can be published separately with `cai.news.08.publish` (also `critical_write`); `cai.news.05.delete` deletes it (`critical_write`).

### Assigning images from DataShare

A file that was already uploaded before the news post was created can be assigned to it afterward via `cover_image_file_id` or within the HTML content.

### Rich-HTML rules

- Use a semantic structure: headings, paragraphs, lists, tables, and a captioned image.
- Give images a stable file identifier; a short-lived signed address alone expires.
- For videos, use the standard control with a metadata preview; autoplay is not allowed.
- For YouTube, use only the privacy-friendly embed address `https://www.youtube-nocookie.com/embed/...`.
- Do not embed scripts, event handlers or unknown embedded addresses.

### Generating local videos (`cai.news.09.video_slideshow_result_teaser`)

Short videos for club news are rendered from four templates; images are passed as file IDs already uploaded to DataShare. Each template requires a brand color (`brandColor`, hex value) plus further required fields:

| Template | Required fields | Optional fields |
|---|---|---|
| `slideshow` | title, at least two image file IDs, brand color | subtitle, overlays, duration per image (`duration_per_image`), logo file ID |
| `result` | home and away team, home and away score, brand color | competition, scorers, date, logo file ID |
| `teaser` | title, date, brand color | location, call-to-action text, background image file ID, logo file ID |
| `highlight` | title, brand color | subtitle, hero file ID, sponsor file IDs, note text, logo file ID |

Calling with `operation: render` returns a `render_request_id`. With this id, `operation: render_and_upload` uploads the rendered video directly into a context (default `news`) — the video upload limit is 200 MB. `render` is `read`, `render_and_upload` is `reversible_write`.

## Examples

```bash
comvenio action call cai.news.01.list --input '{"operation":"private","limit":50,"offset":0}'
comvenio action call cai.news.01.list --input '{"operation":"public","limit":50,"offset":0}'
comvenio action call cai.news.02.show --input '{"operation":"private","news_id":"<news-id>"}'
```

```bash
comvenio action call cai.news.07.preview --input '{
  "title": "Sommerfest 2026",
  "content": "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p><figure><img src=\"<signed-address>\" data-comvenio-file-id=\"<file-id>\" alt=\"Festplatz\"></figure>",
  "teaser": "Drei Tage voller Sport und Musik",
  "cover_file_id": "<file-id>"
}'
```

```bash
comvenio action call cai.news.03.create --input '{
  "operation": "draft",
  "news": {
    "title": "Sommerfest 2026",
    "teaser": "Drei Tage voller Sport und Musik",
    "visibility_scope": "public",
    "cover_image_file_id": "<file-id>",
    "content": "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p><figure><img src=\"<signed-address>\" data-comvenio-file-id=\"<file-id>\" alt=\"Festplatz\"></figure>"
  }
}'
```

```bash
comvenio action call cai.news.06.apply --input '{"operation":"publish","news":{"title":"Sommerfest 2026","content":"<p>…</p>","visibility_scope":"public"}}'
# response returns preview_id, confirmation_token, target, current state, diff and risk
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.news.04.update --input '{"news_id":"<news-id>","changes":{"title":"Neuer Titel"}}'
comvenio action call cai.news.08.publish --input '{"news_id":"<news-id>"}'
comvenio action call cai.news.05.delete --input '{"news_id":"<news-id>"}'
```

`update`, `publish` and `delete` are `critical_write` and run through the same confirmation preview shown above.

```bash
comvenio action call cai.data.01.list --input '{"context_type":"event","context_id":"<event-id>","limit":50,"offset":0}'
comvenio action call cai.data.04.url --input '{"file_id":"<file-id>"}'
comvenio action call cai.data.03.update --input '{"file_id":"<file-id>","changes":{"context_type":"news","context_id":"<news-id>","context_label":"gallery"}}'
```

```bash
comvenio action call cai.news.09.video_slideshow_result_teaser --input '{
  "operation": "render",
  "template": "slideshow",
  "params": {
    "title": "Sommerfest",
    "brandColor": "#174a7e",
    "image_file_ids": ["<file-id-1>", "<file-id-2>"],
    "duration_per_image": 4
  }
}'
```

```bash
comvenio action call cai.news.09.video_slideshow_result_teaser --input '{
  "operation": "render",
  "template": "highlight",
  "params": {
    "title": "Sommerfest",
    "brandColor": "#174a7e",
    "note_text": "Bis Samstag!"
  }
}'

comvenio action call cai.news.09.video_slideshow_result_teaser --input '{
  "operation": "render_and_upload",
  "template": "slideshow",
  "render_request_id": "<render-request-id>",
  "context_type": "news",
  "context_id": "<news-id>",
  "visibility": "private"
}'
```

## Commands and actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Errors

- `VALIDATION_FAILED` — title, content or a video template field is missing or has the wrong format. More: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — the news ID belongs to no visible post or it was deleted. More: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow creating, editing or publishing news. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the write scope for news. More: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — the news post was changed in the meantime, for example already published or deleted. More: `comvenio help fehler CONFLICT`
- `OUTCOME_UNKNOWN` — for a write action (for example `publish` or `delete`), the server response was missing; before retrying, use a read action to check whether the change already landed. More: `comvenio help fehler OUTCOME_UNKNOWN`
