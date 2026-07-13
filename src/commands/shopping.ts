import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";
import { prune } from "../util/body.ts";

type ShoppingListRead = {
  id?: string;
  name?: string;
  status?: string;
  context_type?: string;
  context_id?: string;
  is_completed?: boolean;
  total_estimated_cost?: number | string;
  [key: string]: unknown;
};

export type ShoppingCommandOpts = {
  json?: boolean;
  club?: string;
  file?: string;
  search?: string;
  status?: string;
  skip?: string;
  limit?: string;
  contextId?: string;
  contextType?: string;
  portions?: string;
  name?: string;
  description?: string;
  purchased?: string;
};

function jsonObject(path: string | undefined, command: string): Record<string, unknown> {
  if (!path) throw new Error(`${command} benötigt --file <payload.json>.`);
  const body = readJsonFile<unknown>(path);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${command}: JSON-Payload muss ein Objekt sein.`);
  }
  return body as Record<string, unknown>;
}

function integer(value: string | undefined, flag: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} erwartet eine ganze Zahl von ${min} bis ${max}.`);
  }
  return parsed;
}

function bool(value: string | undefined, flag: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} erwartet true oder false.`);
}

function shoppingTable(rows: ShoppingListRead[]): string {
  if (!rows.length) return "Keine Einkaufslisten.";
  return renderTable(rows, [
    { header: "Name", width: 30, get: (row) => String(row.name ?? "-") },
    { header: "Status", width: 11, get: (row) => String(row.status ?? "-") },
    { header: "Kontext", width: 10, get: (row) => String(row.context_type ?? "-") },
    { header: "Kosten", width: 10, get: (row) => String(row.total_estimated_cost ?? "-") },
    { header: "ID", width: 36, get: (row) => String(row.id ?? "-") },
  ]);
}

export async function handleShoppingOperation(args: {
  action: string;
  id?: string;
  opts: ShoppingCommandOpts;
  client: ComvenioClient;
  clubId: string;
}): Promise<void> {
  const { action, id, opts, client, clubId } = args;

  switch (action) {
    case "list": {
      const query = new URLSearchParams();
      if (opts.search) query.set("search", opts.search);
      if (opts.status) query.set("status", opts.status);
      const skip = integer(opts.skip, "--skip", 0, Number.MAX_SAFE_INTEGER);
      const limit = integer(opts.limit, "--limit", 1, 1000);
      if (skip !== undefined) query.set("skip", String(skip));
      if (limit !== undefined) query.set("limit", String(limit));
      const suffix = query.size ? `?${query.toString()}` : "";
      const rows = await client.get<ShoppingListRead[]>("supply", `/shopping/club/${clubId}/lists${suffix}`);
      output(rows, opts.json, () => shoppingTable(rows));
      return;
    }

    case "active":
    case "completed": {
      const rows = await client.get<ShoppingListRead[]>(
        "supply",
        `/shopping/club/${clubId}/lists/${action}`,
      );
      output(rows, opts.json, () => shoppingTable(rows));
      return;
    }

    case "by-context": {
      if (!opts.contextId) throw new Error("shopping by-context benötigt --context-id <id>.");
      const rows = await client.get<ShoppingListRead[]>(
        "supply",
        `/shopping/club/${clubId}/shopping-lists/${opts.contextId}`,
      );
      output(rows, opts.json, () => shoppingTable(rows));
      return;
    }

    case "by-context-type": {
      if (!opts.contextType) throw new Error("shopping by-context-type benötigt --context-type <type>.");
      const rows = await client.get<ShoppingListRead[]>(
        "supply",
        `/shopping/club/${clubId}/shopping-lists/context-type/${encodeURIComponent(opts.contextType)}`,
      );
      output(rows, opts.json, () => shoppingTable(rows));
      return;
    }

    case "show": {
      if (!id) throw new Error("shopping show <id> benötigt eine Einkaufslisten-ID.");
      const row = await client.get<ShoppingListRead>("supply", `/shopping/lists/${id}`);
      output(row, opts.json, () => JSON.stringify(row, null, 2));
      return;
    }

    case "create": {
      const row = await client.post<ShoppingListRead>(
        "supply",
        `/shopping/club/${clubId}/lists`,
        jsonObject(opts.file, "shopping create"),
      );
      output(row, opts.json, () => `Einkaufsliste angelegt: ${row.name ?? row.id ?? "?"}`);
      return;
    }

    case "update": {
      if (!id) throw new Error("shopping update <id> benötigt eine Einkaufslisten-ID.");
      const row = await client.put<ShoppingListRead>(
        "supply",
        `/shopping/club/${clubId}/lists/${id}`,
        jsonObject(opts.file, "shopping update"),
      );
      output(row, opts.json, () => `Einkaufsliste aktualisiert: ${row.name ?? id}`);
      return;
    }

    case "delete": {
      if (!id) throw new Error("shopping delete <id> benötigt eine Einkaufslisten-ID.");
      await client.del("supply", `/shopping/club/${clubId}/lists/${id}`);
      output({ deleted: id }, opts.json, () => `Einkaufsliste gelöscht: ${id}`);
      return;
    }

    case "item-add": {
      if (!id) throw new Error("shopping item-add <list-id> benötigt eine Einkaufslisten-ID.");
      const row = await client.post(
        "supply",
        `/shopping/club/${clubId}/lists/${id}/items`,
        jsonObject(opts.file, "shopping item-add"),
      );
      output(row, opts.json, () => "Einkaufsposition angelegt.");
      return;
    }

    case "item-update": {
      if (!id) throw new Error("shopping item-update <item-id> benötigt eine Positions-ID.");
      const row = await client.put(
        "supply",
        `/shopping/club/${clubId}/items/${id}`,
        jsonObject(opts.file, "shopping item-update"),
      );
      output(row, opts.json, () => `Einkaufsposition aktualisiert: ${id}`);
      return;
    }

    case "item-delete": {
      if (!id) throw new Error("shopping item-delete <item-id> benötigt eine Positions-ID.");
      await client.del("supply", `/shopping/club/${clubId}/items/${id}`);
      output({ deleted: id }, opts.json, () => `Einkaufsposition gelöscht: ${id}`);
      return;
    }

    case "purchased": {
      if (!id) throw new Error("shopping purchased <item-id> benötigt eine Positions-ID.");
      const purchased = bool(opts.purchased, "--purchased");
      const row = await client.patch(
        "supply",
        `/shopping/club/${clubId}/items/${id}/purchased?purchased=${purchased}`,
      );
      output(row, opts.json, () => purchased ? "Einkaufsposition als gekauft markiert." : "Kaufmarkierung entfernt.");
      return;
    }

    case "generate-from-recipe": {
      if (!id) throw new Error("shopping generate-from-recipe <recipe-id> benötigt eine Rezept-ID.");
      const portions = integer(opts.portions, "--portions", 1, 500) ?? 1;
      const row = await client.post<ShoppingListRead>(
        "supply",
        `/shopping/club/${clubId}/generate-from-recipe/${id}`,
        prune({ portions, name: opts.name, description: opts.description }),
      );
      output(row, opts.json, () => `Einkaufsliste aus Rezept erzeugt: ${row.name ?? row.id ?? "?"}`);
      return;
    }

    case "generate-from-menu": {
      if (!id) throw new Error("shopping generate-from-menu <menu-id> benötigt eine Speisekarten-ID.");
      const row = await client.post<ShoppingListRead>(
        "supply",
        `/shopping/club/${clubId}/generate-from-menu/${id}`,
        prune({ name: opts.name, description: opts.description }),
      );
      output(row, opts.json, () => `Einkaufsliste aus Speisekarte erzeugt: ${row.name ?? row.id ?? "?"}`);
      return;
    }

    default:
      throw new Error(
        `Unbekannte Aktion "${action}". Verfügbar: list, active, completed, by-context, by-context-type, show, create, update, delete, item-add, item-update, item-delete, purchased, generate-from-recipe, generate-from-menu`,
      );
  }
}

export function registerShoppingCommands(cli: CAC): void {
  cli
    .command(
      "shopping <action> [id]",
      "Einkaufslisten: list | active | completed | by-context | by-context-type | show | create | update | delete | item-add | item-update | item-delete | purchased | generate-from-recipe | generate-from-menu",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--file <path>", "JSON-Payload für Listen-/Positions-CRUD")
    .option("--search <text>", "Name/Beschreibung durchsuchen (list)")
    .option("--status <status>", "Status filtern: draft|active|completed|cancelled")
    .option("--skip <n>", "Treffer überspringen (list)")
    .option("--limit <n>", "Max. Treffer 1-1000 (list)")
    .option("--context-id <id>", "Kontext-ID für by-context")
    .option("--context-type <type>", "Kontext-Typ für by-context-type")
    .option("--portions <n>", "Portionen 1-500 (generate-from-recipe; Default 1)")
    .option("--name <name>", "Name der generierten Einkaufsliste")
    .option("--description <text>", "Beschreibung der generierten Einkaufsliste")
    .option("--purchased <bool>", "Kaufstatus true|false (purchased)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: ShoppingCommandOpts) => {
      const state = loadState();
      await handleShoppingOperation({
        action,
        id,
        opts,
        client: createClient(state),
        clubId: requireClubId(state, opts.club),
      });
    });
}
