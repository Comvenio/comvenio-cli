// Finance Hub, vollständig (2026-09-23): cai.finance.21 bis .35.
//
// K14 bediente nur Jahresplan, Budgetposten und Buchung. Alles andere, was der
// finance-service kann — Pläne je Zeitraum und Abteilung, Geldkonten mit
// Anfangsbestand und Kassenbuch, Storno und Beleg, Kassenberichte,
// Überträge zwischen Abteilungen, Ergebnis und Beschlüsse, Verfahrens-
// dokumentation, Prüfexport, Event-Auswertung und Investitionsplaner — war
// über die OAuth-Anmeldung nicht erreichbar. Weil diese Anmeldung der
// Standardweg des CLI ist, fehlte damit der größte Teil des Bereichs.
//
// Bauform: je Fachbereich EINE Aktion mit Teiloperationen, wie die Event-
// Aktionen. Jede Operation ist ein Tabelleneintrag; die Sicherheitsbausteine
// sind dieselben wie in K14:
// - Vereins- und Abteilungsabgleich der Eingabe (ToolSet) und der Antwort
//   (assertTenant);
// - Vorprüfung der Herkunft, wo der Pfad nur eine nackte Kennung trägt
//   (assertHerkunft) — der Dienst prüft die Rechte des Menschen, nicht den
//   gewählten Verein;
// - Bestätigung für kritische Schreibvorgänge (Abschluss, Übernahme,
//   Storno, Freigabe eines Kassenberichts, Prüfexport, Löschen);
// - Datenschutzfilter der Antwort (redactFinanceValue).
//
// Rümpfe von Anlegen und Ändern laufen als `data` durch und werden vom
// Dienst geprüft (pydantic). Doppelt geprüft hätte hier nur zwei Stellen
// geschaffen, die auseinanderlaufen; die Felder, die über Verein und
// Abteilung entscheiden, sieht der Abgleich des ToolSets trotzdem.
import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import { createConnectorError, type JsonValue, type OAuthScope, type RequestContext } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";
import { createHash } from "node:crypto";
import { z } from "zod";

import { addK14Handler, assertHerkunft, assertTenant, request } from "./handlers.ts";
import { redactFinanceValue } from "./privacy.ts";
import type { K14ActionDefinition, K14ActionId, K14ActionSchemaContract, K14BackendRoute, K14ExecutionGate, K14OperationDefinition } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };

// ── Bausteine der Definition (wie definitions.ts, ohne dessen Import: der
//    Kreis definitions → hub → definitions bliebe sonst stehen) ─────────────
const FINANCE_PERMISSIONS = ["manage_finances", "manage_club_settings"] as const;
function policy(): PermissionPolicy {
  return { all_of: [], any_of: [...FINANCE_PERMISSIONS], owner_or_self_allowed: false, department_scope: "optional", backend_audit_refs: ["k14:finance-hub"] };
}
function route(method: ComvenioHttpMethod, path: string, purpose?: K14BackendRoute["purpose"]): K14BackendRoute {
  return { method, service: "finance", normalized_path_template: path, purpose: purpose ?? (method === "GET" ? "read" : "mutation") };
}

// ── Schema-Bausteine ─────────────────────────────────────────────────────
const uuid = z.string().uuid();
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(512) }).strict();
const base = { club_id: uuid, department_id: uuid.nullable().optional(), confirmation: confirmation.optional() } as const;
const year = z.number().int().min(1900).max(2200);
const data = z.record(z.string(), z.json());

