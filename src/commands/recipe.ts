import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";

// Gerichte/Getraenke = supply-service Recipes (verified supply-service-data-model.md +
// schemas/recipe.py). Route-Pattern: /recipe/club/{club_id}/recipes (CLAUDE.md).
//   create  → POST /recipe/club/{id}/from-ai-dish (bequem: legt fehlende Zutaten
//             per Name automatisch an; type food|drink, ingredients "Name:Menge:Einheit,...")
//   list    → GET  /recipe/club/{id}/recipes[?search=]
//   show    → GET  /recipe/club/{id}/recipes/{id}
//   update  → PUT  /recipe/club/{id}/recipes/{id}  (RecipeUpdate)
//   delete  → DELETE /recipe/club/{id}/recipes/{id}  (Soft-Delete)
// gateway key: "supply" → supply-service. supply nutzt KEIN RBAC, nur JWT (CLAUDE.md).

const VALID_TYPES = ["food", "drink"];
// UnitType verifiziert an schemas/core.py (Code = Wahrheit; die AI-doc nannte
// faelschlich g/piece/serving). Die echten Enum-Werte:
const VALID_UNITS = ["gr", "kg", "ml", "l", "pc", "portion", "tsp", "tbsp", "cup", "pinch"];

type RecipeRead = {
  id?: string;
  name?: string;
  type_of_recipe?: string;
  default_selling_price?: number | string | null;
  category?: string | null;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
  name?: string;
  type?: string;
  price?: string;
  category?: string;
  description?: string;
  ingredients?: string;
  search?: string;
};

/** Parse `--ingredients "Name:Menge:Einheit,Name2:Menge2"` → AiDishIngredient[]. */
function parseIngredients(s?: string): Array<{ name: string; quantity: number; unit: string }> {
  if (!s) return [];
  return s
    .split(",")
    .map((part) => {
      const [name, qty, unit] = part.split(":").map((x) => x.trim());
      if (!name) return null;
      const u = (unit || "pc").toLowerCase();
      if (!VALID_UNITS.includes(u)) {
        throw new Error(`Ungueltige Einheit "${unit}" bei "${name}". Erlaubt: ${VALID_UNITS.join(", ")}.`);
      }
      return { name, quantity: qty ? Number(qty) : 1, unit: u };
    })
    .filter((i): i is { name: string; quantity: number; unit: string } => i !== null);
}

function priceLabel(p: RecipeRead["default_selling_price"]): string {
  if (p == null) return "—";
  return `${p} €`;
}

/**
 * `comvenio recipe <action> [id]` dispatcher (cac multi-word via dispatcher).
 * Gerichte (food) + Getraenke (drink) als supply-service Recipes anlegen/verwalten.
 */
