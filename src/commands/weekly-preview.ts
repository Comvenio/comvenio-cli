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
  teams?: string;
  range?: string;
  telegram?: boolean;
  plan?: string;
  idempotencyKey?: string;
};

type CreateResult = { run_id: string; plan_id: string; status: string; error?: string | null };
type SnapshotRead = {
  id: string;
  plan_run_id: string;
  range_start: string;
  events: Array<{ title: string; start_time: string }>;
  published_at?: string | null;
  share_token?: string | null;
};

/** Body of the function call (ai-service POST /club-agents/{club}/weekly-previews/create). */
export function buildCreateBody(
  opts: { department?: string; teams?: string; range?: string; telegram?: boolean; idempotencyKey?: string },
): Record<string, unknown> {
  if (!opts.department) throw new Error("weekly-preview create benötigt --department <id>.");
  const range = opts.range ?? "next_week";
  if (range !== "next_week" && range !== "next_7_days") {
    throw new Error("--range ist next_week oder next_7_days.");
  }
  const teamIds = (opts.teams ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  // Always a key: a repeat with the same key after a timeout answers with the first run
  // instead of starting a second preview (Codex, 24.09.).
  const idempotencyKey = opts.idempotencyKey?.trim() || `weekly-preview-${crypto.randomUUID()}`;
  return {
    department_id: opts.department, team_ids: teamIds, range, telegram: Boolean(opts.telegram),
    idempotency_key: idempotencyKey,
  };
}

/** A timeout does not mean the server stopped: say how to look and how to repeat safely. */
export function createTimeoutHint(idempotencyKey: string): string {
  return "Zeitgrenze erreicht — der Server arbeitet eventuell weiter. Stand: comvenio function runs weekly_preview.create. "
    + `Wiederholen ohne zweiten Lauf: --idempotency-key ${idempotencyKey}`;
}

export const shareUrlFor = (gatewayBaseUrl: string, shareToken: string): string =>
  `${gatewayBaseUrl.replace(/\/+$/, "")}/event/share/weekly-preview/${encodeURIComponent(shareToken)}`;

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
      "weekly-preview <area> [action] [id]",
      "Wochenvorschau als Funktion: create --department <id> [--teams a,b] [--range] [--telegram] | list --plan <id>; Vorlagen: template list | show | set | delete",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--department <id>", "Abteilung (create; template list: Filter, template set: Abteilung der neuen Vorlage)")
    .option("--teams <ids>", "create: Mannschafts-IDs, komma-getrennt (ohne: alle Mannschaften der Abteilung)")
    .option("--range <v>", "create: next_week (Standard) | next_7_days")
    .option("--telegram", "create: nach Freigabe auch in die verknüpften Telegram-Chats")
    .option("--idempotency-key <key>", "create: gleicher Schlüssel, gleicher Lauf (Wiederholung nach Abbruch sicher)")
    .option("--plan <id>", "list: Plan-ID aus create")
    .option("--name <name>", "Name der Vorlage (template set)")
    .option("--file <path>", "design.json mit design_config (template set)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (area: string, action: string | undefined, id: string | undefined, opts: Opts) => {
      const state = await loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      if (area === "create") {
        // The function (Tom 2026-09-23): same entry as the web button and the agent tool.
        const body = buildCreateBody(opts);
        let result: CreateResult;
        try {
          result = await client.post<CreateResult>(
            "ai", `/club-agents/${clubId}/weekly-previews/create`, body, { timeoutMs: 120_000 },
          );
        } catch (error) {
          const aborted = error instanceof Error && /abort/i.test(`${error.name} ${error.message}`);
          if (aborted) throw new Error(createTimeoutHint(String(body.idempotency_key)));
          throw error;
        }
        output(result, opts.json, () =>
          result.status === "failed"
            ? `Nicht erstellt: ${result.error ?? "unbekannter Fehler"}`
            : `Wochenvorschau erstellt (Lauf ${result.run_id}, Status ${result.status}). Der Entwurf liegt im Agent-Messenger zur Freigabe.\nPlan: ${result.plan_id}`,
        );
        return;
      }
      if (area === "list") {
        if (!opts.plan) throw new Error("weekly-preview list benötigt --plan <id> (aus create).");
        const rows = await client.get<SnapshotRead[]>("ai", `/club-agents/${clubId}/weekly-previews?plan_id=${encodeURIComponent(opts.plan)}`);
        output(rows, opts.json, () =>
          rows.length === 0
            ? "Noch keine Wochenvorschau für diesen Plan."
            : rows
                .map((row) => {
                  const state_ = row.share_token ? `veröffentlicht: ${shareUrlFor(state.gatewayBaseUrl, row.share_token)}` : row.published_at ? "veröffentlicht (Link abgelaufen)" : "wartet auf Freigabe";
                  return `${row.range_start.slice(0, 10)} · ${row.events.length} Termine · ${state_}`;
                })
                .join("\n"),
        );
        return;
      }
      if (area !== "template") {
        throw new Error(`Unbekannter Bereich "${area}". Verfuegbar: create, list, template`);
      }
      if (!action) throw new Error(`weekly-preview template benötigt eine Aktion: ${WEEKLY_PREVIEW_TEMPLATE_ACTIONS.join(", ")}`);

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
