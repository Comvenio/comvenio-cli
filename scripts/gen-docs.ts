#!/usr/bin/env bun
/**
 * gen:docs — writes docs/index.json and the generated section "Befehle und
 * Actions" of every topic article from the coverage registry and schema files.
 *
 *   bun run scripts/gen-docs.ts          # write
 *   bun run scripts/gen-docs.ts --check  # CI: exit 1 when the committed state drifts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadActionInventory } from "./action-inventory.ts";
import { generateDocs } from "./docs-lib.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const drift: string[] = [];
for (const [path, content] of generateDocs(root, await loadActionInventory(root))) {
  const target = join(root, path);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === content) continue;
  if (check) drift.push(path);
  else writeFileSync(target, content);
}
if (check && drift.length > 0) {
  console.error(`gen:docs --check: veraltet — bun run gen:docs\n${drift.map((path) => `  ${path}`).join("\n")}`);
  process.exit(1);
}
console.log(check ? "gen:docs --check: aktuell" : "gen:docs: geschrieben");
