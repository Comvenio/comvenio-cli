---
id: homepage
kategorie: thema
domaenen: [homepage, community]
stichwoerter: [homepage, website, vereinsseite, widgets, design]
---

# Vereins-Homepage gestalten

## Wozu

Mit dem CLI wird die öffentliche Vereins-Homepage aufgebaut und gepflegt:
Struktur, Inhalte und Design werden als deklaratives JSON beschrieben, in
einer Vorschau geprüft und erst nach ausdrücklicher Freigabe veröffentlicht.
Es gibt keinen automatischen Text- oder Design-Generator im Hintergrund — wer
die Seite gestaltet, komponiert sie über die hier beschriebenen Actions
selbst.

## Voraussetzungen und Rechte

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und
welche Scopes sie brauchen, zeigt `comvenio action list --json`.

```bash
comvenio login
comvenio whoami --json
```

Der Verein kommt aus dem angemeldeten Kontext — er wird nicht über die
Eingabe gesetzt, das CLI lehnt eine mitgegebene Vereinskennung ab.

Design- und Veröffentlichungsschritte (`cai.club.05.design`,
`cai.homepage.02.apply`) brauchen das Recht, Vereinseinstellungen zu
verwalten (Scope `club.write`). Fehlt es, meldet Comvenio
`PERMISSION_DENIED` — das Recht vergibt ein Administrator des Vereins. Fehlt
der Anmeldung der nötige Scope, meldet Comvenio `SCOPE_REQUIRED` mit dem
passenden `comvenio login --scopes …`-Befehl.

## Abläufe

### Werkzeugkette

Jede Änderung folgt derselben Reihenfolge: Verträge lesen → Bestand lesen →
Struktur und Design komponieren → Vorschau erzeugen → Prüfung laufen lassen →
Freigabe einholen → anwenden und bestätigen. Kein Schritt wird übersprungen,
und `cai.homepage.02.apply` mit `clear_existing: true` läuft nie ohne
ausdrückliche Freigabe.

### Verträge und Bestand lesen

```bash
comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"homepage"}' --json > homepage-schema.json
comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"design"}' --json > design-schema.json
comvenio action call cai.homepage.03.show --input '{"operation":"public"}' --json
```

Das Homepage-Schema ist maßgeblich für die verfügbaren Widget-Arten und ihre
Config-Felder, für Section-Layouts und Stilvarianten, für die öffentlichen
Detailrouten zu News und Veranstaltungen, für sichere Button-Ziele und für den
nicht konfigurierbaren, immer gleichen Rahmen der Seite. Unbekannte Felder,
Widget-Arten oder Werte werden nicht erfunden, sondern im Schema
nachgeschlagen.

### Unveränderbare Bereiche der Seite

Konfiguriert werden nur die eigentlichen Homepage-Inhalte. Unabhängig vom
`tabs`-Inhalt zeigt jede Vereinsseite immer:

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
aus Widgets. Die vollständige Struktur wird als `tabs`-Array in der Eingabe
von `cai.homepage.01.preview` beziehungsweise `cai.homepage.02.apply`
übergeben (siehe Beispiele). `clear_existing` (ohne Angabe `false`) steuert,
was mit dem Bestand geschieht: `false` legt die übergebenen Tabs nur
**zusätzlich** an (ein schon vorhandener Slug bekommt `-2`), bestehende Tabs,
Sections und Widgets bleiben unverändert. Einen vorhandenen Text ändern —
etwa den Begrüßungstext der Startseite — heißt deshalb: Bestand mit
`cai.homepage.03.show` lesen, die Stelle in der vollständigen Struktur ändern
und alles mit `clear_existing: true` über Vorschau und Bestätigung
veröffentlichen.

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
  der Verein bearbeitet sie im Verein-Bereich der Web-App. In der Vorschau
  versendet das Formular nichts. Ein älteres, rein informatives
  Beitrittsformular bestätigt keinen erfolgreichen Antrag und darf dafür auch
  nicht gehalten werden; für Kontakt und Mitgliedsinteresse ist ausschließlich
  `contact_form` vorgesehen. Ein Formular selbst aus freiem HTML nachzubauen
  ist nicht vorgesehen. Gespeicherte Anfragen werden 30 Tage nach dem Löschen
  endgültig entfernt, spätestens aber 365 Tage nach Eingang.
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
die Seite als Baum von Überschrift, Text, Bild und Knopf komponieren.

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
- Ein `link`-Slot sitzt immer auf einem `<a>`-Element
  (`<a data-slot="mehr"></a>`); auf einem anderen Element lehnt die Prüfung das
  Gerüst ab (Regel R3, `link_slot_not_anchor`). Auch eine Knopfbeschriftung ist
  Inhalt des Slots, nie fester Text im Gerüst.
- Ein Bild-Slot direkt auf einem Bildelement füllt nur Adresse und
  Alternativtext; Klasse, Größe und Ladeverhalten bleiben im Gerüst. Ein
  Bild-Slot auf einem umschließenden Element ist dagegen das vollständige
  Bild-Widget mit eigener Box. Zulässig sind gesicherte Adressen, hochgeladene
  Dateien und eingebettete Bilddaten; alles andere zeigt kein Bild.
- Ein einzelner Slot lässt sich noch nicht gezielt ansprechen und setzen —
  noch nicht als Action verfügbar, in der Web-App erledigen. Über die
  Actions wird stattdessen die vollständige `tabs`-Struktur mit
  `cai.homepage.02.apply` neu gesendet.
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
  HTML statt in Slots — bleibt lesbar. Das erkannte Format je Reiter zeigt
  noch keine Action — in der Web-App erledigen. Die Umstellung ins neue
  Format selbst läuft über `cai.homepage.05.convert`: liest die aktuelle
  Live-Struktur, wandelt jedes Gerüst um und liefert `tabs` direkt für
  `cai.homepage.02.apply` sowie einen Bericht (`umgewandelt`, `offene_stellen`,
  `katalogklassen_verschoben`, `befunde`). Klassen aus dem Stilkatalog des
  Vereins (`design_settings.styles`) werden dabei in Slot-Stile verschoben.
  Nichts wird angewendet — die `tabs` gehen unverändert an
  `cai.homepage.01.preview` und danach an `cai.homepage.02.apply` mit
  `clear_existing: true` (sonst entstehen die Reiter doppelt), nach
  ausdrücklicher Freigabe.
- Ein Gerüst mit festem Text oder Bild außerhalb eines Slots, ohne
  eindeutigen Slot-Namen, ohne Bereichsbeschriftung, mit unbekanntem Stil oder
  mit mehr als einer Hauptüberschrift wird beim Schreiben abgelehnt.

### Bekannte Stolpersteine

| Bild | Ursache | Abhilfe |
|---|---|---|
| Live fehlen Kopfzeile und Navigation, die Vorschau zeigte sie noch | ein älterer Landing-Modus ist in den Design-Einstellungen erhalten geblieben | `"landing": false` ausdrücklich in `design_settings` schreiben und erneut anwenden |
| Dunkler Rahmen oder Schatten um ein freigestelltes Logo | das Bild-Widget zeichnet standardmäßig eine Karte | am Bild-Slot die Kartendarstellung ausdrücklich abschalten (Feld `card_style` auf `none`) |
| Ein hochformatiges Wappen wirkt in der runden Kopfzeile beschnitten | ältere Version der Anzeige | aktuelle Version verwenden; Logo möglichst quadratisch oder transparent hochladen |
| „Kein Bild konfiguriert" nur bei einer Person im Organ | ein alter Stand liegt im Browser-Zwischenspeicher | Seite mit vollständigem Neuladen aktualisieren |
| Eigenes CSS für eine Breite greift nicht | die Regel zielt auf eine Klasse, die der Slot gar nicht trägt | den tatsächlichen Aufbau in der Vorschau ansehen und den richtigen Container ansprechen |
| Die Prüfung meldet einen Befund nur auf einer Veranstaltungsseite | Kontrastproblem in einem eingebetteten externen Inhalt | getrennt vermerken, nicht über das Homepage-Design „reparieren" |
| Ein Vereinsorgan zeigt viele „Nicht besetzt" | Positionen im Verein sind nicht zugeordnet | die Vereinsdaten pflegen, nicht die Anzeige verändern |

