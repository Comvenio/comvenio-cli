---
id: fehler/outcome-unknown
kategorie: fehler
stichwoerter: [writing action, timeout, duplicate]
---

# OUTCOME_UNKNOWN — The action was not confirmed — it may still have been carried out.

## Meaning

The action was not confirmed — it may still have been carried out.

## Typical causes

- A writing action ended with a timeout or a server error, possibly after Comvenio had already carried it out.
- The effect depends on the action's risk class (read/write), not on the exact cause of the error.

## Solution

1. Do NOT simply repeat the action — otherwise it may be created twice.
2. First check the current state with the matching read action: `comvenio action list`
3. Only if the entry is genuinely missing there, run the action again.
