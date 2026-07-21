import { createHash } from "node:crypto";

import { OAUTH_SCOPE_VALUES, type UUID } from "@comvenio/connector-contracts";

import { OAUTH_DEFAULTS, OAuthContractError } from "./types.ts";

export interface ActiveIntrospection {
  active: true;
  sub: UUID;
  grant_id: UUID;
  client_id: `https://${string}`;
  club_id: UUID | null;
  scope: string;
  aud: "https://mcp.comvenio.app" | "https://mcpdev.comvenio.app";
  iat: number;
  exp: number;
  jti: UUID;
}

export interface InactiveIntrospection {
  active: false;
}

export type IntrospectionResult = ActiveIntrospection | InactiveIntrospection;

interface CachedIntrospection {
  value: ActiveIntrospection;
  cached_at_ms: number;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTIVE_KEYS = ["active", "sub", "grant_id", "client_id", "club_id", "scope", "aud", "iat", "exp", "jti"].sort();
const KNOWN_SCOPES = new Set<string>(OAUTH_SCOPE_VALUES);

export function validateIntrospectionResult(value: unknown): IntrospectionResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OAuthContractError("invalid_grant", "Die Introspection-Antwort ist ungültig.");
  }
  const result = value as Record<string, unknown>;
  if (result.active === false) {
    if (Object.keys(result).length !== 1) {
      throw new OAuthContractError("invalid_grant", "Inaktive Introspection enthält unzulässige Details.");
    }
    return { active: false };
  }
  if (result.active !== true || JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(ACTIVE_KEYS)
    || typeof result.sub !== "string" || !UUID_PATTERN.test(result.sub)
    || typeof result.grant_id !== "string" || !UUID_PATTERN.test(result.grant_id)
    || typeof result.jti !== "string" || !UUID_PATTERN.test(result.jti)
    || (result.club_id !== null && (typeof result.club_id !== "string" || !UUID_PATTERN.test(result.club_id)))
    || typeof result.client_id !== "string" || !result.client_id.startsWith("https://")
    || !["https://mcp.comvenio.app", "https://mcpdev.comvenio.app"].includes(result.aud as string)
    || typeof result.iat !== "number" || typeof result.exp !== "number" || result.exp <= result.iat
    || typeof result.scope !== "string") {
    throw new OAuthContractError("invalid_grant", "Die Introspection-Antwort ist ungültig.");
  }
  const scopes = result.scope.split(" ").filter(Boolean);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length
    || !scopes.every((scope) => KNOWN_SCOPES.has(scope))) {
    throw new OAuthContractError("invalid_scope", "Die Introspection-Scopes sind ungültig.");
  }
  if (scopes.some((scope) => scope !== "public.read") && result.club_id === null) {
    throw new OAuthContractError("invalid_grant", "Private Introspection benötigt einen Verein.");
  }
  try {
    const clientUrl = new URL(result.client_id);
    if (clientUrl.protocol !== "https:" || clientUrl.username || clientUrl.password) throw new Error();
  } catch {
    throw new OAuthContractError("invalid_grant", "Die Introspection-Antwort ist ungültig.");
  }
  return {
    active: true,
    sub: result.sub,
    grant_id: result.grant_id,
    client_id: result.client_id as `https://${string}`,
    club_id: result.club_id as UUID | null,
    scope: [...scopes].sort().join(" "),
    aud: result.aud as ActiveIntrospection["aud"],
    iat: result.iat,
    exp: result.exp,
    jti: result.jti,
  };
}

export class PositiveReadIntrospectionCache {
  readonly #entries = new Map<string, CachedIntrospection>();

  get(rawToken: string, risk: "read" | "write", nowMs: number): ActiveIntrospection | null {
    if (risk === "write") return null;
    const key = tokenHash(rawToken);
    const entry = this.#entries.get(key);
    if (!entry) return null;
    const age = nowMs - entry.cached_at_ms;
    if (age < 0 || age > OAUTH_DEFAULTS.positive_read_introspection_cache_seconds * 1_000
      || entry.value.exp * 1_000 <= nowMs) {
      this.#entries.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  }

  put(rawToken: string, rawResult: unknown, nowMs: number): void {
    const result = validateIntrospectionResult(rawResult);
    const key = tokenHash(rawToken);
    if (!result.active) {
      this.#entries.delete(key);
      return;
    }
    this.#entries.set(key, { value: structuredClone(result), cached_at_ms: nowMs });
  }

  clearGrant(grantId: UUID): void {
    for (const [key, entry] of this.#entries) {
      if (entry.value.grant_id === grantId) this.#entries.delete(key);
    }
  }

  clearToken(rawToken: string): void {
    this.#entries.delete(tokenHash(rawToken));
  }

  clearAll(): void {
    this.#entries.clear();
  }
}

export interface RevocationStore {
  revoke_token_family(input: {
    token_hash_sha256: string;
    client_id: `https://${string}`;
    revoked_at: string;
  }): Promise<{ grant_id: UUID | null }>;
  revoke_owned_grant(input: {
    grant_id: UUID;
    subject_id: UUID;
    revoked_at: string;
  }): Promise<"revoked" | "already_revoked" | "not_found" | "forbidden">;
}

export class RevocationFlow {
  readonly #store: RevocationStore;
  readonly #cache: PositiveReadIntrospectionCache;
  readonly #now: () => Date;

  constructor(input: {
    store: RevocationStore;
    cache: PositiveReadIntrospectionCache;
    now: () => Date;
  }) {
    this.#store = input.store;
    this.#cache = input.cache;
    this.#now = input.now;
  }

  async revokeToken(input: { raw_token: string; client_id: `https://${string}` }): Promise<void> {
    if (!input.raw_token || /^cvn_/u.test(input.raw_token)) {
      throw new OAuthContractError("invalid_grant", "Das Tokenformat ist ungültig.");
    }
    let clientUrl: URL;
    try {
      clientUrl = new URL(input.client_id);
    } catch {
      throw new OAuthContractError("invalid_client", "Der OAuth-Client ist ungültig.");
    }
    if (clientUrl.protocol !== "https:" || clientUrl.username || clientUrl.password) {
      throw new OAuthContractError("invalid_client", "Der OAuth-Client ist ungültig.");
    }
    this.#cache.clearToken(input.raw_token);
    const result = await this.#store.revoke_token_family({
      token_hash_sha256: tokenHash(input.raw_token),
      client_id: input.client_id,
      revoked_at: this.#now().toISOString(),
    });
    if (result.grant_id) this.#cache.clearGrant(result.grant_id);
  }

  async revokeOwnGrant(input: { grant_id: UUID; subject_id: UUID }): Promise<void> {
    const result = await this.#store.revoke_owned_grant({
      grant_id: input.grant_id,
      subject_id: input.subject_id,
      revoked_at: this.#now().toISOString(),
    });
    if (result === "forbidden") {
      throw new OAuthContractError("invalid_grant", "Der Grant kann nicht widerrufen werden.");
    }
    if (result === "revoked" || result === "already_revoked") {
      this.#cache.clearGrant(input.grant_id);
    }
  }
}
