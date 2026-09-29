---
id: fehler/upload-rejected
kategorie: fehler
stichwoerter: [upload, datei, virenscan, prüfsumme, dateityp, abgelehnt]
---

# UPLOAD_REJECTED — Die Datei wurde bei der Prüfung abgelehnt.

## Bedeutung

Die Datei wurde bei der Prüfung abgelehnt. Jede hochgeladene Datei wird vor der Ablage auf Größe, Prüfsumme, Dateityp und Schadsoftware geprüft; die Meldung nennt den Ablehnungsgrund.

## Typische Ursachen

- `MIME_MISMATCH`: Der Inhalt der Datei passt nicht zu ihrer Endung.
- `SIZE_MISMATCH` oder `HASH_MISMATCH`: Die Datei hat sich während des Hochladens verändert oder wurde unvollständig übertragen.
- `MALWARE`: Der Virenscan hat Schadsoftware gefunden.
- `ARCHIVE_LIMIT_EXCEEDED` oder `UNSAFE_ARCHIVE`: Ein ZIP-Archiv ist zu groß, zu tief verschachtelt oder enthält unsichere Pfade.

## Lösung

1. Die Datei anhand des Ablehnungsgrunds prüfen — Endung passend zum Inhalt, Datei nicht mehr in Bearbeitung, Archiv entpacken und einzeln hochladen.
2. Danach denselben Befehl neu starten.
