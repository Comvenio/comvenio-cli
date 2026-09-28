---
id: fehler/tenant-mismatch
kategorie: fehler
stichwoerter: [verein, vorschau, kennung]
---

# TENANT_MISMATCH — Die Anfrage gehört zu einem anderen Verein.

## Bedeutung

Die Anfrage gehört zu einem anderen Verein.

## Typische Ursachen

- Der angefragte Eintrag oder die Vorschau stammt nicht aus dem Verein, mit dem gerade verbunden ist.
- Die Kennung wurde von einem anderen Verein übernommen, etwa aus einer alten Notiz.

## Lösung

1. Verbundenen Verein prüfen und bei Bedarf neu anmelden: `comvenio login`
2. Aktuelle Einträge des verbundenen Vereins ansehen: `comvenio action list`
