---
id: speisekarten
kategorie: thema
domaenen: [recipe, ingredient, ingredient-category, shopping, template, menu]
stichwoerter: [menu, recipe, ingredient, allergen, template, shopping-list, dish, drink, category]
---

# Menus

## Purpose

With `recipe`, `ingredient`, `ingredient-category`, `shopping`, `template` and `menu` you create your club's dishes and drinks as recipes, group them into menus with their own name, price and design, and derive shopping lists from them when needed — including correct allergen labeling.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club has enabled and which scopes they need is shown by `comvenio action list --json`. Comvenio additionally checks your role in the club server-side.

| Operation | Permission or rule |
|---|---|
| Search dish and ingredient templates | Being signed in is enough |
| Instantiate a recipe from a template, create an ad-hoc recipe, create a menu or menu item | `manage_menus`, `create_menus` or `manage_club_settings` |
| Change or delete a recipe, menu or item, or set the menu design | `manage_menus`, `create_menus` or `manage_club_settings` |
| Read recipes, menus, ingredients, categories and shopping lists | general read permission on menu data |
| Create, change or delete ingredients, categories and shopping lists | server-checked management permission |
| Read allergens, colorants and a published menu via its QR code | possible without signing in |

A missing permission is reported as `403`.

## Workflows

### The model behind it

- A dish is a recipe, not a menu item: a menu item without a linked recipe is just a name-and-price label — no allergens, no category, and invisible in the public item list. For a legally sound menu every item needs a recipe.
- Allergens live on the ingredient, not on the recipe. The recipe inherits them transitively through its ingredients — that only becomes correct once the ingredients match the templates (see below).
- The recipe is the source of truth, the menu item is the presentation: the same recipe can appear on several menus with a different name and price — create the recipe once, then set an item with its own label and price per menu.
- Several package sizes (e.g. glass and bottle of the same drink) are price variants of the same item, not duplicate items — they are held structurally in `price_options`.
- The CLI does not call any language model of its own for recipes and menus: you (as a person or agent) compose the content and structure yourself, and the action stores it unchanged.

### Use templates first

1. Search for a matching dish template: `comvenio action call cai.template.01.dish --input '{"operation":"list","search":"Schnitzel","limit":20}'`.
2. Instantiate a recipe from it (critical — preview first, then confirmation): `comvenio action call cai.recipe.02.from_template --input '{"template_id":"<template-id>","custom_price":12}'`, then `comvenio action confirm --preview-id <id> --confirmation-token=<token> --idempotency-key <key>`. The response contains `recipe_id`, `recipe_name`, `created_ingredients`, `missing_ingredients` and the success status.
3. `from-template` matches server-side on club and recipe name — a second call with the same name returns the existing `recipe_id` instead of creating a duplicate.
4. If an ingredient appears in `missing_ingredients`, it had no template match and was created without an allergen. For important allergen carriers (flour, beer, cheese, fish, …) check the exact template spelling with `comvenio action call cai.template.02.ingredient --input '{"operation":"list","search":"<name>"}'` — the match is case-insensitive but not fuzzy.

### Create an ad-hoc recipe (when no template fits)

1. Create a recipe with ingredients (critical — preview first, then confirmation): `comvenio action call cai.recipe.01.create --input '{"name":"Brezn","type_of_recipe":"food","category":"Snacks","selling_price":3.00,"ingredients":[{"name":"Laugenbreze","quantity":1,"unit":"pc"}]}'`, then `comvenio action confirm --preview-id <id> --confirmation-token=<token> --idempotency-key <key>`. `ingredients` is an array of `{"name","quantity","unit"}`, no longer a text format.
2. Match ingredient template names exactly so the allergens are inherited too — check the spelling first with `comvenio action call cai.template.02.ingredient --input '{"operation":"list","search":"<name>"}'`.
3. Missing ingredients are created automatically when the recipe is created (`auto_create_missing_ingredients`, on by default).

### Building a menu: check first, then apply

1. Compose the menu and its items as one object (see Examples).
2. `apply` is critical: the first call without confirmation already is the check — `comvenio action call cai.menu.09.apply --input '{"menu": {…}}'` checks required fields, prices, `display_order` and every recipe link server-side, without writing anything, and returns a preview with `preview_id` and `confirmation_token`.
3. Review the preview; only then does `comvenio action confirm --preview-id <id> --confirmation-token=<token> --idempotency-key <key>` create the menu and its items in bulk.

