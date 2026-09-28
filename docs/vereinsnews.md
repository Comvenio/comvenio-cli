---
id: vereinsnews
kategorie: thema
domaenen: [news]
stichwoerter: [news, vereinsnews, redaktion, veröffentlichen, video]
---

# Vereinsnews

## Wozu

Mit Vereinsnews veröffentlicht ein Verein Neuigkeiten als Rich-HTML-Beiträge, wahlweise als Entwurf oder direkt live, wahlweise öffentlich, nur für Mitglieder oder nur für eine Abteilung. Den Text formuliert der bedienende Agent selbst; das CLI ruft dafür keinen eigenen Textgenerator auf.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

Anmeldung mit `comvenio login`; welche Scopes eine einzelne Action braucht, zeigt `comvenio action list --json`. Ein Entwurf (`is_draft=true`) ist nur für berechtigte Redakteure sichtbar; erst mit der Veröffentlichung wird eine News für ihre Sichtbarkeitsgruppe sichtbar.

## Abläufe

### Status und Sichtbarkeit

| Feld/Flag | Bedeutung |
|---|---|
| `is_draft=true` / `--draft` | nur für berechtigte Redakteure sichtbar |
| `is_draft=false` / `--publish` | veröffentlicht; der Veröffentlichungszeitpunkt wird gesetzt |
| `visibility_scope` | `public`, `member` oder `department`; Standard `member` |
| `design_source` | wird beim Anwenden aus einer Datei auf `cli` erzwungen |
| `is_pinned` / `--pinned` | News anpinnen |

Ohne `--publish` bleibt eine neu angelegte News standardmäßig ein Entwurf.

### Standard-Workflow: Bilder finden → News komponieren → prüfen → veröffentlichen

1. Bilder in DataShare finden oder zuerst dorthin hochladen (siehe [dateien.md](dateien.md)).
2. Die News deklarativ als Datei komponieren: Titel, Teaser, Sichtbarkeit, Titelbild und Rich-HTML-Inhalt.
3. Die Vorschau im echten Layout prüfen, bevor irgendetwas gespeichert wird.
4. Als Entwurf anlegen oder direkt veröffentlichen.

Reine Vorschau-Felder wie eine kurzlebige Bild-Adresse, Vereinsname, Autorenname und Vorschaudatum werden vor dem dauerhaften Speichern entfernt. Bilder im HTML brauchen zusätzlich zur Adresse eine stabile Datei-Kennung, damit die Anwendung eine abgelaufene Adresse automatisch neu signieren kann.

Für eine einfache News ohne aufwendiges Layout genügt das direkte Anlegen mit Titel und Inhalt als Flags — beide sind dabei Pflicht; für aufwendiges Rich-HTML ist der Weg über eine Datei übersichtlicher.

### Aktualisieren, ohne den Status zu verlieren

Das serverseitige Update ist ein Vollersatz aller Felder. Das CLI liest deshalb zuerst die vorhandene News und führt die angegebenen Änderungen mit dem bestehenden Stand zusammen — so wird eine bereits live geschaltete News beim Aktualisieren nicht versehentlich wieder zum Entwurf.

### Bilder aus DataShare zuordnen

Eine Datei, die schon vor der News-Erstellung hochgeladen wurde, lässt sich der News nachträglich zuordnen.

### Rich-HTML-Regeln

- Semantische Struktur verwenden: Überschriften, Absätze, Listen, Tabellen sowie Bild mit Beschriftung.
- Bilder mit einer stabilen Datei-Kennung versehen; eine kurzlebige, signierte Adresse allein läuft ab.
- Für Videos das Standard-Steuerelement mit Metadaten-Vorschau verwenden; automatisches Abspielen ist nicht zulässig.
- Für YouTube ausschließlich die datenschutzfreundliche Einbettungsadresse `https://www.youtube-nocookie.com/embed/...` verwenden.
- Keine Skripte, Ereignis-Handler oder unbekannte eingebettete Adressen einbetten.

### Lokale Videos erzeugen

Für Vereinsnews lassen sich kurze Videos aus Vorlagen lokal rendern: eine Bilder-Diashow, ein Spielergebnis, ein Ankündigungs-Teaser oder ein generischer Highlight-Auftakt. Jede Vorlage verlangt bestimmte Pflichtfelder und erlaubt weitere optionale Felder wie Untertitel, Overlays, Markenfarbe oder Logo.

Die Highlight-Vorlage ist bewusst allgemein gehalten (ein loopfähiger Auftakt-Clip ohne vereinsspezifischen Code) und kann optional eine Partner- oder Gastro-Szene zeigen: bis zu zwei Partnerkarten mit Name, Untertitel und Logo sowie ein dezentes Hintergrundmotiv. Diese Szene erscheint nur, wenn Partner angegeben sind, und liegt zwischen der Programmliste und einem abschließenden Hinweistext; das Video wird dadurch automatisch rund 4,3 Sekunden länger, ohne dass die Dauer manuell angepasst werden muss.

