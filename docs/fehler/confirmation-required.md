---
id: fehler/confirmation-required
kategorie: fehler
stichwoerter: [bestätigung, vorschau, kritisch]
---

# CONFIRMATION_REQUIRED — Diese Aktion muss zuerst bestätigt werden.

## Bedeutung

Diese Aktion muss zuerst bestätigt werden.

## Typische Ursachen

- Die Aktion ist kritisch und läuft deshalb nur nach einer Vorschau und einer ausdrücklichen Bestätigung.

## Lösung

1. Mit den Werten aus der Vorschau bestätigen: `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>`
