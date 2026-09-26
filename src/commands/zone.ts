import type { CAC } from "cac";
import { readFileSync, existsSync } from "node:fs";
import { loadState } from "../auth.ts";
import { createClient, HttpError, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";

// Vereinsgebiet und Zonen (Lastenheft club/vereinsgebiet-zonen 04):
//   club-service  GET/POST   /clubs/{club_id}/zone-sets
//                 PATCH/DEL  /clubs/{club_id}/zone-sets/{zone_set_id}        (expected_version)
//                 GET/POST   /clubs/{club_id}/zone-sets/{zone_set_id}/zones
//                 PATCH/DEL  /clubs/{club_id}/zones/{zone_id}                (expected_version)
//                 GET        /clubs/{club_id}/zones?ids=a,b                  (incl. deleted)
//   task-service  GET/POST   /tasks/{task_id}/zones, DELETE /tasks/{task_id}/zones/{zone_id}
//                 GET        /tasks/zones/by-set/{zone_set_id}?club_id=&status=
// Exit codes: service errors 1 (code and reason printed), invalid input 2 (before any call).

type Position = [number, number];
export type ZoneGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

type ZoneSetRead = {
  id: string;
  name: string;
  center_lat: number | null;
  center_lng: number | null;
  zoom: number;
  sort_order: number;
  version: number;
  zone_count: number;
};
export type ZoneRead = {
  id: string;
  zone_set_id: string;
  name: string;
  color: string;
  geometry: ZoneGeometry;
  sort_order: number;
  version: number;
  deleted: boolean;
  zone_set_name?: string | null;
  // Angaben (vereinsgebiet-zonen 05)
  building_count?: number | null;
  building_count_estimate?: number | null;
  building_count_estimated_at?: string | null;
  building_count_estimate_status?: "pending" | "ok" | "failed" | null;
  notes?: string | null;
};
export type TaskZoneRead = { zone_id: string; zone_set_id: string; sort_order: number };
export type ZoneTaskItem = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  assignees: { member_id: string; is_responsible: boolean }[];
  other_zone_ids: string[];
};
export type ZoneTasks = { zone_id: string; tasks: ZoneTaskItem[] };

export type ZoneCommandOpts = {
  json?: boolean;
  club?: string;
  name?: string;
  center?: string;
  zoom?: string;
  color?: string;
  geojson?: string;
  set?: string;
  status?: string;
  expectedVersion?: string;
  buildingCount?: string;
  notes?: string;
};

/** Invalid input found before any call (exit code 2). */
export class ZoneInputError extends Error {}

const MAX_POINTS = 2000;
const COLOR = /^#[0-9A-Fa-f]{6}$/;

/* ── Pure helpers (tested) ─────────────────────────────────────────────── */

/** Same rules as the club-service validator; returns the reason or null. */
export function geometryProblem(geo: unknown): string | null {
  if (!geo || typeof geo !== "object") return "Geometrie ist kein GeoJSON-Objekt";
  const g = geo as { type?: unknown; coordinates?: unknown };
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") {
    return `Nur Polygon oder MultiPolygon sind erlaubt (gefunden: ${String(g.type)})`;
  }
  const polygons: unknown[] = g.type === "Polygon" ? [g.coordinates] : Array.isArray(g.coordinates) ? g.coordinates : [];
  if (polygons.length === 0) return "Keine Fläche";
  let points = 0;
  for (const poly of polygons) {
    if (!Array.isArray(poly) || poly.length === 0) return "Fläche ohne Ringe";
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 4) return "Ein Ring braucht mindestens vier Punkte";
      for (const p of ring) {
        if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") {
          return "Ein Punkt ist keine Koordinate [lng, lat]";
        }
        if (p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) return "Koordinate außerhalb von -180…180 / -90…90";
      }
      const a = ring[0] as number[];
      const b = ring[ring.length - 1] as number[];
      if (a[0] !== b[0] || a[1] !== b[1]) return "Ein Ring ist nicht geschlossen";
      points += ring.length;
    }
  }
  if (points > MAX_POINTS) return `Mehr als ${MAX_POINTS} Punkte`;
  return null;
}

