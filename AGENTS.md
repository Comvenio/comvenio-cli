# comvenio CLI — Agent Guide

> Diese Datei liest der bedienende KI-Agent (Claude Code / Codex) automatisch.
> Sie beschreibt die Domänensprache des `comvenio`-CLI, damit du die gültigen
> Felder/Enums/Widget-Typen **kennst statt rätst**. Zur Laufzeit liefert
> `comvenio schema <domain> --json` die maschinenlesbaren Details.

## Wer bedient dich — und wie du sprichst (WICHTIG)

Der Nutzer dieses CLI ist ein **Vereins-Verantwortlicher (Kunde)**, kein Entwickler.
Du verwaltest **seinen** Verein. Sprich in seiner Sprache — über Verein, Mitglieder,
Veranstaltungen, News — **nie** über Interna:

- **Keine Umgebungs-/Infrastruktur-Begriffe** dem Nutzer gegenüber: „prod/dev/local",
  „Gateway", „Umgebung", „PROD", „Staging" gehören NICHT in deine Antworten. Welches
  Gateway aktiv ist, ist ein internes Detail — der Kunde interessiert sich für seinen
  Verein, nicht für Server.
- **Keine internen Bezeichner** unnötig zeigen: Service-Namen (content-service …),
  rohe UUIDs, `context_type`, Enum-Rohwerte. Wenn ein Name verfügbar ist, nenne den Namen.
- `--env`/`--gateway` sind reine Betriebs-Flags. Nutze sie still; erkläre sie dem
  Kunden nicht als „Produktivumgebung".

Kurz: Du bist der Vereins-Assistent am Terminal, nicht der DevOps-Kollege.

## Was ist Comvenio

Comvenio ist eine Vereins-Plattform (Mitglieder, Veranstaltungen, Buchungen,
Aufgaben, Speisekarte, Vereins-Homepage). Dieses CLI verwaltet einen Verein
**deterministisch über die Service-APIs** des Comvenio-Gateways
(`api.comvenio.app`). Jeder Command ruft genau einen Service-Endpoint; es gibt
keinen Agenten/Chat dazwischen. Rechte (RBAC) werden **serverseitig** geprüft —
das CLI sendet nur dein opakes Device-Token.

## Quickstart (Auth)

```bash
comvenio login --token cvn_xxxxxxxx   # Device-Token aus der Web-App (Einstellungen → CLI-Zugriff)
comvenio whoami                       # zeigt Name + Verein
comvenio club info                    # Vereinsdaten
```

- Das Token ist **opak** (`cvn_...`), kein JWT — niemals dekodieren. Der Server
  prüft Gültigkeit/Ablauf.
- `--env prod|dev|local` (Default `prod`) wählt das Gateway. `--club <id>`
  überschreibt die Club-ID aus dem State-File (`~/.comvenio-cli-state.json`).
- 401 → Token abgelaufen, neu erzeugen. 403 → dein Token hat das Recht nicht.

## Commands (Domänen-Übersicht)

