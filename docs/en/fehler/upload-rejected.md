---
id: fehler/upload-rejected
kategorie: fehler
stichwoerter: [upload, file, virus scan, checksum, file type, rejected]
---

# UPLOAD_REJECTED — The file was rejected during the check.

## Meaning

The file was rejected during the check. Every uploaded file is checked for size, checksum, file type and malware before it is stored; the message names the rejection reason.

## Typical causes

- `MIME_MISMATCH`: The file's content does not match its extension.
- `SIZE_MISMATCH` or `HASH_MISMATCH`: The file changed during the upload or was transferred incompletely.
- `MALWARE`: The virus scan found malware.
- `ARCHIVE_LIMIT_EXCEEDED` or `UNSAFE_ARCHIVE`: A ZIP archive is too large, nested too deeply or contains unsafe paths.

## Solution

1. Check the file against the rejection reason — extension matching the content, file no longer being edited, unpack an archive and upload its files one by one.
2. Then start the same command again.
