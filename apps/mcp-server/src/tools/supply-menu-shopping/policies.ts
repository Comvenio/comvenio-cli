import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { JsonValue } from "@comvenio/connector-contracts";

import {
  confirmationMatchHash,
  InMemoryDomainStateStore,
  type DomainStateStore,
} from "../../domain-state-store.ts";
import type {
  K11ConfirmationPort,
  K11ConfirmationPreview,
  K11MutationRequest,
} from "./types.ts";

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(request: K11MutationRequest): string {
  const input = request.input !== null
      && typeof request.input === "object"
      && !Array.isArray(request.input)
    ? Object.fromEntries(
      Object.entries(request.input).filter(([key]) => key !== "confirmation"),
    )
    : request.input;
  return createHash("sha256")
    .update(
      `${request.definition.action_id}\n${request.operation.operation}\n${canonical(input)}`,
    )
    .digest("hex");
}

export class SupplyChangeConfirmationPolicy implements K11ConfirmationPort {
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
    request: Parameters<K11ConfirmationPort["confirmOrPreview"]>[0],
    mutation: () => Promise<JsonValue>,
  ): Promise<JsonValue> {
    const context = request.mutation.context;
    if (!context.subject_id || !context.club_id) {
      throw new Error(
        "Für die Bestätigung fehlt der Actor- oder Vereinskontext.",
      );
    }
    const inputDigest = digest(request.mutation);
    if (!request.confirmation) {
      const preview: K11ConfirmationPreview = {
        preview_id: randomUUID(),
        confirmation_token: randomBytes(32).toString("base64url"),
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
        "supply",
        preview.preview_id,
        {
          match_hash: confirmationMatchHash(
            preview.action_id,
            preview.operation,
            context.subject_id,
            context.club_id,
            inputDigest,
            preview.confirmation_token,
          ),
        },
        this.#ttlMs,
      );
      if (!stored) {
        throw new Error(
          "Die Einkaufs-Vorschau konnte nicht atomar gespeichert werden.",
        );
      }
      return { confirmation_required: true, preview };
    }
    const stored = await this.#store.consumeConfirmation(
      "supply",
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
        "Die Bestätigung ist ungültig, abgelaufen oder gehört zu einem anderen Kontext.",
      );
    }
    return mutation();
  }
}

export class SupplyJobPolicy {
  readonly job_actions = new Set([
    "cai.shopping.06.show:export",
    "cai.shopping.14.generate_from_recipe:generate",
    "cai.shopping.15.generate_from_menu:generate",
    "cai.menu.10.export:export",
  ]);

  requiresJob(request: K11MutationRequest): boolean {
    return request.operation.execution_gate === "job"
      && this.job_actions.has(
        `${request.definition.action_id}:${request.operation.operation}`,
      );
  }
}
