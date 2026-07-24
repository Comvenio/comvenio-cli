import { afterEach, describe, expect, test } from "bun:test";

import {
  loginWithOAuth,
  oauthRuntime,
  refreshOAuthCredentials,
} from "../src/oauth/client.ts";
import {
  CliConnectorClient,
  connectorActionToolName,
  connectorToolActionId,
} from "../src/mcp/client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("native CLI OAuth", () => {
  test("derives a dedicated public client and CLI MCP resource", () => {
    const runtime = oauthRuntime("https://api.comvenio.app/");

    expect(runtime).toMatchObject({
      gatewayBaseUrl: "https://api.comvenio.app",
      connectorBaseUrl: "https://mcp.comvenio.app",
      issuer: "https://api.comvenio.app/auth",
      clientId: "https://api.comvenio.app/auth/oauth/clients/comvenio-cli",
      resource: "https://mcp.comvenio.app/cli",
    });
    expect(runtime.scopes).toEqual(["club.read", "role.read.self"]);
  });

  test("rejects insecure or ambiguous gateways for interactive OAuth", () => {
    expect(() => oauthRuntime("http://localhost:8000")).toThrow("HTTPS-Origin");
    expect(() => oauthRuntime("https://api.example.test")).toThrow("--connector");
    expect(() => oauthRuntime(
      "https://api.example.test",
      "https://mcp.example.test",
      [],
    )).toThrow("Scopes");
  });

  test("uses PKCE, exact loopback callback and never requests an actor token", async () => {
    const runtime = oauthRuntime(
      "https://api.example.test",
      "https://mcp.example.test",
      ["club.read", "event.read"],
    );
    let authorizationUrl: URL | undefined;
    const requests: Array<{ url: string; body: URLSearchParams }> = [];

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const body = new URLSearchParams(String(init?.body ?? ""));
      requests.push({ url, body });
      if (url.endsWith("/oauth/token")) {
        return Response.json({
          access_token: "connector-access",
          token_type: "Bearer",
          expires_in: 900,
          refresh_token: "connector-refresh",
          scope: runtime.scopes.join(" "),
        });
      }
      return new Response("unexpected request", { status: 500 });
    }) as typeof fetch;

    const credentials = await loginWithOAuth(runtime, (rawUrl) => {
      authorizationUrl = new URL(rawUrl);
      const callback = new URL(
        authorizationUrl.searchParams.get("redirect_uri") as string,
      );
      callback.searchParams.set("code", "authorization-code");
      callback.searchParams.set(
        "state",
        authorizationUrl.searchParams.get("state") as string,
      );
      setTimeout(() => {
        void originalFetch(callback);
      }, 0);
    });

    expect(authorizationUrl?.searchParams.get("client_id")).toBe(runtime.clientId);
    expect(authorizationUrl?.searchParams.get("resource")).toBe(runtime.resource);
    expect(authorizationUrl?.searchParams.get("scope")).toBe("club.read event.read");
    expect(authorizationUrl?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl?.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/u,
    );
    expect(requests[0]?.body.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
    expect(requests[0]?.body.get("resource")).toBe(runtime.resource);
    expect(requests).toHaveLength(1);
    expect(credentials).toEqual({
      accessToken: "connector-access",
      refreshToken: "connector-refresh",
      accessExpiresAt: expect.any(Number),
    });
  });

  test("rejects a token response that widens or drops the requested scopes", async () => {
    const runtime = oauthRuntime(
      "https://api.example.test",
      "https://mcp.example.test",
      ["club.read"],
    );
    globalThis.fetch = (async () => Response.json({
      access_token: "connector-access-token",
      token_type: "Bearer",
      expires_in: 900,
      refresh_token: "connector-refresh-token",
      scope: "club.read admin.write",
    })) as typeof fetch;

    await expect(refreshOAuthCredentials(runtime, {
      accessToken: "old-connector-access",
      refreshToken: "old-connector-refresh",
      accessExpiresAt: Date.now() - 1,
    })).rejects.toThrow("abweichende Scopes");
  });

  test("calls only deterministic canonical action tools over the CLI MCP resource", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const connector = new CliConnectorClient({
      endpoint: "https://mcp.example.test/cli",
      access_token: "opaque-connector-access-token",
      fetch: (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push(body);
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [],
            structuredContent: {
              action_id: "cai.event.01.list",
              status: "completed",
              result: { items: [] },
            },
          },
        });
      }) as typeof fetch,
    });
    const result = await connector.callAction({
      action_id: "cai.event.01.list",
      input: {
        range: {
          from: "2026-07-24",
          to: "2026-07-31",
          timezone: "Europe/Berlin",
          from_inclusive: true,
          to_exclusive: true,
        },
      },
    });

    expect(connectorActionToolName("cai.event.01.list")).toBe("cv_event_01_list");
    expect(requests[0]).toEqual(expect.objectContaining({
      method: "tools/call",
      params: {
        name: "cv_event_01_list",
        arguments: {
          input: {
            range: {
              from: "2026-07-24",
              to: "2026-07-31",
              timezone: "Europe/Berlin",
              from_inclusive: true,
              to_exclusive: true,
            },
          },
        },
      },
    }));
    expect(result.status).toBe("completed");
  });

  test("reads canonical action identity only from namespaced server metadata", () => {
    expect(connectorToolActionId({
      name: "cv_event_01_list",
      _meta: { "comvenio/actionId": "cai.event.01.list" },
    })).toBe("cai.event.01.list");
    expect(connectorToolActionId({
      name: "cv_event_01_list",
      _meta: { "comvenio/actionId": "event.list" },
    })).toBeNull();
    expect(connectorToolActionId({
      name: "cv_whoami_read",
    })).toBeNull();
  });
});
