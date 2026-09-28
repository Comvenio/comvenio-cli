---
id: homepage
kategorie: thema
domaenen: [homepage]
stichwoerter: [homepage, website, vereinsseite, widgets, design]
---

# Vereins-Homepage gestalten

## Wozu

Mit dem CLI wird die öffentliche Vereins-Homepage aufgebaut und gepflegt:
Struktur, Inhalte und Design werden als deklaratives JSON beschrieben, in
einer Vorschau geprüft und erst nach ausdrücklicher Freigabe veröffentlicht.
Es gibt keinen automatischen Text- oder Design-Generator im Hintergrund — wer
die Seite gestaltet, komponiert sie über die hier beschriebenen Befehle
selbst.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

```bash
comvenio login
comvenio whoami --json
comvenio club info --json
```

Der Verein kommt normalerweise aus dem angemeldeten Kontext. Für bewusste
Arbeit an einem anderen Verein wird `--club <club-id>` gesetzt; Kennungen
werden dabei nie geraten, sondern vorher nachgeschlagen.

Design- und Veröffentlichungsschritte (`club design`, `homepage apply`)
brauchen das Recht, Vereinseinstellungen zu verwalten. Fehlt es, meldet
Comvenio `PERMISSION_DENIED` — das Recht vergibt ein Administrator des
Vereins. Fehlt der Anmeldung der nötige Scope, meldet Comvenio
`SCOPE_REQUIRED` mit dem passenden `comvenio login --scopes …`-Befehl.

## Abläufe

### Werkzeugkette

Jede Änderung folgt derselben Reihenfolge: Verträge lesen → Bestand lesen →
Struktur und Design komponieren → Vorschau erzeugen → Prüfung laufen lassen →
Freigabe einholen → anwenden. Kein Schritt wird übersprungen, und
`homepage apply --clear` läuft nie ohne ausdrückliche Freigabe.

### Verträge und Bestand lesen

```bash
comvenio schema homepage --json > homepage-schema.json
comvenio schema design --json > design-schema.json
comvenio homepage show --public --json
```

Das Homepage-Schema ist maßgeblich für die verfügbaren Widget-Arten und ihre
Config-Felder, für Section-Layouts und Stilvarianten, für die öffentlichen
Detailrouten zu News und Veranstaltungen, für sichere Button-Ziele und für den
nicht konfigurierbaren, immer gleichen Rahmen der Seite. Unbekannte Felder,
Widget-Arten oder Werte werden nicht erfunden, sondern im Schema
nachgeschlagen.

### Unveränderbare Bereiche der Seite

Konfiguriert werden nur die eigentlichen Homepage-Inhalte. Unabhängig vom
Homepage-JSON zeigt jede Vereinsseite immer:

| Element | Festes Ziel |
|---|---|
| Impressum | eigene Impressum-Seite der Vereins-Homepage |
| Datenschutz | zentrale Datenschutzseite von Comvenio |
| AGB | zentrale AGB-Seite von Comvenio |
| „Powered by Comvenio" | Comvenio-Startseite |

Das Impressum bezieht seine Angaben automatisch: zuerst aus den hinterlegten
Kontaktdaten des Vereins (Adresse, E-Mail, Telefon, Website), bei leeren
Werten aus den öffentlichen Vereins-Stammdaten. Vereinsname, Rechtsform und
Registernummer kommen ebenfalls aus den Stammdaten. Eine abweichende
Verantwortlichkeit lässt sich hinterlegen; fehlt sie, gilt „Eigentümer des
Vereins" mit dem Hinweis „Verantwortlich für die Inhalte ist der Verein.". Ist
die öffentliche Homepage in den Vereinsfunktionen abgeschaltet, liefert die
Impressum-Seite keine Kontaktdaten mehr. Nie öffentlich ausgegeben werden
Zahlungsdaten, Bankverbindungen, Steuernummern, Mitglieder- oder
Benutzerkennungen sowie interne Prüffelder.

