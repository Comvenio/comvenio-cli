import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";
import { createConnectorError } from "@comvenio/connector-contracts";
import { request } from "./handlers.ts";
import type { K14ActionDefinition, K14OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function identifier(input: JsonObject): string {
  for (const key of ["entry_id", "transfer_id", "position_id", "year", "club_id"]) if (input[key] !== undefined && input[key] !== null) return String(input[key]);
  return "Finanzen";
}

// budget-organigramm-04 DC-2: the sub positions a delete takes along, read
// BEFORE the confirmation. null when they cannot be read — the preview then
// says so instead of pretending there were none.
// A lead sees only her subtree; the service deletes every sub position. The
// list counts as complete only when it matches the service's child_count
// (review R2-02).
async function subPositions(client: ComvenioApiClient, context: RequestContext, positionId: string): Promise<{ rows: JsonObject[]; complete: boolean } | null> {
  try {
    const position = record(await request(client, context, "GET", `/positions/${positionId}`));
    const planId = position.finance_plan_id;
    if (typeof planId !== "string" || !context.club_id) return null;
    const rows = await request(client, context, "GET", `/clubs/${context.club_id}/finance-plans/by-id/${planId}/positions`);
    if (!Array.isArray(rows)) return null;
    const unter = rows.map(record).filter((row) => row.parent_position_id === positionId);
    const erwartet = typeof position.child_count === "number" ? position.child_count : unter.length;
    return { rows: unter, complete: unter.length === erwartet };
  } catch {
    return null;
  }
}

// DC-8: the frame before the change, from the tree the service filters anyway —
// the plan tree for a plan frame, the season tree for a season frame (budget-saison-03).
async function currentFrame(client: ComvenioApiClient, context: RequestContext, data: JsonObject): Promise<number | null | undefined> {
  try {
    if (!context.club_id) return undefined;
    // bereich-als-sicht-04: a window frame names its node in frame_kind/frame_id.
    const windowFrame = typeof data.window_start === "string";
    const path = windowFrame
      ? `/clubs/${context.club_id}/budget-periods/${String(data.node_kind)}/${String(data.node_id)}/${data.window_start}/tree`
      : typeof data.season_start === "string"
        ? `/clubs/${context.club_id}/budget-seasons/${data.season_start}/tree`
        : typeof data.plan_id === "string" ? `/clubs/${context.club_id}/finance-plans/by-id/${data.plan_id}/budget-tree` : null;
    if (path === null) return undefined;
    const tree = record(await request(client, context, "GET", path));
    const nodes = Array.isArray(tree.nodes) ? tree.nodes.map(record) : [];
    const kind = windowFrame ? data.frame_kind : data.node_kind;
    const id = windowFrame ? data.frame_id : data.node_id;
    const node = nodes.find((n) => n.node_kind === kind && String(n.node_id ?? "club") === String(id ?? "club"));
    if (!node) return undefined;
    return typeof node.frame_cents === "number" ? node.frame_cents : null;
  } catch {
    return undefined;
  }
}

async function transferShow(client: ComvenioApiClient, context: RequestContext, transferId: string): Promise<JsonObject | null> {
  try {
    if (!context.club_id) return null;
    const transfer = record(await request(client, context, "GET", `/clubs/${context.club_id}/department-transfers/${transferId}`));
    return transfer.id === transferId ? transfer : null;
  } catch {
    return null;
  }
}

// 04 DC-8: ungeplant ohne Rubrik und ohne Kategorie fällt vor jedem Aufruf auf —
// in der Vorschau (vor ihren Lesezugriffen) und im Handler (hub.ts).
export function unplannedCheck(input: JsonObject, context: RequestContext): void {
  const body = input.data !== null && typeof input.data === "object" && !Array.isArray(input.data) ? input.data : {};
  const rubric = typeof body.rubric_id === "string" && body.rubric_id.length > 0;
  const category = typeof body.category === "string" && body.category.trim().length > 0;
  if (!rubric && !category) {
    throw createConnectorError({ code: "VALIDATION_FAILED", message: "entry_create_unplanned: rubric_id oder category angeben — der Posten „Ungeplant · <Rubrik>“ braucht eines davon.", request_id: context.request_id, retryable: false });
  }
}

// ── bereich-als-sicht-04 ──────────────────────────────────────────────

// TD-S2 (budget-saison §5.3), exactly as the service computes it (Fraction
// and Decimal ROUND_HALF_EVEN): per calendar month the share of its days as a
// fraction, amounts rounded cumulatively half to even — so the parts add up
// to the cent and match the service to the cent (review K9 R2-6).
type Frac = { n: bigint; d: bigint };
function gcd(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; }
function frac(n: bigint, d: bigint): Frac { const g = gcd(n, d); return { n: n / g, d: d / g }; }
function add(a: Frac, b: Frac): Frac { return frac(a.n * b.d + b.n * a.d, a.d * b.d); }
function days(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function parse(value: string): Date { return new Date(`${value}T00:00:00Z`); }
function monthShare(start: Date, end: Date): Frac {
  let total: Frac = { n: 0n, d: 1n };
  if (end < start) return total;
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth() + 1; y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth() + 1); m === 12 ? (m = 1, y += 1) : (m += 1)) {
    const n = days(y, m);
    const first = Math.max(start.getTime(), Date.UTC(y, m - 1, 1));
    const last = Math.min(end.getTime(), Date.UTC(y, m - 1, n));
    total = add(total, frac(BigInt(Math.round((last - first) / 86_400_000) + 1), BigInt(n)));
  }
  return total;
}
function roundHalfEven(value: Frac): bigint {
  const negative = value.n < 0n;
  const n = negative ? -value.n : value.n;
  const q = n / value.d;
  const r = n % value.d;
  const twice = 2n * r;
  const up = twice > value.d || (twice === value.d && q % 2n === 1n);
  const rounded = up ? q + 1n : q;
  return negative ? -rounded : rounded;
}
function cumulative(amount: bigint, span: [Date, Date], until: Date, total: Frac): bigint {
  if (until < span[0]) return 0n;
  const part = monthShare(span[0], until < span[1] ? until : span[1]);
  return roundHalfEven(frac(amount * part.n * total.d, part.d * total.n));
}
export function windowShare(amount: number, span: [string, string], part: [string, string]): number {
  const s: [Date, Date] = [parse(span[0]), parse(span[1])];
  const p: [Date, Date] = [parse(part[0]), parse(part[1])];
  const total = monthShare(s[0], s[1]);
  if (!amount || total.n === 0n) return 0;
  const from = p[0] > s[0] ? p[0] : s[0];
  const until = p[1] < s[1] ? p[1] : s[1];
  if (from > until) return 0;
  const before = new Date(from.getTime() - 86_400_000);
  const value = BigInt(amount);
  return Number(cumulative(value, s, until, total) - cumulative(value, s, before, total));
}

