---
id: fehler/validation-failed
kategorie: fehler
stichwoerter: [eingabe, feld, format, schema]
---

# VALIDATION_FAILED — Die Eingabe passt nicht zur Action.

## Bedeutung

Die Eingabe passt nicht zur Action.

## Typische Ursachen

- Ein Pflichtfeld fehlt.
- Ein Feld ist nicht vorgesehen (zu viel).
- Ein Feld hat das falsche Format.

## Lösung

1. Eingabeschema der Action ansehen: `comvenio action list --json`
2. Eingabe entsprechend korrigieren und die Action erneut aufrufen.
