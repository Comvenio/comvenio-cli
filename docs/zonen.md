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

Anmeldung per `comvenio login`; welche Scopes ein einzelner Befehl braucht, zeigt
`comvenio action list --json`. Gezeichnet wird ausschließlich im Gebiets-Editor der Web-App — die
CLI liest und schreibt Zonen als GeoJSON-Dateien, ändert aber keine Eckpunkte interaktiv.

## Abläufe

### Einteilung anlegen und pflegen

1. Vorhandene Einteilungen ansehen: `comvenio zone set list --json`.
2. Neue Einteilung anlegen: `comvenio zone set create --name "<Name>" --center <lat>,<lng> --zoom <n>`.
3. Namen ändern: `comvenio zone set update <zone-set-id> --name "<neuer Name>"`.
   `update` liest den aktuellen Stand selbst; mit `--expected-version <n>` wird gegen einen
   bekannten Stand geschrieben — passt er nicht, antwortet der Dienst mit `409` und nennt
   `live_version`.
4. Einteilung löschen: `comvenio zone set delete <zone-set-id>`.

### Zonen anlegen und pflegen

1. Zonen einer Einteilung ansehen: `comvenio zone list --set <zone-set-id>`.
2. Zone aus einer GeoJSON-Datei anlegen:
   `comvenio zone create --set <zone-set-id> --name "<Name>" --geojson <datei>.geojson --color "#e0842b"`.
   `--geojson` nimmt ein `Polygon` oder `MultiPolygon`, ein `Feature` oder eine
   `FeatureCollection` mit genau einem Feature; Koordinaten stehen als `[lng, lat]`, jeder Ring ist
   geschlossen und hat mindestens vier Punkte, höchstens 2000 Punkte je Zone. Eine ungültige Datei
   wird vor dem Aufruf abgewiesen.
3. Form aktualisieren: `comvenio zone update <zone-id> --geojson <datei-neu>.geojson`.
4. Zone löschen: `comvenio zone delete <zone-id>`. Gelöschte Zonen bleiben an ihren Aufgaben und
   werden dort als gelöscht angezeigt.

### Angaben zur Zone pflegen

1. Gebäudezahl von Hand eintragen: `comvenio zone update <zone-id> --building-count 120`; wieder
   der Schätzung überlassen mit `--building-count leer`.
2. Notiz setzen oder löschen: `comvenio zone update <zone-id> --notes "<Text>"` bzw. `--notes ""`.
3. Schätzung neu anstoßen (etwa nach „Schätzung fehlgeschlagen“): `comvenio zone estimate <zone-id>`
   — das Ergebnis steht nach wenigen Sekunden in `zone list`.
4. Paten, Treffpunkt, Fortbewegung und Besonderheiten setzen:
   `comvenio zone update <zone-id> --pate <member-id> --treffpunkt "<lat>,<lng>,<Beschreibung>" --fortbewegung fuss --besonderheiten hunde,zugang`.
   Jedes dieser Felder löscht `leer` einzeln wieder.

### Zonen importieren

1. `comvenio zone import --set <zone-set-id> --geojson <datei>.geojson`. Je Feature der
   `FeatureCollection` entsteht eine Zone; der Name kommt aus `properties.name`, die Farbe
   wahlweise aus `properties.color`. Ungültige Features werden übersprungen und mit Index und
   Grund gelistet; die gültigen Zonen sind trotzdem angelegt.

### Übersicht und Zuteilung

1. Übersicht je Zone: `comvenio zone overview --set <zone-set-id>` — zeigt **nicht zugeteilt**,
   **in Arbeit**, **zugeteilt, offen** und mit `--status completed` auch **erledigt**;
   abgebrochene Aufgaben zählen nie.
2. Zonen einer Aufgabe ansehen: `comvenio task-zones <task-id>`.
3. Zone zuordnen oder entfernen: `comvenio task-zones <task-id> add <zone-id>` bzw.
   `comvenio task-zones <task-id> remove <zone-id>`. Eine Aufgabe trägt Zonen immer nur einer
   Einteilung; Vorlagen bekommen keine Zonen.

Das Offline-Schema für Zonen steht unter `comvenio schema zone --json`.

## Beispiele

```bash
comvenio zone set create --name "Flyer (Straßenzüge)" --center 48.8950,12.3790 --zoom 16
comvenio zone create --set <zone-set-id> --name "Kastnerstraße" --geojson kastner.geojson --color "#e0842b"
comvenio zone update <zone-id> --pate <member-id> --treffpunkt "49.05,12.36,Material bei Familie Huber" --fortbewegung fuss --besonderheiten hunde,zugang
comvenio zone estimate <zone-id>
comvenio zone overview --set <zone-set-id> --status open,in_progress,completed --json
comvenio task-zones <task-id> add <zone-id>
```

## Befehle und Actions

<!-- gen:docs befehle -->
_Erzeugt aus der Coverage-Registry (`bun run gen:docs`) — nicht von Hand ändern._

**zone** — vollständig

- `comvenio zone set list`
- `comvenio zone set create`
- `comvenio zone set update`
- `comvenio zone set delete`
- `comvenio zone list`
- `comvenio zone create`
- `comvenio zone update`
- `comvenio zone estimate`
- `comvenio zone delete`
- `comvenio zone import`
- `comvenio zone overview`
- `comvenio zone task-zones`
- `comvenio zone task-zones add`
- `comvenio zone task-zones remove`
- Felder und Werte: `comvenio schema zone --json`
<!-- /gen:docs -->

## Fehler

- `VALIDATION_FAILED` — die GeoJSON-Geometrie oder ein Feld wie `--pate` ist ungültig, etwa ein
  nicht geschlossener Ring oder eine unbekannte Mitglieds-ID. Mehr:
  `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — die Zone oder Einteilung wurde seit dem gelesenen Stand geändert
  (`--expected-version` passt nicht mehr). Mehr: `comvenio help fehler CONFLICT`.
- `NOT_FOUND` — Einteilung, Zone oder Aufgabe sind unter der angegebenen Kennung nicht bekannt.
  Mehr: `comvenio help fehler NOT_FOUND`.
- `PERMISSION_DENIED` — die Vereinsrolle erlaubt das Anlegen, Ändern oder Löschen nicht. Mehr:
  `comvenio help fehler PERMISSION_DENIED`.
- `UPSTREAM_UNAVAILABLE` — ein für die Prüfung nötiger Dienst (etwa für `--pate`) antwortet
  gerade nicht. Mehr: `comvenio help fehler UPSTREAM_UNAVAILABLE`.
