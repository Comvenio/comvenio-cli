import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readImageAsBase64 } from "../util/image.ts";
import { readJsonFile } from "../util/file.ts";

// KI-Gen Speisekarte (verified Sub-File 08). TWO modes (D-12):
//   generative `menu generate` → ai-service /menu-content/generate (Foto/Text)
//                                → review → --apply persists via supply
//   declarative `menu apply --file menu.json` → supply menus + items/bulk (+ design_config),
//                                               NO ai-service generator
//   `menu design --menu <id>` → ai /menu-design/generate → PUT supply menu design_config
// gateway keys: "ai" → ai-service, "supply" → supply-service.

type GeneratedDish = {
  name?: string;
  type_of_recipe?: string;
  category?: string;
  selling_price?: number | null;
  ingredients?: Array<{ name?: string; quantity?: number; unit?: string }>;
  [key: string]: unknown;
};
type MenuContentResponse = {
  session_id?: string;
  dishes?: GeneratedDish[];
  explanation?: string;
};
type MenuDesignResponse = {
  session_id?: string;
  design_config?: Record<string, unknown>;
  explanation?: string;
};
type MenuRead = { id?: string; [key: string]: unknown };
type BulkResponse = { total_created?: number; [key: string]: unknown };

type Opts = {
  json?: boolean;
  club?: string;
  photo?: string;
  text?: string;
  file?: string;
  menu?: string;
  menuName?: string;
  prompt?: string;
  apply?: boolean;
  // direct CRUD (create/show/add-item/delete)
  name?: string;
  description?: string;
  category?: string;
  recipe?: string;
  price?: string;
};