// 04 DC-5: node_kind DEPARTMENT when only node_id is named (the club as
// "club"), and window_start the running window from `show` — before the
// preview and before the call (review K9 R2-5).
export async function periodDefaults(input: JsonObject, context: RequestContext, client?: ComvenioApiClient, window = false): Promise<void> {
  if ((input.node_kind === undefined || input.node_kind === null) && input.node_id !== undefined && input.node_id !== null) {
    input.node_kind = input.node_id === "club" ? "CLUB" : "DEPARTMENT";
  }
  if (!window || typeof input.window_start === "string") return;
  if (!client || !context.club_id || typeof input.node_kind !== "string" || input.node_id === undefined || input.node_id === null) {
    throw createConnectorError({ code: "VALIDATION_FAILED", message: "window_start fehlt und das laufende Fenster ist nicht bestimmbar — window_start angeben.", request_id: context.request_id, retryable: false });
  }
  const period = record(await request(client, context, "GET", `/clubs/${context.club_id}/budget-periods/${input.node_kind}/${String(input.node_id)}`));
  const current = (Array.isArray(period.windows) ? period.windows.map(record) : []).find((w) => w.current === true);
  if (!current || typeof current.start !== "string") {
    throw createConnectorError({ code: "VALIDATION_FAILED", message: "Der Zeitraum hat kein laufendes Fenster — window_start angeben.", request_id: context.request_id, retryable: false });
  }
  input.window_start = current.start;
}

