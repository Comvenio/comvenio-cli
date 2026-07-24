import { normalizeRequestContext } from "@comvenio/connector-contracts";

import type {
  ToolVisibilityDecision,
  ToolVisibilityInput,
} from "./types.ts";

function denied(reason: ToolVisibilityDecision["reason"]): ToolVisibilityDecision {
  return { visible: false, authorized: false, reason };
}

export class ToolVisibilityPolicy {
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  evaluate(input: ToolVisibilityInput): ToolVisibilityDecision {
    if (!input.catalog_contains_tool) return denied("NOT_IN_CATALOG");
    const context = normalizeRequestContext(input.context);
    const grantedScopes = new Set(context.scopes);
    if (input.tool.is_public) {
      if (!input.tool.required_scopes.every((scope) =>
        grantedScopes.has(scope))) {
        return denied("SCOPE_REQUIRED");
      }
      return { visible: true, authorized: true, reason: "VISIBLE" };
    }
    if (context.subject_id === null || context.club_id === null || input.snapshot === null) {
      return denied("CONTEXT_MISSING");
    }
    if (input.snapshot.subject_id !== context.subject_id || input.snapshot.club_id !== context.club_id) {
      return denied("TENANT_MISMATCH");
    }
    if (context.capability_version === null
      || context.capability_version !== input.snapshot.capability_version
      || Date.parse(input.snapshot.expires_at) <= this.#now().getTime()) {
      return denied("VERSION_STALE");
    }
    if (input.tool.permission_policy.department_scope === "required" && context.department_id === null) {
      return denied("DEPARTMENT_MISMATCH");
    }
    if (input.tool.permission_policy.department_scope === "forbidden" && context.department_id !== null) {
      return denied("DEPARTMENT_MISMATCH");
    }
    if (context.department_id !== null && !input.snapshot.department_ids.includes(context.department_id)) {
      return denied("DEPARTMENT_MISMATCH");
    }
    const permissions = input.snapshot.permissions;
    const hasAll = input.tool.permission_policy.all_of.every((key) => permissions[key] === true);
    const hasAny = input.tool.permission_policy.any_of.length === 0
      || input.tool.permission_policy.any_of.some((key) => permissions[key] === true);
    const selfOnly = input.tool.permission_policy.owner_or_self_allowed
      && input.tool.permission_policy.all_of.length === 0
      && input.tool.permission_policy.any_of.length === 0;
    if ((!hasAll || !hasAny) && !selfOnly) return denied("PERMISSION_REQUIRED");
    if (!input.tool.required_scopes.every((scope) =>
      grantedScopes.has(scope))) {
      return {
        visible: input.provider_tool_updates === "dynamic",
        authorized: false,
        reason: "SCOPE_REQUIRED",
      };
    }
    if (input.provider_tool_updates !== "dynamic") {
      return { visible: false, authorized: true, reason: "PROVIDER_STATIC_TOOLSET" };
    }
    return { visible: true, authorized: true, reason: "VISIBLE" };
  }
}
