---
id: fehler/outcome-unknown
kategorie: fehler
stichwoerter: [schreibende aktion, zeitüberschreitung, doppelt]
---

# OUTCOME_UNKNOWN — Die Aktion wurde nicht bestätigt — sie kann trotzdem ausgeführt worden sein.

## Bedeutung

Die Aktion wurde nicht bestätigt — sie kann trotzdem ausgeführt worden sein.

## Typische Ursachen

- Eine schreibende Aktion endete mit Zeitüberschreitung oder Serverfehler, womöglich nachdem Comvenio sie schon ausgeführt hatte.
- Der Effekt hängt an der Risikoklasse der Aktion (lesend/schreibend), nicht an der genauen Fehlerursache.

## Lösung

1. Die Aktion NICHT einfach wiederholen — sonst entsteht der Eintrag womöglich doppelt.
2. Erst den aktuellen Stand mit der passenden Lese-Action prüfen: `comvenio action list`
3. Fehlt der Eintrag dort tatsächlich, die Aktion erneut ausführen.