type Risk = "read" | "write" | "critical";
interface Op {
  /** Name der Teiloperation. */
  op: string;
  method: ComvenioHttpMethod;
  /** Pfadvorlage für den Routenvertrag. */
  template: string;
  path: (input: JsonObject) => string;
  risk: Risk;
  shape: z.ZodRawShape;
  body?: (input: JsonObject) => JsonValue;
  query?: (input: JsonObject) => Record<string, string>;
  /** Vorprüfung der Herkunft vor dem eigentlichen Aufruf. */
  preflight?: { template: string; check: (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => Promise<void> };
  /** Antwort ist eine Datei (Prüfexport). */
  binary?: boolean;
  /** Antworten, die von Natur aus mehrere Abteilungen tragen. */
  multiDepartment?: boolean;
}

function str(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string") throw new Error(`${key} fehlt.`); return value; }
function int(input: JsonObject, key: string): number { const value = input[key]; if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${key} fehlt.`); return value; }
function payload(input: JsonObject): JsonValue { return (input.data ?? {}) as JsonValue; }
function optional(input: JsonObject, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => (input[key] === undefined || input[key] === null ? [] : [[key, String(input[key])]])));
}

const club = (input: JsonObject) => `/clubs/${str(input, "club_id")}`;
const byId = (input: JsonObject) => `${club(input)}/finance-plans/by-id/${str(input, "plan_id")}`;
const BY_ID = "/clubs/{club_id}/finance-plans/by-id/{plan_id}";

// Liest eine Ressource und belegt ihre Vereinszugehörigkeit.
const own = (template: string, path: (input: JsonObject) => string, was: string) => ({
  template,
  check: async (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => {
    assertHerkunft(await request(client, context, "GET", path(input)), context, was);
  },
});
// Eine Kennung muss in einer vereinseigenen Liste stehen — für Ressourcen, die
// keine eigene Leseroute haben (Posten, Finanzierung, Cashflow, Geldkonto).
const listed = (template: string, list: (input: JsonObject) => string, idKey: string, was: string, owner?: (input: JsonObject) => string, query?: Record<string, string>) => ({
  template,
  check: async (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => {
    if (owner) assertHerkunft(investmentPlanRecord(await request(client, context, "GET", owner(input))), context, `${was} (Plan)`);
    const rows = await request(client, context, "GET", list(input), query ? { query } : {});
    const items = Array.isArray(rows) ? rows : [];
    const id = str(input, idKey);
    const row = items.find((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry) && entry.id === id);
    if (!row) throw createConnectorError({ code: "TENANT_MISMATCH", message: `${was}: Die Kennung gehört nicht zu diesem Verein.`, request_id: context.request_id, retryable: false });
    assertTenant(row as JsonValue, context);
  },
});

const entryOwn = own("/entries/{entry_id}", (i) => `/entries/${str(i, "entry_id")}`, "Buchung");
const positionOwn = own("/positions/{position_id}", (i) => `/positions/${str(i, "position_id")}`, "Position");
const reportOwn = own("/reports/cash/{report_id}", (i) => `/reports/cash/${str(i, "report_id")}`, "Kassenbericht");
// GET /investment-plans/{id} answers the dashboard view {plan, items, …};
// the club is on `plan`, not on the top level.
function investmentPlanRecord(value: JsonValue): JsonValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) && value.plan !== undefined ? value.plan : value;
}
const investmentOwn = {
  template: "/investment-plans/{investment_plan_id}",
  check: async (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => {
    assertHerkunft(investmentPlanRecord(await request(client, context, "GET", `/investment-plans/${str(input, "investment_plan_id")}`)), context, "Investitionsplan");
  },
};
const scenarioOwn = {
  template: "/scenarios/{scenario_id}",
  check: async (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => {
    // Ein Szenario trägt keinen Verein, wohl aber seinen Plan.
    const scenario = await request(client, context, "GET", `/scenarios/${str(input, "scenario_id")}`);
    const planId = scenario !== null && typeof scenario === "object" && !Array.isArray(scenario) ? scenario.investment_plan_id : null;
    if (typeof planId !== "string") throw createConnectorError({ code: "TENANT_MISMATCH", message: "Szenario: Der Plan ist nicht feststellbar.", request_id: context.request_id, retryable: false });
    assertHerkunft(investmentPlanRecord(await request(client, context, "GET", `/investment-plans/${planId}`)), context, "Szenario (Plan)");
  },
};

// ── Die Aktionen ─────────────────────────────────────────────────────────
const ACTIONS: Record<string, { source: string; ops: Op[] }> = {
  "cai.finance.21.plan_period": { source: "plan-by-id", ops: [
    { op: "list", method: "GET", template: "/clubs/{club_id}/finance-plans", path: (i) => `${club(i)}/finance-plans`, risk: "read", shape: {}, query: (i) => optional(i, ["department_id"]), multiDepartment: true },
    { op: "create", method: "POST", template: "/clubs/{club_id}/finance-plans", path: (i) => `${club(i)}/finance-plans`, risk: "write", shape: { data }, body: payload },
    { op: "show", method: "GET", template: BY_ID, path: byId, risk: "read", shape: { plan_id: uuid } },
    { op: "update", method: "PATCH", template: BY_ID, path: byId, risk: "write", shape: { plan_id: uuid, data }, body: payload },
    { op: "positions", method: "GET", template: `${BY_ID}/positions`, path: (i) => `${byId(i)}/positions`, risk: "read", shape: { plan_id: uuid } },
    { op: "position_create", method: "POST", template: `${BY_ID}/positions`, path: (i) => `${byId(i)}/positions`, risk: "write", shape: { plan_id: uuid, data }, body: payload },
    { op: "summary", method: "GET", template: `${BY_ID}/summary`, path: (i) => `${byId(i)}/summary`, risk: "read", shape: { plan_id: uuid }, multiDepartment: true },
    { op: "journal", method: "GET", template: `${BY_ID}/journal`, path: (i) => `${byId(i)}/journal`, risk: "read", shape: { plan_id: uuid, after_journal_number: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(500).optional() }, query: (i) => optional(i, ["after_journal_number", "limit"]), multiDepartment: true },
    { op: "entries_without_receipt", method: "GET", template: `${BY_ID}/entries-without-receipt`, path: (i) => `${byId(i)}/entries-without-receipt`, risk: "read", shape: { plan_id: uuid }, multiDepartment: true },
    { op: "sphere_report", method: "GET", template: `${BY_ID}/sphere-report`, path: (i) => `${byId(i)}/sphere-report`, risk: "read", shape: { plan_id: uuid }, multiDepartment: true },
    { op: "dashboard", method: "GET", template: "/clubs/{club_id}/finance-plans/{year}/dashboard", path: (i) => `${club(i)}/finance-plans/${int(i, "year")}/dashboard`, risk: "read", shape: { year }, multiDepartment: true },
  ] },
  "cai.finance.22.plan_lifecycle": { source: "plan-close|next-period", ops: [
    // Schließen fixiert Beleg, Endbestände und die Anfangsbestände der Folgepläne.
    { op: "close", method: "POST", template: `${BY_ID}/close`, path: (i) => `${byId(i)}/close`, risk: "critical", shape: { plan_id: uuid, force: z.boolean().default(false), note: z.string().max(500).optional() }, body: (i) => ({ force: i.force === true, ...(typeof i.note === "string" ? { note: i.note } : {}) }), multiDepartment: true },
    // Übernahme legt den Folgeplan an oder füllt ihn — viele Posten auf einmal, dazu Übertrag und Anfangsbestände.
    { op: "next_period", method: "POST", template: `${BY_ID}/next-period`, path: (i) => `${byId(i)}/next-period`, risk: "critical", shape: { plan_id: uuid, data: data.optional() }, body: (i) => (i.data ?? {}) as JsonValue, multiDepartment: true },
  ] },
  "cai.finance.23.settings": { source: "settings", ops: [
    { op: "show", method: "GET", template: "/clubs/{club_id}/finance-settings", path: (i) => `${club(i)}/finance-settings`, risk: "read", shape: {} },
    { op: "update", method: "PUT", template: "/clubs/{club_id}/finance-settings", path: (i) => `${club(i)}/finance-settings`, risk: "write", shape: { data }, body: payload },
  ] },
  "cai.finance.24.money_account": { source: "money-account", ops: [
    { op: "list", method: "GET", template: "/clubs/{club_id}/money-accounts", path: (i) => `${club(i)}/money-accounts`, risk: "read", shape: { include_archived: z.boolean().optional() }, query: (i) => optional(i, ["include_archived"]), multiDepartment: true },
    { op: "create", method: "POST", template: "/clubs/{club_id}/money-accounts", path: (i) => `${club(i)}/money-accounts`, risk: "write", shape: { data }, body: payload },
    { op: "update", method: "PATCH", template: "/money-accounts/{account_id}", path: (i) => `/money-accounts/${str(i, "account_id")}`, risk: "write", shape: { account_id: uuid, data }, body: payload,
      preflight: listed("/clubs/{club_id}/money-accounts", (i) => `${club(i)}/money-accounts`, "account_id", "Geldkonto", undefined, { include_archived: "true" }) },
    { op: "opening", method: "PUT", template: `${BY_ID}/money-accounts/{account_id}/opening`, path: (i) => `${byId(i)}/money-accounts/${str(i, "account_id")}/opening`, risk: "write", shape: { plan_id: uuid, account_id: uuid, data }, body: payload },
    { op: "opening_versions", method: "GET", template: `${BY_ID}/money-accounts/{account_id}/opening/versions`, path: (i) => `${byId(i)}/money-accounts/${str(i, "account_id")}/opening/versions`, risk: "read", shape: { plan_id: uuid, account_id: uuid } },
    { op: "cash_book", method: "GET", template: `${BY_ID}/cash-book`, path: (i) => `${byId(i)}/cash-book`, risk: "read", shape: { plan_id: uuid, money_account_id: uuid }, query: (i) => optional(i, ["money_account_id"]) },
    { op: "reconciliation", method: "GET", template: `${BY_ID}/money-accounts/reconciliation`, path: (i) => `${byId(i)}/money-accounts/reconciliation`, risk: "read", shape: { plan_id: uuid }, multiDepartment: true },
  ] },
  "cai.finance.25.entry_correction": { source: "entry-create|reverse|receipt|tax-sphere", ops: [
    // Die Buchung mit allem, was die GoBD-Klammer verlangt: Geldkonto
    // (money_account_required) und Beleg oder Eigenbeleg-Begründung
    // (receipt_required). cai.finance.16 kennt beides nicht — in einem Verein
    // mit Geldkonten nimmt der Dienst dort keine Buchung an.
    { op: "entry_create", method: "POST", template: "/positions/{position_id}/entries", path: (i) => `/positions/${str(i, "position_id")}/entries`, risk: "write", shape: { position_id: uuid, data }, body: payload, preflight: positionOwn },
    // Ein Storno ist eine neue, festgeschriebene Gegenbuchung — nicht umkehrbar.
    { op: "reverse", method: "POST", template: "/entries/{entry_id}/reverse", path: (i) => `/entries/${str(i, "entry_id")}/reverse`, risk: "critical", shape: { entry_id: uuid, data }, body: payload, preflight: entryOwn },
    { op: "receipt", method: "PUT", template: "/entries/{entry_id}/receipt", path: (i) => `/entries/${str(i, "entry_id")}/receipt`, risk: "write", shape: { entry_id: uuid, data }, body: payload, preflight: entryOwn },
    { op: "versions", method: "GET", template: "/entries/{entry_id}/versions", path: (i) => `/entries/${str(i, "entry_id")}/versions`, risk: "read", shape: { entry_id: uuid }, preflight: entryOwn },
    { op: "tax_sphere", method: "PUT", template: "/positions/{position_id}/tax-sphere", path: (i) => `/positions/${str(i, "position_id")}/tax-sphere`, risk: "write", shape: { position_id: uuid, data }, body: payload, preflight: positionOwn },
  ] },
  "cai.finance.26.cash_report": { source: "cash-report", ops: [
    { op: "list", method: "GET", template: "/clubs/{club_id}/reports/cash", path: (i) => `${club(i)}/reports/cash`, risk: "read", shape: {} },
    { op: "create", method: "POST", template: "/clubs/{club_id}/reports/cash", path: (i) => `${club(i)}/reports/cash`, risk: "write", shape: { data }, body: payload },
    { op: "show", method: "GET", template: "/reports/cash/{report_id}", path: (i) => `/reports/cash/${str(i, "report_id")}`, risk: "read", shape: { report_id: uuid }, preflight: reportOwn },
    { op: "submit", method: "POST", template: "/reports/cash/{report_id}/submit", path: (i) => `/reports/cash/${str(i, "report_id")}/submit`, risk: "write", shape: { report_id: uuid, data: data.optional() }, body: (i) => (i.data ?? {}) as JsonValue, preflight: reportOwn },
    { op: "reject", method: "POST", template: "/reports/cash/{report_id}/reject", path: (i) => `/reports/cash/${str(i, "report_id")}/reject`, risk: "write", shape: { report_id: uuid, data: data.optional() }, body: (i) => (i.data ?? {}) as JsonValue, preflight: reportOwn },
    // Die Freigabe schreibt die Buchungen des Zeitraums fest.
    { op: "approve", method: "POST", template: "/reports/cash/{report_id}/approve", path: (i) => `/reports/cash/${str(i, "report_id")}/approve`, risk: "critical", shape: { report_id: uuid, data: data.optional() }, body: (i) => (i.data ?? {}) as JsonValue, preflight: reportOwn },
    { op: "tax_report", method: "GET", template: "/clubs/{club_id}/reports/tax", path: (i) => `${club(i)}/reports/tax`, risk: "read", shape: { year }, query: (i) => optional(i, ["year"]), multiDepartment: true },
  ] },
  "cai.finance.27.department_transfer": { source: "department-transfer", ops: [
    { op: "list", method: "GET", template: "/clubs/{club_id}/department-transfers", path: (i) => `${club(i)}/department-transfers`, risk: "read", shape: { status: z.string().max(20).optional() }, query: (i) => optional(i, ["status"]), multiDepartment: true },
    { op: "account_choices", method: "GET", template: "/clubs/{club_id}/department-transfers/account-choices", path: (i) => `${club(i)}/department-transfers/account-choices`, risk: "read", shape: {}, multiDepartment: true },
    { op: "show", method: "GET", template: "/clubs/{club_id}/department-transfers/{transfer_id}", path: (i) => `${club(i)}/department-transfers/${str(i, "transfer_id")}`, risk: "read", shape: { transfer_id: uuid }, multiDepartment: true },
    { op: "create", method: "POST", template: "/clubs/{club_id}/department-transfers", path: (i) => `${club(i)}/department-transfers`, risk: "write", shape: { data }, body: payload, multiDepartment: true },
    ...(["confirm", "reject", "withdraw"] as const).map((step): Op => ({
      op: step, method: "POST", template: `/clubs/{club_id}/department-transfers/{transfer_id}/${step}`, path: (i) => `${club(i)}/department-transfers/${str(i, "transfer_id")}/${step}`,
      risk: "write", shape: { transfer_id: uuid, data: data.optional() }, body: (i) => (i.data ?? {}) as JsonValue, multiDepartment: true,
    })),
    { op: "reverse", method: "POST", template: "/clubs/{club_id}/department-transfers/{transfer_id}/reverse", path: (i) => `${club(i)}/department-transfers/${str(i, "transfer_id")}/reverse`, risk: "critical", shape: { transfer_id: uuid, data }, body: payload, multiDepartment: true },
  ] },
  "cai.finance.28.plan_result": { source: "plan-result", ops: [
    { op: "result", method: "GET", template: `${BY_ID}/result`, path: (i) => `${byId(i)}/result`, risk: "read", shape: { plan_id: uuid }, multiDepartment: true },
    { op: "open_items", method: "GET", template: `${BY_ID}/open-items`, path: (i) => `${byId(i)}/open-items`, risk: "read", shape: { plan_id: uuid } },
    { op: "open_item_create", method: "POST", template: `${BY_ID}/open-items`, path: (i) => `${byId(i)}/open-items`, risk: "write", shape: { plan_id: uuid, data }, body: payload },
    { op: "open_item_update", method: "PATCH", template: `${BY_ID}/open-items/{item_id}`, path: (i) => `${byId(i)}/open-items/${str(i, "item_id")}`, risk: "write", shape: { plan_id: uuid, item_id: uuid, data }, body: payload },
    { op: "open_item_delete", method: "DELETE", template: `${BY_ID}/open-items/{item_id}`, path: (i) => `${byId(i)}/open-items/${str(i, "item_id")}`, risk: "critical", shape: { plan_id: uuid, item_id: uuid } },
    { op: "resolutions", method: "GET", template: `${BY_ID}/resolutions`, path: (i) => `${byId(i)}/resolutions`, risk: "read", shape: { plan_id: uuid } },
    { op: "resolution_create", method: "POST", template: `${BY_ID}/resolutions`, path: (i) => `${byId(i)}/resolutions`, risk: "write", shape: { plan_id: uuid, data }, body: payload },
    { op: "resolution_update", method: "PATCH", template: `${BY_ID}/resolutions/{resolution_id}`, path: (i) => `${byId(i)}/resolutions/${str(i, "resolution_id")}`, risk: "write", shape: { plan_id: uuid, resolution_id: uuid, data }, body: payload },
    { op: "resolution_delete", method: "DELETE", template: `${BY_ID}/resolutions/{resolution_id}`, path: (i) => `${byId(i)}/resolutions/${str(i, "resolution_id")}`, risk: "critical", shape: { plan_id: uuid, resolution_id: uuid } },
  ] },
  "cai.finance.29.procedure_doc": { source: "procedure-doc", ops: [
    { op: "show", method: "GET", template: "/clubs/{club_id}/finance/procedure-documentation", path: (i) => `${club(i)}/finance/procedure-documentation`, risk: "read", shape: {} },
    { op: "version", method: "GET", template: "/clubs/{club_id}/finance/procedure-documentation/versions/{version_no}", path: (i) => `${club(i)}/finance/procedure-documentation/versions/${int(i, "version_no")}`, risk: "read", shape: { version_no: z.number().int().min(1) } },
    { op: "save", method: "POST", template: "/clubs/{club_id}/finance/procedure-documentation", path: (i) => `${club(i)}/finance/procedure-documentation`, risk: "write", shape: { data }, body: payload },
  ] },
  "cai.finance.30.audit_export": { source: "audit-export", ops: [
    { op: "list", method: "GET", template: `${BY_ID}/audit-exports`, path: (i) => `${byId(i)}/audit-exports`, risk: "read", shape: { plan_id: uuid }, multiDepartment: true },
    // Ein übergebener Stand für die Betriebsprüfung — gespeichert, nie gelöscht.
    { op: "create", method: "POST", template: `${BY_ID}/audit-exports`, path: (i) => `${byId(i)}/audit-exports`, risk: "critical", shape: { plan_id: uuid }, body: () => ({}), multiDepartment: true },
    { op: "download", method: "GET", template: `${BY_ID}/audit-exports/{export_id}/download`, path: (i) => `${byId(i)}/audit-exports/${str(i, "export_id")}/download`, risk: "read", shape: { plan_id: uuid, export_id: uuid }, binary: true },
  ] },
  "cai.finance.31.finance_views": { source: "event-finance|views", ops: [
    { op: "event", method: "GET", template: "/clubs/{club_id}/finance/event/{event_id}", path: (i) => `${club(i)}/finance/event/${str(i, "event_id")}`, risk: "read", shape: { event_id: uuid }, multiDepartment: true },
    { op: "event_reconciliation", method: "GET", template: "/events/{event_id}/finance/reconciliation", path: (i) => `/events/${str(i, "event_id")}/finance/reconciliation`, risk: "read", shape: { event_id: uuid }, multiDepartment: true },
    { op: "series_comparison", method: "GET", template: "/clubs/{club_id}/finance/series/{series_id}/comparison", path: (i) => `${club(i)}/finance/series/${str(i, "series_id")}/comparison`, risk: "read", shape: { series_id: uuid }, multiDepartment: true },
    { op: "department_history", method: "GET", template: "/clubs/{club_id}/finance/department/{target_department_id}/history", path: (i) => `${club(i)}/finance/department/${str(i, "target_department_id")}/history`, risk: "read", shape: { target_department_id: uuid } },
    { op: "object", method: "GET", template: "/clubs/{club_id}/finance/object/{object_id}", path: (i) => `${club(i)}/finance/object/${str(i, "object_id")}`, risk: "read", shape: { object_id: uuid }, multiDepartment: true },
  ] },
  "cai.finance.32.investment_plan": { source: "investment-plan", ops: [
    { op: "list", method: "GET", template: "/clubs/{club_id}/investment-plans", path: (i) => `${club(i)}/investment-plans`, risk: "read", shape: {} },
    { op: "create", method: "POST", template: "/clubs/{club_id}/investment-plans", path: (i) => `${club(i)}/investment-plans`, risk: "write", shape: { data }, body: payload },
    { op: "show", method: "GET", template: "/investment-plans/{investment_plan_id}", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}`, risk: "read", shape: { investment_plan_id: uuid } },
    { op: "update", method: "PATCH", template: "/investment-plans/{investment_plan_id}", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}`, risk: "write", shape: { investment_plan_id: uuid, data }, body: payload, preflight: investmentOwn },
    { op: "delete", method: "DELETE", template: "/investment-plans/{investment_plan_id}", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}`, risk: "critical", shape: { investment_plan_id: uuid }, preflight: investmentOwn },
    ...(["dashboard", "feasibility", "funding-summary", "loan-details"] as const).map((view): Op => ({
      op: view.replace("-", "_"), method: "GET", template: `/investment-plans/{investment_plan_id}/${view}`, path: (i) => `/investment-plans/${str(i, "investment_plan_id")}/${view}`,
      risk: "read", shape: { investment_plan_id: uuid }, preflight: investmentOwn,
    })),
  ] },
  "cai.finance.33.investment_item": { source: "investment-item", ops: [
    { op: "list", method: "GET", template: "/investment-plans/{investment_plan_id}/items", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}/items`, risk: "read", shape: { investment_plan_id: uuid }, preflight: investmentOwn },
    { op: "create", method: "POST", template: "/investment-plans/{investment_plan_id}/items", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}/items`, risk: "write", shape: { investment_plan_id: uuid, data }, body: payload, preflight: investmentOwn },
    { op: "update", method: "PATCH", template: "/investment-items/{item_id}", path: (i) => `/investment-items/${str(i, "item_id")}`, risk: "write", shape: { investment_plan_id: uuid, item_id: uuid, data }, body: payload,
      preflight: listed("/investment-plans/{investment_plan_id}/items", (i) => `/investment-plans/${str(i, "investment_plan_id")}/items`, "item_id", "Investitionsposten", (i) => `/investment-plans/${str(i, "investment_plan_id")}`) },
    { op: "delete", method: "DELETE", template: "/investment-items/{item_id}", path: (i) => `/investment-items/${str(i, "item_id")}`, risk: "critical", shape: { investment_plan_id: uuid, item_id: uuid },
      preflight: listed("/investment-plans/{investment_plan_id}/items", (i) => `/investment-plans/${str(i, "investment_plan_id")}/items`, "item_id", "Investitionsposten", (i) => `/investment-plans/${str(i, "investment_plan_id")}`) },
  ] },
  "cai.finance.34.investment_funding": { source: "investment-funding", ops: [
    { op: "list", method: "GET", template: "/investment-plans/{investment_plan_id}/funding-sources", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}/funding-sources`, risk: "read", shape: { investment_plan_id: uuid }, preflight: investmentOwn },
    { op: "create", method: "POST", template: "/investment-plans/{investment_plan_id}/funding-sources", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}/funding-sources`, risk: "write", shape: { investment_plan_id: uuid, data }, body: payload, preflight: investmentOwn },
    ...([["update", "PATCH", "write"], ["delete", "DELETE", "critical"]] as const).map(([step, method, risk]): Op => ({
      op: step, method, template: "/funding-sources/{source_id}", path: (i) => `/funding-sources/${str(i, "source_id")}`, risk,
      shape: { investment_plan_id: uuid, source_id: uuid, ...(step === "update" ? { data } : {}) }, ...(step === "update" ? { body: payload } : {}),
      preflight: listed("/investment-plans/{investment_plan_id}/funding-sources", (i) => `/investment-plans/${str(i, "investment_plan_id")}/funding-sources`, "source_id", "Finanzierungsquelle", (i) => `/investment-plans/${str(i, "investment_plan_id")}`),
    })),
    { op: "loan_show", method: "GET", template: "/funding-sources/{source_id}/loan-detail", path: (i) => `/funding-sources/${str(i, "source_id")}/loan-detail`, risk: "read", shape: { investment_plan_id: uuid, source_id: uuid },
      preflight: listed("/investment-plans/{investment_plan_id}/funding-sources", (i) => `/investment-plans/${str(i, "investment_plan_id")}/funding-sources`, "source_id", "Finanzierungsquelle", (i) => `/investment-plans/${str(i, "investment_plan_id")}`) },
    { op: "loan_create", method: "POST", template: "/funding-sources/{source_id}/loan-detail", path: (i) => `/funding-sources/${str(i, "source_id")}/loan-detail`, risk: "write", shape: { investment_plan_id: uuid, source_id: uuid, data }, body: payload,
      preflight: listed("/investment-plans/{investment_plan_id}/funding-sources", (i) => `/investment-plans/${str(i, "investment_plan_id")}/funding-sources`, "source_id", "Finanzierungsquelle", (i) => `/investment-plans/${str(i, "investment_plan_id")}`) },
    { op: "loan_update", method: "PATCH", template: "/loan-details/{detail_id}", path: (i) => `/loan-details/${str(i, "detail_id")}`, risk: "write", shape: { investment_plan_id: uuid, detail_id: uuid, data }, body: payload,
      preflight: listed("/investment-plans/{investment_plan_id}/loan-details", (i) => `/investment-plans/${str(i, "investment_plan_id")}/loan-details`, "detail_id", "Darlehen", (i) => `/investment-plans/${str(i, "investment_plan_id")}`) },
  ] },
  "cai.finance.35.investment_scenario": { source: "investment-scenario", ops: [
    { op: "list", method: "GET", template: "/investment-plans/{investment_plan_id}/scenarios", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}/scenarios`, risk: "read", shape: { investment_plan_id: uuid }, preflight: investmentOwn },
    { op: "create", method: "POST", template: "/investment-plans/{investment_plan_id}/scenarios", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}/scenarios`, risk: "write", shape: { investment_plan_id: uuid, data }, body: payload, preflight: investmentOwn },
    { op: "from_template", method: "POST", template: "/investment-plans/{investment_plan_id}/scenarios/from-template", path: (i) => `/investment-plans/${str(i, "investment_plan_id")}/scenarios/from-template`, risk: "write", shape: { investment_plan_id: uuid, data: data.optional() }, body: (i) => (i.data ?? {}) as JsonValue, preflight: investmentOwn },
    { op: "show", method: "GET", template: "/scenarios/{scenario_id}", path: (i) => `/scenarios/${str(i, "scenario_id")}`, risk: "read", shape: { scenario_id: uuid }, preflight: scenarioOwn },
    { op: "update", method: "PATCH", template: "/scenarios/{scenario_id}", path: (i) => `/scenarios/${str(i, "scenario_id")}`, risk: "write", shape: { scenario_id: uuid, data }, body: payload, preflight: scenarioOwn },
    { op: "delete", method: "DELETE", template: "/scenarios/{scenario_id}", path: (i) => `/scenarios/${str(i, "scenario_id")}`, risk: "critical", shape: { scenario_id: uuid }, preflight: scenarioOwn },
    { op: "auto_generate", method: "POST", template: "/scenarios/{scenario_id}/auto-generate", path: (i) => `/scenarios/${str(i, "scenario_id")}/auto-generate`, risk: "write", shape: { scenario_id: uuid, data: data.optional() }, body: (i) => (i.data ?? {}) as JsonValue, preflight: scenarioOwn },
    { op: "cashflow_list", method: "GET", template: "/scenarios/{scenario_id}/cashflow-entries", path: (i) => `/scenarios/${str(i, "scenario_id")}/cashflow-entries`, risk: "read", shape: { scenario_id: uuid }, preflight: scenarioOwn },
    { op: "cashflow_create", method: "POST", template: "/scenarios/{scenario_id}/cashflow-entries", path: (i) => `/scenarios/${str(i, "scenario_id")}/cashflow-entries`, risk: "write", shape: { scenario_id: uuid, data }, body: payload, preflight: scenarioOwn },
    ...([["cashflow_update", "PATCH", "write"], ["cashflow_delete", "DELETE", "critical"]] as const).map(([step, method, risk]): Op => ({
      op: step, method, template: "/cashflow-entries/{entry_id}", path: (i) => `/cashflow-entries/${str(i, "cashflow_entry_id")}`, risk,
      shape: { scenario_id: uuid, cashflow_entry_id: uuid, ...(step === "cashflow_update" ? { data } : {}) }, ...(step === "cashflow_update" ? { body: payload } : {}),
      preflight: {
        template: "/scenarios/{scenario_id}/cashflow-entries",
        check: async (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => {
          await scenarioOwn.check(input, context, client);
          const rows = await request(client, context, "GET", `/scenarios/${str(input, "scenario_id")}/cashflow-entries`);
          const id = str(input, "cashflow_entry_id");
          if (!(Array.isArray(rows) && rows.some((row) => row !== null && typeof row === "object" && !Array.isArray(row) && row.id === id))) {
            throw createConnectorError({ code: "TENANT_MISMATCH", message: "Cashflow-Eintrag: Die Kennung gehört nicht zu diesem Szenario.", request_id: context.request_id, retryable: false });
          }
        },
      },
    })),
  ] },
};

