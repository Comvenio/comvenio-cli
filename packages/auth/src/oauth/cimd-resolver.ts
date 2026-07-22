import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  OAUTH_SCOPE_VALUES,
  type OAuthScope,
  type ProviderId,
} from "@comvenio/connector-contracts";

import type {
  HttpsUrl,
  OAuthClientRegistration,
  OAuthRedirectUri,
} from "./types.ts";
import { OAUTH_DEFAULTS, OAuthContractError } from "./types.ts";

export interface CimdClientPin {
  client_id: HttpsUrl;
  provider: ProviderId;
  metadata_sha256: string;
  allowed_scopes: OAuthScope[];
  enabled: boolean;
}

export interface CimdFetchResponse {
  status: number;
  content_type: string;
  body: Uint8Array;
  redirected: boolean;
}

export interface CimdResolverDependencies {
  resolve_dns(hostname: string): Promise<string[]>;
  fetch_document(
    url: HttpsUrl,
    resolvedAddresses: readonly string[],
    timeoutMs: 3000,
  ): Promise<CimdFetchResponse>;
  now(): number;
}

interface CachedRegistration {
  registration: OAuthClientRegistration;
  expires_at_ms: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const KNOWN_SCOPES = new Set<string>(OAUTH_SCOPE_VALUES);

function forbiddenIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0, c = 0] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function forbiddenIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0] ?? "";
  if (normalized.startsWith("::ffff:")) return forbiddenIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1"
    || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/u.test(normalized)
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:");
}

export function isForbiddenCimdIpAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return forbiddenIpv4(ip);
  if (family === 6) return forbiddenIpv6(ip);
  return true;
}

function validateClientId(value: string): { client_id: HttpsUrl; hostname: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthContractError("invalid_client", "Das Client-Metadatendokument ist ungültig.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || isIP(url.hostname) !== 0) {
    throw new OAuthContractError("invalid_client", "Das Client-Metadatendokument ist nicht zulässig.");
  }
  return { client_id: value as HttpsUrl, hostname: url.hostname };
}

function validateRedirectUri(value: string): OAuthRedirectUri {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthContractError("invalid_client", "Die Redirect-URI ist ungültig.");
  }
  const loopbackHttp = url.protocol === "http:"
    && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopbackHttp) || url.username || url.password || url.hash) {
    throw new OAuthContractError("invalid_client", "Die Redirect-URI ist nicht zulässig.");
  }
  return value as OAuthRedirectUri;
}

function parseRegistration(
  body: Uint8Array,
  pin: CimdClientPin,
  redirectUri: OAuthRedirectUri,
): OAuthClientRegistration {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new OAuthContractError("invalid_client", "Das Client-Metadatendokument ist ungültig.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OAuthContractError("invalid_client", "Das Client-Metadatendokument ist ungültig.");
  }
  const document = value as Record<string, unknown>;
  const redirectUris = document.redirect_uris;
  const clientName = document.client_name;
  const singularAuthMethod = document.token_endpoint_auth_method;
  const supportedAuthMethods = document.token_endpoint_auth_methods_supported;
  const supportsPublicClient = singularAuthMethod === "none"
    || (Array.isArray(supportedAuthMethods) && supportedAuthMethods.includes("none"));
  const grantTypes = document.grant_types;
  const responseTypes = document.response_types;
  if (document.client_id !== pin.client_id
    || typeof clientName !== "string" || clientName.trim().length === 0 || clientName.length > 200
    || !Array.isArray(redirectUris) || redirectUris.length === 0
    || !redirectUris.every((uri) => typeof uri === "string")
    || new Set(redirectUris).size !== redirectUris.length
    || !redirectUris.includes(redirectUri)
    || !supportsPublicClient
    || (grantTypes !== undefined && (!Array.isArray(grantTypes)
      || !grantTypes.every((item) => typeof item === "string")
      || !grantTypes.includes("authorization_code")))
    || (responseTypes !== undefined && (!Array.isArray(responseTypes)
      || !responseTypes.every((item) => typeof item === "string")
      || !responseTypes.includes("code")))) {
    throw new OAuthContractError("invalid_client", "Das Client-Metadatendokument ist nicht freigegeben.");
  }
  const validatedRedirectUris = redirectUris.map((uri) => validateRedirectUri(uri as string));
  return {
    client_id: pin.client_id,
    provider: pin.provider,
    redirect_uris: [...new Set(validatedRedirectUris)].sort(),
    allowed_scopes: [...pin.allowed_scopes].sort(),
    token_endpoint_auth_method: "none",
    pkce_method: "S256",
    metadata_sha256: pin.metadata_sha256,
    enabled: pin.enabled,
  };
}

