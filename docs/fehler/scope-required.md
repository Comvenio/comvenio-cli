---
id: fehler/scope-required
kategorie: fehler
stichwoerter: [scope, berechtigung, anmeldung, login]
---

# SCOPE_REQUIRED — Deiner Anmeldung fehlt eine Berechtigung für diese Aktion.

## Bedeutung

Deiner Anmeldung fehlt eine Berechtigung für diese Aktion.

## Typische Ursachen

- Die Anmeldung wurde ohne den für diese Aktion nötigen Scope erteilt — etwa nur mit Lese-Scopes.
- Die Anmeldung stammt aus der Zeit vor der aktuellen Standardanmeldung (alle Scopes) oder wurde bewusst mit `--scopes` eingeschränkt.

## Lösung

1. Den in der Fehlermeldung angezeigten Befehl ausführen — er enthält die bisherigen und die fehlenden Scopes zusammen: `comvenio login --scopes <bisherige-und-fehlende-scopes>`
2. Welche Scopes eine Action braucht, zeigt `comvenio action list --json`.
