import type { ComvenioApiClient, ComvenioHttpMethod } from "@comvenio/comvenio-client";
import { createConnectorError, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";

import { PublicResponseRedactor } from "../../public/redaction.ts";
import { boundedContentList, minimizeFile, minimizeNews, minimizePaper, redactContentValue } from "./privacy.ts";
import { listK12Schemas, showK12Schema, type K12SchemaDomain } from "./schema-registry.ts";
import type { K12ActionId } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };
type Handler = (input: JsonObject, context: RequestContext, client: ComvenioApiClient) => Promise<JsonValue>;
function record(value: JsonValue): JsonObject { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Die validierte K12-Eingabe ist kein Objekt."); return value; }
function string(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string") throw new Error(`${key} fehlt.`); return value; }
function object(input: JsonObject, key: string): JsonObject { return record(input[key] ?? {}); }
function query(input: JsonObject, keys: readonly string[]): Record<string, string | string[]> { const result: Record<string, string | string[]> = {}; for (const key of keys) { const value = input[key]; if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) result[key] = value; else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") result[key] = String(value); } return result; }
function clubIds(value: JsonValue): string[] { if (value === null || typeof value !== "object") return []; if (Array.isArray(value)) return value.flatMap(clubIds); return Object.entries(value).flatMap(([key, entry]) => key === "club_id" && typeof entry === "string" ? [entry] : clubIds(entry)); }
function assertClub(value: JsonValue, input: JsonObject, context: RequestContext): JsonValue {
  const expected = string(input, "club_id");
  if (clubIds(value).some((id) => id !== expected)) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Fachservice lieferte Content eines anderen Vereins.", request_id: context.request_id, retryable: false });
  return value;
}
const handlers = new Map<string, Handler>();
const key = (actionId: K12ActionId, operation: string) => `${actionId}:${operation}`;
const add = (actionId: K12ActionId, operation: string, handler: Handler) => handlers.set(key(actionId, operation), handler);
async function request(client: ComvenioApiClient, context: RequestContext, method: ComvenioHttpMethod, service: string, path: string, options: { body?: JsonValue; query?: Record<string, string | string[]> } = {}): Promise<JsonValue> {
  return client.request<JsonValue>({ method, service, path, context, ...options });
}
function simple(actionId: K12ActionId, operation: string, method: ComvenioHttpMethod, service: string, path: (input: JsonObject) => string, options: { body?: (input: JsonObject) => JsonValue; query?: (input: JsonObject) => Record<string, string | string[]>; response?: (value: JsonValue, input: JsonObject, context: RequestContext) => JsonValue; deleted?: string } = {}): void {
  add(actionId, operation, async (input, context, client) => {
    const value = await request(client, context, method, service, path(input), { ...(options.body ? { body: options.body(input) } : {}), ...(options.query ? { query: options.query(input) } : {}) });
    if (options.deleted) return { deleted: true, id: string(input, options.deleted) };
    return options.response ? options.response(value, input, context) : redactContentValue(assertClub(value, input, context));
  });
}

add("cai.homepage.01.preview", "preview", async (input, context, client) => redactContentValue(await request(client, context, "POST", "club", `/home-config/${string(input, "club_id")}/preview`, { body: { tabs: input.tabs!, clear_existing: input.clear_existing! } })));
add("cai.homepage.02.apply", "apply", async (input, context, client) => {
  const result = record(assertClub(await request(client, context, "POST", "club", `/home-config/${string(input, "club_id")}/bulk`, { body: { tabs: input.tabs!, clear_existing: input.clear_existing! } }), input, context));
  return { applied: true, cleared: input.clear_existing === true, tabs: Array.isArray(result.tabs) ? result.tabs.length : 0, sections: typeof result.sections_created === "number" ? result.sections_created : 0, widgets: typeof result.widgets_created === "number" ? result.widgets_created : 0 };
});
simple("cai.homepage.03.show", "private", "GET", "club", (input) => `/home-config/${string(input, "club_id")}/tabs`);
add("cai.homepage.03.show", "public", async (input, context, client) => new PublicResponseRedactor().redact({ alias: "public_club_home", response: await request(client, context, "GET", "club", `/public/clubs/${string(input, "club_id")}/home`), request_id: context.request_id, expected_club_id: string(input, "club_id") }));

add("cai.schema.01.list_domains", "list", async () => listK12Schemas());
add("cai.schema.02.show_domain_schema", "show", async (input) => showK12Schema(string(input, "domain") as K12SchemaDomain));

simple("cai.data.01.list", "list", "GET", "content", (input) => `/files/by-context/${string(input, "club_id")}/${string(input, "context_type")}/${string(input, "context_id")}`, { query: (input) => query(input, ["include_deleted", "sub_context_id"]), response: (value, input, context) => boundedContentList(assertClub(value, input, context), Number(input.limit), minimizeFile) });
simple("cai.data.02.show", "show", "GET", "content", (input) => `/files/${string(input, "file_id")}`, { response: (value, input, context) => minimizeFile(assertClub(value, input, context)) });
simple("cai.data.03.update", "update", "PATCH", "content", (input) => `/files/${string(input, "file_id")}/context`, { body: (input) => object(input, "changes"), response: (value, input, context) => minimizeFile(assertClub(value, input, context)) });
add("cai.data.04.url", "reference", async (input, context, client) => {
  const result = record(await request(client, context, "POST", "content", "/files/download-url", { body: { file_id: input.file_id! } }));
  return { file_id: input.file_id!, download_available: typeof result.url === "string", expires_in: typeof result.expires_in === "number" ? result.expires_in : null };
});
for (const operation of ["soft_delete", "hard_delete"] as const) simple("cai.data.07.delete", operation, "DELETE", "content", (input) => `/files/${string(input, "file_id")}`, { query: () => operation === "hard_delete" ? { hard: "true" } : {} as Record<string, string>, deleted: "file_id" });
simple("cai.data.08.restore", "restore", "POST", "content", (input) => `/files/${string(input, "file_id")}/restore`, { body: () => ({}), response: (_value, input) => ({ restored: true, file_id: input.file_id! }) });
simple("cai.data.09.move", "move", "POST", "content", (input) => `/files/${string(input, "file_id")}/move`, { body: (input) => ({ target_folder_id: input.target_folder_id! }), response: (_value, input) => ({ moved: true, file_id: input.file_id!, folder_id: input.target_folder_id! }) });
for (const operation of ["private", "public"] as const) simple("cai.data.10.visibility", operation, "PATCH", "content", (input) => `/files/${string(input, "file_id")}/visibility`, { body: () => ({ visibility: operation }), response: (value, input, context) => minimizeFile(assertClub(value, input, context)) });
simple("cai.data.11.stats", "stats", "GET", "content", () => "/files/storage-stats", { query: (input) => ({ club_id: string(input, "club_id"), ...query(input, ["department_id"]) }), response: (value, input, context) => redactContentValue(assertClub(value, input, context)) });
simple("cai.data.12.empty_trash", "empty", "POST", "content", () => "/files/empty-trash", { body: (input) => ({ club_id: input.club_id!, club_department_id: input.department_id ?? null, folder_id: input.folder_id ?? null }) });
simple("cai.data.13.area_media", "list", "GET", "content", () => "/files/areas/media-map", { query: (input) => ({ club_id: string(input, "club_id"), area_ids: input.area_ids as string[], ...query(input, ["label"]) }) });
simple("cai.data.14.area_shares", "list", "GET", "content", (input) => `/files/${string(input, "file_id")}/area-shares`);
simple("cai.data.15.area_share_add", "add", "POST", "content", (input) => `/files/${string(input, "file_id")}/area-shares`, { body: (input) => ({ area_ids: input.area_ids! }) });
simple("cai.data.16.area_share_remove", "remove", "DELETE", "content", (input) => `/files/${string(input, "file_id")}/area-shares/${string(input, "area_id")}`, { deleted: "area_id" });
simple("cai.data.17.children", "list", "GET", "content", () => "/folders/children", { query: (input) => ({ club_id: string(input, "club_id"), ...query(input, ["department_id", "parent_id", "include_deleted"]) }), response: (value, input, context) => redactContentValue(assertClub(value, input, context)) });
simple("cai.data.18.search", "search", "GET", "content", () => "/folders/search", { query: (input) => ({ club_id: string(input, "club_id"), q: string(input, "query"), ...query(input, ["department_id", "folder_id", "recursive"]) }), response: (value, input, context) => redactContentValue(assertClub(value, input, context)) });
simple("cai.data.19.breadcrumb", "show", "GET", "content", (input) => `/folders/${string(input, "folder_id")}/breadcrumb`);
simple("cai.data.20.folder_create", "create", "POST", "content", () => "/folders", { body: (input) => ({ club_id: input.club_id!, club_department_id: input.department_id ?? null, parent_id: input.parent_id ?? null, name: input.name!, is_protected: input.is_protected! }) });
simple("cai.data.21.folder_rename", "rename", "PATCH", "content", (input) => `/folders/${string(input, "folder_id")}/rename`, { body: (input) => ({ new_name: input.new_name! }) });
simple("cai.data.22.folder_move", "move", "PATCH", "content", (input) => `/folders/${string(input, "folder_id")}/move`, { body: (input) => ({ new_parent_id: input.new_parent_id! }) });
simple("cai.data.23.folder_protect", "protect", "PATCH", "content", (input) => `/folders/${string(input, "folder_id")}/protect`, { query: (input) => ({ protect: String(input.protect) }), body: () => ({}) });
simple("cai.data.24.folder_delete", "delete", "DELETE", "content", (input) => `/folders/${string(input, "folder_id")}`, { query: (input) => ({ recursive: String(input.recursive) }), deleted: "folder_id" });
simple("cai.data.25.folder_restore", "restore", "POST", "content", (input) => `/folders/${string(input, "folder_id")}/restore`, { query: (input) => ({ recursive: String(input.recursive) }), body: () => ({}), response: (_value, input) => ({ restored: true, folder_id: input.folder_id!, recursive: input.recursive! }) });
simple("cai.data.26.folder_rights", "list", "GET", "content", (input) => `/folder-rights/by-folder/${string(input, "folder_id")}`);
simple("cai.data.27.folder_right_add", "add", "POST", "content", () => "/folder-rights", { body: (input) => object(input, "right") });
simple("cai.data.29.folder_right_delete", "delete", "DELETE", "content", (input) => `/folder-rights/${string(input, "right_id")}`, { deleted: "right_id" });
add("cai.data.30.papers", "list", async (input, context, client) => {
  const path = input.context_type && input.context_id ? `/papers/context/${string(input, "club_id")}/${string(input, "context_type")}/${string(input, "context_id")}` : `/papers/club/${string(input, "club_id")}`;
  const value = assertClub(await request(client, context, "GET", "content", path), input, context);
  const filtered = Array.isArray(value) && typeof input.document_type === "string" ? value.filter((entry) => record(entry).document_type === input.document_type) : value;
  return boundedContentList(filtered, Number(input.limit), minimizePaper);
});
simple("cai.data.31.paper_show", "show", "GET", "content", (input) => `/papers/${string(input, "paper_id")}`, { response: (value, input, context) => minimizePaper(assertClub(value, input, context)) });
simple("cai.data.32.paper_add", "create", "POST", "content", (input) => `/papers/club/${string(input, "club_id")}`, { body: (input) => object(input, "paper"), response: (value, input, context) => minimizePaper(assertClub(value, input, context)) });
simple("cai.data.33.paper_update", "update", "PUT", "content", (input) => `/papers/${string(input, "paper_id")}`, { body: (input) => object(input, "paper"), response: (value, input, context) => minimizePaper(assertClub(value, input, context)) });
simple("cai.data.34.paper_delete", "delete", "DELETE", "content", (input) => `/papers/${string(input, "paper_id")}`, { deleted: "paper_id" });

add("cai.news.01.list", "private", async (input, context, client) => boundedContentList(assertClub(await request(client, context, "GET", "content", `/news/club/${string(input, "club_id")}`), input, context), Number(input.limit), (entry) => minimizeNews(entry, false)));
add("cai.news.01.list", "public", async (input, context, client) => new PublicResponseRedactor().redact({ alias: "public_news", response: await request(client, context, "GET", "content", `/news/club/public/${string(input, "club_id")}`, { query: { limit: String(input.limit), offset: String(input.offset) } }), request_id: context.request_id, expected_club_id: string(input, "club_id") }));
simple("cai.news.02.show", "private", "GET", "content", (input) => `/news/${string(input, "news_id")}`, { response: (value, input, context) => minimizeNews(assertClub(value, input, context)) });
add("cai.news.02.show", "public", async (input, context, client) => new PublicResponseRedactor().redact({ alias: "public_news_detail", response: await request(client, context, "GET", "content", `/news/${string(input, "news_id")}`), request_id: context.request_id, expected_club_id: string(input, "club_id") }));
function newsBody(input: JsonObject, draft: boolean): JsonObject { return { ...object(input, "news"), is_draft: draft, published_at: draft ? null : new Date().toISOString() }; }
for (const actionId of ["cai.news.03.create", "cai.news.06.apply"] as const) for (const operation of ["draft", "publish"] as const) simple(actionId, operation, "POST", "content", (input) => `/news/club/${string(input, "club_id")}`, { body: (input) => newsBody(input, operation === "draft"), response: (value, input, context) => minimizeNews(assertClub(value, input, context)) });
const fullNewsKeys = ["title", "content", "teaser", "cover_image_file_id", "category_id", "club_department_id", "visibility_scope", "published_at", "is_pinned", "is_draft", "reference_id", "reference_type", "reference_url", "reference_label", "design_source"] as const;
function fullNewsBody(current: JsonObject): JsonObject { return Object.fromEntries(fullNewsKeys.map((name) => [name, current[name] ?? ({ visibility_scope: "member", is_pinned: false, is_draft: true, reference_type: "none", design_source: "cli" } as JsonObject)[name] ?? null])); }
add("cai.news.04.update", "update", async (input, context, client) => {
  const current = record(assertClub(await request(client, context, "GET", "content", `/news/${string(input, "news_id")}`), input, context));
  const result = await request(client, context, "PUT", "content", `/news/${string(input, "news_id")}`, { body: { ...fullNewsBody(current), ...object(input, "changes") } });
  return minimizeNews(assertClub(result, input, context));
});
simple("cai.news.05.delete", "delete", "DELETE", "content", (input) => `/news/${string(input, "news_id")}`, { deleted: "news_id" });
add("cai.news.07.preview", "preview", async (input, context, client) => {
  let coverUrl: JsonValue = null;
  if (typeof input.cover_file_id === "string") {
    const reference = record(await request(client, context, "POST", "content", "/files/download-url", { body: { file_id: input.cover_file_id } }));
    coverUrl = typeof reference.url === "string" ? reference.url : null;
  }
  return redactContentValue(await request(client, context, "POST", "content", `/news/club/${string(input, "club_id")}/preview`, { body: { title: input.title!, content: input.content!, teaser: input.teaser ?? null, cover_url: coverUrl, author_name: input.author_name ?? null, club_name: input.club_name ?? null, design_source: "cli" } }));
});
add("cai.news.08.publish", "publish", async (input, context, client) => {
  const current = record(assertClub(await request(client, context, "GET", "content", `/news/${string(input, "news_id")}`), input, context));
  const result = await request(client, context, "PUT", "content", `/news/${string(input, "news_id")}`, { body: { ...fullNewsBody(current), is_draft: false, published_at: current.published_at ?? new Date().toISOString() } });
  return minimizeNews(assertClub(result, input, context));
});

export function hasK12OperationHandler(actionId: K12ActionId, operation: string): boolean { return handlers.has(key(actionId, operation)); }
export async function executeK12Operation(actionId: K12ActionId, operation: string, inputValue: JsonValue, context: RequestContext, client: ComvenioApiClient): Promise<JsonValue> {
  const handler = handlers.get(key(actionId, operation)); if (!handler) throw new Error(`${actionId}:${operation}: Der typisierte Handler fehlt.`); return handler(record(inputValue), context, client);
}
