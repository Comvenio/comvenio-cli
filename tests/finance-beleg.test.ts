import { describe, expect, test } from "bun:test";

import { belegVerein } from "../src/commands/finance-beleg.ts";

// belegerfassung-01/-03: the file goes to the content-service with the device
// token, the finance step over OAuth — only when both mean the same club.
describe("finance beleg-hochladen: der Verein", () => {
  const verein = "0ec34e70-999a-47c4-a1b1-bdb293110fa5";
  test("Gerät und OAuth im selben Verein", () => {
    expect(belegVerein({ hasDeviceToken: true, clubId: verein, oauth: { clubId: verein } as never })).toBe(verein);
  });
  test("verschiedene Vereine laden nichts hoch", () => {
    expect(() => belegVerein({ hasDeviceToken: true, clubId: verein, oauth: { clubId: "9ea9d95a-0c79-4efb-b873-696fc07cfd96" } as never }))
      .toThrow("verschiedene Vereine");
  });
  test("ohne Geräte-Token kein Upload", () => {
    expect(() => belegVerein({ hasDeviceToken: false, clubId: verein, oauth: { clubId: verein } as never })).toThrow("Geräte-Token");
  });
});
