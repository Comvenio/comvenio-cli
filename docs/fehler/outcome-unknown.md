---
id: fehler/outcome-unknown
kategorie: fehler
stichwoerter: [schreibende aktion, zeitüberschreitung, doppelt]
---

# OUTCOME_UNKNOWN — Die Aktion wurde nicht bestätigt — sie kann trotzdem ausgeführt worden sein.

## Bedeutung

Die Aktion wurde nicht bestätigt — sie kann trotzdem ausgeführt worden sein.

## Typische Ursachen

- Eine schreibende Aktion (etwa `comvenio action confirm`) endete mit Zeitüberschreitung — die
  Grenze liegt bei 15 Sekunden — oder mit einem Serverfehler, womöglich nachdem Comvenio sie schon
  ausgeführt hatte.
- Lesende Aktionen melden diesen Code nie; sie können gefahrlos wiederholt werden.

## Lösung

1. Die Aktion **nicht** wiederholen — auch nicht mit demselben `--idempotency-key`: Nach einem
   Abbruch schützt der Schlüssel nicht vor einer zweiten Ausführung.
2. Den betroffenen Eintrag mit der passenden **lesenden** Action abrufen. Welche das ist, zeigt
   `comvenio action list` (Actions ohne Schreibwirkung); aufrufen mit
   `comvenio action call <lese-action> --input '<json>'`, etwa die Liste des Bereichs.
3. Ist der Eintrag da, ist nichts weiter zu tun. Fehlt er sicher, die Aktion neu anstoßen — mit einer
   neuen Vorschau und einem neuen Schlüssel.