### Assembling a menu directly and reusing recipes

1. Create a menu: `comvenio action call cai.menu.01.create --input '{"menu":{"name":"Grillbude – Dorfabend","category":"Fest"}}'`.
2. Create a recipe once, or instantiate it from a template, then reference it on as many menus as you like: `comvenio action call cai.menu.04.add_item --input '{"menu_id":"<menu-id>","item":{"recipe_id":"<recipe-id>","name":"Helles Bier","selling_price":4.50}}'`. Name and price can be overridden per menu; the recipe (including its allergens) stays the single source of truth.
3. Change an existing item via its item ID instead of creating a new one: `comvenio action call cai.menu.05.update_item --input '{"item_id":"<menu-item-id>","changes":{"name":"…","price_options":[…]}}'`. This preserves the item's identity and creates neither a second item nor a new recipe.
4. A product with several package sizes (e.g. glass/bottle) stays one item with several `price_options`, not a second item.
5. Do not create a new recipe for the same dish for every menu — that produces duplicates.

### Maintaining club ingredients and categories

1. Create an ingredient: `comvenio action call cai.ingredient.03.create --input '{"ingredient":{"name":"Bio-Kartoffeln","unit":"kg","cost_per_unit":2.4,"supplier":"Hof Muster","category_ids":["<category-id>"]}}'` (required fields inside `ingredient`: `name`, `unit`).
2. Search and read ingredients: `comvenio action call cai.ingredient.01.list --input '{"search":"Kartoffel","category_id":"<category-id>","limit":20,"offset":0}'`, `comvenio action call cai.ingredient.02.show --input '{"ingredient_id":"<ingredient-id>"}'`. `limit` (1–100) and `offset` control the list.
3. Read the category tree and assign categories: `comvenio action call cai.ingredient-category.03.tree --input '{}'`, `comvenio action call cai.ingredient-category.09.assign --input '{"ingredient_id":"<ingredient-id>","category_id":"<category-id>"}'`.
4. Create your own category: `comvenio action call cai.ingredient-category.06.create --input '{"category":{"name":"Vegan","category_type":"dietary"}}'` (required fields inside `category`: `name`, `category_type`; optional fields include `description`, `parent_id`, `icon`, `color` and `sort_order`). `comvenio action call cai.ingredient-category.11.init --input '{"acknowledge_defaults":true}'` creates default categories after confirmation and is only meant for clubs that have none yet — otherwise the action reports a conflict.

### Running shopping lists

1. Create a list: `comvenio action call cai.shopping.07.create --input '{"shopping_list":{"name":"Einkauf Sommerfest","description":"Grillbude und Getränkestand","context_type":"event","context_id":"<event-id>","status":"draft"}}'` with `context_type` (`club`, `event`, `object`, `meeting`) and status `draft`, `active`, `completed` or `cancelled`.
2. Add an item: `comvenio action call cai.shopping.10.item_add --input '{"shopping_list_id":"<list-id>","item":{"ingredient_id":"<ingredient-id>","quantity":20,"unit":"kg","estimated_cost":48,"notes":"Festkochend"}}'`. An item needs `quantity`, `unit` and either `ingredient_id` or a non-empty `name`.
3. Mark it purchased: `comvenio action call cai.shopping.13.purchased --input '{"item_id":"<item-id>","purchased":true}'`.
4. Generate deterministically from existing data: `comvenio action call cai.shopping.14.generate_from_recipe --input '{"recipe_id":"<recipe-id>","portions":80,"name":"Einkauf Grillteller","output_format":"pdf"}'` or `comvenio action call cai.shopping.15.generate_from_menu --input '{"menu_id":"<menu-id>","name":"Einkauf Festkarte","output_format":"pdf"}'`.

### Styling a menu

