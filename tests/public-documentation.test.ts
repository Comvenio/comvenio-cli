import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const publicTextGlobs = [
  "AGENTS.md",
  "README.md",
  "docs/**/*.md",
  "src/**/*.ts",
  "apps/**/*.md",
  "packages/**/*.md",
  "integrations/**/*.{md,json,yaml,yml}",
] as const;

const personalNamePatterns = [
  new RegExp(`\\b${"To" + "m"}\\b`, "i"),
  new RegExp(`\\b${"Tho" + "mas"}\\b`, "i"),
] as const;

describe("public documentation professionalism", () => {
  test("contains no person-specific developer instructions or attributions", async () => {
    const findings: string[] = [];

    for (const pattern of publicTextGlobs) {
      const glob = new Bun.Glob(pattern);
      for await (const relativePath of glob.scan({ cwd: repositoryRoot, onlyFiles: true })) {
        const content = readFileSync(resolve(repositoryRoot, relativePath), "utf8");
        if (personalNamePatterns.some((namePattern) => namePattern.test(content))) {
          findings.push(relativePath.replaceAll("\\", "/"));
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
