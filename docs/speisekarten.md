---
id: speisekarten
kategorie: thema
domaenen: [recipe, ingredient, ingredient-category, shopping, template, menu]
stichwoerter: [speisekarte, menü, rezept, zutat, allergen, vorlage, einkaufsliste, gericht, getränk, kategorie]
---

# Speisekarten

## Wozu

Mit `recipe`, `ingredient`, `ingredient-category`, `shopping`, `template` und `menu` legst du Gerichte und Getränke deines Vereins als Rezepte an, gruppierst sie zu Speisekarten mit eigenem Namen, Preis und Design und leitest bei Bedarf Einkaufslisten daraus ab — inklusive korrekter Allergenkennzeichnung.

## Voraussetzungen und Rechte

> **Anmeldung:** Die Befehle dieses Artikels sind klassische Befehle. Sie laufen mit einer
> Anmeldung per Geräte-Token (`comvenio login --device-token <token>`). Mit der Browser-Anmeldung
> allein meldet das CLI `OAUTH_ONLY`; derselbe Zweck ist dann über die freigegebenen Actions
> erreichbar: `comvenio action list` zeigt sie, `comvenio help fehler OAUTH_ONLY` erklärt den Weg.

Anmeldung über `comvenio login`; ohne `--scopes` fordert sie alle Scopes an, `--scopes` schränkt sie ein. Zusätzlich prüft Comvenio serverseitig deine Rolle im Verein.

| Operation | Recht oder Regel |
|---|---|
| Gericht- und Zutaten-Vorlagen durchsuchen | Anmeldung genügt |
| Rezept aus Vorlage instanziieren, Ad-hoc-Rezept anlegen, Karte oder Karten-Eintrag anlegen | `manage_menus`, `create_menus` oder `manage_club_settings` |
| Rezept, Karte oder Eintrag ändern, löschen oder das Karten-Design setzen | `manage_menus`, `create_menus` oder `manage_club_settings` |
| Rezepte, Karten, Zutaten, Kategorien und Einkaufslisten lesen | allgemeines Leserecht auf Speisekarten-Daten |
| Zutaten, Kategorien und Einkaufslisten anlegen, ändern oder löschen | serverseitig geprüftes Verwaltungsrecht |
| Allergene, Farbstoffe und eine veröffentlichte Karte über den QR-Code lesen | ohne Anmeldung möglich |

Ein fehlendes Recht meldet `403`.

## Abläufe

### Das Modell dahinter

- Eine Speise ist ein Rezept, kein Karten-Eintrag: Ein Karten-Eintrag ohne verknüpftes Rezept ist nur ein Name-Preis-Etikett — ohne Allergene, ohne Kategorie und unsichtbar in der öffentlichen Artikel-Liste. Für eine rechtssichere Karte braucht jeder Eintrag ein Rezept.
- Allergene leben an der Zutat, nicht am Rezept. Das Rezept erbt sie transitiv über seine Zutaten — korrekt wird das, wenn die Zutaten gegen die Vorlagen matchen (siehe unten).
- Das Rezept ist die Wahrheit, der Karten-Eintrag die Darstellung: Dasselbe Rezept kann auf mehreren Karten mit unterschiedlichem Namen und Preis erscheinen — Rezept einmal anlegen, pro Karte einen Eintrag mit eigenem Label und Preis setzen.
- Mehrere Gebinde (z. B. Glas und Flasche desselben Getränks) sind Preisvarianten desselben Eintrags, keine doppelten Einträge — sie stehen strukturiert in `price_options`.
- Das CLI ruft für Rezepte und Karten kein eigenes Sprachmodell auf: Du (als Mensch oder Agent) komponierst Inhalt und Struktur selbst, das CLI speichert sie unverändert. Die früheren Befehle `menu generate` und `menu design` sind deshalb bewusst entfernt; sie brechen mit einer Erklärung ab. Karte und Design entstehen über `menu apply`, `menu create`, `menu add-item` beziehungsweise `menu style`.

### Vorlagen zuerst nutzen