Mit einer zusätzlichen Option lädt das CLI das gerenderte Video direkt hoch und liefert ein fertiges HTML-Einbettungsschnipsel für die News. Das Video-Upload-Limit beträgt 200 MB. Das Rendern läuft lokal; fehlende Abhängigkeiten werden nicht automatisch nachinstalliert.

## Beispiele

```bash
comvenio news list --json
comvenio news show <news-id> --json
```

`list` zeigt unter anderem Titel, Entwurf/Live, Design-Quelle, Sichtbarkeit und ID.

```bash
comvenio news create \
  --title "Sommerfest 2026" \
  --teaser "Drei Tage voller Sport und Musik" \
  --content "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p>" \
  --visibility public \
  --cover <file-id> \
  --draft \
  --json
```

Deklaratives `news.json`:

```json
{
  "title": "Sommerfest 2026",
  "teaser": "Drei Tage voller Sport und Musik",
  "visibility_scope": "public",
  "cover_image_file_id": "<file-id>",
  "cover_url": "<kurzlebige-signierte-adresse-nur-zur-vorschau>",
  "content": "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p><figure><img src=\"<signierte-adresse>\" data-comvenio-file-id=\"<file-id>\" alt=\"Festplatz\"></figure>"
}
```

```bash
comvenio news preview --file news.json --json
comvenio news preview --file news.json --open
comvenio news preview --file news.json --local --out ./news-preview.html --json

comvenio news apply --file news.json --draft --json
comvenio news apply --file news.json --publish --json
```

Die Standard-Vorschau erzeugt eine kurzlebige Adresse im echten Layout und verändert keine News; `--local` schreibt eine Offline-Näherung, die für das Live-Layout nicht maßgeblich ist.

```bash
comvenio news update <news-id> --title "Neuer Titel" --json
comvenio news update <news-id> --file news.json --json
comvenio news publish <news-id> --json
comvenio news delete <news-id> --json
```

```bash
comvenio data list --context event --context-id <event-id> --json
comvenio data url <file-id> --json
comvenio data download <file-id> --out ./foto.jpg --json

comvenio data update <file-id> --context news --context-id <news-id> --label gallery --json
```

```bash
comvenio news video slideshow --params slideshow.json --out fest.mp4 --json
comvenio news video result --params result.json --out ergebnis.mp4 --json
comvenio news video teaser --params teaser.json --out teaser.mp4 --json
comvenio news video highlight --params highlight.json --out highlight.mp4 --json
```

Vorlagen:

| Vorlage | Pflichtfelder | Häufige optionale Felder |
|---|---|---|
| `slideshow` | Titel, mindestens zwei Bilder, Markenfarbe | Untertitel, Overlays, Dauer je Bild, Logo |
| `result` | Heim- und Gastteam, Heim- und Gastergebnis, Markenfarbe | Wettbewerb, Torschützen, Datum, Logo |
| `teaser` | Titel, Datum, Markenfarbe | Ort, Aktionstext, Hintergrundbild, Logo |
| `highlight` | Titel, Markenfarbe | Untertitel, Vereinsname, Datumsspanne, Kicker-Text, Überschrift der Programmliste, Programmpunkte (max. 3), Partner (max. 2), Hintergrundmotiv, Hinweistext, Abschlusstext, Hintergrundbild, Logo, Heldenbild, Sponsoren-Logos, eigene Farbgebung |

```json
{
  "title": "Sommerfest",
  "images": ["C:/bilder/1.jpg", "C:/bilder/2.jpg"],
  "brandColor": "#174a7e",
  "durationPerImage": 4
}
```

Highlight mit optionaler Partner-Szene:

```json
{
  "title": "Sommerfest",
  "brandColor": "#174a7e",
  "items": [{ "label": "Samstag", "text": "Fassanstich um 18 Uhr" }],
  "partners": [
    { "name": "Partnername", "subtitle": "Kurzbeschreibung", "logo": "C:/bilder/partner-logo.png" }
  ],
  "partnersBackdrop": "C:/bilder/partner-backdrop.png"
}
```

```bash
comvenio news video slideshow --params slideshow.json \
  --upload --context news --context-id <news-id> --json
```

## Befehle und Actions

<!-- gen:docs befehle -->

**news** — vollständig

- `comvenio news list`
- `comvenio news show`
- `comvenio news create`
- `comvenio news update`
- `comvenio news delete`
- `comvenio news apply`
- `comvenio news preview`
- `comvenio news publish`
- `comvenio news video slideshow|result|teaser`
<!-- /gen:docs -->

## Fehler

- `VALIDATION_FAILED` — Titel, Inhalt oder ein Vorlagenfeld für ein Video fehlt oder hat das falsche Format. Mehr: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — die News-ID gehört zu keinem sichtbaren Beitrag oder wurde gelöscht. Mehr: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt das Anlegen, Bearbeiten oder Veröffentlichen von News nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Schreib-Scope für News. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — die News wurde inzwischen geändert, zum Beispiel bereits veröffentlicht oder gelöscht. Mehr: `comvenio help fehler CONFLICT`