type MenuItemRead = {
  id?: string;
  name?: string;
  selling_price?: number | string | null;
  recipe_id?: string | null;
  display_order?: number;
  [key: string]: unknown;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `comvenio menu <action>` dispatcher (cac multi-word via dispatcher).
 *   menu generate --photo|--text [--apply]   (generative — ai-service)
 *   menu apply --file menu.json              (declarative — supply only)
 *   menu design --menu <id> --prompt "..."   (ai-service design → PUT menu)
 */
export function registerMenuCommands(cli: CAC): void {
  cli
    .command("menu <action> [id]", "Speisekarte: create | list | show | add-item | delete | generate (KI) | apply | design")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--photo <file>", "Foto/Scan einer Papier-/PDF-Karte (generate/design)")
    .option("--text <desc>", "Freitext-Beschreibung (generate)")
    .option("--file <path>", "menu.json: vom Agenten komponierte Karte (apply)")
    .option("--menu <id>", "Ziel-Menu (Pflicht bei design)")
    .option("--menu-name <name>", "Name der neuen Karte")
    .option("--name <name>", "Name der Karte (create) bzw. des Eintrags (add-item)")
    .option("--description <text>", "Beschreibung der Karte (create)")
    .option("--category <cat>", "Kategorie der Karte (create)")
    .option("--recipe <id>", "Rezept-ID fuer add-item")
    .option("--price <eur>", "Verkaufspreis fuer add-item (sonst Rezept-Default)")
    .option("--prompt <stil>", "Design-Stil (design)")
    .option("--apply", "Vorschlag wirklich anlegen (generate/design)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "generate": {
          if (!opts.photo && !opts.text) {
            throw new Error('menu generate benoetigt --photo <datei> oder --text "...".');
          }
          const body: Record<string, unknown> = { club_id: clubId };
          if (opts.text) body.prompt = opts.text;
          if (opts.photo) {
            const [b64, mime] = readImageAsBase64(opts.photo);
            body.image_data = b64;
            body.image_mime = mime;
          }
          // Stage 1: generate (synchronous, streaming=false → no SSE topic).
          const gen = await client.post<MenuContentResponse>(
            "ai",
            "/menu-content/generate?streaming=false",
            body,
          );
          if (!opts.apply) {
            // Review contract D-02: stage 1 writes NOTHING.
            output(gen, opts.json, () => formatDishes(gen));
            return;
          }
          if (!gen.dishes?.length) {
            throw new Error("Keine Gerichte erkannt — Foto/Beschreibung praezisieren.");
          }
          // Stage 2: persist — recipe per dish, then menu, then items/bulk.
          const recipeIds: string[] = [];
          for (const d of gen.dishes) {
            const r = await client.post<MenuRead>(
              "supply",
              `/recipe/club/${clubId}/from-ai-dish`,
              {
                name: d.name,
                type_of_recipe: d.type_of_recipe,
                category: d.category,
                selling_price: d.selling_price,
                ingredients: (d.ingredients ?? []).map((i) => ({
                  name: i.name,
                  quantity: i.quantity,
                  unit: i.unit,
                })),
                auto_create_missing_ingredients: true,
              },
            );
            if (r.id) recipeIds.push(r.id);
          }
          const menu = await client.post<MenuRead>("supply", `/menu/club/${clubId}/menus`, {
            name: opts.menuName ?? `KI-Speisekarte ${today()}`,
          });
          const itemsPayload = gen.dishes.map((d, idx) => ({
            menu_id: menu.id,
            recipe_id: recipeIds[idx] ?? null,
            name: d.name,
            selling_price: d.selling_price ?? null,
            display_order: idx,
          }));
          const bulk = await client.post<BulkResponse>(
            "supply",
            `/menu/club/${clubId}/items/bulk`,
            itemsPayload,
          );
          output(
            { menu_id: menu.id, recipes: recipeIds.length, items: bulk.total_created ?? itemsPayload.length },
            opts.json,
            () =>
              `Karte angelegt: ${menu.id} (${recipeIds.length} Rezepte, ${bulk.total_created ?? itemsPayload.length} Gerichte).`,
          );
          break;
        }

        case "apply": {
          // Declarative (D-12): agent composes the card, CLI posts to supply only.
          if (!opts.file) {
            throw new Error("menu apply benoetigt --file <menu.json> (vom Agenten komponierte Karte).");
          }
          const card = readJsonFile<{
            name?: string;
            description?: string;
            category?: string;
            items?: Array<Record<string, unknown>>;
            design_config?: Record<string, unknown>;
          }>(opts.file);
          const items = card.items ?? [];
          if (!Array.isArray(items) || items.length === 0) {
            throw new Error("menu.json braucht mindestens ein item (items[]).");
          }
          const menu = await client.post<MenuRead>(
            "supply",
            `/menu/club/${clubId}/menus`,
            prune({
              name: card.name ?? opts.menuName ?? `KI-Speisekarte ${today()}`,
              description: card.description,
              category: card.category,
            }),
          );
          const payload = items.map((it, idx) => ({
            menu_id: menu.id,
            recipe_id: it.recipe_id ?? null,
            name: it.name,
            selling_price: it.selling_price ?? null,
            display_order: it.display_order ?? idx,
          }));
          const bulk = await client.post<BulkResponse>(
            "supply",
            `/menu/club/${clubId}/items/bulk`,
            payload,
          );
          let designApplied = false;
          if (card.design_config) {
            await client.put("supply", `/menu/club/${clubId}/menus/${menu.id}`, {
              design_config: card.design_config,
            });
            designApplied = true;
          }
          output(
            {
              menu_id: menu.id,
              items: bulk.total_created ?? payload.length,
              design: designApplied,
            },
            opts.json,
            () =>
              `Karte angelegt: ${menu.id} (${bulk.total_created ?? payload.length} Gerichte${designApplied ? ", Design gesetzt" : ""}).`,
          );
          break;
        }

        case "design": {
          if (!opts.menu) {
            throw new Error("menu design benoetigt --menu <menu_id> (MenuDesignGenerateRequest.menu_id).");
          }
          const body: Record<string, unknown> = {
            club_id: clubId,
            menu_id: opts.menu,
            prompt: opts.prompt ?? "",
          };
          if (opts.photo) {
            const [b64, mime] = readImageAsBase64(opts.photo);
            body.image_data = b64;
            body.image_mime = mime;
          }
          const res = await client.post<MenuDesignResponse>(
            "ai",
            "/menu-design/generate?streaming=false",
            body,
          );
          if (!opts.apply) {
            output(res, opts.json, () => res.explanation ?? "Design-Vorschlag erhalten (ohne --apply nicht angewendet).");
            return;
          }
          await client.put("supply", `/menu/club/${clubId}/menus/${opts.menu}`, {
            design_config: res.design_config,
          });
          output({ menu_id: opts.menu, applied: true }, opts.json, () =>
            `Design auf Karte ${opts.menu} angewendet.`,
          );
          break;
        }

        case "create": {
          // Deterministisch: der Agent komponiert die Karte, CLI POSTet direkt an
          // supply (KEIN ai-service). Items danach via `menu add-item`.
          if (!opts.name && !opts.menuName) {
            throw new Error("menu create benoetigt --name.");
          }
          const menu = await client.post<MenuRead>(
            "supply",
            `/menu/club/${clubId}/menus`,
            prune({
              name: opts.name ?? opts.menuName,
              description: opts.description,
              category: opts.category,
            }),
          );
          output(menu, opts.json, () => `Speisekarte angelegt: ${opts.name ?? opts.menuName} — ${menu.id ?? "?"}`);
          break;
        }

        case "list": {
          const menus = await client.get<MenuRead[]>("supply", `/menu/club/${clubId}/menus`);
          output(menus, opts.json, () =>
            Array.isArray(menus) && menus.length
              ? renderTable(menus, [
                  { header: "Name", width: 30, get: (m) => String(m.name ?? "—") },
                  { header: "Kategorie", width: 18, get: (m) => String((m as Record<string, unknown>).category ?? "—") },
                  { header: "ID", width: 36, get: (m) => String(m.id ?? "—") },
                ])
              : "Keine Speisekarten.",
          );
          break;
        }

        case "show": {
          if (!id) throw new Error("menu show <menu_id> benoetigt eine Menu-ID.");
          const menu = await client.get<MenuRead>("supply", `/menu/club/${clubId}/menus/${id}`);
          output(menu, opts.json, () => {
            const items = ((menu as Record<string, unknown>).items as MenuItemRead[] | undefined) ?? [];
            const lines = [`Speisekarte: ${menu.name ?? "—"} (${menu.id ?? id})`];
            for (const it of items) {
              const price = it.selling_price != null ? ` — ${it.selling_price} €` : "";
              lines.push(`  - ${it.name ?? "?"}${price}`);
            }
            if (items.length === 0) lines.push("  (keine Eintraege)");
            return lines.join("\n");
          });
          break;
        }

        case "add-item": {
          // Rezept (recipe) auf eine Speisekarte setzen. Name/Preis aus dem Rezept,
          // falls nicht angegeben. Deterministisch (supply direkt).
          if (!id) throw new Error("menu add-item <menu_id> benoetigt eine Menu-ID.");
          let itemName = opts.name;
          let price = opts.price != null ? Number(opts.price) : undefined;
          if (opts.recipe && (!itemName || price === undefined)) {
            const r = await client.get<{ name?: string; default_selling_price?: number | string | null }>(
              "supply",
              `/recipe/club/${clubId}/recipes/${opts.recipe}`,
            );
            if (!itemName) itemName = r.name;
            if (price === undefined && r.default_selling_price != null) price = Number(r.default_selling_price);
          }
          if (!itemName) {
            throw new Error("menu add-item benoetigt --name (oder --recipe, dessen Name uebernommen wird).");
          }
          const item = await client.post<MenuItemRead>(
            "supply",
            `/menu/club/${clubId}/menus/${id}/items`,
            prune({
              menu_id: id,
              recipe_id: opts.recipe,
              name: itemName,
              selling_price: price,
            }),
          );
          output(item, opts.json, () =>
            `Auf Karte gesetzt: ${itemName}${price != null ? ` — ${price} €` : ""} (${item.id ?? "?"}).`,
          );
          break;
        }

        case "delete": {
          if (!id) throw new Error("menu delete <menu_id> benoetigt eine Menu-ID.");
          await client.del("supply", `/menu/club/${clubId}/menus/${id}`);
          output({ deleted: id }, opts.json, () => `Speisekarte geloescht: ${id}`);
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: create, list, show, add-item, delete, generate, apply, design`,
          );
      }
    });
}

function formatDishes(gen: MenuContentResponse): string {
  if (!gen.dishes?.length) return gen.explanation ?? "Keine Gerichte erkannt.";
  const lines = gen.dishes.map((d) => {
    const price = d.selling_price != null ? ` — ${d.selling_price} €` : "";
    return `- ${d.name ?? "?"} (${d.type_of_recipe ?? "?"})${price}`;
  });
  return [gen.explanation ?? "Vorschlag:", ...lines].join("\n");
}