// ── Definitionen, Schemas, Handler ───────────────────────────────────────
function gate(risk: Risk): K14ExecutionGate { return risk === "read" ? "inline" : risk === "critical" ? "confirmation" : "write_safety"; }
function actionRisk(risk: Risk): ActionRisk { return risk === "read" ? "read" : risk === "critical" ? "critical_write" : "reversible_write"; }
function scopes(risk: Risk): OAuthScope[] { return [risk === "read" ? "finance.read" : "finance.write"]; }

function operationDefinition(op: Op): K14OperationDefinition {
  return {
    operation: op.op,
    required_scopes: scopes(op.risk),
    permission_policy: policy(),
    risk_class: actionRisk(op.risk),
    execution_gate: gate(op.risk),
    backend_routes: [...(op.preflight ? [route("GET", op.preflight.template, "preflight")] : []), route(op.method, op.template)],
    external_effect: op.risk === "read" ? "none" : "comvenio_private",
  };
}

export const HUB_ACTION_DEFINITIONS: Readonly<Record<string, K14ActionDefinition>> = Object.freeze(Object.fromEntries(
  Object.entries(ACTIONS).map(([id, spec]) => [id, {
    action_id: id as K14ActionId,
    domain: "finance",
    source_action: spec.source,
    source_path: "src/commands/finance.ts",
    operations: Object.freeze(Object.fromEntries(spec.ops.map((op) => [op.op, operationDefinition(op)]))),
    publication_state: "implemented",
    blocker: null,
  } satisfies K14ActionDefinition]),
));

