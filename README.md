# comvenio-cli

Das offizielle Comvenio Club-CLI. Ein Club-Admin (oder dessen KI-Agent)
authentifiziert sich per opakem Device-Token (`cvn_...`) und verwaltet damit
seinen Verein direkt über die Comvenio-Service-APIs.

Verfügbare Domänen: `club`, `member`, `team`, `event`, `booking`, `object`,
`task`, `template`, `recipe`, `ingredient`, `ingredient-category`, `shopping`,
`menu`, `homepage`, `plan` (Geländeplan),
`tournament`, `sponsor`, `news` (Vereinsnews), `data` (Dateien/Galerie),
`meeting`, `verify`, `schema`. Jeder Command kennt `--json` und `--help`.

> Der Agent, der dieses CLI bedient, liest **`AGENTS.md`** — dort steht die
> Domänensprache (Enums, Felder, Workflows) inkl. dem News- und Galerie-Workflow.
> Die kompakte Gesamtübersicht steht in [`docs/cli-reference.md`](docs/cli-reference.md),
> der verifizierte Abdeckungsstatus aller 25 Top-Level-Commands in
> [`docs/coverage.md`](docs/coverage.md).

Stack: **Bun + cac + TypeScript**. Bau-Vorbild: `comvenio-tools/rts-cli`.

## Installation

```bash
bun install
bun run build        # erzeugt die Binary "comvenio" (bzw. comvenio.exe auf Windows)
```

Die Binary ist eigenständig (`bun build --compile`) — keine Bun-Laufzeit nötig,
um sie auszuführen.

## KI-Assistent mit Comvenio Skills verbinden

Für Claude, Codex und andere kompatible KI-Assistenten gibt es offizielle
Comvenio Skills. Der Katalog enthält 18 Skills: einen sicheren Einstieg,
Fachhilfe für Verein, Mitglieder, Buchungen, Veranstaltungen, Homepage,
Sitzungen, Bewirtung, Aufgaben, Turniere, News, Dateien, Geländepläne und
Sponsoring sowie übergreifende Workflows für Veranstaltungstag,
Helferkoordination, Saisonplanung und Vereins-Onboarding.

Alle Skills installieren:

```bash
npx skills add Comvenio/comvenio-skills --all
```

Verfügbare Skills zuerst anzeigen:

```bash
npx skills add Comvenio/comvenio-skills --list
```