1. Passende Gericht-Vorlage suchen: `comvenio template dish --search "Schnitzel" --json`.
2. Rezept daraus instanziieren, Preis optional überschreiben: `comvenio recipe from-template <template-id> --price 12 --json`. Die Antwort enthält `recipe_id`, `recipe_name`, `created_ingredients`, `missing_ingredients` und den Erfolgsstatus.
3. `from-template` matcht serverseitig auf Verein und Rezeptname — ein zweiter Aufruf mit demselben Namen liefert die bestehende `recipe_id` statt eines Duplikats.
4. Steht eine Zutat in `missing_ingredients`, hatte sie keinen Vorlagen-Match und wurde ohne Allergen angelegt. Bei wichtigen Allergenträgern (Mehl, Bier, Käse, Fisch, …) mit `comvenio template ingredient --search "<name>"` die exakte Vorlagen-Schreibweise prüfen — der Match ist case-insensitiv, aber nicht fuzzy.

### Ad-hoc-Rezept anlegen (wenn keine Vorlage passt)

1. Rezept mit Zutaten anlegen: `comvenio recipe create --name "Brezn" --type food --price 3.00 --category "Snacks" --ingredients "Laugenbreze:1:pc" --json`. Format von `--ingredients`: `"Name:Menge:Einheit,Name2:Menge2:Einheit2"`.
2. Zutaten-Vorlagen-Namen exakt treffen, damit die Allergene mit erben — vorher mit `comvenio template ingredient --search "<name>"` die Schreibweise prüfen.
3. Fehlende Zutaten werden beim Anlegen automatisch erzeugt.

### Karte bauen: erst prüfen, dann anlegen

1. Karte und Einträge als Datei komponieren (siehe Beispiele).
2. Schreibfrei prüfen: `comvenio menu preview --file menu.json --css weinfest.css --out .menu-preview --json`. Das prüft Pflichtfelder, Preise, `display_order` und alle Rezept-Verknüpfungen, lädt dabei auch die verknüpften Rezeptdaten zu Kategorie, Beschreibung, Altersfreigabe, Allergenen und Farbstoffen und erzeugt lokal einen Datenbericht, eine responsive HTML-/PNG-Ansicht und ein DIN-A4-PDF, ohne etwas zu schreiben.
3. Ein `valid: false` ist ein bewusst sichtbares Review-Ergebnis; die Artefakte entstehen trotzdem, damit der Fehler im Zusammenhang beurteilt werden kann.
4. Erst danach anlegen: `comvenio menu apply --file menu.json --json` (legt Karte und Einträge im Bulk an).

### Karte direkt zusammenstellen und Rezepte wiederverwenden

1. Karte anlegen: `comvenio menu create --name "Grillbude – Dorfabend" --category "Fest" --json`.
2. Rezept einmal anlegen oder aus Vorlage instanziieren, danach auf beliebig vielen Karten referenzieren: `comvenio menu add-item <menu-id> --recipe <recipe-id> --name "Helles Bier" --price 4.50 --json`. Name und Preis sind pro Karte überschreibbar; das Rezept (inklusive Allergene) bleibt die einzige Quelle.
3. Bestehenden Eintrag über seine Eintrags-ID ändern statt neu anzulegen: `comvenio menu update-item <menu-item-id> --name "..." --price-options '[...]' --json`. Das erhält die Identität des Eintrags und legt weder einen zweiten Eintrag noch ein neues Rezept an.
4. Ein Produkt mit mehreren Ausgaben (z. B. Glas/Flasche) bleibt ein Eintrag mit mehreren `price_options`, kein zweiter Eintrag.
5. Nicht pro Karte ein neues Rezept für dasselbe Gericht anlegen — das erzeugt Duplikate.

### Club-Zutaten und Kategorien pflegen

