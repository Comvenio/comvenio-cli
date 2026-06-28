import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient, type ComvenioClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { prune } from "../util/body.ts";

// Geländeplan-Endpoints im event-service (Router-Prefix /events, verifiziert app/routes/event_map.py).
// Map-Bodies tragen KEIN club_id — das Backend leitet es aus dem Event/Plan ab.
//   GET   /event/events/{event_id}/map-plans            Plan-Liste (scoped: Parent + Festtag)
//   POST  /event/events/{event_id}/map-plans            EventMapPlanCreate
//   GET   /event/events/map-plans/{plan_id}/map         Aggregat: plan, zones, legacy_areas, tables, markers
//   POST  /event/events/map-zones                       EventMapZoneCreate (Umriss/Bereich)
//   POST  /event/events/map-zones/{zone_id}/detail-plan EventMapDetailPlanCreate (Gebäude-Canvas)
//   POST  /event/events/tables                          EventTableCreate (Garnitur/Innenplanung)
//   POST  /event/events/tables/{table_id}/duplicate
//   POST  /event/events/map-markers                     EventMapMarkerCreate

type Plan = {
  id?: string;
  event_id?: string;
  name?: string;
  plan_type?: string;
  crs_mode?: string;
  center_lat?: number | null;
  center_lng?: number | null;
  real_width_m?: number | null;
  real_height_m?: number | null;
  bounds_radius_m?: number | null;
  [k: string]: unknown;
};
type Zone = {
  id?: string;
  name?: string;
  shape_type?: string;
  length_m?: number | null;
  width_m?: number | null;
  rotation?: number | null;
  detail_plan_id?: string | null;
  [k: string]: unknown;
};
type TableRow = {
  id?: string;
  label?: string;
  number?: number | null;
  length_m?: number | null;
  width_m?: number | null;
  furniture_type?: string;
  assignment_type?: string;
  [k: string]: unknown;
};
type Marker = { id?: string; marker_type?: string; label?: string; [k: string]: unknown };
type Aggregate = {
  plan?: Plan;
  zones?: Zone[];
  legacy_areas?: unknown[];
  tables?: TableRow[];
  markers?: Marker[];
};

type Opts = {
  json?: boolean;
  name?: string;
  type?: string;
  length?: string;
  width?: string;
  rotation?: string;
  lat?: string;
  lng?: string;
  posX?: string;
  posY?: string;
  color?: string;
  capacity?: string;
  furniture?: string;
  label?: string;
  markerType?: string;
  logo?: string;
};

const num = (v: string | undefined): number | undefined =>
  v === undefined || v === "" ? undefined : Number(v);

/**
 * Rechteck-Umriss als GeoJSON-Polygon ([lng,lat]) um einen geo-Center, aus Länge/Breite (m) +
 * Rotation (Grad). So kann ein Agent einen maßstäblichen Bereich setzen, ohne auf der Karte zu klicken.
 */
function rectangleGeoJson(
  lat: number,
  lng: number,
  lengthM: number,
  widthM: number,
  rotationDeg: number,
): string {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfL = lengthM / 2;
  const halfW = widthM / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const ring = (
    [
      [-halfL, -halfW],
      [halfL, -halfW],
      [halfL, halfW],
      [-halfL, halfW],
    ] as [number, number][]
  ).map(([x, y]) => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return [lng + rx / mPerDegLng, lat + ry / mPerDegLat];
  });
  ring.push(ring[0]!); // GeoJSON-Ring schließen
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

const fetchPlan = (client: ComvenioClient, planId: string): Promise<Aggregate> =>
  client.get<Aggregate>("event", `/events/map-plans/${planId}/map`);

// Position-Payload je nach crs_mode: geo → {lat,lng}; image → {pos_x,pos_y}.
function positionPayload(o: Opts, crsMode: string | undefined): Record<string, unknown> {
  if (o.posX !== undefined || o.posY !== undefined || crsMode === "image") {
    return { pos_x: num(o.posX), pos_y: num(o.posY) };
  }
  return { lat: num(o.lat), lng: num(o.lng) };
}

/**
 * `comvenio plan <action> [arg1] [arg2]` — Geländeplan lesen + planen (agent-tauglich, --json).
 *   plan list <event-id> | plan show <plan-id> | plan create <event-id> --name
 *   plan zone create|list <plan-id> | plan table create|duplicate <plan-id|table-id>
 *   plan marker create <plan-id> | plan detail <zone-id>
 */