### Vorschau und Prüfung

```bash
comvenio action call cai.homepage.01.preview \
  --input '{"tabs":[{"label":"Start","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"clear_existing":false}' \
  --json
# Antwort enthält preview_id

comvenio action call cai.homepage.04.screenshot \
  --input '{"preview_id":"<preview-id>","viewports":["mobile","desktop"]}' \
  --json

comvenio action call cai.verify.04.homepage \
  --input '{"operation":"preview","tabs":[{"label":"Start","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"viewports":["mobile","desktop"],"audit":true,"wait_ms":500}' \
  --json
```

`cai.homepage.01.preview` verändert die veröffentlichte Seite nicht.

Mit `"operation":"live"` statt `"operation":"preview"` prüft
`cai.verify.04.homepage` stattdessen die veröffentlichte Adresse des Vereins
— ohne `tabs`. Diese ergibt sich ausschließlich aus der hinterlegten
Subdomain des Vereins; andere technische Kennungen sind keine
Homepage-Adresse und werden nicht ersatzweise verwendet.

Geprüft werden jeder öffentliche Tab, die getrennte Impressum-Seite und die
angegebenen `viewports` — `mobile` und `desktop`, ohne Angabe beide —, dazu horizontales
Überlaufen und leere Hauptbereiche, unsichtbarer Text und Kontrast,
Konsolen- und Netzwerkfehler, der unveränderbare Rechtsfußzeile mit allen
festen Zielen, die Bedienbarkeit aller Pflichtlinks sowie die
Vereinsverantwortlichkeit und mindestens eine öffentliche Kontaktangabe auf
der Impressum-Seite. Text auf Bild-, Video- oder Verlaufsflächen ist dabei
grundsätzlich nicht messbar und wird deshalb nicht als Befund gezählt.

Die Antwort meldet Befunde statt nur einer bestandenen/nicht bestandenen
Aussage. Screenshots und Bericht gehören immer vor die menschliche Freigabe.

### Veröffentlichen

Erst nach ausdrücklicher Freigabe, und erst nachdem der bisherige Stand
gesichert wurde — `clear_existing: true` ersetzt alle bestehenden Tabs,
Sections und Widgets. `cai.homepage.02.apply` ist eine kritische Änderung:
Der Aufruf liefert zunächst eine Vorschau mit `preview_id` und
`confirmation_token`, erst `action confirm` veröffentlicht die Seite
wirklich.

```bash
comvenio action call cai.homepage.03.show \
  --input '{"operation":"public"}' \
  --json > sicherung-home.json

comvenio action call cai.club.05.design \
  --input '{"design_settings":{"homepage_theme":"modern","homepage_template":"flex","primary_color":"#006846"}}' \
  --json

comvenio action call cai.homepage.02.apply \
  --input '{"tabs":[{"label":"Start","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"clear_existing":true}' \
  --json
# Antwort enthält preview_id und confirmation_token
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <token> \
  --idempotency-key <key>

comvenio action call cai.homepage.03.show --input '{"operation":"public"}' --json
comvenio action call cai.verify.04.homepage \
  --input '{"operation":"live","viewports":["mobile","desktop"],"audit":true,"wait_ms":500}' \
  --json
```

`cai.club.05.design` führt zusammen, statt zu ersetzen: Ein live gesetzter
Schlüssel, der in der Eingabe fehlt, bleibt erhalten — auch wenn die Vorschau
ihn nicht zeigt, weil sie nur die übergebenen `tabs` rendert. Das gilt
insbesondere für einen alten Vollbild-Landing-Modus: Dann fehlen auf der
veröffentlichten Seite Kopfzeile und Navigation, obwohl die Vorschau richtig
aussah. Für eine normale Seite wird deshalb `"landing": false` immer
ausdrücklich in `design_settings` übergeben.

Nach dem Anwenden wird die veröffentlichte Seite im Bild geprüft (Kopfzeile,
Navigation, Hero, Mobilansicht). Wer die Seite vorher schon offen hatte, sieht
nach einer Veröffentlichung unter Umständen zunächst noch einen alten Stand —
ein vollständiges Neuladen der Seite behebt das.

### Community-Seite gestalten

Die Seite einer Community — etwa einer Vereinsmeisterschaft mehrerer Vereine —
entsteht genauso wie die Vereins-Homepage: Gerüst, Slots, Vorschau, Freigabe.
Die Actions `cai.community.*` gehen über den Verein der Anmeldung; er muss
**Mitgliedsverein** der Community sein. Jede Action liest dafür zuerst die
Community und ihre Mitgliedsvereine; ist der Verein keiner davon, endet sie mit
`COMMUNITY_NOT_IN_CLUB`, bevor irgendetwas anderes gelesen oder geschrieben
wird. Ob die Seite geändert werden darf, entscheidet Comvenio selbst — nur
Verantwortliche der Community dürfen schreiben (sonst `PERMISSION_DENIED`).

Werkzeugkette: ansehen → Design ansehen → Vorschau → Bild → Freigabe → Design
setzen → Seite anwenden.

```bash
comvenio action call cai.community.01.show \
  --input '{"operation":"private","community_id":"<community-id>"}' --json > sicherung-community.json
comvenio action call cai.community.05.design \
  --input '{"operation":"show","community_id":"<community-id>"}' --json
# Antwort enthält design_settings und design_version

comvenio action call cai.community.02.preview --input "$(cat community-seite.json)" --json
# Antwort enthält preview_id, preview_url (/community-preview/…) und expected_versions
comvenio action call cai.community.04.screenshot \
  --input '{"community_id":"<community-id>","preview_id":"<preview-id>","viewports":["mobile","desktop"]}' --json
```

`community-seite.json` trägt die Community und die `tabs` — hier ein Gerüst
mit einem Terminslot, der die öffentlichen Termine aller Mitgliedsvereine
zeigt:

```json
{
  "community_id": "<community-id>",
  "clear_existing": true,
  "design_settings": { "custom_css": ".vm-hero { padding: 3rem 1rem; }" },
  "tabs": [{
    "label": "Start", "slug": "start", "position": 0, "visibility_scope": "public",
    "sections": [{ "layout": "full", "widgets": [{
      "kind": "custom_html",
      "config": {
        "html": "<section class=\"vm-hero\" aria-label=\"Start\"><h1 data-slot=\"titel\"></h1><div data-slot=\"termine\"></div></section>",
        "slots": {
          "titel": { "kind": "heading", "config": { "text": "Vereinsmeisterschaft" } },
          "termine": { "kind": "community_calendar", "config": { "community_id": "<community-id>", "view": "list", "range_days": 60 } }
        }
      }
    }]}]
  }]
}
```

Die Community-Widgets `community_calendar`, `community_news` und
`club_directory` brauchen immer die `community_id`; Felder und Werte nennt
`cai.schema.02.show_domain_schema` mit `{"domain":"homepage"}`. Eine
Community-Seite kennt keine Abteilungs-Sichtbarkeit (`visibility_scope`
`department` wird abgelehnt). `design_settings` in der Vorschau zeigen ein
geplantes Design, ohne es zu speichern.

Nach der Freigabe von Bildern und Vorschau, in dieser Reihenfolge:

```bash
comvenio action call cai.community.05.design \
  --input '{"operation":"update","community_id":"<community-id>","design_settings":{…},"expected_design_version":<design_version aus design show>}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> --idempotency-key <key>

comvenio action call cai.community.03.apply --input "$(cat community-seite-apply.json)" --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> --idempotency-key <key>
```

`community-seite-apply.json` enthält dieselben `community_id`, `tabs` und
`clear_existing` wie die freigegebene Vorschau (ohne `design_settings`) und
**genau die `expected_versions` aus deren Antwort** — nie frisch gelesene
Versionen. Ist eine der darin genannten Seiten inzwischen geändert oder
entfernt, antwortet Comvenio mit `TAB_VERSION_CONFLICT` und nennt die Tabs:
dann neu vorschauen, neu freigeben und mit den Versionen dieser neuen
Vorschau anwenden. Ohne `clear_existing` hängt `cai.community.03.apply` die
Tabs an, wie die Vorschau zeigte. Lehnt Comvenio die Seite nach dem Design
ab (etwa `TAB_VERSION_CONFLICT`), sagt die Meldung ausdrücklich, dass von der
Seite nichts geschrieben wurde und das neue Design schon live ist. Nach einer
Zeitüberschreitung oder einem Serverfehler ist offen, ob die Seite
geschrieben wurde: dann erst mit `cai.community.01.show` prüfen, nicht
einfach wiederholen.

