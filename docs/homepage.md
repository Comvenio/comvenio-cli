# Vereins-Homepages mit der Comvenio CLI

Dieser Leitfaden ist der verbindliche Arbeitsvertrag für KI-Agenten, die eine
öffentliche Vereins-Homepage erstellen oder ändern. Homepage-Operationen laufen
ausschließlich über die Comvenio CLI. Direkte Requests gegen Comvenio-APIs sind
verboten.

## 1. Grundsatz

Der bedienende Agent ist die Design- und Kompositionsintelligenz. Es gibt keinen
zweiten Homepage-LLM-Aufruf im Backend.

`schema → Bestand lesen → Struktur/Design komponieren → Preview → Verifier → menschliche Freigabe → Apply`

Pflichtregeln:

1. Vor jeder Arbeit `comvenio schema homepage --json` und
   `comvenio schema design --json` lesen.
2. Bestehende Homepage mit `comvenio homepage show --public --json` lesen.
3. Struktur als deklaratives JSON erstellen. Keine direkten API-Aufrufe.
4. Immer zuerst eine No-Write-Preview erzeugen und im Browser öffnen.
5. Den Homepage-Verifier vollständig ausführen.
6. Ohne ausdrückliche menschliche Freigabe niemals `homepage apply --clear`
   ausführen.
7. Nach einer CLI-Änderung nur eine gemergte und neu installierte CLI verwenden.

## 2. Authentifizierung und Kontext

```bash
comvenio login
comvenio whoami --json
comvenio club info --json
```

Der Club kommt normalerweise aus dem CLI-State. Bei bewusster Arbeit für einen
anderen Verein wird `--club <club-id>` gesetzt. UUIDs werden nicht geraten.

## 3. Maschinenlesbare Verträge

```bash
comvenio schema homepage --json > homepage-schema.json
comvenio schema design --json > design-schema.json
```

Das Homepage-Schema ist autoritativ für:

- `widget_kinds` und die Config-Felder jedes Widgets
- Section-Layouts und Style-Varianten
- öffentliche Detailrouten für News und Veranstaltungen
- sichere, konfigurierbare Button-Ziele
- den nicht konfigurierbaren `public_shell_contract`

Unbekannte Felder, Widget-Arten oder Enum-Werte werden nicht erfunden.

## 4. Unveränderbare öffentliche Shell

Der Agent konfiguriert ausschließlich die eigentlichen Homepage-Inhalte. Die
Plattform rendert immer und unabhängig vom Homepage-JSON:

| Element | Festes Ziel |
|---|---|
| Impressum | `/impressum` auf der Vereins-Homepage |
| Datenschutz | `https://www.comvenio.app/datenschutz` |
| AGB | `https://www.comvenio.app/agb` |
| Powered by Comvenio | `https://www.comvenio.app` |

Das Impressum bezieht seine Daten automatisch aus einer öffentlichen Allowlist:

1. `ClubSettings.contact_info` für Adresse, E-Mail, Telefon und Website
2. leere Werte fallen auf die öffentlichen Club-Stammdaten zurück
3. Vereinsname, Rechtsform und Registernummer kommen aus den Club-Stammdaten
4. optionale Verantwortlichkeit kommt ausschließlich aus `ClubSettings.custom_settings.legal_info` (`responsible_label`, `responsibility_text`); fehlt sie, gilt:
   „Eigentümer des Vereins“ und „Verantwortlich für die Inhalte ist der Verein.“

Ist die öffentliche Homepage in den Club-Features explizit deaktiviert, liefert die interne Legal-Quelle 404 und keine Kontaktdaten.

Nie öffentlich ausgegeben werden Zahlungsdaten, Bankverbindungen, Stripe-Secrets,
Steuernummern, Member-/User-IDs oder Auditfelder.

Agenten dürfen:

- keinen Pflicht-`rechtliches`-Tab erzeugen
- kein `legal_notice`-Widget als Quelle des Impressums voraussetzen
- die Pflichtlinks nicht in `custom_html` duplizieren
- den Rechtsfooter nicht per `custom_css` verstecken oder umleiten

`legal_notice` existiert nur aus Rückwärtskompatibilität als optionaler
Legacy-Inhaltsblock.

## 5. Struktur komponieren

Eine Homepage-Datei entspricht dem deklarativen Bulk-Vertrag:

