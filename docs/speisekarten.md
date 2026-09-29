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

Anmeldung mit `comvenio login`; welche Actions dein Verein freigibt und welche Scopes sie brauchen, zeigt `comvenio action list --json`. Zusätzlich prüft Comvenio serverseitig deine Rolle im Verein.

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
- Das CLI ruft für Rezepte und Karten kein eigenes Sprachmodell auf: Du (als Mensch oder Agent) komponierst Inhalt und Struktur selbst, die Action speichert sie unverändert.

### Vorlagen zuerst nutzen

1. Passende Gericht-Vorlage suchen: `comvenio action call cai.template.01.dish --input '{"operation":"list","search":"Schnitzel","limit":20}'`.
2. Rezept daraus instanziieren (kritisch — erst Vorschau, dann Bestätigung): `comvenio action call cai.recipe.02.from_template --input '{"template_id":"<template-id>","custom_price":12}'`, danach `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>`. Die Antwort enthält `recipe_id`, `recipe_name`, `created_ingredients`, `missing_ingredients` und den Erfolgsstatus.
3. `from-template` matcht serverseitig auf Verein und Rezeptname — ein zweiter Aufruf mit demselben Namen liefert die bestehende `recipe_id` statt eines Duplikats.
4. Steht eine Zutat in `missing_ingredients`, hatte sie keinen Vorlagen-Match und wurde ohne Allergen angelegt. Bei wichtigen Allergenträgern (Mehl, Bier, Käse, Fisch, …) mit `comvenio action call cai.template.02.ingredient --input '{"operation":"list","search":"<name>"}'` die exakte Vorlagen-Schreibweise prüfen — der Match ist case-insensitiv, aber nicht fuzzy.

### Ad-hoc-Rezept anlegen (wenn keine Vorlage passt)

1. Rezept mit Zutaten anlegen (kritisch — erst Vorschau, dann Bestätigung): `comvenio action call cai.recipe.01.create --input '{"name":"Brezn","type_of_recipe":"food","category":"Snacks","selling_price":3.00,"ingredients":[{"name":"Laugenbreze","quantity":1,"unit":"pc"}]}'`, danach `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>`. `ingredients` ist ein Array aus `{"name","quantity","unit"}`, kein Textformat mehr.
2. Zutaten-Vorlagen-Namen exakt treffen, damit die Allergene mit erben — vorher mit `comvenio action call cai.template.02.ingredient --input '{"operation":"list","search":"<name>"}'` die Schreibweise prüfen.
3. Fehlende Zutaten werden beim Anlegen automatisch erzeugt (`auto_create_missing_ingredients`, Voreinstellung an).

### Karte bauen: erst prüfen, dann anlegen

1. Karte und Einträge als ein Objekt komponieren (siehe Beispiele).
2. `apply` ist kritisch: Der erste Aufruf ohne Bestätigung ist bereits die Prüfung — `comvenio action call cai.menu.09.apply --input '{"menu": {…}}'` prüft Pflichtfelder, Preise, `display_order` und alle Rezept-Verknüpfungen serverseitig, ohne etwas zu schreiben, und liefert eine Vorschau mit `preview_id` und `confirmation_token`.
3. Vorschau prüfen; erst danach legt `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>` Karte und Einträge im Bulk an.

### Karte direkt zusammenstellen und Rezepte wiederverwenden

1. Karte anlegen: `comvenio action call cai.menu.01.create --input '{"menu":{"name":"Grillbude – Dorfabend","category":"Fest"}}'`.
2. Rezept einmal anlegen oder aus Vorlage instanziieren, danach auf beliebig vielen Karten referenzieren: `comvenio action call cai.menu.04.add_item --input '{"menu_id":"<menu-id>","item":{"recipe_id":"<recipe-id>","name":"Helles Bier","selling_price":4.50}}'`. Name und Preis sind pro Karte überschreibbar; das Rezept (inklusive Allergene) bleibt die einzige Quelle.
3. Bestehenden Eintrag über seine Eintrags-ID ändern statt neu anzulegen: `comvenio action call cai.menu.05.update_item --input '{"item_id":"<menu-item-id>","changes":{"name":"…","price_options":[…]}}'`. Das erhält die Identität des Eintrags und legt weder einen zweiten Eintrag noch ein neues Rezept an.
4. Ein Produkt mit mehreren Ausgaben (z. B. Glas/Flasche) bleibt ein Eintrag mit mehreren `price_options`, kein zweiter Eintrag.
5. Nicht pro Karte ein neues Rezept für dasselbe Gericht anlegen — das erzeugt Duplikate.

