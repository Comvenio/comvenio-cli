import { describe, expect, test } from "bun:test";
import {
  actionableConsoleErrors,
  artifactSegment,
  classifyVerificationExit,
  failedSameOriginRequests,
  normalizeHomepageTabs,
  sanitizeArtifactUrl,
  selectHomepageViewports,
  withTabQuery,
} from "../src/verify/homepage.ts";

describe("homepage verifier contract", () => {
  test("normalizes active public tabs in stable position order", () => {
    expect(normalizeHomepageTabs([
      { label: "Team", slug: "team", position: 2 },
      { label: "Intern", slug: "intern", position: 0, visibility_scope: "member" },
      { label: "Start", slug: "start", position: 1 },
      { label: "Alt", slug: "alt", position: 0, is_active: false },
    ])).toEqual([
      { label: "Start", slug: "start" },
      { label: "Team", slug: "team" },
    ]);
  });

  test("builds deterministic tab URLs and removes secrets from reports", () => {
    expect(withTabQuery("https://club.example/?token=secret", "jugend"))
      .toBe("https://club.example/?token=secret&tab=jugend");
    expect(sanitizeArtifactUrl("https://club.example/?token=secret&tab=jugend"))
      .toBe("https://club.example/?tab=jugend");
    expect(artifactSegment("\u00c4ltere Herren / \u00dc40")).toBe("ltere-herren-40");
  });

  test("uses the required four-viewport matrix by default", () => {
    expect(selectHomepageViewports()).toHaveLength(4);
    expect(selectHomepageViewports(true, false).map((item) => item.width)).toEqual([1024, 1440]);
    expect(selectHomepageViewports(false, true).map((item) => item.width)).toEqual([390, 768]);
  });

  test("distinguishes incomplete runs from actionable findings", () => {
    expect(classifyVerificationExit(false, 0)).toBe(0);
    expect(classifyVerificationExit(false, 1)).toBe(4);
    expect(classifyVerificationExit(true, 0)).toBe(2);
    expect(classifyVerificationExit(true, 5)).toBe(2);
  });

  test("filters fixed noise but keeps browser and same-origin failures", () => {
    expect(actionableConsoleErrors("favicon.ico failed\nUnhandled application error"))
      .toEqual(["Unhandled application error"]);
    expect(failedSameOriginRequests(
      "[500] GET https://club.example/api/home\n[404] GET https://cdn.example/image.png\n[404] GET https://club.example/favicon.ico",
      "https://club.example/",
    )).toEqual(["[500] GET https://club.example/api/home"]);
  });
});
