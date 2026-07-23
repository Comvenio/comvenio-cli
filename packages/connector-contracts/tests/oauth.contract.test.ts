import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  HardenedCimdResolver,
  AuthorizationCodeFlow,
  OAUTH_DEFAULTS,
  OAuthContractError,
  PositiveReadIntrospectionCache,
  RefreshRotationFlow,
  RevocationFlow,
  ScopeSet,
  assertCimdReleaseReady,
  createAuthorizationCodeRecord,
  createAuthorizationServerMetadata,
  createClubSelectionContext,
  createBearerChallenge,
  createProtectedResourceMetadata,
  isForbiddenCimdIpAddress,
  oauthEndpoints,
  oauthNoStoreHeaders,
  listOwnConnectorGrants,
  parseAuthorizationRequest,
  parseIntrospectionRequest,
  parseTokenRequest,
  validateAuthorizationCodeRecord,
  validateConnectorGrant,
  verifyPkceS256,
  type CimdClientPin,
  type CimdResolverDependencies,
  type ConnectorGrant,
  type OAuthClientRegistration,
  type RevocationStore,
  type AuthorizationCodeStore,
  type RefreshRotationStore,
} from "../../auth/src/index.ts";
import { OAUTH_SCOPE_VALUES } from "../src/index.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const clubA = "33333333-3333-4333-8333-333333333333";
const clubB = "44444444-4444-4444-8444-444444444444";
const grantId = "55555555-5555-4555-8555-555555555555";
const clientId = "https://chatgpt.example.com/client-metadata.json" as const;
const redirectUri = "https://chatgpt.example.com/oauth/callback" as const;
const registration: OAuthClientRegistration = {
  client_id: clientId,
  provider: "openai",
  redirect_uris: [redirectUri],
  allowed_scopes: ["club.read", "event.read"],
  token_endpoint_auth_method: "none",
  pkce_method: "S256",
  metadata_sha256: "a".repeat(64),
  enabled: true,
};

function authorizationParams(codeChallenge: string): URLSearchParams {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: "state-with-provider-entropy",
    scope: "event.read club.read",
    resource: oauthEndpoints("production").resource,
  });
}

describe("OAuth metadata and scopes", () => {
  test("publishes exact production and development metadata with PKCE S256", () => {
    const production = createAuthorizationServerMetadata("production");
    const development = createAuthorizationServerMetadata("development");
    expect(production).toEqual({
      issuer: "https://api.comvenio.app/auth",
      authorization_endpoint: "https://api.comvenio.app/auth/oauth/authorize",
      token_endpoint: "https://api.comvenio.app/auth/oauth/token",
      revocation_endpoint: "https://api.comvenio.app/auth/oauth/revoke",
      scopes_supported: [...OAUTH_SCOPE_VALUES],
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
    });
    expect(development.issuer).toBe("https://apidev.comvenio.app/auth");
    expect(createProtectedResourceMetadata(
      "production",
      "https://www.comvenio.app/datenschutz",
    )).toEqual({
      resource: "https://mcp.comvenio.app",
      authorization_servers: ["https://api.comvenio.app/auth"],
      scopes_supported: [...OAUTH_SCOPE_VALUES],
      resource_documentation: "https://www.comvenio.app/datenschutz",
    });
    expect(Object.values(production).flat().filter((value) =>
      typeof value === "string" && value.startsWith("http"))
      .every((value) => value.startsWith("https://"))).toBe(true);
  });

  test("derives a sorted, bounded ScopeSet without granting capabilities", () => {
    const scopes = ScopeSet.fromTools([
      { required_scopes: ["event.read", "club.read"] },
      { required_scopes: ["event.read"] },
    ], registration.allowed_scopes);
    expect(scopes.values).toEqual(["club.read", "event.read"]);
    expect(scopes.serialize()).toBe("club.read event.read");
    expect(() => ScopeSet.fromRequested("admin.write", registration.allowed_scopes))
      .toThrow("Client darf diesen Scope nicht anfordern");
  });
});

