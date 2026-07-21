import { afterEach, describe, expect, test } from "bun:test";

import {
  createMcpDeploymentCandidate,
  readMcpProcessConfig,
} from "../src/bootstrap.ts";
import type { McpHttpServer } from "../src/http/server.ts";

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
      MCP_PROD_ALLOWED_HOSTS: "mcp-review.comvenio.app",
      MCP_PROD_ALLOWED_ORIGINS: "https://chatgpt.com,https://claude.ai",
    })).toEqual({
      environment: "production",
      host: "0.0.0.0",
      port: 8080,
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
    expect(() => readMcpProcessConfig({ PORT: "0" })).toThrow("PORT");
    expect(() => readMcpProcessConfig({
      MCP_PROD_ALLOWED_HOSTS: "mcp.example.test,mcp.example.test",
    })).toThrow("doppelte");
  });

  test("starts on TCP, serves health and OAuth metadata, and stays fail-closed", async () => {
    activeServer = createMcpDeploymentCandidate({
      environment: "production",
      host: "0.0.0.0",
      port: 8080,
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

    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toEqual(expect.objectContaining({
      resource: "https://mcp.comvenio.app",
      authorization_servers: ["https://api.comvenio.app/auth"],
      resource_documentation: "https://www.comvenio.app/datenschutz",
    }));

    const readiness = await fetch(`${base}/ready`);
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toEqual({ status: "not_ready" });

    const initialize = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "x-comvenio-provider": "openai",
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
        serverInfo: { name: "comvenio-mcp-server", version: "0.1.0" },
      }),
    }));
  });
});