export function registerPlanCommands(cli: CAC): void {
  cli
    .command(
      "plan <action> [arg1] [arg2]",
      "Geländeplan: list|show|create | zone create/list | table create/duplicate | marker create | detail",
    )
    .option("--name <v>", "Name (plan/zone create)")
    .option("--type <v>", "Plan-Typ: gelaende|fluchtplan|festumzug|sonstiges")
    .option("--length <m>", "Länge (m) — Rechteck-Bereich / Garnitur")
    .option("--width <m>", "Breite (m)")
    .option("--rotation <deg>", "Drehung (Grad, 90er-Schritte)")
    .option("--lat <v>", "Breitengrad (geo-Position)")
    .option("--lng <v>", "Längengrad (geo-Position)")
    .option("--pos-x <v>", "X-Pixel (image-/Canvas-Position)")
    .option("--pos-y <v>", "Y-Pixel")
    .option("--color <v>", "Farbe (zone)")
    .option("--capacity <n>", "Plätze (table)")
    .option("--furniture <v>", "Garnitur-Typ: beer_set|round|standing|square|custom")
    .option("--label <v>", "Label (table/marker), z. B. 'Parken 1'")
    .option("--marker-type <v>", "Marker-Typ: entrance|toilet|parking|stage|taxi|dropoff|info|other")
    .option("--logo <file-id>", "Logo-File-ID (marker)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(
      async (
        action: string,
        arg1: string | undefined,
        arg2: string | undefined,
        opts: Opts,
      ) => {
        const state = loadState();
        const client = createClient(state);

        // ── plan zone <sub> <plan-id> ──────────────────────────
        if (action === "zone") {
          const sub = arg1;
          const planId = arg2;
          if (!planId) throw new Error("plan zone <sub> benoetigt eine <plan-id>.");
          if (sub === "list") {
            const agg = await fetchPlan(client, planId);
            const zones = agg.zones ?? [];
            output(zones, opts.json, () =>
              zones.length
                ? renderTable(zones, [
                    { header: "ID", width: 36, get: (z) => String(z.id ?? "") },
                    { header: "Name", width: 20, get: (z) => String(z.name ?? "—") },
                    { header: "Form", width: 9, get: (z) => String(z.shape_type ?? "—") },
                    { header: "L×B (m)", width: 12, get: (z) => (z.length_m ? `${z.length_m}×${z.width_m}` : "—") },
                    { header: "Detailplan", width: 10, get: (z) => (z.detail_plan_id ? "ja" : "—") },
                  ])
                : "Keine Bereiche.",
            );
            return;
          }
          if (sub === "create") {
            if (!opts.length || !opts.width) {
              throw new Error("plan zone create benoetigt --length <m> und --width <m> (Rechteck-Bereich).");
            }
            const agg = await fetchPlan(client, planId);
            const plan = agg.plan ?? {};
            const lat = num(opts.lat) ?? plan.center_lat ?? undefined;
            const lng = num(opts.lng) ?? plan.center_lng ?? undefined;
            if (lat === undefined || lng === undefined) {
              throw new Error("Kein Center: --lat/--lng angeben oder einen geo-Plan mit center_lat/lng verwenden.");
            }
            const rotation = num(opts.rotation) ?? 0;
            const geometry = rectangleGeoJson(lat, lng, num(opts.length)!, num(opts.width)!, rotation);
            const body = prune({
              plan_id: planId,
              name: opts.name,
              color: opts.color,
              geometry,
              crs_mode: "geo",
              shape_type: "polygon",
              length_m: num(opts.length),
              width_m: num(opts.width),
              rotation,
            });
            const zone = await client.post<Zone>("event", "/events/map-zones", body);
            output(zone, opts.json, () =>
              `Bereich angelegt: ${zone.name ?? "—"} (${zone.id}) ${opts.length}×${opts.width} m`,
            );
            return;
          }
          throw new Error(`Unbekannte plan-zone-Aktion "${sub}". Verfuegbar: list, create`);
        }

        // ── plan table <sub> <plan-id|table-id> ────────────────
        if (action === "table") {
          const sub = arg1;
          if (sub === "duplicate") {
            const tableId = arg2;
            if (!tableId) throw new Error("plan table duplicate benoetigt eine <table-id>.");
            const t = await client.post<TableRow>("event", `/events/tables/${tableId}/duplicate`);
            output(t, opts.json, () => `Garnitur dupliziert: ${t.id}`);
            return;
          }
          if (sub === "create") {
            const planId = arg2;
            if (!planId) throw new Error("plan table create benoetigt eine <plan-id>.");
            const agg = await fetchPlan(client, planId);
            const plan = agg.plan ?? {};
            if (!plan.event_id) throw new Error("Plan ohne event_id — Aggregat unvollstaendig.");
            const body = prune({
              event_id: plan.event_id,
              plan_id: planId,
              capacity: num(opts.capacity),
              length_m: num(opts.length),
              width_m: num(opts.width),
              rotation: num(opts.rotation),
              furniture_type: opts.furniture,
              assignment_type: "free",
              assignment_label: opts.label,
              ...positionPayload(opts, plan.crs_mode),
            });
            const t = await client.post<TableRow>("event", "/events/tables", body);
            output(t, opts.json, () => `Garnitur angelegt: ${t.label ?? t.id} (${t.id})`);
            return;
          }
          throw new Error(`Unbekannte plan-table-Aktion "${sub}". Verfuegbar: create, duplicate`);
        }

        // ── plan marker create <plan-id> ───────────────────────
        if (action === "marker") {
          const sub = arg1;
          const planId = arg2;
          if (sub !== "create") throw new Error(`Unbekannte plan-marker-Aktion "${sub}". Verfuegbar: create`);
          if (!planId) throw new Error("plan marker create benoetigt eine <plan-id>.");
          if (!opts.markerType) throw new Error("plan marker create benoetigt --marker-type <v>.");
          const agg = await fetchPlan(client, planId);
          const plan = agg.plan ?? {};
          if (!plan.event_id) throw new Error("Plan ohne event_id — Aggregat unvollstaendig.");
          const body = prune({
            event_id: plan.event_id,
            plan_id: planId,
            marker_type: opts.markerType,
            label: opts.label,
            logo_file_id: opts.logo,
            ...positionPayload(opts, plan.crs_mode),
          });
          const m = await client.post<Marker>("event", "/events/map-markers", body);
          output(m, opts.json, () => `Marker gesetzt: ${m.label ?? m.marker_type} (${m.id})`);
          return;
        }

        // ── plan detail <zone-id> — Gebäude-Canvas-Detailplan ──
        if (action === "detail") {
          const zoneId = arg1;
          if (!zoneId) throw new Error("plan detail benoetigt eine <zone-id>.");
          // Gebäude-Canvas: crs_mode=image OHNE Bild → das Frontend rendert ein Raster (Größe aus real-Maßen).
          const body = prune({
            name: opts.name,
            background_type: "image",
            crs_mode: "image",
            real_width_m: num(opts.length),
            real_height_m: num(opts.width),
          });
          const p = await client.post<Plan>("event", `/events/map-zones/${zoneId}/detail-plan`, body);
          output(p, opts.json, () => `Detailplan (Gebäude-Canvas) angelegt: ${p.name ?? p.id} (${p.id})`);
          return;
        }

        // ── plan list|show|create ──────────────────────────────
        switch (action) {
          case "list": {
            const eventId = arg1;
            if (!eventId) throw new Error("plan list benoetigt eine <event-id>.");
            const plans = await client.get<Plan[]>("event", `/events/${eventId}/map-plans`);
            output(plans, opts.json, () =>
              plans.length
                ? renderTable(plans, [
                    { header: "ID", width: 36, get: (p) => String(p.id ?? "") },
                    { header: "Name", width: 20, get: (p) => String(p.name ?? "—") },
                    { header: "Typ", width: 12, get: (p) => String(p.plan_type ?? "—") },
                    { header: "CRS", width: 6, get: (p) => String(p.crs_mode ?? "—") },
                  ])
                : "Keine Pläne.",
            );
            break;
          }
          case "show": {
            const planId = arg1;
            if (!planId) throw new Error("plan show benoetigt eine <plan-id>.");
            const agg = await fetchPlan(client, planId);
            // Volles Layout = Planungs-Preview für den Agenten (--json liefert das komplette Aggregat).
            output(agg, opts.json, () => {
              const p = agg.plan ?? {};
              return [
                `Plan:      ${p.name ?? "—"} (${p.id ?? planId})`,
                `Typ/CRS:   ${p.plan_type ?? "—"} / ${p.crs_mode ?? "—"}`,
                `Center:    ${p.center_lat ?? "—"}, ${p.center_lng ?? "—"}`,
                `Bereiche:  ${agg.zones?.length ?? 0}`,
                `Garnituren:${agg.tables?.length ?? 0}`,
                `Marker:    ${agg.markers?.length ?? 0}`,
              ].join("\n");
            });
            break;
          }
          case "create": {
            const eventId = arg1;
            if (!eventId) throw new Error("plan create benoetigt eine <event-id> (Parent = allgemein, Child = Festtag).");
            if (!opts.name) throw new Error("plan create benoetigt --name <v>.");
            const body = prune({
              name: opts.name,
              plan_type: opts.type ?? "gelaende",
              background_type: "satellite",
              crs_mode: "geo",
              center_lat: num(opts.lat),
              center_lng: num(opts.lng),
            });
            const p = await client.post<Plan>("event", `/events/${eventId}/map-plans`, body);
            output(p, opts.json, () => `Plan angelegt: ${p.name} (${p.id})`);
            break;
          }
          default:
            throw new Error(
              `Unbekannte Aktion "${action}". Verfuegbar: list, show, create, zone, table, marker, detail`,
            );
        }
      },
    );
}
