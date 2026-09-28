---
id: fehler/confirmation-expired
kategorie: fehler
stichwoerter: [vorschau, abgelaufen, bestätigung]
---

# CONFIRMATION_EXPIRED — Die Vorschau ist abgelaufen.

## Bedeutung

Die Vorschau ist abgelaufen.

## Typische Ursachen

- Eine Vorschau gilt nur kurz; danach ist sie nicht mehr bestätigbar.

## Lösung

1. Die Action erneut aufrufen, um eine neue Vorschau zu erhalten: `comvenio action call <action-id> --input '<json>'`
2. Danach mit den neuen Werten bestätigen.
