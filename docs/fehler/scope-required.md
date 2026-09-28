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

1. Den in der Fehlermeldung angezeigten Befehl ausführen. Nennt die Meldung die fehlenden Scopes, enthält er die bisherigen und die fehlenden zusammen: `comvenio login --scopes <bisherige-und-fehlende-scopes>`. Nennt sie keine, lautet er `comvenio login` — das fordert alle Scopes an.
2. Welche Scopes eine Action braucht, zeigt `comvenio action list --json`.
