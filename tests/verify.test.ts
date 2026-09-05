import { describe, expect, test } from "bun:test";
import {
  actionableConsoleErrors,
  applyFrontendBase,
  artifactSegment,
  classifyVerificationExit,
  failedSameOriginRequests,
  normalizeHomepageTabs,
  resolveLiveHomepageUrl,
  sanitizeArtifactUrl,
  selectHomepageViewports,
  withImprintRoute,
  withTabQuery,
} from "../src/verify/homepage.ts";

describe("preview URL against a different renderer", () => {
  // Befund 2026-08-27: --frontend-base wurde beim Entwurfsweg still geschluckt.
  // Der Lauf rendert dann die DEPLOYTE App, waehrend man glaubt, den lokalen
  // Stand zu pruefen — und schliesst aus dem leeren Ergebnis, der eigene Code
  // sei kaputt. Genau das ist passiert.
  const vorschau =
    "https://web.comvenio.app/home-preview/8d61babd-47ab-406e-b823-0dc04cf03f6b/63a79858-174e-4e5f-824f-190caca5f829";

  test("keeps path and swaps the origin", () => {
    expect(applyFrontendBase(vorschau, "http://localhost:5173")).toBe(
      "http://localhost:5173/home-preview/8d61babd-47ab-406e-b823-0dc04cf03f6b/63a79858-174e-4e5f-824f-190caca5f829",
    );
  });

  test("carries the query along", () => {
    expect(applyFrontendBase(`${vorschau}?tab=start`, "http://localhost:5173")).toBe(
      "http://localhost:5173/home-preview/8d61babd-47ab-406e-b823-0dc04cf03f6b/63a79858-174e-4e5f-824f-190caca5f829?tab=start",
    );
  });

  test("a trailing slash on the base does not double up", () => {
    expect(applyFrontendBase(vorschau, "http://localhost:5173/")).toBe(
      "http://localhost:5173/home-preview/8d61babd-47ab-406e-b823-0dc04cf03f6b/63a79858-174e-4e5f-824f-190caca5f829",
    );
  });

  test("the hosted default leaves the URL as it was", () => {
    // Gegenprobe: Ohne Override darf sich nichts aendern — sonst waere die
    // Reparatur eine Verhaltensaenderung fuer jeden bestehenden Aufruf.
    expect(applyFrontendBase(vorschau, "https://web.comvenio.app")).toBe(vorschau);
  });

  test("a base with a port and a path prefix is honoured", () => {
    expect(applyFrontendBase(vorschau, "http://127.0.0.1:4173")).toBe(
      "http://127.0.0.1:4173/home-preview/8d61babd-47ab-406e-b823-0dc04cf03f6b/63a79858-174e-4e5f-824f-190caca5f829",
    );
  });
});

describe("homepage verifier contract", () => {
  test("uses Club.subdomain for the managed live homepage address", () => {
    expect(resolveLiveHomepageUrl("prod", {
      subdomain: "sv-motzing",
      slug: "technical-club-id",
    })).toBe("https://sv-motzing.web.comvenio.app");
    expect(resolveLiveHomepageUrl("dev", {
      subdomain: "sv-motzing",
      slug: "technical-club-id",
    })).toBe("https://sv-motzing.web.dev.comvenio.app");
  });

  test("does not fall back to technical club identifiers", () => {
    expect(() => resolveLiveHomepageUrl("prod", {
      slug: "technical-slug",
      handle: "legacy-handle",
      public_slug: "legacy-public-slug",
    })).toThrow("noch keine Comvenio-Adresse");
  });

  test("rejects an invalid stored subdomain instead of building an unsafe URL", () => {
    expect(() => resolveLiveHomepageUrl("prod", {
      subdomain: "sv-motzing.example",
    })).toThrow("kein gültiges DNS-Label");
  });

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
  test("builds live and preview imprint routes deterministically", () => {
    expect(withImprintRoute("https://sv.example/?tab=start"))
      .toBe("https://sv.example/impressum");
    expect(withImprintRoute("https://app.comvenio.app/home-preview/club-1/preview-1?tab=start"))
      .toBe("https://app.comvenio.app/home-preview/club-1/preview-1?page=impressum");
  });
});
