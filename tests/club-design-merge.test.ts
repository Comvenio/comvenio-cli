import { describe, expect, test } from "bun:test";

import { landingSurvives, survivingLiveDesignKeys } from "../src/commands/club.ts";

// Found 2026-09-19 (Jagabluat): club design deep-merges; a live `landing: true`
// that the file did not mention hid the public header live, the preview did not.
describe("club design --file: what the deep-merge keeps from the live state", () => {
  const live = {
    homepage_template: "flex",
    logo_url: null,
    custom_css: ".old{}",
    custom_template_config: { landing: true, hero: { type: "video" }, public_header: { layout: "brand-left" } },
  };

  test("names live keys the file does not mention, top level and inside custom_template_config", () => {
    const file = { homepage_template: "flex", custom_template_config: { public_header: { layout: "brand-left" } } };

    expect(survivingLiveDesignKeys(live, file)).toEqual([
      "custom_css",
      "custom_template_config.hero",
      "custom_template_config.landing",
    ]);
  });

  test("warns about a surviving landing mode only when the file is silent about it", () => {
    expect(landingSurvives(live, { custom_template_config: {} })).toBe(true);
    expect(landingSurvives(live, { custom_template_config: { landing: false } })).toBe(false);
    expect(landingSurvives({ custom_template_config: { landing: false } }, {})).toBe(false);
  });

  test("nothing survives when the file covers every live key", () => {
    const full = { homepage_template: "flex", custom_css: "", custom_template_config: { landing: false, hero: {}, public_header: {} } };
    expect(survivingLiveDesignKeys(live, full)).toEqual([]);
    expect(survivingLiveDesignKeys(undefined, full)).toEqual([]);
  });
});
