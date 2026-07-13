# Speisekarten, Gerichte & Getränke — CLI-Referenz (supply-service)

> Praktischer Leitfaden für das Anlegen von **Gerichten/Getränken (Rezepte)**, **Speisekarten** und
> deren **Design** über das `comvenio`-CLI — deterministisch, ohne ai-service-LLM. Du (der bedienende
> Agent) bist der **KI-Träger**: du komponierst Inhalt + Struktur selbst, das CLI persistiert 1:1 über
> die supply-CRUD-Endpoints.
>
> Verifiziert am Code (`Backend/Microservice-Backend/supply-service/`, Stand 2026-06-24). Code = Wahrheit.

---

## 1. Das mentale Modell (so hängt alles zusammen)

```
Allergen (global, 14 EU-Allergene)        Colorant (global, E-Nummern)
        ▲ M:N                                     ▲ M:N
        │                                         │
     Ingredient (Zutat, club-spezifisch) ─────────┘
        ▲ trägt die Allergene/Farbstoffe
        │ (1:N RecipeIngredient: Menge + Einheit)
        │
     Recipe (Gericht/Getränk) ── default_selling_price, category, type_of_recipe
        │   ⚠ HAT KEINE eigenen Allergene — sie werden TRANSITIV abgeleitet:
        │      Recipe → RecipeIngredient → Ingredient → Allergen
        │ (1:N)
        │
     MenuItem (Eintrag auf EINER Karte) ── name + selling_price (Override pro Karte), display_order
        │      recipe_id ist OPTIONAL — aber ohne Recipe: keine Allergene, keine Kategorie,
        │      fehlt sogar in der öffentlichen QR-Item-Liste (INNER JOIN auf Recipe)
        │ (N:1)
        │
     Menu (Speisekarte) ── name, category, design_config (JSONB: enthält custom_css)
```

**Die drei Kernsätze:**

1. **Eine Speise ist ein Rezept, kein Karten-Eintrag.** Ein `MenuItem` ohne `recipe_id` ist nur ein
   Name+Preis-Etikett — ohne Allergene, ohne Kategorie, unsichtbar in der QR-Item-Liste. Für eine echte
   (rechtssichere) Karte braucht **jeder** Eintrag ein Rezept.
2. **Allergene leben an der Zutat, nicht am Rezept.** Das Rezept erbt sie transitiv über seine Zutaten.
   Korrekte Allergene bekommst du, indem die Zutaten gegen die **Vorlagen** matchen (die tragen die
   Allergene) — siehe §3.
