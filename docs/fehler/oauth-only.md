---
id: fehler/oauth-only
kategorie: fehler
stichwoerter: [oauth, klassischer befehl, action]
---

# OAUTH_ONLY — Dieser Befehl läuft nicht über die OAuth-Anmeldung.

## Bedeutung

Dieser Befehl läuft nicht über die OAuth-Anmeldung.

## Typische Ursachen

- Ein alter, klassischer Befehl wurde aufgerufen.
- Das ist Absicht: klassische Befehle laufen unter der Anmeldung nicht mehr, dieselben Aufgaben laufen über Actions.

## Lösung

1. Passende Action suchen: `comvenio action list`
2. Ausführen: `comvenio action call <action-id> --input '<json>'`
3. Gibt es keine passende Action, als Wunsch über das Issue-Formular melden.
