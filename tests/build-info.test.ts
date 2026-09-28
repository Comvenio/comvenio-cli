import { describe, expect, test } from "bun:test";
import { cliVersion } from "../src/build-info.ts";
import { buildStamp } from "../scripts/build-cli.ts";

describe("build stamp in --version", () => {
  test("a built binary names date and commit, a source run says dev", () => {
    expect(cliVersion("0.1.0", "2026-09-29.abc1234")).toBe("0.1.0+2026-09-29.abc1234");
    expect(cliVersion("0.1.0", undefined)).toBe("0.1.0+dev");
    expect(cliVersion("0.1.0", " ")).toBe("0.1.0+dev");
  });

  test("the stamp is the UTC date and the short commit", () => {
    expect(buildStamp(new Date("2026-09-28T23:30:00Z"), "abc1234")).toBe("2026-09-28.abc1234");
  });
});
