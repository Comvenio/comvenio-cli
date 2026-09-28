---
id: fehler/confirmation-mismatch
kategorie: fehler
stichwoerter: [confirmation, preview, token]
---

# CONFIRMATION_MISMATCH — The confirmation no longer matches the preview.

## Meaning

The confirmation no longer matches the preview.

## Typical causes

- Preview, confirmation token or key do not belong together.
- The action changed since the preview.

## Solution

1. Request a new preview: `comvenio action call <action-id> --input '<json>'`
2. Confirm with the new values.
