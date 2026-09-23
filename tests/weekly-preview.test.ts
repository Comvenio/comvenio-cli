import { describe, expect, test } from "bun:test";

import { buildTemplateBody, templateListPath, templatePath } from "../src/commands/weekly-preview.ts";

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
