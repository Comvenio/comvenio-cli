---
id: dateien
kategorie: thema
domaenen: [data]
stichwoerter: [files, folders, trash, upload, sharing, papers, export]
---

# DataShare — Files, Folders and Papers

## Purpose

DataShare manages a club's files, folders and trash, assigns them to a business context such as an event or a news post, and makes selected documents available as publishable "papers". The serving agent analyzes a downloaded file's content itself — there is no separate action for that.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Sign in with `comvenio login`; which scopes a given action needs is shown by `comvenio action list --json`. Uploading into a specific department requires the file right there — without it, an upload into that department fails.

## Workflows

### Context and visibility

Every file can be assigned to a business context: `none`, `club`, `department`, `event`, `object`, `task`, `news`, `paper`, `newsletter`, `tournament`, `protocol`, `agenda_item`, `agenda_item_note`, `protocol_entry`, `user_avatar`, `message_attachment`, `feedback`, `certificate`, `certificate_template`, `letter`, `event_sponsor`, `advertiser`, `sponsorship_product`, `sponsorship_assignment`.

- `context_id` is the ID of the business entity.
- `sub_context_id` refines the context, for example to a specific event area.
- `context_label` groups files within a context, for example `gallery`, `title_picture`, `flyer` or `contract`.
- Visibility is `private` (default) or `public`.

### Uploading a file

1. Determine the target context and, if needed, the sub-context (see above).
2. For the contexts `club`, `none` and `department`, optionally choose a department — without `--department`, the file lands in the club's **default department** and appears there in DataShare. `--department none` deliberately uploads without a department; the file is then **not** visible in DataShare. Other contexts (`event`, `news`, `certificate`, …) follow their own server-side rules.
3. Upload — the CLI runs reserve, direct upload and finalize in one step. The limit is 200 MB.

Upload also works from the standalone build; file contents are transferred as a stable byte body.

### Optimizing video for mobile autoplay

Mobile browsers often don't autoplay large videos — a small, silent MP4 with a moov atom moved to the front (faststart) plays automatically and muted reliably instead. With `--optimize-video`, the upload re-encodes the video automatically before it is uploaded:

1. `ffmpeg` must be available (on Windows, for example via `winget install Gyan.FFmpeg`) — without `ffmpeg` the command aborts with a clear error before any upload happens.
2. Only video files (`.mp4`, `.mov`, `.webm`, `.mkv`) can be optimized; other extensions abort the command beforehand.
3. The original file on disk stays untouched; the optimized copy is created temporarily under the same file name and is deleted automatically after the upload.

Optimization produces H.264 (profile main, level 4.0, yuv420p), a maximum width of 1280 px, **no audio track**, and a moved-forward moov atom. The console shows the size change as "Video optimiert: X MB -> Y MB"; with `--json` the same information also appears structured under `optimized.inputSizeBytes` and `optimized.outputSizeBytes` in the response.

### Changing the context afterwards

Only the given fields are changed. The value `none` explicitly sets a field to empty and removes an existing assignment.

### File lifecycle

- Deleting moves a file to the trash by default.
- Restoring brings back a soft-deleted file.
- A hard delete is permanent and cannot be undone.
- Storage usage and trash can be queried per club or per department; a department's trash can be emptied specifically.

### Reading, searching and managing folders

Folders can be listed by subfolder and file, searched by keyword, and located by their path (breadcrumb). `root` and the value `none` stand for the top level in folder arguments.

Folders can be created, renamed, moved, protected and deleted; deleting and restoring act recursively on the whole subtree by default.

### Setting folder rights

Rights are assigned to a folder as an object with `subject_type`, `subject_id`, `can_read` and `can_write`; currently only `subject_type=user` is in production use, `group` is reserved for later. As soon as a folder or one of its ancestors carries explicit rights, the protected area is only readable or writable for matching subjects. Subfolders can define their own, different rights. Rights can also be created in bulk as a list.

### Sharing files between event areas

A title picture or a flyer can additionally appear in several event areas without being uploaded multiple times. For several areas at once, a dedicated query returns the matching image/file assignment per area; without restricting to specific areas, the query covers the entire club context.

### Publishing papers

A paper links an existing file to a publishable document record. Document types are `protokoll`, `flyer`, `anleitung`, `zeitung`, `bericht`, `speisekarte` and `sonstiges`; a paper's business context is `event`, `object`, `task`, `supply` or `custom`. A full update replaces all fields — it expects the same data as creating one.

### Exporting member and booking data

Only the areas `members` and `bookings`, and the formats `csv` and `xlsx`, are allowed; other values fail with an input error before the request is sent.

### Scope

Workflows with their own publication or newsletter rules stay in their own topic areas; DataShare
only manages their files and contexts, not the business logic behind them.

## Examples

```bash
comvenio data list --context event --context-id <event-id> --json
comvenio data show <file-id> --json
comvenio data url <file-id> --json
comvenio data download <file-id> --out ./bild.jpg --json
```

`list` always needs `--context` and `--context-id`. `url` returns a short-lived signed address; `download` writes the bytes to the local path.

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

Folder right as JSON:

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

Paper record as JSON:

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

## Commands and actions

<!-- gen:docs befehle -->

**data** — complete

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
- Fields and values: `comvenio schema data --json`
<!-- /gen:docs -->

## Errors

- `NOT_FOUND` — the file, folder or paper ID belongs to no visible entry or was removed. More: `comvenio help fehler NOT_FOUND`
- `VALIDATION_FAILED` — context, format or another field does not match the action, for example a disallowed export format. More: `comvenio help fehler VALIDATION_FAILED`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow uploading, managing files, or accessing a protected folder. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the scope for reading or writing files. More: `comvenio help fehler SCOPE_REQUIRED`
- `TENANT_MISMATCH` — the requested file or folder belongs to a different club than the connected one. More: `comvenio help fehler TENANT_MISMATCH`
- `CONFLICT` — the file or folder was changed or deleted in the meantime, or does not allow the action in its current state. More: `comvenio help fehler CONFLICT`