1. Set the design: `comvenio action call cai.menu.08.style --input '{"menu_id":"<menu-id>","design":{"background":"#ffffff","textColor":"#1a1a1a","accentColor":"#7c3aed","showPrices":true,"showAllergens":true}}'`. The `design` object carries named fields for colors, fonts, columns, logo, QR code and watermark — free CSS alone is no longer the only way.
2. Additional free CSS is still possible through the `custom_css` field inside the same `design` object, but it is checked for unsafe patterns: the action rejects `@import`, `javascript:`, `expression()`, `behavior:` and embedded `<style>` or `<script>` tags.
3. Allergens, prices and the QR code remain structured, required components and still come from the recipe and item — the design fields (`showPrices`, `showAllergens`, `showColorants`, `showQr`, …) only control whether they are shown, not their content.
4. Design can also be set directly on creation: `cai.menu.09.apply` accepts `design_config` inside the `menu` object; the plain `cai.menu.01.create` has no design field — use `menu style` afterward for that.
5. The CSS content itself is only checked against the unsafe patterns listed above, not otherwise validated — you are responsible for valid, effective CSS.

## Examples

Creating an ingredient:

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
comvenio action call cai.ingredient.03.create --input '{"ingredient": <object above>}'
```

Creating, changing and deleting a category (category types: `main`, `food_type`, `meat_type`, `dietary`, `origin`, `custom`):

```bash
comvenio action call cai.ingredient-category.06.create --input '{"category":{"name":"Vegan","category_type":"dietary"}}'
comvenio action call cai.ingredient-category.07.update --input '{"category_id":"<category-id>","changes":{"description":"Ohne tierische Zutaten"}}'
comvenio action call cai.ingredient-category.08.delete --input '{"category_id":"<category-id>"}'
```

A product with several package sizes — `selling_price` stays as the base price, `price_options` holds the individual package sizes:

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
comvenio action call cai.menu.05.update_item --input '<object above>'
```

Creating a shopping list:

```json
{
  "name": "Einkauf Sommerfest",
  "description": "Grillbude und Getränkestand",
  "context_type": "event",
  "context_id": "<event-id>",
  "status": "draft"
}
```

A shopping item:

```json
{
  "ingredient_id": "<ingredient-id>",
  "quantity": 20,
  "unit": "kg",
  "estimated_cost": 48,
  "notes": "Festkochend"
}
```

Complete example — a barbecue-stand menu from the recipes to the finished menu (`$( … )` reads the id from the confirmed response each time):

```bash
# Create recipes once (with allergens) — recipe.from-template and recipe.create are critical
comvenio action call cai.recipe.02.from_template --input '{"template_id":"<steaksemmel-template-id>","custom_name":"Steaksemmel","custom_price":4.50}'
comvenio action confirm --preview-id <id> --confirmation-token=<token> --idempotency-key <key>
STEAK=<recipe_id from the response>

comvenio action call cai.recipe.01.create --input '{"name":"Käse","type_of_recipe":"food","selling_price":3.40,"ingredients":[{"name":"Gouda Käse","quantity":0.1,"unit":"kg"}]}'
comvenio action confirm --preview-id <id> --confirmation-token=<token> --idempotency-key <key>
KAAS=<recipe_id from the response>

# Create the menu
comvenio action call cai.menu.01.create --input '{"menu":{"name":"Grillbude – Sporttag","category":"Fest"}}'
MENU=<id from the response>

# Set items (recipe reuse, label/price per menu)
comvenio action call cai.menu.04.add_item --input "{\"menu_id\":\"$MENU\",\"item\":{\"recipe_id\":\"$STEAK\",\"name\":\"Steaksemmel\",\"selling_price\":4.50}}"
comvenio action call cai.menu.04.add_item --input "{\"menu_id\":\"$MENU\",\"item\":{\"recipe_id\":\"$KAAS\",\"name\":\"Kaas (100 g)\",\"selling_price\":3.40}}"

# Optionally style and check it
comvenio action call cai.menu.08.style --input "{\"menu_id\":\"$MENU\",\"design\":{\"accentColor\":\"#7c3aed\"}}"
comvenio action call cai.menu.03.show --input "{\"menu_id\":\"$MENU\"}"
```

### Enums

| Enum | Values |
|---|---|
| Unit | `gr`, `kg`, `ml`, `l`, `pc`, `portion`, `tsp`, `tbsp`, `cup`, `pinch` |
| Recipe type | `food`, `drink` |
| Age group | `none`, `teen` (16+), `adult` (18+) |
| Allergens (14 EU allergens) | `gluten`, `crustaceans`, `eggs`, `fish`, `peanuts`, `soy`, `lactose`, `nuts`, `celery`, `mustard`, `sesame`, `sulfites`, `lupin`, `molluscs` |

The units are `gr`, `pc` and `portion` — not `g`, `piece` or `serving`.

