// Machine grant (03-maschinen-grant): the CLI signs in from
// COMVENIO_CLIENT_ID and COMVENIO_CLIENT_SECRET with client credentials, keeps
// the token in memory only, and the MCP gateway accepts such a token on the
// CLI channel only (TC-09, AK-F-03; gateway side of TC-05).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MACHINE_GRANT_BLOCKED_SCOPES, isMachineGrantScope } from "@comvenio/connector-contracts";

import { fetchMachineAccessToken, oauthRuntime } from "../src/oauth/client.ts";
import {
  IntrospectionBearerAuthenticator,
  splitMachineIntrospection,
} from "../apps/mcp-server/src/http/auth.ts";
import type { ProviderRegistrationResolver } from "../apps/mcp-server/src/http/types.ts";
import { HttpIntrospectionPort } from "../apps/mcp-server/src/http/upstreams.ts";

const CLIENT_ID = "cvg_client_7f3a91";
const CLIENT_SECRET = "cvgs_nur_fuer_den_test";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("machine grant scopes", () => {
  test("the four blocked scopes are never machine scopes (D-GTA-07)", () => {
    expect([...MACHINE_GRANT_BLOCKED_SCOPES].sort())
      .toEqual(["admin.write", "connector.grants", "member.read.details", "role.write"]);
    for (const scope of MACHINE_GRANT_BLOCKED_SCOPES) expect(isMachineGrantScope(scope)).toBe(false);
    expect(isMachineGrantScope("finance.read")).toBe(true);
    expect(isMachineGrantScope("no.such.scope")).toBe(false);
  });
});

describe("client credentials request", () => {
  test("sends grant type, client id, secret and the CLI resource in the form body", async () => {
    const runtime = oauthRuntime("https://api.example.test", "https://mcp.example.test");
    const requests: Array<{ url: string; body: URLSearchParams }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: new URLSearchParams(String(init?.body)) });
      return Response.json({
        access_token: "machine-access-token",
        token_type: "Bearer",
        expires_in: 900,
        scope: "finance.read files.export",
      });
    }) as typeof fetch;

    const token = await fetchMachineAccessToken(runtime, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.example.test/auth/oauth/token");
    expect(Object.fromEntries(requests[0]!.body)).toEqual({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      resource: "https://mcp.example.test/cli",
    });
    expect(requests[0]!.url).not.toContain(CLIENT_SECRET);
    expect(token.accessToken).toBe("machine-access-token");
    expect(token.scopes).toEqual(["finance.read", "files.export"]);
  });

  test("rejects a token that carries a blocked scope", async () => {
    const runtime = oauthRuntime("https://api.example.test", "https://mcp.example.test");
    globalThis.fetch = (async () => Response.json({
      access_token: "machine-access-token",
      token_type: "Bearer",
      expires_in: 900,
      scope: "finance.read admin.write",
    })) as typeof fetch;

    await expect(fetchMachineAccessToken(runtime, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }))
      .rejects.toThrow("unzulässige Scopes");
  });

  test("invalid_client from the token endpoint fails without details", async () => {
    const runtime = oauthRuntime("https://api.example.test", "https://mcp.example.test");
    globalThis.fetch = (async () => Response.json({ error: "invalid_client" }, { status: 401 })) as typeof fetch;

    await expect(fetchMachineAccessToken(runtime, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }))
      .rejects.toThrow("invalid_client");
  });
});

