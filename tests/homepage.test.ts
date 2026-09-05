import { describe, expect, test } from "bun:test";

import { addPreviewTtl, parsePreviewTtlHours } from "../src/commands/homepage.ts";

describe("homepage preview TTL", () => {
  test("keeps the backend default when omitted", () => {
    expect(parsePreviewTtlHours()).toBeUndefined();
  });

  test("accepts full hours up to 24", () => {
    expect(parsePreviewTtlHours("1")).toBe(1);
    expect(parsePreviewTtlHours("24")).toBe(24);
  });

  test("adds ttl_hours to the preview request body", () => {
    const body: Record<string, unknown> = { tabs: [{ slug: "start" }] };
    addPreviewTtl(body, "24");
    expect(body).toEqual({ tabs: [{ slug: "start" }], ttl_hours: 24 });
  });

  test("rejects values outside the public contract", () => {
    for (const value of ["0", "25", "1.5", "abc"]) {
      expect(() => parsePreviewTtlHours(value)).toThrow("zwischen 1 und 24");
    }
  });
});
