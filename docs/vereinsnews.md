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

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen, zeigt `comvenio action list --json`. Ein Entwurf (`is_draft=true`) ist nur für berechtigte Redakteure sichtbar; erst mit der Veröffentlichung wird eine News für ihre Sichtbarkeitsgruppe sichtbar.

## Abläufe

### Status und Sichtbarkeit

| Feld | Bedeutung |
|---|---|
| `operation: draft` (bei `create`/`apply`) | nur für berechtigte Redakteure sichtbar; `reversible_write` |
| `operation: publish` (bei `create`/`apply`) | veröffentlicht; der Veröffentlichungszeitpunkt wird gesetzt; `critical_write` |
| `visibility_scope` | `public`, `member` oder `department`; Standard `member` |
| `design_source` | Standard `cli` |
| `is_pinned` | News anpinnen |

### Standard-Workflow: Bilder finden → News komponieren → prüfen → veröffentlichen

1. Bilder in DataShare finden oder zuerst dorthin hochladen (siehe [dateien.md](dateien.md)); ihre Datei-IDs (`cover_image_file_id`, Bilder im HTML) stammen aus diesem Schritt.
2. Die News als Objekt komponieren (`cai.news.03.create` oder `cai.news.06.apply`): Titel, Inhalt, Teaser, Sichtbarkeit, Titelbild.
3. Die Layout-Vorschau prüfen, bevor irgendetwas gespeichert wird — `cai.news.07.preview` rendert im echten Layout und schreibt nichts.
4. Mit `operation: draft` anlegen oder mit `operation: publish` direkt veröffentlichen. `publish` ist `critical_write`: Der Aufruf liefert zunächst nur eine Bestätigungs-Vorschau mit `preview_id` und `confirmation_token`; erst `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>` mit diesen Werten führt die Veröffentlichung aus.

Reine Vorschau-Felder wie eine kurzlebige Bild-Adresse, Vereinsname und Autorenname sind Teil der Eingabe von `cai.news.07.preview`, nicht der dauerhaften News selbst. Bilder im HTML brauchen zusätzlich zur Adresse eine stabile Datei-Kennung, damit die Anwendung eine abgelaufene Adresse automatisch neu signieren kann.

### Bestehende News aktualisieren (`cai.news.04.update`)

`changes` überträgt nur die tatsächlich zu ändernden Felder — alle anderen bleiben unverändert, eine bereits live geschaltete News wird dabei nicht zum Entwurf zurückgesetzt. `update` ist `critical_write` und läuft über dieselbe Bestätigungs-Vorschau wie oben beschrieben. Eine bereits angelegte News lässt sich mit `cai.news.08.publish` separat veröffentlichen (ebenfalls `critical_write`); `cai.news.05.delete` löscht sie (`critical_write`).

### Bilder aus DataShare zuordnen

Eine Datei, die schon vor der News-Erstellung hochgeladen wurde, lässt sich der News nachträglich über `cover_image_file_id` oder im HTML-Inhalt zuordnen.

### Rich-HTML-Regeln

- Semantische Struktur verwenden: Überschriften, Absätze, Listen, Tabellen sowie Bild mit Beschriftung.
- Bilder mit einer stabilen Datei-Kennung versehen; eine kurzlebige, signierte Adresse allein läuft ab.
- Für Videos das Standard-Steuerelement mit Metadaten-Vorschau verwenden; automatisches Abspielen ist nicht zulässig.
- Für YouTube ausschließlich die datenschutzfreundliche Einbettungsadresse `https://www.youtube-nocookie.com/embed/...` verwenden.
- Keine Skripte, Ereignis-Handler oder unbekannte eingebettete Adressen einbetten.

### Lokale Videos erzeugen (`cai.news.09.video_slideshow_result_teaser`)

Kurze Videos für Vereinsnews werden aus vier Vorlagen gerendert; die Bilder kommen dabei als bereits in DataShare hochgeladene Datei-IDs. Jede Vorlage verlangt eine Markenfarbe (`brandColor`, Hex-Wert) und weitere Pflichtfelder:

| Vorlage | Pflichtfelder | Optionale Felder |
|---|---|---|
| `slideshow` | Titel, mindestens zwei Bild-Datei-IDs, Markenfarbe | Untertitel, Overlays, Dauer je Bild (`duration_per_image`), Logo-Datei-ID |
| `result` | Heim- und Gastteam, Heim- und Gastergebnis, Markenfarbe | Wettbewerb, Torschützen, Datum, Logo-Datei-ID |
| `teaser` | Titel, Datum, Markenfarbe | Ort, Aktionstext, Hintergrundbild-Datei-ID, Logo-Datei-ID |
| `highlight` | Titel, Markenfarbe | Untertitel, Held-Datei-ID, Sponsoren-Datei-IDs, Hinweistext, Logo-Datei-ID |

