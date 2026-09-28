---
id: fehler/permission-denied
kategorie: fehler
stichwoerter: [permission, role, club, administrator]
---

# PERMISSION_DENIED — You lack the club permission for this action.

## Meaning

You lack the club permission for this action.

## Typical causes

- The sign-in carries the required scopes, but the role in the club does not allow the action.
- The required permission has not been granted in the club yet.

## Solution

1. Ask an administrator of the club to grant the missing permission.
2. Then run the action again; the available actions are shown by `comvenio action list`.