Verboten sind deshalb: ein eigener Pflicht-Tab „Rechtliches", ein
Inhaltswidget als vermeintliche Quelle des Impressums, doppelte Pflichtlinks
in freiem HTML und ein per eigenem CSS versteckter oder umgeleiteter
Rechtsfußzeile. Ein älteres Inhaltswidget für rechtliche Hinweise existiert
nur noch aus Gründen der Rückwärtskompatibilität.

### Struktur der Seite aufbauen

Eine Homepage besteht aus Tabs (Reitern), jeder Tab aus Sections, jede Section
aus Widgets. Die vollständige Struktur wird als eine Datei geschrieben (siehe
Beispiele). Das Feld `clear_existing` in dieser Datei ist keine Freigabe für
einen löschenden Write — gesteuert wird das ausschließlich über das bewusste
CLI-Flag `--clear` beim Anwenden.

### Inhalte gestalten

- **Bildergalerie** (`image_gallery`): Quelle wahlweise ausgewählte Dateien,
  öffentliche Vereinsbilder, die Bilder einer Veranstaltung, die letzten drei
  abgeschlossenen öffentlichen Veranstaltungen, ein Ordner oder externe
  Adressen; `limit` 1–50, Standard 24. Es erscheinen nur öffentliche, fertige,
  aktive Bilder desselben Vereins; Titelbilder, Flyer und Logos einer
  Veranstaltung werden dabei ausgelassen. Die Ordnerquelle zeigt ausschließlich
  die öffentlich freigegebene Ansicht eines Ordners, nie einen privaten
  Dateibestand. Bereits ausgelieferte, zeitlich begrenzte Bildadressen können
  eine kurz zuvor geänderte Berechtigung noch eine Weile weiter zeigen.
- **Downloads** (`files` mit `source=files`): eine feste Auswahl an
  Datei-Kennungen zeigt gezielt einzelne Dokumente, etwa ein Antragsformular.
  Eine leere Auswahl zeigt keine beliebigen anderen Vereinsdateien.
- **Lauftext/Ticker** (`ticker`): `show_events`, `show_news`,
  `show_birthdays`, `news_limit`, `events_limit`. Geburtstage werden nur nach
  ausdrücklicher Klärung mit dem Verein gezeigt, und immer nur mit Vorname
  sowie Tag und Monat. Die Geschwindigkeit steuert `speed_px_per_second`
  (10–150; ein mittlerer Wert liegt bei etwa 55) und bleibt bei
  unterschiedlich langen Inhalten konstant.
- **Kontaktformular** (`contact_form`): Name, E-Mail, Nachricht, Einwilligung
  und Spam-Schutz. Anfragen werden gespeichert, der Vorstand benachrichtigt,
  der Verein bearbeitet sie im Verein-Bereich oder über
  `comvenio club contact-requests`. In der Vorschau versendet das Formular
  nichts. Ein älteres, rein informatives Beitrittsformular bestätigt keinen
  erfolgreichen Antrag und darf dafür auch nicht gehalten werden; für Kontakt
  und Mitgliedsinteresse ist ausschließlich `contact_form` vorgesehen. Ein
  Formular selbst aus freiem HTML nachzubauen ist nicht vorgesehen. Gespeicherte
  Anfragen werden 30 Tage nach dem Löschen endgültig entfernt, spätestens aber
  365 Tage nach Eingang.
- **Vereinsorgan** (`team` mit `group_id`): zeigt die Positionen eines
  Vereinsorgans mit aktuellen Namen; Standardpositionen werden dabei
  ausgeschlossen. Vorher mit dem Verein klären, denn ein gespeichertes,
  öffentliches Organ-Widget macht die Namen des Organs öffentlich. Auch
  unbesetzte, nicht-standardmäßige Positionen erscheinen mit
  Positionsbeschreibung und dem Hinweis „Nicht besetzt" — eine vorübergehend
  nicht verfügbare Datenquelle wird dabei nicht als unbesetzte Position
  ausgegeben. Öffentliche Comvenio-Profilbilder werden nur mit `show_avatar`
  angefordert; fehlende Bilder sind erlaubt. Ein gespeichertes Organ-Widget
  auf einer öffentlichen, aktiven Seite gibt das Organ frei — ein separater
  Freigabeschalter ist nicht nötig; private Seiten, versteckte Sections und
  gelöschte Widgets geben nichts frei. Reihenfolge und Hervorhebung der
  Positionen lassen sich mit `position_order` (Positions-IDs von oben nach
  unten — nicht genannte Positionen folgen in der Reihenfolge des Organs,
  unbekannte Kennungen werden ignoriert) und `highlighted_position_ids`
  (farblich hervorgehobene Karten) steuern; die passenden IDs liefern die
  Positions- und Organ-Abfragen des Vereins.
