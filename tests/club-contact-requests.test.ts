import { describe, expect, test } from "bun:test";

import { contactRequestsPath } from "../src/commands/club.ts";

describe("club contact-requests paths", () => {
  test("lists open requests by default and honours the filter", () => {
    expect(contactRequestsPath("club-1")).toBe("/clubs/club-1/contact-requests?status=open");
    expect(contactRequestsPath("club-1", { status: "all" })).toBe("/clubs/club-1/contact-requests?status=all");
  });

  test("addresses a single request for done/reopen/delete", () => {
    expect(contactRequestsPath("club 1", { requestId: "r/1" })).toBe("/clubs/club%201/contact-requests/r%2F1");
  });

  test("rejects an unknown status before any request", () => {
    expect(() => contactRequestsPath("club-1", { status: "neu" })).toThrow("--status erwartet open, done oder all.");
  });
});
