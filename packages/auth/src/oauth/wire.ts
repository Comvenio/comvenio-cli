import { createHash, timingSafeEqual } from "node:crypto";

import { OAUTH_SCOPE_VALUES, type OAuthScope } from "@comvenio/connector-contracts";

import { oauthEndpoints } from "./metadata.ts";
import { ScopeSet } from "./scope-set.ts";
import type {
  AuthorizationCodeRecord,
  AuthorizationRequest,
  HttpsUrl,
  OAuthClientRegistration,
  OAuthEnvironment,
  OAuthTokenRequest,
} from "./types.ts";
import { OAUTH_DEFAULTS, OAuthContractError } from "./types.ts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PKCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function one(params: URLSearchParams, key: string): string {
  const values = params.getAll(key);
  if (values.length !== 1 || values[0] === "") {
    throw new OAuthContractError("invalid_request", "Die OAuth-Anfrage ist ungültig.");
  }
  return values[0] as string;
}

function exactFields(params: URLSearchParams, fields: readonly string[]): void {
  const allowed = new Set(fields);
  const keys = [...params.keys()];
  if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== fields.length) {
    throw new OAuthContractError("invalid_request", "Die OAuth-Anfrage enthält ungültige Felder.");
  }
  fields.forEach((field) => one(params, field));
}

