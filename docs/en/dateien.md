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

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by `comvenio action list --json`. Uploading into a specific department requires the file right there — without it, an upload into that department fails.

## Workflows

### Context and visibility

Every file can be assigned to a business context: `none`, `club`, `department`, `event`, `object`, `task`, `news`, `paper`, `newsletter`, `tournament`, `protocol`, `agenda_item`, `agenda_item_note`, `protocol_entry`, `user_avatar`, `message_attachment`, `feedback`, `certificate`, `certificate_template`, `letter`, `event_sponsor`, `advertiser`, `sponsorship_product`, `sponsorship_assignment`.

- `context_id` is the ID of the business entity.
- `sub_context_id` refines the context, for example to a specific event area.
- `context_label` groups files within a context, for example `gallery`, `title_picture`, `flyer` or `contract`.
- Visibility is `private` (default) or `public`.
- `department_id` additionally scopes a query or change to a department; without it, the whole club context applies.

### Uploading a file (`cai.data.06.upload`)

1. Determine the target context and, if needed, the sub-context (see above).
2. For the contexts `club`, `none` and `department`, optionally choose a department via `department_id` — without it, the file lands in the club's **default department** and appears there in DataShare. Other contexts (`event`, `news`, `certificate`, …) follow their own server-side rules.
3. Pass the file from your own computer with `--file` and the remaining details (context, visibility, label) with `--input`:

   ```bash
   comvenio action call cai.data.06.upload --file ./flyer.jpg --input '{"context_type":"event","context_id":"<event-id>","visibility":"public"}' --json
   ```

   The CLI then does everything else in one command:
   - It reads the file, determines the file type from the extension and computes size and checksum (SHA-256). An unknown extension or a file that is too large is rejected before anything is transferred.
   - It transfers the file into protected interim storage. There Comvenio checks size, checksum, file type and malware (virus scan); only a clean file is passed on.
   - It stores the file in the chosen context of the club's file storage. This runs as a background job; the CLI waits until it has finished and prints the result (machine-readable with `--json`).

   The result names the **file ID in the club's file storage** together with name, type and size. Use this ID for any further step, for example with `cai.data.02.show`, `cai.data.09.move` or `cai.data.10.visibility`. With `--json` it is in the `result` field:

   ```json
   "result": {
     "kind": "datashare_file",
     "file_id": "<file-id>",
     "filename": "flyer.jpg",
     "content_type": "image/jpeg",
     "size_bytes": 48213
   }
   ```

   `file.source_file_id`, by contrast, is only the ID of the checked interim file; it is used up by the upload. If an older server does not report a file ID (`result` is `null`), find the file with `cai.data.01.list`.

   The CLI sets `source_file_id`, `filename`, `content_type` and `expected_size` itself — do not also pass these fields in `--input`. `--file` exists only for `cai.data.06.upload`.
4. Limits and requirements: at most 200 MB per file; common image, document, spreadsheet, presentation, audio and video formats as well as ZIP archives are allowed. The sign-in needs the scopes `files.write` and `files.import`. Uploading from your own computer works only while the server has enabled it for your club — otherwise the CLI reports `UPLOAD_NOT_ENABLED`, and the file is uploaded in the web app.
5. A started upload is valid for 15 minutes. If the command is interrupted before that (for example with Ctrl+C) or the transfer takes longer, it expires (`UPLOAD_TIMEOUT`); then start the same command again. If the check rejects the file, `UPLOAD_REJECTED` names the reason, for example `MALWARE` or `MIME_MISMATCH`.

### Optimizing video for mobile autoplay

Not yet available as an action — do this in the web app.

### Changing the context afterwards (`cai.data.03.update`)

`changes` only carries the fields that actually change (`context_type`, `context_id`, `sub_context_id`, `context_label`); at least one is required. The value `null` explicitly sets a field to empty and removes an existing assignment.

### File lifecycle

