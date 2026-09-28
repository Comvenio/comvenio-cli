---
id: fehler/confirmation-mismatch
kategorie: fehler
stichwoerter: [bestätigung, vorschau, token]
---

# CONFIRMATION_MISMATCH — Die Bestätigung passt nicht mehr zur Vorschau.

## Bedeutung

Die Bestätigung passt nicht mehr zur Vorschau.

## Typische Ursachen

- Vorschau, Bestätigungstoken oder Schlüssel gehören nicht zusammen.
- Die Action hat sich seit der Vorschau geändert.

## Lösung

1. Eine neue Vorschau anfordern: `comvenio action call <action-id> --input '<json>'`
2. Mit den neuen Werten bestätigen.