describe("authorization, PKCE and token wire", () => {
  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");

  test("accepts only exact Authorization Code + PKCE S256 parameters", () => {
    const request = parseAuthorizationRequest({
      params: authorizationParams(challenge),
      registration,
      environment: "production",
    });
    expect(request.scopes).toEqual(["club.read", "event.read"]);
    expect(request.state).toBe("state-with-provider-entropy");
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256(`${verifier}x`, challenge)).toBe(false);

    const duplicate = authorizationParams(challenge);
    duplicate.append("scope", "club.read");
    expect(() => parseAuthorizationRequest({
      params: duplicate,
      registration,
      environment: "production",
    })).toThrow("OAuth-Anfrage ist ungültig");
  });

  test("persists only the authorization-code hash with the fixed 60-second TTL", () => {
    const authorization = parseAuthorizationRequest({
      params: authorizationParams(challenge),
      registration,
      environment: "production",
    });
    const record = validateAuthorizationCodeRecord(createAuthorizationCodeRecord({
      raw_code: "one-time-authorization-code",
      authorization,
      subject_id: subjectId,
      selected_club_id: clubA,
      now: new Date("2026-07-21T10:00:00.000Z"),
    }));
    expect(record.code_hash_sha256).toHaveLength(64);
    expect(JSON.stringify(record)).not.toContain("one-time-authorization-code");
    expect(Date.parse(record.expires_at) - Date.parse(record.created_at))
      .toBe(OAUTH_DEFAULTS.authorization_code_ttl_seconds * 1_000);
  });

  test("parses exact form token grants and rejects password/device/local-token paths", () => {
    const codeGrant = parseTokenRequest({
      params: new URLSearchParams({
        grant_type: "authorization_code",
        code: "opaque-one-time-code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: "https://mcp.comvenio.app",
      }),
      registration,
      environment: "production",
    });
    expect(codeGrant.grant_type).toBe("authorization_code");

    expect(() => parseTokenRequest({
      params: new URLSearchParams({
        grant_type: "password",
        username: "user@example.com",
        password: "never-log-this",
      }),
      registration,
      environment: "production",
    })).toThrow("Grant-Typ wird nicht unterstützt");
    try {
      parseTokenRequest({
        params: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: "cvn_local_cli_token",
          client_id: clientId,
          resource: "https://mcp.comvenio.app",
        }),
        registration,
        environment: "production",
      });
      throw new Error("Expected local token rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthContractError);
      expect(JSON.stringify(error)).toBe('{"error":"invalid_grant"}');
      expect(JSON.stringify(error)).not.toContain("cvn_local_cli_token");
    }
  });

  test("validates the exact internal introspection wire and no-store response contract", () => {
    expect(parseIntrospectionRequest({
      params: new URLSearchParams({
        token: "opaque-connector-access-token",
        token_type_hint: "access_token",
        resource: "https://mcp.comvenio.app",
      }),
      environment: "production",
    })).toEqual({
      token: "opaque-connector-access-token",
      token_type_hint: "access_token",
      resource: "https://mcp.comvenio.app",
    });
    expect(oauthNoStoreHeaders()).toEqual({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    });
    expect(createBearerChallenge("production", "event.read"))
      .toBe('Bearer resource_metadata="https://mcp.comvenio.app/.well-known/oauth-protected-resource", scope="event.read"');
  });
});