function shiftDay(value: string, days: number): string {
  return new Date(parse(value).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

// Months of the span no club plan covers — the service then refuses the
// position as a whole (409 window_plan_missing), so the preview must not show
// the covered parts as if they would be created (review K9 R3-8).
function uncoveredParts(span: [string, string], plans: [string, string][]): { from: string; until: string }[] {
  const gaps: { from: string; until: string }[] = [];
  let cursor = span[0];
  for (const [start, end] of [...plans].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (cursor > span[1]) break;
    if (end < cursor) continue;
    if (start > cursor) gaps.push({ from: cursor, until: shiftDay(start, -1) < span[1] ? shiftDay(start, -1) : span[1] });
    const next = shiftDay(end, 1);
    if (next > cursor) cursor = next;
  }
  if (cursor <= span[1]) gaps.push({ from: cursor, until: span[1] });
  return gaps;
}

// The parts a window position would get: one per club plan the span touches.
async function windowParts(
  client: ComvenioApiClient,
  context: RequestContext,
  data: JsonObject,
): Promise<{ parts: JsonValue[]; uncovered: { from: string; until: string }[] } | null> {
  try {
    if (!context.club_id || typeof data.window_start !== "string") return null;
    const body = record(data.data ?? null);
    const period = record(await request(client, context, "GET", `/clubs/${context.club_id}/budget-periods/${String(data.node_kind)}/${String(data.node_id)}`));
    const windows = Array.isArray(period.windows) ? period.windows.map(record) : [];
    const window = windows.find((w) => w.start === data.window_start);
    if (!window || typeof window.end !== "string") return null;
    const span: [string, string] = [typeof body.planned_from === "string" ? body.planned_from : data.window_start, typeof body.planned_until === "string" ? body.planned_until : window.end];
    const plans = await request(client, context, "GET", `/clubs/${context.club_id}/finance-plans`);
    const club = (Array.isArray(plans) ? plans.map(record) : []).filter((p) => (p.department_id ?? null) === null && typeof p.period_start === "string" && typeof p.period_end === "string");
    const uncovered = uncoveredParts(span, club.map((p) => [String(p.period_start), String(p.period_end)] as [string, string]));
    const parts: JsonValue[] = [];
    for (const plan of club.sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)))) {
      const from = String(plan.period_start) > span[0] ? String(plan.period_start) : span[0];
      const until = String(plan.period_end) < span[1] ? String(plan.period_end) : span[1];
      if (from > until) continue;
      parts.push({
        plan_id: plan.id ?? null, label: plan.label ?? null, planned_from: from, planned_until: until,
        expense_planned_cents: windowShare(Number(body.expense_planned_cents ?? 0), span, [from, until]),
        revenue_planned_cents: windowShare(Number(body.revenue_planned_cents ?? 0), span, [from, until]),
      });
    }
    return { parts, uncovered };
  } catch {
    return null;
  }
}

async function accountOf(client: ComvenioApiClient, context: RequestContext, accountId: string): Promise<JsonObject | null> {
  try {
    if (!context.club_id) return null;
    const rows = await request(client, context, "GET", `/clubs/${context.club_id}/money-accounts`, { query: { include_archived: "true" } });
    return (Array.isArray(rows) ? rows.map(record) : []).find((row) => row.id === accountId) ?? null;
  } catch {
    return null;
  }
}

// Whether the entry creates „Ungeplant · <Rubrik>“ — read from the positions of the plan.
async function unplannedPosition(client: ComvenioApiClient, context: RequestContext, data: JsonObject): Promise<boolean | null> {
  try {
    if (!context.club_id || typeof data.plan_id !== "string") return null;
    const body = record(data.data ?? null);
    const rows = await request(client, context, "GET", `/clubs/${context.club_id}/finance-plans/by-id/${data.plan_id}/positions`);
    const kind = body.node_kind ?? (body.node_id ? "DEPARTMENT" : "CLUB");
    const exists = (Array.isArray(rows) ? rows.map(record) : []).some((row) => {
      if (row.plan_source !== "UNPLANNED" || row.parent_position_id) return false;
      const team = kind === "TEAM" ? body.node_id : null;
      if ((row.team_id ?? null) !== (team ?? null)) return false;
      if (kind === "DEPARTMENT" && row.department_id !== body.node_id) return false;
      if (kind === "CLUB" && row.department_id) return false;
      if (typeof body.rubric_id === "string") return row.rubric_id === body.rubric_id;
      return !row.rubric_id && String(row.category ?? "").toLowerCase() === String(body.category ?? "Sonstiges").trim().toLowerCase();
    });
    return !exists;
  } catch {
    return null;
  }
}

