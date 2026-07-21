import { normalizeRequestContext } from "@comvenio/connector-contracts";
import type { ConfirmationWidgetPolicy } from "./types.ts";

export class ConfirmationWidgetCapabilityPolicy implements ConfirmationWidgetPolicy {
  readonly #visibleCriticalToolNames: ReadonlySet<string>;
  constructor(visibleCriticalToolNames: Iterable<string>) { this.#visibleCriticalToolNames = new Set(visibleCriticalToolNames); }
  evaluate(input: Parameters<ConfirmationWidgetPolicy["evaluate"]>[0]) {
    const context = normalizeRequestContext(input.context);
    const snapshot = input.capability_snapshot;
    const hasWriteAuthority = context.scopes.some((scope) => scope.endsWith(".write") || ["admin.write", "files.import", "files.export"].includes(scope));
    return { allowed: context.subject_id !== null && context.club_id !== null && context.subject_id === snapshot.subject_id
      && context.club_id === snapshot.club_id && context.capability_version === snapshot.capability_version
      && hasWriteAuthority && this.#visibleCriticalToolNames.has(input.preview.tool_name) };
  }
}