`cai.community.05.design update` führt wie `cai.club.05.design` mit dem
gespeicherten Design zusammen. Hat jemand das Design inzwischen geändert,
endet die Bestätigung mit `DESIGN_VERSION_CONFLICT`: Design neu lesen und
mit der neuen `design_version` erneut setzen.

### Vereinsseite in einer Community gestalten

Jeder Mitgliedsverein pflegt in der Community eigene Seiten; sie stehen im
Menü unter seinem Namen. `cai.community.06.club_page` arbeitet immer mit dem
Verein der Anmeldung — wer für mehrere Vereine zuständig ist, meldet sich je
Verein an (`comvenio login`, Verein im Consent wählen). Anlegen und
Veröffentlichen verlangen das Recht, die Vereinseinstellungen zu verwalten.

```bash
# Eigene Seiten des Vereins in der Community, mit version und base je Seite
comvenio action call cai.community.06.club_page \
  --input '{"operation":"show","community_id":"<community-id>"}' --json

# Seite anlegen — mit Vorlage (Kurzprofil, Termine, News des Vereins) oder leer ("template":"none")
comvenio action call cai.community.06.club_page \
  --input '{"operation":"create","community_id":"<community-id>","label":"SV Motzing","visibility_scope":"public"}' --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> --idempotency-key <key>

# Seite als Ganzes veröffentlichen: version und base aus show, sections wie im Homepage-Schema
comvenio action call cai.community.06.club_page --input "$(cat vereinsseite.json)" --json
comvenio action confirm --preview-id <preview-id> --confirmation-token <token> --idempotency-key <key>
```

`vereinsseite.json` enthält `"operation":"publish"`, `community_id`, `tab_id`,
`expected_tab_version` (= `version` aus `show`), `base` (unverändert aus
`show`) und `sections`. Abschnitte und Widgets, die bleiben sollen, tragen
ihre `id`; was fehlt, wird gelöscht (Widgets ohne Abschnitt bleiben stehen); neue kommen ohne `id`. Die Seite wird in
einem Schritt ersetzt. Hat jemand sie inzwischen geändert, endet die
Bestätigung mit `CONFLICT` (`tab_changed` oder `TAB_VERSION_CONFLICT`): neu
`show`, Entwurf auf die neue `base` setzen. Liefert `show` für eine Seite `base: null`, war ihr Inhalt gerade nicht lesbar — später erneut lesen. Bleibt der Konflikt bei unveränderter Seite, trägt der Reiter ein Widget ohne Abschnitt, das `show` nicht sieht: dann in der Web-App bearbeiten. Nach dem Veröffentlichen die neue `version` wieder mit `show` lesen. Ein Reiter, der keine Seite des
angemeldeten Vereins in dieser Community ist, endet vor der Bestätigung mit
`TENANT_MISMATCH`. Eine Vorschau gibt es für Vereinsseiten nicht: erst mit
`"visibility_scope":"member"` anlegen, gestalten, im Hub ansehen und dann in
der Web-App öffentlich stellen. Bei Vereinen ohne öffentliche Vereinsseite
(inaktiv) bleiben die Vorlagen-Bausteine Termine und News leer — der Inhalt
gehört dann ins Gerüst.

### Mobilgeräte

Jede Section bricht auf kleineren Bildschirmen um: Raster werden einspaltig,
Knöpfe brechen um statt zu überlaufen. Grafiken im Hero-Bereich werden auf
dem Handy nicht einfach ausgeblendet, sondern bewusst gestaltet — etwa ein
halbtransparentes Wappen neben der Schlagzeile. Bei 390 Pixeln Breite darf
kein horizontales Überlaufen entstehen.

## Beispiele

Grundstruktur mit einem Tab, einer Section und einem Hero-Widget (als
`tabs`-Wert von `cai.homepage.01.preview` bzw. `cai.homepage.02.apply`):

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

Vollständiges `design_settings`-Objekt (für `cai.club.05.design`):

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

Einen einzelnen Slot lesen und setzen sowie nur das Gerüst eines bestehenden
Widgets austauschen sind noch nicht als Action verfügbar — in der Web-App
erledigen.

## So geht's in der Web-App

<!-- gen:docs web-app -->

### Homepage-Designer

