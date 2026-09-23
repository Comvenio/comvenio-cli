import { describe, expect, test } from "bun:test";

import { buildCreateBody, buildTemplateBody, shareUrlFor, templateListPath, templatePath } from "../src/commands/weekly-preview.ts";

describe("weekly-preview template routes", () => {
  test("maps to the event-service template endpoints", () => {
    expect(templateListPath("c1")).toBe("/weekly-preview-templates/club/c1");
    expect(templateListPath("c1", "d 1")).toBe("/weekly-preview-templates/club/c1?department_id=d%201");
    expect(templatePath("c1", "t1")).toBe("/weekly-preview-templates/club/c1/t1");
  });

  test("create needs a name and may carry the department", () => {
    expect(() => buildTemplateBody({}, undefined, true)).toThrow("--name");
    expect(buildTemplateBody({ name: "Jugend", department: "d1" }, { headline: "U-Teams" }, true)).toEqual({
      name: "Jugend",
      department_id: "d1",
      design_config: { headline: "U-Teams" },
    });
  });

  test("update is partial and never moves the department", () => {
    expect(buildTemplateBody({ name: "Neu" }, undefined, false)).toEqual({ name: "Neu" });
    expect(() => buildTemplateBody({ department: "d2" }, undefined, false)).toThrow("--department");
    expect(() => buildTemplateBody({}, undefined, false)).toThrow("Nichts zu ändern");
  });
});

describe("weekly-preview create (Funktion)", () => {
  test("baut den Aufruf mit Abteilung, optionalen Teams und Zeitraum", () => {
    expect(buildCreateBody({ department: "d1" })).toEqual({ department_id: "d1", team_ids: [], range: "next_week", telegram: false });
    expect(buildCreateBody({ department: "d1", teams: "t1, t2", range: "next_7_days", telegram: true })).toEqual({
      department_id: "d1",
      team_ids: ["t1", "t2"],
      range: "next_7_days",
      telegram: true,
    });
  });

  test("verlangt eine Abteilung und einen gültigen Zeitraum", () => {
    expect(() => buildCreateBody({})).toThrow("--department");
    expect(() => buildCreateBody({ department: "d1", range: "morgen" })).toThrow("--range");
  });

  test("baut den Share-Link über das Gateway", () => {
    expect(shareUrlFor("https://api.comvenio.app/", "a b")).toBe("https://api.comvenio.app/event/share/weekly-preview/a%20b");
  });
});