| Domäne   | Beispiele                                                      |
|----------|---------------------------------------------------------------|
| club     | `comvenio club info` · `comvenio club design` (Theme/Farben/Public-Template → design_settings) |
| member   | `comvenio member list\|show\|add\|update\|remove`             |
| team     | `comvenio team list` · `comvenio team member list\|add\|remove <team-id>` |
| event    | `comvenio event list\|show\|create\|update\|publish` · `event area list\|add <event-id>` · `event menu list\|assign\|unassign` (Speisekarte je Event/Bereich — EventMenu, supply-service) |
| plan     | `comvenio plan list\|show\|create` · `plan zone create\|list\|link\|unlink` · `plan table create\|duplicate` · `plan marker create` · `plan detail` (Geländeplan; `--inherit` Vererbung, `--shape polyline --points --arrow` Festumzug, `--size`/`--club` Marker) · `plan export` (PNG/PDF) · `plan illustrate` + `plan compose` (illustrierter Lageplan, D-36) |
| sponsor  | `comvenio sponsor list\|add\|update\|logo` · `sponsor product-list\|product-add` · `sponsor assign` · `sponsor contract-add` · `sponsor doc-upload` (lokales Club-Sponsoring, marketing-service + content-service) |
| booking  | `comvenio booking list\|show\|approve\|reject`                |
| object   | `comvenio object list [--type static\|portable\|event]`       |
| task     | `comvenio task list\|show\|create\|assign\|done` · `task context list\|create` |
| template | `comvenio template dish\|ingredient [--search\|--category\|--common]` (globale Vorlagen) |
| recipe   | `comvenio recipe from-template\|create\|list\|show\|update\|delete` (Gerichte/Getränke) |
| menu     | `comvenio menu create\|list\|show\|add-item\|delete\|style` · `menu generate\|apply\|design` (KI) |
| homepage | `comvenio homepage generate\|preview\|apply\|show\|design`     |
| news     | `comvenio news list\|show\|create\|update\|delete` · `news apply --file` (rich HTML, Galerie-Bilder) · `news preview --file --open` (lokale Vorschau, kein Write) · `news publish <id>` (Entwurf → veröffentlicht). Details unten „Vereinsnews". |
| data     | `comvenio data list\|show\|url\|download\|upload\|papers\|export` (Vereins-Dateien & Galerie; `data url <file_id>` = presigned Bild-URL fürs Einbetten) |
| tournament | `comvenio tournament list\|show\|participants\|start\|matches\|standings\|draw\|schedule-generate` · `tournament preview [--open]` (V3-Turniere) |
| meeting  | `comvenio meeting list\|show\|...` (Sitzungen/Protokolle) |
| verify   | `comvenio verify <action>` (visuelles Review: headless Render → Screenshots, damit du das Ergebnis siehst) |
| schema   | `comvenio schema <domain> --json`                             |

> **Speisekarten ausführlich:** `docs/speisekarten.md` — Datenmodell (Recipe↔Ingredient↔Allergen
> transitiv), Vorlagen-Workflow, Wiederverwendung, Gotchas, End-to-End-Beispiel. **Lesen, bevor du
> Gerichte/Karten anlegst.**

Jeder Command hat `--help` (`comvenio member --help` etc.) mit allen Optionen.

## Domänen-Konzepte & Enums (KEIN Raten — frag das Schema)

```bash
comvenio schema <domain> --json   # gültige Felder/Enums/Widget-Typen maschinenlesbar
```

Wichtigste Enums (autoritativ via `comvenio schema`):

- **event:** `event_type` (party\|meeting\|excursion\|training\|competition\|other),
  `visibility_scope` (public\|member\|private\|department\|invite_only),
  `organizer_type` (member\|external), `status` (draft\|planned\|confirmed\|archived\|cancelled).
  Es gibt **kein** `published` — `event publish` = `PATCH status=confirmed`.
  **Mehrtägige Feste** sind ein **Parent-Event** (`event_complexity=multi_day`) mit einem
  **Child-Event pro Tag** (`parent_event_id` zeigt aufs Parent, `child_events[]` listet die Tage).
  Jeder Tag hat eine **eigene Galerie** (`data list --context event --context-id <tag-event>`).
  Finden: `comvenio event list --month YYYY-MM --json` → Feld `child_events` / `parent_event_id`.
- **news:** `visibility_scope` (public\|member\|department, Default member).
  **Entwurf/Veröffentlichung (WICHTIG):** `is_draft` (Default **true** → News ist nur für Admins
  sichtbar, NICHT öffentlich). Veröffentlichen = `is_draft=false` + `published_at`. Im CLI:
  `--publish` (sofort live) · `--draft` (bewusst als Entwurf) · `news publish <id>` (einen
  bestehenden Entwurf live schalten). **Ohne `--publish` bleibt eine neue News ein Entwurf** —
  vergisst du das, wundert sich der Verein, warum die News nicht erscheint. `design_source` wird
  bei `apply` auf `cli` erzwungen (design-locked Rich-HTML). `news preview --file --open` zeigt
  die News vorab lokal (kein Write).