function httpsUrl(value: string, field: string): HttpsUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthContractError("invalid_request", `${field} ist ungültig.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new OAuthContractError("invalid_request", `${field} ist ungültig.`);
  }
  return value as HttpsUrl;
}

function assertRegistration(
  registration: OAuthClientRegistration,
  clientId: string,
  redirectUri?: string,
): void {
  if (!registration.enabled || registration.client_id !== clientId) {
    throw new OAuthContractError("invalid_client", "Der OAuth-Client ist nicht freigegeben.");
  }
  if (registration.token_endpoint_auth_method !== "none" || registration.pkce_method !== "S256") {
    throw new OAuthContractError("invalid_client", "Der OAuth-Clientvertrag ist ungültig.");
  }
  if (redirectUri && !registration.redirect_uris.includes(redirectUri as HttpsUrl)) {
    throw new OAuthContractError("invalid_request", "Die Redirect-URI ist nicht freigegeben.");
  }
}

function rejectLocalOrPasswordSecret(value: string): void {
  if (/^cvn_/u.test(value)) {
    throw new OAuthContractError("invalid_grant", "Lokale CLI-Tokens sind für Connector-OAuth unzulässig.");
  }
}

export function parseAuthorizationRequest(input: {
  params: URLSearchParams;
  registration: OAuthClientRegistration;
  environment: OAuthEnvironment;
}): AuthorizationRequest {
  const fields = [
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
    "resource",
  ] as const;
  exactFields(input.params, fields);
  const responseType = one(input.params, "response_type");
  const clientId = httpsUrl(one(input.params, "client_id"), "client_id");
  const redirectUri = httpsUrl(one(input.params, "redirect_uri"), "redirect_uri");
  const challenge = one(input.params, "code_challenge");
  const challengeMethod = one(input.params, "code_challenge_method");
  const state = one(input.params, "state");
  const resource = httpsUrl(one(input.params, "resource"), "resource");
  if (responseType !== "code" || challengeMethod !== "S256" || !PKCE_PATTERN.test(challenge)
    || state.length > 512) {
    throw new OAuthContractError("invalid_request", "Die Authorization-Anfrage ist ungültig.");
  }
  assertRegistration(input.registration, clientId, redirectUri);
  if (resource !== oauthEndpoints(input.environment).resource) {
    throw new OAuthContractError("invalid_request", "Die OAuth-Resource ist nicht freigegeben.");
  }
  const scopes = ScopeSet.fromRequested(one(input.params, "scope"), input.registration.allowed_scopes);
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scopes: [...scopes.values] as OAuthScope[],
    resource,
  };
}

export function parseTokenRequest(input: {
  params: URLSearchParams;
  registration: OAuthClientRegistration;
  environment: OAuthEnvironment;
}): OAuthTokenRequest {
  const grantType = one(input.params, "grant_type");
  if (grantType === "authorization_code") {
    const fields = ["grant_type", "code", "client_id", "redirect_uri", "code_verifier", "resource"];
    exactFields(input.params, fields);
    const clientId = httpsUrl(one(input.params, "client_id"), "client_id");
    const redirectUri = httpsUrl(one(input.params, "redirect_uri"), "redirect_uri");
    const code = one(input.params, "code");
    const codeVerifier = one(input.params, "code_verifier");
    const resource = httpsUrl(one(input.params, "resource"), "resource");
    rejectLocalOrPasswordSecret(code);
    assertRegistration(input.registration, clientId, redirectUri);
    if (!VERIFIER_PATTERN.test(codeVerifier) || resource !== oauthEndpoints(input.environment).resource) {
      throw new OAuthContractError("invalid_grant", "Der Authorization-Code-Grant ist ungültig.");
    }
    return {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      resource,
    };
  }
  if (grantType === "refresh_token") {
    const fields = ["grant_type", "refresh_token", "client_id", "resource"];
    exactFields(input.params, fields);
    const clientId = httpsUrl(one(input.params, "client_id"), "client_id");
    const refreshToken = one(input.params, "refresh_token");
    const resource = httpsUrl(one(input.params, "resource"), "resource");
    rejectLocalOrPasswordSecret(refreshToken);
    assertRegistration(input.registration, clientId);
    if (resource !== oauthEndpoints(input.environment).resource) {
      throw new OAuthContractError("invalid_grant", "Der Refresh-Grant ist ungültig.");
    }
    return {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      resource,
    };
  }
  throw new OAuthContractError("unsupported_grant_type", "Der Grant-Typ wird nicht unterstützt.");
}

export function verifyPkceS256(codeVerifier: string, expectedChallenge: string): boolean {
  if (!VERIFIER_PATTERN.test(codeVerifier) || !PKCE_PATTERN.test(expectedChallenge)) return false;
  const actual = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  const actualBytes = Buffer.from(actual, "ascii");
  const expectedBytes = Buffer.from(expectedChallenge, "ascii");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function createAuthorizationCodeRecord(input: {
  raw_code: string;
  authorization: AuthorizationRequest;
  subject_id: string;
  selected_club_id: string | null;
  now: Date;
}): AuthorizationCodeRecord {
  if (!input.raw_code || /^cvn_/u.test(input.raw_code) || !UUID_PATTERN.test(input.subject_id)
    || (input.selected_club_id !== null && !UUID_PATTERN.test(input.selected_club_id))) {
    throw new OAuthContractError("invalid_grant", "Der Authorization Code ist ungültig.");
  }
  const createdAt = input.now.getTime();
  return {
    code_hash_sha256: createHash("sha256").update(input.raw_code, "utf8").digest("hex"),
    client_id: input.authorization.client_id,
    subject_id: input.subject_id,
    redirect_uri: input.authorization.redirect_uri,
    code_challenge_s256: input.authorization.code_challenge,
    selected_club_id: input.selected_club_id,
    scopes: [...input.authorization.scopes],
    resource: input.authorization.resource,
    created_at: new Date(createdAt).toISOString(),
    expires_at: new Date(createdAt + OAUTH_DEFAULTS.authorization_code_ttl_seconds * 1_000).toISOString(),
    consumed_at: null,
  };
}

export function validateAuthorizationCodeRecord(record: AuthorizationCodeRecord): AuthorizationCodeRecord {
  if (!SHA256_PATTERN.test(record.code_hash_sha256) || !PKCE_PATTERN.test(record.code_challenge_s256)
    || !UUID_PATTERN.test(record.subject_id)
    || (record.selected_club_id !== null && !UUID_PATTERN.test(record.selected_club_id))
    || Date.parse(record.expires_at) - Date.parse(record.created_at)
      !== OAUTH_DEFAULTS.authorization_code_ttl_seconds * 1_000
    || (record.consumed_at !== null && Date.parse(record.consumed_at) < Date.parse(record.created_at))) {
    throw new OAuthContractError("invalid_grant", "Der Authorization Code ist ungültig.");
  }
  const scopes = ScopeSet.fromGranted(record.scopes);
  if (scopes.values.some((scope) => scope !== "public.read") && record.selected_club_id === null) {
    throw new OAuthContractError("invalid_grant", "Ein privater Authorization Code benötigt einen Verein.");
  }
  return record;
}

export function parseIntrospectionRequest(input: {
  params: URLSearchParams;
  environment: OAuthEnvironment;
}): { token: string; token_type_hint: "access_token"; resource: HttpsUrl } {
  exactFields(input.params, ["token", "token_type_hint", "resource"]);
  const token = one(input.params, "token");
  const tokenTypeHint = one(input.params, "token_type_hint");
  const resource = httpsUrl(one(input.params, "resource"), "resource");
  if (/^cvn_/u.test(token) || tokenTypeHint !== "access_token"
    || resource !== oauthEndpoints(input.environment).resource) {
    throw new OAuthContractError("invalid_request", "Die Introspection-Anfrage ist ungültig.");
  }
  return { token, token_type_hint: "access_token", resource };
}

export function oauthNoStoreHeaders(): Readonly<Record<string, string>> {
  return Object.freeze({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
}

export function createBearerChallenge(
  environment: OAuthEnvironment,
  requiredScope: OAuthScope,
): string {
  if (!(OAUTH_SCOPE_VALUES as readonly string[]).includes(requiredScope)) {
    throw new OAuthContractError("invalid_scope", "Der erforderliche Scope ist ungültig.");
  }
  const metadata = oauthEndpoints(environment).protected_resource_metadata;
  return `Bearer resource_metadata="${metadata}", scope="${requiredScope}"`;
}