```json
{
  "clear_existing": false,
  "tabs": [
    {
      "label": "Start",
      "slug": "start",
      "position": 0,
      "visibility_scope": "public",
      "sections": [
        {
          "layout": "full",
          "style_variant": "default",
          "sort_order": 0,
          "is_visible": true,
          "widgets": [
            {
              "kind": "hero",
              "slot_index": 0,
              "config": {
                "headline": "Willkommen",
                "cta_primary_label": "Aktuelles",
                "cta_primary_url": "?tab=news"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

`clear_existing` in der Datei ist nicht die Freigabe für einen destruktiven
Write. Der CLI-Write wird ausschließlich über das bewusste Flag `--clear`
gesteuert.

### Zwei Mannschaften in zwei Spalten

`two-col` füllt desktop zeilenweise von links nach rechts. Für dauerhaft
gleiche Mannschaftsspalten werden Tabelle und nächste Spiele in zwei ausgerichteten
Sections angeordnet:

```json
[
  {
    "layout": "two-col",
    "title": "Tabellen",
    "widgets": [
      { "kind": "fupa_widget", "slot_index": 0,
        "config": { "widgetId": "<tabelle-erste>", "title": "Tabelle · 1. Mannschaft" } },
      { "kind": "fupa_widget", "slot_index": 1,
        "config": { "widgetId": "<tabelle-zweite>", "title": "Tabelle · 2. Mannschaft" } }
    ]
  },
  {
    "layout": "two-col",
    "title": "Nächste Spiele",
    "widgets": [
      { "kind": "fupa_widget", "slot_index": 0,
        "config": { "widgetId": "<spiele-erste>", "title": "Nächste Spiele · 1. Mannschaft" } },
      { "kind": "fupa_widget", "slot_index": 1,
        "config": { "widgetId": "<spiele-zweite>", "title": "Nächste Spiele · 2. Mannschaft" } }
    ]
  }
]
```

Die vollständigen FuPa-Felder stehen ausschließlich im Schema. Aktuell ist
`widgetId` Pflicht; `title`, `includeSrc`, `hrefUrl`,
`hrefLabel`, `height` und `show_title` sind optional.

## 6. Design komponieren

### Verwaltbare Galerie, Downloads und Lauftext

Diese Ergänzungen benötigen die dazugehörigen ausgelieferten Web- und Service-Versionen.
Das CLI-Schema wird vollständig aus der passenden Web-Deklaration erzeugt.
Hinweise zu nicht gelesenen Feldern bleiben als Diagnose sichtbar; daraus folgt
keine Zusicherung, dass jedes bestehende Widget jedes deklarierte Feld verwendet.

- `image_gallery.source`: `files` (bewusst ausgewählte `file_ids` in Reihenfolge),
  `club` (öffentliche Vereinsbilder), `event` (`event_id`), `recent_events`
  (letzte drei abgeschlossene öffentliche Events), `folder` (`folder_id`, direkte
  Ordnerinhalte) oder `urls` (externe `urls`). `limit`: 1–50, Standard 24.
- Nur öffentliche, fertige, aktive Bilder desselben Vereins; Event-Quellen lassen
  Titelbilder/Flyer/Logos aus. Ordnerquelle braucht die öffentliche Galerieprojektion;
  niemals als Ersatz einen privaten Ordnerabruf verwenden. Keine automatische
  Änderung der Dateirechte. Moments sind noch keine freigegebene öffentliche Quelle.
- `files.source=files` mit `file_ids` bietet gezielte Downloads, z. B. genau das
  Antrags-PDF. Eine leere Auswahl zeigt keine beliebigen anderen Vereinsdateien.
- `ticker`: `show_events`, `show_news`, `show_birthdays`, `news_limit`, `events_limit`.
  Für zwei neueste News `news_limit=2`; zusätzliche Quellen standardmäßig aus.
  Geburtstage nur nach geklärter Veröffentlichung, nur Vorname und Tag/Monat.
- In eingebetteten `custom_html`-Widgets lassen sich diese Inhalte auch über
  „Bildergalerie/Downloads/News/Lauftext verwalten“ bedienen; kein HTML-Editieren nötig.
- Dateiquellen werden regelmäßig neu gelesen; Berechtigungsänderungen können durch
  bereits ausgegebene zeitlich begrenzte Download-URLs verzögert sichtbar werden.
- Das bisherige `membership_form` ist kein digitaler Aufnahmeprozess. Es darf keinen
  erfolgreichen Antrag bestätigen, bevor ein echter Antragsendpunkt angebunden ist.

### Event-Datum im eigenen Layout

Ab der Web-/CLI-Version mit `event_highlight.layout=date` lassen sich
Event-Termine als Inline-Text einbetten. Vorher das installierte Schema und
den Renderer-Stand prüfen; ältere Renderer kennen diese Variante nicht.

```html
<span data-widget-slot="event_highlight"
      data-widget-config='{"event_id":"<event-id>","layout":"date","date_format":"full","date_timezone":"Europe/Berlin"}'></span>
