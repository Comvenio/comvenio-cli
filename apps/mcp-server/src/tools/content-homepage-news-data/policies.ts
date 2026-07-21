import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createConnectorError, type JsonValue } from "@comvenio/connector-contracts";

import type { K12ConfirmationPort, K12MutationRequest } from "./types.ts";

interface Pending { actor: string; club: string; digest: string; tokenHash: string; expiresAt: number; used: boolean; }
function canonical(value: JsonValue): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`; return JSON.stringify(value); }
function digest(value: JsonValue): string { const safe = value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "confirmation")) : value; return createHash("sha256").update(canonical(safe)).digest("hex"); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export class ContentChangeConfirmationPolicy implements K12ConfirmationPort {
  readonly #pending = new Map<string, Pending>();
  readonly #ttlMs: number;
  constructor(ttlMs = 10 * 60 * 1_000) { this.#ttlMs = ttlMs; }
  async confirmOrPreview(request: { mutation: K12MutationRequest; subject: string; summary: string; effects: JsonValue[]; confirmation: { preview_id: string; confirmation_token: string } | null }, mutation: () => Promise<JsonValue>): Promise<JsonValue> {
    const actor = request.mutation.context.subject_id;
    const club = request.mutation.context.club_id;
    if (!actor || !club) throw createConnectorError({ code: "PERMISSION_DENIED", message: "Für die Bestätigung fehlt ein gebundener Akteur oder Verein.", request_id: request.mutation.context.request_id, retryable: false });
    const payloadDigest = digest(request.mutation.input);
    if (!request.confirmation) {
      const previewId = randomUUID(); const token = randomBytes(32).toString("base64url"); const expiresAt = Date.now() + this.#ttlMs;
      this.#pending.set(previewId, { actor, club, digest: payloadDigest, tokenHash: hash(token), expiresAt, used: false });
      return { confirmation_required: true, preview: { preview_id: previewId, confirmation_token: token, action_id: request.mutation.definition.action_id, operation: request.mutation.operation.operation, subject: request.subject, summary: request.summary, effects: request.effects, expires_at: new Date(expiresAt).toISOString() } };
    }
    const pending = this.#pending.get(request.confirmation.preview_id);
    const supplied = Buffer.from(hash(request.confirmation.confirmation_token));
    const expected = Buffer.from(pending?.tokenHash ?? "0".repeat(64));
    const valid = Boolean(pending && !pending.used && pending.expiresAt > Date.now() && pending.actor === actor && pending.club === club && pending.digest === payloadDigest && supplied.length === expected.length && timingSafeEqual(supplied, expected));
    if (!valid || !pending) throw createConnectorError({ code: "CONFIRMATION_MISMATCH", message: "Die Bestätigung ist ungültig, abgelaufen oder gehört zu einer anderen Wirkung.", request_id: request.mutation.context.request_id, retryable: false });
    pending.used = true;
    this.#pending.delete(request.confirmation.preview_id);
    return mutation();
  }
}

export class ContentJobPolicy {
  requiresJob(request: K12MutationRequest): boolean { return request.operation.execution_gate === "job" || request.operation.execution_gate === "confirmed_job"; }
}
