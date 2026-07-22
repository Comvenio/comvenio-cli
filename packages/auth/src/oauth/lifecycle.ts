import { createHash } from "node:crypto";

import type { UUID } from "@comvenio/connector-contracts";

import { PositiveReadIntrospectionCache } from "./revocation.ts";
import type {
  AuthorizationCodeRecord,
  HttpsUrl,
  OAuthRedirectUri,
} from "./types.ts";
import { OAUTH_DEFAULTS, OAuthContractError } from "./types.ts";
import { validateAuthorizationCodeRecord } from "./wire.ts";

const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;

function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export interface AuthorizationCodeStore {
  consume_authorization_code(input: {
    code_hash_sha256: string;
    client_id: HttpsUrl;
    redirect_uri: OAuthRedirectUri;
    resource: HttpsUrl;
    code_challenge_s256: string;
    consumed_at: string;
  }): Promise<
    | { status: "consumed"; record: AuthorizationCodeRecord }
    | { status: "invalid" | "expired" | "replayed" }
  >;
}

export class AuthorizationCodeFlow {
  readonly #store: AuthorizationCodeStore;
  readonly #now: () => Date;

  constructor(input: { store: AuthorizationCodeStore; now: () => Date }) {
    this.#store = input.store;
    this.#now = input.now;
  }

  async consume(input: {
    raw_code: string;
    code_verifier: string;
    client_id: HttpsUrl;
    redirect_uri: OAuthRedirectUri;
    resource: HttpsUrl;
  }): Promise<AuthorizationCodeRecord> {
    if (!input.raw_code || /^cvn_/u.test(input.raw_code) || !VERIFIER_PATTERN.test(input.code_verifier)) {
      throw new OAuthContractError("invalid_grant", "Der Authorization Code ist ungültig.");
    }
    const codeHash = hashSecret(input.raw_code);
    const expectedChallenge = pkceChallenge(input.code_verifier);
    const consumedAt = this.#now();
    const result = await this.#store.consume_authorization_code({
      code_hash_sha256: codeHash,
      client_id: input.client_id,
      redirect_uri: input.redirect_uri,
      resource: input.resource,
      code_challenge_s256: expectedChallenge,
      consumed_at: consumedAt.toISOString(),
    });
    if (result.status !== "consumed") {
      throw new OAuthContractError("invalid_grant", "Der Authorization Code ist ungültig oder abgelaufen.");
    }
    const record = validateAuthorizationCodeRecord(result.record);
    if (record.code_hash_sha256 !== codeHash || record.client_id !== input.client_id
      || record.redirect_uri !== input.redirect_uri || record.resource !== input.resource
      || record.code_challenge_s256 !== expectedChallenge
      || record.consumed_at !== consumedAt.toISOString()
      || Date.parse(record.expires_at) <= consumedAt.getTime()) {
      throw new OAuthContractError("invalid_grant", "Der Authorization Code ist ungültig oder abgelaufen.");
    }
    return structuredClone(record);
  }
}

export interface RefreshRotationStore {
  rotate_refresh_family(input: {
    old_token_hash_sha256: string;
    new_token_hash_sha256: string;
    rotated_at: string;
    grace_seconds: 5;
    inactivity_ttl_seconds: 2592000;
  }): Promise<
    | { status: "rotated" | "grace_replay"; grant_id: UUID }
    | { status: "reuse_revoked"; grant_id: UUID }
    | { status: "invalid" | "expired" | "revoked"; grant_id: null }
  >;
}

export class RefreshRotationFlow {
  readonly #store: RefreshRotationStore;
  readonly #cache: PositiveReadIntrospectionCache;
  readonly #now: () => Date;

  constructor(input: {
    store: RefreshRotationStore;
    cache: PositiveReadIntrospectionCache;
    now: () => Date;
  }) {
    this.#store = input.store;
    this.#cache = input.cache;
    this.#now = input.now;
  }

  async rotate(input: { old_refresh_token: string; new_refresh_token: string }): Promise<{
    grant_id: UUID;
    grace_replay: boolean;
  }> {
    if (!input.old_refresh_token || !input.new_refresh_token
      || input.old_refresh_token === input.new_refresh_token
      || /^cvn_/u.test(input.old_refresh_token) || /^cvn_/u.test(input.new_refresh_token)) {
      throw new OAuthContractError("invalid_grant", "Der Refresh-Grant ist ungültig.");
    }
    const result = await this.#store.rotate_refresh_family({
      old_token_hash_sha256: hashSecret(input.old_refresh_token),
      new_token_hash_sha256: hashSecret(input.new_refresh_token),
      rotated_at: this.#now().toISOString(),
      grace_seconds: OAUTH_DEFAULTS.refresh_rotation_grace_seconds,
      inactivity_ttl_seconds: OAUTH_DEFAULTS.grant_inactivity_ttl_seconds,
    });
    if (result.status === "reuse_revoked") {
      this.#cache.clearGrant(result.grant_id);
      throw new OAuthContractError("invalid_grant", "Die Refresh-Familie wurde widerrufen.");
    }
    if (result.status === "invalid" || result.status === "expired" || result.status === "revoked") {
      throw new OAuthContractError("invalid_grant", "Der Refresh-Grant ist ungültig oder abgelaufen.");
    }
    if (result.grant_id === null) {
      throw new OAuthContractError("invalid_grant", "Der Refresh-Grant ist ungültig oder abgelaufen.");
    }
    return { grant_id: result.grant_id, grace_replay: result.status === "grace_replay" };
  }
}