- **Veranstaltungsliste** (`events_list`): `time_scope` unterscheidet
  vergangene (zuletzt beendet zuerst), kommende und alle Veranstaltungen.
  Rückblick und Ausschau lassen sich als zwei getrennte Widgets gestalten.
- **Termin im Fließtext** (`event_highlight` mit `layout: "date"`): bettet ein
  Veranstaltungsdatum als Inline-Text statt als Karte ein — Farbe und Schrift
  übernimmt das umgebende Layout. Die Veranstaltungs-ID ist hier Pflicht;
  `date_format` ist `full` (vollständiger Zeitraum), `days` (Tageszahlen) oder
  `month-year`; bei einem Monats- oder Jahreswechsel wird stets der
  vollständige Zeitraum gezeigt. Bei einer nicht verfügbaren Veranstaltung
  erscheint kein fest eingetragener Ersatztermin. Über `series_id` lässt sich
  stattdessen die jeweils nächste veröffentlichte Veranstaltung einer Serie
  zeigen — die Formate `weekday-time` und `time` eignen sich für
  wiederkehrende Vereinsabende; angezeigt werden dabei immer echte, bereits
  angelegte Termine, keine aus einem Text angenommene Wiederholung.
- **Vereinslogo im Bild-Widget** (`image` mit `source=club_logo`): bindet das
  aktuelle Vereinslogo ein und hat Vorrang vor einer sonst hinterlegten Datei
  oder Adresse; eine Logo-Änderung wirkt beim nächsten Abruf.
- **Vollbild-Video** (`background_video`): Layout `cover` (Standard) legt das
  Video als Vollbild-Hintergrund hinter den Section-Inhalt, Layout
  `spotlight` zeigt es als gerahmte Highlight-Karte auf einer gebrandeten
  Fläche mit eigenen Logo-, Titel- und Teaser-Feldern (Details in den
  Beispielen). Medien immer über eine Datei-Kennung einbinden — eine direkt
  angegebene Adresse ist nur ein kurzlebiger Ersatz und kann ablaufen.
- **Vollbild-Landingseite**: `custom_template_config.landing` (Standard
  `false`) schaltet eine Section auf einen bare Vollbild-Modus für reine
  Teaser- oder Kampagnenseiten — ohne Kopfzeile, ohne Navigation, ohne
  Standard-Hero. Die Rechtsfußzeile bleibt davon unberührt und immer
  sichtbar. Ohne Navigation sind weitere Tabs für Besucher nicht erreichbar —
  eine bewusste Wahl für reine Teaser-Seiten, kein Fehler.

### Gerüst und benannte Slots

Für freies HTML (`custom_html`) gilt die feste Bauform: Das HTML ist nur
Gerüst, jeder veränderliche Inhalt ist ein benannter Slot. Nur so lässt sich
die Seite als Baum von Überschrift, Text, Bild und Knopf bearbeiten, ohne HTML
zu schreiben.

- Je Tab genau eine volle Section mit genau einem `custom_html`-Widget als
  Gerüst. Es trägt nur Layout — Elemente, Klassen, und je Bereich ein
  beschriftendes Attribut.
- Jeder Inhalt ist ein benannter Slot: `heading` (Text, Zeilenumbruch
  möglich), `text` (einfaches HTML mit Fettung, Kursiv, Links, Absätzen und
  Listen), `link` (Beschriftung, Ziel, neuer Tab); Live-Daten wie Ticker,
  News, Veranstaltungsliste, Termin, Vereinsorgan, Bildergalerie, Downloads,
  Bild, Video und Kontaktformular stehen ebenfalls als Slot ihrer Art.
  Slot-Namen bestehen aus Kleinbuchstaben, Ziffern und Bindestrich, beginnen
  mit Buchstabe oder Ziffer, sind höchstens 63 Zeichen lang und je Reiter
  eindeutig.
