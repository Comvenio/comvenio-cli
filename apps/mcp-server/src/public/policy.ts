import {
  isConnectorError,
  normalizeRequestContext,
  type RequestContext,
} from "@comvenio/connector-contracts";

import { runtimeError } from "../http/errors.ts";
import { PUBLIC_READ_CONTRACTS } from "./contracts.ts";
import {
  PUBLIC_RESOLVER_ALIASES,
  type PublicReadContract,
  type PublicResolverAlias,
  type PublicRouteEvidence,
} from "./types.ts";

function permissionPolicyIsPublic(evidence: PublicRouteEvidence): boolean {
  const policy = evidence.audit.permission_policy;
  return policy.all_of.length === 0
    && policy.any_of.length === 0
    && policy.owner_or_self_allowed === false
    && policy.department_scope === "forbidden"
    && policy.backend_audit_refs.length === 1
    && policy.backend_audit_refs[0] === evidence.audit.audit_id;
}

export class PublicAccessPolicy {
  readonly #contracts = new Map<PublicResolverAlias, PublicReadContract>();

  constructor(contracts: Readonly<Record<PublicResolverAlias, PublicReadContract>> = PUBLIC_READ_CONTRACTS) {
    const entries = Object.entries(contracts) as Array<[PublicResolverAlias, PublicReadContract]>;
    const aliases = new Set(entries.map(([alias]) => alias));
    if (entries.length !== PUBLIC_RESOLVER_ALIASES.length
      || PUBLIC_RESOLVER_ALIASES.some((alias) => !aliases.has(alias))) {
      throw new Error("Die Public-Read-Verträge bilden die Resolver-Allowlist nicht vollständig ab.");
    }
    for (const [alias, contract] of entries) {
      if (alias !== contract.alias || contract.method !== "GET" || contract.authorization !== "absent"
        || contract.backend_authentication !== "public" || contract.required_scope !== "public.read"
        || !contract.normalized_path_template.startsWith("/")
        || contract.response_allowlist.length === 0
        || new Set(contract.response_allowlist).size !== contract.response_allowlist.length
        || (contract.publication_state === "verified" && contract.blocker !== null)
        || (contract.publication_state === "blocked" && !contract.blocker)) {
        throw new Error(`Der Public-Read-Vertrag ${alias} ist ungültig.`);
      }
      this.#contracts.set(alias, Object.freeze(structuredClone(contract)));
    }
  }

  get(alias: PublicResolverAlias): PublicReadContract {
    const contract = this.#contracts.get(alias);
    if (!contract) throw new Error("Der öffentliche Resolver ist nicht freigegeben.");
    return structuredClone(contract);
  }

  list(): PublicReadContract[] {
    return [...this.#contracts.values()].map((contract) => structuredClone(contract));
  }

  assertPublishable(alias: PublicResolverAlias): PublicReadContract {
    const contract = this.get(alias);
    if (contract.publication_state !== "verified") {
      throw new Error(`${alias}: Resolver ist wegen Vertragsdrift nicht veröffentlichbar.`);
    }
    return contract;
  }

  assertAnonymousContext(contextInput: RequestContext): RequestContext {
    const context = normalizeRequestContext(contextInput);
    if (context.subject_id !== null || context.oauth_grant_id !== null
      || context.capability_version !== null
      || context.scopes.length !== 1 || context.scopes[0] !== "public.read") {
      throw runtimeError({
        code: "AUTH_REQUIRED",
        message: "Der öffentliche Zugriff darf keinen privaten Berechtigungskontext verwenden.",
        request_id: context.request_id,
        retryable: false,
      });
    }
    return context;
  }

  assertRouteEvidence(alias: PublicResolverAlias, evidence: PublicRouteEvidence): void {
    const contract = this.get(alias);
    const { trace, audit } = evidence;
    const sameRoute = trace.http_method === contract.method
      && trace.service === contract.service
      && trace.normalized_path_template === contract.normalized_path_template
      && audit.http_method === contract.method
      && audit.service === contract.service
      && audit.normalized_path_template === contract.normalized_path_template;
    if (!sameRoute || trace.request_matcher.authorization !== "absent"
      || trace.request_matcher.content_type !== null
      || trace.request_matcher.idempotency_key !== "absent"
      || trace.request_matcher.body_fixture_ref !== null
      || audit.authentication !== "public" || audit.classification !== "classified"
      || !permissionPolicyIsPublic(evidence)) {
      throw new Error(`${alias}: Public-Route-Evidence ist nicht fail-closed freigegeben.`);
    }
  }

  normalizeHiddenResource(error: unknown, requestId: string): never {
    if (isConnectorError(error)
      && ["NOT_FOUND", "AUTH_REQUIRED", "PERMISSION_DENIED"].includes(error.code)) {
      throw runtimeError({
        code: "NOT_FOUND",
        message: "Die öffentliche Ressource wurde nicht gefunden.",
        request_id: requestId,
        retryable: false,
      });
    }
    throw error;
  }
}
