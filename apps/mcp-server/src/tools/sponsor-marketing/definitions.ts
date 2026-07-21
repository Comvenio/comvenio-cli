import type { ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { OAuthScope } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";

import { K13_SPONSOR_ACTION_IDS, type K13ActionDefinition, type K13ActionId, type K13BackendRoute, type K13ExecutionGate, type K13OperationDefinition } from "./types.ts";

type Profile = "read" | "manage" | "member_read" | "file_read" | "file_write";
const permissions: Record<Profile, string[]> = {
  read: ["view_sponsors", "manage_sponsors"],
  manage: ["manage_sponsors"],
  member_read: ["view_sponsors", "manage_sponsors"],
  file_read: ["view_sponsors", "manage_sponsors"],
  file_write: ["manage_sponsors"],
};
function policy(profile: Profile): PermissionPolicy {
  return { all_of: profile === "member_read" ? ["view_members"] : [], any_of: [...permissions[profile]], owner_or_self_allowed: false, department_scope: "optional", backend_audit_refs: [`k13:${profile}`] };
}
function route(method: ComvenioHttpMethod, service: K13BackendRoute["service"], path: string, purpose?: K13BackendRoute["purpose"]): K13BackendRoute {
  return { method, service, normalized_path_template: path, purpose: purpose ?? (method === "GET" ? "read" : "mutation") };
}
function operation(input: { name: string; profile: Profile; scopes: OAuthScope[]; risk: ActionRisk; gate?: K13ExecutionGate; routes: K13BackendRoute[]; external?: K13OperationDefinition["external_effect"] }): K13OperationDefinition {
  const gate = input.gate ?? (input.risk === "read" ? "inline" : input.risk === "critical_write" ? "confirmation" : "write_safety");
  return { operation: input.name, required_scopes: input.scopes, permission_policy: policy(input.profile), risk_class: input.risk, execution_gate: gate, backend_routes: input.routes, external_effect: input.external ?? (input.risk === "read" ? "none" : "comvenio_private") };
}
const read = (name: string, profile: Profile, scopes: OAuthScope[], service: K13BackendRoute["service"], path: string) => operation({ name, profile, scopes, risk: "read", routes: [route("GET", service, path)] });
const write = (name: string, method: ComvenioHttpMethod, path: string, critical = false, external: K13OperationDefinition["external_effect"] = "comvenio_private", routes?: K13BackendRoute[]) => operation({ name, profile: "manage", scopes: ["sponsor.write"], risk: critical ? "critical_write" : "reversible_write", routes: routes ?? [route(method, "marketing", path)], external });
function action(id: K13ActionId, source: string, operations: K13OperationDefinition[]): K13ActionDefinition {
  return { action_id: id, domain: "sponsor", source_action: source, source_path: "src/commands/sponsor.ts", operations: Object.freeze(Object.fromEntries(operations.map((entry) => [entry.operation, entry]))), publication_state: "implemented", blocker: null };
}

const advertiserPreflight = route("GET", "marketing", "/advertisers/{sponsor_id}", "preflight");
export const K13_ACTION_DEFINITIONS: Readonly<Record<K13ActionId, K13ActionDefinition>> = Object.freeze({
  "cai.sponsor.01.list": action("cai.sponsor.01.list", "list", [read("list", "read", ["sponsor.read"], "marketing", "/advertisers/")]),
  "cai.sponsor.02.show": action("cai.sponsor.02.show", "show", [read("show", "read", ["sponsor.read"], "marketing", "/advertisers/{sponsor_id}")]),
  "cai.sponsor.03.add": action("cai.sponsor.03.add", "add", [write("add", "POST", "/advertisers/")]),
  "cai.sponsor.04.update": action("cai.sponsor.04.update", "update", [
    write("update", "PATCH", "/advertisers/{sponsor_id}", true, "comvenio_public", [advertiserPreflight, route("PATCH", "marketing", "/advertisers/{sponsor_id}")]),
    write("move_department", "PATCH", "/advertisers/{sponsor_id}", true, "comvenio_private", [advertiserPreflight, route("PATCH", "marketing", "/advertisers/{sponsor_id}")]),
  ]),
  "cai.sponsor.05.delete": action("cai.sponsor.05.delete", "delete", [write("delete", "DELETE", "/advertisers/{sponsor_id}", true, "comvenio_public", [advertiserPreflight, route("DELETE", "marketing", "/advertisers/{sponsor_id}")])]),
  "cai.sponsor.06.logo": action("cai.sponsor.06.logo", "logo", [operation({ name: "set", profile: "manage", scopes: ["sponsor.write", "files.read"], risk: "critical_write", routes: [route("GET", "content", "/files/{logo_file_id}", "preflight"), advertiserPreflight, route("PATCH", "marketing", "/advertisers/{sponsor_id}")], external: "comvenio_public" })]),
  "cai.sponsor.07.product_list": action("cai.sponsor.07.product_list", "product-list", [read("list", "read", ["sponsor.read"], "marketing", "/club-sponsorship-products/")]),
  "cai.sponsor.08.product_add": action("cai.sponsor.08.product_add", "product-add", [write("add", "POST", "/club-sponsorship-products/")]),
  "cai.sponsor.09.product_update": action("cai.sponsor.09.product_update", "product-update", [write("update", "PATCH", "/club-sponsorship-products/{product_id}"), write("move_department", "PATCH", "/club-sponsorship-products/{product_id}", true)]),
  "cai.sponsor.10.product_delete": action("cai.sponsor.10.product_delete", "product-delete", [write("delete", "DELETE", "/club-sponsorship-products/{product_id}", true)]),
  "cai.sponsor.11.contract_list": action("cai.sponsor.11.contract_list", "contract-list", [read("list", "read", ["sponsor.read"], "marketing", "/club-sponsorship-products/{product_id}/contract-versions")]),
  "cai.sponsor.12.contract_add": action("cai.sponsor.12.contract_add", "contract-add", [operation({ name: "add", profile: "manage", scopes: ["sponsor.write", "files.read"], risk: "reversible_write", routes: [route("GET", "content", "/files/{contract_file_id}", "preflight"), route("POST", "marketing", "/club-sponsorship-products/{product_id}/contract-versions")] })]),
  "cai.sponsor.13.contract_update": action("cai.sponsor.13.contract_update", "contract-update", [write("update", "PATCH", "/club-sponsorship-products/{product_id}/contract-versions/{contract_version_id}"), operation({ name: "replace_file", profile: "manage", scopes: ["sponsor.write", "files.read"], risk: "reversible_write", routes: [route("GET", "content", "/files/{contract_file_id}", "preflight"), route("PATCH", "marketing", "/club-sponsorship-products/{product_id}/contract-versions/{contract_version_id}")] })]),
  "cai.sponsor.14.contract_delete": action("cai.sponsor.14.contract_delete", "contract-delete", [write("delete", "DELETE", "/club-sponsorship-products/{product_id}/contract-versions/{contract_version_id}", true)]),
  "cai.sponsor.15.assignment_list": action("cai.sponsor.15.assignment_list", "assignment-list", [read("list", "read", ["sponsor.read"], "marketing", "/sponsorship-assignments/")]),
  "cai.sponsor.16.assign": action("cai.sponsor.16.assign", "assign", [write("assign", "POST", "/sponsorship-assignments/", true, "comvenio_public")]),
  "cai.sponsor.17.assignment_update": action("cai.sponsor.17.assignment_update", "assignment-update", [write("update", "PATCH", "/sponsorship-assignments/{assignment_id}", true, "comvenio_public")]),
  "cai.sponsor.18.cancel": action("cai.sponsor.18.cancel", "cancel", [write("cancel", "POST", "/sponsorship-assignments/{assignment_id}/cancel", true, "comvenio_public")]),
  "cai.sponsor.19.doc_list": action("cai.sponsor.19.doc_list", "doc-list", [read("list", "file_read", ["sponsor.read", "files.read"], "content", "/files/by-context/{club_id}/sponsorship_assignment/{assignment_id}")]),
  "cai.sponsor.20.doc_upload": action("cai.sponsor.20.doc_upload", "doc-upload", [operation({ name: "upload", profile: "file_write", scopes: ["sponsor.write", "files.import", "files.write"], risk: "reversible_write", gate: "job", routes: [route("GET", "content", "/files/{source_file_id}", "job_input"), route("GET", "marketing", "/sponsorship-assignments/", "job_input"), route("POST", "connector", "/jobs/sponsor-document", "job_input"), route("POST", "content", "/files/presign-upload", "job_input")] })]),
  "cai.sponsor.21.responsible_list": action("cai.sponsor.21.responsible_list", "responsible-list", [read("list", "member_read", ["sponsor.read", "member.read.basic"], "marketing", "/sponsor-member-assignments/")]),
  "cai.sponsor.22.responsible_add": action("cai.sponsor.22.responsible_add", "responsible-add", [write("add", "POST", "/sponsor-member-assignments/")]),
  "cai.sponsor.23.responsible_update": action("cai.sponsor.23.responsible_update", "responsible-update", [write("update", "PATCH", "/sponsor-member-assignments/{responsible_id}")]),
  "cai.sponsor.24.responsible_remove": action("cai.sponsor.24.responsible_remove", "responsible-remove", [write("remove", "DELETE", "/sponsor-member-assignments/{responsible_id}", true)]),
});

export function validateK13Definitions(): void {
  if (Object.keys(K13_ACTION_DEFINITIONS).length !== K13_SPONSOR_ACTION_IDS.length) throw new Error("K13-Aktionsinventar und Definitionen sind nicht deckungsgleich.");
  for (const id of K13_SPONSOR_ACTION_IDS) for (const [name, branch] of Object.entries(K13_ACTION_DEFINITIONS[id].operations)) {
    if (name !== branch.operation || branch.backend_routes.length === 0) throw new Error(`${id}:${name}: ungültige Branch-Definition.`);
    if (branch.risk_class === "critical_write" && branch.execution_gate !== "confirmation") throw new Error(`${id}:${name}: kritische Aktion ohne Bestätigung.`);
    if (branch.risk_class === "read" && branch.execution_gate !== "inline") throw new Error(`${id}:${name}: Read mit ungültigem Gate.`);
  }
}
