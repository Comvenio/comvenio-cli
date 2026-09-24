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
- Für „Kontakt“ und „Mitglied werden“ gibt es das echte Widget `contact_form`
  (Name, E-Mail, Nachricht, Einwilligung, Spam-Schutz). Anfragen werden gespeichert,
  der Vorstand wird benachrichtigt, der Verein bearbeitet sie unter
  Verein → Kontaktanfragen bzw. mit `comvenio club contact-requests`. In der
  Vorschau sendet es nicht. Nie ein Formular in `custom_html` nachbauen.

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
  - Nicht messbar und deshalb kein Befund: Text auf Bild-, Video- oder
    Verlaufsflächen — auch dann, wenn die Fläche als absolut positioniertes
    Geschwister über dem Text liegt statt in seiner Elternkette (Karten mit
    Bild und Lesbarkeits-Verlauf). Solche Stellen zählen als
    `unverifiable_background`; vorher ergaben sie Phantombefunde mit einem
    Verhältnis nahe 1,0.
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

Erst nach der Freigabe. Vorher den Live-Stand sichern — `--clear` ersetzt alles:

```bash
comvenio homepage show --public --json > sicherung-home.json
comvenio club info --json > sicherung-club.json

comvenio club design --file design-settings.json --dry-run --json   # Warnungen lesen!
comvenio club design --file design-settings.json --json
comvenio homepage apply --file home.json --clear --json
comvenio homepage show --public --json
comvenio verify homepage --audit --json
```

**`club design` führt zusammen, es ersetzt nicht.** Jeder Schlüssel, der live
gesetzt ist und in der Datei fehlt, bleibt erhalten — und die Vorschau zeigt ihn
nicht, weil sie nur die Datei rendert. Das CLI nennt diese Schlüssel auf stderr
(„Diese Live-Schlüssel bleiben erhalten …“) und warnt ausdrücklich, wenn ein alter
`custom_template_config.landing: true` überlebt: Dann zeigt die Live-Seite **keine
Kopfzeile und keine Navigation**, obwohl die Vorschau richtig aussah. Für eine
normale Website deshalb `"landing": false` immer ausdrücklich in die Datei schreiben.

Nach dem Apply die Live-Seite im Bild prüfen (Kopfzeile, Navigation, Hero,
mobil). Wer die Seite vorher im Browser offen hatte, sieht nach einem
Plattform-Deploy mitunter einen alten App-Stand — `Strg+Umschalt+R` lädt neu.

Der Agent dokumentiert, welche Revision angewendet wurde. Bei einem Fehler wird
nicht mit direkten API-Aufrufen „nachgebessert“; stattdessen wird das CLI erweitert
oder die deklarative Datei korrigiert.

## 9. Qualitätscheckliste

### Verwaltete Organe, Serientermine und Lauftext

Das `team`-Widget kann mit `group_id` an ein Vereinsorgan gebunden werden.
`show_avatar` steuert die öffentlichen Comvenio-Avatare einschließlich der
Platzhalter. Namen und Positionstexte stammen aus den aktuellen Vereinsdaten;
Default-Positionen werden serverseitig ausgeschlossen. Ein gespeichertes Organ-Widget
auf einer öffentlichen, aktiven Seite gibt genau dieses Organ frei — auch als
`data-widget-slot` in `custom_html`. Ein separater Freigabeschalter ist nicht nötig.
Private Seiten, versteckte Sections und gelöschte Widgets geben nichts frei.
Nach Entfernen aller öffentlichen Widgets endet der Zugriff. Vorschauen sind
separat an ihren gültigen, zeitlich begrenzten Link gebunden (`preview_id`);
sie schalten den Live-Endpunkt nicht frei. Der Avatar-Schalter begrenzt auch die
öffentliche Datenprojektion. Bereits geladene Daten/Avatar-URLs können bis zum
nächsten Abruf beziehungsweise URL-Ablauf sichtbar bleiben.