3. **Das Rezept ist die Wahrheit, der Karten-Eintrag die Darstellung.** Dasselbe Rezept (z.B. „Steaksemmel")
   kann auf mehreren Karten mit **unterschiedlichem Namen + Preis** erscheinen. Rezept einmal anlegen,
   pro Karte einen `MenuItem` mit eigenem Label + Preis setzen (`--name`/`--price` überschreiben).

---

## 2. Befehlsübersicht

| Befehl | Zweck |
|--------|-------|
| `comvenio template dish [--search\|--category\|--common]` | Globale **Gericht-Vorlagen** durchsuchen (100+, mit Rezept + Allergenen) |
| `comvenio template ingredient [--search\|--common]` | Globale **Zutaten-Vorlagen** durchsuchen (380+, mit `allergen_types`) |
| `comvenio recipe from-template <id> [--price] [--name]` | Rezept aus einer **Dish-Vorlage** instanziieren (Allergene inklusive, idempotent) |
| `comvenio recipe create --name --type --price [--ingredients]` | **Ad-hoc-Rezept** (für Speisen ohne passende Vorlage); fehlende Zutaten werden auto-angelegt |
| `comvenio recipe list\|show\|update\|delete` | Rezepte verwalten |
| `comvenio ingredient list\|show\|create\|update\|delete` | Club-Zutaten samt Allergen-/Farbstoff-/Kategorie-IDs verwalten |
| `comvenio ingredient-category list\|roots\|tree\|…` | Kategorienbaum und Zutaten-Zuordnungen verwalten |
| `comvenio shopping list\|show\|create\|…` | Einkaufslisten und Positionen verwalten oder aus Rezept/Karte erzeugen |
| `comvenio menu create --name [--description] [--category]` | Leere **Speisekarte** anlegen |
| `comvenio menu add-item <menu_id> --recipe <id> [--name] [--price]` | Rezept als Eintrag auf eine Karte setzen (Name/Preis aus Rezept, wenn nicht angegeben) |
| `comvenio menu list\|show\|delete` | Karten verwalten |
| `comvenio menu style <menu_id> --css <datei>` | Freies CSS auf eine Karte (`design_config.custom_css`) |
| `comvenio menu apply --file <menu.json>` | Vom Agenten komponierte Karte + Einträge im Bulk anlegen |
| `comvenio menu update-item\|delete-item` | Bestehende Karten-Einträge ändern oder entfernen |
| `comvenio menu export <menu_id> [--out]` | Karte über das echte Frontend als PDF exportieren |

Jeder Befehl hat `--help`. `--json` für maschinenlesbare Ausgabe (Agent-Modus).

> `menu generate` und `menu design` sind bewusst entfernt und brechen mit einer
> Erklärung ab. Der bedienende Agent liest Foto/Text selbst, komponiert Rezepte,
> Einträge und `design_config` und nutzt anschließend `menu apply`, `menu create`,
> `menu add-item` beziehungsweise `menu style`. Das CLI ruft kein Backend-LLM auf.

---

## 3. Das Vorlagen-System (Vorlagen ZUERST nutzen)

Der supply-service liefert **global vorgeseedete Vorlagen** (club-unabhängig):

- **GlobalDishTemplate** (100+): fertige Gerichte **mit Rezept** (Zutatenliste + Mengen) + `suggested_price`
  + `category` + `type_of_recipe`. Beispiele: `Schnitzel Wiener Art mit Kartoffelsalat`, `Bratwurstsemmel`,
  `Grillteller mit Kartoffelsalat`, `Grillhähnchen halb`, `Currywurst mit Pommes`, `Bier (Helles)`,
  `Weißbier`, `Radler`, `Wasser (still)`.
- **GlobalIngredientTemplate** (380+): Basis-Zutaten **mit `allergen_types`** (und `colorant_types`).
  Beispiele: `Brötchen (Semmel)`→gluten, `Laugenbreze`→gluten, `Bier (Helles)`→gluten, `Gouda Käse`→lactose,
  `Weißwurst`, `Spezi`→Farbstoffe, `Apfelschorle`.

**Warum Vorlagen zuerst?** `recipe from-template` instanziiert ein **vollständiges** Rezept (Zutaten + Preis +
Kategorie) und **erbt die Allergene automatisch** — die auto-angelegten Zutaten ziehen ihre Allergene aus den
Zutaten-Vorlagen. Du musst keine Zutaten/Allergene von Hand zusammenstellen.

```bash
# 1) Passende Vorlage finden
comvenio template dish --search "Schnitzel" --json
#  → "Schnitzel Wiener Art mit Kartoffelsalat"  91bfad18-…  (9.00 € Default)

# 2) Rezept daraus instanziieren, Preis überschreiben
comvenio recipe from-template 91bfad18-99cf-4f2f-bdad-956d36d10eaf --price 12 --json
#  → { recipe_id, recipe_name, created_ingredients[], missing_ingredients[] }
```

**Idempotenz:** `from-template` matcht serverseitig auf `(club_id, recipe_name)`. Ein zweiter Aufruf mit
gleichem Namen liefert die bestehende `recipe_id` statt ein Duplikat anzulegen. Die Antwort enthält
`recipe_id`, `recipe_name`, `created_ingredients`, `missing_ingredients` und den Erfolgsstatus; ein
`already_exists`-Feld gehört nicht zum aktuellen Vertrag.

**`missing_ingredients`** im Ergebnis = Zutaten, die kein Vorlagen-Match hatten und als nackte Zutat (ohne
Allergen) angelegt wurden. Bei wichtigen Allergenträgern (Mehl, Bier, Käse, Fisch …) prüfen, ob der
Zutatenname exakt zu einer Vorlage passt (Match ist case-insensitiv, aber **kein** Fuzzy).

---

## 4. Ad-hoc-Rezepte (wenn keine Vorlage passt)

Nicht jede Speise hat eine Dish-Vorlage (z.B. Brezn, Weißwurst, Steckerlfisch, Gemüselasagne, Spezi, Limo).
Dann ein Rezept **direkt** anlegen — und die **Zutaten-Vorlagen-Namen exakt treffen**, damit die Allergene
trotzdem erben:

```bash
# Große Brezn — Zutat "Laugenbreze" matcht die Vorlage (→ gluten erbt automatisch)
comvenio recipe create --name "Brezn" --type food --price 3.00 \
  --category "Snacks" --ingredients "Laugenbreze:1:pc" --json

# Kaas — Zutat "Gouda Käse" matcht die Vorlage (→ lactose erbt)
comvenio recipe create --name "Käse" --type food --price 3.40 \
  --category "Snacks" --ingredients "Gouda Käse:0.1:kg" --json

# Spezi — Getränk, Zutat "Spezi" matcht die Vorlage
comvenio recipe create --name "Spezi" --type drink --price 4.00 \
  --category "Getränke" --ingredients "Spezi:0.5:l" --json
```

`--ingredients` Format: `"Name:Menge:Einheit,Name2:Menge2:Einheit2"`. Fehlende Zutaten werden
auto-angelegt (`auto_create_missing_ingredients`). **Tipp:** vorher `comvenio template ingredient --search "<name>"`
laufen lassen, um die exakte Vorlagen-Schreibweise (und die Allergene) zu sehen.

> Hinweis: `recipe create` nutzt den `from-ai-dish`-Endpoint — „ai" steht hier für **du als KI-Träger**, NICHT
> für einen ai-service-LLM-Call. Es ist ein reiner, deterministischer Persist-Endpoint.

---

## 5. Karte bauen + Wiederverwendung

```bash
# Karte anlegen
comvenio menu create --name "Grillbude – Dorfabend" --category "Fest" --json
#  → { id: <menu_id>, ... }

# Rezepte als Einträge setzen — Name + Preis PRO KARTE überschreibbar
comvenio menu add-item <menu_id> --recipe <steaksemmel_recipe_id> --name "Steaksemmel" --price 4.50 --json
comvenio menu add-item <menu_id> --recipe <bratwurst_recipe_id>  --name "Bratwurstlsemmel" --price 4.50 --json
```

**Wiederverwendung (das Kernmuster):** Lege ein Rezept **einmal** an, referenziere es auf **mehreren** Karten.
Beispiel „Bier (Helles)": das Rezept heißt `Bier (Helles)` (mit gluten), auf der Fest-Schenke-Karte erscheint
es als Eintrag `Helles Bier` für `4,50 €`:

```bash
# Rezept existiert/instanziiert einmal:
comvenio recipe from-template <bier-helles-template-id> --json     # recipe_name "Bier (Helles)"
# Karten-Eintrag mit eigenem Label + Preis:
comvenio menu add-item <fest-schenke-id> --recipe <bier-recipe-id> --name "Helles Bier" --price 4.50 --json
```

So bleibt das Rezept (inkl. Allergene) die Single Source, während jede Karte ihr eigenes Wording + ihren
eigenen Preis hat. **Nicht** pro Karte ein neues „Steaksemmel"-Rezept anlegen — das wäre Duplikat-Wildwuchs.

---

## 6. Club-Zutaten und Kategorien

Zutaten-CRUD verwendet JSON-Dateien. Beim Anlegen sind `name` und `unit` Pflicht:

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
comvenio ingredient list --search "Kartoffel" --category <category-id> --json
comvenio ingredient show <ingredient-id> --json
comvenio ingredient update <ingredient-id> --file ingredient.json --json
comvenio ingredient delete <ingredient-id> --json
```

`--category` schließt Unterkategorien ein. `--skip` und `--limit` steuern die Liste; `--limit` liegt zwischen 1 und 1000.

Kategorien lesen und zuordnen:

```bash
comvenio ingredient-category roots --type main --json
comvenio ingredient-category tree --json
comvenio ingredient-category list --include-inactive --json
comvenio ingredient-category by-ingredient <ingredient-id> --json
comvenio ingredient-category assign <ingredient-id> --category <category-id> --json
comvenio ingredient-category unassign <ingredient-id> --category <category-id> --json
```

Kategorie-Typen: `main`, `food_type`, `meat_type`, `dietary`, `origin`, `custom`.

Ein Kategorie-Create-Body benötigt `name` und `category_type`; optional sind `description`, `parent_id`, `icon`, `color`, `sort_order` und `is_active`. Das CLI ergänzt `club_id`.

```bash
comvenio ingredient-category create --file category.json --json
comvenio ingredient-category update <category-id> --file category.json --json
comvenio ingredient-category delete <category-id> --json       # Soft-Delete
comvenio ingredient-category delete <category-id> --hard --json
comvenio ingredient-category init --json
```

> **Bestätigter Backend-Blocker:** `IngredientCategoryCreate` deklariert aktuell kein
> `club_id`, die Create-Route greift aber auf `category_in.club_id` zu. Das CLI sendet
> `club_id` korrekt mit; `ingredient-category create` ist trotzdem nicht verlässlich,
> bis Schema und Route im Backend synchronisiert sind. Das ist kein CLI-Parsingfehler.

`init` ist nur für Clubs ohne vorhandene Standardkategorien gedacht und kann andernfalls mit `409` antworten.

## 7. Einkaufslisten

Einkaufslisten haben `context_type` (`club`, `event`, `object`, `meeting`) und Status `draft`, `active`, `completed` oder `cancelled`.

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

```bash
comvenio shopping create --file shopping-list.json --json
comvenio shopping list --status draft --json
comvenio shopping active --json
comvenio shopping completed --json
comvenio shopping by-context --context-id <event-id> --json
comvenio shopping by-context-type --context-type event --json
comvenio shopping show <list-id> --json
comvenio shopping update <list-id> --file shopping-list.json --json
comvenio shopping delete <list-id> --json
```

Eine Position benötigt `quantity`, `unit` und entweder `ingredient_id` oder einen nicht leeren `name`:

```json
{
  "ingredient_id": "<ingredient-id>",
  "quantity": 20,
  "unit": "kg",
  "estimated_cost": 48,
  "notes": "Festkochend"
}
```

```bash
comvenio shopping item-add <list-id> --file item.json --json
comvenio shopping item-update <item-id> --file item.json --json
comvenio shopping purchased <item-id> --purchased true --json
comvenio shopping item-delete <item-id> --json
```

Deterministische Generierung aus vorhandenen Daten:

```bash
comvenio shopping generate-from-recipe <recipe-id> --portions 80 \
  --name "Einkauf Grillteller" --json
comvenio shopping generate-from-menu <menu-id> --name "Einkauf Festkarte" --json
```

> **Bestätigter Backend-Blocker:** In `shopping.py` steht vor der Route
> `GET /lists/{id}` ein nackter `@router.get`-Decorator. Dieser Backend-Codefehler
> gefährdet Router-Import und Endpoint-Verfügbarkeit. Die CLI-Actions und Verträge
> sind implementiert, dürfen aber bis zur Backend-Korrektur nicht als zuverlässig
> erreichbar behandelt werden.

---

## 8. Karte stylen (freies CSS)

Das Karten-Design liegt in `Menu.design_config` (JSONB). Das CLI setzt freies, scoped CSS unter dem Key
`custom_css`:

```bash
comvenio menu style <menu_id> --css ./meine-karte.css
```

- Das CSS wird im Frontend **`@scope`-isoliert** in den Karten-Container injiziert (kein Ausbruch).
- Es targetet semantische Klassen: `.menu-card`, `.menu-title`, `.menu-category-header`, `.menu-item`,
  `.menu-item-name`, `.menu-item-price`, `.menu-qr` u.a.
- **Allergene/Preise/QR bleiben strukturierte Komponenten** (Pflicht-Daten, kein freies HTML) — das CSS
  stylt nur ihr Aussehen.
- `style` macht **GET → merge → PUT**, d.h. andere `design_config`-Knöpfe bleiben erhalten.

---

## 9. Enums (verifiziert am Code — `schemas/core.py`)

| Enum | Werte |
|------|-------|
| **UnitType** | `gr`, `kg`, `ml`, `l`, `pc`, `portion`, `tsp`, `tbsp`, `cup`, `pinch` |
| **TypeOfIngredient** (`type_of_recipe`) | `food`, `drink` |
| **AgeGroup** | `none`, `teen` (16+), `adult` (18+) |
| **14 EU-Allergene** (`type`) | `gluten`, `crustaceans`, `eggs`, `fish`, `peanuts`, `soy`, `lactose`, `nuts`, `celery`, `mustard`, `sesame`, `sulfites`, `lupin`, `molluscs` |

> ⚠ Die Einheiten sind `gr`/`pc`/`portion` — **NICHT** `g`/`piece`/`serving` (eine alte AI-doc nannte sie falsch).

---

## 10. Gotchas (verifiziert — nicht raten)

- **MenuItem ohne Recipe ist eine Falle.** `recipe_id` ist nullable, aber dann: keine Allergene, keine
  Kategorie (kommt transitiv vom Recipe), und der Eintrag **fehlt in `GET …/items/public`** (INNER JOIN auf
  Recipe). Für QR-Karten **immer** ein Recipe hinterlegen.
- **Preis-Override.** `MenuItem.selling_price` überschreibt `Recipe.default_selling_price` pro Karte. NULL =
  Rezept-Default. Sortierfeld heißt **`display_order`** (nicht `sort_order`).
- **Single-Item-Route** ist `POST /menu/club/{club_id}/items` (mit `menu_id` im Body), **nicht**
  `/menus/{id}/items`. Bulk: `POST …/items/bulk` erwartet ein **rohes Array** `List[MenuItemCreate]`.
- **RBAC ist serverseitig aktiv** (supply-service hat inzwischen RBAC): Mutationen brauchen eine Permission
  aus `manage_menus` / `create_menus` / `manage_club_settings`. 403 = Token-Recht fehlt.
  `GET /allergens/` + `GET /colorants/` sind **public** (QR-Speisekarten).
- **Allergene nur über Zutaten-Namen, die Vorlagen matchen.** Eine frei erfundene Zutat ohne Vorlagen-Match
  bekommt **kein** Allergen. Match ist case-insensitiv, aber exakt (kein Fuzzy).
- **`from-template` ist idempotent** (per `(club, recipe_name)`). Gleicher Name → bestehendes Rezept.
- **`custom_css` ist ein freier JSONB-Key** ohne Backend-Validierung; nur via `PUT …/menus/{id}` (bzw.
  `menu style`) setzbar — **nicht** beim Create.
- **Kein QR-Endpoint im Backend.** Die QR-URL/-Grafik erzeugt das Frontend aus den public-Routen.

---

## 11. Komplettes Beispiel: eine Grillbude-Karte end-to-end

```bash
CLUB=9ea9d95a-…        # SV Motzing (aus dem State-File, sonst --club)

# --- Rezepte (einmalig, mit Allergenen) ---
# aus Vorlagen:
STEAK=$(comvenio recipe from-template 425b1269-… --name "Steaksemmel"  --price 4.50 --json | jq -r .recipe_id)
BRAT=$( comvenio recipe from-template 006d6044-… --name "Bratwurstsemmel" --price 4.50 --json | jq -r .recipe_id)
TELL=$( comvenio recipe from-template 8712a3a6-… --name "Grillteller"   --price 8.50 --json | jq -r .recipe_id)
HENDL=$(comvenio recipe from-template e9cff170-… --name "Grillhendl"    --price 7.00 --json | jq -r .recipe_id)
# ad-hoc (keine Dish-Vorlage, aber Zutaten-Vorlagen matchen → Allergene erben):
KAAS=$( comvenio recipe create --name "Käse" --type food --price 3.40 --ingredients "Gouda Käse:0.1:kg"   --json | jq -r .id)
BREZ=$( comvenio recipe create --name "Brezn" --type food --price 3.00 --ingredients "Laugenbreze:1:pc"   --json | jq -r .id)
SEM=$(  comvenio recipe create --name "Semmel" --type food --price 2.00 --ingredients "Brötchen (Semmel):1:pc" --json | jq -r .id)

# --- Karte ---
MENU=$(comvenio menu create --name "Grillbude – Sporttag" --category "Fest" --json | jq -r .id)

# --- Einträge (Rezept-Wiederverwendung, Label/Preis pro Karte) ---
comvenio menu add-item $MENU --recipe $STEAK --name "Steaksemmel"     --price 4.50 --json
comvenio menu add-item $MENU --recipe $BRAT  --name "Bratwurstsemmel" --price 4.50 --json
comvenio menu add-item $MENU --recipe $TELL  --name "Grillteller"     --price 8.50 --json
comvenio menu add-item $MENU --recipe $KAAS  --name "Kaas (100 g)"    --price 3.40 --json
comvenio menu add-item $MENU --recipe $BREZ  --name "Große Brezn"     --price 3.00 --json
comvenio menu add-item $MENU --recipe $SEM   --name "Semmel"          --price 2.00 --json
comvenio menu add-item $MENU --recipe $HENDL --name "½ Grillhendl"    --price 7.00 --json

# --- Optional: stylen ---
comvenio menu style $MENU --css ./sv-motzing-menu.css

# --- Prüfen ---
comvenio menu show $MENU --json
```

---

## 12. Endpoint-Karte (Gateway `supply` → supply-service)

| Aktion | Methode | Pfad | Auth |
|--------|---------|------|------|
| Dish-Vorlagen | GET | `/global-dish-templates/?search=&category=&common_only=&limit=` | JWT |
| Zutaten-Vorlagen | GET | `/global-ingredient-templates/?search=&common_only=&limit=` | JWT |
| Rezept aus Vorlage | POST | `/global-dish-templates/create-recipe` | `manage_menus`/`create_menus`/`manage_club_settings` |
| Rezept (ad-hoc) | POST | `/recipe/club/{club_id}/from-ai-dish` | `require_menu_create` |
| Rezept-Liste/Detail | GET | `/recipe/club/{club_id}/recipes[/{id}]` | `require_supply_read` |
| Rezept Update/Delete | PUT/DELETE | `/recipe/club/{club_id}/recipes/{id}` | `require_menu_manage` |
| Zutaten-Liste/Create | GET/POST | `/ingredients/club/{club_id}/ingredients` · `/ingredients/club/{club_id}` | serverseitige Supply-RBAC |
| Zutat Detail/Update/Delete | GET/PUT/DELETE | `/ingredients/{id}` | serverseitige Supply-RBAC |
| Kategorienbaum | GET | `/ingredient-categories/by-club/{club_id}/tree` | serverseitige Supply-RBAC |
| Kategorie CRUD | POST/GET/PUT/DELETE | `/ingredient-categories/[{id}]` | serverseitige Supply-RBAC; Create-Blocker beachten |
| Einkaufsliste CRUD | POST/GET/PUT/DELETE | `/shopping/club/{club_id}/lists[/{id}]` | serverseitige Supply-RBAC; Router-Blocker beachten |
| Einkaufsposition CRUD | POST/PUT/DELETE | `/shopping/club/{club_id}/lists/{id}/items` · `/shopping/club/{club_id}/items/{id}` | serverseitige Supply-RBAC |
| Liste aus Rezept/Karte | POST | `/shopping/club/{club_id}/generate-from-recipe/{id}` · `generate-from-menu/{id}` | serverseitige Supply-RBAC |
| Karte anlegen | POST | `/menu/club/{club_id}/menus` | `require_menu_create` |
| Karten-Liste/Detail | GET | `/menu/club/{club_id}/menus[/{id}]` | `require_supply_read` |
| Karte Update (design) | PUT | `/menu/club/{club_id}/menus/{id}` | `require_menu_manage` |
| Eintrag (single) | POST | `/menu/club/{club_id}/items` | `require_menu_create` |
| Eintrag (bulk) | POST | `/menu/club/{club_id}/items/bulk` | `require_menu_create` |
| Public-Karte (QR) | GET | `/menu/club/{club_id}/menus/{id}/public` | **public** |
| Allergene/Farbstoffe | GET | `/allergens/` · `/colorants/` | **public** |

> Gateway strippt das erste Pfadsegment (`supply`) und leitet den Rest an supply-service. Auth via
> `Authorization: Bearer cvn_…` (das CLI sendet nur das Token; RBAC ist serverseitig).