function readGeoJson(path: string): unknown {
  if (!existsSync(path)) throw new ZoneInputError(`GeoJSON-Datei nicht gefunden: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ZoneInputError(`Kein gültiges JSON in ${path}: ${(err as Error).message}`);
  }
}

/** Geometry for `zone create/update`: a Polygon/MultiPolygon, a Feature, or a collection of one Feature. */
export function singleGeometry(doc: unknown, path = "Datei"): ZoneGeometry {
  let geo: unknown = doc;
  const d = doc as { type?: string; geometry?: unknown; features?: { geometry?: unknown }[] };
  if (d?.type === "Feature") geo = d.geometry;
  if (d?.type === "FeatureCollection") {
    if (!Array.isArray(d.features) || d.features.length !== 1) {
      throw new ZoneInputError(
        `${path}: FeatureCollection mit ${d.features?.length ?? 0} Features — für mehrere Zonen „zone import“ nehmen`,
      );
    }
    geo = d.features[0]?.geometry;
  }
  const problem = geometryProblem(geo);
  if (problem) throw new ZoneInputError(`${path}: ${problem}`);
  return geo as ZoneGeometry;
}

export type ImportPlan = {
  valid: { index: number; name: string; geometry: ZoneGeometry; color?: string }[];
  skipped: { index: number; reason: string }[];
};

/** One zone per feature of a FeatureCollection; name from properties.name. */
export function planImport(doc: unknown, path = "Datei"): ImportPlan {
  const fc = doc as { type?: string; features?: unknown[] };
  if (fc?.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new ZoneInputError(`${path}: FeatureCollection erwartet`);
  }
  const plan: ImportPlan = { valid: [], skipped: [] };
  fc.features.forEach((f, index) => {
    const feature = f as { geometry?: unknown; properties?: { name?: unknown; color?: unknown } };
    const problem = geometryProblem(feature?.geometry);
    if (problem) {
      plan.skipped.push({ index, reason: problem });
      return;
    }
    const raw = feature.properties?.name;
    const name = typeof raw === "string" && raw.trim() ? raw.trim() : `Zone ${index + 1}`;
    const color = typeof feature.properties?.color === "string" && COLOR.test(feature.properties.color)
      ? feature.properties.color
      : undefined;
    plan.valid.push({ index, name: name.slice(0, 120), geometry: feature.geometry as ZoneGeometry, color });
  });
  return plan;
}

export type Zuteilung = "keiner" | "offen" | "arbeit" | "erledigt";
const TEXT: Record<Zuteilung, string> = {
  keiner: "Nicht zugeteilt",
  offen: "Zugeteilt, offen",
  arbeit: "In Arbeit",
  erledigt: "Erledigt",
};
const RANG: Record<Zuteilung, number> = { keiner: 0, arbeit: 1, offen: 2, erledigt: 3 };

/** Colouring rule of the overview (TD-5, vereinsgebiet-zonen 03 DC-5). */
export function zuteilung(tasks: ZoneTaskItem[], filter: ReadonlySet<string>): Zuteilung {
  const visible = tasks.filter((t) => t.status !== "cancelled" && filter.has(t.status));
  const assigned = visible.filter((t) => t.assignees.length > 0);
  if (visible.length === 0 || assigned.length === 0) return "keiner";
  if (assigned.some((t) => t.status === "in_progress")) return "arbeit";
  if (filter.has("completed") && visible.every((t) => t.status === "completed")) return "erledigt";
  return "offen";
}

export type OverviewRow = { zone: ZoneRead; state: Zuteilung; tasks: ZoneTaskItem[] };

/** Rows ordered like the overview: unassigned first, then in progress, open, done; then sort_order. */
export function overviewRows(zones: ZoneRead[], perZone: ZoneTasks[], status: string): OverviewRow[] {
  const filter = new Set(status.split(",").map((s) => s.trim()).filter(Boolean));
  const map = new Map(perZone.map((e) => [e.zone_id, e.tasks]));
  return zones
    .map((zone) => {
      const all = map.get(zone.id) ?? [];
      const tasks = all.filter((t) => t.status !== "cancelled" && filter.has(t.status));
      return { zone, state: zuteilung(all, filter), tasks };
    })
    .sort(
      (a, b) =>
        RANG[a.state] - RANG[b.state] || a.zone.sort_order - b.zone.sort_order || a.zone.name.localeCompare(b.zone.name, "de"),
    );
}

export function parseCenter(value: string | undefined): { center_lat?: number; center_lng?: number } {
  if (value === undefined) return {};
  const [lat, lng] = String(value).split(",").map((s) => Number(s.trim()));
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new ZoneInputError(`--center erwartet "<lat>,<lng>", gefunden: ${value}`);
  }
  return { center_lat: lat, center_lng: lng };
}

function intOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) throw new ZoneInputError(`${flag} erwartet eine Zahl, gefunden: ${value}`);
  return n;
}

function colorOption(value: string | undefined): string | undefined {
  if (value !== undefined && !COLOR.test(value)) throw new ZoneInputError(`--color erwartet #RRGGBB, gefunden: ${value}`);
  return value;
}

/** Displayed building count (05 §18b): hand-entered wins, else the estimate with „≈“. */
export function gebaeudeText(z: Pick<ZoneRead, "building_count" | "building_count_estimate" | "building_count_estimate_status">): string {
  if (z.building_count != null) return String(z.building_count);
  if (z.building_count_estimate_status === "pending") return "wird geschätzt";
  const alt = z.building_count_estimate != null ? `≈ ${z.building_count_estimate}` : null;
  if (z.building_count_estimate_status === "failed") return alt ? `${alt} (Schätzung fehlgeschlagen)` : "Schätzung fehlgeschlagen";
  return alt ?? "noch nicht geschätzt";
}

/** building_count / notes for PATCH; "" or "leer" clears (null). Kept apart from prune(), which drops null. */
export function angabenBody(opts: Pick<ZoneCommandOpts, "buildingCount" | "notes">): { building_count?: number | null; notes?: string | null } {
  const body: { building_count?: number | null; notes?: string | null } = {};
  if (opts.buildingCount !== undefined) {
    const raw = String(opts.buildingCount).trim();
    if (raw === "" || raw.toLowerCase() === "leer") body.building_count = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 100000) {
        throw new ZoneInputError(`--building-count erwartet 0 bis 100000 oder „leer“, gefunden: ${raw}`);
      }
      body.building_count = n;
    }
  }
  if (opts.notes !== undefined) {
    const text = String(opts.notes);
    if (text.length > 2000) throw new ZoneInputError(`--notes höchstens 2000 Zeichen (gefunden: ${text.length})`);
    body.notes = text.trim() === "" ? null : text;
  }
  return body;
}

