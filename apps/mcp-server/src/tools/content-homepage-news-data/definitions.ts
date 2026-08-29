import type { ComvenioHttpMethod } from "@comvenio/comvenio-client";
import type { OAuthScope } from "@comvenio/connector-contracts";
import type { ActionRisk, PermissionPolicy } from "@comvenio/tool-catalog";

import { K12_ACTION_IDS, type K12ActionDefinition, type K12ActionId, type K12BackendRoute, type K12Domain, type K12ExecutionGate, type K12OperationDefinition } from "./types.ts";

type Profile = "authenticated" | "homepage_manage" | "news_read" | "news_manage" | "file_read" | "file_write" | "file_rights" | "honors" | "member_export" | "booking_export";
const permissions: Record<Profile, string[]> = {
  authenticated: [],
  homepage_manage: ["manage_club_settings"],
  news_read: ["read_news", "manage_news"],
  news_manage: ["manage_news"],
  file_read: ["read_files", "write_files", "manage_news", "view_events", "manage_events", "view_sponsors", "manage_sponsors", "manage_honors"],
  file_write: ["write_files", "manage_news", "manage_events", "manage_tournaments", "manage_sponsors", "manage_honors"],
  file_rights: ["set_rights_files"],
  honors: ["manage_honors"],
  member_export: ["view_members_details", "manage_members"],
  booking_export: ["confirm_object_bookings", "manage_objects"],
};
function policy(profile: Profile): PermissionPolicy {
  return { all_of: [], any_of: [...permissions[profile]], owner_or_self_allowed: false, department_scope: "optional", backend_audit_refs: [`k12:${profile}`] };
}
function route(method: ComvenioHttpMethod, service: K12BackendRoute["service"], path: string, purpose?: K12BackendRoute["purpose"]): K12BackendRoute {
  return { method, service, normalized_path_template: path, purpose: purpose ?? (method === "GET" ? "read" : "mutation") };
}
function operation(input: {
  name: string; profile: Profile; scopes: OAuthScope[]; risk: ActionRisk; gate?: K12ExecutionGate; routes: K12BackendRoute[]; external?: K12OperationDefinition["external_effect"];
}): K12OperationDefinition {
  return { operation: input.name, required_scopes: input.scopes, permission_policy: policy(input.profile), risk_class: input.risk, execution_gate: input.gate ?? (input.risk === "read" ? "inline" : input.risk === "critical_write" ? "confirmation" : "write_safety"), backend_routes: input.routes, external_effect: input.external ?? (input.risk === "read" ? "none" : "comvenio_private") };
}
const read = (name: string, profile: Profile, scopes: OAuthScope[], service: K12BackendRoute["service"], path: string) => operation({ name, profile, scopes, risk: "read", routes: [route("GET", service, path)] });
const write = (name: string, profile: Profile, scopes: OAuthScope[], method: ComvenioHttpMethod, service: K12BackendRoute["service"], path: string, critical = false) => operation({ name, profile, scopes, risk: critical ? "critical_write" : "reversible_write", routes: [route(method, service, path)] });
const job = (name: string, profile: Profile, scopes: OAuthScope[], routes: K12BackendRoute[], confirmed = false, external: K12OperationDefinition["external_effect"] = "comvenio_private", risk: ActionRisk = confirmed ? "critical_write" : "read") => operation({ name, profile, scopes, risk, gate: confirmed ? "confirmed_job" : "job", routes, external });
function action(id: K12ActionId, domain: K12Domain, source: string, operations: K12OperationDefinition[], coverage: K12ActionDefinition["coverage_status"] = "covered"): K12ActionDefinition {
  return { action_id: id, domain, source_action: source, source_path: `src/commands/${domain}.ts`, operations: Object.freeze(Object.fromEntries(operations.map((entry) => [entry.operation, entry]))), publication_state: "implemented", blocker: null, coverage_status: coverage };
}

const fileRead = (name: string, path: string) => read(name, "file_read", ["files.read"], "content", path);
const fileWrite = (name: string, method: ComvenioHttpMethod, path: string, critical = false) => write(name, "file_write", ["files.write"], method, "content", path, critical);
const rightWrite = (name: string, method: ComvenioHttpMethod, path: string, critical = false) => write(name, "file_rights", ["files.write"], method, "content", path, critical);
const newsWrite = (name: string, method: ComvenioHttpMethod, path: string, critical = false) => write(name, "news_manage", ["content.write"], method, "content", path, critical);