```

Die Event-ID ist bei dieser Darstellung Pflicht. `date_format` ist `full`
(vollständiger Zeitraum), `days` (Tageszahlen) oder `month-year` (Monat/Jahr).
Bei Monats-/Jahreswechsel wird ein vollständiger Zeitraum angezeigt.
Farbe und Schrift kommen aus dem umgebenden Layout. Es entsteht keine Karte
und keine zweite Kopie des Termins. Die Event-Daten werden beim Laden über
die bestehende öffentliche Quelle gelesen; Sofortaktualisierung bereits
offener anonymer Seiten wird damit nicht zugesichert. Bei nicht verfügbarem
Event wird kein fest eingetragener Ersatztermin ausgegeben.

```bash
comvenio club design --file design-settings.json --dry-run --json
```

Das Design stammt aus `comvenio schema design --json`. Vereinsfarben und
Kontrast werden als Design-Tokens gesetzt; Layout und Look werden nicht durch
club-spezifischen Frontend-Code implementiert.

### Landing-Modus (Vollbild-Teaser ohne Chrome)

`custom_template_config.landing` (boolean, Default `false`) schaltet das
Flex-Template in einen bare Vollbild-Modus für reine Teaser-/Kampagnen-Landings:

- Kein Header — weder die interne FlexTemplate-Navigation noch ein gesetzter
  `public_header`.
- Kein Template-Hero, kein About-Block, kein Design-Footer.
- `<main>` wird full-bleed gerendert (kein `maxWidth`/Padding) — eine einzige
  Section füllt den gesamten Viewport.
- Der `PublicLegalFooter` (Impressum/Datenschutz/AGB/„Powered by Comvenio“)
  bleibt **immer** sichtbar unter dem Inhalt — er wird außerhalb des
  Flex-Templates gerendert (Abschnitt 4) und ist vom Landing-Modus nicht
  betroffen.
- **Landing impliziert 1-Tab-Nutzung:** ohne Navigation sind weitere Tabs für
  Besucher unerreichbar. Bewusste Wahl für reine Teaser-Seiten, kein Fehler.

Setzen (Beispiel-Ausschnitt für `design-settings.json`):

```json
{
  "homepage_theme": "...",
  "primary_color": "#..",
  "custom_template_config": { "landing": true, "hero": { "variant": "video" } }
}
```

Wichtig: `custom_template_config` wird beim `club design --file`-Write
**gemergt**, nicht ersetzt — bestehende Overrides (Hero, Sections,
Look-Recipe, ...) bleiben erhalten. `landing` ist ein reines
`custom_template_config`-Feld, kein Widget-`kind` — es unterliegt nicht der
Widget-kind-Synchronität, steht aber wie jedes Design-Feld in
`comvenio schema design --json`.

**Ausblick (noch nicht gebaut):** ein geplantes `landing_cta`-Feld soll einen
konfigurierbaren „Weiter“-Button ergänzen und die Landing so zur
Vorschalt-Seite vor der eigentlichen Homepage machen. Aktuell nicht im Schema
— nicht verwenden, bis es in `comvenio schema design --json` erscheint.

### background_video Spotlight-Layout

Das Widget `background_video` (`comvenio schema homepage --json`) kennt zwei
Layouts:

| Layout | Wirkung |
|---|---|
| `cover` (Default) | Video als klassischer Vollbild-Hintergrund hinter dem Section-Content |
| `spotlight` | Video als gerahmte Highlight-Card auf einer gebrandeten Fläche, mit Logo-/Titel-/Teaser-Slots |

Spotlight-Config-Felder (zusätzlich zu den Basis-Feldern `video_file_id` /
`video_url` / `poster_file_id` / `poster_url` / `overlay` / `loop` /
`headline`):

| Feld | Bedeutung |
|---|---|
| `layout` | `"cover"` oder `"spotlight"`, Default `"cover"` |
| `background` | CSS-Hintergrund der gebrandeten Fläche hinter der Video-Card |
| `accent_color` | Akzentfarbe für `[[wort]]`-Markup im `title` |
| `text_color` | Textfarbe auf der Fläche |
| `logo_file_id` / `logo_url` | Emblem links (Datei-ID bevorzugt — wird beim Public-Read re-signed) |
| `logo_right_file_id` / `logo_right_url` | Zweites Emblem/Sponsor-Logo rechts |
| `eyebrow` | Kicker-Zeile über dem Titel |
| `title` | Überschrift; `[[wort]]` markiert ein Wort zur Hervorhebung in `accent_color` |
| `date_badge` | Pill-Badge (z. B. Datum/Ort) |
| `claim` | Schlusszeile unter der Video-Card; `\n` erlaubt für Zeilenumbruch |

Medien immer über `*_file_id` referenzieren — die `url`-Felder sind nur ein
kurzlebiger Fallback und laufen beim Public-Read ins Leere, sobald die
presignte URL abläuft.

## 7. Preview und Verifier

```bash
comvenio homepage preview \
  --file home.json \
  --design-file design-settings.json \
  --ttl-hours 24 \
  --open \
  --json