// The state file lives in HOME, the credential store follows APPDATA ??
// USERPROFILE — all three are redirected so nothing real is read or written.
describe("CLI sign-in from the environment (TC-09)", () => {
  const redirected = ["HOME", "USERPROFILE", "APPDATA"] as const;
  const machineVars = ["COMVENIO_CLIENT_ID", "COMVENIO_CLIENT_SECRET", "COMVENIO_ENV"] as const;
  const saved: Record<string, string | undefined> = {};
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "comvenio-machine-"));
    for (const key of [...redirected, ...machineVars]) saved[key] = process.env[key];
    for (const key of redirected) process.env[key] = home;
    for (const key of machineVars) delete process.env[key];
  });
  afterEach(() => {
    for (const key of [...redirected, ...machineVars]) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    rmSync(home, { recursive: true, force: true });
  });

  const authModule = (mark: string) => import(`../src/auth.ts?${mark}=${encodeURIComponent(home)}`);

  test("without both variables there is no machine sign-in", async () => {
    const { machineGrantFromEnv } = await authModule("m0");
    expect(machineGrantFromEnv({})).toBeNull();
  });

  test("a missing variable is AUTH_REQUIRED and names it, never the value", async () => {
    const { AuthError, machineGrantFromEnv } = await authModule("m1");
    expect(() => machineGrantFromEnv({ COMVENIO_CLIENT_ID: CLIENT_ID }))
      .toThrow(/^COMVENIO_CLIENT_SECRET fehlt/u);
    expect(() => machineGrantFromEnv({ COMVENIO_CLIENT_SECRET: CLIENT_SECRET }))
      .toThrow(/^COMVENIO_CLIENT_ID fehlt/u);
    try {
      machineGrantFromEnv({ COMVENIO_CLIENT_SECRET: CLIENT_SECRET });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as Error).message).not.toContain(CLIENT_SECRET);
    }
    // errors.ts checks against the plain auth module, so the public code is
    // rendered from an error of that module.
    const { toPublicError } = await import("../src/errors.ts");
    const plain = await import("../src/auth.ts");
    let thrown: unknown;
    try {
      plain.machineGrantFromEnv({ COMVENIO_CLIENT_ID: CLIENT_ID });
    } catch (error) {
      thrown = error;
    }
    const rendered = toPublicError(thrown, { lang: "de" });
    expect(rendered.code).toBe("AUTH_REQUIRED");
    expect(rendered.detail).toContain("COMVENIO_CLIENT_SECRET");
  });

  test("values without the machine prefixes are refused before any request", async () => {
    const { machineGrantFromEnv } = await authModule("m2");
    expect(() => machineGrantFromEnv({ COMVENIO_CLIENT_ID: "abc", COMVENIO_CLIENT_SECRET: CLIENT_SECRET }))
      .toThrow(/COMVENIO_CLIENT_ID ist keine Client-ID/u);
    expect(() => machineGrantFromEnv({ COMVENIO_CLIENT_ID: CLIENT_ID, COMVENIO_CLIENT_SECRET: "cvn_geraet" }))
      .toThrow(/COMVENIO_CLIENT_SECRET ist kein Secret/u);
    expect(() => machineGrantFromEnv({
      COMVENIO_CLIENT_ID: CLIENT_ID,
      COMVENIO_CLIENT_SECRET: CLIENT_SECRET,
      COMVENIO_ENV: "local",
    })).toThrow(/COMVENIO_ENV/u);
  });

  test("loadState signs in without browser, state file or credential store and reuses the token", async () => {
    const { loadState, resetMachineTokenCache, STATE_FILE } = await authModule("m3");
    resetMachineTokenCache();
    process.env.COMVENIO_CLIENT_ID = CLIENT_ID;
    process.env.COMVENIO_CLIENT_SECRET = CLIENT_SECRET;
    process.env.COMVENIO_ENV = "dev";
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return Response.json({
        access_token: "machine-access-token",
        token_type: "Bearer",
        expires_in: 900,
        scope: "event.read",
      });
    }) as typeof fetch;

    const first = await loadState();
    const second = await loadState();

    expect(urls).toEqual(["https://apidev.comvenio.app/auth/oauth/token"]);
    expect(first.machineGrant).toBe(true);
    expect(first.authMode).toBe("oauth");
    expect(first).not.toHaveProperty("token");
    expect(first.connectorToken).toBe("machine-access-token");
    expect(first.oauth).toEqual({
      clientId: CLIENT_ID,
      resource: "https://mcpdev.comvenio.app/cli",
      scopes: ["event.read"],
    });
    expect(second.connectorToken).toBe("machine-access-token");
    expect(existsSync(STATE_FILE)).toBe(false);
  });

  test("a rejected grant becomes AUTH_REQUIRED with the hint to the club settings", async () => {
    const { AuthError, loadState, resetMachineTokenCache } = await authModule("m4");
    resetMachineTokenCache();
    process.env.COMVENIO_CLIENT_ID = CLIENT_ID;
    process.env.COMVENIO_CLIENT_SECRET = CLIENT_SECRET;
    globalThis.fetch = (async () => Response.json({ error: "invalid_client" }, { status: 401 })) as typeof fetch;

    const failure = loadState();
    await expect(failure).rejects.toBeInstanceOf(AuthError);
    await expect(loadState()).rejects.toThrow(/Automation/u);
  });
});

