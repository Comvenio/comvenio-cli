import type { CAC } from "cac";

import { loadState } from "../auth.ts";
import { output } from "../format.ts";
import { createClient, HttpError } from "../http.ts";
import { requireClubId } from "../util/club.ts";

// Automatisierungen 04 (Lastenheft club/automatisierungen/04-umzug-und-cli §4): the automations
// of a club from the terminal — the same ai-service routes as the web (Admin → Automatisierungen,
// Mein Bereich → Meine Automatisierungen). Rights are the server's (D6); the CLI never decides an
// approval (D-AF-16), it only names the link.

export type AutomationRun = {
  id: string;
  automation_id: string;
  trigger_type: string;
  scheduled_for?: string | null;
  state: string;
  reason?: string | null;
  result_text?: string | null;
  approval_request_id?: string | null;
  delivery_state?: string | null;
  created_at: string;
};

export type Automation = {
  id: string;
  kind: "club" | "personal";
  department_id?: string | null;
  name: string;
  capability_id: string;
  args: Record<string, unknown>;
  trigger: Record<string, unknown>;
  output: Record<string, unknown>;
  approval_mode: string;
  objection_hours?: number | null;
  enabled: boolean;
  paused_reason?: string | null;
  next_run_at?: string | null;
  runs_today?: number;
  last_run?: AutomationRun | null;
  version: number;
};

type AutomationOptions = {
  club?: string;
  kind?: string;
  function?: string;
  department?: string;
  name?: string;
  args?: string;
  schedule?: string;
  rrule?: string;
  timezone?: string;
  approval?: string;
  objectionHours?: string | number;
  idempotencyKey?: string;
  runs?: boolean;
  json?: boolean;
};

export const AUTOMATION_ACTIONS = ["list", "show", "create", "update", "run", "pause", "resume", "delete"] as const;
type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CAPABILITY_ID = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/u;
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const APPROVAL_MODES = ["click", "objection_window", "standing"] as const;

/** `automation <action> [id]`, checked before any API call. */
export function resolveAutomationCommand(action: string, target: string | undefined): { action: AutomationAction; target?: string } {
  if (!AUTOMATION_ACTIONS.includes(action as AutomationAction)) {
    throw new Error(`automation braucht eine Aktion: ${AUTOMATION_ACTIONS.join(", ")}.`);
  }
  if (action === "list" || action === "create") {
    if (target) throw new Error(`automation ${action} nimmt kein Ziel.`);
    return { action: action as AutomationAction };
  }
  if (!target || !UUID.test(target)) {
    throw new Error(`automation ${action} braucht die Kennung der Automatisierung (UUID).`);
  }
  return { action: action as AutomationAction, target };
}

/**
 * The trigger as the service stores it. `--schedule weekly:FR:17:00`, `daily:07:00` or `manual`;
 * `--rrule` for anything else the service reads (FREQ=DAILY|WEEKLY).
 */
export function parseTrigger(schedule: string | undefined, rrule: string | undefined, timezone: string | undefined): Record<string, unknown> | undefined {
  const tz = timezone || "Europe/Berlin";
  if (rrule) {
    if (schedule) throw new Error("--schedule und --rrule nicht zusammen angeben.");
    return { type: "schedule", rrule, timezone: tz };
  }
  if (!schedule) return undefined;
  const value = schedule.trim();
  if (value === "manual") return { type: "manual" };
  const weekly = /^weekly:([A-Za-z]{2}):(\d{1,2}):(\d{2})$/u.exec(value);
  const daily = /^daily:(\d{1,2}):(\d{2})$/u.exec(value);
  const time = (hour: string, minute: string) => {
    const h = Number(hour);
    const m = Number(minute);
    if (h > 23 || m > 59) throw new Error("Uhrzeit ungültig, etwa 17:00.");
    return `BYHOUR=${h};BYMINUTE=${m}`;
  };
  if (weekly) {
    const day = weekly[1].toUpperCase();
    if (!WEEKDAYS.includes(day as (typeof WEEKDAYS)[number])) {
      throw new Error(`Wochentag ungültig — ${WEEKDAYS.join(", ")}.`);
    }
    return { type: "schedule", rrule: `FREQ=WEEKLY;BYDAY=${day};${time(weekly[2], weekly[3])}`, timezone: tz };
  }
  if (daily) return { type: "schedule", rrule: `FREQ=DAILY;${time(daily[1], daily[2])}`, timezone: tz };
  throw new Error("--schedule kennt weekly:FR:17:00, daily:07:00 oder manual.");
}

