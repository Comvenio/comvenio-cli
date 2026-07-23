import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { JsonValue } from "@comvenio/connector-contracts";

import {
  confirmationMatchHash,
  InMemoryDomainStateStore,
  type DomainStateStore,
} from "../../domain-state-store.ts";
import { AvailabilityContract } from "./availability.ts";
import type {
  BookingConfirmationRequest,
  BookingConflictPort,
  K10ConfirmationPreview,
  K10MutationRequest,
} from "./types.ts";

export type BookingConflictPreviewStore = DomainStateStore;

export function createBookingConflictPreviewStore(): BookingConflictPreviewStore {
  return new InMemoryDomainStateStore();
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function inputDigest(request: K10MutationRequest): string {
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

export class BookingConflictDetected extends Error {
  constructor(
    message = "Die Buchung kollidiert mit der aktuellen Verfügbarkeit.",
  ) {
    super(message);
    this.name = "BookingConflictDetected";
  }
}

export class BookingConflictPolicy implements BookingConflictPort {
  readonly #availability: AvailabilityContract;
  readonly #ttlMs: number;
  readonly #now: () => Date;
  readonly #previews: BookingConflictPreviewStore;

  constructor(
    availability: AvailabilityContract,
    options: {
      ttl_ms?: number;
      now?: () => Date;
      preview_store?: BookingConflictPreviewStore;
    } = {},
  ) {
    this.#availability = availability;
    this.#ttlMs = options.ttl_ms ?? 5 * 60_000;
    this.#now = options.now ?? (() => new Date());
    this.#previews = options.preview_store
      ?? new InMemoryDomainStateStore(() => this.#now().getTime());
  }

  async confirmOrPreview(
    request: BookingConfirmationRequest,
    mutation: () => Promise<JsonValue>,
  ): Promise<JsonValue> {
    const context = request.mutation.context;
    if (!context.subject_id || !context.club_id) {
      throw new Error(
        "Für die Bestätigung fehlt der Actor- oder Vereinskontext.",
      );
    }
    const digest = inputDigest(request.mutation);
    const actionId = request.mutation.definition.action_id;
    const operation = request.mutation.operation.operation;
    if (!request.confirmation) {
      const availability = await Promise.all(
        request.availability_requests.map((item) =>
          this.#availability.check(item, context)),
      );
      if (availability.some((item) => item.status !== "AVAILABLE")) {
        throw new BookingConflictDetected();
      }
      const preview: K10ConfirmationPreview = {
        preview_id: randomUUID(),
        confirmation_token: randomBytes(32).toString("base64url"),
        action_id: actionId,
        operation,
        subject: request.subject,
        summary: request.summary,
        effects: request.effects,
        availability,
        expires_at: new Date(
          this.#now().getTime() + this.#ttlMs,
        ).toISOString(),
      };
      const stored = await this.#previews.putConfirmation(
        "booking",
        preview.preview_id,
        {
          match_hash: confirmationMatchHash(
            actionId,
            operation,
            context.subject_id,
            context.club_id,
            digest,
            preview.confirmation_token,
          ),
          availability_fingerprint: this.#availability.fingerprint(
            availability,
          ),
        },
        this.#ttlMs,
      );
      if (!stored) {
        throw new Error(
          "Die Buchungsvorschau konnte nicht atomar gespeichert werden.",
        );
      }
      return { confirmation_required: true, preview };
    }

    const stored = await this.#previews.consumeConfirmation(
      "booking",
      request.confirmation.preview_id,
      confirmationMatchHash(
        actionId,
        operation,
        context.subject_id,
        context.club_id,
        digest,
        request.confirmation.confirmation_token,
      ),
    );
    if (
      !stored
      || typeof stored.availability_fingerprint !== "string"
    ) {
      throw new Error(
        "Die Bestätigung ist ungültig, abgelaufen oder gehört zu einem anderen Kontext.",
      );
    }
    const current = await Promise.all(
      request.availability_requests.map((item) =>
        this.#availability.check(item, context)),
    );
    if (
      current.some((item) => item.status !== "AVAILABLE")
      || this.#availability.fingerprint(current)
        !== stored.availability_fingerprint
    ) {
      throw new BookingConflictDetected(
        "Die Verfügbarkeit hat sich seit der Vorschau geändert. Es wurde keine Buchung angelegt oder geändert.",
      );
    }
    return mutation();
  }
}