Menüpfad: Web-App → Homepage-Designer (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Wo steht was auf meiner Homepage, und wie ändere ich es, ohne HTML anzufassen und ohne dass Besucher Zwischenstände sehen?

- Klick auf „Rückgängig“ oder Strg+Z → Der letzte Entwurfsschritt wird zurückgenommen
- Klick auf „Wiederholen“ oder Strg+Umschalt+Z → Der zuletzt zurückgenommene Schritt wird wieder angewendet
- Klick auf „1280“, „768“ oder „390“ → Die Leinwand rendert die Seite in dieser Breite und skaliert sie auf die verfügbare Fläche
- Klick auf „Code“ → Öffnet oder schließt die Code-Ansicht unter der Leinwand
- Klick auf „Im Fenster öffnen“ → Öffnet die Entwurfsvorschau in einem eigenen Browserfenster oder holt sie nach vorn (führt zu: „Entwurfsvorschau im zweiten Fenster“ (neues Fenster))
- Klick auf „Verwerfen“ → Der Entwurf aller Reiter wird verworfen; Leinwand zeigt den Live-Stand
- Klick auf „Veröffentlichen“ → Jeder geänderte Reiter wird als Ganzes veröffentlicht; vorher werden nur die geänderten Felder (CSS und/oder Tokens) nach Prüfung gegen ihre Basis in einem Schritt in die Vereinseinstellungen geschrieben (09)
- Klick auf „Einfügen“ → Öffnet den Einfügen-Katalog in der rechten Spalte mit dem gewählten Knoten als Ziel
- Rechtsklick oder Klick auf „…“ am Knoten → Öffnet das Menü mit Duplizieren, Nach oben, Nach unten, Einfügen danach, Löschen
- Klick auf „Duplizieren“ im Menü oder im Formular → Kopie hinter dem Original; Slot-Namen werden eindeutig fortgezählt, Einträge kopiert
- Klick auf „Löschen“ → Entfernt Element und zugehörige Slot-Einträge aus dem Entwurf
- Ziehen eines Knotens im Baum → Verschiebt den Knoten an die Einfügestelle
- Klick auf „Live-Stand laden“ → Verwirft den Entwurf des Reiters und übernimmt den bereits geladenen Live-Stand
- Klick auf „Entwurf behalten“ im Hinweis → Führt den Entwurf mit dem bereits geladenen Live-Stand zusammen (TD-6): nur live Geändertes übernehmen, beidseitig Geändertes behalten, Hinzugefügtes übernehmen, live Entferntes entfernen
- Klick auf „Neu laden“ in der Leinwand → Lädt die Leinwand neu und sendet den Entwurf erneut
- Eingabe in die Felder des Formulars (Text, Beschriftung, Ziel, Widget-Einstellungen) → Ändert den Eintrag im Entwurf; Leinwand zeigt die Änderung sofort
- Klick auf „Kopieren“ → Kopiert die Adresse in die Zwischenablage
- Klick auf „Erneut laden“ → Lädt Reiter, Sektionen, Widgets und Einstellungen neu
- Klick auf „Zur Ansicht“ → Verlässt den Designer (führt zu: zurück (Ansicht der Homepage im ClubHub))
- Klick auf „Zum ersten Reiter“ → Wählt den ersten vorhandenen Reiter
- Klick auf „Live-Stand laden“ in der Meldung → Verwirft den Entwurf des Reiters und lädt Reiter, Sektionen und Widgets neu; ein gelöschter Reiter verschwindet aus dem Baum
- Klick auf „Hier weiterarbeiten“ → Dieser Tab wird der aktive Designer; der andere Tab wird schreibgeschützt
- Tippen auf „Struktur“, „Vorschau“ oder „Code“ → Wechselt zwischen Baum, Leinwand und Code-Ansicht
- Klick auf „Entwurf behalten“ → Führt den Entwurf nach TD-6 mit dem Live-Stand aus der Antwort zusammen; Ausgangsstand = Live-Stand
- Klick auf „Live-Stand laden“ → Verwirft den Entwurf des Reiters und übernimmt den Live-Stand aus der Antwort
- Klick auf „Abbrechen“ oder Escape → Schließt den Dialog ohne Änderung
- Klick auf „Gerüst (HTML)“, „Stile (CSS)“ oder „Befunde“ → Wechselt den Inhalt der Code-Ansicht
- Auswahl eines Gerüsts über dem Editor → Zeigt das HTML des gewählten Gerüsts
- Eingabe im Editor → Ändert Gerüst-HTML bzw. Vereins-CSS im Entwurf; nach 300 ms Ruhe zeigen Leinwand und Fenster die Änderung
- Klick auf „Erneut laden“ in der Code-Ansicht → Lädt den Editor erneut
- Klick auf „Live übernehmen“ im Stile-Reiter → Ersetzt den CSS-Entwurf durch das Live-CSS
- Klick auf „Entwurf behalten“ im Stile-Reiter → Setzt den Ausgangsstand des CSS-Entwurfs auf das Live-CSS; der Entwurf bleibt und überschreibt beim Veröffentlichen
- Klick auf eine Vorlage oder Ziehen in die Leinwand → Fügt den Bereich der Vorlage am Ziel ein; Slot-Namen eindeutig
- Klick auf „Überschrift“, „Text“ oder „Knopf“ oder Ziehen in die Leinwand → Fügt ein neues Element (h2, p, a) mit leerem Eintrag am Ziel ein; ohne Gerüst als eigenständiges Widget der Sektion
- Klick auf einen Inhalt oder Ziehen in die Leinwand → Fügt ein Live-Widget als Slot am Ziel ein; ohne Gerüst als neues Widget der gewählten Sektion
- Klick auf „Schließen“ oder Escape → Schließt den Katalog
- Klick auf „Erneut laden“ im Katalog → Lädt die Einstellungen mit den Vorlagen neu
- Klick auf „Design“ in der Werkzeugleiste → Die rechte Spalte zeigt das Design-Panel statt des Formulars; eine Auswahl in Baum oder Leinwand kehrt zum Formular zurück
- Farbfeld wählen oder Hex-Wert eingeben bei einer Kernfarbe (Hauptfarbe, Akzent, Text auf Akzent, Hintergrund, Text, gedämpfter Text) oder einer weiteren Vereinsfarbe → Setzt die Rolle in tokens.palette des Design-Entwurfs; Leinwand und Fenster zeigen sie sofort; das Panel zählt als eine Änderung „Design“
- Regler Rundung, Abstände, Schriftgröße oder Knopfgruppe Schatten bewegen → Setzt radius.md, spacing_scale, type_scale oder shadow_level im Design-Entwurf; die Seite zeigt es sofort
- Klick auf „Auf Ausgangsstand zurücksetzen“ → Tokens im Entwurf wieder wie beim Öffnen bzw. letzten Laden (Basis); die Design-Änderung fällt aus dem Zähler
- Klick auf „Rückgängig“ in der Umbau-Meldung → Nimmt den ganzen Zug samt Aufräumen in einem Schritt zurück — wie rueckgaengig in der Werkzeugleiste
- Klick auf „Reihe auflösen“ im Formular der Reihe → Stellt die Elemente der Reihe untereinander an ihre Stelle; im Gerüst entfällt die Hülle, eine Sektion wird einspaltig (layout full, spalten_breiten null)

### Entwurfsvorschau im zweiten Fenster

Menüpfad: Web-App → Entwurfsvorschau im zweiten Fenster (offene Stelle — Menüpfad manuell ergänzen)

Zweck: Wie sieht mein Entwurf in voller Größe aus — und ist das, was ich sehe, Entwurf oder Live-Seite?

- Umschalten von „Auswahl im Designer folgen“ → An: Fenster scrollt zur Auswahl des Designers und zeigt den Rahmen, Klicks wählen im Designer; aus: Fenster verhält sich wie die Seite
- Klick auf „Neu verbinden“ → Sendet hallo und lädt ohne Antwort den Live-Stand neu
- Klick auf „Live-Seite öffnen“ → Öffnet die veröffentlichte Homepage in einem neuen Tab (führt zu: wechselnd (öffentliche Homepage des Vereins im neuen Tab))
- Klick auf ein Element im Fenster → Wählt den Knoten im Designer; Links werden nicht ausgelöst
- Klick auf „Ersten Reiter zeigen“ → Zeigt den ersten Reiter der Homepage
- Klick auf „Neu laden“ → Lädt den Live-Stand bzw. die Einstellungen neu
- Ziehen des Bereichs oder Slots unter dem Zeiger im Fenster ohne vorheriges Wählen; am Etikett eines Bereichs der ganze Bereich → Sendet verschieben mit Rolle fenster an den gebundenen Designer; der Designer ändert den Entwurf, Leinwand und Fenster folgen

<!-- /gen:docs web-app -->

## Befehle und Actions

<!-- gen:docs befehle -->

**homepage**

- `cai.homepage.01.preview` — preview (lesen) · Scopes: `club.write`
- `cai.homepage.02.apply` — apply (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.homepage.03.show` — private, public (lesen) · Scopes: `club.read`, `public.read`
- `cai.homepage.04.screenshot` — screenshot (lesen) · Scopes: `club.write`
- `cai.homepage.05.convert` — convert (lesen) · Scopes: `club.write`
- Felder und Werte: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"homepage"}'` (`club_id` setzt die Anmeldung — nie in `--input`)

**community**

- `cai.community.01.show` — private, public (lesen) · Scopes: `club.read`, `public.read`
- `cai.community.02.preview` — preview (lesen) · Scopes: `club.write`
- `cai.community.03.apply` — apply (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.community.04.screenshot` — screenshot (lesen) · Scopes: `club.write`
- `cai.community.05.design` — show, update (lesen, ändern mit Bestätigung) · Scopes: `club.read`, `club.write`
- `cai.community.06.club_page` — show, create, publish (lesen, ändern mit Bestätigung) · Scopes: `club.read`, `club.write`
<!-- /gen:docs -->

## Widgets

Jedes Widget aus dem Homepage-Schema mit Kennung, Zweck, Datenquelle, was es
öffentlich macht und wofür es sich eignet — nach Kategorie gruppiert. Eine
offene Stelle statt einer Erklärung bedeutet: Das Widget ist noch nicht
dokumentiert, keine erfundene Aussage.

<!-- gen:docs widgets -->

**inhalt**

- `hero` — Großflächiger Titelbereich am Seitenanfang mit Überschrift, Hintergrund und Handlungsaufforderung. Datenquelle: Text und Hintergrund aus dem Formular; wenn aktiviert zusätzlich aggregierte Comvenio-Kennzahlen des Vereins (Mitgliederzahl, Anzahl kommender Events, Gründungsjahr aus den Vereinsstammdaten). Macht öffentlich: Die eingegebenen Texte und, wenn zugeschaltet, nur aggregierte Zahlen (Gesamtmitgliederzahl, Anzahl kommender Events) — keine Namen oder Einzeldaten. Passt zu: Startseite
- `description` — Fließtext-, Zitat- oder Hinweisblock für freien Vereinstext. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, Vereinsseite, beliebige Seite
- `custom_html` — Eingebettetes HTML-Fragment für freie Gestaltung, die kein anderes Widget abdeckt. Datenquelle: feste Eingabe im Formular (rohes HTML durch die Vereinsadministration). Macht öffentlich: Genau das eingegebene HTML — kann durch die Administration beliebige Inhalte einbetten; das Widget selbst liest keine Comvenio-Daten. Passt zu: beliebige Seite
- `stats` — Kennzahlen-Kacheln (z. B. Mitgliederzahl, Abteilungen, Events) als Karten oder Raster. Datenquelle: Je Kachel wählbar: feste Eingabe im Formular oder automatisch aus Comvenio-Daten (Gesamtmitgliederzahl, Anzahl Abteilungen, Events dieses Jahres) über die öffentlichen Zähl-Endpunkte. Macht öffentlich: Nur aggregierte Zahlen (z. B. Gesamtmitgliederzahl) — keine Namen oder Einzeldaten. Passt zu: Startseite, Vereinsseite
- `cta` — Auffälliger Aufruf-zum-Handeln-Block mit ein oder zwei Buttons. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite
- `contact` — Kontaktkarte mit Adresse, Telefon, E-Mail, Öffnungszeiten und Social-Links. Datenquelle: feste Eingabe im Formular Macht öffentlich: Die im Formular eingetragenen Kontaktdaten des Vereins; personenbezogene Angaben nur, wenn die Administration selbst welche einträgt (z. B. eine private Telefonnummer statt einer Vereinsnummer). Passt zu: Startseite, Vereinsseite, Kontaktseite
- `legal_notice` — Impressum und rechtliche Angaben des Vereins. Datenquelle: feste Eingabe im Formular Macht öffentlich: Die eingetragenen rechtlichen Vereinsangaben (Name, Anschrift, vertretungsberechtigte Person, Registereintrag) — vom Verein bewusst zur Veröffentlichung bestimmt (Impressumspflicht). Passt zu: Impressumsseite, beliebige Seite
- `faq` — Häufig gestellte Fragen als Akkordeon, Raster, Zweispalter oder Suchliste. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, Vereinsseite
- `sponsors` — Sponsoren- und Partnerlogos als Raster, Laufband oder Karussell. Datenquelle: feste Eingabe im Formular (Name/Logo/Website je Sponsor); wird stattdessen im Formular auf hinterlegte Werbepartner verwiesen, holt das Widget deren öffentliche Sponsorendaten (Firmenname, Logo, Website, Verifiziert-Kennzeichen) automatisch. Macht öffentlich: Firmendaten der Sponsoren (Name, Logo, Website) — keine Personendaten. Passt zu: Startseite, Vereinsseite
- `countdown` — Countdown bis zu einem festen Zieldatum. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, Veranstaltungsseite
- `club_history` — Vereinschronik als Zeitstrahl mit Jahreseinträgen. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Vereinsseite, Über-uns-Seite
- `contact_form` — Kontaktformular für Anfragen von Besucherinnen und Besuchern. Datenquelle: Eingabe der anfragenden Person im Formular (Name, E-Mail, Nachricht, Einwilligung). Macht öffentlich: Sendet Name, E-Mail-Adresse, Nachricht und den Zeitpunkt der erteilten Einwilligung der ausfüllenden Person an den Verein; die Anfrage wird dort von der Vereinsverwaltung bearbeitet. Passt zu: Kontaktseite, Startseite

**news**

- `news` — Liste der neuesten Vereinsnachrichten. Datenquelle: Comvenio-News-Daten des Vereins (öffentlich freigegebene Beiträge), optional gefiltert nach Abteilung. Macht öffentlich: Titel, Anrisstext/Bild und, wenn aktiviert, Autor der veröffentlichten News-Beiträge — nur was die Redaktion bereits als News veröffentlicht hat. Passt zu: Startseite, Newsseite
- `news_highlight` — Ein einzelner hervorgehobener News-Beitrag in großer Darstellung. Datenquelle: Comvenio-News-Daten (der im Formular gewählte News-Beitrag, optional gefiltert nach Abteilung). Macht öffentlich: Titel, Text/Bild und Autor des gewählten News-Beitrags — wie beim Widget news. Passt zu: Startseite, Newsseite
- `ticker` — Laufband mit wechselnden Kurzmeldungen aus Events, News und Geburtstagen. Datenquelle: Öffentliche Comvenio-Daten: kommende Events, News und Geburtstage — jede Quelle einzeln zuschaltbar. Macht öffentlich: Wie bei den Einzel-Widgets: Events und News wie dort; Geburtstage nur für Mitglieder mit erteilter Freigabe, dann nur Vorname und Tag/Monat ohne Geburtsjahr. Passt zu: Startseite, beliebige Seite
- `community_news` — Veröffentlichte öffentliche Nachrichten aller Vereine einer Community als Karten mit Titelbild, Teaser und Herkunft. Datenquelle: Comvenio-Content-Daten über die öffentliche Sammelroute der Community. Macht öffentlich: Titel, Teaser, Titelbild, Datum und Verein öffentlicher Nachrichten. Passt zu: Gemeinde-Startseite, Ortsseite, Vereinsseite in einer Community

**veranstaltungen**

- `events_list` — Liste kommender oder vergangener Vereinstermine. Datenquelle: Comvenio-Event-Daten (öffentliche Terminreihe des Vereins), optional gefiltert nach Abteilung. Macht öffentlich: Titel, Datum und Ort der öffentlichen Termine — keine Teilnehmerlisten. Passt zu: Startseite, Veranstaltungsseite, Abteilungsseite
- `event_highlight` — Ein einzelner hervorgehobener Termin mit optionalem Live-Countdown. Datenquelle: Comvenio-Event-Daten: das im Formular gewählte Event, oder eine gewählte Terminserie, bei der automatisch der nächste zukünftige öffentliche Termin angezeigt wird. Macht öffentlich: Titel, Datum/Zeit und Ort des gewählten Termins. Passt zu: Startseite, Veranstaltungsseite
- `event_hub_embed` — Bettet die vollständige öffentliche Event-Detailseite (Event-Hub) eines Termins ein — Programm, Bilder und Anmeldung inklusive. Datenquelle: Comvenio-Event-Daten über den öffentlichen Event-Hub (intern baut dieses Widget auf demselben Baustein wie die Vorlage "Event mit Programm" auf und liest das im Formular gewählte Event aus derselben Konfiguration). Macht öffentlich: Alles, was der eingebettete Event-Hub öffentlich zeigt: Titel, Zeitraum, Ort, Programm, öffentliche Bilder und der Anmeldestatus der eingeloggten Person — keine Daten anderer Teilnehmender. Passt zu: Veranstaltungsseite
- `event_calendar` — Monatskalender mit den Vereinsterminen. Datenquelle: Comvenio-Event-Daten (öffentliche Termine), optional gefiltert nach Abteilung. Macht öffentlich: Titel, Datum und Ort der öffentlichen Termine — keine Teilnehmerlisten. Passt zu: Veranstaltungsseite, Abteilungsseite
- `event_program` — Ablaufplan eines einzelnen Events als Zeitstrahl oder Karten. Datenquelle: Im Vereinsbereich (angemeldet): die Ablaufplan-Einträge des im Formular gewählten Events. Auf der öffentlichen Website lädt der Baustein derzeit keine Daten. Macht öffentlich: Derzeit nichts: Öffentlich erscheint nur die Überschrift mit „Noch kein Ablaufplan vorhanden.“ Für eine öffentliche Seite den Ablauf besser als Text oder im Gerüst pflegen. Passt zu: Veranstaltungsseite
- `event_rsvp` — Zu-/Absage-Baustein für ein Event; angemeldete Mitglieder sehen und ändern ihren eigenen Anmeldestatus. Datenquelle: Comvenio-Event-Daten: Titel und Datum des im Formular gewählten Events; im Vereinsbereich zusätzlich die Einladung der angemeldeten Person. Macht öffentlich: Überschrift, Untertitel und Datum des Events sowie den Hinweis, sich zur Rückmeldung anzumelden. Der eigene Status erscheint nur im Vereinsbereich, nie Angaben zu anderen Mitgliedern. Passt zu: Veranstaltungsseite
- `training_schedule` — Trainings-/Übungsplan als Tabelle oder Zeitstrahl. Datenquelle: Vorrangig feste Eingabe im Formular (entries je Trainingstermin); ist auf der öffentlichen Seite kein Eintrag gepflegt, zeigt es ersatzweise die öffentlichen, wiederkehrenden Comvenio-Trainingstermine des Vereins. Macht öffentlich: Die eingetragenen bzw. öffentlichen Trainingszeiten und -orte — keine Teilnehmerlisten. Passt zu: Abteilungsseite, Veranstaltungsseite
- `special_event_promo` — Bettet die vollständige öffentliche Event-Detailseite (Event-Hub) eines Termins ein — Programm, Bilder, News und Anmeldung. Datenquelle: Comvenio-Event-Daten über den öffentlichen Event-Hub zum im Formular gewählten Event; der Hub holt seine Daten selbst über die öffentlichen Comvenio-Endpunkte. Macht öffentlich: Alles, was der Event-Hub öffentlich zeigt: Titel, Zeitraum, Ort, Programm, öffentliche Bilder und der Anmeldestatus der eingeloggten Person — keine Daten anderer Teilnehmender. Passt zu: Veranstaltungsseite
- `feature_grid` — Kachelraster mit Symbol, Beschriftung und Erläuterung je Kachel (z. B. Programmpunkte oder Leistungsmerkmale). Datenquelle: feste Eingabe im Formular; ohne eigene Einträge zeigt das Widget eine feste Demo-Belegung. Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, Veranstaltungsseite
- `department_calendar` — Kalender einer Abteilung mit Terminen, Training, Buchungen und Sitzungen. Datenquelle: feste Eingabe im Formular (Termine je Eintrag mit Titel, Datum, Art); ein Feld zum Filtern nach Abteilung ist im Formular vorhanden, wird vom Widget aber derzeit nicht ausgewertet. Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Abteilungsseite
- `community_calendar` — Kommende öffentliche Termine aller Vereine einer Community, je mit dem Verein, der einlädt — als Liste oder Monatsansicht. Datenquelle: Comvenio-Event-Daten über die öffentliche Sammelroute der Community (öffentliche Termine aller Mitgliedsvereine). Macht öffentlich: Titel, Datum, Ort und einladender Verein der öffentlichen Termine — keine Teilnehmerlisten. Passt zu: Gemeinde-Startseite, Ortsseite, Vereinsseite in einer Community

**mitglieder**

- `team` — Vorstand/Team einer Gruppe mit Foto, Name und Funktion. Datenquelle: Comvenio-Mitgliederdaten: öffentliche Vorstands-/Funktionsdaten der im Formular gewählten Gruppe, optional gefiltert nach Abteilung. Macht öffentlich: Vor- und Nachname sowie Funktion(en) der Vorstands-/Funktionsträger:innen dieser Gruppe, wenn aktiviert auch Profilbild — keine Kontaktdaten wie E-Mail oder Telefon, sofern nicht separat freigegeben. Passt zu: Vereinsseite, Abteilungsseite, Über-uns-Seite
- `org_chart` — Organigramm des Vereins mit Abteilungen und Funktionsträger:innen. Datenquelle: Comvenio-Mitgliederdaten: öffentlicher Organisationsbaum, Positionen und Abteilungen des Vereins, optional ab einer im Formular gewählten Wurzel-Abteilung. Macht öffentlich: Vor- und Nachname sowie Funktion der Personen in Vorstands-/Leitungspositionen und die Abteilungsstruktur — keine Kontaktdaten. Passt zu: Vereinsseite, Über-uns-Seite
- `birthdays` — Liste anstehender Mitglieder-Geburtstage. Datenquelle: Comvenio-Mitgliederdaten: öffentliche Geburtstage — nur Mitglieder, die die Veröffentlichung ihres Geburtstags ausdrücklich erlaubt haben. Macht öffentlich: Nur Vorname sowie Tag und Monat (kein Geburtsjahr, kein Nachname) der Mitglieder mit erteilter Freigabe. Passt zu: Startseite, Vereinsseite
- `birthday_highlight` — Feierlich gestaltete Hervorhebung des nächsten Geburtstags. Datenquelle: Comvenio-Mitgliederdaten: öffentliche Geburtstage — nur Mitglieder mit erteilter Freigabe. Macht öffentlich: Nur Vorname sowie Tag und Monat (kein Geburtsjahr, kein Nachname); wenn aktiviert zusätzlich das erreichte Alter als "Meilenstein"-Abzeichen, ebenfalls nur für Mitglieder mit erteilter Freigabe. Passt zu: Startseite
- `honors_showcase` — Ehrungen und Auszeichnungen von Mitgliedern als Zeitstrahl, Raster oder Vitrine. Datenquelle: Im Vereinsbereich (angemeldet): bestätigte Ehrungen aus den Comvenio-Mitgliederdaten. Auf der öffentlichen Website: nur die Ehrungen, die im Formular von Hand eingetragen sind — die öffentlichen Ehrungsdaten werden dort derzeit nicht angezeigt. Macht öffentlich: Öffentlich die im Formular eingetragenen Ehrungen: Name der geehrten Person, Titel, Art, Datum und Beschreibung; fehlende Angaben ergänzt der Baustein mit Standardwerten („Ehrung“, „Mitglied“). Das sind personenbezogene Daten — nur eintragen, was der Verein bewusst als Ehrung veröffentlicht. Ohne Einträge zeigt der Baustein öffentlich einen Leerzustand. Passt zu: Vereinsseite, Startseite
- `membership_form` — Formular für einen digitalen Mitgliedsantrag. Datenquelle: Eingabe der interessierten Person im Formular (Name, Kontaktdaten, gewählte Abteilung, Nachricht). Macht öffentlich: Derzeit nichts: Das Widget zeigt beim Absenden ausdrücklich eine Fehlermeldung, dass noch kein digitaler Antragsweg eingerichtet ist, und übermittelt oder speichert die eingegebenen Daten nicht. Passt zu: Startseite, Vereinsseite
- `honor_wall` — Ehrentafel mit Mitgliederehrungen, alternative Darstellung zu honors_showcase. Datenquelle: Im Vereinsbereich (angemeldet): bestätigte Ehrungen aus den Comvenio-Mitgliederdaten. Auf der öffentlichen Website: nur die Ehrungen, die im Formular von Hand eingetragen sind — die öffentlichen Ehrungsdaten werden dort derzeit nicht angezeigt. Macht öffentlich: Öffentlich die im Formular eingetragenen Ehrungen: Name der geehrten Person, Titel, Art, Datum und Beschreibung; fehlende Angaben ergänzt der Baustein mit Standardwerten („Ehrung“, „Mitglied“). Das sind personenbezogene Daten — nur eintragen, was der Verein bewusst als Ehrung veröffentlicht. Ohne Einträge zeigt der Baustein öffentlich einen Leerzustand. Passt zu: Vereinsseite, Startseite

**medien**

- `image` — Einzelnes Bild oder eine einzelne Datei mit Bildunterschrift. Datenquelle: Eine im Formular ausgewählte Datei aus dem öffentlichen Dateibereich des Vereins oder eine externe Bild-URL, wahlweise das aktuelle Vereinslogo. Macht öffentlich: Nur bereits als öffentlich markierte, fertige Dateien bzw. das eingetragene Bild — keine internen/privaten Dateien. Passt zu: beliebige Seite
- `image_gallery` — Bildergalerie als Raster, Mauerwerk, Karussell oder Filmstreifen. Datenquelle: Je nach im Formular gewählter Quelle: ausgewählte Dateien aus dem Dateibereich, Bilder eines gewählten Events, Bilder der letzten drei öffentlichen Events, ein Ordner aus dem Dateibereich, externe Bild-URLs oder öffentliche Vereinsbilder. Macht öffentlich: Nur bereits als öffentlich markierte Bilder der gewählten Quelle. Passt zu: Medienseite, Startseite, Veranstaltungsseite
- `video` — Eingebettetes Video mit Vorschaubild. Datenquelle: feste Eingabe im Formular (Video-URL, z. B. YouTube/Vimeo/MP4, und Vorschaubild-URL). Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Medienseite, beliebige Seite
- `background_video` — Video oder Bild als Vollbild-Hintergrundsektion mit Text darüber. Datenquelle: feste Eingabe im Formular (Video-/Bild-URL oder hochgeladene Datei-ID, Texte). Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite
- `files` — Liste von Dateien zum Download (z. B. Satzung, Formulare). Datenquelle: Im Formular ausgewählte Dateien aus dem öffentlichen Dateibereich des Vereins. Macht öffentlich: Dateiname, Typ, Größe und ggf. Beschreibung der ausgewählten, bereits öffentlich markierten Dateien — deren Inhalt liegt in der Verantwortung der Vereinsadministration. Passt zu: Vereinsseite, beliebige Seite
- `gallery_slideshow` — Automatisch wechselnde Bilderschau (Diashow) mit Übergangseffekt. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Medienseite, Startseite

**buchung**

- `booking_highlight` — Hervorgehobene buchbare Objekte (z. B. Plätze, Räume) mit Kurzinfo. Datenquelle: Im Vereinsbereich (angemeldet): die Objekte des Vereins, eingeschränkt auf die im Formular gewählten Objekte und die Anzahl. Auf der öffentlichen Website: alle öffentlichen Objekt-Highlights des Vereins — Auswahl und Anzahl aus dem Formular wirken dort derzeit nicht. Macht öffentlich: Name und Beschreibung jedes öffentlichen Objekt-Highlights, bei gesponserten Objekten das Sponsoren-Label — keine Namen der Buchenden. Passt zu: Startseite, Buchungsseite
- `menu_display` — Speisekarte/Angebot zu einem Event oder Anlass. Datenquelle: Comvenio-Verpflegungsdaten: das öffentliche Vereinsmenü. Macht öffentlich: Gerichte/Getränke mit Beschreibung und, wenn aktiviert, Preis — keine Personendaten. Passt zu: Veranstaltungsseite, Startseite

**extern**

- `instagram` — Eingebetteter Instagram-Feed oder -Link. Datenquelle: Externe Einbettung des angegebenen Instagram-Konto/Links — keine Comvenio-Daten; die Inhalte lädt und zeigt Instagram direkt im Browser der Besucherin oder des Besuchers. Macht öffentlich: Nichts von Comvenio; Instagram selbst erhält beim Laden des Embeds technische Angaben des Browsers (z. B. IP-Adresse) gemäß den Datenschutzbestimmungen von Instagram/Meta. Passt zu: Startseite, Social-Media-Seite
- `facebook` — Eingebettete Facebook-Seite oder Facebook-Link. Datenquelle: Externe Einbettung der angegebenen Facebook-Seite/Links — keine Comvenio-Daten. Macht öffentlich: Nichts von Comvenio; Facebook/Meta selbst erhält beim Laden des Embeds technische Angaben des Browsers gemäß den Datenschutzbestimmungen von Meta. Passt zu: Startseite, Social-Media-Seite
- `fupa_widget` — Eingebettetes FuPa-Sport-Widget (Ergebnisse/Tabelle). Datenquelle: Externe Einbettung des von FuPa bereitgestellten Widget-Skripts über die angegebene widgetId — keine Comvenio-Daten. Macht öffentlich: Nichts von Comvenio; FuPa selbst erhält beim Laden des Embeds technische Angaben des Browsers gemäß den Datenschutzbestimmungen von FuPa. Passt zu: Sportseite, Abteilungsseite
- `bfv_widget` — Eingebettetes BFV-Sport-Widget (Ergebnisse/Tabelle des Bayerischen Fußball-Verbands). Datenquelle: Externe Einbettung des vom BFV bereitgestellten Widget-Skripts über die im Formular angegebene Adresse — keine Comvenio-Daten. Macht öffentlich: Nichts von Comvenio; der BFV selbst erhält beim Laden des Embeds technische Angaben des Browsers gemäß den Datenschutzbestimmungen des BFV. Passt zu: Sportseite, Abteilungsseite

**layout**

- `divider` — Grafischer Trenner zwischen zwei Abschnitten (Welle, Berg, Zickzack u. a.). Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite
- `spacer` — Leerraum bzw. dekorativer Zwischenraum zwischen Abschnitten. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite
- `parallax_section` — Bildsektion mit Parallax-/Zoom-/Fixiert-Effekt und optionalem Text/CTA. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, beliebige Seite
- `gradient_section` — Farbverlauf-/Mesh-Sektion mit optionalem Text. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite
- `decorative_element` — Rein dekoratives Element (Formen, Konfetti, Abzeichen, Zitat) ohne eigene Inhalte. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite
- `heading` — Grundbaustein: einzelne Überschrift als benannter Slot. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite
- `text` — Grundbaustein: einzelner Textabschnitt als benannter Slot. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite
- `link` — Grundbaustein: einzelner Link/Button als benannter Slot. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite

**community**

- `testimonials` — Stimmen/Zitate von Mitgliedern, Eltern oder Partnern als Karussell, Raster oder Stapel. Datenquelle: feste Eingabe im Formular (Zitat, Verfasserin/Verfasser, Rolle, Bild, Bewertung je Eintrag). Macht öffentlich: Nur was die Vereinsadministration hier manuell einträgt — nennt sie dort einen Namen, macht sie ihn damit bewusst öffentlich; das Widget liest keine Comvenio-Mitgliederdaten automatisch. Passt zu: Startseite, Vereinsseite
- `logo_marquee` — Laufband mit Partner-/Kooperationslogos. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, Vereinsseite
- `image_text_split` — Bild neben Text mit Überschrift und optionalem Button. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, beliebige Seite
- `forum_highlight` — Vorschau der neuesten öffentlichen Forenbeiträge. Datenquelle: Comvenio-Forendaten: öffentliche Themen und Themenbereiche des Vereinsforums — ein bewusst öffentlich zugänglicher Bereich. Macht öffentlich: Titel, Textanriss und Statistik (Antworten, Aufrufe) der öffentlichen Beiträge; als Autorenangabe zeigt das Widget nur die ersten acht Zeichen der internen Nutzer-Kennung, keinen Klarnamen. Passt zu: Startseite, Vereinsseite
- `chat_preview` — Vorschau einiger Chat-/Forennachrichten mit Link zum vollständigen Chat. Datenquelle: feste Eingabe im Formular (Nachrichten je Eintrag: Text, Absender, Zeit); ein im Formular gewählter Themenbereich steuert nur, wohin der Link "Zum Chat" für eingeloggte Mitglieder führt, liefert aber selbst keine Live-Nachrichten. Macht öffentlich: Nur was die Vereinsadministration hier manuell einträgt — keine echten, aktuellen Chatnachrichten. Passt zu: Startseite, Vereinsseite
- `club_directory` — Verzeichnis aller Mitgliedsvereine einer Community mit Logo und Sparten, mit Absprung auf die eigene öffentliche Seite des Vereins. Datenquelle: Öffentliche Vereinsliste der Community (Name, Logo, Sparten, öffentliche Adresse). Macht öffentlich: Name, Logo, Sparten und öffentliche Adresse der Mitgliedsvereine — keine Mitglieder, keine Kontakte. Passt zu: Gemeinde-Startseite, Ortsseite, Vereinsseite in einer Community

**sport**

- `tournament_highlight` — Turnier-Spielstand, Spielplan oder Tabelle. Datenquelle: feste Eingabe im Formular (Spiele/Tabelle je Eintrag); optional Bezug auf ein im Formular gewähltes Comvenio-Turnier. Macht öffentlich: Nur die eingetragenen Spiel-/Tabellendaten (Mannschaftsnamen, Ergebnisse) — keine Personendaten einzelner Spieler:innen. Passt zu: Sportseite, Abteilungsseite
- `sport_api` — Sportdaten eines externen Anbieters (Tabelle, Ergebnisse, nächstes Spiel) oder ein eingebettetes Anbieter-Widget. Datenquelle: Je nach im Formular gewähltem Anbieter: entweder feste Eingabe im Formular (Tabelle/Ergebnisse) oder eine externe Einbettung von FuPa/BFV/nuLiga über die jeweils angegebene Adresse — keine Comvenio-Daten. Macht öffentlich: Bei fester Eingabe nur die eingetragenen Daten; bei externer Einbettung erhält der jeweilige Anbieter beim Laden technische Angaben des Browsers gemäß dessen eigenen Datenschutzbestimmungen. Passt zu: Sportseite, Abteilungsseite
- `live_match_ticker` — Live-Spielstand-Ticker für ein laufendes Turnier. Datenquelle: feste Eingabe im Formular (Spiele je Eintrag) oder, bei einem im Formular gewählten Comvenio-Turnier, dessen Live-Turnierdaten mit optionaler Hervorhebung des eigenen Teams. Macht öffentlich: Mannschaftsnamen und Spielstände — keine Personendaten einzelner Spieler:innen. Passt zu: Sportseite, Abteilungsseite

**live-daten**

- `member_counter` — Zähler für Mitgliederzahl und Abteilungen. Datenquelle: Comvenio-Mitgliederdaten — auf der öffentlichen Seite zeigt das Widget jedoch bewusst keine Daten: es blendet nur den Hinweis "Nur für eingeloggte Mitglieder sichtbar." ein, die Abfrage ist dort deaktiviert. Macht öffentlich: Nichts — auf der öffentlichen Seite erscheint nur der Hinweistext, keine Zahl. Passt zu: nur intern (Admin-Vorschau)
- `department_showcase` — Übersicht der Vereinsabteilungen. Datenquelle: Comvenio-Abteilungsdaten — die Abfrage ist auf der öffentlichen Seite jedoch deaktiviert (enabled: !isPublic); dort zeigt das Widget immer den Leerzustand "Keine Abteilungen". Macht öffentlich: Nichts — auf der öffentlichen Seite lädt das Widget derzeit keine Abteilungsdaten und zeigt nur den Leerzustand. Passt zu: nur intern (Admin-Vorschau)
- `next_training` — Nächster anstehender Trainingstermin. Datenquelle: Comvenio-Event-Daten: der öffentliche nächste Trainingstermin, optional gefiltert nach Abteilung. Macht öffentlich: Titel, Ort und Zeit des nächsten öffentlichen Trainings — keine Teilnehmerlisten. Passt zu: Startseite, Abteilungsseite
- `booking_calendar` — Belegungskalender eines buchbaren Objekts. Datenquelle: Im Vereinsbereich (angemeldet): die aktiven Objekte des Vereins, vorgewählt das Objekt aus dem Formular. Auf der öffentlichen Website zeigt der Baustein derzeit keine Objekte. Macht öffentlich: Derzeit nichts: Öffentlich erscheint „Keine buchbaren Objekte“. Für Besucher ohne Anmeldung eignet sich booking_highlight. Passt zu: Buchungsseite
- `meeting_decisions` — Liste von Sitzungsbeschlüssen mit Abstimmungsergebnis. Datenquelle: feste Eingabe im Formular Macht öffentlich: Nur was die Vereinsadministration hier manuell einträgt (Titel, Sitzung, Datum, Status, ggf. Stimmenzahlen) — keine automatische Comvenio-Anbindung an echte Sitzungen. Passt zu: Vereinsseite
- `quick_links` — Liste schneller Links/Kacheln zu wichtigen Zielen. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, beliebige Seite
- `poll` — Einfache Umfrage mit Antwortoptionen. Datenquelle: feste Eingabe im Formular (Frage, Antwortoptionen, ggf. feste Startstimmenzahl je Option). Macht öffentlich: Nichts Personenbezogenes: Eine abgegebene Stimme wird nur lokal im Browser der abstimmenden Person gehalten (kein Comvenio-Backend, keine Speicherung, kein Bezug zur Person) und geht beim Neuladen der Seite wieder verloren. Passt zu: Startseite, Vereinsseite

**interaktion**

- `recipe_highlight` — Hervorgehobenes Rezept (z. B. Vereinsheim-Küche). Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, Vereinsseite
- `task_overview` — Aufgabenliste mit Erledigt-Status. Datenquelle: feste Eingabe im Formular Macht öffentlich: Nur was die Vereinsadministration hier manuell einträgt — keine automatische Comvenio-Anbindung an das echte Aufgaben-System. Passt zu: Vereinsseite, Abteilungsseite
- `activity_feed` — Chronologischer Feed jüngster Vereinsaktivitäten (Events, Turniere, News). Datenquelle: Comvenio-Daten: der öffentliche, aggregierte Vereins-Feed aus Events, Turnieren und News. Macht öffentlich: Titel, Zeitpunkt und ggf. Bild der jeweiligen Events/Turniere/News — trotz des Namens keine Aktivitäten einzelner Mitglieder (kein Beitritt, kein Login o. Ä.). Passt zu: Startseite, Vereinsseite
- `member_spotlight` — Vorgestelltes Mitglied mit Foto, Rolle und Zitat. Datenquelle: feste Eingabe im Formular (Name, Bild, Abteilung, Mitglied-seit, Zitat). Macht öffentlich: Nur was die Vereinsadministration hier manuell einträgt — mit dem Einverständnis des vorgestellten Mitglieds, keine automatische Comvenio-Mitgliederdatenanbindung. Passt zu: Startseite, Vereinsseite
- `newsletter_signup` — Anmeldeformular für einen Newsletter. Datenquelle: Eingabe der besuchenden Person (Name/E-Mail) im Formular. Macht öffentlich: Derzeit nichts: Das Formular zeigt nach dem Absenden nur eine Erfolgsmeldung, ohne die eingegebenen Daten irgendwohin zu senden oder zu speichern — es ist noch kein Versand-/Speicher-Endpunkt angebunden. Passt zu: Startseite, Vereinsseite
- `social_feed` — Kachelraster mit Social-Media-Beiträgen. Datenquelle: feste Eingabe im Formular Macht öffentlich: Nur was die Vereinsadministration hier manuell einträgt — keine echte Anbindung an Instagram/Facebook/X, anders als die Widgets instagram/facebook. Passt zu: Startseite, Social-Media-Seite
- `weather` — Wetteranzeige (z. B. für Außenanlagen/Sportplatz). Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: Startseite, Abteilungsseite

**werbung**

- `ad_banner` — Werbebanner-Platzhalter an einer definierten Position. Datenquelle: feste Eingabe im Formular Macht öffentlich: nichts über die Eingabe hinaus Passt zu: beliebige Seite
<!-- /gen:docs widgets -->

## Vorlagen

Alle acht Design-Vorlagen (`cai.club.05.design`, Feld `homepage_template`) mit
Kurzbeschreibung.

<!-- gen:docs vorlagen -->

- `elegance` — Editoriale, raffinierte Vorlage — schlicht, modern, elegant.
- `sport` — Kraftvolle, dunkle, athletische Vorlage — bold und energetisch.
- `community` — Warme, einladende, menschliche Vorlage.
- `minimal` — Puristische, textfokussierte Vorlage — weniger ist mehr.
- `festlich` — Traditionsbewusste, prestigeträchtige Vorlage für Events und Jubiläen.
- `modern` — Zeitgemäße Vorlage mit Gradient-Akzenten und Wow-Faktor.
- `classic` — Bewährte, verlässliche, traditionell-strukturierte Vorlage — die sichere Wahl.
- `flex` — Generische, vollständig konfigurationsgesteuerte Vorlage ohne fest einprogrammiertes Design — jedes Aussehen entsteht aus der Konfiguration, nicht aus neuem Code (Verallgemeinerung der vereinsspezifischen Motzing-Vorlage).
<!-- /gen:docs vorlagen -->

## Fehler

- `SCOPE_REQUIRED` — die Anmeldung trägt nicht den nötigen Schreib-Scope für
  Design oder Veröffentlichung. `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — die Anmeldung reicht, aber die Vereinsrolle erlaubt
  Design oder Veröffentlichung nicht. `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — die `tabs`- oder `design_settings`-Eingabe passt
  nicht zum Schema, etwa ein fehlendes oder falsch formatiertes Feld.
  `comvenio help fehler VALIDATION_FAILED`.
- `OUTCOME_UNKNOWN` — `action confirm` nach `cai.homepage.02.apply` endete
  mit Zeitüberschreitung oder Serverfehler; nicht wiederholen, erst den
  veröffentlichten Stand mit `cai.homepage.03.show` prüfen.
  `comvenio help fehler OUTCOME_UNKNOWN`.
- `CONFLICT` — die Seite wurde zwischen Lesen und Schreiben bereits
  geändert; aktuellen Stand erneut lesen und neu entscheiden.
  `comvenio help fehler CONFLICT`.
- `COMMUNITY_NOT_IN_CLUB` — der Verein der Anmeldung ist kein Mitgliedsverein
  der Community; nichts weiter wurde gelesen.
  `comvenio help fehler COMMUNITY_NOT_IN_CLUB`.
- `USAGE_ERROR` — ein alter Befehl (etwa `homepage slot`, `homepage tree`)
  gibt es im CLI nicht mehr. `comvenio help fehler USAGE_ERROR`.