/** The function's arguments as JSON object (`--args '{"department_id":"…"}'`). */
export function parseAutomationArgs(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("--args muss gültiges JSON sein, etwa '{\"department_id\":\"…\"}'.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--args muss ein JSON-Objekt sein.");
  }
  return value as Record<string, unknown>;
}

function approvalFields(opts: AutomationOptions): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (opts.approval !== undefined) {
    if (!APPROVAL_MODES.includes(opts.approval as (typeof APPROVAL_MODES)[number])) {
      throw new Error(`--approval kennt ${APPROVAL_MODES.join(", ")}.`);
    }
    fields.approval_mode = opts.approval;
  }
  if (opts.objectionHours !== undefined) {
    const hours = Number(opts.objectionHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 48) throw new Error("--objection-hours muss 1–48 sein.");
    fields.objection_hours = hours;
  }
  return fields;
}

/** Body of `automation create` — all checks before the call. */
export function buildCreateBody(opts: AutomationOptions): Record<string, unknown> {
  const kind = opts.kind ?? "club";
  if (kind !== "club" && kind !== "personal") throw new Error("--kind kennt club oder personal.");
  if (!opts.function || !CAPABILITY_ID.test(opts.function)) {
    throw new Error("automation create braucht --function, etwa weekly_preview.create.");
  }
  if (!opts.name || !opts.name.trim()) throw new Error("automation create braucht --name.");
  const trigger = parseTrigger(opts.schedule, opts.rrule, opts.timezone);
  if (!trigger) throw new Error("automation create braucht --schedule (weekly:FR:17:00, daily:07:00, manual) oder --rrule.");
  if (opts.department !== undefined && opts.department !== "" && !UUID.test(opts.department)) {
    throw new Error("--department braucht die Kennung einer Abteilung (UUID).");
  }
  return {
    kind,
    name: opts.name.trim(),
    capability_id: opts.function,
    args: parseAutomationArgs(opts.args) ?? {},
    trigger,
    department_id: opts.department || null,
    ...approvalFields(opts),
  };
}

/** Body of `automation update` — only what is given; the version comes from the server. */
export function buildUpdateBody(opts: AutomationOptions, version: number): Record<string, unknown> {
  const body: Record<string, unknown> = { expected_version: version };
  if (opts.name !== undefined) body.name = opts.name.trim();
  const args = parseAutomationArgs(opts.args);
  if (args) body.args = args;
  const trigger = parseTrigger(opts.schedule, opts.rrule, opts.timezone);
  if (trigger) body.trigger = trigger;
  if (opts.department !== undefined) {
    if (opts.department !== "" && !UUID.test(opts.department)) throw new Error("--department braucht eine UUID.");
    body.department_id = opts.department || null;
  }
  Object.assign(body, approvalFields(opts));
  if (Object.keys(body).length === 1) throw new Error("automation update braucht mindestens eine Änderung.");
  return body;
}

