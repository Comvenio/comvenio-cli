import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "src", "schema", `${name}.json`), "utf8"));

describe("homepage schema", () => {
  const homepage = schema("homepage");

  test("mirrors all homepage vocabularies", () => {
    expect(homepage.widget_count).toBe(69);
    expect(homepage.widget_kinds).toContain("event_hub_embed");
    expect(homepage.templates).toContain("flex");
    expect(homepage.vocabulary_sync.missing_in_backend).toEqual([]);
    expect(homepage.vocabulary_sync.missing_in_prompt).toEqual([]);
    expect(homepage.preview_contract.no_live_write).toBe(true);
    expect(homepage.preview_contract.design_snapshot_version).toBe(1);
  });

  test("publishes all section layouts and styles", () => {
    expect(homepage.structure.section.layout_enum).toHaveLength(8);
    expect(homepage.structure.section.style_variant_enum).toHaveLength(7);
  });
});

describe("design schema", () => {
  const design = schema("design");

  test("publishes recipes, body surface and media focus", () => {
    expect(design.look_recipes).toHaveLength(5);
    expect(design.config.look_recipe_id.values).toContain("sport-editorial");
    expect(design.config.bodySurface.values).toEqual(["light", "dark"]);
    expect(design.config.media.focus.default).toEqual({ x: 50, y: 50 });
  });
});
