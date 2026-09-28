---
id: fehler/outcome-unknown
kategorie: fehler
stichwoerter: [writing action, timeout, duplicate]
---

# OUTCOME_UNKNOWN — The action was not confirmed — it may still have been carried out.

## Meaning

The action was not confirmed — it may still have been carried out.

## Typical causes

- A writing action (for example `comvenio action confirm`) ended with a timeout — the limit is
  15 seconds — or with a server error, possibly after Comvenio had already carried it out.
- Reading actions never report this code; they can be repeated safely.

## Solution

1. Do **not** repeat the action — not even with the same `--idempotency-key`: after an abort the
   key does not protect against a second execution.
2. Fetch the affected entry with the matching **reading** action. `comvenio action list` shows which
   one (actions without a writing effect); call it with
   `comvenio action call <read-action> --input '<json>'`, for example the list of the area.
3. If the entry is there, nothing else is needed. If it is definitely missing, start the action again
   — with a new preview and a new key.
