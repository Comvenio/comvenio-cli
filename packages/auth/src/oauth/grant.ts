import type { OAuthScope } from "@comvenio/connector-contracts";

import { ScopeSet } from "./scope-set.ts";
import type {
  ConnectorGrant,
  OAuthClientRegistration,
} from "./types.ts";
import { OAuthContractError } from "./types.ts";
import { OAUTH_DEFAULTS } from "./types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function instant(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith("Z")) {
    throw new OAuthContractError("invalid_grant", `${field} ist ungültig.`);
  }
  return parsed;
}

function uuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new OAuthContractError("invalid_grant", `${field} ist ungültig.`);
  }
}

export function validateConnectorGrant(
  grant: ConnectorGrant,
  registration: OAuthClientRegistration,
): ConnectorGrant {
  uuid(grant.grant_id, "grant_id");
  uuid(grant.subject_id, "subject_id");
  if (grant.selected_club_id) uuid(grant.selected_club_id, "selected_club_id");
  if (!registration.enabled || grant.client_id !== registration.client_id
    || grant.provider !== registration.provider) {
    throw new OAuthContractError("invalid_client", "Der OAuth-Client ist nicht freigegeben.");
  }
  const scopes = ScopeSet.fromGranted(grant.scopes);
  if (!scopes.isSubsetOf(registration.allowed_scopes)) {
    throw new OAuthContractError("invalid_scope", "Der Grant enthält nicht freigegebene Scopes.");
  }
  const privateGrant = scopes.values.some((scope) => scope !== "public.read");
  if (privateGrant && grant.selected_club_id === null) {
    throw new OAuthContractError("invalid_grant", "Ein privater Grant benötigt einen Verein.");
  }
  const createdAt = instant(grant.created_at, "created_at");
  const lastUsedAt = instant(grant.last_used_at, "last_used_at");
  const expiresAt = instant(grant.expires_at, "expires_at");
  if (createdAt > lastUsedAt || lastUsedAt >= expiresAt) {
    throw new OAuthContractError("invalid_grant", "Der Grant-Lebenszyklus ist ungültig.");
  }
  if (expiresAt - lastUsedAt > OAUTH_DEFAULTS.grant_inactivity_ttl_seconds * 1_000) {
    throw new OAuthContractError("invalid_grant", "Die Grant-Inaktivitätsfrist ist zu lang.");
  }
  if (grant.revoked_at) {
    const revokedAt = instant(grant.revoked_at, "revoked_at");
    if (revokedAt < createdAt) {
      throw new OAuthContractError("invalid_grant", "Der Widerrufszeitpunkt ist ungültig.");
    }
  }
  return {
    ...grant,
    scopes: [...scopes.values] as OAuthScope[],
  };
}

export function isGrantActive(grant: ConnectorGrant, nowMs: number): boolean {
  return grant.revoked_at === null && Date.parse(grant.expires_at) > nowMs;
}

export function listOwnConnectorGrants(
  grants: readonly ConnectorGrant[],
  subjectId: string,
): ConnectorGrant[] {
  uuid(subjectId, "subject_id");
  return grants
    .filter((grant) => grant.subject_id === subjectId)
    .sort((a, b) => b.last_used_at.localeCompare(a.last_used_at))
    .map((grant) => structuredClone(grant));
}