### Important rules

- A menu item without a recipe is missing from the public item list, because that list always links through the recipe — always attach a recipe for QR menus.
- The menu price overrides the recipe's base price per menu; without its own price, the recipe default applies. Several package sizes belong in `price_options`, not in separate items. The sort field is called `display_order`.
- For existing menu items, always pass their item ID to `cai.menu.05.update_item`; `cai.menu.04.add_item` and `cai.menu.09.apply` create new items.
- Allergens only arise from ingredient names that match a template. A freely invented ingredient without a template match gets no allergen.
- Design can be set during bulk creation via `cai.menu.09.apply` (`design_config`) or afterward via `cai.menu.08.style` (`design`), not on the plain `cai.menu.01.create`.
- A QR graphic or URL is generated not by the action but by the frontend from the public menu data.
- `recipe.create` and `recipe.from-template` are `critical_write`: the call without confirmation only returns the preview, the recipe is created only with `action confirm`.

### Further read and management commands

- Manage recipes: `cai.recipe.03.list`, `cai.recipe.04.show`, `cai.recipe.05.update`, `cai.recipe.06.delete` (critical).
- Manage ingredients: `cai.ingredient.01.list`, `cai.ingredient.02.show`, `cai.ingredient.04.update`, `cai.ingredient.05.delete` (critical).
- Read and assign categories: `cai.ingredient-category.01.list`, `.02.roots`, `.03.tree`, `.04.by_ingredient`, `.10.unassign` (critical).
- Read shopping lists: `cai.shopping.01.list`, `.02.active`, `.03.completed`, `.04.by_context`, `.05.by_context_type`, `.06.show` (`operation=show`).
- Change, delete or export a shopping list as PDF/CSV: `cai.shopping.08.update`, `cai.shopping.09.delete` (critical), `cai.shopping.06.show` (`operation=export`).
- Change or delete a shopping item: `cai.shopping.11.item_update`, `cai.shopping.12.item_delete` (critical).
- Manage a menu: `cai.menu.02.list`, `cai.menu.03.show`, `cai.menu.07.delete` (critical), `cai.menu.06.delete_item` (critical), `cai.menu.10.export`.

## Commands and actions

<!-- gen:docs befehle -->

**recipe**

- `cai.recipe.01.create` — create (change with confirmation) · Scopes: `supply.write`
- `cai.recipe.02.from_template` — create (change with confirmation) · Scopes: `supply.write`
- `cai.recipe.03.list` — list (read) · Scopes: `supply.read`
- `cai.recipe.04.show` — show (read) · Scopes: `supply.read`
- `cai.recipe.05.update` — update (change) · Scopes: `supply.write`
- `cai.recipe.06.delete` — delete (change with confirmation) · Scopes: `supply.write`

**ingredient**

- `cai.ingredient.01.list` — list (read) · Scopes: `supply.read`
- `cai.ingredient.02.show` — show (read) · Scopes: `supply.read`
- `cai.ingredient.03.create` — create (change) · Scopes: `supply.write`
- `cai.ingredient.04.update` — update (change) · Scopes: `supply.write`
- `cai.ingredient.05.delete` — delete (change with confirmation) · Scopes: `supply.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"ingredient"}'` (the sign-in sets `club_id` — never in `--input`)

**ingredient-category**

- `cai.ingredient-category.01.list` — list (read) · Scopes: `supply.read`
- `cai.ingredient-category.02.roots` — roots (read) · Scopes: `supply.read`
- `cai.ingredient-category.03.tree` — tree (read) · Scopes: `supply.read`
- `cai.ingredient-category.04.by_ingredient` — list (read) · Scopes: `supply.read`
- `cai.ingredient-category.05.show` — show (read) · Scopes: `supply.read`
- `cai.ingredient-category.06.create` — create (change) · Scopes: `supply.write`
- `cai.ingredient-category.07.update` — update (change) · Scopes: `supply.write`
- `cai.ingredient-category.08.delete` — delete (change with confirmation) · Scopes: `supply.write`
- `cai.ingredient-category.09.assign` — assign (change) · Scopes: `supply.write`
- `cai.ingredient-category.10.unassign` — unassign (change with confirmation) · Scopes: `supply.write`
- `cai.ingredient-category.11.init` — initialize (change with confirmation) · Scopes: `supply.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"ingredient-category"}'` (the sign-in sets `club_id` — never in `--input`)

