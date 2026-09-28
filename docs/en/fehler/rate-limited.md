---
id: fehler/rate-limited
kategorie: fehler
stichwoerter: [rate limit, requests, throttling]
---

# RATE_LIMITED — Too many requests in a short time.

## Meaning

Too many requests in a short time.

## Typical causes

- Comvenio limits how often a connection may send requests in quick succession.
- Several commands ran in quick succession, for example from a script.

## Solution

1. Wait a minute.
2. Repeat the same command.
