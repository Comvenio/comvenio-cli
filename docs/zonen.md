---
id: zonen
kategorie: thema
domaenen: [zone]
stichwoerter: [zone, zonen, einteilung, zone-set, geojson, gebiet, pate, aufgaben]
---

# Vereinsgebiet und Zonen

## Wozu

Ein Verein teilt sein Gebiet in **Einteilungen** (zum Beispiel „Flyer (Straßenzüge)“) und jede
Einteilung in **Zonen** — Flächen auf der Karte. Aufgaben werden Zonen zugeteilt; wer einer Aufgabe
zugewiesen ist, ist damit ihren Zonen zugeteilt.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie
brauchen, zeigt `comvenio action list --json`. Gezeichnet wird ausschließlich im Gebiets-Editor
der Web-App — dort entstehen und ändern sich Einteilungen, Zonen und ihre Zuteilung zu Aufgaben.

## Abläufe

### Einteilungen, Zonen und ihre Zuteilung

Ein Verein legt seine Einteilungen und Zonen im Gebiets-Editor der Web-App an und ändert dort ihre
Form, Farbe, Notiz, Paten, Treffpunkt, Fortbewegung und Besonderheiten. Die Gebäudezahl je Zone
schätzt der Dienst automatisch: Nach dem Anlegen einer Zone und nach jeder Änderung ihrer Form
werden die Adressen (Straße und Hausnummer) im Polygon aus OpenStreetMap gezählt; eine von Hand
eingetragene Zahl hat Vorrang vor der Schätzung.

Aufgaben werden im Gebiets-Editor einer oder mehreren Zonen einer Einteilung zugeteilt — eine
Aufgabe trägt dabei immer nur Zonen einer einzigen Einteilung, Vorlagen bekommen keine Zonen. Wer
einer Aufgabe zugewiesen ist, ist damit ihren Zonen zugeteilt. Eine Übersicht je Zone zeigt, was
nicht zugeteilt, in Arbeit, zugeteilt-offen oder — auf Wunsch — erledigt ist; abgebrochene
Aufgaben zählen dabei nie.

## Beispiele

Für diesen Bereich gibt es keine `comvenio`-Befehle — Einteilungen, Zonen und ihre Zuteilung
werden ausschließlich im Gebiets-Editor der Web-App bearbeitet.

## Befehle und Actions

<!-- gen:docs befehle -->

**zone**

- Noch keine Action — dieser Bereich läuft über die Web-App.
- Felder und Werte: `comvenio schema zone --json`
<!-- /gen:docs -->

## Fehler

Für diesen Bereich gibt es keine `comvenio`-Befehle und damit keine eigenen CLI-Fehlercodes;
Fehler beim Zeichnen oder Zuteilen zeigt der Gebiets-Editor der Web-App direkt an.
