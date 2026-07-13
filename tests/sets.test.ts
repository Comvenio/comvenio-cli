import { describe, expect, test } from "bun:test";

import { parseSetsNotation } from "../src/util/sets.ts";

describe("parseSetsNotation (K18)", () => {
  test("parses plain sets", () => {
    expect(parseSetsNotation("6:2,6:4")).toEqual([
      { home: 6, away: 2 },
      { home: 6, away: 4 },
    ]);
  });

  test("parses tiebreak details and match tiebreak (TC-18-01)", () => {
    expect(parseSetsNotation("7:6(9:7),1:6,MTB10:7")).toEqual([
      { home: 7, away: 6, tiebreak: { home: 9, away: 7 } },
      { home: 1, away: 6 },
      { home: 10, away: 7, type: "match_tiebreak" },
    ]);
  });

  test("tolerates whitespace and lowercase mtb", () => {
    expect(parseSetsNotation(" 6:3 , mtb2:10 ")).toEqual([
      { home: 6, away: 3 },
      { home: 2, away: 10, type: "match_tiebreak" },
    ]);
  });

  test("rejects invalid notation with a helpful example (TC-18-02)", () => {
    expect(() => parseSetsNotation("6-2")).toThrow(/Format: H:A/);
    expect(() => parseSetsNotation("")).toThrow(/Leere --sets/);
  });

  test("rejects tiebreak points on a match tiebreak entry", () => {
    expect(() => parseSetsNotation("MTB10:7(5:3)")).toThrow(/Match-Tiebreak/);
  });
});