comvenio verify homepage \
  --file home.json \
  --design-file design-settings.json \
  --audit \
  --json
```

Die Preview gilt standardmäßig 30 Minuten. Mit `--ttl-hours <1-24>` übermittelt
das CLI eine längere, serverseitig begrenzte Laufzeit; für eine ganztägige
Abnahme wird `--ttl-hours 24` verwendet.

Ohne `--file` prüft der Verifier die verwaltete Live-Adresse des Vereins. Sie
wird ausschließlich aus `Club.subdomain` gebildet: in PROD als
`https://<subdomain>.web.comvenio.app`, in DEV als
`https://<subdomain>.web.dev.comvenio.app`. Technische Kennungen wie `Club.slug`,
`handle` oder `public_slug` sind keine Homepage-Adresse und werden nicht als
Fallback verwendet. Fehlt die Subdomain, weist das CLI auf die Club-Einstellungen
oder die Entwurfsprüfung mit `--file` hin.

Die Preview verändert die Live-Homepage nicht. Der Verifier prüft:

- jeden öffentlichen Tab
- die separate Impressum-Seite
- Mobile, Tablet, Landscape und Desktop
- horizontales Überlaufen und leere Hauptregionen
- unsichtbaren Text und WCAG-Kontrast
- Console- und Same-Origin-Netzwerkfehler
- den unveränderbaren Rechtsfooter und alle festen Ziele
- Sichtbarkeit, Pointer-Bedienbarkeit und Mittelpunkt-Hit-Test aller Pflichtlinks
- Vereinsverantwortlichkeit auf der Impressum-Seite
- erfolgreich geladene Legal-Daten und mindestens eine öffentliche Kontaktangabe

Exit-Codes:

| Code | Bedeutung |
|---|---|
| 0 | vollständig geprüft, keine behebbaren Findings |
| 2 | Prüfung unvollständig, etwa Browser-/HTTP-/Navigationsfehler |
| 4 | vollständig geprüft, aber behebbarer Qualitäts- oder Rechtsseitenfehler |

Screenshots und JSON-Bericht müssen dem Nutzer gezeigt werden. Ein Exit 0 ersetzt
nicht die menschliche Designfreigabe.

## 8. Anwenden

Erst nach der Freigabe:

```bash
comvenio homepage apply --file home.json --clear --json
comvenio club design --file design-settings.json --json
comvenio homepage show --public --json
comvenio verify homepage --audit --json
```

Der Agent dokumentiert, welche Revision angewendet wurde. Bei einem Fehler wird
nicht mit direkten API-Aufrufen „nachgebessert“; stattdessen wird das CLI erweitert
oder die deklarative Datei korrigiert.

## 9. Qualitätscheckliste

### Verwaltete Organe, Serientermine und Lauftext

Das `team`-Widget kann mit `group_id` an ein Vereinsorgan gebunden werden.
`show_avatar` steuert die öffentlichen Comvenio-Avatare einschließlich der
Platzhalter. Namen und Positionstexte stammen aus den aktuellen Vereinsdaten;
Default-Positionen werden serverseitig ausgeschlossen. Die Auswahl eines Organs
ist noch keine öffentliche Freigabe: Diese muss im Club Hub separat erfolgen.
Ohne Freigabe werden keine privaten Mitglieder als Ersatz angezeigt.

`event_highlight` kann über `series_id` die nächste veröffentlichte Veranstaltung
einer bestimmten Serie anzeigen. Die Datumsformate `weekday-time` und `time`
eignen sich für Vereinsabende. Angezeigt werden echte materialisierte Termine,
keine aus einem Text angenommene Wiederholung.

Beim Lauftext steuert `speed_px_per_second` die Geschwindigkeit (10–150).
Die Einstellung ist im Widget-Editor verfügbar; die Geschwindigkeit bleibt
auch bei unterschiedlich langen Inhalten konstant. Beispielsweise entspricht
55 einer mittleren Geschwindigkeit.

### Abnahme

Vor Übergabe prüfen:

- Homepage ist kein One-Pager, wenn der Nutzer mehrere Seiten verlangt.
- Navigation, News, Veranstaltungen und Buttons öffnen echte Ziele.
- Bilder verwenden stabile Comvenio-Datei-IDs bzw. öffentliche Datei-URLs.
- Vereinsfarben, Kontrast und responsive Layouts sind geprüft.
- Partnersponsoren zeigen Logo und sichere Website-Verlinkung.
- Keine technischen Erklärtexte stehen sichtbar in der Homepage.
- Kein Pflicht-Rechtsinhalt ist als konfigurierbares Widget modelliert.
- Impressum, Datenschutz, AGB und Powered-by sind in Preview und Live vorhanden.
- Preview-URL, Screenshots und Verifier-Bericht wurden gezeigt.
- Apply erfolgte erst nach ausdrücklicher Freigabe.