- **member:** Pflicht bei `add`: `first_name`, `last_name` (club_id aus State).
  `team member --role`: PLAYER\|CAPTAIN\|COACH\|ASSISTANT_COACH\|MANAGER.
- **booking:** `reservation_status` (requested\|approved\|rejected\|cancelled).
  `--pending` filtert **clientseitig** auf `requested`. `approve`/`reject` holen
  vorher die Reservierung (club_id + object_id sind PATCH-Pflicht). Eigene Buchung
  kann man **nicht** selbst genehmigen (403).
- **task:** `status` (open\|in_progress\|completed\|cancelled), `priority`
  (low\|medium\|high). `task create` braucht zwingend `--context-id`
  (`task_context_id`) — vorher `task context list`. `task assign` erwartet
  `--member-id` (Member-ID, **nicht** user_id).
- **menu / recipe:** `comvenio schema menu --json` → `design_config`-Felder (MenuDesignOptions).
  `unit_type` (UnitType, verifiziert): `gr\|kg\|ml\|l\|pc\|portion\|tsp\|tbsp\|cup\|pinch` (NICHT
  `g`/`piece`/`serving`). `type_of_recipe` (food\|drink), `age_group` (none\|teen\|adult). **Allergene
  sind transitiv** (Recipe → Ingredient → Allergen), nie direkt am Rezept — korrekte Allergene bekommst
  du, indem die Zutaten-Namen die globalen Vorlagen treffen. Details: `docs/speisekarten.md`.
- **template:** `comvenio template dish\|ingredient --search "..."` durchsucht die globalen Vorlagen
  (100+ Gerichte mit Rezept+Allergenen, 380+ Zutaten). `recipe from-template <id>` instanziiert ein
  vollständiges Rezept (Allergene inklusive, idempotent). **Vorlagen zuerst** — nur was fehlt ad-hoc bauen.
- **homepage:** `comvenio schema homepage --json` → 68 Widget-`kind`-Werte +
  config-Felder je Widget + Section-`layout`/`style_variant` + Templates.
- **sponsor:** lokale Sponsoren sind `Advertiser` mit `club_id` + `club_department_id`. Sponsoring-Angebote sind `ClubSponsorshipProduct`, lokale Vertraege/Preisversionen laufen ueber `contract-add`, aktive Sponsor-Zuordnungen ueber `assign`. Logos und Vertragsdateien werden via content-service hochgeladen; Sponsor-Logos: `context_type=advertiser`, Produktvertraege: `sponsorship_product`, Assignment-Vertraege: `sponsorship_assignment`.
- **design (Flex-Template):** `comvenio schema design --json` → `FlexDesignConfig`
  (hero/sections/decor/type/density/cornerStyle/accentUsage) für `custom_template_config`.
  Das Aussehen kommt aus **Config**, nicht aus club-spezifischem Code: EIN generisches
  `flex`-Template, das die Config liest. Setzen mit `comvenio club design --public-template flex
  --primary "#.." --accent "#.." --file design_settings.json`. Brand-Farben kommen aus
  `--primary/--accent/--secondary` (nicht aus der Flex-Config).

## Generieren = du, nicht der Server (Leitprinzip)

**Du bist selbst das LLM.** Bei den KI-Gen-Domänen (`menu`, `homepage`) sollst du die
Struktur (Speisekarte, Homepage aus Tabs/Sektionen/Widgets) **selbst aus dem Schema
komponieren** (`comvenio schema <domain> --json`) und deterministisch via `apply --file`
ans Backend schicken — **nicht** den ai-service-Generator (`generate --prompt`) als zweite
LLM-Schicht aufrufen. Gründe:

1. **Kosten** — `apply --file` ruft keinen ai-service-LLM. Kein zweiter LLM-Call (du hast
   das Verständnis bereits).
2. **Direkte Interaktion** — du verstehst den Wunsch des Users, komponierst die Struktur,
   zeigst sie ihm, iterierst im Dialog. Eine Blackbox dazwischen verschenkt diese Schleife.