/** Service error in one line: status, code and reason (DC-3). */
export function describeServiceError(err: HttpError): string {
  let detail: unknown = null;
  try {
    detail = (JSON.parse(err.body) as { detail?: unknown }).detail ?? null;
  } catch {
    detail = err.body || null;
  }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    const code = typeof d.code === "string" ? d.code : "";
    const parts = [`HTTP ${err.status}${code ? ` ${code}` : ""}`];
    if (d.grund) parts.push(String(d.grund));
    if (d.live_version !== undefined) {
      parts.push(`live_version=${String(d.live_version)} — erneut mit --expected-version ${String(d.live_version)}`);
    }
    if (d.zone_set_id) parts.push(`Einteilung der vorhandenen Zonen: ${String(d.zone_set_id)}`);
    if (d.limit !== undefined) parts.push(`Grenze ${String(d.limit)}`);
    return parts.join(" · ");
  }
  return `HTTP ${err.status}${detail ? ` · ${JSON.stringify(detail).slice(0, 200)}` : ""}`;
}

/** Joins the task's zone rows with the zone details (deleted ones stay, marked). */
export function taskZoneRows(rows: TaskZoneRead[], details: ZoneRead[]) {
  const byId = new Map(details.map((z) => [z.id, z]));
  return rows.map((r) => {
    const z = byId.get(r.zone_id);
    return { ...r, name: z?.name ?? null, zone_set_name: z?.zone_set_name ?? null, deleted: z?.deleted ?? false };
  });
}

/* ── Command ──────────────────────────────────────────────────────────── */

async function versionOfSet(client: ComvenioClient, clubId: string, id: string, given?: number): Promise<number> {
  if (given !== undefined) return given;
  const sets = await client.get<ZoneSetRead[]>("club", `/clubs/${clubId}/zone-sets`);
  const found = sets.find((s) => s.id === id);
  if (!found) throw new ZoneInputError(`Einteilung ${id} nicht gefunden`);
  return found.version;
}

