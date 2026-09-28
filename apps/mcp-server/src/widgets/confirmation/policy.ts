import { normalizeRequestContext } from "@comvenio/connector-contracts";
import type { ConfirmationWidgetPolicy } from "./types.ts";

// A critical write needs a writing scope in the grant; the preview is refused otherwise.
export function hasWriteAuthority(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope.endsWith(".write") || ["admin.write", "files.import", "files.export"].includes(scope));
}

export class ConfirmationWidgetCapabilityPolicy implements ConfirmationWidgetPolicy {
  readonly #visibleCriticalToolNames: ReadonlySet<string>;
  constructor(visibleCriticalToolNames: Iterable<string>) { this.#visibleCriticalToolNames = new Set(visibleCriticalToolNames); }
  evaluate(input: Parameters<ConfirmationWidgetPolicy["evaluate"]>[0]) {
    const context = normalizeRequestContext(input.context);
    const snapshot = input.capability_snapshot;
    return { allowed: context.subject_id !== null && context.club_id !== null && context.subject_id === snapshot.subject_id
      && context.club_id === snapshot.club_id && context.capability_version === snapshot.capability_version
      && hasWriteAuthority(context.scopes) && this.#visibleCriticalToolNames.has(input.preview.tool_name) };
  }
}
