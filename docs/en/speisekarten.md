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

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Sign in with `comvenio login`; without `--scopes` it requests all scopes, `--scopes` narrows it down. Comvenio additionally checks your role in the club server-side.

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
- The CLI does not call any language model of its own for recipes and menus: you (as a person or agent) compose the content and structure yourself, and the CLI stores it unchanged. The earlier commands `menu generate` and `menu design` were therefore deliberately removed; they abort with an explanation. A menu and its design are created through `menu apply`, `menu create`, `menu add-item` and `menu style` respectively.

### Use templates first

1. Search for a matching dish template: `comvenio template dish --search "Schnitzel" --json`.
2. Instantiate a recipe from it, optionally overriding the price: `comvenio recipe from-template <template-id> --price 12 --json`. The response contains `recipe_id`, `recipe_name`, `created_ingredients`, `missing_ingredients` and the success status.
3. `from-template` matches server-side on club and recipe name — a second call with the same name returns the existing `recipe_id` instead of creating a duplicate.
4. If an ingredient appears in `missing_ingredients`, it had no template match and was created without an allergen. For important allergen carriers (flour, beer, cheese, fish, …) check the exact template spelling with `comvenio template ingredient --search "<name>"` — the match is case-insensitive but not fuzzy.

### Create an ad-hoc recipe (when no template fits)

1. Create a recipe with ingredients: `comvenio recipe create --name "Brezn" --type food --price 3.00 --category "Snacks" --ingredients "Laugenbreze:1:pc" --json`. Format of `--ingredients`: `"Name:Menge:Einheit,Name2:Menge2:Einheit2"`.
2. Match ingredient template names exactly so the allergens are inherited too — check the spelling first with `comvenio template ingredient --search "<name>"`.
3. Missing ingredients are created automatically when the recipe is created.

### Building a menu: check first, then apply

1. Compose the menu and its items as a file (see Examples).
2. Check it without writing anything: `comvenio menu preview --file menu.json --css weinfest.css --out .menu-preview --json`. This checks required fields, prices, `display_order` and every recipe link, and generates a data report, a responsive HTML/PNG view and a DIN-A4 PDF locally without writing anything.
3. A `valid: false` is a deliberately visible review result; the artifacts are still generated so the error can be judged in context.
4. Only then apply it: `comvenio menu apply --file menu.json --json` (creates the menu and its items in bulk).

### Assembling a menu directly and reusing recipes

1. Create a menu: `comvenio menu create --name "Grillbude – Dorfabend" --category "Fest" --json`.
2. Create a recipe once, or instantiate it from a template, then reference it on as many menus as you like: `comvenio menu add-item <menu-id> --recipe <recipe-id> --name "Helles Bier" --price 4.50 --json`. Name and price can be overridden per menu; the recipe (including its allergens) stays the single source of truth.
3. Change an existing item via its item ID instead of creating a new one: `comvenio menu update-item <menu-item-id> --name "..." --price-options '[...]' --json`. This preserves the item's identity and creates neither a second item nor a new recipe.
4. A product with several package sizes (e.g. glass/bottle) stays one item with several `price_options`, not a second item.
5. Do not create a new recipe for the same dish for every menu — that produces duplicates.

### Maintaining club ingredients and categories

1. Create an ingredient: `comvenio ingredient create --file ingredient.json --json` (required fields: `name`, `unit`).
2. Search and read ingredients: `comvenio ingredient list --search "Kartoffel" --category <category-id> --json`, `comvenio ingredient show <ingredient-id> --json`. `--category` includes subcategories; `--skip` and `--limit` (1–1000) control the list.
3. Read the category tree and assign categories: `comvenio ingredient-category tree --json`, `comvenio ingredient-category assign <ingredient-id> --category <category-id> --json`.
4. Create your own category: `comvenio ingredient-category create --file category.json --json` (required fields: `name`, `category_type`). `comvenio ingredient-category init --json` creates default categories and is only meant for clubs that have none yet — otherwise it reports a conflict.

### Running shopping lists

1. Create a list: `comvenio shopping create --file shopping-list.json --json` with `context_type` (`club`, `event`, `object`, `meeting`) and status `draft`, `active`, `completed` or `cancelled`.
2. Add an item: `comvenio shopping item-add <list-id> --file item.json --json`. An item needs `quantity`, `unit` and either `ingredient_id` or a non-empty `name`.
3. Mark it purchased: `comvenio shopping purchased <item-id> --purchased true --json`.
4. Generate deterministically from existing data: `comvenio shopping generate-from-recipe <recipe-id> --portions 80 --name "Einkauf Grillteller" --json` or `comvenio shopping generate-from-menu <menu-id> --name "Einkauf Festkarte" --json`.

### Styling a menu

