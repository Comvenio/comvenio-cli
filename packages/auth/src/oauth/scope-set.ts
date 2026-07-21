import {
  OAUTH_SCOPE_VALUES,
  type OAuthScope,
} from "@comvenio/connector-contracts";

import { OAuthContractError } from "./types.ts";

const KNOWN_SCOPES = new Set<string>(OAUTH_SCOPE_VALUES);

function sortedUnique(scopes: readonly OAuthScope[]): OAuthScope[] {
  return [...new Set(scopes)].sort();
}

export class ScopeSet {
  readonly values: readonly OAuthScope[];

  private constructor(values: readonly OAuthScope[]) {
    this.values = Object.freeze([...values]);
  }

  static fromRequested(
    rawScope: string,
    allowedScopes: readonly OAuthScope[],
  ): ScopeSet {
    const rawValues = rawScope.split(" ").filter(Boolean);
    if (rawValues.length === 0 || new Set(rawValues).size !== rawValues.length) {
      throw new OAuthContractError("invalid_scope", "Der angeforderte Scope ist ungültig.");
    }
    if (!rawValues.every((scope) => KNOWN_SCOPES.has(scope))) {
      throw new OAuthContractError("invalid_scope", "Der angeforderte Scope ist ungültig.");
    }
    const allowed = new Set(allowedScopes);
    if (!rawValues.every((scope) => allowed.has(scope as OAuthScope))) {
      throw new OAuthContractError("invalid_scope", "Der Client darf diesen Scope nicht anfordern.");
    }
    return new ScopeSet(sortedUnique(rawValues as OAuthScope[]));
  }

  static fromTools(
    tools: ReadonlyArray<{ required_scopes: readonly OAuthScope[] }>,
    allowedScopes: readonly OAuthScope[],
  ): ScopeSet {
    const requested = sortedUnique(tools.flatMap((tool) => [...tool.required_scopes]));
    if (requested.length === 0) {
      throw new OAuthContractError("invalid_scope", "Mindestens ein Tool-Scope ist erforderlich.");
    }
    const allowed = new Set(allowedScopes);
    if (!requested.every((scope) => allowed.has(scope))) {
      throw new OAuthContractError("invalid_scope", "Der Client darf den Tool-Scope nicht anfordern.");
    }
    return new ScopeSet(requested);
  }

  static fromGranted(scopes: readonly OAuthScope[]): ScopeSet {
    if (scopes.length === 0 || !scopes.every((scope) => KNOWN_SCOPES.has(scope))) {
      throw new OAuthContractError("invalid_scope", "Der Grant enthält ungültige Scopes.");
    }
    return new ScopeSet(sortedUnique(scopes));
  }

  serialize(): string {
    return this.values.join(" ");
  }

  isSubsetOf(scopes: readonly OAuthScope[]): boolean {
    const allowed = new Set(scopes);
    return this.values.every((scope) => allowed.has(scope));
  }
}
