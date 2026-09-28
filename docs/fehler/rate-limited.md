---
id: fehler/rate-limited
kategorie: fehler
stichwoerter: [rate limit, anfragen, begrenzung]
---

# RATE_LIMITED — Zu viele Anfragen in kurzer Zeit.

## Bedeutung

Zu viele Anfragen in kurzer Zeit.

## Typische Ursachen

- Comvenio begrenzt, wie oft eine Verbindung in kurzer Folge anfragen darf.
- Mehrere Befehle liefen kurz hintereinander, etwa aus einem Skript.

## Lösung

1. Eine Minute warten.
2. Denselben Befehl wiederholen.