describe("authorization-code consumption and refresh rotation", () => {
  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const authorization = parseAuthorizationRequest({
    params: authorizationParams(challenge),
    registration,
    environment: "production",
  });
  const record = createAuthorizationCodeRecord({
    raw_code: "one-time-authorization-code",
    authorization,
    subject_id: subjectId,
    selected_club_id: clubA,
    now: new Date("2026-07-21T10:00:00.000Z"),
  });

  test("passes only hashes and PKCE evidence into an atomic code-consumption port", async () => {
    let received: Parameters<AuthorizationCodeStore["consume_authorization_code"]>[0] | undefined;
    const store: AuthorizationCodeStore = {
      consume_authorization_code: async (input) => {
        received = input;
        return { status: "consumed", record: { ...record, consumed_at: input.consumed_at } };
      },
    };
    const flow = new AuthorizationCodeFlow({
      store,
      now: () => new Date("2026-07-21T10:00:30.000Z"),
    });
    await expect(flow.consume({
      raw_code: "one-time-authorization-code",
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
      resource: "https://mcp.comvenio.app",
    })).resolves.toMatchObject({ consumed_at: "2026-07-21T10:00:30.000Z" });
    expect(received?.code_hash_sha256).toHaveLength(64);
    expect(JSON.stringify(received)).not.toContain("one-time-authorization-code");
    expect(received?.code_challenge_s256).toBe(challenge);
  });

  test("uses the fixed five-second refresh grace and revokes on replay outside it", async () => {
    const cache = new PositiveReadIntrospectionCache();
    const now = 1_774_000_100_000;
    const active = {
      active: true as const,
      sub: subjectId,
      grant_id: grantId,
      client_id: clientId,
      club_id: clubA,
      scope: "club.read event.read",
      aud: "https://mcp.comvenio.app" as const,
      iat: 1_774_000_000,
      exp: 1_774_003_600,
      jti: "66666666-6666-4666-8666-666666666666",
    };
    cache.put("access-token", active, now);
    let rotationInput: Parameters<RefreshRotationStore["rotate_refresh_family"]>[0] | undefined;
    const rotatedStore: RefreshRotationStore = {
      rotate_refresh_family: async (input) => {
        rotationInput = input;
        return { status: "rotated", grant_id: grantId };
      },
    };
    const rotated = new RefreshRotationFlow({
      store: rotatedStore,
      cache,
      now: () => new Date(now),
    });
    await expect(rotated.rotate({
      old_refresh_token: "old-opaque-refresh",
      new_refresh_token: "new-opaque-refresh",
    })).resolves.toEqual({ grant_id: grantId, grace_replay: false });
    expect(rotationInput).toMatchObject({ grace_seconds: 5, inactivity_ttl_seconds: 2_592_000 });
    expect(JSON.stringify(rotationInput)).not.toContain("opaque-refresh");

    const replayStore: RefreshRotationStore = {
      rotate_refresh_family: async () => ({ status: "reuse_revoked", grant_id: grantId }),
    };
    const replay = new RefreshRotationFlow({
      store: replayStore,
      cache,
      now: () => new Date(now),
    });
    await expect(replay.rotate({
      old_refresh_token: "reused-opaque-refresh",
      new_refresh_token: "replacement-opaque-refresh",
    })).rejects.toThrow("Refresh-Familie wurde widerrufen");
    expect(cache.get("access-token", "read", now)).toBeNull();
  });
});

describe("club selection and connector grants", () => {
  test("binds one club automatically and requires explicit selection for multiple clubs", () => {
    expect(createClubSelectionContext({
      eligible_club_ids: [clubA],
      request_id: requestId,
    })).toEqual({
      eligible_club_ids: [clubA],
      selected_club_id: clubA,
      selection_mode: "automatic_single_club",
    });
    expect(() => createClubSelectionContext({
      eligible_club_ids: [clubA, clubB],
      request_id: requestId,
    })).toThrow("Bitte wähle den Verein");
    expect(createClubSelectionContext({
      eligible_club_ids: [clubA, clubB],
      selected_club_id: clubB,
      request_id: requestId,
    }).selected_club_id).toBe(clubB);
  });

  test("binds subject, client, provider, scopes and exactly one private club", () => {
    const grant: ConnectorGrant = {
      grant_id: grantId,
      subject_id: subjectId,
      client_id: clientId,
      provider: "openai",
      selected_club_id: clubA,
      scopes: ["event.read", "club.read"],
      created_at: "2026-07-21T10:00:00.000Z",
      last_used_at: "2026-07-21T10:00:00.000Z",
      expires_at: "2026-08-20T10:00:00.000Z",
      revoked_at: null,
    };
    expect(validateConnectorGrant(grant, registration).scopes).toEqual(["club.read", "event.read"]);
    expect(() => validateConnectorGrant({ ...grant, selected_club_id: null }, registration))
      .toThrow("privater Grant benötigt einen Verein");
    expect(listOwnConnectorGrants([
      grant,
      { ...grant, grant_id: "77777777-7777-4777-8777-777777777777", subject_id: clubB },
    ], subjectId)).toEqual([grant]);
  });
});

