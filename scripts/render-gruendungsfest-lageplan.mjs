import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const eventId = "86f5f89b-2208-43d0-aad9-04edcec74235";
const planId = "a5e220b8-bbe6-4fb8-a10c-b1bf0b5b41d3";
const outDir = resolve("E:/tmp/gruendungsfest-sonntag-zeichnung");
mkdirSync(outDir, { recursive: true });

const cli = spawnSync(
  ".\\comvenio.exe",
  ["plan", "show", planId, "--json"],
  { cwd: "E:/Comvenio/Sourcecode/comvenio-cli", encoding: "utf8" },
);
if (cli.status !== 0) {
  throw new Error(cli.stderr || cli.stdout || "comvenio plan show failed");
}

const data = JSON.parse(cli.stdout);
const zones = (data.zones || []).filter((z) => z.geometry && z.shape_type !== "polyline");
const markers = data.markers || [];

function parsePoints(geometry) {
  try {
    const geo = JSON.parse(geometry);
    const raw = geo.type === "Polygon" ? geo.coordinates?.[0] || [] : geo.coordinates || [];
    return raw
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .filter(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
  } catch {
    return [];
  }
}

const all = [];
for (const z of zones) all.push(...parsePoints(z.geometry));
for (const m of markers) {
  if (Number.isFinite(m.lng) && Number.isFinite(m.lat)) all.push([m.lng, m.lat]);
}
if (!all.length) throw new Error("No valid geometry points");

let minX = Math.min(...all.map((p) => p[0]));
let maxX = Math.max(...all.map((p) => p[0]));
let minY = Math.min(...all.map((p) => p[1]));
let maxY = Math.max(...all.map((p) => p[1]));
const padX = (maxX - minX) * 0.18;
const padY = (maxY - minY) * 0.18;
minX -= padX;
maxX += padX;
minY -= padY;
maxY += padY;

const W = 1800;
const H = 1260;
const sx = (x) => ((x - minX) / (maxX - minX)) * W;
const sy = (y) => H - ((y - minY) / (maxY - minY)) * H;
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function centroid(points) {
  const pts = points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]
    ? points.slice(0, -1)
    : points;
  return [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
}

function labelPoint(z, pts) {
  if (Number.isFinite(z.label_x) && Number.isFinite(z.label_y)) return [z.label_x, z.label_y];
  return centroid(pts);
}

const namedZones = zones
  .map((z) => ({ ...z, points: parsePoints(z.geometry) }))
  .filter((z) => z.points.length >= 3);

const zoneSvg = namedZones
  .map((z) => {
    const pts = z.points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
    const fill = z.color || "#75b67a";
    const stroke = z.color || "#2f6f3b";
    return `<polygon points="${pts}" fill="${fill}" fill-opacity="0.72" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/>`;
  })
  .join("\n");

const labelSvg = namedZones
  .filter((z) => z.name)
  .map((z, idx) => {
    const [x, y] = labelPoint(z, z.points);
    const px = sx(x);
    const py = sy(y);
    const flagX = Math.min(W - 180, Math.max(180, px + (idx % 2 === 0 ? 130 : -130)));
    const flagY = Math.min(H - 70, Math.max(70, py - 90 - (idx % 3) * 20));
    const text = esc(z.name);
    const width = Math.max(120, Math.min(270, text.length * 13 + 40));
    return `
      <line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${flagX.toFixed(1)}" y2="${flagY.toFixed(1)}" stroke="#171717" stroke-width="3" opacity="0.72"/>
      <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="8" fill="#ffd400" stroke="#171717" stroke-width="3"/>
      <rect x="${(flagX - width / 2).toFixed(1)}" y="${(flagY - 25).toFixed(1)}" width="${width}" height="50" rx="12" fill="#ffd400" stroke="#171717" stroke-width="3"/>
      <text x="${flagX.toFixed(1)}" y="${(flagY + 8).toFixed(1)}" text-anchor="middle" font-size="25" font-weight="800" fill="#111">${text}</text>`;
  })
  .join("\n");

const markerSvg = markers
  .filter((m) => Number.isFinite(m.lng) && Number.isFinite(m.lat))
  .map((m, idx) => {
    const x = sx(m.lng);
    const y = sy(m.lat);
    const label = m.label || m.marker_type || "Marker";
    const dx = idx % 2 === 0 ? 105 : -105;
    const dy = -55 - (idx % 3) * 18;
    const lx = Math.min(W - 160, Math.max(160, x + dx));
    const ly = Math.min(H - 55, Math.max(55, y + dy));
    const width = Math.max(110, Math.min(290, String(label).length * 12 + 36));
    return `
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${m.size ? 11 + Number(m.size) * 2 : 12}" fill="#ff5a3d" stroke="#111" stroke-width="4"/>
      <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#111" stroke-width="2.5" opacity="0.66"/>
      <rect x="${(lx - width / 2).toFixed(1)}" y="${(ly - 22).toFixed(1)}" width="${width}" height="44" rx="11" fill="#fff6b8" stroke="#111" stroke-width="2.5"/>
      <text x="${lx.toFixed(1)}" y="${(ly + 7).toFixed(1)}" text-anchor="middle" font-size="21" font-weight="750" fill="#111">${esc(label)}</text>`;
  })
  .join("\n");

const svg = `<!doctype html>
<html><head><meta charset="utf-8"><title>Gründungsfest Lageplan</title>
<style>
  body{margin:0;background:#f5f1df;font-family:Arial,Helvetica,sans-serif}
  svg{display:block;width:${W}px;height:${H}px}
  .title{font-size:46px;font-weight:900;fill:#1d2a20}
  .subtitle{font-size:24px;font-weight:650;fill:#4b5b4f}
</style></head><body>
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="grass" width="80" height="80" patternUnits="userSpaceOnUse">
      <rect width="80" height="80" fill="#d7e7bf"/>
      <path d="M0 42 C20 30 38 55 80 38" fill="none" stroke="#bdd898" stroke-width="4" opacity=".35"/>
      <path d="M10 8 C35 20 44 4 76 14" fill="none" stroke="#a7cc7f" stroke-width="3" opacity=".26"/>
    </pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".24"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#grass)"/>
  <path d="M100 ${H - 170} C360 ${H - 260}, 520 ${H - 110}, 780 ${H - 230} S1280 ${H - 330}, 1700 ${H - 190}" fill="none" stroke="#e7d8a5" stroke-width="72" stroke-linecap="round" opacity=".85"/>
  <path d="M100 ${H - 170} C360 ${H - 260}, 520 ${H - 110}, 780 ${H - 230} S1280 ${H - 330}, 1700 ${H - 190}" fill="none" stroke="#b69d68" stroke-width="6" stroke-dasharray="20 18" opacity=".65"/>
  <g filter="url(#shadow)">${zoneSvg}</g>
  ${markerSvg}
  ${labelSvg}
  <rect x="32" y="28" width="760" height="96" rx="24" fill="#ffffffe8" stroke="#d4c89a" stroke-width="3"/>
  <text x="62" y="72" class="title">Gründungsfest - Fest-Sonntag</text>
  <text x="64" y="107" class="subtitle">Illustrierter Lageplan · SV Motzing · 5. Juli 2026</text>
</svg>
</body></html>`;

const htmlPath = `${outDir}/gruendungsfest-sonntag-lageplan.html`;
writeFileSync(htmlPath, svg, "utf8");
console.log(JSON.stringify({ eventId, planId, htmlPath, outPng: `${outDir}/gruendungsfest-sonntag-lageplan.png` }, null, 2));
