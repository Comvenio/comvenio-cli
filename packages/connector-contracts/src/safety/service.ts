import { randomBytes, randomUUID } from "node:crypto";
import { createConnectorError, normalizeRequestContext, type JsonValue, type RequestContext, type UUID } from "../index.ts";
import { assertSafeNormalizedInput, safetyPayloadHash, sha256 } from "./canonical.ts";
import { ActionRiskClassifier } from "./risk-classifier.ts";
import { ACTION_CONFIRM_INPUT_SCHEMA, ACTION_IMPACT_SCHEMA, ACTION_PREVIEW_VIEW_SCHEMA, ACTION_TARGET_SCHEMA, CONFIRMATION_CHALLENGE_SCHEMA, INTERNAL_ACTION_PREVIEW_RECORD_SCHEMA, SAFE_WRITE_EFFECT_SCHEMA, WRITE_RECEIPT_SCHEMA } from "./schemas.ts";
import { CONFIRMATION_TTL_SECONDS, IDEMPOTENCY_TTL_SECONDS, PREVIEW_TTL_SECONDS } from "./store.ts";
import type { ActionPreviewView, AtomicSafetyStore, ConfirmationChallenge, ConfirmCriticalWriteRequest, CreateCriticalPreviewRequest, ExecuteReversibleWriteRequest, InternalActionPreviewRecord, SafeWriteEffect, SafetyAuthorizationPort, SafetyClock, SafetyRandom, WriteReceipt } from "./types.ts";

const SYSTEM_CLOCK: SafetyClock = { now: () => new Date() };
const SYSTEM_RANDOM: SafetyRandom = { uuid: () => randomUUID(), tokenBytes: (length) => randomBytes(length) };
function isoAfter(now: Date, seconds: number): string { return new Date(now.getTime() + seconds * 1_000).toISOString(); }
function error(context: RequestContext, code: Parameters<typeof createConnectorError>[0]["code"], message: string): Error { return createConnectorError({ code, message, request_id: context.request_id, retryable: false }); }
function bound(context: RequestContext): { context: RequestContext; subject_id: UUID; club_id: UUID } { const normalized = normalizeRequestContext(context); if (!normalized.subject_id) throw error(normalized, "AUTH_REQUIRED", "Für eine Schreibaktion ist eine authentifizierte Person erforderlich."); if (!normalized.club_id) throw error(normalized, "CLUB_SELECTION_REQUIRED", "Für eine Schreibaktion muss genau ein Verein gewählt sein."); return { context: normalized, subject_id: normalized.subject_id, club_id: normalized.club_id }; }
function safeStrings(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort().slice(0, 100); }
function receiptOutcome(effect: SafeWriteEffect): WriteReceipt["outcome"] { if (effect.failed_count === 0) return "succeeded"; return effect.changed_count > 0 ? "partially_succeeded" : "failed"; }