1. Set free CSS: `comvenio menu style <menu_id> --css ./meine-karte.css`.
2. The CSS is injected in isolation into the menu container on the frontend (it cannot break out of the container) and targets semantic classes such as `.menu-card`, `.menu-title`, `.menu-category-header`, `.menu-item`, `.menu-item-name`, `.menu-item-price`, `.menu-qr`.
3. Allergens, prices and the QR code remain structured, required components — the CSS only styles their appearance.
4. `style` reads the current state, merges your CSS into it and writes it back; other design settings of the menu are preserved.

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
comvenio ingredient create --file ingredient.json --json
```

Creating a category (category types: `main`, `food_type`, `meat_type`, `dietary`, `origin`, `custom`):

```bash
comvenio ingredient-category create --file category.json --json
comvenio ingredient-category update <category-id> --file category.json --json
comvenio ingredient-category delete <category-id> --json       # soft delete
comvenio ingredient-category delete <category-id> --hard --json
```

A product with several package sizes — `selling_price` stays as the base price, `price_options` holds the individual package sizes:

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

Creating a shopping list:

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

Complete example — a barbecue-stand menu from the recipes to the finished menu:

```bash
# Create recipes once (with allergens)
STEAK=$(comvenio recipe from-template <steaksemmel-template-id> --name "Steaksemmel" --price 4.50 --json | jq -r .recipe_id)
BRAT=$(comvenio recipe from-template <bratwurstsemmel-template-id> --name "Bratwurstsemmel" --price 4.50 --json | jq -r .recipe_id)
KAAS=$(comvenio recipe create --name "Käse" --type food --price 3.40 --ingredients "Gouda Käse:0.1:kg" --json | jq -r .id)

# Create the menu
MENU=$(comvenio menu create --name "Grillbude – Sporttag" --category "Fest" --json | jq -r .id)

# Set items (recipe reuse, label/price per menu)
comvenio menu add-item $MENU --recipe $STEAK --name "Steaksemmel" --price 4.50 --json
comvenio menu add-item $MENU --recipe $BRAT --name "Bratwurstsemmel" --price 4.50 --json
comvenio menu add-item $MENU --recipe $KAAS --name "Kaas (100 g)" --price 3.40 --json

# Optionally style and check it
comvenio menu style $MENU --css ./festkarte.css
comvenio menu show $MENU --json
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
- For existing menu items, always pass their item ID to `menu update-item`; `menu add-item` and `menu apply` create new items.
- Allergens only arise from ingredient names that match a template. A freely invented ingredient without a template match gets no allergen.
- `custom_css` can only be set via `menu style` (or a menu update), not when creating the menu.
- A QR graphic or URL is generated not by the CLI but by the frontend from the public menu data.

### Further read and management commands

- Manage recipes: `comvenio recipe list|show|update|delete`.
- Manage ingredients: `comvenio ingredient list|show|update|delete`.
- Read and assign categories: `comvenio ingredient-category list|roots|tree|by-ingredient|unassign`.
- Read shopping lists: `comvenio shopping list --status draft`, `comvenio shopping active`, `comvenio shopping completed`, `comvenio shopping by-context --context-id <event-id>`, `comvenio shopping by-context-type --context-type event`, `comvenio shopping show <list-id>`.
- Change or delete a shopping list: `comvenio shopping update <list-id> --file shopping-list.json --json`, `comvenio shopping delete <list-id> --json`.
- Change or delete a shopping item: `comvenio shopping item-update <item-id> --file item.json --json`, `comvenio shopping item-delete <item-id> --json`.
- Manage a menu: `comvenio menu list|show|delete`, `comvenio menu delete-item <item-id>`, `comvenio menu export <menu-id> [--out]`.

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**recipe** — complete

- `comvenio recipe create`
- `comvenio recipe from-template`
- `comvenio recipe list`
- `comvenio recipe show`
- `comvenio recipe update`
- `comvenio recipe delete`

**ingredient** — complete

- `comvenio ingredient list`
- `comvenio ingredient show`
- `comvenio ingredient create`
- `comvenio ingredient update`
- `comvenio ingredient delete`
- Fields and values: `comvenio schema ingredient --json`

**ingredient-category** — complete

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
- Fields and values: `comvenio schema ingredient-category --json`

**shopping** — complete

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
- Fields and values: `comvenio schema shopping --json`

**template** — complete

- `comvenio template dish`
- `comvenio template ingredient`

**menu** — complete

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
- Fields and values: `comvenio schema menu --json`
<!-- /gen:docs -->

## Errors

- `AUTH_REQUIRED` — your sign-in has expired or is missing before a recipe, ingredient or menu command runs. See `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — the sign-in does not carry the scope required for this action. See `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — your role in the club does not allow, for example, `manage_menus` or `create_menus`. See `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — the recipe, ingredient, category, shopping list or menu does not exist or belongs to a different club. See `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — a required field is missing, for example `name`/`unit` on an ingredient or `quantity`/`unit` on a shopping item. See `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — for example `ingredient-category init` when default categories already exist. See `comvenio help fehler CONFLICT`.
- `USAGE_ERROR` — for example `--ingredients` not in the `Name:Menge:Einheit` format. See `comvenio help fehler USAGE_ERROR`.
