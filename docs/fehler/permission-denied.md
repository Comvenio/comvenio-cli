---
id: fehler/permission-denied
kategorie: fehler
stichwoerter: [recht, rolle, verein, administrator]
---

# PERMISSION_DENIED — Dir fehlt im Verein das Recht für diese Aktion.

## Bedeutung

Dir fehlt im Verein das Recht für diese Aktion.

## Typische Ursachen

- Die Anmeldung trägt die nötigen Scopes, aber die Rolle im Verein erlaubt die Aktion nicht.
- Das nötige Recht wurde im Verein noch nicht vergeben.

## Lösung

1. Einen Administrator des Vereins bitten, das fehlende Recht zu vergeben.
2. Danach die Aktion erneut ausführen; verfügbare Actions zeigt `comvenio action list`.