export const HUB_ACTION_SCHEMAS: Readonly<Record<string, K14ActionSchemaContract>> = Object.freeze(Object.fromEntries(
  Object.entries(ACTIONS).map(([id, spec]) => {
    const variants = spec.ops.map((op) => z.object({ ...base, operation: z.literal(op.op), ...op.shape }).strict());
    const input = variants.length === 1 ? variants[0]! : z.discriminatedUnion("operation", variants as never);
    return [id, { input, output: z.json() }];
  }),
));

const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

for (const [id, spec] of Object.entries(ACTIONS)) {
  for (const op of spec.ops) {
    addK14Handler(id as K14ActionId, op.op, async (input, context, client) => {
      if (op.preflight) await op.preflight.check(input, context, client);
      const query = op.query?.(input);
      if (op.binary) {
        if (!client.requestBytes) throw createConnectorError({ code: "CONFIG_INVALID", message: "Der Dienst-Client kann keine Dateien laden.", request_id: context.request_id, retryable: false });
        const file = await client.requestBytes({ method: op.method, service: "finance", path: op.path(input), context, ...(query ? { query } : {}) });
        if (file.bytes.byteLength > MAX_EXPORT_BYTES) throw createConnectorError({ code: "VALIDATION_FAILED", message: "Der Export ist größer als 20 MB und wird nicht über den Connector übertragen.", request_id: context.request_id, retryable: false });
        return {
          content_type: file.content_type,
          size_bytes: file.bytes.byteLength,
          sha256: createHash("sha256").update(file.bytes).digest("hex"),
          content_base64: Buffer.from(file.bytes).toString("base64"),
        };
      }
      const value = await request(client, context, op.method, op.path(input), {
        ...(op.body ? { body: op.body(input) } : {}),
        ...(query && Object.keys(query).length ? { query } : {}),
      });
      if (op.method === "DELETE" && value === null) return { deleted: true };
      return redactFinanceValue(assertTenant(value, context, !op.multiDepartment));
    });
  }
}

export function hubOperationCount(): number {
  return Object.values(ACTIONS).reduce((sum, spec) => sum + spec.ops.length, 0);
}
