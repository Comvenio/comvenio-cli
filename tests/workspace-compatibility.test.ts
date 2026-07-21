import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as compatibilityClient from "../src/http.ts";
import * as sharedLegacyClient from "../packages/comvenio-client/src/legacy.ts";

const repositoryRoot = resolve(import.meta.dir, "..");

function runHelp(entrypoint: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", entrypoint, "--help"],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("workspace compatibility", () => {
  test("keeps legacy client symbols identical", () => {
    expect(compatibilityClient.HttpError).toBe(sharedLegacyClient.HttpError);
    expect(compatibilityClient.createClient).toBe(sharedLegacyClient.createClient);
  });

  test("keeps the root comvenio binary declaration", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
    expect(packageJson.bin).toEqual({ comvenio: "./src/index.ts" });
  });

  test("exposes the same command registration through root and app entrypoints", () => {
    const rootHelp = runHelp("src/index.ts");
    const appHelp = runHelp("apps/cli/src/index.ts");
    expect(rootHelp.exitCode).toBe(0);
    expect(appHelp.exitCode).toBe(0);
    expect(rootHelp.stderr).toBe("");
    expect(appHelp.stderr).toBe("");
    expect(appHelp.stdout).toBe(rootHelp.stdout);
    expect(rootHelp.stdout).toContain("role");
  });
});
