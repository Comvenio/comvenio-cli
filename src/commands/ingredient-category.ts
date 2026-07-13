import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

type CategoryRead = {
  id?: string;
  name?: string;
  category_type?: string;
  parent_id?: string | null;
  is_active?: boolean;
  [key: string]: unknown;
};

export type IngredientCategoryCommandOpts = {
  json?: boolean;
  club?: string;
  file?: string;
  type?: string;
  parent?: string;
  category?: string;
  includeInactive?: boolean;
  hard?: boolean;
};

function jsonObject(path: string | undefined, command: string): Record<string, unknown> {
  if (!path) throw new Error(`${command} benötigt --file <payload.json>.`);
  const body = readJsonFile<unknown>(path);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${command}: JSON-Payload muss ein Objekt sein.`);
  }
  return body as Record<string, unknown>;
}

function categoryQuery(opts: IngredientCategoryCommandOpts): string {
  const query = new URLSearchParams();
  if (opts.type) query.set("category_type", opts.type);
  if (opts.parent) query.set("parent_id", opts.parent);
  query.set("active_only", String(!opts.includeInactive));
  return `?${query.toString()}`;
}

function categoryTable(rows: CategoryRead[]): string {
  if (!rows.length) return "Keine Zutatenkategorien.";
  return renderTable(rows, [
    { header: "Name", width: 30, get: (row) => String(row.name ?? "-") },
    { header: "Typ", width: 16, get: (row) => String(row.category_type ?? "-") },
    { header: "Parent", width: 36, get: (row) => String(row.parent_id ?? "-") },
    { header: "Aktiv", width: 6, get: (row) => (row.is_active === false ? "nein" : "ja") },
    { header: "ID", width: 36, get: (row) => String(row.id ?? "-") },
  ]);
}

export async function handleIngredientCategoryOperation(args: {
  action: string;
  id?: string;
  opts: IngredientCategoryCommandOpts;
  client: ComvenioClient;
  clubId: string;
}): Promise<void> {
  const { action, id, opts, client, clubId } = args;

  switch (action) {
    case "list": {
      const rows = await client.get<CategoryRead[]>(
        "supply",
        `/ingredient-categories/by-club/${clubId}${categoryQuery(opts)}`,
      );
      output(rows, opts.json, () => categoryTable(rows));
      return;
    }

    case "roots": {
      const query = new URLSearchParams();
      if (opts.type) query.set("category_type", opts.type);
      query.set("active_only", String(!opts.includeInactive));
      const rows = await client.get<CategoryRead[]>(
        "supply",
        `/ingredient-categories/by-club/${clubId}/roots?${query.toString()}`,
      );
      output(rows, opts.json, () => categoryTable(rows));
      return;
    }

    case "tree": {
      const query = new URLSearchParams();
      if (opts.type) query.set("category_type", opts.type);
      query.set("active_only", String(!opts.includeInactive));
      const rows = await client.get<CategoryRead[]>(
        "supply",
        `/ingredient-categories/by-club/${clubId}/tree?${query.toString()}`,
      );
      output(rows, opts.json, () => JSON.stringify(rows, null, 2));
      return;
    }

    case "by-ingredient": {
      if (!id) throw new Error("ingredient-category by-ingredient <ingredient-id> benötigt eine Zutaten-ID.");
      const rows = await client.get<CategoryRead[]>("supply", `/ingredient-categories/by-ingredient/${id}`);
      output(rows, opts.json, () => categoryTable(rows));
      return;
    }

    case "show": {
      if (!id) throw new Error("ingredient-category show <id> benötigt eine Kategorie-ID.");
      const row = await client.get<CategoryRead>("supply", `/ingredient-categories/${id}`);
      output(row, opts.json, () => JSON.stringify(row, null, 2));
      return;
    }

    case "create": {
      const body = { ...jsonObject(opts.file, "ingredient-category create"), club_id: clubId };
      const row = await client.post<CategoryRead>("supply", "/ingredient-categories/", body);
      output(row, opts.json, () => `Zutatenkategorie angelegt: ${row.name ?? row.id ?? "?"}`);
      return;
    }

    case "update": {
      if (!id) throw new Error("ingredient-category update <id> benötigt eine Kategorie-ID.");
      const row = await client.put<CategoryRead>(
        "supply",
        `/ingredient-categories/${id}`,
        jsonObject(opts.file, "ingredient-category update"),
      );
      output(row, opts.json, () => `Zutatenkategorie aktualisiert: ${row.name ?? id}`);
      return;
    }

    case "delete": {
      if (!id) throw new Error("ingredient-category delete <id> benötigt eine Kategorie-ID.");
      await client.del("supply", `/ingredient-categories/${id}?hard_delete=${Boolean(opts.hard)}`);
      output({ deleted: id, hard_delete: Boolean(opts.hard) }, opts.json, () =>
        opts.hard ? `Zutatenkategorie endgültig gelöscht: ${id}` : `Zutatenkategorie deaktiviert: ${id}`,
      );
      return;
    }

    case "assign":
    case "unassign": {
      if (!id || !opts.category) {
        throw new Error(`ingredient-category ${action} <ingredient-id> benötigt --category <id>.`);
      }
      await client.post("supply", `/ingredient-categories/${action}`, {
        ingredient_id: id,
        category_id: opts.category,
      });
      output(
        { ingredient_id: id, category_id: opts.category, assigned: action === "assign" },
        opts.json,
        () => action === "assign" ? "Kategorie zugewiesen." : "Kategorie-Zuweisung entfernt.",
      );
      return;
    }

    case "init": {
      const result = await client.post<Record<string, unknown>>(
        "supply",
        `/ingredient-categories/initialize/${clubId}`,
      );
      output(result, opts.json, () => String(result.message ?? "Standardkategorien initialisiert."));
      return;
    }

    default:
      throw new Error(
        `Unbekannte Aktion "${action}". Verfügbar: list, roots, tree, by-ingredient, show, create, update, delete, assign, unassign, init`,
      );
  }
}

export function registerIngredientCategoryCommands(cli: CAC): void {
  cli
    .command(
      "ingredient-category <action> [id]",
      "Zutatenkategorien: list | roots | tree | by-ingredient | show | create | update | delete | assign | unassign | init",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--file <path>", "JSON-Payload für create/update")
    .option("--type <type>", "Kategorie-Typ filtern")
    .option("--parent <id>", "Parent-ID filtern (list)")
    .option("--category <id>", "Kategorie-ID für assign/unassign")
    .option("--include-inactive", "Auch deaktivierte Kategorien lesen")
    .option("--hard", "Kategorie beim delete endgültig statt soft löschen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: IngredientCategoryCommandOpts) => {
      const state = loadState();
      await handleIngredientCategoryOperation({
        action,
        id,
        opts,
        client: createClient(state),
        clubId: requireClubId(state, opts.club),
      });
    });
}