### Club-Zutaten und Kategorien pflegen

1. Zutat anlegen: `comvenio action call cai.ingredient.03.create --input '{"ingredient":{"name":"Bio-Kartoffeln","unit":"kg","cost_per_unit":2.4,"supplier":"Hof Muster","category_ids":["<category-id>"]}}'` (Pflichtfelder im `ingredient`-Objekt: `name`, `unit`).
2. Zutaten suchen und lesen: `comvenio action call cai.ingredient.01.list --input '{"search":"Kartoffel","category_id":"<category-id>","limit":20,"offset":0}'`, `comvenio action call cai.ingredient.02.show --input '{"ingredient_id":"<ingredient-id>"}'`. `limit` (1–100) und `offset` steuern die Liste.
3. Kategorienbaum lesen und zuordnen: `comvenio action call cai.ingredient-category.03.tree --input '{}'`, `comvenio action call cai.ingredient-category.09.assign --input '{"ingredient_id":"<ingredient-id>","category_id":"<category-id>"}'`.
4. Eigene Kategorie anlegen: `comvenio action call cai.ingredient-category.06.create --input '{"category":{"name":"Vegan","category_type":"dietary"}}'` (Pflichtfelder im `category`-Objekt: `name`, `category_type`; optional unter anderem `description`, `parent_id`, `icon`, `color` und `sort_order`). `comvenio action call cai.ingredient-category.11.init --input '{"acknowledge_defaults":true}'` legt nach Bestätigung Standardkategorien an und ist nur für Vereine ohne vorhandene gedacht — sonst antwortet die Action mit einem Konflikt.

### Einkaufslisten führen

1. Liste anlegen: `comvenio action call cai.shopping.07.create --input '{"shopping_list":{"name":"Einkauf Sommerfest","description":"Grillbude und Getränkestand","context_type":"event","context_id":"<event-id>","status":"draft"}}'` mit `context_type` (`club`, `event`, `object`, `meeting`) und Status `draft`, `active`, `completed` oder `cancelled`.
2. Position hinzufügen: `comvenio action call cai.shopping.10.item_add --input '{"shopping_list_id":"<list-id>","item":{"ingredient_id":"<ingredient-id>","quantity":20,"unit":"kg","estimated_cost":48,"notes":"Festkochend"}}'`. Eine Position braucht `quantity`, `unit` und entweder `ingredient_id` oder einen nicht leeren `name`.
3. Als erledigt markieren: `comvenio action call cai.shopping.13.purchased --input '{"item_id":"<item-id>","purchased":true}'`.
4. Deterministisch aus vorhandenen Daten erzeugen: `comvenio action call cai.shopping.14.generate_from_recipe --input '{"recipe_id":"<recipe-id>","portions":80,"name":"Einkauf Grillteller","output_format":"pdf"}'` oder `comvenio action call cai.shopping.15.generate_from_menu --input '{"menu_id":"<menu-id>","name":"Einkauf Festkarte","output_format":"pdf"}'`.

### Karte stylen