1. Zutat anlegen: `comvenio ingredient create --file ingredient.json --json` (Pflichtfelder: `name`, `unit`).
2. Zutaten suchen und lesen: `comvenio ingredient list --search "Kartoffel" --category <category-id> --json`, `comvenio ingredient show <ingredient-id> --json`. `--category` schließt Unterkategorien ein; `--skip` und `--limit` (1–1000) steuern die Liste.
3. Kategorienbaum lesen und zuordnen: `comvenio ingredient-category tree --json`, `comvenio ingredient-category assign <ingredient-id> --category <category-id> --json`.
4. Eigene Kategorie anlegen: `comvenio ingredient-category create --file category.json --json` (Pflichtfelder: `name`, `category_type`; optional unter anderem `description`, `parent_id`, `icon`, `color` und `sort_order`). `comvenio ingredient-category init --json` legt Standardkategorien an und ist nur für Vereine ohne vorhandene gedacht — sonst antwortet er mit einem Konflikt.

### Einkaufslisten führen

1. Liste anlegen: `comvenio shopping create --file shopping-list.json --json` mit `context_type` (`club`, `event`, `object`, `meeting`) und Status `draft`, `active`, `completed` oder `cancelled`.
2. Position hinzufügen: `comvenio shopping item-add <list-id> --file item.json --json`. Eine Position braucht `quantity`, `unit` und entweder `ingredient_id` oder einen nicht leeren `name`.
3. Als erledigt markieren: `comvenio shopping purchased <item-id> --purchased true --json`.
4. Deterministisch aus vorhandenen Daten erzeugen: `comvenio shopping generate-from-recipe <recipe-id> --portions 80 --name "Einkauf Grillteller" --json` oder `comvenio shopping generate-from-menu <menu-id> --name "Einkauf Festkarte" --json`.

### Karte stylen

1. Freies CSS setzen: `comvenio menu style <menu_id> --css ./meine-karte.css`.
2. Das CSS wird im Frontend isoliert in den Karten-Container injiziert (kein Ausbruch aus dem Container) und targetet semantische Klassen wie `.menu-card`, `.menu-title`, `.menu-category-header`, `.menu-item`, `.menu-item-name`, `.menu-item-price`, `.menu-qr`.
3. Allergene, Preise und der QR-Code bleiben strukturierte Pflicht-Komponenten — das CSS stylt nur ihr Aussehen.
4. `style` liest den aktuellen Stand, merged dein CSS hinein und schreibt zurück; andere Design-Einstellungen der Karte bleiben erhalten.
5. Der Inhalt des CSS wird nicht inhaltlich geprüft — für gültiges, wirksames CSS bist du selbst verantwortlich.

## Beispiele

Zutat anlegen:

```json
{
  "name": "Bio-Kartoffeln",
  "description": "Festkochend",
  "unit": "kg",
  "cost_per_unit": 2.4,
  "supplier": "Hof Muster",
  "allergen_ids": [],
  "colorant_ids": [],
  "category_ids": ["<category-id>"]
}
```

```bash
comvenio ingredient create --file ingredient.json --json
```

Kategorie anlegen (Kategorie-Typen: `main`, `food_type`, `meat_type`, `dietary`, `origin`, `custom`):

```bash
comvenio ingredient-category create --file category.json --json
comvenio ingredient-category update <category-id> --file category.json --json
comvenio ingredient-category delete <category-id> --json       # weiches Löschen
comvenio ingredient-category delete <category-id> --hard --json
```

Ein Produkt mit mehreren Ausgaben — `selling_price` bleibt als Grundpreis erhalten, `price_options` bildet die einzelnen Ausgaben ab:

```json
{
  "recipe_id": "<riesling-recipe-id>",
  "name": "Riesling Nahe trocken",
  "selling_price": 4.20,
  "price_options": [
    {"label": "0,2 l", "price": 4.20},
    {"label": "Flasche", "price": 15.60}
  ]
}
```

```bash
comvenio menu add-item <menu-id> --recipe <riesling-recipe-id> \
  --name "Riesling Nahe trocken" --price 4.20 \
  --price-options '[{"label":"0,2 l","price":4.20},{"label":"Flasche","price":15.60}]' --json
```