const ERROR_TEXT: Record<string, string> = {
  automation_forbidden: "Nur Verwalter dieses Bereichs dürfen vereinsweite Automatisierungen anlegen (Recht manage_club_settings).",
  automation_not_found: "Automatisierung nicht gefunden (oder nicht deine).",
  automation_changed: "Inzwischen geändert — bitte erneut versuchen.",
  automation_paused: "Die Automatisierung ist pausiert — erst fortsetzen.",
  automation_limit_reached: "Die Höchstzahl an Automatisierungen ist erreicht.",
  function_not_automatable: "Diese Funktion kann so nicht automatisiert werden (vereinsweit nur mit öffentlichem Lesepfad) — versuch --kind personal.",
  standing_not_allowed: "Diese Funktion braucht immer eine Freigabe per Klick.",
  invalid_schedule: "Der Zeitplan ist ungültig.",
  invalid_trigger: "Dieser Auslöser ist für diese Art nicht erlaubt.",
  invalid_args: "Die Argumente passen nicht zum Absichtsschema der Funktion.",
};

/** A readable sentence for an error of the automation routes; other errors pass unchanged. */
export function explainAutomationError(err: unknown): unknown {
  if (!(err instanceof HttpError)) return err;
  let code: string | undefined;
  let field: string | undefined;
  try {
    const body = JSON.parse(err.body) as { detail?: unknown; field?: unknown };
    code = typeof body.detail === "string" ? body.detail : undefined;
    field = typeof body.field === "string" ? body.field : undefined;
  } catch {
    return err;
  }
  const text = code ? ERROR_TEXT[code] : undefined;
  if (!text) return err;
  return new Error(`${text}${field ? ` (Feld: ${field})` : ""} [HTTP ${err.status} ${code}]`);
}

const RUN_STATES: Record<string, string> = {
  queued: "eingereiht",
  running: "läuft",
  succeeded: "erledigt",
  approved: "freigegeben",
  awaiting_approval: "wartet auf Freigabe",
  rejected: "abgelehnt",
  failed: "fehlgeschlagen",
  skipped: "ausgelassen",
};

function status(a: Automation): string {
  if (a.paused_reason) return `pausiert (${a.paused_reason})`;
  if (a.last_run?.state === "awaiting_approval") return "wartet auf Freigabe";
  return a.enabled ? "aktiv" : "deaktiviert";
}

function triggerLine(trigger: Record<string, unknown>): string {
  if (trigger.type === "manual") return "nur per Knopf";
  if (trigger.type === "event") return `bei ${String(trigger.event_type ?? "Ereignis")}`;
  return `${String(trigger.rrule ?? "?")} (${String(trigger.timezone ?? "Europe/Berlin")})`;
}

export function formatAutomationList(items: Automation[]): string {
  if (items.length === 0) return "Keine Automatisierungen.";
  return items
    .map((a) => {
      const next = a.next_run_at ? a.next_run_at.slice(0, 16).replace("T", " ") : "—";
      return `${a.name} [${a.kind === "club" ? "Verein" : "persönlich"}] ${a.capability_id}\n  ${triggerLine(a.trigger)} · nächster Lauf ${next} · ${status(a)}\n  ${a.id}`;
    })
    .join("\n");
}

export function formatAutomation(a: Automation, runs: AutomationRun[] = []): string {
  const lines = [
    `${a.name} [${a.kind === "club" ? "Verein" : "persönlich"}] — ${status(a)}`,
    `Funktion: ${a.capability_id}  Argumente: ${JSON.stringify(a.args)}`,
    `Auslöser: ${triggerLine(a.trigger)}  Nächster Lauf: ${a.next_run_at ?? "—"}`,
    `Freigabe: ${a.approval_mode}${a.objection_hours ? ` (${a.objection_hours} h)` : ""}  Version: ${a.version}`,
    `Kennung: ${a.id}`,
  ];
  if (runs.length) {
    lines.push("Verlauf:");
    for (const run of runs) lines.push(`  ${formatRunLine(run)}`);
  }
  return lines.join("\n");
}

export function formatRunLine(run: AutomationRun): string {
  const when = (run.scheduled_for ?? run.created_at).slice(0, 16).replace("T", " ");
  const reason = run.reason ? ` (${run.reason})` : "";
  return `${when}  ${run.trigger_type}: ${RUN_STATES[run.state] ?? run.state}${reason}  ${run.id}`;
}

