import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readImageAsBase64 } from "../util/image.ts";
import { readJsonFile } from "../util/file.ts";
import { mkdirSync, readFileSync } from "node:fs";
import { frontendBase, hasPlaywrightCli, renderMenuToPdf } from "../util/render.ts";

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
  css?: string;
  // export
  out?: string;
  all?: boolean;
  wait?: string;
  frontendBase?: string;
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
    .command("menu <action> [id]", "Speisekarte (deklarativ, kein Backend-LLM): create | list | show | add-item | update-item | delete-item | delete | style | apply")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--photo <file>", "Foto/Scan einer Papier-/PDF-Karte (generate/design)")
    .option("--text <desc>", "Freitext-Beschreibung (generate)")
    .option("--file <path>", "menu.json: vom Agenten komponierte Karte (apply)")
    .option("--menu <id>", "Ziel-Menu (Pflicht bei design)")
    .option("--menu-name <name>", "Name der neuen Karte")
    .option("--name <name>", "Name der Karte (create) bzw. des Eintrags (add-item)")
    .option("--description <text>", "Beschreibung der Karte (create) bzw. des Eintrags (add-item/update-item, Item-Override)")
    .option("--category <cat>", "Kategorie der Karte (create)")
    .option("--recipe <id>", "Rezept-ID fuer add-item")
    .option("--price <eur>", "Verkaufspreis fuer add-item (sonst Rezept-Default)")
    .option("--css <file>", "CSS-Datei fuer 'style' (design_config.custom_css, frei stylbar)")
    .option("--prompt <stil>", "Design-Stil (design)")
    .option("--apply", "Vorschlag wirklich anlegen (generate/design)")
    .option("--out <dir>", "export: Zielordner (Default .menu-export)")
    .option("--all", "export: alle Club-Menues (statt einer <menu_id>)")
    .option("--wait <ms>", "export: Render-Wartezeit in ms (Default 9000)")
    .option("--frontend-base <url>", "export: Frontend-Basis ueberschreiben (z. B. http://localhost:5173)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "generate": {
          // Product doctrine: this CLI NEVER calls the backend LLM.
          // The operating agent (Claude/Codex) IS the intelligence — it reads the
          // photo/text itself and composes the card declaratively.
          throw new Error(
            [
              '"menu generate" wurde entfernt: Das CLI ruft NIEMALS das Backend-LLM — der bedienende Agent liest Foto/Text selbst und komponiert deklarativ.',
              "Deklarativer Weg:",
              "  1) comvenio schema menu               — gueltige Felder/Enums",
              "  2) comvenio recipe create ... / comvenio template dish (Vorlagen)",
              "  3) comvenio menu create + menu add-item (oder menu apply --file)",
            ].join("\n"),
          );
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
          // Product doctrine: no backend LLM — the agent composes the
          // design_config itself and writes it via `menu style`.
          throw new Error(
            [
              '"menu design" wurde entfernt: Das CLI ruft NIEMALS das Backend-LLM — der bedienende Agent komponiert die design_config selbst.',
              "Deklarativer Weg: comvenio schema design (Vokabular) → comvenio menu style --menu <id> --file design.json",
            ].join("\n"),
          );
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
            // Read-Model ist MenuWithItemsRead -> Feld heisst `menu_items` (nicht `items`),
            // verifiziert an schemas/menu.py.
            const items = ((menu as Record<string, unknown>).menu_items as MenuItemRead[] | undefined) ?? [];
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
          // Single-Item-Route ist /menu/club/{club_id}/items (menu_id im Body) —
          // NICHT /menus/{id}/items (existiert nicht, verifiziert an routes/menu.py:294).
          const item = await client.post<MenuItemRead>(
            "supply",
            `/menu/club/${clubId}/items`,
            prune({
              menu_id: id,
              recipe_id: opts.recipe,
              name: itemName,
              selling_price: price,
              description: opts.description, // Item-Override (Option B: Praesentation = MenuItem-Master)
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

        case "update-item": {
          // Bestehenden Eintrag aendern (Preis/Label). Item-IDs via `menu show <menu_id> --json`.
          // Endpoint: PUT /menu/items/{menu_item_id} (MenuItemUpdate: name/selling_price/display_order).
          if (!id) throw new Error("menu update-item <item_id> benoetigt eine Item-ID (siehe: menu show <menu_id> --json).");
          const body = prune({
            name: opts.name,
            selling_price: opts.price != null ? Number(opts.price) : undefined,
            description: opts.description, // Item-Override (Option B: Praesentation = MenuItem-Master)
          });
          if (Object.keys(body).length === 0) {
            throw new Error("menu update-item braucht --price, --name und/oder --description.");
          }
          const item = await client.put<MenuItemRead>("supply", `/menu/items/${id}`, body);
          output(item, opts.json, () =>
            `Eintrag aktualisiert: ${item.name ?? opts.name ?? id}${opts.price != null ? ` — ${opts.price} €` : ""}.`,
          );
          break;
        }

        case "delete-item": {
          // Einzelnen Eintrag von einer Karte entfernen. Endpoint: DELETE /menu/items/{menu_item_id}.
          if (!id) throw new Error("menu delete-item <item_id> benoetigt eine Item-ID.");
          await client.del("supply", `/menu/items/${id}`);
          output({ deleted: id }, opts.json, () => `Eintrag geloescht: ${id}`);
          break;
        }

        case "style": {
          // Frei konfigurierbares CSS auf eine bestehende Karte (design_config.custom_css).
          // GET -> merge -> PUT, damit andere design_config-Knobs erhalten bleiben.
          // Deterministisch, der Agent komponiert das CSS (KI-Traeger, kein ai-service).
          if (!id) throw new Error("menu style <menu_id> benoetigt eine Menu-ID.");
          if (!opts.css) throw new Error("menu style benoetigt --css <datei> (CSS-Datei).");
          const css = readFileSync(opts.css, "utf-8");
          const existing = await client.get<MenuRead>("supply", `/menu/club/${clubId}/menus/${id}`);
          const design = {
            ...(((existing as Record<string, unknown>).design_config as Record<string, unknown>) ?? {}),
            custom_css: css,
          };
          await client.put("supply", `/menu/club/${clubId}/menus/${id}`, { design_config: design });
          output({ menu_id: id, css_bytes: css.length }, opts.json, () =>
            `CSS gesetzt auf Karte ${id} (${css.length} Zeichen). Im Browser pruefen.`,
          );
          break;
        }

        case "export": {
          // Rendert die oeffentliche Menue-Druckseite (/clubs/{club}/menu/{id}/print) headless
          // zu einem themed A4-PDF (+ PNG-Preview). Seitenzahl == 1 -> passt auf eine A4.
          if (!(await hasPlaywrightCli())) {
            throw new Error(
              "playwright-cli nicht auf dem PATH. Installiere @playwright/cli (npm i -g @playwright/cli) + einmalig `playwright-cli install`.",
            );
          }
          const fb = frontendBase(state.environment, opts.frontendBase);
          const outDir = opts.out ?? ".menu-export";
          mkdirSync(outDir, { recursive: true });
          const waitMs = opts.wait ? Math.max(0, parseInt(opts.wait, 10) || 0) : 9000;

          const menus: Array<{ id?: string; name?: string }> =
            id && !opts.all
              ? [{ id }]
              : await client.get<MenuRead[]>("supply", `/menu/club/${clubId}/menus`);
          if (menus.length === 0) {
            output({ ok: true, menus: 0 }, opts.json, () => "Keine Menues — nichts zu exportieren.");
            return;
          }

          const results: Array<{
            id?: string;
            name?: string;
            pdf?: string;
            png?: string;
            pages?: number;
            error?: string;
          }> = [];
          for (const mu of menus) {
            const label = String(mu.name ?? mu.id ?? "menu");
            const slug =
              label.toLowerCase().replace(/[^a-z0-9\u00e4\u00f6\u00fc\u00df]+/gi, "-").replace(/(^-|-$)/g, "") ||
              "menu";
            const url = `${fb}/clubs/${clubId}/menu/${mu.id}/print`;
            const pdfPath = `${outDir}/${slug}.pdf`;
            const pngPath = `${outDir}/${slug}.png`;
            try {
              const { pages } = await renderMenuToPdf(url, pdfPath, pngPath, { waitMs });
              results.push({ id: mu.id, name: label, pdf: pdfPath, png: pngPath, pages });
            } catch (e) {
              results.push({ id: mu.id, name: label, error: (e as Error)?.message ?? "Fehler" });
            }
          }

          output({ out: outDir, results }, opts.json, () =>
            [`Export -> ${outDir}`].concat(
              results.map((rr) =>
                rr.error
                  ? `  x ${rr.name}: ${rr.error}`
                  : `  ${rr.pages === 1 ? "[1 A4]" : "[" + rr.pages + " Seiten]"}  ${rr.name} -> ${rr.pdf}`,
              ),
            ).join("\n"),
          );
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: create, list, show, add-item, update-item, delete-item, delete, style, generate, apply, design, export`,
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
