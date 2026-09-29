# Probelauf: eine fremde KI-Sitzung mit nur öffentlichen Quellen

Misst wiederholbar, ob eine KI-Sitzung, die nur das sieht, was ein Kunde oder
sein Assistent hat, mit der Kundendoku bauen, Fachfragen beantworten und durch
die Web-App führen kann (comvenio-cli-doku 09, Ziel D-DOK-12). Gemessen wird
die **Doku**, nicht die Sitzung: Eine ungelöste Aufgabe ist eine Doku-Lücke mit
Verweis auf den Strang, der sie schließen muss.

## Auslösen

Von Hand, nach jedem materiellen Doku-Update aus 06–08 und vor jeder
Veröffentlichung eines neuen Kunden-Doku-Standes. Kein CI-Trigger: Ein
Sitzungslauf kostet Geld und streut, er ist kein Unit-Test.

```bash
comvenio login --env dev                 # nur im Comvenio-Verein; ohne Login laufen nur Fachfragen und Web-App
bun run probelauf katalog                # Katalog und Standardsatz ansehen, keine Sitzung
bun run probelauf                        # Standardsatz, DEV, Modell sonnet
bun run probelauf -- --cli ./comvenio    # Kandidat vor einer Veröffentlichung (bun run build)
bun run probelauf -- --klasse fachfrage  # nur eine Aufgabenklasse; --alle für den ganzen Katalog
bun run probelauf vergleich <a>/bericht.json <b>/bericht.json   # Wiederholbarkeit, Exit 0 = stabil
```

Bericht und Transkripte liegen unter `probelauf/berichte/<lauf>/` (nicht
versioniert — Bauaufgaben lesen echte Vereinsdaten). Der Bericht geht als
Note an den RTS-Vorgang des Doku-Standes.

## Sandbox

Je Aufgabe eine eigene `claude -p`-Sitzung in einem leeren Temp-Verzeichnis:

- Werkzeuge nur `Bash` und `WebFetch`; erlaubt sind `comvenio help`,
  `--help`, `--version`, `whoami`, `schema`, `action list`, `action call`,
  das Hilfe-Center (`www.comvenio.app`) und `comvenio_hilfe` über
  `https://mcp.comvenio.app/mcp`. Alles andere lehnt der Provider ab
  (`--permission-mode dontAsk`).
- `comvenio action confirm` ist gesperrt; jeder Versuch zählt als Verstoß.
- Keine Einstellungen des Arbeitsplatzes (`--setting-sources ""`): keine
  Hooks, keine CLAUDE.md, kein Gedächtnis, kein Repository.
- Anmeldung nur im Comvenio-Verein; ein anderer Verein bricht den Lauf ab.
  Schreibende Bauaufgaben laufen nur auf DEV.

## Aufgabenkatalog

Je Bereich (Homepage → Finance → Event → Tournament → Meeting) drei Klassen:

| Klasse | Quelle | gelöst, wenn |
|---|---|---|
| bau | `probelauf/bau-aufgaben.json` | der erwartete `action call` ohne Fehler lief |
| fachfrage | „Häufige Fragen“ (07), Widgets (06) | die Antwort alle Kernaussagen nennt (Code-Stellen, Ja/Nein) |
| web-app | `src/schema/web-app-fuehrung.json` (08) | die Antwort die Schritte des Menüpfads nennt |

Der Katalog entsteht bei jedem Lauf aus den Artikeln; sein Hash steht im
Bericht. Der Standardsatz nimmt je Bereich und Klasse genau eine Aufgabe, fest
über den Hash ihrer Kennung. Ohne Führung aus 08 (Tournament, Meeting) ist die
Klasse `NOT_APPLICABLE` — eine bekannte Lücke, kein Fehlschlag.

## Messung

Je Aufgabe: gelöst (ja/teilweise/nein), Doku-Nachschläge, erfundene Befehle
oder Action-Kennungen, `confirm`-Versuche, Sandbox-Verstöße, abgelehnte
Aufrufe, Dauer, Kosten. Jeder Wert trägt den Status aus dem Messvertrag des
Harness (`DERIVED`, `PARTIAL`, `NOT_MEASURED`, `NOT_APPLICABLE`); was nicht
gemessen wurde, ist nie 0 oder gelöst, und die Selbstauskunft der Sitzung wird
nicht gelesen. Zwei Berichte sind vergleichbar bei gleichem Katalog,
Doku-Stand, Umgebung und Modell; stabil ab 80 % gleicher Urteile.
