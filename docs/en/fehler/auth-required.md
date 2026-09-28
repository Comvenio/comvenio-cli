---
id: fehler/auth-required
kategorie: fehler
stichwoerter: [sign-in, expired, revoked, login]
---

# AUTH_REQUIRED — Your sign-in is no longer valid.

## Meaning

Your sign-in is no longer valid.

## Typical causes

- The connection has expired.
- The connection was revoked.
- There is no sign-in yet.

## Solution

1. Sign in again, with the same `--scopes` if the sign-in was narrowed: `comvenio login`
