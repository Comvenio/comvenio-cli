// src/util/render.ts
// V7-EXPORT (21-v7-export-cli.md): geteilte headless-Render-Helfer (playwright-cli via Bun.spawn).
// Render-Muster wie verify.ts (NICHT verändert) — hier extrahiert für `plan export`. PDF deterministisch
// via pdf-lib (Bild -> A4-quer-Seite), browser-unabhängig (DC-8 safe-on-dev statt "falls playwright pdf kann").
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

const PW_SESSION = "-s=cvn-plan-export";

// Frontend-Basis ≠ Gateway-Basis: der HTTP-Client spricht das Gateway (api.comvenio.app),
// gerendert wird das Frontend (web.comvenio.app). Override z. B. http://localhost:5173.
export function frontendBase(env: string, override?: string): string {
  if (override) return override.replace(/\/+$/, "");
  return env === "dev" ? "https://web.dev.comvenio.app" : "https://web.comvenio.app";
}

type PwResult = { code: number; stdout: string; stderr: string };

async function pw(args: string[]): Promise<PwResult> {
  const proc = Bun.spawn(["playwright-cli", PW_SESSION, ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

export async function hasPlaywrightCli(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["playwright-cli", "--version"], { stdout: "ignore", stderr: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Öffnet die URL headless und schreibt einen Full-Page-PNG-Screenshot nach `outPath`.
 * `waitMs` ist großzügig (Default 3500), weil Leaflet die Satelliten-Kacheln nach fitBounds
 * asynchron nachlädt. Wirft bei Render-/Screenshot-Fehler.
 */
export async function screenshotToPng(
  url: string,
  outPath: string,
  opts: { waitMs?: number; width?: number } = {},
): Promise<void> {
  const open = await pw(["open", url]);
  if (open.code !== 0) {
    await pw(["close"]);
    throw new Error(`Render fehlgeschlagen (open): ${open.stderr.trim().slice(0, 200)}`);
  }
  await pw(["resize", String(opts.width ?? 900), "900"]);
  await sleep(opts.waitMs ?? 3500); // SPA-Settle + Tile-Load
  const shot = await pw(["screenshot", "--full-page", "--filename", outPath]);
  await pw(["close"]);
  if (shot.code !== 0) {
    throw new Error(`Screenshot fehlgeschlagen: ${shot.stderr.trim().slice(0, 200)}`);
  }
}

/** Bettet ein PNG als zentriertes Bild in eine A4-quer-PDF-Seite ein (ein Plan pro Seite). */
export async function pngFileToPdf(pngPath: string, pdfPath: string): Promise<void> {
  const pngBytes = readFileSync(pngPath);
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(pngBytes);
  const pageW = 842; // A4 quer (pt)
  const pageH = 595;
  const margin = 20;
  const page = pdf.addPage([pageW, pageH]);
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const ratio = Math.min(availW / img.width, availH / img.height);
  const w = img.width * ratio;
  const h = img.height * ratio;
  page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
  writeFileSync(pdfPath, await pdf.save());
}
