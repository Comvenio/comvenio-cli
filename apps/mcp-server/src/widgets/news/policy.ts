import { normalizeRequestContext } from "@comvenio/connector-contracts";

import type { NewsWidgetActionPolicy } from "./types.ts";

function managementIntent(actionId: string): boolean {
  return /(?:create|draft|update|delete|preview|publish|apply)/iu.test(actionId);
}

export class NewsWidgetCapabilityPolicy implements NewsWidgetActionPolicy {
  readonly #visibleToolNames: ReadonlySet<string>;

  constructor(visibleToolNames: Iterable<string>) {
    this.#visibleToolNames = new Set(visibleToolNames);
  }

  evaluate(input: Parameters<NewsWidgetActionPolicy["evaluate"]>[0]) {
    const context = normalizeRequestContext(input.context);
    const snapshot = input.capability_snapshot;
    const bound = context.subject_id !== null && context.club_id !== null
      && context.subject_id === snapshot.subject_id && context.club_id === snapshot.club_id
      && context.capability_version === snapshot.capability_version;
    const manage = managementIntent(input.descriptor.action_id) || input.descriptor.risk_class !== "read";
    const allowed = bound
      && this.#visibleToolNames.has(input.descriptor.tool_name)
      && (manage
        ? context.scopes.includes("content.write") && snapshot.permissions.manage_news === true
        : context.scopes.includes("content.read") && (snapshot.permissions.read_news === true || snapshot.permissions.manage_news === true));
    return {
      allowed,
      risk_class: input.descriptor.risk_class,
      requires_confirmation: input.descriptor.risk_class === "critical_write",
    } as const;
  }
}
