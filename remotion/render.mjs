// render.mjs (K7) — local Remotion render entrypoint, called by `comvenio news video`
// as a Node subprocess (robust Bun/Node interop, see Sub-File 07 "Offene Punkte").
//
// Usage: node render.mjs --template <slideshow|result|teaser> --params <params.json> --out <file.mp4> [--duration <sec>]
//
// The CLI has already zod-validated the params (src/util/videoParams.ts). This script:
//   1. stages local assets (images/logo/background) into public/job-<ts>/ (staticFile contract)
//   2. bundles the project, selects the composition (calculateMetadata derives the duration)
//   3. renders H.264 1080p MP4 and cleans the staged assets up again.
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const template = arg("template");
const paramsFile = arg("params");
const outFile = arg("out");
const durationOverride = arg("duration") ? Number(arg("duration")) : undefined;

if (!template || !paramsFile || !outFile) {
  console.error("usage: node render.mjs --template <t> --params <file> --out <file> [--duration <sec>]");
  process.exit(2);
}

const params = JSON.parse(readFileSync(paramsFile, "utf-8"));

// ---- stage local assets into public/ (staticFile contract) ----
const jobId = `job-${process.pid}-${Date.now()}`;
const jobDir = join(here, "public", jobId);
mkdirSync(jobDir, { recursive: true });

let counter = 0;
function stage(localPath) {
  const name = `${counter++}-${basename(localPath)}`;
  cpSync(resolve(localPath), join(jobDir, name));
  return `${jobId}/${name}`;
}

const inputProps = { ...params, durationOverride };
try {
  if (template === "slideshow") {
    inputProps.images = params.images.map(stage);
  }
  if (params.logoPath) {
    inputProps.logoFile = stage(params.logoPath);
    delete inputProps.logoPath;
  }
  if (template === "teaser") {
    if (params.backgroundImage) {
      inputProps.backgroundImage = stage(params.backgroundImage);
    }
    // deterministic countdown value (computed once here, not per frame)
    const eventDate = new Date(params.date);
    if (!Number.isNaN(eventDate.getTime())) {
      const days = Math.ceil((eventDate.getTime() - Date.now()) / 86_400_000);
      if (days >= 0) inputProps.daysUntil = days;
    }
  }
  if (template === "highlight") {
    if (params.background) inputProps.background = stage(params.background);
    if (params.logo) inputProps.logo = stage(params.logo);
    if (params.heroImage) inputProps.heroImage = stage(params.heroImage);
    if (Array.isArray(params.items)) {
      inputProps.items = params.items.map((d) => (d.logo ? { ...d, logo: stage(d.logo) } : d));
    }
    if (Array.isArray(params.sponsors)) {
      inputProps.sponsors = params.sponsors.map(stage);
    }
  }

  console.log(`[render] bundling (${template}) ...`);
  const serveUrl = await bundle({
    entryPoint: join(here, "src", "index.ts"),
    publicDir: join(here, "public"),
  });

  const composition = await selectComposition({ serveUrl, id: template, inputProps });

  console.log(
    `[render] rendering ${composition.width}x${composition.height}@${composition.fps} ` +
      `${composition.durationInFrames} frames -> ${outFile}`,
  );
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outFile,
    inputProps,
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 10 === 0) {
        process.stdout.write(`\r[render] ${Math.round(progress * 100)}%   `);
      }
    },
  });
  process.stdout.write("\n");
  console.log(`[render] done: ${outFile}`);
} finally {
  if (existsSync(jobDir)) rmSync(jobDir, { recursive: true, force: true });
}
