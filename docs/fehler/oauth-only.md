---
id: fehler/oauth-only
kategorie: fehler
stichwoerter: [oauth, klassischer befehl, geräte-token]
---

# OAUTH_ONLY — Dieser Befehl läuft nicht über die OAuth-Anmeldung.

## Bedeutung

Dieser Befehl läuft nicht über die OAuth-Anmeldung.

## Typische Ursachen

- Ein klassischer Befehl, der einen Geräte-Token braucht, wurde unter der OAuth-Anmeldung aufgerufen.
- Das ist Absicht: klassische Befehle laufen unter OAuth nicht, OAuth führt dieselben Aufgaben über Actions aus.

## Lösung

1. Passende Action suchen: `comvenio action list`
2. Ausführen: `comvenio action call <action-id> --input '<json>'`
3. Gibt es keine passende Action, als Wunsch über das Issue-Formular melden.
