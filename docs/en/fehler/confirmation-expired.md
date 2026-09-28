---
id: fehler/confirmation-expired
kategorie: fehler
stichwoerter: [preview, expired, confirmation]
---

# CONFIRMATION_EXPIRED — The preview has expired.

## Meaning

The preview has expired.

## Typical causes

- A preview is only valid for a short time; after that it can no longer be confirmed.

## Solution

1. Call the action again to get a new preview: `comvenio action call <action-id> --input '<json>'`
2. Then confirm with the new values.