async function versionOfZone(client: ComvenioClient, clubId: string, id: string, given?: number): Promise<number> {
  if (given !== undefined) return given;
  const rows = await client.get<ZoneRead[]>("club", `/clubs/${clubId}/zones?ids=${encodeURIComponent(id)}`);
  const found = rows.find((z) => z.id === id && !z.deleted);
  if (!found) throw new ZoneInputError(`Zone ${id} nicht gefunden`);
  return found.version;
}

function requireSet(opts: ZoneCommandOpts, usage: string): string {
  if (!opts.set) throw new ZoneInputError(`${usage} benötigt --set <zone-set-id>`);
  return String(opts.set);
}

async function runZoneSet(
  client: ComvenioClient,
  clubId: string,
  action: string | undefined,
  id: string | undefined,
  opts: ZoneCommandOpts,
): Promise<void> {
  switch (action) {
    case "list": {
      const sets = await client.get<ZoneSetRead[]>("club", `/clubs/${clubId}/zone-sets`);
      output(sets, opts.json, () =>
        sets.length
          ? renderTable(sets, [
              { header: "Name", width: 30, get: (s) => s.name },
              { header: "Zonen", width: 6, get: (s) => String(s.zone_count) },
              { header: "Version", width: 7, get: (s) => String(s.version) },
              { header: "ID", width: 36, get: (s) => s.id },
            ])
          : "Keine Einteilungen.",
      );
      return;
    }
    case "create": {
      if (!opts.name) throw new ZoneInputError("zone set create benötigt --name <name>");
      const body = prune({ name: opts.name, ...parseCenter(opts.center), zoom: intOption(opts.zoom, "--zoom") });
      const created = await client.post<ZoneSetRead>("club", `/clubs/${clubId}/zone-sets`, body);
      output(created, opts.json, () => `Einteilung angelegt: ${created.name} (${created.id})`);
      return;
    }
    case "update": {
      if (!id) throw new ZoneInputError("zone set update <zone-set-id> benötigt eine ID");
      const center = parseCenter(opts.center);
      const zoom = intOption(opts.zoom, "--zoom");
      const version = await versionOfSet(client, clubId, id, intOption(opts.expectedVersion, "--expected-version"));
      const body = prune({ expected_version: version, name: opts.name, ...center, zoom });
      const updated = await client.patch<ZoneSetRead>("club", `/clubs/${clubId}/zone-sets/${id}`, body);
      output(updated, opts.json, () => `Einteilung geändert: ${updated.name} (Version ${updated.version})`);
      return;
    }
    case "delete": {
      if (!id) throw new ZoneInputError("zone set delete <zone-set-id> benötigt eine ID");
      await client.del("club", `/clubs/${clubId}/zone-sets/${id}`);
      output({ deleted: id }, opts.json, () => `Einteilung gelöscht: ${id} (Aufgaben behalten ihre Zonen als gelöscht)`);
      return;
    }
    default:
      throw new ZoneInputError("zone set <list|create|update|delete>");
  }
}