export class HardenedCimdResolver {
  readonly #pins: ReadonlyMap<string, CimdClientPin>;
  readonly #dependencies: CimdResolverDependencies;
  readonly #cache = new Map<string, CachedRegistration>();

  constructor(pins: readonly CimdClientPin[], dependencies: CimdResolverDependencies) {
    pins.forEach((pin) => validateClientId(pin.client_id));
    if (pins.some((pin) => !SHA256_PATTERN.test(pin.metadata_sha256))
      || pins.some((pin) => pin.client_id.includes("*"))
      || pins.some((pin) => !Array.isArray(pin.allowed_scopes) || pin.allowed_scopes.length === 0
        || new Set(pin.allowed_scopes).size !== pin.allowed_scopes.length
        || pin.allowed_scopes.some((scope) => !KNOWN_SCOPES.has(scope)))
      || new Set(pins.map((pin) => pin.client_id)).size !== pins.length) {
      throw new OAuthContractError("invalid_client", "Die CIMD-Allowlist ist ungültig.");
    }
    this.#pins = new Map(pins.map((pin) => [pin.client_id, structuredClone(pin)]));
    this.#dependencies = dependencies;
  }

  async resolve(input: { client_id: string; redirect_uri: string }): Promise<OAuthClientRegistration> {
    const { client_id: clientId, hostname } = validateClientId(input.client_id);
    const redirectUri = validateRedirectUri(input.redirect_uri);
    const pin = this.#pins.get(clientId);
    if (!pin?.enabled) throw new OAuthContractError("invalid_client", "Der OAuth-Client ist nicht freigegeben.");
    const cached = this.#cache.get(clientId);
    if (cached && cached.expires_at_ms > this.#dependencies.now()) {
      if (!cached.registration.redirect_uris.includes(redirectUri)) {
        throw new OAuthContractError("invalid_client", "Die Redirect-URI ist nicht freigegeben.");
      }
      return structuredClone(cached.registration);
    }
    const addresses = await this.#dependencies.resolve_dns(hostname);
    if (addresses.length === 0 || addresses.some(isForbiddenCimdIpAddress)) {
      throw new OAuthContractError("invalid_client", "Das Client-Metadatendokument ist nicht erreichbar.");
    }
    const response = await this.#dependencies.fetch_document(
      clientId,
      addresses,
      OAUTH_DEFAULTS.cimd_timeout_ms,
    );
    if (response.redirected || response.status !== 200
      || response.content_type.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
      || response.body.byteLength > OAUTH_DEFAULTS.cimd_max_bytes) {
      throw new OAuthContractError("invalid_client", "Das Client-Metadatendokument ist ungültig.");
    }
    const fingerprint = createHash("sha256").update(response.body).digest("hex");
    if (fingerprint !== pin.metadata_sha256) {
      throw new OAuthContractError("invalid_client", "Der Client-Fingerprint stimmt nicht überein.");
    }
    const registration = parseRegistration(response.body, pin, redirectUri);
    this.#cache.set(clientId, {
      registration: structuredClone(registration),
      expires_at_ms: this.#dependencies.now() + OAUTH_DEFAULTS.cimd_cache_ttl_seconds * 1_000,
    });
    return registration;
  }

  clear(): void {
    this.#cache.clear();
  }
}

export function assertCimdReleaseReady(pins: readonly CimdClientPin[]): void {
  if (pins.some((pin) => pin.client_id.includes("*") || !SHA256_PATTERN.test(pin.metadata_sha256)
    || !Array.isArray(pin.allowed_scopes) || pin.allowed_scopes.length === 0
    || new Set(pin.allowed_scopes).size !== pin.allowed_scopes.length
    || pin.allowed_scopes.some((scope) => !KNOWN_SCOPES.has(scope)))) {
    throw new OAuthContractError("invalid_client", "Die Provider-CIMD-Pins sind nicht releasebereit.");
  }
  const enabledProviders = new Set(pins.filter((pin) => pin.enabled).map((pin) => pin.provider));
  if (!enabledProviders.has("openai") || !enabledProviders.has("anthropic")) {
    throw new OAuthContractError("invalid_client", "Die Provider-CIMD-Pins sind nicht releasebereit.");
  }
}
