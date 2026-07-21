import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const sharedSourceRoots = [
  join(repositoryRoot, "packages", "comvenio-client", "src"),
  join(repositoryRoot, "packages", "connector-contracts", "src"),
  join(repositoryRoot, "packages", "auth", "src"),
  join(repositoryRoot, "packages", "tool-catalog", "src"),
];

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("shared package boundaries", () => {
  test("exclude provider SDKs and CLI-local auth state", () => {
    const violations: string[] = [];
    for (const root of sharedSourceRoots) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        if (/from\s+["'](?:openai|@openai\/|@anthropic-ai\/sdk|@modelcontextprotocol\/)/u.test(source)) {
          violations.push(`${file}: provider SDK import`);
        }
        if (/src\/auth\.ts|ComvenioCliState|STATE_FILE/u.test(source)) {
          violations.push(`${file}: CLI-local auth import`);
        }
        if (/\bfetch\s*\(/u.test(source) && root.endsWith(join("tool-catalog", "src"))) {
          violations.push(`${file}: network-capable catalog code`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