- `cai.data.09.move` moves a file into another folder; `target_folder_id: null` moves it to the top level.
- `cai.data.10.visibility` sets visibility via `operation`: `private` is a normal write, `public` is `critical_write`.
- `cai.data.07.delete` moves a file to the trash by default (`operation: soft_delete`); a hard delete (`operation: hard_delete`) is `critical_write` and cannot be undone — the call first returns only a preview with `preview_id` and `confirmation_token`, and only `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>` with these values carries out the deletion.
- `cai.data.08.restore` brings back a soft-deleted file.
- `cai.data.11.stats` returns storage usage per club or per department.
- `cai.data.12.empty_trash` (`critical_write`) empties a department's trash specifically and runs through the same preview/confirm sequence.

### Reading, searching and managing folders

`cai.data.17.children` lists subfolders and files, `cai.data.18.search` searches a folder by keyword, `cai.data.19.breadcrumb` returns the path. `root` and the value `null` stand for the top level in folder arguments.

Folders can be created (`cai.data.20.folder_create`), renamed (`cai.data.21.folder_rename`), moved (`cai.data.22.folder_move`) and protected (`cai.data.23.folder_protect`) — all `reversible_write`. Deleting (`cai.data.24.folder_delete`) is `critical_write` and acts recursively on the whole subtree by default; restoring (`cai.data.25.folder_restore`) is `reversible_write` again.

### Setting folder rights

Rights are assigned to a folder as an object with `subject_type`, `subject_id`, `can_read` and `can_write`; currently only `subject_type=user` is in production use, `group` is reserved for later. As soon as a folder or one of its ancestors carries explicit rights, the protected area is only readable or writable for matching subjects. `cai.data.26.folder_rights` reads a folder's rights, `cai.data.27.folder_right_add` adds one (`reversible_write`). Creating rights in bulk as a list (`cai.data.28.folder_right_bulk`) and removing a single right (`cai.data.29.folder_right_delete`) are each `critical_write` and run through the preview/confirm sequence.

### Sharing files between event areas

A title picture or a flyer can additionally appear in several event areas without being uploaded multiple times. `cai.data.13.area_media` returns the matching image/file assignment per area for several areas at once. `cai.data.14.area_shares` shows a file's areas, `cai.data.15.area_share_add` adds some (`reversible_write`), `cai.data.16.area_share_remove` removes one (`critical_write`).

### Publishing papers

A paper links an existing file to a publishable document record. Document types are `protokoll`, `flyer`, `anleitung`, `zeitung`, `bericht`, `speisekarte` and `sonstiges`; a paper's business context is `event`, `object`, `task`, `supply` or `custom`. `cai.data.30.papers` lists, `cai.data.31.paper_show` shows a paper, `cai.data.32.paper_add` creates one (`reversible_write`), `cai.data.33.paper_update` replaces it fully — it expects the same data as creating one. `cai.data.34.paper_delete` is `critical_write`.

### Exporting member and booking data

`cai.data.35.export_members_bookings` returns via `operation` either `members` or `bookings`, each in the format `csv` or `xlsx`; both variants are `critical_write` and run through the preview/confirm sequence.

### Scope

Workflows with their own publication or newsletter rules stay in their own topic areas; DataShare
only manages their files and contexts, not the business logic behind them.

## Examples

```bash
comvenio action list --json

comvenio action call cai.data.01.list \
  --input '{"context_type":"event","context_id":"<event-id>","include_deleted":false,"limit":50,"offset":0}'
comvenio action call cai.data.02.show --input '{"file_id":"<file-id>"}'
comvenio action call cai.data.04.url --input '{"file_id":"<file-id>"}'
comvenio action call cai.data.05.download --input '{"file_id":"<file-id>","preferred_name":"bild.jpg"}'
```