export const PERIOD_WINDOW_OPS = new Set(["tree", "frame_set", "frame_versions", "statement", "window_position_create"]);

export async function buildK14Preview(definition: K14ActionDefinition, operation: K14OperationDefinition, input: JsonValue, context: RequestContext, client?: ComvenioApiClient): Promise<{ subject: string; summary: string; effects: JsonValue[] }> {
  const data = record(input);
  if (definition.action_id === "cai.finance.39.budget_period") await periodDefaults(data, context, client, PERIOD_WINDOW_OPS.has(operation.operation));
  const effects: JsonValue[] = [{ type: "backend_mutation", action_id: definition.action_id, operation: operation.operation, target: identifier(data), external_effect: operation.external_effect }];
  // Was der Mensch vor dem Klick wissen muss, ist nicht die Route, sondern die
  // Reichweite: Ein geschlossenes Jahr nimmt keine Buchung mehr an, ein
  // übernommener Plan legt auf einen Schlag viele Posten an, und eine Freigabe
  // macht aus einem Entwurf einen verbuchten Beleg.
  if (definition.action_id === "cai.finance.05.plan_close") effects.push({ type: "plan_lock", year: data.year ?? null, blocks_further_bookings: true, forced: data.force === true });
  if (definition.action_id === "cai.finance.07.plan_copy") {
    effects.push({ type: "bulk_position_creation", source_year: data.source_year ?? null, target_year: data.year ?? null, selected_positions: Array.isArray(data.position_ids) ? data.position_ids.length : null, includes_non_recurring: data.include_non_recurring === true });
  }
  // budget-organigramm-01 section 4.5: the sub positions go along; the answer
  // names them in deleted_ids. The preview names each one before the click.
  if (definition.action_id === "cai.finance.12.position_delete") {
    const positionId = typeof data.position_id === "string" ? data.position_id : null;
    const unter = client && positionId ? await subPositions(client, context, positionId) : null;
    effects.push({ type: "position_removal", position_id: positionId, affects_attached_bookings: true, includes_sub_positions: true, sub_positions_read: unter?.complete === true });
    for (const kind of unter?.rows ?? [])
      effects.push({ type: "position_removal", position_id: kind.id ?? null, name: kind.name ?? null, parent_position_id: positionId, expense_planned_cents: kind.expense_planned_cents ?? null });
  }
  // DC-8: a frame change shows the old and the new amount and the reason.
  const rahmen = (definition.action_id === "cai.finance.36.budget_organigram" && operation.operation === "frame_set")
    || (definition.action_id === "cai.finance.37.budget_season" && operation.operation === "season_frame_set")
    || (definition.action_id === "cai.finance.39.budget_period" && operation.operation === "frame_set");
  if (rahmen) {
    const payload = record(data.data ?? null);
    const before = client ? await currentFrame(client, context, data) : undefined;
    const windowFrame = typeof data.window_start === "string";
    effects.push({ type: "frame_change", node_kind: (windowFrame ? data.frame_kind : data.node_kind) ?? null, node_id: (windowFrame ? data.frame_id : data.node_id) ?? null, ...(data.season_start ? { season_start: data.season_start } : {}), ...(windowFrame ? { window_start: data.window_start } : {}), old_amount_cents: before ?? null, old_amount_read: before !== undefined, new_amount_cents: payload.amount_cents ?? null, reason: payload.reason ?? null });
  }
  // buchhaltung-13-04 DC-5: eine Umbuchung zeigt vor der Entscheidung Betrag,
  // Abteilungen und Zustand — aus show, gelesen vor der Bestätigung.
  if (definition.action_id === "cai.finance.27.department_transfer" && ["confirm", "reject", "withdraw"].includes(operation.operation)) {
    const transferId = typeof data.transfer_id === "string" ? data.transfer_id : null;
    const transfer = client && transferId ? await transferShow(client, context, transferId) : null;
    effects.push({
      type: "department_transfer_decision", step: operation.operation, transfer_id: transferId, transfer_read: transfer !== null,
      amount_cents: transfer?.amount_cents ?? null, from_department_id: transfer?.from_department_id ?? null,
      to_department_id: transfer?.to_department_id ?? null, status: transfer?.status ?? null, reason: transfer?.reason ?? null,
      decision_note: record(data.data ?? null).decision_note ?? null,
    });
  }
  // bereich-als-sicht-04 DC-5: what the step reaches, read before the click.
  if (definition.action_id === "cai.finance.39.budget_period" && operation.operation === "set") {
    effects.push({ type: "budget_period_change", node_kind: data.node_kind ?? null, node_id: data.node_id ?? null, period: record(data.data ?? null) });
  }
  if (definition.action_id === "cai.finance.39.budget_period" && operation.operation === "window_position_create") {
    const read = client ? await windowParts(client, context, data) : null;
    const uncovered = read?.uncovered ?? [];
    effects.push({
      type: "window_position", node_kind: data.node_kind ?? null, node_id: data.node_id ?? null, window_start: data.window_start ?? null,
      name: record(data.data ?? null).name ?? null, parts_read: read !== null,
      // With a gap nothing is created: no parts, and the gap named (02 §4.8, D35).
      executable: read === null ? null : uncovered.length === 0,
      uncovered,
      parts: read && uncovered.length === 0 ? read.parts : [],
      ...(uncovered.length ? { refusal: "window_plan_missing", next_step: "plan-lifecycle next_period des jüngsten Vereinsplans" } : {}),
    });
  }
  if (definition.action_id === "cai.finance.39.budget_period" && operation.operation === "window_position_update") {
    effects.push({ type: "window_group_change", window_group_id: data.window_group_id ?? null, fields: Object.keys(record(data.data ?? null)).sort() });
  }
  if (definition.action_id === "cai.finance.24.money_account" && ["grant_set", "grant_revoke"].includes(operation.operation)) {
    const account = client && typeof data.account_id === "string" ? await accountOf(client, context, data.account_id) : null;
    effects.push({ type: operation.operation === "grant_set" ? "account_grant" : "account_grant_revocation", account_id: data.account_id ?? null, account_name: account?.name ?? null, owner_department_id: account?.department_id ?? null, node_kind: data.node_kind ?? null, node_id: data.node_id ?? null, reason: record(data.data ?? null).reason ?? null });
  }
  if (definition.action_id === "cai.finance.25.entry_correction" && operation.operation === "entry_create_unplanned") {
    unplannedCheck(data, context);
    const body = record(data.data ?? null);
    const creates = client ? await unplannedPosition(client, context, data) : null;
    effects.push({ type: "unplanned_entry", plan_id: data.plan_id ?? null, node_kind: body.node_kind ?? null, node_id: body.node_id ?? null, rubric_id: body.rubric_id ?? null, category: body.category ?? null, money_account_id: body.money_account_id ?? null, creates_position: creates, expense_cents: body.expense_cents ?? null, revenue_cents: body.revenue_cents ?? null });
  }
  // Eine Korrektur nennt die geänderten Felder und ihren Grund.
  if (definition.action_id === "cai.finance.18.entry_update") {
    const changes = record(data.changes ?? null);
    effects.push({ type: "booking_correction", entry_id: data.entry_id ?? null, fields: Object.keys(changes).filter((key) => key !== "reason").sort(), reason: changes.reason ?? null });
  }
  if (definition.action_id === "cai.finance.19.entry_delete") effects.push({ type: "booking_removal", entry_id: data.entry_id ?? null, changes_actual_totals: true });
  if (definition.action_id === "cai.finance.20.entry_approve") effects.push({ type: "booking_approval", entry_id: data.entry_id ?? null, marks_entry_as_verified: true });
  return { subject: identifier(data), summary: `${definition.source_action}: ${operation.operation}`, effects };
}