Die Organansicht ist positionsbezogen: Auch unbesetzte, nicht-default Positionen
erscheinen mit Positionsbeschreibung, leerem Avatarplatz und „Nicht besetzt“.
Eine nicht verfügbare Datenquelle wird nicht als unbesetzte Position interpretiert.

Reihenfolge und Hervorhebung der Ämter (seit 2026-09-19):

- `position_order`: Ämter-IDs von oben nach unten, zum Beispiel
  `["<id 1. Vorstand>", "<id 2. Vorstand>"]`. Nicht genannte Ämter folgen in
  der Reihenfolge des Organs; unbekannte IDs werden ignoriert.
- `highlighted_position_ids`: Ämter, deren Karten einen Rahmen in der
  Vereinsfarbe bekommen (Raster, Karussell und Spotlight-Bühne).

Die Ämter-IDs liefert `comvenio club position-list --json` (Feld `group_id`
ordnet sie dem Organ zu) oder `club public-organ <group-id>`. Im Konfigurator
stellt der Verein beides unter der Organ-Auswahl ein.

Für das `image`-Widget bindet `source=club_logo` das aktuelle Vereinslogo;
es hat Vorrang vor einer hinterlegten Datei oder URL. Änderungen am Vereinslogo
werden beim nächsten Abruf übernommen. Der Editor bietet dieselbe Quellenauswahl.

`events_list.time_scope` unterscheidet `past` (abgeschlossene Veranstaltungen,
zuletzt beendet zuerst), `upcoming` (nächste Veranstaltungen) und `all`.
Rückblick und Ausschau können als zwei Widgets gestaltet werden. Der öffentliche
Rückblick wird bereits vor dem serverseitigen Limit nach Abschlussdatum sortiert.

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

## 10. Qualitätsrezept: Homepages auf Referenzniveau

Dieses Rezept beschreibt die Bauform der Referenz-Homepages (erstmals umgesetzt
im September 2026 für einen Schützenverein). Wer es einhält, erreicht dieselbe
Qualität, ohne Quelltext der Plattform zu sehen. Alle Namen unten sind Beispiele.

### 10.1 Bauform: Gerüst und benannte Slots

Seit dem Homepage-Designer (Lastenheft `homepage-generator/17-designer-struktur`)
gilt: **Das HTML ist nur Gerüst, jeder Inhalt ist ein benannter Slot.** Nur so
zeigt der Designer die Seite als Baum und ein Mensch kann jede Überschrift, jeden
Absatz und jeden Knopf im Formular ändern.

- **Je Tab genau eine Section `full` mit genau einem `custom_html`-Widget — dem
  Gerüst.** Es trägt nur Layout: Elemente, Klassen, und je Bereich ein
  `aria-label` (`<section aria-label="Startbild">`). Bereiche mit Namen werden im
  Designer zu Baumknoten; Container ohne Namen bleiben unsichtbar.
- **Jeder Inhalt ist ein benannter Slot** (`data-slot="<name>"`, Inhalt in
  `config.slots`) — auch Überschrift, Text und Knopf:
  - `heading` (`text`, `\n` für Zeilenumbruch), `text` (`content`: einfaches
    HTML mit strong, em, a, br, p, Listen), `link` (`label`, `href`, `new_tab`);
  - Live-Daten wie bisher als Slot ihrer Art: `ticker`, `news`, `events_list`,
    `event_highlight` mit `layout: "date"`, `team`, `image_gallery`, `files`,
    `image`, `background_video`, `contact_form`.
- **Ein Grundbaustein-Slot ist das Element selbst**, keine Hülle:
  `<h2 class="jaga-title" data-slot="verein-titel"></h2>`. Die Ebene (h1–h6)
  gehört zum Gerüst. Ein `link`-Slot ist ein `a`-Element. Live-Widgets stehen in
  einem `div`.
