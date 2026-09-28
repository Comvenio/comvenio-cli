---
id: fehler/tenant-mismatch
kategorie: fehler
stichwoerter: [club, preview, identifier]
---

# TENANT_MISMATCH — The request belongs to a different club.

## Meaning

The request belongs to a different club.

## Typical causes

- The requested entry or preview does not come from the currently connected club.
- The identifier was carried over from a different club, for example from an old note.

## Solution

1. Check the connected club and sign in again if needed: `comvenio login`
2. See the connected club's current entries: `comvenio action list`
