import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { JsonValue } from "@comvenio/connector-contracts";

import { AvailabilityContract } from "./availability.ts";
import type { BookingConfirmationRequest, BookingConflictPort, K10ConfirmationPreview, K10MutationRequest } from "./types.ts";

export interface BookingConflictStoredPreview {
  preview: K10ConfirmationPreview;
  digest: string;
  availability_fingerprint: string;
  subject_id: string;
  club_id: string;
  used: boolean;
}

export interface BookingConflictPreviewStore {
  get(previewId: string): BookingConflictStoredPreview | undefined;
  set(previewId: string, preview: BookingConflictStoredPreview): unknown;
  delete(previewId: string): unknown;
}

export function createBookingConflictPreviewStore(): BookingConflictPreviewStore {
  return new Map<string, BookingConflictStoredPreview>();
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}

function inputDigest(request: K10MutationRequest): string {
  const input = request.input !== null && typeof request.input === "object" && !Array.isArray(request.input)
    ? Object.fromEntries(Object.entries(request.input).filter(([key]) => key !== "confirmation"))
    : request.input;
  return createHash("sha256").update(`${request.definition.action_id}\n${request.operation.operation}\n${canonical(input)}`).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class BookingConflictDetected extends Error {
  constructor(message = "Die Buchung kollidiert mit der aktuellen Verfügbarkeit.") {
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
    this.#previews = options.preview_store ?? createBookingConflictPreviewStore();
  }

  async confirmOrPreview(request: BookingConfirmationRequest, mutation: () => Promise<JsonValue>): Promise<JsonValue> {
    const context = request.mutation.context;
    if (!context.subject_id || !context.club_id) throw new Error("Für die Bestätigung fehlt der Actor- oder Vereinskontext.");
    const digest = inputDigest(request.mutation);
    if (!request.confirmation) {
      const availability = await Promise.all(request.availability_requests.map((item) => this.#availability.check(item, context)));
      if (availability.some((item) => item.status !== "AVAILABLE")) throw new BookingConflictDetected();
      const preview: K10ConfirmationPreview = {
        preview_id: randomUUID(),
        confirmation_token: randomBytes(32).toString("base64url"),
        action_id: request.mutation.definition.action_id,
        operation: request.mutation.operation.operation,
        subject: request.subject,
        summary: request.summary,
        effects: request.effects,
        availability,
        expires_at: new Date(this.#now().getTime() + this.#ttlMs).toISOString(),
      };
      this.#previews.set(preview.preview_id, {
        preview,
        digest,
        availability_fingerprint: this.#availability.fingerprint(availability),
        subject_id: context.subject_id,
        club_id: context.club_id,
        used: false,
      });
      return { confirmation_required: true, preview };
    }

    const stored = this.#previews.get(request.confirmation.preview_id);
    if (!stored || stored.used || Date.parse(stored.preview.expires_at) <= this.#now().getTime()
      || stored.subject_id !== context.subject_id || stored.club_id !== context.club_id || stored.digest !== digest
      || !safeEqual(stored.preview.confirmation_token, request.confirmation.confirmation_token)) {
      throw new Error("Die Bestätigung ist ungültig, abgelaufen oder gehört zu einem anderen Kontext.");
    }
    stored.used = true;
    try {
      const current = await Promise.all(request.availability_requests.map((item) => this.#availability.check(item, context)));
      if (current.some((item) => item.status !== "AVAILABLE") || this.#availability.fingerprint(current) !== stored.availability_fingerprint) {
        throw new BookingConflictDetected("Die Verfügbarkeit hat sich seit der Vorschau geändert. Es wurde keine Buchung angelegt oder geändert.");
      }
      return await mutation();
    } finally {
      this.#previews.delete(stored.preview.preview_id);
    }
  }
}
