// Vereinsgebiet CLI (Lastenheft club/vereinsgebiet-zonen 04, TC-02…TC-09).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpError } from "../src/http.ts";
import {
  describeServiceError,
  geometryProblem,
  overviewRows,
  parseCenter,
  planImport,
  singleGeometry,
  taskZoneRows,
  ZoneInputError,
  zuteilung,
  type ZoneRead,
  type ZoneTaskItem,
} from "../src/commands/zone.ts";

const square = { type: "Polygon", coordinates: [[[12, 49], [12.001, 49], [12.001, 49.001], [12, 49]]] };
const zone = (id: string, name: string, sort_order: number, deleted = false): ZoneRead => ({
  id, zone_set_id: "s1", name, color: "#2f7ae5", geometry: square as ZoneRead["geometry"], sort_order, version: 1, deleted,
  zone_set_name: "Flyer",
});
const task = (status: string, assigned: boolean, other: string[] = []): ZoneTaskItem => ({
  id: `${status}-${assigned}`, title: status, status, due_date: null, other_zone_ids: other,
  assignees: assigned ? [{ member_id: "m1", is_responsible: true }] : [],
});

describe("zone geometry", () => {
  test("TC-02 accepts a Polygon, a Feature and a one-feature collection; rejects LineString before any call", () => {
    expect(singleGeometry(square)).toEqual(square as never);
    expect(singleGeometry({ type: "Feature", geometry: square })).toEqual(square as never);
    expect(singleGeometry({ type: "FeatureCollection", features: [{ geometry: square }] })).toEqual(square as never);
    expect(() => singleGeometry({ type: "LineString", coordinates: [[12, 49], [13, 49]] }, "weg.geojson")).toThrow(ZoneInputError);
    expect(() => singleGeometry({ type: "FeatureCollection", features: [{ geometry: square }, { geometry: square }] })).toThrow(/zone import/);
  });

  test("uses the club-service rules", () => {
    expect(geometryProblem(square)).toBeNull();
    expect(geometryProblem({ type: "Polygon", coordinates: [[[12, 49], [13, 49], [13, 50], [12, 50]]] })).toContain("nicht geschlossen");
    expect(geometryProblem({ type: "Polygon", coordinates: [[[200, 49], [13, 49], [13, 50], [200, 49]]] })).toContain("außerhalb");
    const many = Array.from({ length: 2000 }, (_, i) => [12 + i * 1e-5, 49]);
    expect(geometryProblem({ type: "Polygon", coordinates: [[...many, [12, 49]]] })).toContain("2000");
  });

  test("parses --center and rejects nonsense", () => {
    expect(parseCenter("48.89,12.37")).toEqual({ center_lat: 48.89, center_lng: 12.37 });
    expect(parseCenter(undefined)).toEqual({});
    expect(() => parseCenter("Mötzing")).toThrow(ZoneInputError);
  });
});

describe("zone import", () => {
  test("TC-03 three features, one invalid: two planned, one listed with its reason", () => {
    const plan = planImport({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "Nord", color: "#e0842b" }, geometry: square },
        { type: "Feature", properties: { name: "Weg" }, geometry: { type: "LineString", coordinates: [[12, 49], [13, 49]] } },
        { type: "Feature", properties: {}, geometry: square },
      ],
    });
    expect(plan.valid.map((f) => [f.index, f.name, f.color])).toEqual([[0, "Nord", "#e0842b"], [2, "Zone 3", undefined]]);
    expect(plan.skipped).toEqual([{ index: 1, reason: expect.stringContaining("LineString") }]);
    expect(() => planImport(square)).toThrow(ZoneInputError);
  });
});

describe("service errors", () => {
  test("TC-04 409 names live_version and the retry flag", () => {
    const err = new HttpError(409, JSON.stringify({ detail: { code: "zone_changed", live_version: 5 } }), "/clubs/c/zones/z");
    expect(describeServiceError(err)).toBe("HTTP 409 zone_changed · live_version=5 — erneut mit --expected-version 5");
  });

  test("TC-05 422 zone_set_mismatch names the set of the existing zones", () => {
    const err = new HttpError(422, JSON.stringify({ detail: { code: "zone_set_mismatch", zone_set_id: "s0" } }), "/tasks/t/zones");
    expect(describeServiceError(err)).toBe("HTTP 422 zone_set_mismatch · Einteilung der vorhandenen Zonen: s0");
    const geo = new HttpError(422, JSON.stringify({ detail: { code: "invalid_geometry", grund: "Ein Ring ist nicht geschlossen" } }), "/x");
    expect(describeServiceError(geo)).toBe("HTTP 422 invalid_geometry · Ein Ring ist nicht geschlossen");
  });
});

describe("task zones and overview", () => {
  test("TC-06 task zones keep deleted zones, marked", () => {
    const rows = taskZoneRows(
      [{ zone_id: "z1", zone_set_id: "s1", sort_order: 0 }, { zone_id: "z2", zone_set_id: "s1", sort_order: 1 }],
      [zone("z1", "Nord", 0), zone("z2", "Süd", 1, true)],
    );
    expect(rows.map((r) => [r.name, r.deleted])).toEqual([["Nord", false], ["Süd", true]]);
  });

  test("TC-07 overview orders like the web overview (unassigned first)", () => {
    const zones = [zone("z1", "A", 0), zone("z2", "B", 1), zone("z3", "C", 2), zone("z4", "D", 3)];
    const rows = overviewRows(
      zones,
      [
        { zone_id: "z1", tasks: [task("open", true)] },
        { zone_id: "z2", tasks: [task("in_progress", true)] },
        { zone_id: "z3", tasks: [task("open", false)] },
      ],
      "open,in_progress",
    );
    expect(rows.map((r) => [r.zone.name, r.state])).toEqual([["C", "keiner"], ["D", "keiner"], ["B", "arbeit"], ["A", "offen"]]);
  });

  test("the rule matches the web-page one", () => {
    const standard = new Set(["open", "in_progress"]);
    expect(zuteilung([task("completed", true)], standard)).toBe("keiner");
    expect(zuteilung([task("completed", true)], new Set(["open", "in_progress", "completed"]))).toBe("erledigt");
    expect(zuteilung([task("cancelled", true)], new Set(["cancelled"]))).toBe("keiner");
  });
});

describe("zone schema and docs", () => {
  const root = join(import.meta.dir, "..");
  const schema = JSON.parse(readFileSync(join(root, "src", "schema", "zone.json"), "utf8"));
  const source = readFileSync(join(root, "src", "commands", "zone.ts"), "utf8");
  const docs = readFileSync(join(root, "docs", "zonen.md"), "utf8");
  const reference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");

  test("TC-09 every command is documented, and every schema option is a real option", () => {
    const commands: string[] = Object.values(schema.commands as Record<string, string[]>).flat();
    for (const c of commands) {
      const head = c.split(" <")[0]!.split(" [")[0]!.split(" --")[0]!;
      expect(docs).toContain(`comvenio ${head}`);
    }
    for (const option of schema.options as string[]) expect(source).toContain(`.option("${option}`);
    expect(reference).toContain("[`zonen.md`](zonen.md)");
  });

  test("TC-08 --json is offered on both commands", () => {
    expect(source.match(/\.option\("--json"/g)?.length).toBe(2);
  });
});
