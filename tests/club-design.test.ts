import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildClubDesignSettings,
  buildPublicHeaderPatch,
  validatePublicHeader,
} from "../src/commands/club.ts";

describe("club design public header", () => {
  test("builds the same nested values used by design JSON", () => {
    expect(buildPublicHeaderPatch({
      headerLayout: "brand-left",
      headerSurface: "dark",
      headerDensity: "comfortable",
      headerSticky: "false",
    })).toEqual({
      layout: "brand-left",
      surface: "dark",
      density: "comfortable",
      sticky: false,
    });
  });

  test("accepts partial valid configuration", () => {
    expect(() => validatePublicHeader({ surface: "brand" })).not.toThrow();
    expect(() => validatePublicHeader(null)).not.toThrow();
  });

  test("rejects unknown enums and inert boolean strings", () => {
    expect(() => validatePublicHeader({ layout: "centered" })).toThrow("Ungueltiges Header-Layout");
    expect(() => validatePublicHeader({ surface: 4 })).toThrow("Ungueltige Header-Oberflaeche");
    expect(() => validatePublicHeader({ sticky: "true" })).toThrow("muss Boolean sein");
    expect(() => buildPublicHeaderPatch({ headerSticky: "yes" })).toThrow("muss true oder false sein");
  });

  test("builds an identical dry-run payload from flags and a design file", () => {
    const fromFlags = buildClubDesignSettings({
      publicTemplate: "flex",
      headerLayout: "brand-left",
      headerSurface: "dark",
      headerDensity: "comfortable",
      headerSticky: "false",
    });
    const dir = mkdtempSync(join(import.meta.dir, ".tmp-comvenio-design-"));
    const file = join(dir, "design.json");
    try {
      writeFileSync(file, JSON.stringify(fromFlags), "utf8");
      expect(buildClubDesignSettings({ file })).toEqual(fromFlags);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves file-based nested config when a header flag is applied", () => {
    const dir = mkdtempSync(join(import.meta.dir, ".tmp-comvenio-design-"));
    const file = join(dir, "design.json");
    try {
      writeFileSync(file, JSON.stringify({
        homepage_template: "flex",
        custom_template_config: {
          hero: { variant: "image" },
          public_header: { layout: "navigation", surface: "light" },
        },
      }), "utf8");

      expect(buildClubDesignSettings({ file, headerSurface: "brand" })).toEqual({
        homepage_template: "flex",
        custom_template_config: {
          hero: { variant: "image" },
          public_header: { layout: "navigation", surface: "brand" },
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("emits the explicit null restore marker", () => {
    expect(buildClubDesignSettings({ clearHeader: true })).toEqual({
      custom_template_config: { public_header: null },
    });
    expect(() => buildPublicHeaderPatch({
      clearHeader: true,
      headerLayout: "navigation",
    })).toThrow("nicht mit anderen Header-Optionen");
  });
});
