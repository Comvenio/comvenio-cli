---
id: fehler/conflict
kategorie: fehler
stichwoerter: [conflict, state, version]
---

# CONFLICT — The action conflicts with the current state.

## Meaning

The action conflicts with the current state.

## Typical causes

- The entry was changed elsewhere in the meantime.
- The entry already exists.
- The entry's current state does not allow the action.

## Solution

1. Fetch the entry's current state.
2. Decide again on that basis and retry the action if needed.