Einkaufsliste anlegen:

```json
{
  "name": "Einkauf Sommerfest",
  "description": "Grillbude und Getränkestand",
  "context_type": "event",
  "context_id": "<event-id>",
  "status": "draft",
  "items": []
}
```

Einkaufsposition:

```json
{
  "ingredient_id": "<ingredient-id>",
  "quantity": 20,
  "unit": "kg",
  "estimated_cost": 48,
  "notes": "Festkochend"
}
```

Vollständiges Beispiel — eine Grillbuden-Karte von den Rezepten bis zur fertigen Karte:

```bash
# Rezepte einmalig anlegen (mit Allergenen)
STEAK=$(comvenio recipe from-template <steaksemmel-template-id> --name "Steaksemmel" --price 4.50 --json | jq -r .recipe_id)
BRAT=$(comvenio recipe from-template <bratwurstsemmel-template-id> --name "Bratwurstsemmel" --price 4.50 --json | jq -r .recipe_id)
KAAS=$(comvenio recipe create --name "Käse" --type food --price 3.40 --ingredients "Gouda Käse:0.1:kg" --json | jq -r .id)

# Karte anlegen
MENU=$(comvenio menu create --name "Grillbude – Sporttag" --category "Fest" --json | jq -r .id)

# Einträge setzen (Rezept-Wiederverwendung, Label/Preis pro Karte)
comvenio menu add-item $MENU --recipe $STEAK --name "Steaksemmel" --price 4.50 --json
comvenio menu add-item $MENU --recipe $BRAT --name "Bratwurstsemmel" --price 4.50 --json
comvenio menu add-item $MENU --recipe $KAAS --name "Kaas (100 g)" --price 3.40 --json

# Optional stylen und prüfen
comvenio menu style $MENU --css ./festkarte.css
comvenio menu show $MENU --json
```

### Enums

| Enum | Werte |
|---|---|
| Einheit | `gr`, `kg`, `ml`, `l`, `pc`, `portion`, `tsp`, `tbsp`, `cup`, `pinch` |
| Rezepttyp | `food`, `drink` |
| Altersgruppe | `none`, `teen` (16+), `adult` (18+) |
| Allergene (14 EU-Allergene) | `gluten`, `crustaceans`, `eggs`, `fish`, `peanuts`, `soy`, `lactose`, `nuts`, `celery`, `mustard`, `sesame`, `sulfites`, `lupin`, `molluscs` |

Die Einheiten heißen `gr`, `pc` und `portion` — nicht `g`, `piece` oder `serving`.

### Wichtige Regeln

- Ein Karten-Eintrag ohne Rezept fehlt in der öffentlichen Artikel-Liste, weil diese zwingend mit dem Rezept verknüpft — für QR-Karten immer ein Rezept hinterlegen.
- Der Karten-Preis überschreibt den Rezept-Grundpreis pro Karte; ohne eigenen Preis gilt der Rezept-Standard. Mehrere Gebinde gehören in `price_options`, nicht in getrennte Einträge. Das Sortierfeld heißt `display_order`.
- Für bestehende Karten-Einträge immer deren Eintrags-ID an `menu update-item` übergeben; `menu add-item` und `menu apply` legen neue Einträge an.
- Allergene entstehen nur über Zutaten-Namen, die eine Vorlage treffen. Eine frei erfundene Zutat ohne Vorlagen-Match bekommt kein Allergen.
- `custom_css` lässt sich nur über `menu style` (bzw. ein Karten-Update) setzen, nicht beim Anlegen der Karte.
- Eine QR-Grafik oder -URL erzeugt nicht das CLI, sondern das Frontend aus den öffentlichen Karten-Daten.

### Weitere Lese- und Verwaltungsbefehle

