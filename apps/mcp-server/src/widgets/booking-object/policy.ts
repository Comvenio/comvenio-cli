import { normalizeRequestContext } from "@comvenio/connector-contracts";

import type { BookingWidgetActionPolicy } from "./types.ts";

export class BookingWidgetCapabilityPolicy implements BookingWidgetActionPolicy {
  readonly #visibleToolNames: ReadonlySet<string>;

  constructor(visibleToolNames: Iterable<string>) {
    this.#visibleToolNames = new Set(visibleToolNames);
  }

  evaluate(input: Parameters<BookingWidgetActionPolicy["evaluate"]>[0]) {
    const context = normalizeRequestContext(input.context);
    const snapshot = input.capability_snapshot;
    const bound = context.subject_id !== null
      && context.club_id !== null
      && context.subject_id === snapshot.subject_id
      && context.club_id === snapshot.club_id
      && context.capability_version === snapshot.capability_version;
    const readAllowed = context.scopes.includes("object.read") && context.scopes.includes("booking.read");
    const writeAllowed = context.scopes.includes("object.read") && context.scopes.includes("booking.write");
    return {
      allowed: bound
        && (input.descriptor.risk_class === "read" ? readAllowed : writeAllowed)
        && this.#visibleToolNames.has(input.descriptor.tool_name),
      risk_class: input.descriptor.risk_class,
      requires_confirmation: input.descriptor.risk_class !== "read",
    } as const;
  }
}
