import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { JsonValue } from "@comvenio/connector-contracts";

import type { K11ConfirmationPort, K11ConfirmationPreview, K11MutationRequest } from "./types.ts";

interface StoredPreview { preview: K11ConfirmationPreview; digest: string; subject_id: string; club_id: string; used: boolean; }
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(request: K11MutationRequest): string {
  const input = request.input !== null && typeof request.input === "object" && !Array.isArray(request.input)
    ? Object.fromEntries(Object.entries(request.input).filter(([key]) => key !== "confirmation")) : request.input;
  return createHash("sha256").update(`${request.definition.action_id}\n${request.operation.operation}\n${canonical(input)}`).digest("hex");
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class SupplyChangeConfirmationPolicy implements K11ConfirmationPort {
  readonly #ttlMs: number;
  readonly #now: () => Date;
  readonly #previews = new Map<string, StoredPreview>();
  constructor(options: { ttl_ms?: number; now?: () => Date } = {}) { this.#ttlMs = options.ttl_ms ?? 5 * 60_000; this.#now = options.now ?? (() => new Date()); }
  async confirmOrPreview(request: Parameters<K11ConfirmationPort["confirmOrPreview"]>[0], mutation: () => Promise<JsonValue>): Promise<JsonValue> {
    const context = request.mutation.context;
    if (!context.subject_id || !context.club_id) throw new Error("Für die Bestätigung fehlt der Actor- oder Vereinskontext.");
    const inputDigest = digest(request.mutation);
    if (!request.confirmation) {
      const preview: K11ConfirmationPreview = {
        preview_id: randomUUID(), confirmation_token: randomBytes(32).toString("base64url"), action_id: request.mutation.definition.action_id,
        operation: request.mutation.operation.operation, subject: request.subject, summary: request.summary, effects: request.effects,
        expires_at: new Date(this.#now().getTime() + this.#ttlMs).toISOString(),
      };
      this.#previews.set(preview.preview_id, { preview, digest: inputDigest, subject_id: context.subject_id, club_id: context.club_id, used: false });
      return { confirmation_required: true, preview };
    }
    const stored = this.#previews.get(request.confirmation.preview_id);
    if (!stored || stored.used || Date.parse(stored.preview.expires_at) <= this.#now().getTime() || stored.subject_id !== context.subject_id
      || stored.club_id !== context.club_id || stored.digest !== inputDigest || !safeEqual(stored.preview.confirmation_token, request.confirmation.confirmation_token)) {
      throw new Error("Die Bestätigung ist ungültig, abgelaufen oder gehört zu einem anderen Kontext.");
    }
    stored.used = true;
    try { return await mutation(); } finally { this.#previews.delete(stored.preview.preview_id); }
  }
}

export class SupplyJobPolicy {
  readonly job_actions = new Set(["cai.shopping.06.show:export", "cai.shopping.14.generate_from_recipe:generate", "cai.shopping.15.generate_from_menu:generate", "cai.menu.10.export:export"]);
  requiresJob(request: K11MutationRequest): boolean { return request.operation.execution_gate === "job" && this.job_actions.has(`${request.definition.action_id}:${request.operation.operation}`); }
}
