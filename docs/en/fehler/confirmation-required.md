---
id: fehler/confirmation-required
kategorie: fehler
stichwoerter: [confirmation, preview, critical]
---

# CONFIRMATION_REQUIRED — This action must be confirmed first.

## Meaning

This action must be confirmed first.

## Typical causes

- The action is critical and therefore only runs after a preview and an explicit confirmation.

## Solution

1. Confirm with the values from the preview: `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>`
