import { describe, expect, test } from "bun:test";

import {
  createComvenioApiClient,
  isConnectorError,
  type RequestContext,
} from "@comvenio/comvenio-client";
import { publicErrorCode } from "@comvenio/connector-contracts";

const context: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "mcp",
  provider: "anthropic",
  subject_id: "22222222-2222-4222-8222-222222222222",
  oauth_grant_id: "55555555-5555-4555-8555-555555555555",
  club_id: "33333333-3333-4333-8333-333333333333",
  department_id: null,
  scopes: ["club.read", "admin.write"],
  capability_version: null,
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isConnectorError(error)) return error;
    throw error;
  }
  throw new Error("Expected a connector error");
}

describe("ComvenioApiClient public error mapping", () => {
  test("a 403 for a missing scope becomes SCOPE_REQUIRED with that scope (incident 2026-09-28)", async () => {
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: async () => new Response(
        JSON.stringify({ detail: "insufficient_scope", required_scope: "club.write" }),
        { status: 403 },
      ) },
    );
    const error = await failure(client.request({
      method: "POST",
      service: "ai",
      path: "/function-runs",
      context,
      body: {},
    }));
    expect(error.code).toBe("SCOPE_REQUIRED");
    expect(error.required_scope).toBe("club.write");
  });

  test("any other 403 stays PERMISSION_DENIED", async () => {
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: async () => new Response(JSON.stringify({ detail: "forbidden" }), { status: 403 }) },
    );
    const error = await failure(client.request({ method: "GET", service: "club", path: "/clubs/current", context }));
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.required_scope).toBeUndefined();
  });

  test("a coded object detail shows code, message and the tab ids that are ids (community-hub 14 TC-05)", async () => {
    const tabId = "88888888-8888-4888-8888-888888888888";
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: async () => new Response(JSON.stringify({ detail: { code: "TAB_VERSION_CONFLICT", message: "TAB_VERSION_CONFLICT: geändert", tabs: [{ tab_id: tabId }, { tab_id: "<script>" }] } }), { status: 409 }) },
    );
    const error = await failure(client.request({ method: "GET", service: "club", path: "/clubs/current", context }));
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toContain(`TAB_VERSION_CONFLICT: geändert (Tabs: ${tabId})`);
    expect(error.message).not.toContain("<script>");
  });

  test("an object detail without an error code keeps the generic message", async () => {
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: async () => new Response(JSON.stringify({ detail: { message: "internal row 42 of tenant x" } }), { status: 409 }) },
    );
    const error = await failure(client.request({ method: "GET", service: "club", path: "/clubs/current", context }));
    expect(error.message).toBe("Der Comvenio-Dienst hat die Anfrage abgelehnt.");
  });

  test("an unknown scope name in the 403 body is not trusted", async () => {
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: async () => new Response(
        JSON.stringify({ detail: "insufficient_scope", required_scope: "root.everything" }),
        { status: 403 },
      ) },
    );
    const error = await failure(client.request({ method: "GET", service: "club", path: "/clubs/current", context }));
    expect(error.code).toBe("PERMISSION_DENIED");
  });

  test("a write that times out is reported as OUTCOME_UNKNOWN, a read as retryable timeout", async () => {
    const abortingFetch = async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };
    const client = createComvenioApiClient(
      { gatewayBaseUrl: "https://api.comvenio.app" },
      { fetch: abortingFetch, sleep: async () => undefined },
    );
    const write = await failure(client.request({
      method: "POST",
      service: "ai",
      path: "/function-runs",
      context,
      body: {},
    }));
    expect(write.code).toBe("UPSTREAM_TIMEOUT");
    expect(publicErrorCode(write)).toBe("OUTCOME_UNKNOWN");
    const read = await failure(client.request({ method: "GET", service: "club", path: "/clubs/current", context }));
    expect(publicErrorCode(read)).toBe("UPSTREAM_TIMEOUT");
  });
});
