#!/usr/bin/env bun
/**
 * check:docs — fails when a registry domain or a public error code has no
 * article, a language version or a required section is missing, an article
 * names internal details, or the generated state drifts (02-inhalte-und-pruefung).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkDocs } from "./docs-lib.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const findings = checkDocs(root);
if (findings.length > 0) {
  console.error(`check:docs: ${findings.length} Befund(e)`);
  for (const finding of findings) console.error(`  ${finding.file} — ${finding.reason}`);
  process.exit(1);
}
console.log("check:docs: vollständig");
