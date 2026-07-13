import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

type IngredientRead = {
  id?: string;
  name?: string;
  unit?: string;
  cost_per_unit?: number | string | null;
  supplier?: string | null;
  [key: string]: unknown;
};

export type IngredientCommandOpts = {
  json?: boolean;
  club?: string;
  file?: string;
  search?: string;
  category?: string;
  skip?: string;
  limit?: string;
};

function jsonObject(path: string | undefined, command: string): Record<string, unknown> {
  if (!path) throw new Error(`${command} benötigt --file <payload.json>.`);
  const body = readJsonFile<unknown>(path);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${command}: JSON-Payload muss ein Objekt sein.`);
  }
  return body as Record<string, unknown>;
}

function positiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} erwartet eine ganze Zahl >= 0.`);
  return parsed;
}

function ingredientTable(rows: IngredientRead[]): string {
  if (!rows.length) return "Keine Zutaten.";
  return renderTable(rows, [
    { header: "Name", width: 30, get: (row) => String(row.name ?? "-") },
    { header: "Einheit", width: 9, get: (row) => String(row.unit ?? "-") },
    { header: "Kosten", width: 10, get: (row) => String(row.cost_per_unit ?? "-") },
    { header: "Lieferant", width: 22, get: (row) => String(row.supplier ?? "-") },
    { header: "ID", width: 36, get: (row) => String(row.id ?? "-") },
  ]);
}

export async function handleIngredientOperation(args: {
  action: string;
  id?: string;
  opts: IngredientCommandOpts;
  client: ComvenioClient;
  clubId: string;
}): Promise<void> {
  const { action, id, opts, client, clubId } = args;

  switch (action) {
    case "list": {
      const query = new URLSearchParams();
      if (opts.search) query.set("search", opts.search);
      if (opts.category) query.set("category_id", opts.category);
      const skip = positiveInt(opts.skip, "--skip");
      const limit = positiveInt(opts.limit, "--limit");
      if (skip !== undefined) query.set("skip", String(skip));
      if (limit !== undefined) {
        if (limit < 1 || limit > 1000) throw new Error("--limit erwartet eine Zahl von 1 bis 1000.");
        query.set("limit", String(limit));
      }
      const suffix = query.size ? `?${query.toString()}` : "";
      const rows = await client.get<IngredientRead[]>(
        "supply",
        `/ingredients/club/${clubId}/ingredients${suffix}`,
      );
      output(rows, opts.json, () => ingredientTable(rows));
      return;
    }

    case "show": {
      if (!id) throw new Error("ingredient show <id> benötigt eine Zutaten-ID.");
      const row = await client.get<IngredientRead>("supply", `/ingredients/${id}`);
      output(row, opts.json, () => JSON.stringify(row, null, 2));
      return;
    }

    case "create": {
      const body = jsonObject(opts.file, "ingredient create");
      const row = await client.post<IngredientRead>("supply", `/ingredients/club/${clubId}`, body);
      output(row, opts.json, () => `Zutat angelegt: ${row.name ?? row.id ?? "?"}`);
      return;
    }

    case "update": {
      if (!id) throw new Error("ingredient update <id> benötigt eine Zutaten-ID.");
      const row = await client.put<IngredientRead>(
        "supply",
        `/ingredients/${id}`,
        jsonObject(opts.file, "ingredient update"),
      );
      output(row, opts.json, () => `Zutat aktualisiert: ${row.name ?? id}`);
      return;
    }

    case "delete": {
      if (!id) throw new Error("ingredient delete <id> benötigt eine Zutaten-ID.");
      await client.del("supply", `/ingredients/${id}`);
      output({ deleted: id }, opts.json, () => `Zutat gelöscht: ${id}`);
      return;
    }

    default:
      throw new Error(`Unbekannte Aktion "${action}". Verfügbar: list, show, create, update, delete`);
  }
}

export function registerIngredientCommands(cli: CAC): void {
  cli
    .command("ingredient <action> [id]", "Club-Zutaten: list | show | create | update | delete")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--file <path>", "JSON-Payload für create/update")
    .option("--search <text>", "Name/Beschreibung durchsuchen (list)")
    .option("--category <id>", "Nach Zutatenkategorie filtern (inkl. Unterkategorien)")
    .option("--skip <n>", "Treffer überspringen (list)")
    .option("--limit <n>", "Max. Treffer 1-1000 (list)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: IngredientCommandOpts) => {
      const state = loadState();
      await handleIngredientOperation({
        action,
        id,
        opts,
        client: createClient(state),
        clubId: requireClubId(state, opts.club),
      });
    });
}