```bash
comvenio action call cai.data.06.upload --file ./bild.jpg --input '{
  "context_type": "event",
  "context_id": "<event-id>",
  "sub_context_id": "<event-area-id>",
  "context_label": "gallery",
  "visibility": "public",
  "department_id": "<department-id>"
}' --json
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
# response returns preview_id, confirmation_token, target, current state, diff and risk
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

Folder right as input:

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

Paper record as input:

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

## Commands and actions

<!-- gen:docs befehle -->

**data**

- `cai.data.01.list` — list (read) · Scopes: `files.read`
- `cai.data.02.show` — show (read) · Scopes: `files.read`
- `cai.data.03.update` — update (change) · Scopes: `files.write`
- `cai.data.04.url` — reference (read) · Scopes: `files.read`
- `cai.data.05.download` — download (read) · Scopes: `files.read`, `files.export`
- `cai.data.06.upload` — upload (change) · Scopes: `files.import`, `files.write`
- `cai.data.07.delete` — soft_delete, hard_delete (change, change with confirmation) · Scopes: `files.write`
- `cai.data.08.restore` — restore (change) · Scopes: `files.write`
- `cai.data.09.move` — move (change) · Scopes: `files.write`
- `cai.data.10.visibility` — private, public (change, change with confirmation) · Scopes: `files.write`
- `cai.data.11.stats` — stats (read) · Scopes: `files.read`
- `cai.data.12.empty_trash` — empty (change with confirmation) · Scopes: `files.write`
- `cai.data.13.area_media` — list (read) · Scopes: `files.read`
- `cai.data.14.area_shares` — list (read) · Scopes: `files.read`
- `cai.data.15.area_share_add` — add (change) · Scopes: `files.write`
- `cai.data.16.area_share_remove` — remove (change with confirmation) · Scopes: `files.write`
- `cai.data.17.children` — list (read) · Scopes: `files.read`
- `cai.data.18.search` — search (read) · Scopes: `files.read`
- `cai.data.19.breadcrumb` — show (read) · Scopes: `files.read`
- `cai.data.20.folder_create` — create (change) · Scopes: `files.write`
- `cai.data.21.folder_rename` — rename (change) · Scopes: `files.write`
- `cai.data.22.folder_move` — move (change) · Scopes: `files.write`
- `cai.data.23.folder_protect` — protect (change) · Scopes: `files.write`
- `cai.data.24.folder_delete` — delete (change with confirmation) · Scopes: `files.write`
- `cai.data.25.folder_restore` — restore (change) · Scopes: `files.write`
- `cai.data.26.folder_rights` — list (read) · Scopes: `files.read`
- `cai.data.27.folder_right_add` — add (change) · Scopes: `files.write`
- `cai.data.28.folder_right_bulk` — bulk (change with confirmation) · Scopes: `files.write`
- `cai.data.29.folder_right_delete` — delete (change with confirmation) · Scopes: `files.write`
- `cai.data.30.papers` — list (read) · Scopes: `content.read`
- `cai.data.31.paper_show` — show (read) · Scopes: `content.read`
- `cai.data.32.paper_add` — create (change) · Scopes: `content.write`
- `cai.data.33.paper_update` — update (change) · Scopes: `content.write`
- `cai.data.34.paper_delete` — delete (change with confirmation) · Scopes: `content.write`
- `cai.data.35.export_members_bookings` — members, bookings (change with confirmation) · Scopes: `member.read.details`, `files.export`, `booking.read`
- Fields and values: `comvenio schema data --json` (the sign-in sets `club_id` — never in `--input`)
<!-- /gen:docs -->

## Errors

- `NOT_FOUND` — the file, folder or paper ID belongs to no visible entry or was removed. More: `comvenio help fehler NOT_FOUND`
- `VALIDATION_FAILED` — context, format or another field does not match the action, for example a disallowed export format. More: `comvenio help fehler VALIDATION_FAILED`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow uploading, managing files, or accessing a protected folder. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the scope for reading or writing files. More: `comvenio help fehler SCOPE_REQUIRED`
- `TENANT_MISMATCH` — the requested file or folder belongs to a different club than the connected one. More: `comvenio help fehler TENANT_MISMATCH`
- `CONFLICT` — the file or folder was changed or deleted in the meantime, or does not allow the action in its current state. More: `comvenio help fehler CONFLICT`
- `OUTCOME_UNKNOWN` — for a write action, the server response was missing; before retrying, use a read action to check whether the change already landed. More: `comvenio help fehler OUTCOME_UNKNOWN`
