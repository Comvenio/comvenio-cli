import type { JsonValue } from "@comvenio/connector-contracts";

type JsonObject = { [key: string]: JsonValue };
const forbidden = /(?:^|_)(?:authorization|token|secret|password|credential|hash|created_by|updated_by|deleted_by|audit|internal|object_key|etag|upload_url|presigned_url|log)(?:$|_)/iu;
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }

export function redactContentValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactContentValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.test(key)).map(([key, entry]) => [key, redactContentValue(entry)]));
}
export function boundedContentList(value: JsonValue, limit: number, mapper: (entry: JsonValue) => JsonValue = redactContentValue): JsonValue {
  const list = Array.isArray(value) ? value : [];
  return { items: list.slice(0, limit).map(mapper), returned: Math.min(list.length, limit), truncated: list.length > limit };
}
export function minimizeFile(value: JsonValue): JsonValue {
  const source = record(redactContentValue(value));
  return Object.fromEntries([
    ["file_id", source.id], ["filename", source.filename], ["content_type", source.content_type], ["size_bytes", source.size_bytes], ["status", source.status], ["visibility", source.visibility], ["context_type", source.context_type], ["context_id", source.context_id], ["sub_context_id", source.sub_context_id], ["context_label", source.context_label], ["folder_id", source.folder_id], ["is_active", source.is_active], ["uploaded_at", source.uploaded_at], ["deleted_at", source.deleted_at],
  ].filter((entry): entry is [string, JsonValue] => entry[1] !== undefined));
}
export function minimizeNews(value: JsonValue, includeContent = true): JsonValue {
  const source = record(redactContentValue(value));
  const category = record(source.category ?? {});
  return Object.fromEntries([
    ["news_id", source.id], ["title", source.title], ...(includeContent ? [["content", source.content] as [string, JsonValue]] : []), ["teaser", source.teaser], ["cover_image_file_id", source.cover_image_file_id], ["category", category.name ?? null], ["department_id", source.club_department_id], ["visibility_scope", source.visibility_scope], ["published_at", source.published_at], ["is_pinned", source.is_pinned], ["is_draft", source.is_draft], ["reference_type", source.reference_type], ["reference_id", source.reference_id], ["reference_url", source.reference_url], ["reference_label", source.reference_label], ["design_source", source.design_source], ["author_name", source.author_name],
  ].filter((entry): entry is [string, JsonValue] => entry[1] !== undefined));
}
export function minimizePaper(value: JsonValue): JsonValue {
  const source = record(redactContentValue(value));
  return Object.fromEntries([["paper_id", source.id], ["title", source.title], ["description", source.description], ["document_type", source.document_type], ["context_type", source.context_type], ["context_id", source.context_id], ["file_id", source.file_id], ["published_at", source.published_at]].filter((entry): entry is [string, JsonValue] => entry[1] !== undefined));
}
