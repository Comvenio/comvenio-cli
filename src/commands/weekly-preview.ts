import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

// Wochenvorschau K2: flyer templates (event-service /weekly-preview-templates).
// Same endpoints and rights as the web app (manage_club_settings or manage_events
// of the department). `preview` (local PNG) follows with the render service.

type TemplateRead = {
  id: string;
  club_id: string;
  department_id?: string | null;
  name: string;
  design_config: Record<string, unknown>;
  version?: number;
};

type Opts = {
  json?: boolean;
  club?: string;
  department?: string;
  name?: string;
  file?: string;
};

export const WEEKLY_PREVIEW_TEMPLATE_ACTIONS = ["list", "show", "set", "delete"] as const;

export function templateListPath(clubId: string, departmentId?: string): string {
  const base = `/weekly-preview-templates/club/${clubId}`;
  return departmentId ? `${base}?department_id=${encodeURIComponent(departmentId)}` : base;
}

export function templatePath(clubId: string, templateId: string): string {
  return `/weekly-preview-templates/club/${clubId}/${templateId}`;
}

/** Body for `set`: create when no id is given, otherwise a partial update. */
export function buildTemplateBody(
  opts: { name?: string; department?: string },
  designConfig: Record<string, unknown> | undefined,
  isCreate: boolean,
): Record<string, unknown> {
  if (isCreate && !opts.name) throw new Error("weekly-preview template set ohne <id> legt an und benötigt --name.");
  if (!isCreate && opts.department) {
    throw new Error("--department gilt nur beim Anlegen; eine Vorlage wechselt ihre Abteilung nicht.");
  }
  if (!isCreate && opts.name === undefined && designConfig === undefined) {
    throw new Error("Nichts zu ändern: --name oder --file <design.json> angeben.");
  }
  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (isCreate && opts.department) body.department_id = opts.department;
  if (designConfig !== undefined) body.design_config = designConfig;
  return body;
}

/**
 * `comvenio weekly-preview template <action> [id]`
 *   list [--department <id>]
 *   show <id>
 *   set [<id>] --name <name> [--department <id>] [--file design.json]
 *   delete <id>
 */
export function registerWeeklyPreviewCommands(cli: CAC): void {
  cli
    .command(
      "weekly-preview <area> <action> [id]",
      "Wochenvorschau-Flyervorlagen: template list | show | set | delete (design_config als JSON-Datei)",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--department <id>", "Abteilung (list: Filter, set: Abteilung der neuen Vorlage)")
    .option("--name <name>", "Name der Vorlage (set)")
    .option("--file <path>", "design.json mit design_config (set)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (area: string, action: string, id: string | undefined, opts: Opts) => {
      if (area !== "template") {
        throw new Error(`Unbekannter Bereich "${area}". Verfuegbar: template`);
      }
      const state = await loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "list": {
          const rows = await client.get<TemplateRead[]>("event", templateListPath(clubId, opts.department));
          output(rows, opts.json, () =>
            rows.length === 0
              ? "Keine Vorlagen — es gilt die Systemvorlage."
              : renderTable(rows, [
                  { header: "Name", width: 28, get: (row) => row.name },
                  { header: "Abteilung", width: 36, get: (row) => row.department_id ?? "(ganzer Verein)" },
                  { header: "Überschrift", width: 24, get: (row) => String(row.design_config?.headline ?? "") },
                  { header: "ID", width: 36, get: (row) => row.id },
                ]),
          );
          break;
        }

        case "show": {
          if (!id) throw new Error("weekly-preview template show benötigt <id>.");
          const row = await client.get<TemplateRead>("event", templatePath(clubId, id));
          output(row, opts.json, () => JSON.stringify(row, null, 2));
          break;
        }

        case "set": {
          const designConfig = opts.file ? readJsonFile<Record<string, unknown>>(opts.file) : undefined;
          const body = buildTemplateBody(opts, designConfig, !id);
          const row = id
            ? await client.put<TemplateRead>("event", templatePath(clubId, id), body)
            : await client.post<TemplateRead>("event", templateListPath(clubId), body);
          output(row, opts.json, () => `${id ? "Aktualisiert" : "Angelegt"}: ${row.name} (${row.id})`);
          break;
        }

        case "delete": {
          if (!id) throw new Error("weekly-preview template delete benötigt <id>.");
          await client.del("event", templatePath(clubId, id));
          output({ deleted: id }, opts.json, () => `Gelöscht: ${id}`);
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: ${WEEKLY_PREVIEW_TEMPLATE_ACTIONS.join(", ")}`,
          );
      }
    });
}
