import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildContractVersionUpdateBody,
  contractVersionPath,
  sponsorDeletePath,
} from "../src/commands/sponsor.ts";


describe("sponsor CLI route contracts", () => {
  test("maps sponsor and contract-version deletes to marketing routes", () => {
    expect(sponsorDeletePath("sponsor-1")).toBe("/advertisers/sponsor-1");
    expect(contractVersionPath("product-1", "version-1")).toBe(
      "/club-sponsorship-products/product-1/contract-versions/version-1",
    );
  });

  test("builds a partial contract-version update body", () => {
    expect(buildContractVersionUpdateBody({
      priceCents: "12500",
      durationMonths: "24",
      validUntil: "2028-01-01T00:00:00Z",
      note: "Korrigierte Konditionen",
    })).toEqual({
      unit_price_cents: 12500,
      duration_months: 24,
      valid_until: "2028-01-01T00:00:00Z",
      note: "Korrigierte Konditionen",
    });
  });
});


describe("sponsor machine-readable schema", () => {
  test("publishes sponsor and contract-version delete/update workflows", () => {
    const schema = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "src", "schema", "sponsor.json"), "utf8"),
    );

    expect(schema.commands.sponsors).toContain("sponsor delete <sponsor-id>");
    expect(schema.commands.contracts.some((command: string) => command.includes("contract-update"))).toBe(true);
    expect(schema.commands.contracts.some((command: string) => command.includes("contract-delete"))).toBe(true);
  });
});