Der vollständige Katalog und weitere Installationsmöglichkeiten stehen im
Repository [Comvenio/comvenio-skills](https://github.com/Comvenio/comvenio-skills).
Die Skills verwenden ausschließlich dieses CLI. Das persönliche Zugriffstoken
gehört nur in den lokalen `comvenio login`-Befehl und niemals in den Chat.

Rollen und Berechtigungen, Community-/Channel-Moderation,
ClubAgent-Administration und wesentliche Finanzabläufe sind derzeit keine
CLI-Workflows. Eine eigene Domain wird in der Comvenio-Web-App angebunden.

## Verwendung

```bash
# Einloggen — Token unter Mein Bereich → CLI-Zugriff erzeugen
comvenio login --token cvn_a1b2c3...            # PROD (Default)
comvenio login --token cvn_... --env dev        # DEV-Gateway (apidev.comvenio.app)
comvenio login --token cvn_... --club <club-id> # Club-ID explizit setzen

# Aktuellen Login prüfen
comvenio whoami
comvenio whoami --json

# Vereinsdaten anzeigen
comvenio club info
comvenio club info --json
comvenio club settings --json
comvenio club department-list --tree --json

# Abmelden (State-File löschen)
comvenio logout
```

### `--env`-Mapping

| `--env`          | Gateway                       |
|------------------|-------------------------------|
| `prod` (Default) | `https://api.comvenio.app`    |
| `dev`            | `https://apidev.comvenio.app` |
| `local`          | `http://localhost`            |

`--gateway <url>` überschreibt die Basis direkt.

## Eigene Domain für die öffentliche Vereinswebsite

Vereine mit **Premium** oder **Enterprise** können eine bereits vorhandene Domain mit ihrer öffentlichen Comvenio-Website verbinden. Die Einrichtung erfolgt im **Club-Hub** unter **Design → Öffentliche Website → Domainverwaltung**.

Die CLI legt keine Domains und keine DNS-Einträge an. Ein Agent begleitet den Kunden durch die Oberfläche und verwendet weder direkte API-Aufrufe noch manuelle Cloudflare-Einträge.

### Kundenablauf

1. Unter **Kundeneigene Domain** den vollständigen Hostnamen eingeben, zum Beispiel `www.mein-verein.de`, und **Hinzufügen** wählen.
2. Bei der neuen Domain **Anleitung anzeigen** öffnen.
3. Beim eigenen Domain-Anbieter beide von Comvenio angezeigten DNS-Einträge exakt übernehmen:
   - TXT zur Bestätigung der Domain
   - CNAME mit dem Ziel `edge.comvenio.app`
4. Zu Comvenio zurückkehren und **Verifizieren** wählen.
5. Warten, bis der Status **Aktiv** erscheint. Comvenio richtet die Verbindung und HTTPS automatisch ein.

Der Kunde gibt nur den Hostnamen ein — ohne `https://` und ohne Seitenpfad. DNS-Änderungen können je nach Anbieter bis zu 48 Stunden benötigen. Bei **Verifizierung fehlgeschlagen** werden beide Einträge erneut mit den Kopierwerten aus Comvenio verglichen und danach nochmals verifiziert.

### Prüfung durch den Support-Agenten

Ist die Domain in Comvenio **Aktiv**, kann der Agent die öffentliche Seite prüfen:

```bash
comvenio verify url https://www.mein-verein.de --json
```

Für eine kundeneigene Domain ist `verify url` mit der vollständigen Domain richtig. `verify homepage` prüft dagegen die verwaltete Comvenio-Standardadresse beziehungsweise einen Homepage-Entwurf.

Wenn Hilfe benötigt wird, fragt der Agent nur nach:

- der vollständigen Domain,
- dem in Comvenio angezeigten Status,
- bei Bedarf einem Screenshot der DNS-Einträge ohne Zugangsdaten.

Der Agent fragt niemals nach dem Passwort des Domain-Anbieters und fordert den Kunden nicht auf, selbst etwas in Cloudflare oder einer Comvenio-Infrastrukturverwaltung einzurichten.

---
## Veranstaltungen (`event`)

Veranstaltungen können direkt angelegt oder als wiederverwendbare Vorlage mit
einer Terminserie geplant werden. Jeder Befehl unterstützt `--json`.

```bash
# Eine Vorlage direkt erstellen
comvenio event template create --title "Darttraining" --event-type training \
  --visibility-scope member --organizer-type member --department-id <dept-id> --json

# Wöchentliche Terminserie aus der Vorlage anlegen
comvenio event series create <template-id> \
  --start-time 2026-07-15T19:00:00+02:00 --frequency weekly --weekdays WE \
  --duration-minutes 120 --json

# Konkrete Termine für ein Zeitfenster erzeugen (idempotent)
comvenio event series materialize <series-id> \
  --start 2026-07-15T00:00:00+02:00 --end 2027-01-15T00:00:00+01:00 --json

# Vorhandene Events weiterverwenden
comvenio event template clone <event-id> --json
comvenio event series promote-recurring <event-id> --frequency weekly --weekdays WE --json
comvenio event series promote-yearly <event-id> --json

# Einzeltermin aus einer Vorlage oder nächsten Jahrestermin erzeugen
comvenio event template instantiate <template-id> --start-time <iso> --end-time <iso> --json
comvenio event series next <series-id> --start-time <iso> --json
```

`event template list` zeigt Event-Vorlagen, `event series list|show` die vorhandenen
Terminserien. Für komplexe Regeln kann `--rrule` statt `--frequency`, `--weekdays`,
`--interval`, `--count` und `--until` verwendet werden.

Die CLI deckt außerdem Child-Events, Bereiche und Zuständigkeiten, Programm,
Kontakte, Ressourcen, Anhänge, Tags, Einladungen, Anmeldungen, Sponsoring,
Event-Design, DJ-Wünsche und externe Spielplan-Synchronisation ab. Die
vollständige, eigenständige Referenz mit Payloads und Zuständigkeitsgrenzen steht
in [`docs/veranstaltungen.md`](docs/veranstaltungen.md).

## Geländeplan (`plan`)

Geländeplan eines Events lesen + agent-tauglich planen (alle Bodies ohne `club_id` —
das Backend leitet es aus Event/Plan ab). Jeder Befehl kennt `--json`.

```bash
# Pläne / Aggregat
comvenio plan list <event-id>                 # Pläne (scoped: Parent + Festtag)
comvenio plan show <plan-id>                  # Aggregat: zones, tables, markers (Preview)
comvenio plan create <event-id> --name "Hauptgelände" [--type gelaende|fluchtplan|festumzug|sonstiges]
comvenio plan create <event-id> --name "Allgemein" --inherit   # V7: gilt für ALLE Festtage (nur Parent-Plan)

# Zonen (Bereiche / Wege)
comvenio plan zone list <plan-id>
comvenio plan zone create <plan-id> --name "Bierzelt" --length 20 --width 10 [--rotation 90] [--color "#2e7d32"]
comvenio plan zone create <plan-id> --name "Festumzug" --shape polyline \
  --points "48.13,11.57;48.14,11.58;48.15,11.59" --arrow --line-weight 5   # V6.1
comvenio plan zone link   <zone-id> --area <area-id>     # V6.1: Zone ↔ Event-Area (Public-Klick → Area des Tages)
comvenio plan zone unlink <zone-id> --area <area-id>

# Garnituren / Tische (Innenplanung)
comvenio plan table create <plan-id> --length 2.2 --width 0.5 --furniture beer_set [--label "Verein X"] [--capacity 8]
comvenio plan table duplicate <table-id>

# Marker (POI)
comvenio plan marker create <plan-id> --marker-type parking --label "Parken 1" [--lat .. --lng ..]
comvenio plan marker create <plan-id> --marker-type stage --label "Festaufstellung" --club <club-id> --size 2  # V6.1+V7
#   --size = Skalierungsfaktor (1=Standard, 1.5/2/3), --club = assigned_club_id, --logo = content-service File-ID

# Detailplan eines Bereichs (Gebäude-Canvas, z. B. Bierzelt-Innenraum)
comvenio plan detail <zone-id> --name "Zelt-Innen" --length 20 --width 10
```

> Marker-/Tisch-Logos via content-service hochladen (File-ID an `--logo`). Diese Logos
> erscheinen NICHT in der öffentlichen Galerie und werden beim Löschen des Markers hart entfernt.

## Tournament (`tournament`)

V3-Turniere lesen + steuern (Gateway-Key `tournament`). Participant-Engine: ein Match
paart Teilnehmer (Einzelspieler / Doppel / **Mannschaft**) über `TournamentMatchSide`,
nie ein Team. Jeder Befehl kennt `--json`.

```bash
comvenio tournament series-list [--club <id>]     # Turnierserien des Clubs
comvenio tournament series-create --file series.json   # Serie anlegen (POST /tournament-series)
comvenio tournament series-update <series-id> --file series-update.json
comvenio tournament series-delete <series-id>
comvenio tournament execution-create <series-id> --file execution.json  # Ausführung aus Serie anlegen
comvenio tournament list [--club <id>]            # Turniere des Clubs
comvenio tournament show <id>                     # Turnier-Meta
comvenio tournament update <id> --file tournament-update.json
comvenio tournament delete <id>
comvenio tournament status <id> --status registration  # Status setzen
comvenio tournament participants <id>             # Teilnehmer (Art/Status)
comvenio tournament mannschaft <id> --name "SV Motzing AH" [--kind team|individual|pair] [--seed 1]
comvenio tournament start <id>                    # Spielplan generieren (Status → active)
comvenio tournament matches <id>                  # Spielplan (Namen aus den Match-Sides)
comvenio tournament standings <id>                # Tabelle (participant-basiert)
comvenio tournament preview <id> [--open]         # self-contained HTML in Temp-Datei; --open öffnet den Browser

# Auslosung + Spielplan
comvenio tournament draw <id> --file plan.json    # Draw-Session anlegen (strategy=manual + fixed_assignments
                                                  #   + knockout_config inkl. placement_mode direct|cross)
comvenio tournament draw-confirm <id>             # aktuelle Session bestätigen → materialisiert Gruppen-Matches + K.O.-Bracket
comvenio tournament schedule-generate <id> --match-minutes 15 --break-minutes 3 --field-count 2 \
  --first-kickoff 2026-07-04T14:00:00Z [--dry-run] [--no-auto-book]   # automatischer Generator
comvenio tournament match-schedule <match-id> --start 2026-07-04T14:00:00Z --end 2026-07-04T14:15:00Z \
  --location "Feld 1" [--status proposed|booked] [--match-number 1]  # EXAKTE Zeit/Feld/Spielnummer
comvenio tournament match-delete <match-id>       # Match löschen (Soft-Delete; z. B. vor Re-Draw)
comvenio tournament redraw <id> --file plan.json  # Reset + alte Matches löschen + neu auslosen + bestätigen
comvenio tournament match-result <match-id> --home 3 --away 1
comvenio tournament match-result <match-id> --result-no-show --winner away
comvenio tournament match-result <match-id> --result-no-contest
comvenio tournament deadline <id> --phase group --at 2026-07-04T18:00:00Z
```

> `mannschaft` = Alias für `participant` mit Default `--kind team`; `individual` = Einzel, `pair` = Doppel.
> `preview` rendert lokal. `draw-confirm` materialisiert additiv; für eine vollständige
> Neuauslosung deshalb `redraw` verwenden. Serien-Create, Satzresultate,
> Sonderwertungen und Ergebnis-Deadlines sind enthalten. Vollständige Payloads und
> Workflows: [`docs/turniere.md`](docs/turniere.md).

## Vereinsnews (`news`) + Dateien/Galerie (`data`)

Vereinsnews als Rich-HTML verfassen, lokal ansehen und veröffentlichen — mit
Bildern aus der Event-Galerie. Der bedienende Agent komponiert das Rich-HTML
selbst (kein ai-service). Jeder Befehl kennt `--json`.

```bash
# Galerie eines Events + presigned Bild-URL (Header/Titelbild)
comvenio data list --context event --context-id <event-id> --json   # context_label: gallery|gelaendeplan|…
comvenio data url  <file_id> --json                                 # presigned URL (kein Download)
comvenio data download <file_id> --out bild.jpg --json              # Datei lokal speichern

# News schreiben: news.json komponieren, dann ansehen → veröffentlichen
comvenio news preview --file news.json --open       # Backend-Vorschau-URL (echtes Layout, 30 Min); --local = Offline-Fallback
comvenio news apply   --file news.json --draft      # Entwurf (nur Admins sichtbar)
comvenio news publish <news-id>                     # Entwurf → öffentlich
comvenio news apply   --file news.json --publish    # in einem Schritt live
comvenio news list --json                           # Status je News: Entwurf/Live
comvenio news video slideshow --params params.json --upload  # Video generieren (Remotion, lokal) + einbetten
```

> **Entwurf vs. veröffentlicht:** News sind per Default **Entwürfe** (`is_draft=true`,
> nur Admins). `--publish` bzw. `news publish <id>` schaltet sie öffentlich. `news.json`:
> `title`, `teaser`, `visibility_scope`, `content` (rich HTML), optional `cover_image_file_id`
> (Titelbild) und `cover_url` (presigned, nur für die Vorschau). Vollständige
> Referenzen: [`docs/vereinsnews.md`](docs/vereinsnews.md) und
> [`docs/dateien.md`](docs/dateien.md).

## Konzept

- **Token opak:** Das `cvn_`-Token wird vom CLI nie dekodiert. Gültigkeit prüft
  ausschließlich der Server.
- **State-File:** `~/.comvenio-cli-state.json` (Merge-Semantik — wird nie ganz
  überschrieben).
- **Agent-freundlich:** Jeder Command kennt `--json` (maschinenlesbar auf
  stdout). Fehler gehen auf stderr mit Exit-Code != 0
  (`AuthError`→2, `HttpError`→3, sonst 1).
- **Retry:** Nur GETs werden bei transienten Gateway-Fehlern (502/503/504/429)
  und Timeout (15s) bis zu 3× wiederholt. Mutationen nie.

## Architektur

```
src/
  index.ts            # cac-Einstieg: login/logout + Dispatcher-Wiring + Exit-Mapping
  auth.ts             # State-File lesen/mergen/löschen, AuthError
  http.ts             # createClient(state) → service(svc, path), Bearer, GET-Retry, HttpError
  format.ts           # output(data, json, textFn), renderTable, truncate
  commands/
    whoami.ts         # GET /user/users/me (best-effort)
    club.ts           # Club-Profil, Settings, Abteilungen und Design
    plan.ts           # plan <action>-Dispatcher → Geländeplan (event-service /events/map-*)
    tournament.ts     # tournament <action>-Dispatcher → V3-Turniere (tournament-service)
    event.ts menu.ts recipe.ts task.ts member.ts ...   # je ein <action>-Dispatcher pro Service
```