- Rezepte verwalten: `comvenio recipe list|show|update|delete`.
- Zutaten verwalten: `comvenio ingredient list|show|update|delete`.
- Kategorien lesen und zuordnen: `comvenio ingredient-category list|roots|tree|by-ingredient|unassign`.
- Einkaufslisten lesen: `comvenio shopping list --status draft`, `comvenio shopping active`, `comvenio shopping completed`, `comvenio shopping by-context --context-id <event-id>`, `comvenio shopping by-context-type --context-type event`, `comvenio shopping show <list-id>`.
- Einkaufsliste ändern oder löschen: `comvenio shopping update <list-id> --file shopping-list.json --json`, `comvenio shopping delete <list-id> --json`.
- Einkaufsposition ändern oder löschen: `comvenio shopping item-update <item-id> --file item.json --json`, `comvenio shopping item-delete <item-id> --json`.
- Karte verwalten: `comvenio menu list|show|delete`, `comvenio menu delete-item <item-id>`, `comvenio menu export <menu-id> [--out]`.

## Befehle und Actions

<!-- gen:docs befehle -->

**recipe** — vollständig

- `comvenio recipe create`
- `comvenio recipe from-template`
- `comvenio recipe list`
- `comvenio recipe show`
- `comvenio recipe update`
- `comvenio recipe delete`

**ingredient** — vollständig

- `comvenio ingredient list`
- `comvenio ingredient show`
- `comvenio ingredient create`
- `comvenio ingredient update`
- `comvenio ingredient delete`
- Felder und Werte: `comvenio schema ingredient --json`

**ingredient-category** — vollständig

- `comvenio ingredient-category list`
- `comvenio ingredient-category roots`
- `comvenio ingredient-category tree`
- `comvenio ingredient-category by-ingredient`
- `comvenio ingredient-category show`
- `comvenio ingredient-category create`
- `comvenio ingredient-category update`
- `comvenio ingredient-category delete`
- `comvenio ingredient-category assign`
- `comvenio ingredient-category unassign`
- `comvenio ingredient-category init`
- Felder und Werte: `comvenio schema ingredient-category --json`

**shopping** — vollständig

- `comvenio shopping list`
- `comvenio shopping active`
- `comvenio shopping completed`
- `comvenio shopping by-context`
- `comvenio shopping by-context-type`
- `comvenio shopping show`
- `comvenio shopping create`
- `comvenio shopping update`
- `comvenio shopping delete`
- `comvenio shopping item-add`
- `comvenio shopping item-update`
- `comvenio shopping item-delete`
- `comvenio shopping purchased`
- `comvenio shopping generate-from-recipe`
- `comvenio shopping generate-from-menu`
- Felder und Werte: `comvenio schema shopping --json`

**template** — vollständig

- `comvenio template dish`
- `comvenio template ingredient`

**menu** — vollständig

- `comvenio menu create`
- `comvenio menu list`
- `comvenio menu show`
- `comvenio menu add-item`
- `comvenio menu update-item`
- `comvenio menu delete-item`
- `comvenio menu delete`
- `comvenio menu style`
- `comvenio menu apply`
- `comvenio menu export`
- Felder und Werte: `comvenio schema menu --json`
<!-- /gen:docs -->

## Fehler

- `AUTH_REQUIRED` — deine Anmeldung ist abgelaufen oder fehlt, bevor ein Rezept-, Zutaten- oder Karten-Befehl läuft. Siehe `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — die Anmeldung trägt nicht den nötigen Scope für diese Aktion. Siehe `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — deine Rolle im Verein erlaubt zum Beispiel `manage_menus` oder `create_menus` nicht. Siehe `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — Rezept, Zutat, Kategorie, Einkaufsliste oder Karte existiert nicht oder gehört zu einem anderen Verein. Siehe `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — ein Pflichtfeld fehlt, etwa `name`/`unit` bei einer Zutat oder `quantity`/`unit` bei einer Einkaufsposition. Siehe `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — zum Beispiel `ingredient-category init` bei bereits vorhandenen Standardkategorien. Siehe `comvenio help fehler CONFLICT`.
- `USAGE_ERROR` — etwa `--ingredients` nicht im Format `Name:Menge:Einheit`. Siehe `comvenio help fehler USAGE_ERROR`.