export const K12_ACTION_DEFINITIONS: Readonly<Record<K12ActionId, K12ActionDefinition>> = Object.freeze({
  "cai.homepage.01.preview": action("cai.homepage.01.preview", "homepage", "preview", [operation({ name: "preview", profile: "homepage_manage", scopes: ["club.write"], risk: "read", routes: [route("POST", "club", "/home-config/{club_id}/preview", "read")] })]),
  "cai.homepage.02.apply": action("cai.homepage.02.apply", "homepage", "apply", [operation({ name: "apply", profile: "homepage_manage", scopes: ["club.write"], risk: "critical_write", routes: [route("POST", "club", "/home-config/{club_id}/bulk")], external: "comvenio_public" })]),
  // Rendert eine gespeicherte Vorschau zu Bildern. Ein entferntes Modell kann
  // die Vorschau-Route nicht oeffnen — ohne Bild baut es blind. risk: "read",
  // weil nichts geschrieben wird; das Recht ist dasselbe wie beim Anlegen,
  // denn der Aufruf startet einen Browser (fremde Rechenzeit).
  "cai.homepage.04.screenshot": action("cai.homepage.04.screenshot", "homepage", "screenshot", [operation({ name: "screenshot", profile: "homepage_manage", scopes: ["club.write"], risk: "read", routes: [route("POST", "club", "/home-config/{club_id}/preview/{preview_id}/screenshot", "read")] })]),
  "cai.homepage.03.show": action("cai.homepage.03.show", "homepage", "show", [read("private", "authenticated", ["club.read"], "club", "/home-config/{club_id}/tabs"), read("public", "authenticated", ["public.read"], "club", "/public/clubs/{club_id}/home")]),

  "cai.schema.01.list_domains": action("cai.schema.01.list_domains", "schema", "list domains", [read("list", "authenticated", ["club.read"], "connector", "/schema")], "core-partial"),
  "cai.schema.02.show_domain_schema": action("cai.schema.02.show_domain_schema", "schema", "show domain schema", [read("show", "authenticated", ["club.read"], "connector", "/schema/{domain}")], "core-partial"),

  "cai.verify.01.url": action("cai.verify.01.url", "verify", "url", [job("verify", "authenticated", ["club.read", "files.export"], [route("GET", "frontend", "{https_url}", "job_input")], false, "third_party")]),
  "cai.verify.02.event": action("cai.verify.02.event", "verify", "event", [job("verify", "authenticated", ["event.read", "files.export"], [route("GET", "frontend", "/club/{club_id}/event/{event_id}/public", "job_input")])]),
  "cai.verify.03.menu": action("cai.verify.03.menu", "verify", "menu", [job("verify", "authenticated", ["supply.read", "files.export"], [route("GET", "frontend", "/clubs/{club_id}/menu/{menu_id}", "job_input")])]),
  "cai.verify.04.homepage": action("cai.verify.04.homepage", "verify", "homepage", [job("live", "authenticated", ["club.read", "files.export"], [route("GET", "club", "/clubs/{club_id}", "job_input"), route("GET", "club", "/public/clubs/{club_id}/home", "job_input")]), job("preview", "homepage_manage", ["club.write", "files.export"], [route("POST", "club", "/home-config/{club_id}/preview", "job_input")])]),
  "cai.verify.05.news": action("cai.verify.05.news", "verify", "news", [job("verify", "news_read", ["content.read", "files.export"], [route("GET", "frontend", "/club/{club_id}/news/{news_id}", "job_input")])]),
  "cai.verify.06.certificate": action("cai.verify.06.certificate", "verify", "certificate", [job("verify", "honors", ["member.read.details", "files.export"], [route("POST", "member", "/honors/{honor_id}/generate-certificate", "job_input")])]),

  "cai.data.01.list": action("cai.data.01.list", "data", "list", [fileRead("list", "/files/by-context/{club_id}/{context_type}/{context_id}")]),
  "cai.data.02.show": action("cai.data.02.show", "data", "show", [fileRead("show", "/files/{file_id}")]),
  "cai.data.03.update": action("cai.data.03.update", "data", "update", [fileWrite("update", "PATCH", "/files/{file_id}/context")]),
  "cai.data.04.url": action("cai.data.04.url", "data", "url", [operation({ name: "reference", profile: "file_read", scopes: ["files.read"], risk: "read", routes: [route("POST", "content", "/files/download-url", "read")] })]),
  "cai.data.05.download": action("cai.data.05.download", "data", "download", [job("download", "file_read", ["files.read", "files.export"], [route("POST", "content", "/files/download-url", "job_input")])]),
  "cai.data.06.upload": action("cai.data.06.upload", "data", "upload", [job("upload", "file_write", ["files.import", "files.write"], [route("POST", "content", "/files/presign-upload", "job_input"), route("POST", "content", "/files/{file_id}/finalize", "job_input")], false, "comvenio_private", "reversible_write")]),
  "cai.data.07.delete": action("cai.data.07.delete", "data", "delete", [fileWrite("soft_delete", "DELETE", "/files/{file_id}"), fileWrite("hard_delete", "DELETE", "/files/{file_id}?hard=true", true)]),
  "cai.data.08.restore": action("cai.data.08.restore", "data", "restore", [fileWrite("restore", "POST", "/files/{file_id}/restore")]),
  "cai.data.09.move": action("cai.data.09.move", "data", "move", [fileWrite("move", "POST", "/files/{file_id}/move")]),
  "cai.data.10.visibility": action("cai.data.10.visibility", "data", "visibility", [fileWrite("private", "PATCH", "/files/{file_id}/visibility"), operation({ name: "public", profile: "file_write", scopes: ["files.write"], risk: "critical_write", routes: [route("PATCH", "content", "/files/{file_id}/visibility")], external: "comvenio_public" })]),
  "cai.data.11.stats": action("cai.data.11.stats", "data", "stats", [fileRead("stats", "/files/storage-stats")]),
  "cai.data.12.empty_trash": action("cai.data.12.empty_trash", "data", "empty-trash", [fileWrite("empty", "POST", "/files/empty-trash", true)]),
  "cai.data.13.area_media": action("cai.data.13.area_media", "data", "area-media", [fileRead("list", "/files/areas/media-map")]),
  "cai.data.14.area_shares": action("cai.data.14.area_shares", "data", "area-shares", [fileRead("list", "/files/{file_id}/area-shares")]),
  "cai.data.15.area_share_add": action("cai.data.15.area_share_add", "data", "area-share-add", [fileWrite("add", "POST", "/files/{file_id}/area-shares")]),
  "cai.data.16.area_share_remove": action("cai.data.16.area_share_remove", "data", "area-share-remove", [fileWrite("remove", "DELETE", "/files/{file_id}/area-shares/{area_id}", true)]),
  "cai.data.17.children": action("cai.data.17.children", "data", "children", [fileRead("list", "/folders/children")]),
  "cai.data.18.search": action("cai.data.18.search", "data", "search", [fileRead("search", "/folders/search")]),
  "cai.data.19.breadcrumb": action("cai.data.19.breadcrumb", "data", "breadcrumb", [fileRead("show", "/folders/{folder_id}/breadcrumb")]),
  "cai.data.20.folder_create": action("cai.data.20.folder_create", "data", "folder-create", [fileWrite("create", "POST", "/folders")]),
  "cai.data.21.folder_rename": action("cai.data.21.folder_rename", "data", "folder-rename", [fileWrite("rename", "PATCH", "/folders/{folder_id}/rename")]),
  "cai.data.22.folder_move": action("cai.data.22.folder_move", "data", "folder-move", [fileWrite("move", "PATCH", "/folders/{folder_id}/move")]),
  "cai.data.23.folder_protect": action("cai.data.23.folder_protect", "data", "folder-protect", [rightWrite("protect", "PATCH", "/folders/{folder_id}/protect")]),
  "cai.data.24.folder_delete": action("cai.data.24.folder_delete", "data", "folder-delete", [fileWrite("delete", "DELETE", "/folders/{folder_id}", true)]),
  "cai.data.25.folder_restore": action("cai.data.25.folder_restore", "data", "folder-restore", [fileWrite("restore", "POST", "/folders/{folder_id}/restore")]),
  "cai.data.26.folder_rights": action("cai.data.26.folder_rights", "data", "folder-rights", [read("list", "file_rights", ["files.read"], "content", "/folder-rights/by-folder/{folder_id}")]),
  "cai.data.27.folder_right_add": action("cai.data.27.folder_right_add", "data", "folder-right-add", [rightWrite("add", "POST", "/folder-rights")]),
  "cai.data.28.folder_right_bulk": action("cai.data.28.folder_right_bulk", "data", "folder-right-bulk", [job("bulk", "file_rights", ["files.write"], [route("POST", "content", "/folder-rights/bulk", "job_input")], true)]),
  "cai.data.29.folder_right_delete": action("cai.data.29.folder_right_delete", "data", "folder-right-delete", [rightWrite("delete", "DELETE", "/folder-rights/{right_id}", true)]),
  "cai.data.30.papers": action("cai.data.30.papers", "data", "papers", [read("list", "news_manage", ["content.read"], "content", "/papers/club/{club_id}")]),
  "cai.data.31.paper_show": action("cai.data.31.paper_show", "data", "paper-show", [read("show", "news_manage", ["content.read"], "content", "/papers/{paper_id}")]),
  "cai.data.32.paper_add": action("cai.data.32.paper_add", "data", "paper-add", [newsWrite("create", "POST", "/papers/club/{club_id}")]),
  "cai.data.33.paper_update": action("cai.data.33.paper_update", "data", "paper-update", [newsWrite("update", "PUT", "/papers/{paper_id}")]),
  "cai.data.34.paper_delete": action("cai.data.34.paper_delete", "data", "paper-delete", [newsWrite("delete", "DELETE", "/papers/{paper_id}", true)]),
  "cai.data.35.export_members_bookings": action("cai.data.35.export_members_bookings", "data", "export members|bookings", [job("members", "member_export", ["member.read.details", "files.export"], [route("GET", "member", "/members/export/{club_id}", "job_input")], true), job("bookings", "booking_export", ["booking.read", "files.export"], [route("GET", "object", "/object-reservations/export/{club_id}", "job_input")], true)]),

  "cai.news.01.list": action("cai.news.01.list", "news", "list", [read("private", "news_read", ["content.read"], "content", "/news/club/{club_id}"), read("public", "authenticated", ["public.read"], "content", "/news/club/public/{club_id}")]),
  "cai.news.02.show": action("cai.news.02.show", "news", "show", [read("private", "news_read", ["content.read"], "content", "/news/{news_id}"), read("public", "authenticated", ["public.read"], "content", "/news/{news_id}")]),
  "cai.news.03.create": action("cai.news.03.create", "news", "create", [newsWrite("draft", "POST", "/news/club/{club_id}"), operation({ name: "publish", profile: "news_manage", scopes: ["content.write"], risk: "critical_write", routes: [route("POST", "content", "/news/club/{club_id}")], external: "comvenio_public" })]),
  "cai.news.04.update": action("cai.news.04.update", "news", "update", [operation({ name: "update", profile: "news_manage", scopes: ["content.write"], risk: "critical_write", routes: [route("GET", "content", "/news/{news_id}", "preflight"), route("PUT", "content", "/news/{news_id}")], external: "comvenio_public" })]),
  "cai.news.05.delete": action("cai.news.05.delete", "news", "delete", [newsWrite("delete", "DELETE", "/news/{news_id}", true)]),
  "cai.news.06.apply": action("cai.news.06.apply", "news", "apply", [newsWrite("draft", "POST", "/news/club/{club_id}"), operation({ name: "publish", profile: "news_manage", scopes: ["content.write"], risk: "critical_write", routes: [route("POST", "content", "/news/club/{club_id}")], external: "comvenio_public" })]),
  "cai.news.07.preview": action("cai.news.07.preview", "news", "preview", [operation({ name: "preview", profile: "news_manage", scopes: ["content.write"], risk: "read", routes: [route("POST", "content", "/files/download-url", "preflight"), route("POST", "content", "/news/club/{club_id}/preview", "read")] })]),
  "cai.news.08.publish": action("cai.news.08.publish", "news", "publish", [operation({ name: "publish", profile: "news_manage", scopes: ["content.write"], risk: "critical_write", routes: [route("GET", "content", "/news/{news_id}", "preflight"), route("PUT", "content", "/news/{news_id}")], external: "comvenio_public" })]),
  "cai.news.09.video_slideshow_result_teaser": action("cai.news.09.video_slideshow_result_teaser", "news", "video slideshow|result|teaser", [job("render", "news_manage", ["content.read", "files.export"], [route("POST", "connector", "/jobs/news-video", "job_input")]), job("render_and_upload", "news_manage", ["content.write", "files.import", "files.export"], [route("POST", "connector", "/jobs/news-video", "job_input"), route("POST", "content", "/files/presign-upload", "job_input")], false, "comvenio_private", "reversible_write")]),
});

export function validateK12Definitions(): void {
  if (Object.keys(K12_ACTION_DEFINITIONS).length !== K12_ACTION_IDS.length) throw new Error("K12-Aktionsinventar und Definitionen sind nicht deckungsgleich.");
  for (const id of K12_ACTION_IDS) {
    const definition = K12_ACTION_DEFINITIONS[id];
    if (!definition || Object.keys(definition.operations).length === 0) throw new Error(`${id}: Operationen fehlen.`);
    for (const [name, branch] of Object.entries(definition.operations)) {
      if (name !== branch.operation || branch.backend_routes.length === 0) throw new Error(`${id}:${name}: ungültige Branch-Definition.`);
      if (branch.risk_class === "critical_write" && !["confirmation", "confirmed_job"].includes(branch.execution_gate)) throw new Error(`${id}:${name}: kritische Aktion ohne Bestätigung.`);
      if (branch.risk_class === "read" && !["inline", "job"].includes(branch.execution_gate)) throw new Error(`${id}:${name}: Read mit ungültigem Gate.`);
    }
  }
}