- **Namen** `^[a-z0-9][a-z0-9-]{0,62}$`, **je Reiter eindeutig** über alle
  Gerüste. Die Adresse `<reiter-slug>/<slot>` nutzen Designer und CLI gleich:
  `comvenio homepage slot get start/hero-titel`,
  `comvenio homepage slot set start/hero-titel --file entry.json`.
- **Stile, die ein Mensch umschalten soll, als Katalog anmelden**
  (`design_settings.styles`, `comvenio club design --file`). Katalogklassen stehen
  dann **nicht im Gerüst**, sondern als `style` im Slot; am Element bleiben nur
  Grundklassen. Wiederkehrende Bereiche als Vorlage anmelden
  (`design_settings.area_templates`).
- **Regeln R1–R6** (`comvenio schema homepage` → `slots_contract`): kein fester
  Text und kein Link/Bild im Gerüst außerhalb von Slots, jeder Slot benannt mit
  genau einem Eintrag, Bereiche mit `aria-label`, bekannte Stile, genau eine `h1`
  je Reiter. Der club-service lehnt Fehler im neuen Format mit
  `422 skeleton_rules` ab — auf jedem Schreibweg.
- **Vor `apply`:** `comvenio verify homepage --file home.json` meldet R1–R6 vor dem
  Browserlauf; Fehler beenden den Lauf mit Exit 4.
- Keine erfundenen Termine, Namen, Zahlen oder Kontaktdaten. Fehlt eine
  Information, bleibt der Slot mit einem ehrlichen Platzhalter („Vereinsfoto
  folgt“), nicht mit einem Fantasiewert.
- Navigation zwischen Tabs als `link`-Slot mit `href: "?tab=<slug>"`.

**Bestehende Seiten im Altformat** (`data-widget-slot`, fester Text im HTML)
bleiben lesbar, der Designer bearbeitet dort aber nur die Slot-Inhalte. Umstellen:
`comvenio homepage convert --out home.json [--styles styles.json]` → offene
Stellen aus dem Bericht von Hand lösen → `homepage preview --file home.json` →
Bildvergleich gegen die Live-Seite → `homepage apply` erst nach Freigabe.

Altformat zum Vergleich (nicht mehr für neue Seiten):
`<div data-widget-slot="news" data-widget-config="{&quot;limit&quot;:3}"></div>`

### 10.2 Design-Datei vollständig schreiben

```json
{
  "homepage_theme": "modern",
  "homepage_template": "flex",
  "primary_color": "#006846",
  "secondary_color": "#2B241D",
  "accent_color": "#D3A52D",
  "custom_template_config": {
    "landing": false,
    "public_header": { "layout": "brand-left", "surface": "light", "density": "comfortable", "sticky": true }
  },
  "custom_css": ".sv-page{...}"
}
```

- `landing: false` immer ausdrücklich (siehe §8).
- `custom_css` wird auf `.pub-site-root` begrenzt. Eigene Klassen mit einem
  Vereinspräfix (`.sv-…`) benennen; Farben als CSS-Variablen am Seitenwurzel-Element.
- Überschriften-Serif plus ruhige Grotesk für Fließtext, großzügige Abstände
  (Sektionen 80–110 px vertikal), eine Akzentfarbe für Knöpfe und Kicker.

### 10.3 Logo und Wappen

- Das Vereinslogo in Kopfzeile und überall sonst: `comvenio club logo-upload --file wappen.png`
  (nicht `data upload` — ein normaler Datei-Upload ersetzt das Logo nicht).
- Liegt das Logo als EPS/SVG vor: lokal in ein PNG mit transparentem Hintergrund
  umwandeln, mindestens ~1000 px Kantenlänge (z. B. Ghostscript `pngalpha`).
- Im Hero ein freigestelltes Wappen als `image`-Slot mit `file_id` und
  `"card_style": "none"` — sonst liegt ein Karten-Schatten mit runden Ecken als
  Kasten um das transparente Bild. `source: "club_logo"` nimmt stattdessen das
  aktuelle Vereinslogo.

