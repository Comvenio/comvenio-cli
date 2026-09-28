---
id: fehler/oauth-only
kategorie: fehler
stichwoerter: [oauth, classic command, action]
---

# OAUTH_ONLY — This command does not run with the OAuth sign-in.

## Meaning

This command does not run with the OAuth sign-in.

## Typical causes

- An old, classic command was run.
- This is intentional: classic commands no longer run under the sign-in, the same tasks run through actions.

## Solution

1. Look for a matching action: `comvenio action list`
2. Run it: `comvenio action call <action-id> --input '<json>'`
3. If none exists, report it as a request through the issue form.
