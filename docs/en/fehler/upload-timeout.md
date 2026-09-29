---
id: fehler/upload-timeout
kategorie: fehler
stichwoerter: [upload, file, interrupted, timeout, expired]
---

# UPLOAD_TIMEOUT — The file upload was not completed.

## Meaning

The file upload was not completed. A started upload is valid for 15 minutes; if it is not transferred and checked within that time, it expires and the file is discarded.

## Typical causes

- The command was interrupted, for example with Ctrl+C.
- The connection dropped during the transfer.
- Transferring or checking a large file took longer than 15 minutes.

## Solution

1. Start the same command again; the expired upload needs no cleanup.
2. On a slow connection make the file smaller, for example compress a video first.