1. Design setzen: `comvenio action call cai.menu.08.style --input '{"menu_id":"<menu-id>","design":{"background":"#ffffff","textColor":"#1a1a1a","accentColor":"#7c3aed","showPrices":true,"showAllergens":true}}'`. Das `design`-Objekt trägt benannte Felder für Farben, Schrift, Spalten, Logo, QR-Code und Wasserzeichen — kein freies CSS mehr als alleiniger Weg.
2. Zusätzliches freies CSS bleibt über das Feld `custom_css` im selben `design`-Objekt möglich, wird aber auf unsichere Muster geprüft: `@import`, `javascript:`, `expression()`, `behavior:` sowie eingebettete `<style>`- oder `<script>`-Tags lehnt die Action ab.
3. Allergene, Preise und der QR-Code bleiben strukturierte Pflicht-Komponenten und stammen weiterhin aus Rezept und Eintrag — die Design-Felder (`showPrices`, `showAllergens`, `showColorants`, `showQr`, …) steuern nur, ob sie angezeigt werden, nicht ihren Inhalt.
4. Design lässt sich auch direkt beim Anlegen setzen: `cai.menu.09.apply` nimmt im `menu`-Objekt zusätzlich `design_config` entgegen; die einfache `cai.menu.01.create` kennt kein Design-Feld — dafür danach `menu style` verwenden.
5. Der Inhalt des freien CSS wird nur auf die genannten unsicheren Muster geprüft, nicht inhaltlich validiert — für gültiges, wirksames CSS bist du selbst verantwortlich.

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
comvenio action call cai.ingredient.03.create --input '{"ingredient": <obiges Objekt>}'
```

Kategorie anlegen, ändern, löschen (Kategorie-Typen: `main`, `food_type`, `meat_type`, `dietary`, `origin`, `custom`):

```bash
comvenio action call cai.ingredient-category.06.create --input '{"category":{"name":"Vegan","category_type":"dietary"}}'
comvenio action call cai.ingredient-category.07.update --input '{"category_id":"<category-id>","changes":{"description":"Ohne tierische Zutaten"}}'
comvenio action call cai.ingredient-category.08.delete --input '{"category_id":"<category-id>"}'
```

Ein Produkt mit mehreren Ausgaben — `selling_price` bleibt als Grundpreis erhalten, `price_options` bildet die einzelnen Ausgaben ab:

```json
{
  "item_id": "<riesling-item-id>",
  "changes": {
    "name": "Riesling Nahe trocken",
    "selling_price": 4.20,
    "price_options": [
      {"label": "0,2 l", "price": 4.20},
      {"label": "Flasche", "price": 15.60}
    ]
  }
}
```

```bash
comvenio action call cai.menu.05.update_item --input '<obiges Objekt>'
```

Einkaufsliste anlegen:

```json
{
  "name": "Einkauf Sommerfest",
  "description": "Grillbude und Getränkestand",
  "context_type": "event",
  "context_id": "<event-id>",
  "status": "draft"
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

Vollständiges Beispiel — eine Grillbuden-Karte von den Rezepten bis zur fertigen Karte (`$( … )` liest jeweils die Kennung aus der bestätigten Antwort):

```bash
# Rezepte einmalig anlegen (mit Allergenen) — recipe.from-template und recipe.create sind kritisch
comvenio action call cai.recipe.02.from_template --input '{"template_id":"<steaksemmel-template-id>","custom_name":"Steaksemmel","custom_price":4.50}'
comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>
STEAK=<recipe_id aus der Antwort>

comvenio action call cai.recipe.01.create --input '{"name":"Käse","type_of_recipe":"food","selling_price":3.40,"ingredients":[{"name":"Gouda Käse","quantity":0.1,"unit":"kg"}]}'
comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>
KAAS=<recipe_id aus der Antwort>

# Karte anlegen
comvenio action call cai.menu.01.create --input '{"menu":{"name":"Grillbude – Sporttag","category":"Fest"}}'
MENU=<id aus der Antwort>

# Einträge setzen (Rezept-Wiederverwendung, Label/Preis pro Karte)
comvenio action call cai.menu.04.add_item --input "{\"menu_id\":\"$MENU\",\"item\":{\"recipe_id\":\"$STEAK\",\"name\":\"Steaksemmel\",\"selling_price\":4.50}}"
comvenio action call cai.menu.04.add_item --input "{\"menu_id\":\"$MENU\",\"item\":{\"recipe_id\":\"$KAAS\",\"name\":\"Kaas (100 g)\",\"selling_price\":3.40}}"

# Optional stylen und prüfen
comvenio action call cai.menu.08.style --input "{\"menu_id\":\"$MENU\",\"design\":{\"accentColor\":\"#7c3aed\"}}"
comvenio action call cai.menu.03.show --input "{\"menu_id\":\"$MENU\"}"
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
- Für bestehende Karten-Einträge immer deren Eintrags-ID an `cai.menu.05.update_item` übergeben; `cai.menu.04.add_item` und `cai.menu.09.apply` legen neue Einträge an.
- Allergene entstehen nur über Zutaten-Namen, die eine Vorlage treffen. Eine frei erfundene Zutat ohne Vorlagen-Match bekommt kein Allergen.
- Design lässt sich beim Bulk-Anlegen über `cai.menu.09.apply` (`design_config`) oder danach über `cai.menu.08.style` (`design`) setzen, nicht beim einfachen `cai.menu.01.create`.
- Eine QR-Grafik oder -URL erzeugt nicht die Action, sondern das Frontend aus den öffentlichen Karten-Daten.
- `recipe.create` und `recipe.from-template` sind `critical_write`: Der Aufruf ohne Bestätigung liefert nur die Vorschau, das Rezept entsteht erst mit `action confirm`.

### Weitere Lese- und Verwaltungsbefehle

- Rezepte verwalten: `cai.recipe.03.list`, `cai.recipe.04.show`, `cai.recipe.05.update`, `cai.recipe.06.delete` (Löschen kritisch).
- Zutaten verwalten: `cai.ingredient.01.list`, `cai.ingredient.02.show`, `cai.ingredient.04.update`, `cai.ingredient.05.delete` (Löschen kritisch).
- Kategorien lesen und zuordnen: `cai.ingredient-category.01.list`, `.02.roots`, `.03.tree`, `.04.by_ingredient`, `.10.unassign` (Entfernen kritisch).
- Einkaufslisten lesen: `cai.shopping.01.list`, `.02.active`, `.03.completed`, `.04.by_context`, `.05.by_context_type`, `.06.show` (`operation=show`).
- Einkaufsliste ändern, löschen oder als PDF/CSV exportieren: `cai.shopping.08.update`, `cai.shopping.09.delete` (kritisch), `cai.shopping.06.show` (`operation=export`).
- Einkaufsposition ändern oder löschen: `cai.shopping.11.item_update`, `cai.shopping.12.item_delete` (kritisch).
- Karte verwalten: `cai.menu.02.list`, `cai.menu.03.show`, `cai.menu.07.delete` (kritisch), `cai.menu.06.delete_item` (kritisch), `cai.menu.10.export`.

## Befehle und Actions

<!-- gen:docs befehle -->

**recipe**

- `cai.recipe.01.create` — create (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.recipe.02.from_template` — create (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.recipe.03.list` — list (lesen) · Scopes: `supply.read`
- `cai.recipe.04.show` — show (lesen) · Scopes: `supply.read`
- `cai.recipe.05.update` — update (ändern) · Scopes: `supply.write`
- `cai.recipe.06.delete` — delete (ändern mit Bestätigung) · Scopes: `supply.write`

**ingredient**

- `cai.ingredient.01.list` — list (lesen) · Scopes: `supply.read`
- `cai.ingredient.02.show` — show (lesen) · Scopes: `supply.read`
- `cai.ingredient.03.create` — create (ändern) · Scopes: `supply.write`
- `cai.ingredient.04.update` — update (ändern) · Scopes: `supply.write`
- `cai.ingredient.05.delete` — delete (ändern mit Bestätigung) · Scopes: `supply.write`
- Felder und Werte: `comvenio schema ingredient --json` (`club_id` setzt die Anmeldung — nie in `--input`)

**ingredient-category**

- `cai.ingredient-category.01.list` — list (lesen) · Scopes: `supply.read`
- `cai.ingredient-category.02.roots` — roots (lesen) · Scopes: `supply.read`
- `cai.ingredient-category.03.tree` — tree (lesen) · Scopes: `supply.read`
- `cai.ingredient-category.04.by_ingredient` — list (lesen) · Scopes: `supply.read`
- `cai.ingredient-category.05.show` — show (lesen) · Scopes: `supply.read`
- `cai.ingredient-category.06.create` — create (ändern) · Scopes: `supply.write`
- `cai.ingredient-category.07.update` — update (ändern) · Scopes: `supply.write`
- `cai.ingredient-category.08.delete` — delete (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.ingredient-category.09.assign` — assign (ändern) · Scopes: `supply.write`
- `cai.ingredient-category.10.unassign` — unassign (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.ingredient-category.11.init` — initialize (ändern mit Bestätigung) · Scopes: `supply.write`
- Felder und Werte: `comvenio schema ingredient-category --json` (`club_id` setzt die Anmeldung — nie in `--input`)

**shopping**

- `cai.shopping.01.list` — list (lesen) · Scopes: `supply.read`
- `cai.shopping.02.active` — list (lesen) · Scopes: `supply.read`
- `cai.shopping.03.completed` — list (lesen) · Scopes: `supply.read`
- `cai.shopping.04.by_context` — list (lesen) · Scopes: `supply.read`
- `cai.shopping.05.by_context_type` — list (lesen) · Scopes: `supply.read`
- `cai.shopping.06.show` — show, export (lesen, ändern) · Scopes: `supply.read`, `files.export`
- `cai.shopping.07.create` — create (ändern) · Scopes: `supply.write`
- `cai.shopping.08.update` — update (ändern) · Scopes: `supply.write`
- `cai.shopping.09.delete` — delete (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.shopping.10.item_add` — add (ändern) · Scopes: `supply.write`
- `cai.shopping.11.item_update` — update (ändern) · Scopes: `supply.write`
- `cai.shopping.12.item_delete` — delete (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.shopping.13.purchased` — set (ändern) · Scopes: `supply.write`
- `cai.shopping.14.generate_from_recipe` — generate (ändern) · Scopes: `supply.write`, `files.export`
- `cai.shopping.15.generate_from_menu` — generate (ändern) · Scopes: `supply.write`, `files.export`
- `cai.shopping.procurement.activate` — activate (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.shopping.procurement.add` — add (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.shopping.procurement.list` — list (lesen) · Scopes: `club.read`
- `cai.shopping.procurement.purchase` — purchase (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.shopping.procurement.template_create` — create (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.shopping.procurement.template_deactivate` — deactivate (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.shopping.procurement.template_update` — update (ändern mit Bestätigung) · Scopes: `club.write`
- `cai.shopping.procurement.templates` — list (lesen) · Scopes: `club.read`
- Felder und Werte: `comvenio schema shopping --json` (`club_id` setzt die Anmeldung — nie in `--input`)

**template**

- `cai.template.01.dish` — list, show (lesen) · Scopes: `supply.read`
- `cai.template.02.ingredient` — list, show (lesen) · Scopes: `supply.read`

**menu**

- `cai.menu.01.create` — create (ändern) · Scopes: `supply.write`
- `cai.menu.02.list` — list (lesen) · Scopes: `supply.read`
- `cai.menu.03.show` — show (lesen) · Scopes: `supply.read`
- `cai.menu.04.add_item` — add (ändern) · Scopes: `supply.write`
- `cai.menu.05.update_item` — update (ändern) · Scopes: `supply.write`
- `cai.menu.06.delete_item` — delete (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.menu.07.delete` — delete (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.menu.08.style` — style (ändern) · Scopes: `supply.write`
- `cai.menu.09.apply` — apply (ändern mit Bestätigung) · Scopes: `supply.write`
- `cai.menu.10.export` — export (ändern) · Scopes: `supply.read`, `files.export`
- Felder und Werte: `comvenio schema menu --json` (`club_id` setzt die Anmeldung — nie in `--input`)
<!-- /gen:docs -->

## Fehler

- `AUTH_REQUIRED` — deine Anmeldung ist abgelaufen oder fehlt, bevor eine Rezept-, Zutaten- oder Karten-Action läuft. Siehe `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — die Anmeldung trägt nicht den nötigen Scope für diese Action. Siehe `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — deine Rolle im Verein erlaubt zum Beispiel `manage_menus` oder `create_menus` nicht. Siehe `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — Rezept, Zutat, Kategorie, Einkaufsliste oder Karte existiert nicht oder gehört zu einem anderen Verein. Siehe `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — ein Pflichtfeld fehlt, etwa `name`/`unit` bei einer Zutat oder `quantity`/`unit` bei einer Einkaufsposition. Siehe `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — zum Beispiel `ingredient-category init` bei bereits vorhandenen Standardkategorien. Siehe `comvenio help fehler CONFLICT`.
- `CONFIRMATION_REQUIRED` — eine kritische Action wie `recipe.create`, `recipe.from-template` oder `menu.apply` braucht zuerst `comvenio action confirm` mit der Vorschau. Siehe `comvenio help fehler CONFIRMATION_REQUIRED`.
- `OUTCOME_UNKNOWN` — eine schreibende Action hat nach der Bestätigung nicht rechtzeitig geantwortet; Stand prüfen statt wiederholen. Siehe `comvenio help fehler OUTCOME_UNKNOWN`.
