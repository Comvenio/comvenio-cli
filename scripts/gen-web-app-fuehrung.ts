#!/usr/bin/env bun
/**
 * gen:web-app-fuehrung — writes src/schema/web-app-fuehrung.json from the UI
 * specifications in comvenio-tools and the data-ui-spec anchors in web-page
 * (comvenio-cli-doku 08). gen:docs renders the section "So geht's in der
 * Web-App" from that committed file, so check:docs and CI never need the
 * neighbouring repositories — the same split as src/schema/homepage.json.
 *
 *   bun run scripts/gen-web-app-fuehrung.ts          # regenerate
 *   bun run scripts/gen-web-app-fuehrung.ts --check  # exit 1 if the committed file drifts
 *
 * Both repositories are read through quellen.ts: COMVENIO_WORKSPACE, or per
 * repository COMVENIO_TOOLS_ROOT / COMVENIO_WEBPAGE_ROOT. The generator reads
 * working trees, not their main state — point the switches at the stand the
 * guide should describe.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSource } from "./quellen.ts";
import { bauWebAppFuehrung, HUBS } from "./web-app-fuehrung.ts";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZIEL = join(CLI_ROOT, "src", "schema", "web-app-fuehrung.json");
const CHECK_MODE = process.argv.includes("--check");

// A missing repository aborts with path and switch (08 DC-3) — an empty guide
// would look like "no surfaces" and be committed without anyone noticing.
const konzepte = resolveSource("comvenio-tools/AI-docs/concepts");
const webSrc = resolveSource("Frontend/web-page/src");

const fuehrung = bauWebAppFuehrung(konzepte, webSrc);
const inhalt = `${JSON.stringify(fuehrung, null, 2)}\n`;

const zaehlung = HUBS.map((hub) => `${hub} ${fuehrung.hubs[hub].length}`).join(", ");
console.log(`gen:web-app-fuehrung: Flächen je Hub — ${zaehlung}`);
if (fuehrung.hinweise.length > 0) {
  console.log(`gen:web-app-fuehrung: ${fuehrung.hinweise.length} Hinweis(e) — übersprungen, nicht beschrieben:`);
  for (const hinweis of fuehrung.hinweise) console.log(`  ${hinweis}`);
}

const aktuell = existsSync(ZIEL) ? readFileSync(ZIEL, "utf8") : null;
if (CHECK_MODE) {
  if (aktuell !== inhalt) {
    console.error("gen:web-app-fuehrung --check: veraltet — bun run gen:web-app-fuehrung, danach bun run gen:docs");
    process.exit(1);
  }
  console.log("gen:web-app-fuehrung --check: aktuell");
} else if (aktuell !== inhalt) {
  writeFileSync(ZIEL, inhalt);
  console.log("gen:web-app-fuehrung: geschrieben — danach bun run gen:docs");
} else {
  console.log("gen:web-app-fuehrung: unverändert");
}
