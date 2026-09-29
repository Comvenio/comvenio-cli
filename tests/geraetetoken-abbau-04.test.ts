// Device-token path removed from the CLI (geraetetoken-abbau-04, TC-01..TC-07).
// TC-08 (finance over the connector) is covered by finance-connector.test.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { PublicCliError } from "../src/errors.ts";
import {
  COMMAND_SURFACE,
  deviceBlockRemovedNotice,
  deviceTokenOptionError,
  unmatchedCommandError,
} from "../src/commands/removed.ts";

const ROOT = join(import.meta.dir, "..");
const GATEWAY = "https://api.comvenio.app";
const CONNECTOR = {
  clientId: "https://api.comvenio.app/auth/oauth/clients/comvenio-cli",
  resource: "https://mcp.comvenio.app/cli",
  scopes: ["club.read"],
};

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(ts|md|json)$/u.test(name)) out.push(path);
  }
  return out;
}

describe("TC-01: login without device token", () => {
  test("--device-token and the old alias --token end with USAGE_ERROR and point to comvenio login", () => {
    for (const options of [{ deviceToken: "cvn_x" }, { token: "cvn_x" }]) {
      const error = deviceTokenOptionError("login", options);
      expect(error).not.toBeNull();
      expect(error!.message).toContain("comvenio login");
    }
    expect(deviceTokenOptionError("login", { scopes: "club.read" })).toBeNull();
  });
});

describe("TC-02: no legacy import", () => {
  test("nothing under src/, packages/ or apps/ imports the legacy client or src/http.ts", () => {
    expect(existsSync(join(ROOT, "src/http.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "packages/comvenio-client/src/legacy.ts"))).toBe(false);
    const offenders = ["src", "packages", "apps"]
      .flatMap((dir) => files(join(ROOT, dir)))
      .filter((path) => path.endsWith(".ts"))
      .filter((path) => /from\s+["'][^"']*(\/legacy(\.ts)?|src\/http(\.ts)?|\.\.\/http(\.ts)?|\.\/http(\.ts)?)["']/u.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});

describe("TC-03: removed command", () => {
  test("comvenio member list is USAGE_ERROR with a pointer to comvenio action list", () => {
    const error = unmatchedCommandError(["member", "list"]);
    expect(error).toBeInstanceOf(PublicCliError);
    expect(error!.code).toBe("USAGE_ERROR");
    expect(error!.detail).toContain("comvenio action list");
  });
});

// State file lives under HOME; the module is imported per test home so the
// real sign-in is never touched (same pattern as anmeldewege.test.ts).
function withOwnHome() {
  const state = { home: "" };
  const saved: Record<string, string | undefined> = {};
  const keys = ["HOME", "USERPROFILE", "APPDATA"] as const;
  beforeEach(() => {
    state.home = mkdtempSync(join(tmpdir(), "comvenio-k4-"));
    for (const key of keys) { saved[key] = process.env[key]; process.env[key] = state.home; }
  });
  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    rmSync(state.home, { recursive: true, force: true });
  });
  return state;
}

describe("TC-04/TC-05: state file cleanup on the first start", () => {
  const z = withOwnHome();
  const auth = (mark: string) => import(`../src/auth.ts?${mark}=${encodeURIComponent(z.home)}`);
  const file = () => join(z.home, ".comvenio-cli-state.json");

  test("TC-04: a state file with only a device block is removed once, then nobody is signed in", async () => {
    const { removeDeviceBlock } = await auth("k4a");
    writeFileSync(file(), JSON.stringify({ schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod", device: { token: "cvn_abc" } }));

    expect(removeDeviceBlock()).toBe(true);
    expect(existsSync(file())).toBe(false);
    expect(removeDeviceBlock()).toBe(false);
    expect(deviceBlockRemovedNotice("de")).toContain("comvenio login");
  });

  test("TC-05: device block and OAuth connection — the connection stays, the block goes", async () => {
    const { removeDeviceBlock } = await auth("k4b");
    writeFileSync(file(), JSON.stringify({
      schemaVersion: 3, gatewayBaseUrl: GATEWAY, environment: "prod",
      device: { token: "cvn_abc", clubId: "c1" }, connector: CONNECTOR,
    }));

    expect(removeDeviceBlock()).toBe(true);
    const after = JSON.parse(readFileSync(file(), "utf8"));
    expect(after.device).toBeUndefined();
    expect(after.connector.resource).toBe(CONNECTOR.resource);
    expect(readFileSync(file(), "utf8")).not.toContain("cvn_");
  });
});

describe("TC-06: help", () => {
  test("the command surface is exactly master §0.4", () => {
    expect(COMMAND_SURFACE.map((entry) => entry.command)).toEqual(["login", "logout", "whoami", "action", "agent", "finance", "help"]);
  });
});

describe("TC-07: docs", () => {
  test("no customer doc names a device token or the oauth-only page", () => {
    const docs = files(join(ROOT, "docs")).filter((path) => path.endsWith(".md"));
    const hits = docs
      .filter((path) => /--device-token|\bcvn_[A-Za-z0-9]|fehler\/oauth-only/u.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path));
    expect(existsSync(join(ROOT, "docs/fehler/oauth-only.md"))).toBe(false);
    expect(hits).toEqual([]);
  });
});
