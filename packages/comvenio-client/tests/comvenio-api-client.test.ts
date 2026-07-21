import { describe, expect, test } from "bun:test";

import {
  createComvenioApiClient,
  isConnectorError,
  type ClientTelemetryEvent,
  type RequestContext,
} from "@comvenio/comvenio-client";

const cliContext: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "cli",
  provider: null,
  subject_id: "22222222-2222-4222-8222-222222222222",
  oauth_grant_id: null,
  club_id: "33333333-3333-4333-8333-333333333333",
  department_id: null,
  scopes: ["club.read"],
  capability_version: null,
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

const mcpContext: RequestContext = {
  ...cliContext,
  request_id: "44444444-4444-4444-8444-444444444444",
  surface: "mcp",
  provider: "anthropic",
  oauth_grant_id: "55555555-5555-4555-8555-555555555555",
};

describe("ComvenioApiClient", () => {
  test("uses the normative 15-second timeout", () => {
    const client = createComvenioApiClient({ gatewayBaseUrl: "https://api.comvenio.app" });
    expect(client.timeout_ms).toBe(15000);
  });

  test("rejects invalid configuration before network access", async () => {
    let fetchCalls = 0;
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "not-a-url" },
      { fetch: async () => {
        fetchCalls++;
        return new Response("{}");
      } },
    );

    try {
      await client.request({
        method: "GET",
        service: "club",
        path: "/clubs/current",
        context: cliContext,
      });
      throw new Error("Expected invalid configuration to fail");
    } catch (error) {
      expect(isConnectorError(error)).toBe(true);
      if (isConnectorError(error)) expect(error.code).toBe("CONFIG_INVALID");
    }
    expect(fetchCalls).toBe(0);
  });

  test("rejects invalid request bodies before network access", async () => {
    let fetchCalls = 0;
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: async () => {
        fetchCalls++;
        return new Response("{}");
      } },
    );

    await expect(client.request({
      method: "POST",
      service: "club",
      path: "/clubs/current",
      context: cliContext,
      body: { invalid_number: Number.NaN },
    })).rejects.toMatchObject({ code: "CONFIG_INVALID" });

    const cyclicBody: Record<string, unknown> = {};
    cyclicBody.self = cyclicBody;
    await expect(client.request({
      method: "POST",
      service: "club",
      path: "/clubs/current",
      context: cliContext,
      body: cyclicBody as never,
    })).rejects.toMatchObject({ code: "CONFIG_INVALID" });

    await expect(client.request({
      method: "POST",
      service: "club",
      path: "/clubs/current",
      context: cliContext,
      body: new Date() as never,
    })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(fetchCalls).toBe(0);
  });

  test("normalizes access-token provider failures without exposing details", async () => {
    const spoofedError = Object.assign(new Error("private identity provider detail"), {
      name: "ConnectorError",
      code: "PERMISSION_DENIED",
      request_id: cliContext.request_id,
      retryable: false,
    });
    const client = createComvenioApiClient({
      gatewayBaseUrl: "https://api.comvenio.app",
      accessToken: async () => {
        throw spoofedError;
      },
    });

    await expect(client.request({
      method: "GET",
      service: "club",
      path: "/clubs/current",
      context: cliContext,
    })).rejects.toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
      message: "Der Zugriffskontext konnte nicht geladen werden.",
      retryable: true,
    });
  });

  test("normalizes spoofed transport errors to a safe message", async () => {
    const spoofedError = Object.assign(new Error("private transport detail"), {
      name: "ConnectorError",
      code: "PERMISSION_DENIED",
      request_id: cliContext.request_id,
      retryable: false,
    });
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: async () => { throw spoofedError; } },
    );

    await expect(client.request({
      method: "POST",
      service: "club",
      path: "/clubs/current",
      context: cliContext,
    })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Der Comvenio-Dienst ist vorübergehend nicht erreichbar.",
    });
  });

  test("normalizes timeouts identically for CLI and MCP", async () => {
    const abortingFetch = async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: abortingFetch, sleep: async () => undefined },
    );

    for (const context of [cliContext, mcpContext]) {
      try {
        await client.request({
          method: "POST",
          service: "club",
          path: "/clubs/read-model",
          context,
          body: { club_id: context.club_id },
        });
        throw new Error("Expected timeout");
      } catch (error) {
        expect(isConnectorError(error)).toBe(true);
        if (isConnectorError(error)) {
          expect(error.code).toBe("UPSTREAM_TIMEOUT");
          expect(error.request_id).toBe(context.request_id);
        }
      }
    }
  });

  test("retries only GET on transient statuses and at most three times", async () => {
    let getCalls = 0;
    const getClient = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      {
        fetch: async () => {
          getCalls++;
          if (getCalls < 3) return new Response(null, { status: 503 });
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        },
        sleep: async () => undefined,
      },
    );
    await expect(getClient.request({
      method: "GET",
      service: "club",
      path: "/clubs/current",
      context: cliContext,
    })).resolves.toEqual({ status: "ok" });
    expect(getCalls).toBe(3);

    let mutationCalls = 0;
    const mutationClient = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      {
        fetch: async () => {
          mutationCalls++;
          return new Response(null, { status: 503 });
        },
        sleep: async () => undefined,
      },
    );
    await expect(mutationClient.request({
      method: "PATCH",
      service: "club",
      path: "/clubs/current",
      context: cliContext,
      body: { name: "Verein" },
    })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(mutationCalls).toBe(1);
  });

  test("keeps tokens, payloads and response data out of telemetry", async () => {
    const events: ClientTelemetryEvent[] = [];
    const client = createComvenioApiClient(
      {
        gatewayBaseUrl: "https://api.comvenio.app",
        accessToken: "cvn_super_secret_token",
        telemetry: (event) => events.push(event),
      },
      {
        fetch: async (_url, init) => {
          expect(new Headers(init?.headers).get("authorization"))
            .toBe("Bearer cvn_super_secret_token");
          return new Response(JSON.stringify({ private_value: "response-secret" }));
        },
      },
    );

    await client.request({
      method: "POST",
      service: "club",
      path: "/clubs/current",
      context: cliContext,
      body: { private_value: "request-secret" },
    });

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("cvn_super_secret_token");
    expect(serialized).not.toContain("request-secret");
    expect(serialized).not.toContain("response-secret");
    expect(events.at(-1)).toMatchObject({
      request_id: cliContext.request_id,
      outcome: "success",
      service: "club",
    });
  });
});
