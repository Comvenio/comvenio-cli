import type { AtomicSafetyStore, DirectReservationResult, DispatchReservationResult, IdempotencyRecord, StoredPreviewEnvelope, WriteReceipt } from "./types.ts";

export const PREVIEW_TTL_SECONDS = 300;
export const CONFIRMATION_TTL_SECONDS = 300;
export const IDEMPOTENCY_TTL_SECONDS = 86_400;
export const previewRedisKey = (previewId: string): string => `mcp:preview:${previewId}`;
export const confirmationRedisKey = (tokenHash: string): string => `mcp:confirm:${tokenHash}`;
export const idempotencyRedisKey = (subjectId: string, clubId: string, toolName: string, key: string): string => `mcp:idem:${subjectId}:${clubId}:${toolName}:${key}`;

interface StoredEnvelope extends StoredPreviewEnvelope { preview_key: string; confirmation_key: string; }
function clone<T>(value: T): T { return structuredClone(value); }

/** Deterministic reference store for contract/integration tests. Production adapters must implement the same operations atomically, e.g. with Redis Lua. */
export class MemoryAtomicSafetyStore implements AtomicSafetyStore {
  readonly #previews = new Map<string, StoredEnvelope>();
  readonly #confirmations = new Map<string, StoredEnvelope>();
  readonly #idempotency = new Map<string, IdempotencyRecord>();

  async createPreview(envelope: StoredPreviewEnvelope): Promise<void> {
    const previewKey = previewRedisKey(envelope.preview.preview_id); const confirmationKey = confirmationRedisKey(envelope.confirmation.token_hash_sha256);
    if (this.#previews.has(previewKey) || this.#confirmations.has(confirmationKey)) throw new Error("Safety-Preview oder Bestätigung existiert bereits.");
    const stored = clone({ ...envelope, preview_key: previewKey, confirmation_key: confirmationKey }); this.#previews.set(previewKey, stored); this.#confirmations.set(confirmationKey, stored);
  }

  async consumeConfirmationAndReserve(input: Parameters<AtomicSafetyStore["consumeConfirmationAndReserve"]>[0]): Promise<DispatchReservationResult> {
    const now = Date.parse(input.now); const envelope = this.#confirmations.get(confirmationRedisKey(input.token_hash_sha256));
    if (!envelope || envelope.preview.preview_id !== input.preview_id || envelope.confirmation.preview_id !== input.preview_id || envelope.preview.subject_id !== input.subject_id || envelope.preview.club_id !== input.club_id || envelope.preview.tool_name !== input.tool_name || envelope.preview.capability_version !== input.capability_version) return { kind: "confirmation_mismatch" };
    const idemKey = idempotencyRedisKey(input.subject_id, input.club_id, input.tool_name, input.idempotency_key); let existing = this.#idempotency.get(idemKey);
    if (existing && Date.parse(existing.expires_at) <= now) { this.#idempotency.delete(idemKey); existing = undefined; }
    if (existing) {
      if (existing.payload_hash_sha256 !== envelope.preview.payload_hash_sha256) return { kind: "idempotency_mismatch" };
      if (existing.receipt && (existing.state === "succeeded" || existing.state === "failed")) return { kind: "replay", receipt: clone(existing.receipt) };
      return { kind: "in_progress" };
    }
    if (Date.parse(envelope.preview.expires_at) <= now || Date.parse(envelope.confirmation.expires_at) <= now) { envelope.preview.status = "expired"; return { kind: "confirmation_expired" }; }
    if (envelope.preview.status !== "open" || envelope.confirmation.consumed_at !== null) return { kind: "confirmation_mismatch" };
    if (envelope.object_version !== input.current_object_version) { envelope.preview.status = "cancelled"; envelope.confirmation.consumed_at = input.now; return { kind: "stale" }; }
    envelope.preview.status = "consumed"; envelope.confirmation.consumed_at = input.now;
    const idempotency: IdempotencyRecord = { subject_id: input.subject_id, club_id: input.club_id, tool_name: input.tool_name, idempotency_key: input.idempotency_key, payload_hash_sha256: envelope.preview.payload_hash_sha256, state: "started", receipt: null, created_at: input.now, expires_at: input.idempotency_expires_at };
    this.#idempotency.set(idemKey, clone(idempotency)); return { kind: "dispatch", preview: clone(envelope.preview), idempotency: clone(idempotency) };
  }

  async reserveDirect(input: Parameters<AtomicSafetyStore["reserveDirect"]>[0]): Promise<DirectReservationResult> {
    const key = idempotencyRedisKey(input.subject_id, input.club_id, input.tool_name, input.idempotency_key); const now = Date.parse(input.now); let existing = this.#idempotency.get(key);
    if (existing && Date.parse(existing.expires_at) <= now) { this.#idempotency.delete(key); existing = undefined; }
    if (existing) { if (existing.payload_hash_sha256 !== input.payload_hash_sha256) return { kind: "idempotency_mismatch" }; if (existing.receipt && (existing.state === "succeeded" || existing.state === "failed")) return { kind: "replay", receipt: clone(existing.receipt) }; return { kind: "in_progress" }; }
    const idempotency: IdempotencyRecord = { subject_id: input.subject_id, club_id: input.club_id, tool_name: input.tool_name, idempotency_key: input.idempotency_key, payload_hash_sha256: input.payload_hash_sha256, state: "started", receipt: null, created_at: input.now, expires_at: input.expires_at };
    this.#idempotency.set(key, clone(idempotency)); return { kind: "dispatch", idempotency: clone(idempotency) };
  }

  async completeIdempotency(input: Parameters<AtomicSafetyStore["completeIdempotency"]>[0]): Promise<void> {
    const key = idempotencyRedisKey(input.subject_id, input.club_id, input.tool_name, input.idempotency_key); const existing = this.#idempotency.get(key);
    if (!existing || existing.state !== "started") throw new Error("Idempotenz-Reservation fehlt oder wurde bereits abgeschlossen.");
    existing.state = input.state; existing.receipt = clone(input.receipt);
  }
}