async function runZone(args: string[], opts: ZoneCommandOpts): Promise<void> {
  const state = await loadState();
  const client = createClient(state);
  const clubId = requireClubId(state, opts.club);
  const [first, second, third] = args;
  if (first === "set") return runZoneSet(client, clubId, second, third, opts);

  const id = second;
  switch (first) {
    case "list": {
      const setId = requireSet(opts, "zone list");
      const zones = await client.get<ZoneRead[]>("club", `/clubs/${clubId}/zone-sets/${setId}/zones`);
      output(zones, opts.json, () =>
        zones.length
          ? renderTable(zones, [
              { header: "Name", width: 30, get: (z) => z.name },
              { header: "Farbe", width: 8, get: (z) => z.color },
              { header: "Gebäude", width: 22, get: (z) => gebaeudeText(z) },
              { header: "Version", width: 7, get: (z) => String(z.version) },
              { header: "ID", width: 36, get: (z) => z.id },
            ])
          : "Keine Zonen in dieser Einteilung.",
      );
      return;
    }
    case "create": {
      const setId = requireSet(opts, "zone create");
      if (!opts.name) throw new ZoneInputError("zone create benötigt --name <name>");
      if (!opts.geojson) throw new ZoneInputError("zone create benötigt --geojson <datei>");
      const geometry = singleGeometry(readGeoJson(opts.geojson), opts.geojson);
      const body = prune({ name: opts.name, geometry, color: colorOption(opts.color) });
      const created = await client.post<ZoneRead>("club", `/clubs/${clubId}/zone-sets/${setId}/zones`, body);
      output(created, opts.json, () => `Zone angelegt: ${created.name} (${created.id})`);
      return;
    }
    case "update": {
      if (!id) throw new ZoneInputError("zone update <zone-id> benötigt eine ID");
      const geometry = opts.geojson ? singleGeometry(readGeoJson(opts.geojson), opts.geojson) : undefined;
      const color = colorOption(opts.color);
      const angaben = angabenBody(opts);
      const version = await versionOfZone(client, clubId, id, intOption(opts.expectedVersion, "--expected-version"));
      const body = { ...prune({ expected_version: version, name: opts.name, color, geometry }), ...angaben };
      const updated = await client.patch<ZoneRead>("club", `/clubs/${clubId}/zones/${id}`, body);
      output(updated, opts.json, () => `Zone geändert: ${updated.name} (Version ${updated.version})`);
      return;
    }
    case "estimate": {
      if (!id) throw new ZoneInputError("zone estimate <zone-id> benötigt eine ID");
      const zone = await client.post<ZoneRead>("club", `/clubs/${clubId}/zones/${id}/estimate-buildings`, {});
      output(zone, opts.json, () => `Schätzung gestartet: ${zone.name} — das Ergebnis steht nach wenigen Sekunden in „zone list“`);
      return;
    }
    case "delete": {
      if (!id) throw new ZoneInputError("zone delete <zone-id> benötigt eine ID");
      await client.del("club", `/clubs/${clubId}/zones/${id}`);
      output({ deleted: id }, opts.json, () => `Zone gelöscht: ${id} (Aufgaben behalten sie als gelöscht)`);
      return;
    }
    case "import": {
      const setId = requireSet(opts, "zone import");
      if (!opts.geojson) throw new ZoneInputError("zone import benötigt --geojson <FeatureCollection>");
      const plan = planImport(readGeoJson(opts.geojson), opts.geojson);
      const created: ZoneRead[] = [];
      const skipped = [...plan.skipped];
      for (const f of plan.valid) {
        try {
          const body = prune({ name: f.name, geometry: f.geometry, color: f.color });
          created.push(await client.post<ZoneRead>("club", `/clubs/${clubId}/zone-sets/${setId}/zones`, body));
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
          skipped.push({ index: f.index, reason: describeServiceError(err) });
        }
      }
      skipped.sort((a, b) => a.index - b.index);
      output({ created, skipped }, opts.json, () =>
        [
          `${created.length} Zonen angelegt${created.length ? `: ${created.map((z) => z.name).join(", ")}` : ""}.`,
          ...skipped.map((s) => `Feature ${s.index} übersprungen: ${s.reason}`),
        ].join("\n"),
      );
      if (skipped.length) process.exitCode = 1;
      return;
    }
    case "overview": {
      const setId = requireSet(opts, "zone overview");
      const status = opts.status ?? "open,in_progress";
      const [zones, perZone] = await Promise.all([
        client.get<ZoneRead[]>("club", `/clubs/${clubId}/zone-sets/${setId}/zones`),
        client.get<ZoneTasks[]>(
          "task",
          `/tasks/zones/by-set/${setId}?club_id=${encodeURIComponent(clubId)}&status=open,in_progress,completed`,
        ),
      ]);
      const rows = overviewRows(zones, perZone, status);
      const names = new Map(zones.map((z) => [z.id, z.name]));
      const assigned = rows.filter((r) => r.state !== "keiner").length;
      const data = { zones: rows.map((r) => ({ zone_id: r.zone.id, name: r.zone.name, state: r.state, tasks: r.tasks })) };
      output(data, opts.json, () =>
        [
          `${assigned} von ${rows.length} Zonen zugeteilt (Filter: ${status})`,
          ...rows.flatMap((r) => [
            `\n${r.zone.name} — ${TEXT[r.state]}`,
            ...(r.tasks.length
              ? r.tasks.map((t) => {
                  const also = t.other_zone_ids.map((z) => names.get(z)).filter(Boolean);
                  const who = t.assignees.length ? `${t.assignees.length} zugewiesen` : "niemand zugewiesen";
                  return `  · ${t.title} [${t.status}]${also.length ? ` · auch ${also.join(", ")}` : ""} — ${who} (${t.id})`;
                })
              : ["  keine Aufgabe im Filter"]),
          ]),
        ].join("\n"),
      );
      return;
    }
    default:
      throw new ZoneInputError("zone <set …|list|create|update|estimate|delete|import|overview>");
  }
}