- Ein Bild-Slot direkt auf einem Bildelement füllt nur Adresse und
  Alternativtext; Klasse, Größe und Ladeverhalten bleiben im Gerüst. Ein
  Bild-Slot auf einem umschließenden Element ist dagegen das vollständige
  Bild-Widget mit eigener Box. Zulässig sind gesicherte Adressen, hochgeladene
  Dateien und eingebettete Bilddaten; alles andere zeigt kein Bild.
- Ein Slot lässt sich einzeln adressieren und setzen (Details in den
  Beispielen); ein bestehendes Gerüst lässt sich austauschen, ohne die Seite
  neu anzulegen — dabei bleiben die vorhandenen Slot-Inhalte erhalten, und ein
  inzwischen geänderter Slot wird nicht überschrieben, sondern mit Exit-Code
  `4` gemeldet. Die dafür nötige Widget-Kennung liefert `comvenio homepage
  slot get <reiter>/<slot> --json` (Feld `widget_id`) oder `comvenio homepage
  tree --json` (zweites Pfadglied).
- Stile, die im Nachhinein umgeschaltet werden sollen, werden als Katalog
  angemeldet und dann als `style` am Slot statt als feste Klasse im Gerüst
  vergeben. Farben und Spaltenzahlen, die veränderbar sein sollen, werden
  ebenfalls als Token beziehungsweise Attribut angemeldet, nicht als feste
  Werte im CSS.
- Elemente lassen sich als „Reihe" nebeneinanderstellen: ein Container mit
  fester Spaltenzahl und Prozentbreiten wird ab einer mittleren Bildschirmbreite
  nebeneinander, darunter untereinander dargestellt (Beispiel unten). Die
  Breiten sind 2 bis 4 ganze Prozentwerte in 5er-Schritten, jeder mindestens
  20, in Summe 100 und genau so viele wie Spalten — eine ungültige Angabe wird
  verworfen, dann sind die Spalten gleich breit. Eine Reihe in einer Reihe ist
  nicht vorgesehen. Eine Section mit mehrspaltigem Layout und passender
  Breitenangabe wirkt gleichwertig als Reihe.
- Ein bestehendes Gerüst im älteren Format — festem Text und Bildern direkt im
  HTML statt in Slots — bleibt lesbar, lässt sich im Baum aber nur noch an den
  Slot-Inhalten bearbeiten. `comvenio homepage tree` nennt je Reiter das
  erkannte Format in einer Zeile. Es lässt sich mit
  `comvenio homepage convert --tab <slug> --out home.json` in das neue Format
  umstellen; danach offen gebliebene Stellen werden von Hand nachgetragen, in
  der Vorschau geprüft und erst dann angewendet.
- Ein Gerüst mit festem Text oder Bild außerhalb eines Slots, ohne
  eindeutigen Slot-Namen, ohne Bereichsbeschriftung, mit unbekanntem Stil oder
  mit mehr als einer Hauptüberschrift wird beim Schreiben abgelehnt.

### Bekannte Stolpersteine

| Bild | Ursache | Abhilfe |
|---|---|---|
| Live fehlen Kopfzeile und Navigation, die Vorschau zeigte sie noch | ein älterer Landing-Modus ist in der Design-Datei erhalten geblieben | `"landing": false` ausdrücklich in die Design-Datei schreiben und erneut anwenden |
| Dunkler Rahmen oder Schatten um ein freigestelltes Logo | das Bild-Widget zeichnet standardmäßig eine Karte | am Bild-Slot die Kartendarstellung ausdrücklich abschalten (Feld `card_style` auf `none`) |
| Ein hochformatiges Wappen wirkt in der runden Kopfzeile beschnitten | ältere Version der Anzeige | aktuelle Version verwenden; Logo möglichst quadratisch oder transparent hochladen |
| „Kein Bild konfiguriert" nur bei einer Person im Organ | ein alter Stand liegt im Browser-Zwischenspeicher | Seite mit vollständigem Neuladen aktualisieren |
| Eigenes CSS für eine Breite greift nicht | die Regel zielt auf eine Klasse, die der Slot gar nicht trägt | den tatsächlichen Aufbau in der Vorschau ansehen und den richtigen Container ansprechen |
| Die Prüfung meldet einen Befund nur auf einer Veranstaltungsseite | Kontrastproblem in einem eingebetteten externen Inhalt | getrennt vermerken, nicht über das Homepage-Design „reparieren" |
| Ein Vereinsorgan zeigt viele „Nicht besetzt" | Positionen im Verein sind nicht zugeordnet | die Vereinsdaten pflegen, nicht die Anzeige verändern |