export class WriteSafetyService {
  readonly #store: AtomicSafetyStore; readonly #authorization: SafetyAuthorizationPort; readonly #clock: SafetyClock; readonly #random: SafetyRandom; readonly #classifier = new ActionRiskClassifier();
  constructor(input: { store: AtomicSafetyStore; authorization: SafetyAuthorizationPort; clock?: SafetyClock; random?: SafetyRandom }) { this.#store = input.store; this.#authorization = input.authorization; this.#clock = input.clock ?? SYSTEM_CLOCK; this.#random = input.random ?? SYSTEM_RANDOM; }

  async createCriticalPreview(request: CreateCriticalPreviewRequest): Promise<ConfirmationChallenge> {
    const { context, subject_id, club_id } = bound(request.context); if (!this.#classifier.requiresConfirmation(request.operation)) throw error(context, "VALIDATION_FAILED", "Nur kritische Katalogaktionen dürfen einen Bestätigungsflow eröffnen.");
    assertSafeNormalizedInput(request.normalized_input); const target = ACTION_TARGET_SCHEMA.parse(request.target); const impact = ACTION_IMPACT_SCHEMA.parse(request.impact); const authorization = await this.#authorization.reauthorize({ context, tool_name: request.operation.tool_name, risk_class: "critical_write" }); if (!authorization.capability_version) throw error(context, "PERMISSION_DENIED", "Der aktuelle Berechtigungsnachweis fehlt.");
    const now = this.#clock.now(); const createdAt = now.toISOString(); const expiresAt = isoAfter(now, PREVIEW_TTL_SECONDS); const previewId = this.#random.uuid(); const rawToken = Buffer.from(this.#random.tokenBytes(32)).toString("base64url"); const tokenHash = sha256(rawToken);
    const payloadHash = safetyPayloadHash({ subject_id, club_id, tool_name: request.operation.tool_name, capability_version: authorization.capability_version, normalized_input: request.normalized_input });
    const internal: InternalActionPreviewRecord = INTERNAL_ACTION_PREVIEW_RECORD_SCHEMA.parse({ preview_id: previewId, request_id: context.request_id, subject_id, club_id, tool_name: request.operation.tool_name, risk_class: "critical_write", normalized_input: request.normalized_input, payload_hash_sha256: payloadHash, target, impact, masked_fields: safeStrings(request.masked_fields), capability_version: authorization.capability_version, created_at: createdAt, expires_at: expiresAt, status: "open" });
    const view: ActionPreviewView = ACTION_PREVIEW_VIEW_SCHEMA.parse({ preview_id: previewId, request_id: context.request_id, club_id, tool_name: request.operation.tool_name, risk_class: "critical_write", target, impact, safe_summary: request.safe_summary, masked_fields: internal.masked_fields, expires_at: expiresAt });
    await this.#store.createPreview({ preview: internal, confirmation: { token_hash_sha256: tokenHash, preview_id: previewId, subject_id, club_id, tool_name: request.operation.tool_name, payload_hash_sha256: payloadHash, capability_version: authorization.capability_version, expires_at: isoAfter(now, CONFIRMATION_TTL_SECONDS), consumed_at: null }, object_version: request.object_version });
    return CONFIRMATION_CHALLENGE_SCHEMA.parse({ preview: view, confirmation_token: rawToken, confirm_label: "Bestätigen", cancel_label: "Abbrechen", acknowledgement_required: true });
  }

  async confirmCriticalWrite(request: ConfirmCriticalWriteRequest, mutation: (normalizedInput: JsonValue, idempotencyKey: UUID) => Promise<SafeWriteEffect>): Promise<WriteReceipt> {
    const parsed = ACTION_CONFIRM_INPUT_SCHEMA.parse({ preview_id: request.preview_id, confirmation_token: request.confirmation_token, idempotency_key: request.idempotency_key }); const { context, subject_id, club_id } = bound(request.context); const authorization = await this.#authorization.reauthorize({ context, tool_name: request.tool_name, risk_class: "critical_write" }); const now = this.#clock.now();
    const reservation = await this.#store.consumeConfirmationAndReserve({ now: now.toISOString(), token_hash_sha256: sha256(parsed.confirmation_token), preview_id: parsed.preview_id, subject_id, club_id, tool_name: request.tool_name, capability_version: authorization.capability_version, current_object_version: request.current_object_version, idempotency_key: parsed.idempotency_key, idempotency_expires_at: isoAfter(now, IDEMPOTENCY_TTL_SECONDS) });
    if (reservation.kind === "replay") return reservation.receipt;
    if (reservation.kind === "confirmation_expired") throw error(context, "CONFIRMATION_EXPIRED", "Die Vorschau ist abgelaufen. Bitte erstelle eine neue Vorschau.");
    if (reservation.kind === "stale") throw error(context, "CONFLICT", "Das Zielobjekt hat sich seit der Vorschau geändert. Bitte prüfe eine neue Vorschau.");
    if (reservation.kind === "idempotency_mismatch") throw error(context, "CONFLICT", "Der Idempotenzschlüssel gehört zu einer anderen Wirkung.");
    if (reservation.kind === "in_progress") throw error(context, "CONFLICT", "Eine identische Schreibaktion wird bereits verarbeitet.");
    if (reservation.kind === "confirmation_mismatch") throw error(context, "CONFIRMATION_MISMATCH", "Die Bestätigung passt nicht zu Person, Verein, Tool oder Berechtigungsstand.");
    return this.#dispatch({ context, subject_id, club_id, tool_name: request.tool_name, idempotency_key: parsed.idempotency_key, normalized_input: reservation.preview.normalized_input }, mutation);
  }

  async executeReversibleWrite(request: ExecuteReversibleWriteRequest, mutation: (normalizedInput: JsonValue, idempotencyKey: UUID) => Promise<SafeWriteEffect>): Promise<WriteReceipt> {
    const { context, subject_id, club_id } = bound(request.context); if (this.#classifier.classify(request.operation) !== "reversible_write") throw error(context, "VALIDATION_FAILED", "Der direkte Write-Flow ist nur für reversible Katalogaktionen erlaubt."); assertSafeNormalizedInput(request.normalized_input);
    const authorization = await this.#authorization.reauthorize({ context, tool_name: request.operation.tool_name, risk_class: "reversible_write" }); const payloadHash = safetyPayloadHash({ subject_id, club_id, tool_name: request.operation.tool_name, capability_version: authorization.capability_version, normalized_input: request.normalized_input }); const now = this.#clock.now();
    const reservation = await this.#store.reserveDirect({ now: now.toISOString(), subject_id, club_id, tool_name: request.operation.tool_name, idempotency_key: request.idempotency_key, payload_hash_sha256: payloadHash, expires_at: isoAfter(now, IDEMPOTENCY_TTL_SECONDS) });
    if (reservation.kind === "replay") return reservation.receipt; if (reservation.kind === "idempotency_mismatch") throw error(context, "CONFLICT", "Der Idempotenzschlüssel gehört zu einer anderen Wirkung."); if (reservation.kind === "in_progress") throw error(context, "CONFLICT", "Eine identische Schreibaktion wird bereits verarbeitet.");
    return this.#dispatch({ context, subject_id, club_id, tool_name: request.operation.tool_name, idempotency_key: request.idempotency_key, normalized_input: request.normalized_input }, mutation);
  }

  async #dispatch(input: { context: RequestContext; subject_id: UUID; club_id: UUID; tool_name: string; idempotency_key: UUID; normalized_input: JsonValue }, mutation: (normalizedInput: JsonValue, idempotencyKey: UUID) => Promise<SafeWriteEffect>): Promise<WriteReceipt> {
    let effect: SafeWriteEffect; let state: "succeeded" | "failed" = "succeeded";
    try { effect = SAFE_WRITE_EFFECT_SCHEMA.parse(await mutation(structuredClone(input.normalized_input), input.idempotency_key)); }
    catch { state = "failed"; effect = { target_ids: [], changed_count: 0, unchanged_count: 0, failed_count: 1, result_summary: "Die Fachaktion konnte nicht abgeschlossen werden.", object_versions: [], safe_next_actions: [] }; }
    const receipt = WRITE_RECEIPT_SCHEMA.parse({ receipt_id: this.#random.uuid(), request_id: input.context.request_id, subject_id: input.subject_id, club_id: input.club_id, tool_name: input.tool_name, target_ids: [...new Set(effect.target_ids)].sort(), outcome: state === "failed" ? "failed" : receiptOutcome(effect), changed_count: effect.changed_count, unchanged_count: effect.unchanged_count, failed_count: effect.failed_count, result_summary: effect.result_summary, object_versions: [...effect.object_versions].sort((a, b) => a.target_id.localeCompare(b.target_id)), safe_next_actions: effect.safe_next_actions, idempotency_key: input.idempotency_key, completed_at: this.#clock.now().toISOString() });
    await this.#store.completeIdempotency({ subject_id: input.subject_id, club_id: input.club_id, tool_name: input.tool_name, idempotency_key: input.idempotency_key, state: receipt.outcome === "failed" ? "failed" : state, receipt }); return receipt;
  }
}