Der Aufruf mit `operation: render` liefert eine `render_request_id`. Mit dieser Kennung lädt `operation: render_and_upload` das gerenderte Video direkt in einen Kontext (Standard `news`) hoch — das Video-Upload-Limit beträgt 200 MB. `render` ist `read`, `render_and_upload` ist `reversible_write`.

## Beispiele

```bash
comvenio action call cai.news.01.list --input '{"operation":"private","limit":50,"offset":0}'
comvenio action call cai.news.01.list --input '{"operation":"public","limit":50,"offset":0}'
comvenio action call cai.news.02.show --input '{"operation":"private","news_id":"<news-id>"}'
```

```bash
comvenio action call cai.news.07.preview --input '{
  "title": "Sommerfest 2026",
  "content": "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p><figure><img src=\"<signierte-adresse>\" data-comvenio-file-id=\"<file-id>\" alt=\"Festplatz\"></figure>",
  "teaser": "Drei Tage voller Sport und Musik",
  "cover_file_id": "<file-id>"
}'
```

```bash
comvenio action call cai.news.03.create --input '{
  "operation": "draft",
  "news": {
    "title": "Sommerfest 2026",
    "teaser": "Drei Tage voller Sport und Musik",
    "visibility_scope": "public",
    "cover_image_file_id": "<file-id>",
    "content": "<h2>Freitag</h2><p>Wir starten um 18 Uhr.</p><figure><img src=\"<signierte-adresse>\" data-comvenio-file-id=\"<file-id>\" alt=\"Festplatz\"></figure>"
  }
}'
```

```bash
comvenio action call cai.news.06.apply --input '{"operation":"publish","news":{"title":"Sommerfest 2026","content":"<p>…</p>","visibility_scope":"public"}}'
# Antwort liefert preview_id, confirmation_token, Ziel, Ist-Stand, Unterschied und Risiko
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.news.04.update --input '{"news_id":"<news-id>","changes":{"title":"Neuer Titel"}}'
comvenio action call cai.news.08.publish --input '{"news_id":"<news-id>"}'
comvenio action call cai.news.05.delete --input '{"news_id":"<news-id>"}'
```

`update`, `publish` und `delete` sind `critical_write` und laufen über dieselbe Bestätigungs-Vorschau wie oben gezeigt.

```bash
comvenio action call cai.data.01.list --input '{"context_type":"event","context_id":"<event-id>","limit":50,"offset":0}'
comvenio action call cai.data.04.url --input '{"file_id":"<file-id>"}'
comvenio action call cai.data.03.update --input '{"file_id":"<file-id>","changes":{"context_type":"news","context_id":"<news-id>","context_label":"gallery"}}'
```

```bash
comvenio action call cai.news.09.video_slideshow_result_teaser --input '{
  "operation": "render",
  "template": "slideshow",
  "params": {
    "title": "Sommerfest",
    "brandColor": "#174a7e",
    "image_file_ids": ["<file-id-1>", "<file-id-2>"],
    "duration_per_image": 4
  }
}'
```

```bash
comvenio action call cai.news.09.video_slideshow_result_teaser --input '{
  "operation": "render",
  "template": "highlight",
  "params": {
    "title": "Sommerfest",
    "brandColor": "#174a7e",
    "note_text": "Bis Samstag!"
  }
}'

comvenio action call cai.news.09.video_slideshow_result_teaser --input '{
  "operation": "render_and_upload",
  "template": "slideshow",
  "render_request_id": "<render-request-id>",
  "context_type": "news",
  "context_id": "<news-id>",
  "visibility": "private"
}'
```

## Befehle und Actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Fehler

- `VALIDATION_FAILED` — Titel, Inhalt oder ein Vorlagenfeld für ein Video fehlt oder hat das falsche Format. Mehr: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — die News-ID gehört zu keinem sichtbaren Beitrag oder wurde gelöscht. Mehr: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — die Scopes stimmen, aber die Vereinsrolle erlaubt das Anlegen, Bearbeiten oder Veröffentlichen von News nicht. Mehr: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — der Anmeldung fehlt der Schreib-Scope für News. Mehr: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — die News wurde inzwischen geändert, zum Beispiel bereits veröffentlicht oder gelöscht. Mehr: `comvenio help fehler CONFLICT`
- `OUTCOME_UNKNOWN` — bei einer ändernden Action (etwa `publish` oder `delete`) blieb die Serverantwort aus; vor einer Wiederholung mit einer lesenden Action prüfen, ob die Änderung schon angekommen ist. Mehr: `comvenio help fehler OUTCOME_UNKNOWN`
