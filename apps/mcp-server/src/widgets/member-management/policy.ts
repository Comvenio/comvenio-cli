import { normalizeRequestContext } from "@comvenio/connector-contracts";

import type { MemberWidgetActionPolicy } from "./types.ts";

export class MemberWidgetCapabilityPolicy implements MemberWidgetActionPolicy {
  readonly #visibleToolNames: ReadonlySet<string>;

  constructor(visibleToolNames: Iterable<string>) {
    this.#visibleToolNames = new Set(visibleToolNames);
  }

  evaluate(input: Parameters<MemberWidgetActionPolicy["evaluate"]>[0]) {
    const context = normalizeRequestContext(input.context);
    const snapshot = input.capability_snapshot;
    const bound = context.subject_id !== null
      && context.club_id !== null
      && context.subject_id === snapshot.subject_id
      && context.club_id === snapshot.club_id
      && context.capability_version === snapshot.capability_version;
    const hasReadScope = context.scopes.includes("member.read.basic") || context.scopes.includes("member.read.details");
    const hasWriteScope = context.scopes.some((scope) => ["admin.write", "files.import", "files.export"].includes(scope));
    const capabilityAllows = input.descriptor.risk_class === "read"
      ? snapshot.permissions.view_members === true
      : snapshot.permissions.manage_members === true;
    return {
      allowed: bound
        && (input.descriptor.risk_class === "read" ? hasReadScope : hasWriteScope)
        && capabilityAllows
        && this.#visibleToolNames.has(input.descriptor.tool_name),
      risk_class: input.descriptor.risk_class,
      requires_confirmation: input.descriptor.risk_class === "critical_write",
    } as const;
  }
}
