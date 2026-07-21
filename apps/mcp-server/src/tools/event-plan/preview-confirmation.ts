import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { JsonValue } from "@comvenio/connector-contracts";

import type {
  EventConfirmationPort,
  EventConfirmationRequest,
  EventPreviewContract,
  K8ActionId,
} from "./types.ts";

interface StoredPreview {
  preview: EventPreviewContract;
  digest: string;
  subject_id: string;
  club_id: string;
  used: boolean;
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(actionId: K8ActionId, operation: string, input: JsonValue): string {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const { confirmation: _confirmation, ...rest } = input;
    return createHash("sha256").update(`${actionId}\n${operation}\n${canonical(rest)}`).digest("hex");
  }
  return createHash("sha256").update(`${actionId}\n${operation}\n${canonical(input)}`).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class EventConfirmationPolicy implements EventConfirmationPort {
  readonly #ttlMs: number;
  readonly #now: () => Date;
  readonly #previews = new Map<string, StoredPreview>();

  constructor(options: { ttl_ms?: number; now?: () => Date } = {}) {
    this.#ttlMs = options.ttl_ms ?? 5 * 60_000;
    this.#now = options.now ?? (() => new Date());
  }

  async confirmOrPreview(request: EventConfirmationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue> {
    const context = request.mutation.context;
    if (!context.subject_id || !context.club_id) throw new Error("Für eine Event-Bestätigung fehlt der Actor- oder Vereinskontext.");
    const inputDigest = digest(request.mutation.definition.action_id, request.mutation.operation.operation, request.mutation.input);
    if (!request.confirmation) {
      const previewId = randomUUID();
      const confirmationToken = randomBytes(32).toString("base64url");
      const preview: EventPreviewContract = {
        preview_id: previewId,
        confirmation_token: confirmationToken,
        action_id: request.mutation.definition.action_id,
        operation: request.mutation.operation.operation,
        subject: request.subject,
        summary: request.summary,
        effects: request.effects,
        expires_at: new Date(this.#now().getTime() + this.#ttlMs).toISOString(),
      };
      this.#previews.set(previewId, {
        preview,
        digest: inputDigest,
        subject_id: context.subject_id,
        club_id: context.club_id,
        used: false,
      });
      return { confirmation_required: true, preview };
    }

    const stored = this.#previews.get(request.confirmation.preview_id);
    if (!stored
      || stored.used
      || Date.parse(stored.preview.expires_at) <= this.#now().getTime()
      || stored.subject_id !== context.subject_id
      || stored.club_id !== context.club_id
      || stored.digest !== inputDigest
      || !safeEqual(stored.preview.confirmation_token, request.confirmation.confirmation_token)) {
      throw new Error("Die Event-Bestätigung ist ungültig, abgelaufen oder gehört zu einem anderen Kontext.");
    }
    stored.used = true;
    try {
      return await mutation();
    } finally {
      this.#previews.delete(stored.preview.preview_id);
    }
  }
}