describe("CIMD SSRF and release pinning", () => {
  const documentBody = new TextEncoder().encode(JSON.stringify({
    client_id: clientId,
    client_name: "Comvenio OpenAI Test Client",
    redirect_uris: [redirectUri],
    token_endpoint_auth_methods_supported: ["none"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }));
  const pin: CimdClientPin = {
    client_id: clientId,
    provider: "openai",
    metadata_sha256: createHash("sha256").update(documentBody).digest("hex"),
    allowed_scopes: ["club.read", "event.read"],
    enabled: true,
  };

  function dependencies(overrides: Partial<CimdResolverDependencies> = {}): CimdResolverDependencies {
    return {
      resolve_dns: async () => ["93.184.216.34"],
      fetch_document: async (_url, addresses, timeout) => {
        expect(addresses).toEqual(["93.184.216.34"]);
        expect(timeout).toBe(3000);
        return {
          status: 200,
          content_type: "application/json; charset=utf-8",
          body: documentBody,
          redirected: false,
        };
      },
      now: () => Date.parse("2026-07-21T10:00:00.000Z"),
      ...overrides,
    };
  }

  test("resolves only pinned HTTPS metadata with public DNS and exact fingerprint", async () => {
    const resolver = new HardenedCimdResolver([pin], dependencies());
    await expect(resolver.resolve({ client_id: clientId, redirect_uri: redirectUri }))
      .resolves.toMatchObject({
        client_id: clientId,
        provider: "openai",
        allowed_scopes: ["club.read", "event.read"],
        token_endpoint_auth_method: "none",
        pkce_method: "S256",
      });
    expect(isForbiddenCimdIpAddress("127.0.0.1")).toBe(true);
    expect(isForbiddenCimdIpAddress("10.0.0.1")).toBe(true);
    expect(isForbiddenCimdIpAddress("::1")).toBe(true);
    expect(isForbiddenCimdIpAddress("93.184.216.34")).toBe(false);
  });

  test("accepts standard singular auth metadata and exact loopback inspector redirects", async () => {
    const loopback = "http://127.0.0.1:6274/oauth/callback";
    const body = new TextEncoder().encode(JSON.stringify({
      client_id: clientId,
      client_name: "Claude Inspector",
      redirect_uris: [redirectUri, loopback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }));
    const resolver = new HardenedCimdResolver([{
      ...pin,
      provider: "anthropic",
      metadata_sha256: createHash("sha256").update(body).digest("hex"),
      allowed_scopes: ["public.read", "club.read"],
    }], dependencies({
      fetch_document: async () => ({
        status: 200,
        content_type: "application/json",
        body,
        redirected: false,
      }),
    }));
    await expect(resolver.resolve({ client_id: clientId, redirect_uri: loopback }))
      .resolves.toMatchObject({
        provider: "anthropic",
        redirect_uris: [loopback, redirectUri].sort(),
        allowed_scopes: ["club.read", "public.read"],
      });
  });

  test("rejects remote HTTP redirects and never trusts client-declared scopes", async () => {
    const body = new TextEncoder().encode(JSON.stringify({
      client_id: clientId,
      client_name: "Untrusted Client",
      redirect_uris: ["http://attacker.example/callback"],
      token_endpoint_auth_method: "none",
      allowed_scopes: ["admin.write"],
    }));
    const resolver = new HardenedCimdResolver([{
      ...pin,
      metadata_sha256: createHash("sha256").update(body).digest("hex"),
      allowed_scopes: ["club.read"],
    }], dependencies({
      fetch_document: async () => ({
        status: 200,
        content_type: "application/json",
        body,
        redirected: false,
      }),
    }));
    await expect(resolver.resolve({
      client_id: clientId,
      redirect_uri: "http://attacker.example/callback",
    })).rejects.toThrow("Redirect-URI");
  });

  test("rejects private DNS, redirects, fingerprint drift and incomplete release pins", async () => {
    const privateDns = new HardenedCimdResolver([pin], dependencies({
      resolve_dns: async () => ["10.0.0.5"],
    }));
    await expect(privateDns.resolve({ client_id: clientId, redirect_uri: redirectUri }))
      .rejects.toThrow("nicht erreichbar");
    const redirected = new HardenedCimdResolver([pin], dependencies({
      fetch_document: async () => ({
        status: 200,
        content_type: "application/json",
        body: documentBody,
        redirected: true,
      }),
    }));
    await expect(redirected.resolve({ client_id: clientId, redirect_uri: redirectUri }))
      .rejects.toThrow("ungültig");
    const wrongPin = new HardenedCimdResolver([{ ...pin, metadata_sha256: "f".repeat(64) }], dependencies());
    await expect(wrongPin.resolve({ client_id: clientId, redirect_uri: redirectUri }))
      .rejects.toThrow("Fingerprint");
    expect(() => assertCimdReleaseReady([pin])).toThrow("nicht releasebereit");
    const releasePins = JSON.parse(readFileSync(resolve(
      import.meta.dir,
      "../../../integrations/release/cimd-client-allowlist.v1.json",
    ), "utf8")) as {
      contract_version: string;
      release_state: string;
      pins: CimdClientPin[];
      notice: string;
    };
    expect(releasePins.contract_version).toBe("1.0.0");
    expect(releasePins.release_state).toBe("BLOCKED");
    expect(releasePins.pins).toHaveLength(1);
    const releasePin = releasePins.pins[0]!;
    expect(releasePin.provider).toBe("openai");
    expect(releasePin.enabled).toBe(true);
    expect(releasePin.allowed_scopes).toEqual(["club.read", "task.read"]);
    expect(releasePin.client_id).toMatch(/^https:\/\/chatgpt\.com\/oauth\//u);
    expect(releasePin.metadata_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(releasePins.notice).not.toContain("*");
  });
});

describe("revocation and bounded introspection caching", () => {
  const accessToken = "opaque-connector-access-token";
  const active = {
    active: true as const,
    sub: subjectId,
    grant_id: grantId,
    client_id: clientId,
    club_id: clubA,
    scope: "club.read event.read",
    aud: "https://mcp.comvenio.app" as const,
    iat: 1_774_000_000,
    exp: 1_774_003_600,
    jti: "66666666-6666-4666-8666-666666666666",
  };

  test("never caches writes and caps positive private reads at five seconds", () => {
    const cache = new PositiveReadIntrospectionCache();
    const now = 1_774_000_100_000;
    cache.put(accessToken, active, now);
    expect(cache.get(accessToken, "write", now)).toBeNull();
    expect(cache.get(accessToken, "read", now + 4_999)).toEqual(active);
    expect(cache.get(accessToken, "read", now + 5_001)).toBeNull();
    cache.put(accessToken, { active: false }, now);
    expect(cache.get(accessToken, "read", now)).toBeNull();
    expect(() => cache.put(accessToken, { ...active, email: "private@example.com" }, now))
      .toThrow("Introspection-Antwort ist ungültig");
  });

  test("revokes atomically through hashes and clears cached grant tokens", async () => {
    const cache = new PositiveReadIntrospectionCache();
    const now = 1_774_000_100_000;
    cache.put(accessToken, active, now);
    let persistedHash = "";
    const store: RevocationStore = {
      revoke_token_family: async (input) => {
        persistedHash = input.token_hash_sha256;
        return { grant_id: grantId };
      },
      revoke_owned_grant: async () => "revoked",
    };
    const flow = new RevocationFlow({
      store,
      cache,
      now: () => new Date(now),
    });
    await flow.revokeToken({ raw_token: accessToken, client_id: clientId });
    expect(persistedHash).toHaveLength(64);
    expect(persistedHash).not.toContain(accessToken);
    expect(cache.get(accessToken, "read", now)).toBeNull();
  });
});
