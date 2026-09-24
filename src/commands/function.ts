import type { CAC } from "cac";

import { loadState } from "../auth.ts";
import { output } from "../format.ts";
import { createClient } from "../http.ts";
import { requireClubId } from "../util/club.ts";

// Agent-Funktionen K2 (Strang 02 §11): call any released function the same way the web
// button, the agent and MCP do. The CLI needs no release for a new function — the list and
// the intent schema come from the ai-service at run time. The channel (cli) is derived by
// the server from the device token, never sent by the client (D-AF-31).

export type FunctionDescriptor = {
  capability_id: string;
  title: string;
  description: string;
  risk_level: number;
  approval_required: boolean;
  input_schema: Record<string, unknown>;
  capability_version: number;
  input_schema_hash?: string | null;
};

export type FunctionRun = {
  id: string;
  capability_id: string;
  state: string;
  channel: string;
  idempotency_key: string;
  args: Record<string, unknown>;
  approval?: { approval_id: string; approval_url: string } | null;
  result_summary?: string | null;
  result?: unknown;
  error?: string | null;
  created_at: string;
};

type FunctionOptions = {
  club?: string;
  channel?: string;
  args?: string;
  idempotencyKey?: string;
  json?: boolean;
};

export const FUNCTION_ACTIONS = ["list", "run", "show", "runs"] as const;
type FunctionAction = (typeof FUNCTION_ACTIONS)[number];

const CAPABILITY_ID = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/u;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** `function <list|run|show> [target]`, checked before any API call. */
export function resolveFunctionCommand(action: string, target: string | undefined): { action: FunctionAction; target?: string } {
  if (!FUNCTION_ACTIONS.includes(action as FunctionAction)) {
    throw new Error(`function braucht eine Aktion: ${FUNCTION_ACTIONS.join(", ")}.`);
  }
  if (action === "list") {
    if (target) throw new Error("function list nimmt kein Ziel.");
    return { action };
  }
  if (action === "runs") {
    // Optional target: only the runs of this function.
    if (target && !CAPABILITY_ID.test(target)) {
      throw new Error("function runs nimmt optional die Kennung einer Funktion, etwa weekly_preview.create.");
    }
    return { action, target };
  }
  if (action === "run" && (!target || !CAPABILITY_ID.test(target))) {
    throw new Error("function run braucht die Kennung der Funktion, etwa weekly_preview.create.");
  }
  if (action === "show" && (!target || !RUN_ID.test(target))) {
    throw new Error("function show braucht die Kennung des Laufs (UUID).");
  }
  return { action: action as FunctionAction, target };
}

export const FUNCTION_CHANNELS = ["web", "cli", "mcp"] as const;

/** `--channel` for `function list`: which channel's view to show (§11.4); the server keeps a
 * device token on its own channel and only lets the web preview the others. */
export function functionListPath(clubId: string, channel: string | undefined): string {
  const base = `/club-agents/${clubId}/functions`;
  if (channel === undefined || channel === "") return base;
  if (!FUNCTION_CHANNELS.includes(channel as (typeof FUNCTION_CHANNELS)[number])) {
    throw new Error(`--channel kennt nur ${FUNCTION_CHANNELS.join(", ")}.`);
  }
  return `${base}?channel=${channel}`;
}

/** The intent as JSON object (`--args '{"title":"…"}'`). */
export function parseFunctionArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.trim() === "") return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("--args muss gültiges JSON sein, etwa '{\"title\":\"Sommerfest\"}'.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--args muss ein JSON-Objekt sein.");
  }
  return value as Record<string, unknown>;
}

const STATE_LABELS: Record<string, string> = {
  pending: "angelegt",
  awaiting_approval: "wartet auf Freigabe",
  running: "läuft",
  succeeded: "erledigt",
  failed: "fehlgeschlagen",
  rejected: "abgelehnt",
  expired: "abgelaufen",
};

export function formatFunctionList(items: FunctionDescriptor[]): string {
  if (items.length === 0) return "Keine Funktionen freigegeben.";
  return items
    .map((f) => {
      const required = Array.isArray(f.input_schema.required) ? (f.input_schema.required as string[]) : [];
      const approval = f.approval_required ? " · braucht Freigabe" : "";
      return `${f.capability_id} — ${f.title}${approval}${required.length ? `\n  Pflicht: ${required.join(", ")}` : ""}`;
    })
    .join("\n");
}

/** One line per run, newest first: when, function, state, run id. */
export function formatFunctionRuns(runs: FunctionRun[]): string {
  if (runs.length === 0) return "Keine Funktionsläufe.";
  return runs
    .map((run) => `${run.created_at.slice(0, 16).replace("T", " ")}  ${run.capability_id}: ${STATE_LABELS[run.state] ?? run.state}  (${run.channel})  ${run.id}`)
    .join("\n");
}

export function formatFunctionRun(run: FunctionRun): string {
  const lines = [
    `${run.capability_id}: ${STATE_LABELS[run.state] ?? run.state}`,
    ...(run.result_summary ? [run.result_summary] : []),
    ...(run.error && run.state !== "succeeded" ? [`Grund: ${run.error}`] : []),
    ...(run.approval ? [`Freigabe nötig — entscheide in Web oder App: ${run.approval.approval_url}`] : []),
    `Lauf: ${run.id}`,
  ];
  return lines.join("\n");
}

export function registerFunctionCommands(cli: CAC): void {
  cli
    .command(
      "function <action> [target]",
      "Funktionen des Club-Agenten: list — freigegebene Funktionen; run <kennung> --args '<json>' — aufrufen; show <lauf> — Stand; runs [kennung] — eigene Läufe",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--channel <kanal>", "list: Sicht eines Kanals (web | cli | mcp)")
    .option("--args <json>", "run: die Absicht als JSON-Objekt")
    .option("--idempotency-key <key>", "run: gleicher Schlüssel, gleicher Lauf (Wiederholung sicher)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, target: string | undefined, opts: FunctionOptions) => {
      const command = resolveFunctionCommand(action, target);
      const args = command.action === "run" ? parseFunctionArgs(opts.args) : {};
      const state = await loadState();
      const clubId = requireClubId(state, opts.club);
      const client = createClient(state);
      if (command.action === "list") {
        const list = await client.get<{ items: FunctionDescriptor[] }>("ai", functionListPath(clubId, opts.channel));
        output(list, opts.json, () => formatFunctionList(list.items));
        return;
      }
      if (command.action === "runs") {
        const query = command.target ? `?capability_id=${encodeURIComponent(command.target)}` : "";
        const list = await client.get<{ items: FunctionRun[] }>("ai", `/club-agents/${clubId}/function-runs${query}`);
        output(list, opts.json, () => formatFunctionRuns(list.items));
        return;
      }
      if (command.action === "show") {
        const run = await client.get<FunctionRun>("ai", `/club-agents/${clubId}/function-runs/${command.target}`);
        output(run, opts.json, () => formatFunctionRun(run));
        return;
      }
      const run = await client.post<FunctionRun>(
        "ai",
        `/club-agents/${clubId}/functions/${command.target}/runs`,
        { args, ...(opts.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}) },
        { timeoutMs: 120_000 },
      );
      output(run, opts.json, () => formatFunctionRun(run));
    });
}
