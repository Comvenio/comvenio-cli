# Vereinsgebiet und Zonen

Ein Verein teilt sein Gebiet in **Einteilungen** (zum Beispiel „Flyer (Straßenzüge)“) und jede
Einteilung in **Zonen** — Flächen auf der Karte. Aufgaben werden Zonen zugeteilt; wer einer Aufgabe
zugewiesen ist, ist ihren Zonen zugeteilt. Einteilungen und Zonen liegen im club-service, die
Zuteilung im task-service. Gezeichnet wird im Gebiets-Editor der Web-App; die CLI arbeitet mit
GeoJSON-Dateien.

## Einteilungen

```bash
comvenio zone set list --json
comvenio zone set create --name "Flyer (Straßenzüge)" --center 48.8950,12.3790 --zoom 16
comvenio zone set update <zone-set-id> --name "Flyer 2027"
comvenio zone set delete <zone-set-id>
```

`update` liest die aktuelle Version selbst; mit `--expected-version <n>` wird gegen einen bekannten
Stand geschrieben. Passt er nicht, antwortet der Dienst mit `409` und nennt `live_version`.

## Zonen

```bash
comvenio zone list --set <zone-set-id>
comvenio zone create --set <zone-set-id> --name "Kastnerstraße" --geojson kastner.geojson --color "#e0842b"
comvenio zone update <zone-id> --geojson kastner-neu.geojson
comvenio zone delete <zone-id>
```

`--geojson` nimmt ein `Polygon` oder `MultiPolygon`, ein `Feature` oder eine `FeatureCollection` mit
genau einem Feature. Koordinaten stehen als `[lng, lat]`; jeder Ring ist geschlossen und hat
mindestens vier Punkte; höchstens 2000 Punkte je Zone. Eine ungültige Datei wird vor dem Aufruf
abgewiesen (Exit 2).

Gelöschte Zonen bleiben an den Aufgaben und werden dort als gelöscht angezeigt.

## Import

```bash
comvenio zone import --set <zone-set-id> --geojson dorf.geojson
```

Je Feature der `FeatureCollection` entsteht eine Zone; der Name kommt aus `properties.name`, die
Farbe wahlweise aus `properties.color`. Ungültige Features werden übersprungen und mit Index und
Grund gelistet; der Befehl endet dann mit Exit 1, die gültigen Zonen sind angelegt.

## Übersicht

```bash
comvenio zone overview --set <zone-set-id>
comvenio zone overview --set <zone-set-id> --status open,in_progress,completed --json
```

Zeigt je Zone die Zuteilung wie die Übersicht der Web-App: **nicht zugeteilt** (keine Aufgabe im
Filter oder keine mit Zuständigen), **in Arbeit**, **zugeteilt, offen**, **erledigt** (nur mit
`completed` im Filter). Nicht zugeteilte Zonen stehen zuerst. Abgebrochene Aufgaben zählen nie.

## Zonen einer Aufgabe

```bash
comvenio task-zones <task-id>
comvenio task-zones <task-id> add <zone-id>
comvenio task-zones <task-id> remove <zone-id>
```

Eine Aufgabe trägt Zonen genau einer Einteilung (`422 zone_set_mismatch`). Vorlagen bekommen keine
Zonen (`422 task_is_template`).

## Fehler und Exit-Codes

| Exit | Bedeutung |
|---|---|
| 0 | Erfolg |
| 1 | Dienstfehler, ausgegeben mit Status, Code und Grund — etwa `409 zone_changed · live_version=5`, `422 invalid_geometry · Ein Ring ist nicht geschlossen`; oder Import mit übersprungenen Features |
| 2 | ungültige Eingabe vor dem Aufruf (Datei, Geometrie, `--center`, `--color`) |

`--json` gibt die Rohantwort des Dienstes aus. Das Offline-Schema steht unter
`comvenio schema zone --json`.
