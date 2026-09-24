import type { ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { OAuthScope } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";

import { HUB_ACTION_DEFINITIONS } from "./hub.ts";
import { K14_FINANCE_ACTION_IDS, type K14ActionDefinition, type K14ActionId, type K14BackendRoute, type K14ExecutionGate, type K14OperationDefinition } from "./types.ts";

// Der finance-service kennt KEIN getrenntes Leserecht: `require_club_finance_access`
// (app/utils/permissions.py) prüft für Lesen wie Schreiben dieselben beiden Rechte.
// Die Trennung liegt allein im OAuth-Scope — wer nur `finance.read` erteilt, gibt
// dem Agenten Einblick ohne Schreibrecht, obwohl sein eigenes Vereinsrecht beides
// erlauben würde.
const FINANCE_PERMISSIONS = ["manage_finances", "manage_club_settings"] as const;
function policy(): PermissionPolicy {
  return { all_of: [], any_of: [...FINANCE_PERMISSIONS], owner_or_self_allowed: false, department_scope: "optional", backend_audit_refs: ["k14:finance"] };
}
function route(method: ComvenioHttpMethod, path: string, purpose?: K14BackendRoute["purpose"]): K14BackendRoute {
  return { method, service: "finance", normalized_path_template: path, purpose: purpose ?? (method === "GET" ? "read" : "mutation") };
}
function operation(input: { name: string; scopes: OAuthScope[]; risk: ActionRisk; gate?: K14ExecutionGate; routes: K14BackendRoute[] }): K14OperationDefinition {
  const gate = input.gate ?? (input.risk === "read" ? "inline" : input.risk === "critical_write" ? "confirmation" : "write_safety");
  return { operation: input.name, required_scopes: input.scopes, permission_policy: policy(), risk_class: input.risk, execution_gate: gate, backend_routes: input.routes, external_effect: input.risk === "read" ? "none" : "comvenio_private" };
}
const read = (name: string, path: string, extraRoutes: K14BackendRoute[] = []) => operation({ name, scopes: ["finance.read"], risk: "read", routes: [route("GET", path), ...extraRoutes] });
const write = (name: string, method: ComvenioHttpMethod, path: string, critical = false, routes?: K14BackendRoute[]) =>
  operation({ name, scopes: ["finance.write"], risk: critical ? "critical_write" : "reversible_write", routes: routes ?? [route(method, path)] });
function action(id: K14ActionId, source: string, operations: K14OperationDefinition[]): K14ActionDefinition {
  return { action_id: id, domain: "finance", source_action: source, source_path: "src/commands/finance.ts", operations: Object.freeze(Object.fromEntries(operations.map((entry) => [entry.operation, entry]))), publication_state: "implemented", blocker: null };
}

const PLANS = "/clubs/{club_id}/finance-plans";
const PLAN = `${PLANS}/{year}`;
// Löschen antwortet mit 204 ohne Rumpf. Ohne den Preflight bliebe der
// Vereinsabgleich der Antwort wirkungslos, und eine fremde Positions- oder
// Buchungskennung ginge durch, solange der ANFRAGENDE Mensch in beiden Vereinen
// Rechte hat — der Dienst prüft seine Rechte, nicht den hier gewählten Verein.
const positionPreflight = route("GET", "/positions/{position_id}", "preflight");
// Nur wenn `parent_position_id` genannt ist — der Routenvertrag nennt den
// moeglichen Aufruf, nicht den garantierten.
const parentPreflight = route("GET", "/positions/{parent_position_id}", "preflight");
const entryPreflight = route("GET", "/entries/{entry_id}", "preflight");

export const K14_ACTION_DEFINITIONS: Readonly<Record<K14ActionId, K14ActionDefinition>> = Object.freeze({
  "cai.finance.01.plan_list": action("cai.finance.01.plan_list", "plan-list", [read("list", PLANS)]),
  "cai.finance.02.plan_show": action("cai.finance.02.plan_show", "plan-show", [read("show", PLAN)]),
  "cai.finance.03.plan_create": action("cai.finance.03.plan_create", "plan-create", [write("create", "POST", PLANS)]),
  "cai.finance.04.plan_update": action("cai.finance.04.plan_update", "plan-update", [write("update", "PATCH", PLAN)]),
  // Schliessen sperrt ein ganzes Jahr für jede weitere Buchung — die Wirkung
  // reicht über den einzelnen Satz hinaus.
  "cai.finance.05.plan_close": action("cai.finance.05.plan_close", "plan-close", [write("close", "POST", `${PLAN}/close`, true)]),
  // 06 (plan-reopen) fehlt mit Absicht — Begruendung in types.ts.
  "cai.finance.07.plan_copy": action("cai.finance.07.plan_copy", "plan-copy", [write("copy", "POST", `${PLAN}/copy-from/{source_year}`, true)]),
  "cai.finance.08.position_list": action("cai.finance.08.position_list", "position-list", [read("list", `${PLAN}/positions`)]),
  "cai.finance.09.position_create": action("cai.finance.09.position_create", "position-create", [write("create", "POST", `${PLAN}/positions`, false, [parentPreflight, route("POST", `${PLAN}/positions`)])]),
  "cai.finance.10.position_show": action("cai.finance.10.position_show", "position-show", [read("show", "/positions/{position_id}")]),
  "cai.finance.11.position_update": action("cai.finance.11.position_update", "position-update", [write("update", "PATCH", "/positions/{position_id}", false, [positionPreflight, route("PATCH", "/positions/{position_id}")])]),
  "cai.finance.12.position_delete": action("cai.finance.12.position_delete", "position-delete", [write("delete", "DELETE", "/positions/{position_id}", true, [positionPreflight, route("DELETE", "/positions/{position_id}")])]),
  "cai.finance.13.position_import_shopping": action("cai.finance.13.position_import_shopping", "position-import-shopping", [write("import", "POST", "/positions/{position_id}/import-shopping-estimate", false, [positionPreflight, route("POST", "/positions/{position_id}/import-shopping-estimate")])]),
  "cai.finance.14.summary": action("cai.finance.14.summary", "summary", [
    read("total", `${PLAN}/summary`),
    read("by_department", `${PLAN}/summary/{department_id}`),
  ]),
  "cai.finance.15.entry_list": action("cai.finance.15.entry_list", "entry-list", [read("list", "/positions/{position_id}/entries")]),
  "cai.finance.16.entry_create": action("cai.finance.16.entry_create", "entry-create", [write("create", "POST", "/positions/{position_id}/entries", false, [positionPreflight, route("POST", "/positions/{position_id}/entries")])]),
  "cai.finance.17.entry_show": action("cai.finance.17.entry_show", "entry-show", [read("show", "/entries/{entry_id}")]),
  // buchhaltung-13-04 DC-4: eine Korrektur ändert eine verbuchte Zahl — mit Bestätigung.
  "cai.finance.18.entry_update": action("cai.finance.18.entry_update", "entry-update", [write("update", "PATCH", "/entries/{entry_id}", true, [entryPreflight, route("PATCH", "/entries/{entry_id}")])]),
  "cai.finance.19.entry_delete": action("cai.finance.19.entry_delete", "entry-delete", [write("delete", "DELETE", "/entries/{entry_id}", true, [entryPreflight, route("DELETE", "/entries/{entry_id}")])]),
  // Freigeben ist die Stelle, an der aus einem Entwurf ein verbuchter Beleg wird.
  "cai.finance.20.entry_approve": action("cai.finance.20.entry_approve", "entry-approve", [write("approve", "POST", "/entries/{entry_id}/approve", true, [entryPreflight, route("POST", "/entries/{entry_id}/approve")])]),

  // Finance Hub vollständig (hub.ts).
  ...(HUB_ACTION_DEFINITIONS as Record<string, K14ActionDefinition>),
}) as Readonly<Record<K14ActionId, K14ActionDefinition>>;

export function validateK14Definitions(): void {
  if (Object.keys(K14_ACTION_DEFINITIONS).length !== K14_FINANCE_ACTION_IDS.length) throw new Error("K14-Aktionsinventar und Definitionen sind nicht deckungsgleich.");
  for (const id of K14_FINANCE_ACTION_IDS) for (const [name, branch] of Object.entries(K14_ACTION_DEFINITIONS[id].operations)) {
    if (name !== branch.operation || branch.backend_routes.length === 0) throw new Error(`${id}:${name}: ungültige Branch-Definition.`);
    if (branch.risk_class === "critical_write" && branch.execution_gate !== "confirmation") throw new Error(`${id}:${name}: kritische Aktion ohne Bestätigung.`);
    if (branch.risk_class === "read" && branch.execution_gate !== "inline") throw new Error(`${id}:${name}: Read mit ungültigem Gate.`);
    if (branch.risk_class === "read" && branch.required_scopes.includes("finance.write")) throw new Error(`${id}:${name}: Lesen darf keinen Schreib-Scope verlangen.`);
  }
}
