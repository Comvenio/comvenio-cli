---
id: fehler/upload-timeout
kategorie: fehler
stichwoerter: [upload, datei, abbruch, zeitüberschreitung, verfallen]
---

# UPLOAD_TIMEOUT — Der Datei-Upload wurde nicht abgeschlossen.

## Bedeutung

Der Datei-Upload wurde nicht abgeschlossen. Ein begonnener Upload gilt 15 Minuten; wird er in dieser Zeit nicht übertragen und geprüft, verfällt er, und die Datei wird verworfen.

## Typische Ursachen

- Der Befehl wurde abgebrochen, zum Beispiel mit Strg+C.
- Die Verbindung ist während der Übertragung abgerissen.
- Übertragung oder Prüfung einer großen Datei hat länger als 15 Minuten gedauert.

## Lösung

1. Denselben Befehl neu starten; der verfallene Upload muss nicht aufgeräumt werden.
2. Bei langsamer Verbindung die Datei verkleinern, zum Beispiel ein Video vorher komprimieren.
