import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");

function json<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8")) as T;
}

describe("Railway MCP deployment contract", () => {
  test("builds and starts the MCP workspace without replacing CLI scripts", () => {
    const root = json<{
      scripts: Record<string, string>;
    }>("package.json");
    const mcp = json<{
      scripts: Record<string, string>;
    }>("apps/mcp-server/package.json");

    expect(root.scripts.build).toContain("src/index.ts");
    expect(root.scripts.start).toContain("src/index.ts");
    expect(root.scripts["build:mcp"]).toBe("bun run --cwd apps/mcp-server build");
    expect(root.scripts["start:mcp"]).toBe("bun run --cwd apps/mcp-server start");
    expect(mcp.scripts.build).toContain("src/main.ts");
    expect(mcp.scripts.start).toBe("bun run dist/main.js");
  });

  test("uses liveness for deployment while product readiness stays independent", () => {
    const railway = json<{
      build: { builder: string; buildCommand: string };
      deploy: {
        startCommand: string;
        healthcheckPath: string;
        healthcheckTimeout: number;
        drainingSeconds: number;
      };
    }>("railway.json");
    const review = json<{
      release_state: string;
      runtime: {
        build_command: string;
        start_command: string;
        review_domain: string;
        railway_origin_domain: string;
        publication_mode: string;
      };
      environments: {
        production: {
          domain: string;
          railway_origin_domain: string;
        };
      };
    }>("integrations/railway/comvenio-mcp.review.json");

    expect(railway.build).toEqual({
      builder: "RAILPACK",
      buildCommand: "bun run build:mcp",
    });
    expect(railway.deploy).toEqual({
      startCommand: "bun run start:mcp",
      healthcheckPath: "/health",
      healthcheckTimeout: 60,
      drainingSeconds: 20,
    });
    expect(review.release_state).toBe("BLOCKED");
    expect(review.runtime).toEqual(expect.objectContaining({
      build_command: railway.build.buildCommand,
      start_command: railway.deploy.startCommand,
      review_domain: "mcp.comvenio.app",
      railway_origin_domain: "comvenio-cli-production.up.railway.app",
      publication_mode: "fail_closed",
    }));
    expect(review.environments.production).toEqual(expect.objectContaining({
      domain: "mcp.comvenio.app",
      railway_origin_domain: "comvenio-cli-production.up.railway.app",
    }));
  });
});
