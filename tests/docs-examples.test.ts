// Every action example in the customer docs must pass the real input schema,
// so a customer without the repository can run it as written (placeholders aside).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { K7_ACTION_SCHEMAS } from "../apps/mcp-server/src/tools/identity-club-member-team-role/schemas.ts";
import { K8_ACTION_SCHEMAS } from "../apps/mcp-server/src/tools/event-plan/schemas.ts";
import { K9_ACTION_SCHEMAS } from "../apps/mcp-server/src/tools/meeting-tournament/schemas.ts";
import { K10_ACTION_SCHEMAS } from "../apps/mcp-server/src/tools/booking-object-task/schemas.ts";
import { K11_ACTION_SCHEMAS } from "../apps/mcp-server/src/tools/supply-menu-shopping/schemas.ts";
import { K12_ACTION_SCHEMAS } from "../apps/mcp-server/src/tools/content-homepage-news-data/schemas.ts";
import { K13_ACTION_SCHEMAS } from "../apps/mcp-server/src/tools/sponsor-marketing/schemas.ts";
import { K14_ACTION_SCHEMAS } from "../apps/mcp-server/src/tools/finance/schemas.ts";
import { OAUTH_SCOPE_VALUES } from "../packages/connector-contracts/src/index.ts";

type InputSchema = { input: { safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } } };
const SCHEMAS: Record<string, InputSchema> = {
  ...K7_ACTION_SCHEMAS, ...K8_ACTION_SCHEMAS, ...K9_ACTION_SCHEMAS, ...K10_ACTION_SCHEMAS,
  ...K11_ACTION_SCHEMAS, ...K12_ACTION_SCHEMAS, ...K13_ACTION_SCHEMAS, ...K14_ACTION_SCHEMAS,
};
const PLACEHOLDER_ID = "3f1c2b4a-5d6e-4f70-8a91-b2c3d4e5f601";
const EXAMPLE = /action call (cai\.[\w.-]+)\s*(?:\\\s*)?--input '([^']*)'/g;

/** `<event-id>` and the like stand for identifiers. */
function fill(value: unknown): unknown {
  if (typeof value === "string" && /^<[^>]+>$/u.test(value)) return PLACEHOLDER_ID;
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
  return value;
}

function articles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? articles(path) : path.endsWith(".md") ? [path] : [];
  });
}

describe("action examples in the customer docs", () => {
  const root = join(import.meta.dir, "..");
  const examples = articles(join(root, "docs")).flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(EXAMPLE)].map((match) => ({ path: path.slice(root.length + 1), id: match[1]!, raw: match[2]! })));

  test("there are examples to check", () => {
    expect(examples.length).toBeGreaterThan(500);
  });

  test("every example names a real action and passes its input schema", () => {
    const findings: string[] = [];
    for (const { path, id, raw } of examples) {
      const schema = SCHEMAS[id];
      if (!schema) { findings.push(`${path}: unknown action ${id}`); continue; }
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        // Shortened on purpose ("…", "<object above>"); everything else must be valid JSON.
        if (!/…|<[^">]+>/u.test(raw)) findings.push(`${path}: ${id} input is not JSON`);
        continue;
      }
      const result = schema.input.safeParse({ club_id: PLACEHOLDER_ID, ...(fill(input) as object) });
      if (!result.success) {
        findings.push(`${path}: ${id} ${result.error!.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
      }
    }
    expect(findings).toEqual([]);
  });

  test("the sign-in article lists every OAuth scope in both languages", () => {
    for (const path of ["docs/auth-club.md", "docs/en/auth-club.md"]) {
      const text = readFileSync(join(root, path), "utf8");
      expect(OAUTH_SCOPE_VALUES.filter((scope) => !text.includes(`\`${scope}\``))).toEqual([]);
    }
  });
});
