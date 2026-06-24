# comvenio CLI — Agent Guide

> Diese Datei liest der bedienende KI-Agent (Claude Code / Codex) automatisch.
> Sie beschreibt die Domänensprache des `comvenio`-CLI, damit du die gültigen
> Felder/Enums/Widget-Typen **kennst statt rätst**. Zur Laufzeit liefert
> `comvenio schema <domain> --json` die maschinenlesbaren Details.

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
comvenio whoami                       # zeigt Name + Club + Umgebung
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
| event    | `comvenio event list\|show\|create\|update\|publish` · `event area list\|add <event-id>` |
| booking  | `comvenio booking list\|show\|approve\|reject`                |
| object   | `comvenio object list [--type static\|portable\|event]`       |
| task     | `comvenio task list\|show\|create\|assign\|done` · `task context list\|create` |
| template | `comvenio template dish\|ingredient [--search\|--category\|--common]` (globale Vorlagen) |
| recipe   | `comvenio recipe from-template\|create\|list\|show\|update\|delete` (Gerichte/Getränke) |
| menu     | `comvenio menu create\|list\|show\|add-item\|delete\|style` · `menu generate\|apply\|design` (KI) |
| homepage | `comvenio homepage generate\|preview\|apply\|show\|design`     |
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

`member list/show`, `event list/show`, `booking list/show`, `object list`,
`task list/show`, `task context list` brauchen nur Clubmitgliedschaft bzw. einen
Visibility-Filter (kein dedizierter Key).
