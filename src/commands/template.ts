import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";

// Globale Vorlagen (supply-service, BaseModelWithoutClub — club-unabhaengig, vorgeseedet):
//   GlobalDishTemplate (69)        -> fertige Gerichte MIT Rezept-JSON (Zutaten + Mengen)
//   GlobalIngredientTemplate (381) -> Basis-Zutaten MIT allergen_types/colorant_types
// Routen liegen TOP-LEVEL (KEIN /recipe-Prefix), verifiziert an routes/__init__.py:
//   GET /global-dish-templates/?search=&category=&common_only=&limit=     (JWT)
//   GET /global-ingredient-templates/?search=&common_only=&limit=         (JWT)
// Eine Dish-Vorlage instanziiert man via `comvenio recipe from-template <id>`
//   (POST /global-dish-templates/create-recipe) — erbt Allergene transitiv.
// gateway key: "supply" -> supply-service.

type DishTemplate = {
  id?: string;
  name?: string;
  category?: string | null;
  suggested_price?: number | string | null;
  type_of_recipe?: string;
  icon?: string | null;
  [key: string]: unknown;
};

type IngredientTemplate = {
  id?: string;
  name?: string;
  unit?: string;
  // Read-Response liefert ein Array; DB-Spalte ist JSON-Text -> defensiv beide zulassen.
  allergen_types?: string[] | string | null;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  search?: string;
  category?: string;
  common?: boolean;
  limit?: string;
};

/**
 * `allergen_types` -> "gluten,..." fuer die Tabelle. Die Read-Response liefert ein echtes
 * Array (DB-Spalte ist JSON-Text, wird aber deserialisiert zurueckgegeben); zur Sicherheit
 * wird auch ein roher JSON-String akzeptiert.
 */
function allergenLabel(raw: unknown): string {
  if (Array.isArray(raw)) return raw.length ? raw.join(",") : "—";
  if (typeof raw === "string" && raw.trim()) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr.join(",") : "—";
    } catch {
      return raw;
    }
  }
  return "—";
}

/**
 * `comvenio template <kind>` — globale Vorlagen durchsuchen (read-only).
 *   template dish [--search <q>] [--category <c>] [--common]
 *   template ingredient [--search <q>] [--common]
 * Liefert IDs, mit denen `recipe from-template <id>` ein Rezept instanziiert.
 */
export function registerTemplateCommands(cli: CAC): void {
  cli
    .command("template <kind> [id]", "Globale Vorlagen durchsuchen/anzeigen: dish | ingredient")
    .option("--search <q>", "Suchbegriff (Name/Beschreibung/Kategorie)")
    .option("--category <c>", "Kategorie-Filter (nur dish, z.B. Grill/Hauptgericht)")
    .option("--common", "Nur haeufig genutzte Vorlagen (common_only)")
    .option("--limit <n>", "Max. Treffer (1-500, Default 100)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (kind: string, id: string | undefined, opts: Opts) => {
      const state = await loadState();
      const client = createClient(state);

      const q = new URLSearchParams();
      if (opts.search) q.set("search", opts.search);
      if (opts.common) q.set("common_only", "true");
      if (opts.limit) q.set("limit", opts.limit);

      switch (kind) {
        case "dish": {
          if (id) {
            const row = await client.get<DishTemplate>("supply", `/global-dish-templates/${id}`);
            output(row, opts.json, () => JSON.stringify(row, null, 2));
            break;
          }
          if (opts.category) q.set("category", opts.category);
          const qs = q.toString() ? `?${q}` : "";
          const rows = await client.get<DishTemplate[]>("supply", `/global-dish-templates/${qs}`);
          output(rows, opts.json, () =>
            Array.isArray(rows) && rows.length
              ? renderTable(rows, [
                  { header: "Name", width: 44, get: (r) => String(r.name ?? "—") },
                  { header: "Kategorie", width: 16, get: (r) => String(r.category ?? "—") },
                  { header: "Art", width: 6, get: (r) => String(r.type_of_recipe ?? "—") },
                  { header: "Preis", width: 8, get: (r) => (r.suggested_price != null ? `${r.suggested_price} €` : "—") },
                  { header: "ID", width: 36, get: (r) => String(r.id ?? "—") },
                ])
              : "Keine Dish-Vorlagen gefunden.",
          );
          break;
        }

        case "ingredient": {
          if (id) {
            const row = await client.get<IngredientTemplate>("supply", `/global-ingredient-templates/${id}`);
            output(row, opts.json, () => JSON.stringify(row, null, 2));
            break;
          }
          const qs = q.toString() ? `?${q}` : "";
          const rows = await client.get<IngredientTemplate[]>("supply", `/global-ingredient-templates/${qs}`);
          output(rows, opts.json, () =>
            Array.isArray(rows) && rows.length
              ? renderTable(rows, [
                  { header: "Name", width: 34, get: (r) => String(r.name ?? "—") },
                  { header: "Einheit", width: 8, get: (r) => String(r.unit ?? "—") },
                  { header: "Allergene", width: 26, get: (r) => allergenLabel(r.allergen_types) },
                  { header: "ID", width: 36, get: (r) => String(r.id ?? "—") },
                ])
              : "Keine Zutaten-Vorlagen gefunden.",
          );
          break;
        }

        default:
          throw new Error(`Unbekannte Vorlagen-Art "${kind}". Verfuegbar: dish, ingredient`);
      }
    });
}
