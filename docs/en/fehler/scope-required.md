---
id: fehler/scope-required
kategorie: fehler
stichwoerter: [scope, permission, sign-in, login]
---

# SCOPE_REQUIRED — Your sign-in is missing a permission for this action.

## Meaning

Your sign-in is missing a permission for this action.

## Typical causes

- The sign-in was granted without the scope this action needs — for example only with read scopes.
- The sign-in predates the current default sign-in (all scopes) or was deliberately narrowed with `--scopes`.

## Solution

1. Run the command shown in the error message. If the message names the missing scopes, it combines the previous and the missing ones: `comvenio login --scopes <previous-and-missing-scopes>`. If it names none, it is `comvenio login`, which requests all scopes.
2. The scopes an action needs are shown by `comvenio action list --json`.
