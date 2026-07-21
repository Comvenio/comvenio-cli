import type { JsonValue } from "@comvenio/connector-contracts";
import { MARKETING_ASSET_SCHEMA } from "./schemas.ts";

type JsonObject = { [key: string]: JsonValue };
function record(value: JsonValue): JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}; }
const forbidden = /(?:^|_)(?:authorization|token|secret|password|credential|hash|created_by|updated_by|deleted_by|audit|internal|object_key|etag|upload_url|presigned_url|verification_note|log)(?:$|_)/iu;
export function redactSponsorValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactSponsorValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.test(key)).map(([key, entry]) => [key, redactSponsorValue(entry)]));
}
function select(value: JsonValue, fields: readonly [string, string][]): JsonValue {
  const source = record(redactSponsorValue(value));
  return Object.fromEntries(fields.map(([target, origin]) => [target, source[origin]]).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined));
}
export function boundedSponsorList(value: JsonValue, limit: number, mapper: (entry: JsonValue) => JsonValue): JsonValue {
  const rows = Array.isArray(value) ? value : [];
  return { items: rows.slice(0, limit).map(mapper), returned: Math.min(rows.length, limit), truncated: rows.length > limit };
}
export function minimizeSponsor(value: JsonValue): JsonValue { return select(value, [["sponsor_id", "id"], ["company_name", "company_name"], ["website_url", "website_url"], ["contact_email", "contact_email"], ["contact_person", "contact_person"], ["contact_phone", "contact_phone"], ["address", "address"], ["organization_type", "organization_type"], ["department_id", "club_department_id"], ["logo_file_id", "logo_file_id"], ["is_verified", "is_verified"]]); }
export function minimizeProduct(value: JsonValue): JsonValue { return select(value, [["product_id", "id"], ["name", "name"], ["description", "description"], ["conditions", "conditions"], ["department_id", "club_department_id"], ["contract_template_file_id", "contract_template_file_id"], ["default_unit_price_cents", "default_unit_price_cents"], ["currency", "currency"], ["billing_interval", "billing_interval"], ["default_duration_months", "default_duration_months"], ["is_active", "is_active"], ["sort_order", "sort_order"], ["contract_versions_count", "contract_versions_count"]]); }
export function minimizeContract(value: JsonValue): JsonValue { return select(value, [["contract_version_id", "id"], ["product_id", "sponsorship_product_id"], ["department_id", "club_department_id"], ["label", "label"], ["conditions", "conditions"], ["unit_price_cents", "unit_price_cents"], ["currency", "currency"], ["billing_interval", "billing_interval"], ["duration_months", "duration_months"], ["contract_file_id", "contract_file_id"], ["valid_from", "valid_from"], ["valid_until", "valid_until"], ["supersedes_version_id", "supersedes_version_id"], ["status", "status"]]); }
export function minimizeAssignment(value: JsonValue): JsonValue { return select(value, [["assignment_id", "id"], ["sponsor_id", "advertiser_id"], ["product_id", "sponsorship_product_id"], ["product_name", "product_name"], ["department_id", "club_department_id"], ["quantity", "quantity"], ["effective_unit_price_cents", "effective_unit_price_cents"], ["effective_total_price_cents", "effective_total_price_cents"], ["currency", "currency"], ["status", "status"], ["starts_at", "starts_at"], ["ends_at", "ends_at"], ["cancelled_at", "cancelled_at"]]); }
export function minimizeResponsible(value: JsonValue): JsonValue { return select(value, [["responsible_id", "id"], ["sponsor_id", "advertiser_id"], ["member_id", "member_id"], ["department_id", "club_department_id"], ["role", "role"], ["is_primary", "is_primary"]]); }
export function minimizeDocument(value: JsonValue): JsonValue { return select(value, [["file_id", "id"], ["filename", "filename"], ["content_type", "content_type"], ["size_bytes", "size_bytes"], ["context_label", "context_label"], ["uploaded_at", "uploaded_at"]]); }

export class SponsorVisibilityPolicy {
  toPublic(value: JsonValue): JsonValue {
    const source = record(redactSponsorValue(value));
    return { advertiser_id: source.id ?? source.advertiser_id ?? null, display_name: source.company_name ?? source.display_name ?? "", logo_url: source.logo_url ?? null, target_url: source.website_url ?? source.target_url ?? null, label: source.organization_type ?? source.label ?? null };
  }
  toInternal(value: JsonValue): JsonValue { return minimizeSponsor(value); }
}

export class MarketingAssetContract {
  parse(value: unknown): { source_file_id: string; filename: string; content_type: string; expected_size: number } { return MARKETING_ASSET_SCHEMA.parse(value); }
}
