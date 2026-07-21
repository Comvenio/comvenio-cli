import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

interface WorkspacePackage {
  name: string;
  relativePath: string;
}

const repositoryRoot = resolve(import.meta.dir, "..");

function workspacePackages(): WorkspacePackage[] {
  const rootPackage = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  ) as { workspaces: string[] };

  return rootPackage.workspaces.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) {
      throw new Error(`Nicht unterstütztes Workspace-Muster: ${pattern}`);
    }
    const parent = pattern.slice(0, -2);
    return readdirSync(resolve(repositoryRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry): WorkspacePackage[] => {
        const relativePath = `${parent}/${entry.name}`;
        const manifestPath = resolve(repositoryRoot, relativePath, "package.json");
        if (!existsSync(manifestPath)) return [];
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string };
        if (!manifest.name) throw new Error(`${relativePath}: Paketname fehlt.`);
        return [{ name: manifest.name, relativePath }];
      });
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

describe("workspace lockfile", () => {
  test("contains every declared workspace package", () => {
    const lockfile = readFileSync(resolve(repositoryRoot, "bun.lock"), "utf8");

    for (const workspace of workspacePackages()) {
      expect(lockfile).toContain(`"${workspace.relativePath}": {`);
      expect(lockfile).toContain(
        `"${workspace.name}": ["${workspace.name}@workspace:${workspace.relativePath}"],`,
      );
    }
  });
});
