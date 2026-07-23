import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { JsonValue } from "@comvenio/connector-contracts";

import {
  confirmationMatchHash,
  InMemoryDomainStateStore,
  type DomainStateStore,
} from "../../domain-state-store.ts";
import type {
  EventConfirmationPort,
  EventConfirmationRequest,
  EventPreviewContract,
  K8ActionId,
} from "./types.ts";

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(actionId: K8ActionId, operation: string, input: JsonValue): string {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const { confirmation: _confirmation, ...rest } = input;
    return createHash("sha256")
      .update(`${actionId}\n${operation}\n${canonical(rest)}`)
      .digest("hex");
  }
  return createHash("sha256")
    .update(`${actionId}\n${operation}\n${canonical(input)}`)
    .digest("hex");
}

export class EventConfirmationPolicy implements EventConfirmationPort {
  readonly #ttlMs: number;
  readonly #now: () => Date;
  readonly #store: DomainStateStore;

  constructor(options: {
    ttl_ms?: number;
    now?: () => Date;
    state_store?: DomainStateStore;
  } = {}) {
    this.#ttlMs = options.ttl_ms ?? 5 * 60_000;
    this.#now = options.now ?? (() => new Date());
    this.#store = options.state_store
      ?? new InMemoryDomainStateStore(() => this.#now().getTime());
  }

  async confirmOrPreview(
    request: EventConfirmationRequest,
    mutation: () => Promise<JsonValue>,
  ): Promise<JsonValue> {
    const context = request.mutation.context;
    if (!context.subject_id || !context.club_id) {
      throw new Error(
        "Für eine Event-Bestätigung fehlt der Actor- oder Vereinskontext.",
      );
    }
    const inputDigest = digest(
      request.mutation.definition.action_id,
      request.mutation.operation.operation,
      request.mutation.input,
    );
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
        expires_at: new Date(
          this.#now().getTime() + this.#ttlMs,
        ).toISOString(),
      };
      const stored = await this.#store.putConfirmation(
        "event",
        previewId,
        {
          match_hash: confirmationMatchHash(
            preview.action_id,
            preview.operation,
            context.subject_id,
            context.club_id,
            inputDigest,
            confirmationToken,
          ),
        },
        this.#ttlMs,
      );
      if (!stored) {
        throw new Error(
          "Die Event-Vorschau konnte nicht atomar gespeichert werden.",
        );
      }
      return { confirmation_required: true, preview };
    }

    const stored = await this.#store.consumeConfirmation(
      "event",
      request.confirmation.preview_id,
      confirmationMatchHash(
        request.mutation.definition.action_id,
        request.mutation.operation.operation,
        context.subject_id,
        context.club_id,
        inputDigest,
        request.confirmation.confirmation_token,
      ),
    );
    if (!stored) {
      throw new Error(
        "Die Event-Bestätigung ist ungültig, abgelaufen oder gehört zu einem anderen Kontext.",
      );
    }
    return mutation();
  }
}
