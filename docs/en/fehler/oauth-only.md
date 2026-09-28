---
id: fehler/oauth-only
kategorie: fehler
stichwoerter: [oauth, classic command, device token]
---

# OAUTH_ONLY — This command does not run with the OAuth sign-in.

## Meaning

This command does not run with the OAuth sign-in.

## Typical causes

- A classic command that needs a device token was run under the OAuth sign-in.
- This is intentional: classic commands do not run under OAuth, OAuth runs the same tasks through actions.

## Solution

1. Look for a matching action: `comvenio action list`
2. Run it: `comvenio action call <action-id> --input '<json>'`
3. If none exists, report it as a request through the issue form.