export function registerRecipeCommands(cli: CAC): void {
  cli
    .command(
      "recipe <action> [id]",
      "Gerichte/Getraenke (Rezepte): create | from-template | list | show | update | delete",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--name <name>", "Name (create/update); custom_name (from-template)")
    .option("--type <t>", `Art: ${VALID_TYPES.join("|")} (Default food)`)
    .option("--price <eur>", "Verkaufspreis in Euro (z.B. 5.50); custom_price (from-template)")
    .option("--category <cat>", 'Kategorie (z.B. "Hauptgericht", "Getraenke")')
    .option("--description <text>", "Beschreibung (update)")
    .option("--ingredients <list>", 'Zutaten "Name:Menge:Einheit,..." — fehlende werden auto-angelegt (create)')
    .option("--search <q>", "Suchbegriff (list)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "create": {
          if (!opts.name) throw new Error("recipe create benoetigt --name.");
          const type = (opts.type ?? "food").toLowerCase();
          if (!VALID_TYPES.includes(type)) {
            throw new Error(`Ungueltiger Typ "${opts.type}". Erlaubt: ${VALID_TYPES.join(", ")}.`);
          }
          const body = prune({
            name: opts.name,
            type_of_recipe: type,
            category: opts.category,
            selling_price: opts.price != null ? Number(opts.price) : undefined,
            ingredients: parseIngredients(opts.ingredients),
            auto_create_missing_ingredients: true,
          });
          const r = await client.post<RecipeRead>(
            "supply",
            `/recipe/club/${clubId}/from-ai-dish`,
            body,
          );
          output(r, opts.json, () =>
            `Angelegt: ${r.name ?? opts.name} (${r.type_of_recipe ?? type}) — ${priceLabel(r.default_selling_price)} — ${r.id ?? "?"}`,
          );
          break;
        }

        case "from-template": {
          // Rezept aus einer GlobalDishTemplate instanziieren (vollstaendige Zutaten +
          // Preis + Kategorie, Allergene erben transitiv ueber die auto-angelegten Zutaten).
          // Idempotent: gleicher Name -> bestehendes Rezept, kein Duplikat.
          // Template-ID via `comvenio template dish --search "..."`.
          if (!id) {
            throw new Error(
              'recipe from-template <template_id> benoetigt eine Dish-Vorlagen-ID (siehe: comvenio template dish --search "...").',
            );
          }
          const body = prune({
            template_id: id,
            club_id: clubId,
            custom_price: opts.price != null ? Number(opts.price) : undefined,
            custom_name: opts.name,
            auto_create_missing_ingredients: true,
          });
          const r = await client.post<{
            recipe_id?: string;
            recipe_name?: string;
            created_ingredients?: string[];
            missing_ingredients?: string[];
            already_exists?: boolean;
            success?: boolean;
            error?: string;
          }>("supply", `/global-dish-templates/create-recipe`, body);
          output(r, opts.json, () => {
            const dup = r.already_exists ? " (bestand bereits)" : "";
            const miss = r.missing_ingredients?.length
              ? ` — fehlende Zutaten (kein Vorlagen-Match): ${r.missing_ingredients.join(", ")}`
              : "";
            return `Rezept aus Vorlage: ${r.recipe_name ?? "?"} — ${r.recipe_id ?? "?"}${dup}${miss}`;
          });
          break;
        }

        case "list": {
          const q = opts.search ? `?search=${encodeURIComponent(opts.search)}` : "";
          const recipes = await client.get<RecipeRead[]>("supply", `/recipe/club/${clubId}/recipes${q}`);
          output(recipes, opts.json, () =>
            Array.isArray(recipes) && recipes.length
              ? renderTable(recipes, [
                  { header: "Name", width: 30, get: (r) => String(r.name ?? "—") },
                  { header: "Art", width: 7, get: (r) => String(r.type_of_recipe ?? "—") },
                  { header: "Preis", width: 9, get: (r) => priceLabel(r.default_selling_price) },
                  { header: "Kategorie", width: 18, get: (r) => String(r.category ?? "—") },
                  { header: "ID", width: 36, get: (r) => String(r.id ?? "—") },
                ])
              : "Keine Rezepte.",
          );
          break;
        }

        case "show": {
          if (!id) throw new Error("recipe show <id> benoetigt eine Rezept-ID.");
          const r = await client.get<RecipeRead>("supply", `/recipe/club/${clubId}/recipes/${id}`);
          output(r, opts.json, () =>
            [
              `Name:      ${r.name ?? "—"}`,
              `Art:       ${r.type_of_recipe ?? "—"}`,
              `Preis:     ${priceLabel(r.default_selling_price)}`,
              `Kategorie: ${r.category ?? "—"}`,
              `ID:        ${r.id ?? id}`,
            ].join("\n"),
          );
          break;
        }

        case "update": {
          if (!id) throw new Error("recipe update <id> benoetigt eine Rezept-ID.");
          if (opts.type && !VALID_TYPES.includes(opts.type.toLowerCase())) {
            throw new Error(`Ungueltiger Typ "${opts.type}". Erlaubt: ${VALID_TYPES.join(", ")}.`);
          }
          const body = prune({
            name: opts.name,
            category: opts.category,
            description: opts.description,
            default_selling_price: opts.price != null ? Number(opts.price) : undefined,
            type_of_recipe: opts.type?.toLowerCase(),
          });
          if (Object.keys(body).length === 0) {
            throw new Error("recipe update braucht mind. ein Feld (--name/--price/--category/--type/--description).");
          }
          const r = await client.put<RecipeRead>("supply", `/recipe/club/${clubId}/recipes/${id}`, body);
          output(r, opts.json, () => `Aktualisiert: ${r.name ?? id} — ${priceLabel(r.default_selling_price)}.`);
          break;
        }

        case "delete": {
          if (!id) throw new Error("recipe delete <id> benoetigt eine Rezept-ID.");
          await client.del("supply", `/recipe/club/${clubId}/recipes/${id}`);
          output({ deleted: id }, opts.json, () => `Rezept geloescht: ${id}`);
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: create, from-template, list, show, update, delete`,
          );
      }
    });
}
