---
id: fehler/validation-failed
kategorie: fehler
stichwoerter: [input, field, format, schema]
---

# VALIDATION_FAILED — The input does not match the action.

## Meaning

The input does not match the action.

## Typical causes

- A required field is missing.
- A field is not allowed (too much).
- A field has the wrong format.

## Solution

1. Look at the action's input schema: `comvenio action list --json`
2. Correct the input accordingly and call the action again.
