import { normalizeRequestContext } from "@comvenio/connector-contracts";

import type { EventWidgetActionPolicy } from "./types.ts";

export class EventWidgetCapabilityPolicy implements EventWidgetActionPolicy {
  readonly #visibleToolNames: ReadonlySet<string>;

  constructor(visibleToolNames: Iterable<string>) {
    this.#visibleToolNames = new Set(visibleToolNames);
  }

  evaluate(input: Parameters<EventWidgetActionPolicy["evaluate"]>[0]) {
    const context = normalizeRequestContext(input.context);
    const snapshot = input.capability_snapshot;
    const bound = context.subject_id !== null
      && context.club_id !== null
      && context.subject_id === snapshot.subject_id
      && context.club_id === snapshot.club_id
      && context.capability_version === snapshot.capability_version;
    const requiredScope = input.descriptor.risk_class === "read" ? "event.read" : "event.write";
    const capabilityAllows = input.descriptor.risk_class === "read"
      ? snapshot.permissions.view_events === true
      : input.descriptor.risk_class === "critical_write"
        ? snapshot.permissions.manage_events === true
        : snapshot.permissions.manage_events === true || snapshot.permissions.create_events === true;
    const allowed = bound
      && context.scopes.includes(requiredScope)
      && capabilityAllows
      && this.#visibleToolNames.has(input.descriptor.tool_name);
    return {
      allowed,
      risk_class: input.descriptor.risk_class,
      requires_confirmation: input.descriptor.risk_class === "critical_write",
    } as const;
  }
}
