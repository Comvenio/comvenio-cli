import { z } from "zod";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const toolName = z.string().trim().min(1).max(200).regex(/^[a-z0-9_.:-]+$/u);
const target = z.object({ type: z.string().trim().min(1).max(100), id: uuid.nullable(), label: z.string().trim().min(1).max(300) }).strict();
const impact = z.object({ creates: z.number().int().nonnegative(), updates: z.number().int().nonnegative(), deletes: z.number().int().nonnegative(), publishes: z.number().int().nonnegative(), imports: z.number().int().nonnegative(), exports: z.number().int().nonnegative(), affected_total: z.number().int().nonnegative(), summary: z.string().trim().min(1).max(1_000) }).strict().refine((value) => value.affected_total === value.creates + value.updates + value.deletes + value.publishes + value.imports + value.exports, "affected_total muss der Summe der Wirkungen entsprechen.");
const safeNextAction = z.object({ kind: z.enum(["undo", "view", "retry_failed"]), label: z.string().trim().min(1).max(200), tool_name: toolName, available_until: instant.nullable() }).strict();

export const ACTION_TARGET_SCHEMA = target;
export const ACTION_IMPACT_SCHEMA = impact;
export const INTERNAL_ACTION_PREVIEW_RECORD_SCHEMA = z.object({
  preview_id: uuid, request_id: uuid, subject_id: uuid, club_id: uuid, tool_name: toolName, risk_class: z.literal("critical_write"), normalized_input: z.json(), payload_hash_sha256: sha256,
  target, impact, masked_fields: z.array(z.string().trim().min(1).max(200)).max(100), capability_version: z.string().trim().min(1).max(256), created_at: instant, expires_at: instant, status: z.enum(["open", "consumed", "expired", "cancelled"]),
}).strict();
export const ACTION_PREVIEW_VIEW_SCHEMA = z.object({ preview_id: uuid, request_id: uuid, club_id: uuid, tool_name: toolName, risk_class: z.literal("critical_write"), target, impact, safe_summary: z.string().trim().min(1).max(1_000), masked_fields: z.array(z.string().trim().min(1).max(200)).max(100), expires_at: instant }).strict();
export const CONFIRMATION_TOKEN_RECORD_SCHEMA = z.object({ token_hash_sha256: sha256, preview_id: uuid, subject_id: uuid, club_id: uuid, tool_name: toolName, payload_hash_sha256: sha256, capability_version: z.string().trim().min(1).max(256), expires_at: instant, consumed_at: instant.nullable() }).strict();
export const WRITE_RECEIPT_SCHEMA = z.object({ receipt_id: uuid, request_id: uuid, subject_id: uuid, club_id: uuid, tool_name: toolName, target_ids: z.array(uuid).max(10_000), outcome: z.enum(["succeeded", "partially_succeeded", "failed"]), changed_count: z.number().int().nonnegative(), unchanged_count: z.number().int().nonnegative(), failed_count: z.number().int().nonnegative(), result_summary: z.string().trim().min(1).max(1_000), object_versions: z.array(z.object({ target_id: uuid, version: z.string().trim().min(1).max(256) }).strict()).max(10_000), safe_next_actions: z.array(safeNextAction).max(20), idempotency_key: uuid, completed_at: instant }).strict();
export const IDEMPOTENCY_RECORD_SCHEMA = z.object({ subject_id: uuid, club_id: uuid, tool_name: toolName, idempotency_key: uuid, payload_hash_sha256: sha256, state: z.enum(["started", "succeeded", "failed"]), receipt: WRITE_RECEIPT_SCHEMA.nullable(), created_at: instant, expires_at: instant }).strict();
export const CONFIRMATION_CHALLENGE_SCHEMA = z.object({ preview: ACTION_PREVIEW_VIEW_SCHEMA, confirmation_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), confirm_label: z.string().trim().min(1).max(100), cancel_label: z.literal("Abbrechen"), acknowledgement_required: z.boolean() }).strict();
export const ACTION_CONFIRM_INPUT_SCHEMA = z.object({ preview_id: uuid, confirmation_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), idempotency_key: uuid }).strict();
export const ACTION_CONFIRM_WIDGET_INPUT_SCHEMA = z.object({
  preview_id: uuid,
  idempotency_key: uuid,
}).strict();
export const SAFE_WRITE_EFFECT_SCHEMA = z.object({ target_ids: z.array(uuid).max(10_000), changed_count: z.number().int().nonnegative(), unchanged_count: z.number().int().nonnegative(), failed_count: z.number().int().nonnegative(), result_summary: z.string().trim().min(1).max(1_000), object_versions: z.array(z.object({ target_id: uuid, version: z.string().trim().min(1).max(256) }).strict()).max(10_000), safe_next_actions: z.array(safeNextAction).max(20) }).strict();