3. **Determinismus + Kontrolle** — exakte `kind`/`config`/`layout`-Werte, reproduzierbar,
   gezielt erweiterbar. Das Schema sagt dir genau, was gültig ist.

`generate --prompt` bleibt als **Komfort-Fallback** erhalten — für Nutzer **ohne** fähigen
Agenten (z. B. die Web-App selbst, die den ai-service-Generator als Blackbox nutzt). Für
dich als CLI-bedienenden Agenten ist `apply --file` der **empfohlene** Weg.

## Dual-Mode der KI-Gen-Domänen (menu / homepage)

Beide KI-Gen-Domänen haben **zwei Modi**:

1. **Deklarativ** (`apply --file`) — **PRIMÄR für dich (Agent).** **Du** komponierst die
   Struktur selbst, gestützt auf `comvenio schema`. Das CLI POSTet sie direkt an den
   Service — **kein** ai-service, kein zweiter LLM-Call (siehe „Generieren = du" oben).
   - `comvenio schema menu --json > schema.json` → `menu.json` bauen → `menu apply --file menu.json`
   - `comvenio schema homepage --json > schema.json` → `home.json` bauen → `homepage apply --file home.json`
2. **Generativ** (`generate`) — **Fallback / Spezialfall.** Der ai-service ist die Blackbox
   (zweite LLM-Schicht). Sinnvoll nur, wenn der Service ein **Foto/eine Beschreibung
   interpretieren** soll, die du nicht selbst strukturieren kannst (z. B. Vision-OCR einer
   Papier-Karte), oder für Nutzer ohne fähigen Agenten.
   - `menu generate --photo karte.jpg` (Vision-OCR) / `--text "..."`
   - `homepage generate --prompt "modern, 3 Tabs" --template sport`
   - Ohne `--apply`: nur Vorschlag (Review). Mit `--apply`: anlegen.
     `homepage generate --apply` ersetzt die bestehende Homepage (`clear_existing`).

**Empfehlung:** Standardweg = **deklarativ** (`apply --file`) — komponiere selbst aus dem
Schema. Greife nur zu **generativ** (`generate`), wenn echte Bild-/Text-Interpretation
nötig ist (Foto einer bestehenden Karte) oder ein Nutzer ohne Agent das Komfort-Verfahren
braucht.

## --json-Konvention

Default ist menschenlesbar (Tabellen). Mit `--json` → parsebares JSON auf
**stdout**; Fehler immer auf **stderr** + Exit-Code != 0. **Für dich (Agent):
IMMER `--json` verwenden.** (`schema` ist standardmäßig JSON.)

Exit-Codes: 0 OK · 2 Auth-/Eingabefehler · 3 API-Fehler (HTTP) · 1 sonstiges.

## Beispiel-Workflows (Rezepte)

**1. Event mit Bereichen anlegen**
```bash
comvenio event create --title "Sommerfest" --event-type party \
  --visibility-scope public --organizer-type member --department-id <dept> --json
comvenio event area add <event-id> --name "Bühne" --json
comvenio event publish <event-id> --public --json
```

**2. Speisekarte rezept-basiert bauen (EMPFOHLEN — echte Allergene, Wiederverwendung)**
```bash
# Vorlage finden -> Rezept (mit Allergenen) -> Karte -> Eintrag (Label/Preis pro Karte)
comvenio template dish --search "Schnitzel" --json
RID=$(comvenio recipe from-template <template-id> --price 12 --json | jq -r .recipe_id)
MID=$(comvenio menu create --name "Festtag" --category Fest --json | jq -r .id)
comvenio menu add-item $MID --recipe $RID --name "Schnitzel mit Kartoffelsalat" --price 12 --json
```
> Vollständiger Leitfaden + Gotchas: **`docs/speisekarten.md`**. Ein `MenuItem` **ohne** `recipe_id`
> (z.B. via `apply --file` mit reinen name+price-Items) hat **keine Allergene** und fehlt in der
> öffentlichen QR-Liste — für echte Karten immer ein Rezept hinterlegen.

**2b. Speisekarte deklarativ im Schwung (apply --file — wenn recipe_ids schon feststehen)**
```bash
comvenio schema menu --json > schema.json     # gültige design_config-Felder / UnitType nachschlagen
# menu.json komponieren (name + items[] MIT recipe_id + optional design_config), dann:
comvenio menu apply --file menu.json          # Karte + Items im Bulk (kein ai-service, kein zweiter LLM-Call)
```

**2c. Speisekarte aus Foto (generativ — nur wenn echtes Bild-OCR nötig)**
```bash
comvenio menu generate --photo ./speisekarte.jpg --json     # Vorschlag ansehen (kein Write)
comvenio menu generate --photo ./speisekarte.jpg --apply --menu-name "Sommerkarte 2026"
```

**3. Homepage deklarativ bauen (Standardweg — du komponierst)**
```bash
comvenio schema homepage --json > schema.json     # gültige kinds/config/layout nachschlagen
# home.json komponieren (tabs → sections → widgets), dann ansehen → live schalten:
comvenio homepage preview --file home.json --json # pixel-echte Vorschau-URL (kein Live-Write)
comvenio homepage preview --file home.json --open # zusätzlich im Standard-Browser öffnen
comvenio homepage apply --file home.json          # additiv (kein ai-service, kein zweiter LLM-Call)
comvenio homepage apply --file home.json --clear  # bestehende Homepage ersetzen
```

> **Empfohlener Flow:** Struktur aus `schema homepage` komponieren → `homepage preview
> --file` (ansehen, optional `--open`) → `homepage apply --file` (live schalten). `preview`
> mutiert die Homepage **nicht** — es liefert nur eine kurzlebige Vorschau-URL
> (`preview_url`, `expires_at`).

**3b. Design/Theme setzen (config-getrieben, kein club-spezifischer Code)**
```bash
comvenio schema design --json > design-schema.json  # FlexDesignConfig-Vokabular (hero/sections/decor/type/…)
# design_settings.json bauen: { "homepage_theme": "...", "primary_color": "#..", "accent_color": "#..",
#   "homepage_template": "flex", "custom_template_config": { <FlexDesignConfig> } }
comvenio club design --public-template flex --primary "#1c2fb8" --accent "#3d9bff" --font sporty  # Flags
comvenio club design --file design_settings.json --dry-run   # oder: volles Objekt, erst Trockenlauf
comvenio club design --file design_settings.json             # schreibt design_settings (Deep-Merge)
# danach: homepage preview --file home.json  -> rendert das flex-Template MIT dieser Config
```
> Brand-Farben kommen aus `--primary/--accent/--secondary`; Layout/Hero/Deko aus der Flex-Config
> (`custom_template_config`). EIN generisches `flex`-Template, beliebig viele Looks via Config.

**4. Aufgabe mit Context anlegen + zuweisen**
```bash
comvenio task context list --json                 # task_context_id ermitteln
comvenio task create --title "Bestuhlung" --context-id <ctx> --json
comvenio task assign <task-id> --member-id <member> --responsible --json
comvenio task done <task-id> --json
```

**5. Illustrierter Lageplan (D-36 — Generieren = du, nicht der Server)**
```bash
# 1. Kit erzeugen: echter Export als Layout-Referenz + Struktur + fertiger Prompt
comvenio plan illustrate <event-id> --plan <plan-id> --style "Wasserfarben, herbstlich" --json
# -> .comvenio-illustration/<plan-id>/: export.png + plan.json + PROMPT.md

# 2. DU generierst die Illustration mit deinem Bildmodell:
#    PROMPT.md befolgen (Vogelperspektive, KEIN Text im Bild, Layout-Treue zu export.png).

# 3. Echte Beschriftungen (gelbe Fahnen + Linien, exakte Umlaute) deterministisch darüberlegen:
comvenio plan compose <event-id> --plan <plan-id> --image illustration.png --out lageplan.png
# Fahne sitzt daneben? -> Label-Anker im Web-Editor verschieben (D-35), compose erneut (Sekunden).
```

**6. Vereinsnews mit Galerie-Bild als Header (Rich-News, deklarativ)**
```bash
# 1. Das (ggf. mehrtägige) Event finden — bei Festen: Parent + Child-Event pro Tag
comvenio event list --month 2026-07 --json          # parent_event_id / child_events[]

# 2. Galerie-Bild wählen + presigned URL holen. context_label trennt echte Fotos von
#    Geländeplan-Markern/Logos: "gallery" = Galerie-Foto, "gelaendeplan" = Marker/Logo.
comvenio data list --context event --context-id <event-id> --json
comvenio data url  <file_id> --json                 # presigned URL fürs <img> / die Vorschau

# 3. news.json SELBST komponieren (du bist das LLM — kein ai-service):
#    { "title", "teaser", "visibility_scope": "public",
#      "cover_image_file_id": "<file_id>",           # echtes Titelbild (Frontend löst die ID auf)
#      "cover_url": "<presigned>",                   # NUR für die lokale Vorschau (wird beim apply verworfen)
#      "content": "<h2>Freitag …</h2><p>…</p>" }     # rich HTML; Bilder als
#      # <img src="<presigned>" data-comvenio-file-id="<file_id>">

# 4. Ansehen → veröffentlichen
comvenio news preview --file news.json --open       # lokale HTML-Vorschau (kein Write)
comvenio news apply   --file news.json --draft      # als Entwurf anlegen (nur Admins sehen es)
comvenio news publish <news-id>                     # live schalten
#   oder in einem Schritt: comvenio news apply --file news.json --publish
```
> **Warum Draft→Publish:** eine News ist ohne `--publish` ein **Entwurf** (`is_draft=true`,
> nicht öffentlich). `preview` ist die schnelle lokale Sicht, `apply --draft` + `news publish`
> der saubere „erst ansehen, dann live"-Weg (analog `homepage preview` → `apply`).
> Inline-Bilder brauchen `data-comvenio-file-id`, damit das Backend abgelaufene presigned
> URLs automatisch neu signiert. „Jeden Tag beschreiben" = ein `<h2>`-Abschnitt je Child-Event.

## Rich-News-Redaktion (Design-System `.rich-news`)

CLI-News (`design_source=cli`) werden in der Web-App mit dem **`rn-*`-Baukasten** gerendert
(`web-page: rich-news.css`). Du komponierst die Bausteine **frei** — mehr Bilder, Spalten,
Tabellen, Videos sind erwünscht. Qualitätsmassstab: professioneller Zeitungs-/Magazinbericht.
**Vertrag:** dieser Katalog ist 1:1 mit `rich-news.css` synchron — nutze KEINE anderen
`rn-*`-Klassennamen (unbekannte Klassen rendern nur im Basis-Stil).

### Klassen-Katalog (alle verfügbaren Bausteine)

| Klasse | Baustein | Snippet |
|--------|----------|---------|
| `rn-kicker` | Dachzeile über der Headline | `<p class="rn-kicker" data-edit>Gründungsfest</p>` |
| `rn-headline` | Hero-Headline | `<h1 class="rn-headline" data-edit>Zeichen der Gemeinschaft</h1>` |
| `rn-subline` | Unterzeile | `<p class="rn-subline" data-edit>SV feiert drei Tage lang…</p>` |
| `rn-lead` | Lead-/Einstiegsabsatz (grösser) | `<p class="rn-lead" data-edit>Mit einem…</p>` |
| `rn-byline` | Autoren-/Ortsmarke-Zeile | `<p class="rn-byline" data-edit>Obermotzing. Von der Redaktion</p>` |
| `rn-crosshead` | Zwischenüberschrift | `<h2 class="rn-crosshead" data-edit>Ernennung des Ehrenvorstands</h2>` |
| `rn-serif` | Serif-Modifikator (kombinierbar mit headline/crosshead/lead/quote) | `<h1 class="rn-headline rn-serif" data-edit>…</h1>` |
| `rn-dropcap` | Initial am Absatzanfang | `<p class="rn-dropcap" data-edit>Bereits zum Auftakt…</p>` |
| `rn-columns-2` / `rn-columns-3` | Mehrspaltiger Fliesstext (Mobile: 1 Spalte) | `<div class="rn-columns-2"><p data-edit>…</p>…</div>` |
| `rn-figure` | Standard-Bild mit Caption | `<figure class="rn-figure"><img src="…" data-comvenio-file-id="…" alt="…"/><figcaption class="rn-caption" data-edit>Text <span class="rn-credit">Foto: N.N.</span></figcaption></figure>` |
| `rn-figure-full` | Vollbreite-Bild (bricht aus der Lesespalte aus) | `<figure class="rn-figure-full">…wie rn-figure…</figure>` |
| `rn-figure-left` / `rn-figure-right` | Umflossenes Bild (Mobile: gestapelt) | `<figure class="rn-figure-left">…</figure>` |
| `rn-gallery` | Bild-Raster (3/2/1 Spalten responsive) | `<div class="rn-gallery"><img …/><img …/><img …/></div>` |
| `rn-caption` | Bildunterschrift | s. `rn-figure` |
| `rn-credit` | Foto-/Video-Credit in der Caption | `<span class="rn-credit">Foto: Otto Zellmer</span>` |
| `rn-quote` | Zitat-Block (Pull-Quote, Akzent-Rand) | `<blockquote class="rn-quote" data-edit>„80 Jahre…"<span class="rn-quote-source">Johann Busl, Bürgermeister</span></blockquote>` |
| `rn-quote-source` | Zitat-Quelle (in `rn-quote`) | s. `rn-quote` |
| `rn-infobox` | Info-/Fakten-Kasten (getönt) | `<div class="rn-infobox"><p data-edit>…</p></div>` |
| `rn-table` | Daten-Tabelle (Zebra, Mobile scrollbar) | `<div class="rn-table"><table>…</table></div>` |
| `rn-video` | Video-Container 16:9 | `<figure class="rn-video"><video controls preload="metadata"><source src="…" type="video/mp4"/></video></figure>` |
| `rn-divider` | Redaktioneller Trenner | `<hr class="rn-divider"/>` |

### Journalistischer Stil-Guide (Baustein B)

- **Aufbau:** `rn-kicker` (Dachzeile) → `rn-headline` → `rn-subline` → `rn-byline`
  (Ortsmarke) → `rn-lead` → Erzählbogen im Fliesstext → Abschluss (Ausblick/Fazit).
- **Zwischenüberschriften** (`rn-crosshead`) ca. alle 3-5 Absätze — sie strukturieren den Bogen.
- **Zitate** als `rn-quote` mit `rn-quote-source` — wörtliche Rede macht den Bericht lebendig.
- **Jedes Foto** bekommt `rn-caption` + `rn-credit`. Vollbreite-Fotos (`rn-figure-full`) als
  visuelle Anker am Anfang/Ende; umflossene (`rn-figure-left/right`) im Fliesstext.
- **Spalten** (`rn-columns-2`) sparsam für lange Passagen; Tabellen (`rn-table`) für
  Ergebnisse/Zahlen; `rn-infobox` für Fakten am Rand.
- **`data-edit` auf ALLE redaktionellen Textknoten** (h1/h2/p/figcaption/li/blockquote) —
  sonst kann der Vereinsadmin den Text in der Web-App nicht pflegen.
- Bilder aus der Event-Galerie (`comvenio data list/url`) oder eigene Uploads; Inline-Bilder
  immer mit `data-comvenio-file-id`.
- Zusätzlich erlaubt: Inline-Styles auf Whitelist-Properties (Layout/Farbe/Typo) — der Katalog
  ist aber der dokumentierte Standardweg.

### Videos einbetten (K6)

Zwei Wege, beide im `rn-video`-Container:

```bash
# Eigenes Video hochladen (Presign-Flow, Limit 200 MB) und einbetten:
comvenio data upload ./festumzug.mp4 --context event --context-id <event-id> --json
comvenio data url <file_id> --json                  # presigned URL fürs <source src>
```

```html
<!-- Comvenio-Video (S3-URLs werden beim Lesen automatisch re-signed): -->
<figure class="rn-video">
  <video controls preload="metadata" poster="…optional presigned…">
    <source src="…presigned-s3-url…" type="video/mp4" />
    Dein Browser kann dieses Video nicht abspielen.
  </video>
</figure>
<figcaption class="rn-caption" data-edit>Der Festumzug. <span class="rn-credit">Video: SV Motzing</span></figcaption>

<!-- YouTube (NUR youtube-nocookie — andere iframe-Hosts werden vom Renderer entfernt): -->
<div class="rn-video"><iframe src="https://www.youtube-nocookie.com/embed/<video-id>"
  allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
```

Regeln: `autoplay` ist verboten (wird entfernt); `video`/`source`-src nur `https:`;
Videos für News generieren → `comvenio news video` (Remotion, siehe unten).

### Videos generieren (`comvenio news video`, K7)

Rendert **lokal** per Remotion (Node + Chromium, `remotion/`-Unterprojekt — läuft NIEMALS im
Backend). Drei fixe Templates, parametrisiert über eine Zod-validierte `params.json` —
du schreibst KEINE eigenen Remotion-Kompositionen:

| Template | Inhalt | Pflicht-Params | Optional |
|----------|--------|----------------|----------|
| `slideshow` | Galerie-Slideshow, Ken-Burns + Overlays | `title`, `images[]` (min. 2 lokale Pfade), `brandColor` (#rrggbb) | `subtitle`, `overlays[]` (Länge = images), `durationPerImage` (2-10s, Default 4), `logoPath` |
| `result` | Ergebnis-Tafel | `homeTeam`, `awayTeam`, `homeScore`, `awayScore` (int >= 0), `brandColor` | `competition`, `scorers[]` („Name (Minute)"), `date` (ISO), `logoPath` |
| `teaser` | Ankündigungs-Teaser mit Countdown-Optik | `title`, `date` (ISO), `brandColor` | `location`, `ctaText`, `backgroundImage`, `logoPath` |

```bash
# 1. Bilder beschaffen (Galerie -> lokal): comvenio data download <file_id> --out ./bilder/…
# 2. params.json bauen (Club-Farben kennst du aus dem Kontext — kein Auto-Fetch)
# 3. Rendern (16:9, 1080p, H.264; Dauer: slideshow n*4s, result 12s, teaser 10s; --duration übersteuert):
comvenio news video slideshow --params params.json --out fest.mp4
# 4. Hochladen + Embed-Snippet bekommen (Limit 200 MB):
comvenio news video slideshow --params params.json --upload --context event --context-id <id> --json
# 5. Snippet in news.json einbetten -> news preview -> news apply
```

Erster Render lädt die Chrome-Headless-Shell (~110 MB, einmalig). Fehlen die Dependencies:
`cd remotion && npm install`.

## RBAC (serverseitig geprüft)

Dein Token trägt nur deine User-Rechte. Das CLI prüft **nichts** clientseitig —
ein fehlendes Recht ergibt 403 vom Service. Orientierung:

| Command (Beispiel)            | Permission-Key (serverseitig)        |
|-------------------------------|--------------------------------------|
| `member list/show`            | `view_members`                       |
| `member add/update/remove`    | `manage_members`                     |
| `event create`                | `create_events`                      |
| `event update/publish`, `area`| `manage_events`                      |
| `booking approve/reject`      | `confirm_object_bookings` (kein Owner-Bypass) |
| `task create`                 | `create_tasks`                       |
| `task assign/done`            | `manage_tasks`                       |
| `menu generate/apply/design`  | `create_menus`/`manage_menus`/`manage_club_settings` |
| `homepage generate/preview/apply` | `manage_club_settings`           |
| `news create/update/delete/apply/publish` | `manage_news` (schließt „Entwürfe sehen" ein) |
| `data upload` (Event) / `download` | kontextabhängig `write_files`/`manage_events`; Lesen: `read_files` bzw. public |

`member list/show`, `event list/show`, `booking list/show`, `object list`,
`task list/show`, `task context list` brauchen nur Clubmitgliedschaft bzw. einen
Visibility-Filter (kein dedizierter Key).