async function runTaskZones(
  taskId: string,
  action: string | undefined,
  zoneId: string | undefined,
  opts: ZoneCommandOpts,
): Promise<void> {
  const state = await loadState();
  const client = createClient(state);
  const clubId = requireClubId(state, opts.club);
  if (action === "add" || action === "remove") {
    if (!zoneId) throw new ZoneInputError(`task-zones <task-id> ${action} <zone-id>`);
    if (action === "add") {
      const row = await client.post<TaskZoneRead>("task", `/tasks/${taskId}/zones`, { zone_id: zoneId });
      output(row, opts.json, () => `Zone zugeteilt: ${zoneId}`);
    } else {
      await client.del("task", `/tasks/${taskId}/zones/${zoneId}`);
      output({ removed: zoneId }, opts.json, () => `Zone entfernt: ${zoneId}`);
    }
    return;
  }
  if (action !== undefined) throw new ZoneInputError("task-zones <task-id> [add|remove <zone-id>]");
  const rows = await client.get<TaskZoneRead[]>("task", `/tasks/${taskId}/zones`);
  const details = rows.length
    ? await client.get<ZoneRead[]>("club", `/clubs/${clubId}/zones?ids=${rows.map((r) => r.zone_id).join(",")}`)
    : [];
  const result = taskZoneRows(rows, details);
  output(result, opts.json, () =>
    result.length
      ? renderTable(result, [
          { header: "Zone", width: 34, get: (r) => `${r.name ?? "-"}${r.deleted ? " (gelöscht)" : ""}` },
          { header: "Einteilung", width: 24, get: (r) => r.zone_set_name ?? "-" },
          { header: "ID", width: 36, get: (r) => r.zone_id },
        ])
      : "Keine Zonen zugeteilt.",
  );
}

async function guarded(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (err instanceof ZoneInputError) {
      console.error(`\nEingabe ungültig: ${err.message}\n`);
      process.exit(2);
    }
    // 401 keeps the global login hint of main().
    if (err instanceof HttpError && err.status !== 401) {
      console.error(`\nAPI-Fehler: ${describeServiceError(err)}\n`);
      process.exit(1);
    }
    throw err;
  }
}

export function registerZoneCommands(cli: CAC): void {
  cli
    .command("zone [...args]", "Vereinsgebiet: set list|create|update|delete · list|create|update|estimate|delete · import · overview")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--set <id>", "Einteilung (zone-set-id)")
    .option("--name <v>", "Name der Einteilung bzw. Zone")
    .option("--center <lat,lng>", "Mittelpunkt der Einteilung")
    .option("--zoom <n>", "Zoom der Einteilung (3–21, Standard 16)")
    .option("--color <hex>", "Farbe der Zone (#RRGGBB)")
    .option("--geojson <datei>", "Polygon/MultiPolygon, Feature oder FeatureCollection (import)")
    .option("--status <liste>", "overview: open,in_progress,completed (Standard open,in_progress)")
    .option("--expected-version <n>", "update: erwartete Version (sonst aktuell gelesen)")
    .option("--building-count <n>", "update: Zahl der Gebäude (überschreibt die Schätzung; „leer“ löscht sie)")
    .option("--notes <text>", "update: Notiz zur Zone (leer löscht sie)")
    .option("--json", "JSON-Ausgabe (Rohantwort)")
    .action((args: string[], opts: ZoneCommandOpts) => guarded(() => runZone(args, opts)));

  cli
    .command("task-zones <taskId> [action] [zoneId]", "Zonen einer Aufgabe: anzeigen | add <zone-id> | remove <zone-id>")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--json", "JSON-Ausgabe (Rohantwort)")
    .action((taskId: string, action: string | undefined, zoneId: string | undefined, opts: ZoneCommandOpts) =>
      guarded(() => runTaskZones(taskId, action, zoneId, opts)),
    );
}