### Vorschau und Prüfung

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

Die Vorschau gilt standardmäßig 30 Minuten; mit `--ttl-hours` (1–24) lässt
sich eine längere, serverseitig begrenzte Laufzeit setzen, etwa für eine
ganztägige Abnahme. Die Vorschau verändert die veröffentlichte Seite nicht.

Ohne `--file` prüft die Prüfung die veröffentlichte Adresse des Vereins.
Diese ergibt sich ausschließlich aus der hinterlegten Subdomain des Vereins;
andere technische Kennungen sind keine Homepage-Adresse und werden nicht
ersatzweise verwendet. Fehlt die Subdomain, weist das CLI auf die
Vereinseinstellungen oder auf die Entwurfsprüfung mit `--file` hin.

Geprüft werden jeder öffentliche Tab, die getrennte Impressum-Seite, die
Darstellung auf Mobilgerät, Tablet, Querformat und Desktop — konkret bei
390, 768, 1024 und 1440 Pixel Breite —, horizontales Überlaufen und leere
Hauptbereiche, unsichtbarer Text und Kontrast,
Konsolen- und Netzwerkfehler, der unveränderbare Rechtsfußzeile mit allen
festen Zielen, die Bedienbarkeit aller Pflichtlinks sowie die
Vereinsverantwortlichkeit und mindestens eine öffentliche Kontaktangabe auf
der Impressum-Seite. Text auf Bild-, Video- oder Verlaufsflächen ist dabei
grundsätzlich nicht messbar und wird deshalb nicht als Befund gezählt.

Exit-Codes: `0` vollständig geprüft, keine behebbaren Befunde; `2` Prüfung
unvollständig, etwa wegen eines technischen Fehlers während der Prüfung; `4`
vollständig geprüft, aber mit einem behebbaren Qualitäts- oder
Rechtsseitenfehler. Screenshots und Bericht gehören immer vor die
menschliche Freigabe — ein Exit-Code `0` ersetzt diese Freigabe nicht.

### Veröffentlichen

Erst nach ausdrücklicher Freigabe, und erst nachdem der bisherige Stand
gesichert wurde — `--clear` ersetzt alle bestehenden Tabs, Sections und
Widgets:

```bash
comvenio homepage show --public --json > sicherung-home.json
comvenio club info --json > sicherung-club.json

comvenio club design --file design-settings.json --dry-run --json   # Warnungen lesen
comvenio club design --file design-settings.json --json
comvenio homepage apply --file home.json --clear --json
comvenio homepage show --public --json
comvenio verify homepage --audit --json
```

`club design` führt zusammen, statt zu ersetzen: Ein live gesetzter
Schlüssel, der in der Datei fehlt, bleibt erhalten — auch wenn die Vorschau
ihn nicht zeigt, weil sie nur die Datei rendert. Das CLI weist auf solche
erhaltenen Schlüssel ausdrücklich hin, insbesondere wenn ein alter
Vollbild-Landing-Modus überlebt: Dann fehlen auf der veröffentlichten Seite
Kopfzeile und Navigation, obwohl die Vorschau richtig aussah. Für eine normale
Seite wird deshalb `"landing": false` immer ausdrücklich in die Design-Datei
geschrieben.

Nach dem Anwenden wird die veröffentlichte Seite im Bild geprüft (Kopfzeile,
Navigation, Hero, Mobilansicht). Wer die Seite vorher schon offen hatte, sieht
nach einer Veröffentlichung unter Umständen zunächst noch einen alten Stand —
ein vollständiges Neuladen der Seite behebt das.