### 10.4 Mobil zuerst prüfen

- Für jede Sektion ein Umbruch bei ≤ 900 px und ≤ 600 px; Raster einspaltig,
  Knöpfe umbrechen statt überlaufen.
- Hero-Grafiken auf dem Handy nicht per `display:none` wegwerfen. Bewährt:
  Wappen absolut rechts neben der Schlagzeile, halbtransparent (`opacity ≈ .5`),
  teils über den Rand hinaus, Text davor mit leichtem `text-shadow`.
- Kein horizontaler Überlauf bei 390 px.

### 10.5 CSS für Widget-Innenleben

Widgets rendern in den Slot hinein; nicht jedes trägt die Klasse `.widget-base`.
Regeln für Slot-Inhalte über den eigenen Container schreiben
(`.sv-hero-mark > div { width: … }`) und **vor** dem Schreiben den echten Aufbau
im Vorschau-Screenshot bzw. mit `comvenio verify url <preview-url>` ansehen. Eine
Regel, die nie greift, fällt sonst erst im Bild auf.

### 10.6 Prüfen wie die Referenz

1. `homepage preview --ttl-hours 24` — Link dem Menschen geben.
2. Bildvergleich an **390, 768, 1024 und 1440 px** (`verify url <preview-url>` bzw.
   Screenshots aus `verify homepage`): Hero, Kopfzeile, Navigation, Sektionen.
3. `verify homepage --file … --audit` — Exit 0 anstreben; Kontrastbefunde in
   eingebetteten Fremdinhalten (Fest-/Event-Embeds, iframes) getrennt benennen.
4. Nach dem Apply dieselben Breiten live prüfen, einschließlich Kopfzeile.

### 10.7 Datenschutz beim Gestalten

- Ein `team`-Widget mit `group_id` auf einer öffentlichen Seite macht die Namen
  des Organs öffentlich (Freigabe ergibt sich aus dem Widget). Vorher mit dem
  Verein klären.
- `contact_form` speichert Anfragen; Löschfrist 30 Tage nach Löschen, 365 Tage
  nach Eingang.
- Geburtstage im Lauftext nur nach ausdrücklicher Klärung (Vorname, Tag/Monat).

## 11. Fehlerbild → Ursache → Abhilfe

| Fehlerbild | Ursache | Abhilfe |
|---|---|---|
| Live fehlen Kopfzeile und Navigation, Vorschau zeigt sie | alter `landing: true` überlebt das Zusammenführen | `"landing": false` in die Design-Datei, erneut `club design --file` |
| Dunkler Kasten/Schatten um ein freigestelltes Logo | Bild-Widget zeichnet eine Karte | `"card_style": "none"` am `image`-Slot |
| Hochformatiges Wappen in der runden Kopfzeile beschnitten | ältere Plattformversion | aktuelle Web-App; Logo quadratisch oder transparent hochladen |
| „Kein Bild konfiguriert“ nur bei einer Person | alter App-Stand im Browser-Cache | `Strg+Umschalt+R` |
| Hochgeladene Dateien fehlen im DataShare | Upload ohne Abteilung (vor Sept. 2026) | aktuelle Plattform setzt die Standard-Abteilung; Altbestand per Nachtrag |
| Eigene CSS-Breite greift nicht | Selektor zielt auf eine Klasse, die der Slot nicht trägt | Slot-Container ansprechen (`.x > div`), DOM vorher ansehen |
| Verifier Exit 4 nur auf einer Event-Seite | Kontrast im eingebetteten Event-Hub | getrennt melden; nicht mit Homepage-CSS „reparieren“ |
| Organ zeigt viele „Nicht besetzt“ | Positionen im Verein ohne Zuordnung | Vereinsdaten pflegen, nicht im HTML überdecken |
