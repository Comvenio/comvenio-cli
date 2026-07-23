import { afterEach, describe, expect, test } from "bun:test";

import {
  createMcpDeploymentCandidate,
  readMcpProcessConfig,
} from "../src/bootstrap.ts";
import type { McpHttpServer } from "../src/http/server.ts";
import { NEWS_WIDGET_ASSET_PATH } from "../src/widgets/news/resource.ts";

let activeServer: McpHttpServer | null = null;

afterEach(async () => {
  if (activeServer) await activeServer.drain(2_000);
  activeServer = null;
});

describe("production MCP process bootstrap", () => {
  test("derives a strict production host allowlist and Railway port", () => {
    expect(readMcpProcessConfig({
      PORT: "8080",
      RAILWAY_PUBLIC_DOMAIN: "comvenio-cli-production.up.railway.app",
      MCP_PUBLIC_ORIGIN: "https://mcp.comvenio.app",
      MCP_EDGE_SHARED_SECRET: "test-only-mcp-edge-secret-32-characters",
      INTERNAL_API_KEY: "test-internal-key",
      MCP_PROD_ALLOWED_HOSTS: "mcp-review.comvenio.app",
      MCP_PROD_ALLOWED_ORIGINS: "https://chatgpt.com,https://claude.ai",
    })).toEqual({
      environment: "production",
      host: "0.0.0.0",
      port: 8080,
      public_origin: "https://mcp.comvenio.app",
      edge_shared_secret: "test-only-mcp-edge-secret-32-characters",
      api_base_url: "https://api.comvenio.app",
      auth_base_url: "https://api.comvenio.app/auth",
      internal_api_key: "test-internal-key",
      openai_apps_challenge_token: null,
      release_scope: "personal_productivity_v1",
      cimd_client_pins: expect.objectContaining({
        contract_version: "1.0.0",
        release_state: "BLOCKED",
        pins: [
          expect.objectContaining({
            provider: "openai",
            enabled: true,
            allowed_scopes: ["club.read", "task.read"],
          }),
        ],
      }),
      allowed_hosts: [
        "mcp.comvenio.app",
        "comvenio-cli-production.up.railway.app",
        "healthcheck.railway.app",
        "mcp-review.comvenio.app",
      ],
      allowed_origins: ["https://chatgpt.com", "https://claude.ai"],
    });
  });

  test("rejects invalid ports and duplicate allowlist entries", () => {
    expect(() => readMcpProcessConfig({
      PORT: "0",
      MCP_PUBLIC_ORIGIN: "https://mcp.comvenio.app",
      MCP_EDGE_SHARED_SECRET: "test-only-mcp-edge-secret-32-characters",
      INTERNAL_API_KEY: "test-internal-key",
    })).toThrow("PORT");
    expect(() => readMcpProcessConfig({
      MCP_PUBLIC_ORIGIN: "https://mcp.comvenio.app",
      MCP_EDGE_SHARED_SECRET: "test-only-mcp-edge-secret-32-characters",
      INTERNAL_API_KEY: "test-internal-key",
      MCP_PROD_ALLOWED_HOSTS: "mcp.example.test,mcp.example.test",
    })).toThrow("doppelte");
    expect(() => readMcpProcessConfig({
      MCP_PUBLIC_ORIGIN: "https://mcp.comvenio.app",
      MCP_EDGE_SHARED_SECRET: "test-only-mcp-edge-secret-32-characters",
      INTERNAL_API_KEY: "test-internal-key",
      MCP_RELEASE_SCOPE: "all",
    })).toThrow("MCP_RELEASE_SCOPE");
  });

  test("requires a strong edge secret in production", () => {
    expect(() => readMcpProcessConfig({
      MCP_PUBLIC_ORIGIN: "https://mcp.comvenio.app",
      INTERNAL_API_KEY: "test-internal-key",
    })).toThrow("MCP_EDGE_SHARED_SECRET");
    expect(() => readMcpProcessConfig({
      MCP_PUBLIC_ORIGIN: "https://mcp.comvenio.app",
      MCP_EDGE_SHARED_SECRET: "too-short",
      INTERNAL_API_KEY: "test-internal-key",
    })).toThrow("MCP_EDGE_SHARED_SECRET");
  });

  test("starts on TCP, serves health and OAuth metadata, and stays fail-closed", async () => {
    activeServer = createMcpDeploymentCandidate({
      environment: "production",
      host: "0.0.0.0",
      port: 8080,
      public_origin: "https://mcp.comvenio.app",
      edge_shared_secret: "test-only-mcp-edge-secret-32-characters",
      api_base_url: "https://api.comvenio.app",
      auth_base_url: "https://api.comvenio.app/auth",
      internal_api_key: "test-internal-key",
      openai_apps_challenge_token: "openai-domain-proof-token",
      cimd_client_pins: { contract_version: "1.0.0", release_state: "BLOCKED", pins: [] },
      release_scope: "personal_productivity_v1",
      allowed_hosts: ["127.0.0.1", "healthcheck.railway.app"],
      allowed_origins: [],
    });
    const address = await activeServer.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const railwayHealth = await fetch(`${base}/health`, {
      headers: { host: "healthcheck.railway.app" },
    });
    expect(railwayHealth.status).toBe(200);

    const rejectedHost = await fetch(`${base}/health`, {
      headers: { host: "attacker.example" },
    });
    expect(rejectedHost.status).toBe(403);

    const directMetadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(directMetadata.status).toBe(403);

    const edgeHeaders = { "x-comvenio-edge-secret": "test-only-mcp-edge-secret-32-characters" };
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`, {
      headers: edgeHeaders,
    });
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toEqual(expect.objectContaining({
      resource: "https://mcp.comvenio.app",
      authorization_servers: ["https://api.comvenio.app/auth"],
      resource_documentation: "https://www.comvenio.app/datenschutz",
    }));

    const challenge = await fetch(`${base}/.well-known/openai-apps-challenge`, {
      headers: edgeHeaders,
    });
    expect(challenge.status).toBe(200);
    expect(challenge.headers.get("cache-control")).toBe("no-store");
    expect(await challenge.text()).toBe("openai-domain-proof-token");

    const directWidgetAsset = await fetch(`${base}${NEWS_WIDGET_ASSET_PATH}`);
    expect(directWidgetAsset.status).toBe(403);
    const widgetAsset = await fetch(`${base}${NEWS_WIDGET_ASSET_PATH}`, { headers: edgeHeaders });
    expect(widgetAsset.status).toBe(200);

    const readiness = await fetch(`${base}/ready`, { headers: edgeHeaders });
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toEqual({ status: "not_ready" });

    const initialize = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...edgeHeaders,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "bootstrap-contract-test", version: "1.0.0" },
        },
      }),
    });
    expect(initialize.status).toBe(200);
    expect(await initialize.json()).toEqual(expect.objectContaining({
      jsonrpc: "2.0",
      id: 1,
      result: expect.objectContaining({
        serverInfo: { name: "comvenio-mcp-server", version: "1.0.0" },
      }),
    }));

    const resources = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...edgeHeaders,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/list", params: {} }),
    });
    expect(resources.status).toBe(200);
    expect(await resources.json()).toMatchObject({
      result: {
        resources: [
          { uri: "ui://comvenio/event-calendar" },
          { uri: "ui://comvenio/news" },
        ],
      },
    });

    const widget = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...edgeHeaders,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "ui://comvenio/news" },
      }),
    });
    expect(widget.status).toBe(200);
    expect(await widget.json()).toMatchObject({
      result: {
        contents: [{
          uri: "ui://comvenio/news",
          mimeType: "text/html;profile=mcp-app",
        }],
      },
    });
  });
});