### Mobilgeräte

Jede Section bricht auf kleineren Bildschirmen um: Raster werden einspaltig,
Knöpfe brechen um statt zu überlaufen. Grafiken im Hero-Bereich werden auf
dem Handy nicht einfach ausgeblendet, sondern bewusst gestaltet — etwa ein
halbtransparentes Wappen neben der Schlagzeile. Bei 390 Pixeln Breite darf
kein horizontales Überlaufen entstehen.

## Beispiele

Grundstruktur mit einem Tab, einer Section und einem Hero-Widget:

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

Zwei Mannschaften dauerhaft nebeneinander, als zwei ausgerichtete Sections
(die vollständigen Felder des FuPa-Widgets stehen im Schema; `widgetId` ist
dabei Pflicht, `title`, `includeSrc`, `hrefUrl`, `hrefLabel`, `height` und
`show_title` sind optional):

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

Vollständige Design-Datei:

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
  "custom_css": ".vw-page{...}"
}
```

Eigenes CSS wirkt nur innerhalb der Seite selbst; eigene Klassen tragen einen
Vereinspräfix, Farben werden als Variablen am Seitenwurzel-Element gesetzt.

Termin als Inline-Text im Fließtext:

```html
<span data-widget-slot="event_highlight"
      data-widget-config='{"event_id":"<event-id>","layout":"date","date_format":"full","date_timezone":"Europe/Berlin"}'></span>
```

Spotlight-Video-Konfiguration (zusätzlich zu Datei/Adresse, Vorschaubild,
Überlagerung, Endlosschleife und Schlagzeile):

| Feld | Bedeutung |
|---|---|
| `layout` | `cover` oder `spotlight`, Standard `cover` |
| `background` | Hintergrund der gebrandeten Fläche hinter der Video-Karte |
| `accent_color` | Akzentfarbe für hervorgehobene Wörter im Titel |
| `text_color` | Textfarbe auf der Fläche |
| `logo_file_id` | Emblem links |
| `logo_right_file_id` | zweites Emblem oder Sponsor-Logo rechts |
| `eyebrow` | Kicker-Zeile über dem Titel |
| `title` | Überschrift, ein markiertes Wort erscheint in `accent_color` |
| `date_badge` | Pill-Badge, etwa für Datum oder Ort |
| `claim` | Schlusszeile unter der Video-Karte, Zeilenumbruch möglich |

Eine Reihe mit zwei ungleich breiten Spalten im Gerüst:

```html
<div data-reihe data-spalten="2" data-breiten="65 35">
  <div><!-- erster Slot-Inhalt --></div>
  <div><!-- zweiter Slot-Inhalt --></div>
</div>
```

Ein Slot einzeln lesen und setzen:

```bash
comvenio homepage slot get start/hero-titel --json
comvenio homepage slot set start/hero-titel --file entry.json
```

Nur das Gerüst eines bestehenden Widgets austauschen, Slot-Inhalte bleiben
erhalten:

```bash
comvenio homepage geruest set start --widget <widget-id> --file geruest.html --dry-run
comvenio homepage geruest set start --widget <widget-id> --file geruest.html
```

## Befehle und Actions

<!-- gen:docs befehle -->

**homepage** — vollständig

- `comvenio homepage preview`
- `comvenio homepage apply`
- `comvenio homepage show`
- Felder und Werte: `comvenio schema homepage --json`
<!-- /gen:docs -->

## Fehler

- `SCOPE_REQUIRED` — die Anmeldung trägt nicht den nötigen Schreib-Scope für
  Design oder Veröffentlichung. `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — die Anmeldung reicht, aber die Vereinsrolle erlaubt
  Design oder Veröffentlichung nicht. `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — die Struktur- oder Design-Datei passt nicht zum
  Schema, etwa ein fehlendes oder falsch formatiertes Feld.
  `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — ein Gerüst oder Widget wurde zwischen Lesen und Schreiben
  bereits geändert; aktuellen Stand erneut lesen und neu entscheiden.
  `comvenio help fehler CONFLICT`.