**shopping**

- `cai.shopping.01.list` — list (read) · Scopes: `supply.read`
- `cai.shopping.02.active` — list (read) · Scopes: `supply.read`
- `cai.shopping.03.completed` — list (read) · Scopes: `supply.read`
- `cai.shopping.04.by_context` — list (read) · Scopes: `supply.read`
- `cai.shopping.05.by_context_type` — list (read) · Scopes: `supply.read`
- `cai.shopping.06.show` — show, export (read, change) · Scopes: `supply.read`, `files.export`
- `cai.shopping.07.create` — create (change) · Scopes: `supply.write`
- `cai.shopping.08.update` — update (change) · Scopes: `supply.write`
- `cai.shopping.09.delete` — delete (change with confirmation) · Scopes: `supply.write`
- `cai.shopping.10.item_add` — add (change) · Scopes: `supply.write`
- `cai.shopping.11.item_update` — update (change) · Scopes: `supply.write`
- `cai.shopping.12.item_delete` — delete (change with confirmation) · Scopes: `supply.write`
- `cai.shopping.13.purchased` — set (change) · Scopes: `supply.write`
- `cai.shopping.14.generate_from_recipe` — generate (change) · Scopes: `supply.write`, `files.export`
- `cai.shopping.15.generate_from_menu` — generate (change) · Scopes: `supply.write`, `files.export`
- `cai.shopping.procurement.activate` — activate (change with confirmation) · Scopes: `club.write`
- `cai.shopping.procurement.add` — add (change with confirmation) · Scopes: `club.write`
- `cai.shopping.procurement.list` — list (read) · Scopes: `club.read`
- `cai.shopping.procurement.purchase` — purchase (change with confirmation) · Scopes: `club.write`
- `cai.shopping.procurement.template_create` — create (change with confirmation) · Scopes: `club.write`
- `cai.shopping.procurement.template_deactivate` — deactivate (change with confirmation) · Scopes: `club.write`
- `cai.shopping.procurement.template_update` — update (change with confirmation) · Scopes: `club.write`
- `cai.shopping.procurement.templates` — list (read) · Scopes: `club.read`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"shopping"}'` (the sign-in sets `club_id` — never in `--input`)

**template**

- `cai.template.01.dish` — list, show (read) · Scopes: `supply.read`
- `cai.template.02.ingredient` — list, show (read) · Scopes: `supply.read`

**menu**

- `cai.menu.01.create` — create (change) · Scopes: `supply.write`
- `cai.menu.02.list` — list (read) · Scopes: `supply.read`
- `cai.menu.03.show` — show (read) · Scopes: `supply.read`
- `cai.menu.04.add_item` — add (change) · Scopes: `supply.write`
- `cai.menu.05.update_item` — update (change) · Scopes: `supply.write`
- `cai.menu.06.delete_item` — delete (change with confirmation) · Scopes: `supply.write`
- `cai.menu.07.delete` — delete (change with confirmation) · Scopes: `supply.write`
- `cai.menu.08.style` — style (change) · Scopes: `supply.write`
- `cai.menu.09.apply` — apply (change with confirmation) · Scopes: `supply.write`
- `cai.menu.10.export` — export (change) · Scopes: `supply.read`, `files.export`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"menu"}'` (the sign-in sets `club_id` — never in `--input`)
<!-- /gen:docs -->

## Errors

- `AUTH_REQUIRED` — your sign-in has expired or is missing before a recipe, ingredient or menu action runs. See `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — the sign-in does not carry the scope required for this action. See `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — your role in the club does not allow, for example, `manage_menus` or `create_menus`. See `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — the recipe, ingredient, category, shopping list or menu does not exist or belongs to a different club. See `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — a required field is missing, for example `name`/`unit` on an ingredient or `quantity`/`unit` on a shopping item. See `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — for example `ingredient-category init` when default categories already exist. See `comvenio help fehler CONFLICT`.
- `CONFIRMATION_REQUIRED` — a critical action such as `recipe.create`, `recipe.from-template` or `menu.apply` needs `comvenio action confirm` with the preview first. See `comvenio help fehler CONFIRMATION_REQUIRED`.
- `OUTCOME_UNKNOWN` — a writing action did not answer in time after confirmation; check the current state instead of repeating. See `comvenio help fehler OUTCOME_UNKNOWN`.