describe("MCP gateway: machine tokens", () => {
  const SUBJECT = "7f2a9c1e-1d2b-4c3d-8e4f-5a6b7c8d9e0f";
  const GRANT = "3c1e9c1e-1d2b-4c3d-8e4f-5a6b7c8d9e0f";
  const CLUB = "9a1e9c1e-1d2b-4c3d-8e4f-5a6b7c8d9e0f";
  const JTI = "5b1e9c1e-1d2b-4c3d-8e4f-5a6b7c8d9e0f";
  const CLI_AUDIENCE = "https://mcp.example.test/cli" as const;
  const now = new Date("2026-09-29T08:00:00Z");
  const nowSeconds = Math.floor(now.getTime() / 1_000);

  function machineIntrospection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      active: true,
      sub: SUBJECT,
      grant_id: GRANT,
      client_id: CLIENT_ID,
      client_kind: "machine",
      club_id: CLUB,
      scope: "event.read finance.read",
      aud: CLI_AUDIENCE,
      iat: nowSeconds - 10,
      exp: nowSeconds + 900,
      jti: JTI,
      ...overrides,
    };
  }

  const noRegistrations: ProviderRegistrationResolver = {
    async resolve() {
      throw new Error("a machine token must not reach the provider registrations");
    },
  };

  function authenticator(result: unknown, acceptMachine: boolean) {
    return new IntrospectionBearerAuthenticator({
      introspection: { introspect: async () => result },
      registrations: noRegistrations,
      actor_tokens: {
        exchange: async () => ({ access_token: "backend-actor-token-xyz", token_type: "Bearer", expires_in: 300 }),
      },
      audience: CLI_AUDIENCE,
      accept_machine_clients: acceptMachine,
      now: () => now,
    });
  }

  const call = (auth: IntrospectionBearerAuthenticator) => auth.authenticate({
    raw_token: "machine-access-token",
    request_id: "1b1e9c1e-1d2b-4c3d-8e4f-5a6b7c8d9e0f",
    environment: "development",
    risk: "read",
  });

  test("the CLI channel accepts a machine token and acts as the creating person", async () => {
    const principal = await call(authenticator(machineIntrospection(), true));
    expect(principal.client_id).toBe(CLIENT_ID);
    expect(principal.provider).toBeNull();
    expect(principal.subject_id).toBe(SUBJECT);
    expect(principal.club_id).toBe(CLUB);
    expect(principal.scopes).toEqual(["event.read", "finance.read"]);
    expect(principal.backend_actor_token).toBe("backend-actor-token-xyz");
  });

  test("the provider connector rejects a machine token", async () => {
    await expect(call(authenticator(machineIntrospection(), false)))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  test("a blocked scope on a machine token is rejected", async () => {
    await expect(call(authenticator(machineIntrospection({ scope: "admin.write event.read" }), true)))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  test("a machine token without a club or with a foreign client id is rejected", async () => {
    await expect(call(authenticator(machineIntrospection({ client_id: "https://evil.example.test/" }), true)))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(call(authenticator(machineIntrospection({ client_kind: "robot" }), true)))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(call(authenticator(machineIntrospection({ club_id: null, scope: "public.read" }), true)))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  test("the introspection port hands a machine answer through and never caches it", async () => {
    let calls = 0;
    const port = new HttpIntrospectionPort({
      auth_base_url: "https://api.example.test/auth",
      internal_api_key: "internal-test-key",
      fetch: async () => {
        calls += 1;
        return Response.json(machineIntrospection());
      },
      now: () => now.getTime(),
    });
    const request = {
      raw_token: "machine-access-token",
      request_id: "2b1e9c1e-1d2b-4c3d-8e4f-5a6b7c8d9e0f",
      audience: CLI_AUDIENCE,
      force_fresh: false,
    };
    expect(await port.introspect(request)).toMatchObject({ client_kind: "machine", client_id: CLIENT_ID });
    await port.introspect(request);
    expect(calls).toBe(2);
  });

  test("an answer without the machine marker passes through unchanged", () => {
    const plain = { active: false };
    expect(splitMachineIntrospection(plain)).toEqual({ result: plain, machine_client_id: null });
  });
});

describe("SCOPE_REQUIRED with a machine grant", () => {
  test("points to a new grant instead of a new sign-in", async () => {
    const { toPublicError, PublicCliError } = await import("../src/errors.ts");
    const error = new PublicCliError("SCOPE_REQUIRED", "scope missing", { required_scopes: ["event.write"] });
    const rendered = toPublicError(error, { lang: "de", machine_grant: true });
    expect(rendered.next_command).toBeNull();
    expect(rendered.detail).toContain("event.write");
    expect(rendered.detail).toContain("Automation");
    expect(toPublicError(error, { lang: "de" }).next_command).toContain("comvenio login");
  });
});

describe("AUTH_REQUIRED with a machine grant", () => {
  test("names no comvenio login: a revoked or unknown grant is fixed in the club settings", async () => {
    const { toPublicError } = await import("../src/errors.ts");
    const { AuthError } = await import("../src/auth.ts");
    const error = new AuthError("Der Maschinen-Grant ist unbekannt, widerrufen oder abgelaufen. Prüfe ihn in den Vereinseinstellungen unter „Automation“.");
    const rendered = toPublicError(error, { lang: "de", machine_grant: true });
    expect(rendered.code).toBe("AUTH_REQUIRED");
    expect(rendered.next_command).toBeNull();
    expect(rendered.detail).toContain("Automation");
    expect(toPublicError(error, { lang: "de" }).next_command).toContain("comvenio login");
  });
});
