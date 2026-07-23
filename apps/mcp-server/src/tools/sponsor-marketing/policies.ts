import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  createConnectorError,
  type JsonValue,
} from "@comvenio/connector-contracts";

import {
  confirmationMatchHash,
  InMemoryDomainStateStore,
  type DomainStateStore,
} from "../../domain-state-store.ts";
import type { K13ConfirmationPort, K13MutationRequest } from "./types.ts";

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: JsonValue): string {
  const safe = value !== null
      && typeof value === "object"
      && !Array.isArray(value)
    ? Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "confirmation"),
    )
    : value;
  return createHash("sha256").update(canonical(safe)).digest("hex");
}

export class SponsorConfirmationPolicy implements K13ConfirmationPort {
  readonly #store: DomainStateStore;

  constructor(
    readonly ttlMs = 10 * 60 * 1_000,
    stateStore?: DomainStateStore,
  ) {
    this.#store = stateStore ?? new InMemoryDomainStateStore();
  }

  async confirmOrPreview(
    request: {
      mutation: K13MutationRequest;
      subject: string;
      summary: string;
      effects: JsonValue[];
      confirmation: {
        preview_id: string;
        confirmation_token: string;
      } | null;
    },
    mutation: () => Promise<JsonValue>,
  ): Promise<JsonValue> {
    const actor = request.mutation.context.subject_id;
    const club = request.mutation.context.club_id;
    if (!actor || !club) {
      throw createConnectorError({
        code: "PERMISSION_DENIED",
        message: "Für die Bestätigung fehlt ein gebundener Akteur oder Verein.",
        request_id: request.mutation.context.request_id,
        retryable: false,
      });
    }
    const payloadDigest = digest(request.mutation.input);
    const actionId = request.mutation.definition.action_id;
    const operation = request.mutation.operation.operation;
    if (!request.confirmation) {
      const previewId = randomUUID();
      const token = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + this.ttlMs;
      const stored = await this.#store.putConfirmation(
        "sponsor",
        previewId,
        {
          match_hash: confirmationMatchHash(
            actionId,
            operation,
            actor,
            club,
            payloadDigest,
            token,
          ),
        },
        this.ttlMs,
      );
      if (!stored) {
        throw createConnectorError({
          code: "CONFLICT",
          message: "Die Sponsoring-Vorschau konnte nicht atomar gespeichert werden.",
          request_id: request.mutation.context.request_id,
          retryable: true,
        });
      }
      return {
        confirmation_required: true,
        preview: {
          preview_id: previewId,
          confirmation_token: token,
          action_id: actionId,
          operation,
          subject: request.subject,
          summary: request.summary,
          effects: request.effects,
          expires_at: new Date(expiresAt).toISOString(),
        },
      };
    }
    const pending = await this.#store.consumeConfirmation(
      "sponsor",
      request.confirmation.preview_id,
      confirmationMatchHash(
        actionId,
        operation,
        actor,
        club,
        payloadDigest,
        request.confirmation.confirmation_token,
      ),
    );
    if (!pending) {
      throw createConnectorError({
        code: "CONFIRMATION_MISMATCH",
        message: "Die Bestätigung ist ungültig, abgelaufen oder gehört zu einer anderen Wirkung.",
        request_id: request.mutation.context.request_id,
        retryable: false,
      });
    }
    return mutation();
  }
}