export function registerAutomationCommands(cli: CAC): void {
  cli
    .command(
      "automation <action> [id]",
      "Automatisierungen: list · show <id> [--runs] · create --function --name --schedule [--args --kind --department --approval] · update <id> · run <id> · pause|resume|delete <id>",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--kind <art>", "club (Verein, Standard) | personal (nur für mich); list: filtern")
    .option("--function <kennung>", "create: Funktion, etwa weekly_preview.create; list: filtern")
    .option("--department <id>", "Bereich (Abteilung); leer = ganzer Verein; list: filtern")
    .option("--name <name>", "create/update: Name")
    .option("--args <json>", "create/update: Argumente der Funktion als JSON-Objekt")
    .option("--schedule <plan>", "weekly:FR:17:00 | daily:07:00 | manual")
    .option("--rrule <rrule>", "statt --schedule: FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0")
    .option("--timezone <tz>", "Zeitzone des Zeitplans (Standard Europe/Berlin)")
    .option("--approval <art>", "click | objection_window | standing (nur vereinsweit)")
    .option("--objection-hours <h>", "Einspruchsfrist in Stunden (1–48)")
    .option("--idempotency-key <key>", "run: gleicher Schlüssel, gleicher Lauf")
    .option("--runs", "show: den Verlauf mitzeigen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, target: string | undefined, opts: AutomationOptions) => {
      const command = resolveAutomationCommand(action, target);
      const createBody = command.action === "create" ? buildCreateBody(opts) : undefined;
      const state = await loadState();
      const clubId = requireClubId(state, opts.club);
      const client = createClient(state);
      const base = `/automations/${clubId}`;
      try {
        if (command.action === "list") {
          const params = new URLSearchParams();
          if (opts.kind) params.set("kind", opts.kind);
          if (opts.function) params.set("capability_id", opts.function);
          if (opts.department) params.set("department_id", opts.department);
          const query = params.toString() ? `?${params.toString()}` : "";
          const list = await client.get<{ items: Automation[] }>("ai", `${base}${query}`);
          output(list, opts.json, () => formatAutomationList(list.items));
          return;
        }
        if (command.action === "create") {
          const created = await client.post<Automation>("ai", base, createBody);
          output(created, opts.json, () => `Angelegt.\n${formatAutomation(created)}`);
          return;
        }
        const path = `${base}/${command.target}`;
        if (command.action === "show") {
          const automation = await client.get<Automation>("ai", path);
          const runs = opts.runs ? (await client.get<{ items: AutomationRun[] }>("ai", `${path}/runs`)).items : [];
          output(opts.runs ? { ...automation, runs } : automation, opts.json, () => formatAutomation(automation, runs));
          return;
        }
        if (command.action === "run") {
          const key = opts.idempotencyKey || `cli:${command.target}:${Date.now()}`;
          const run = await client.post<AutomationRun>("ai", `${path}/run`, { idempotency_key: key }, { timeoutMs: 120_000 });
          output(run, opts.json, () => `Lauf gestartet: ${formatRunLine(run)}`);
          return;
        }
        // Writes on an existing automation carry the version the server has now.
        const current = await client.get<Automation>("ai", path);
        if (command.action === "update") {
          const updated = await client.patch<Automation>("ai", path, buildUpdateBody(opts, current.version));
          output(updated, opts.json, () => `Gespeichert.\n${formatAutomation(updated)}`);
          return;
        }
        if (command.action === "delete") {
          await client.del("ai", `${path}?expected_version=${current.version}`);
          output({ deleted: command.target }, opts.json, () => `Gelöscht: ${current.name}`);
          return;
        }
        const changed = await client.post<Automation>("ai", `${path}/${command.action}?expected_version=${current.version}`);
        output(changed, opts.json, () => `${command.action === "pause" ? "Pausiert" : "Fortgesetzt"}.\n${formatAutomation(changed)}`);
      } catch (err) {
        throw explainAutomationError(err);
      }
    });
}
