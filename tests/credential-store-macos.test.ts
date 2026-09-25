import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import { macosCredentialCommand } from "../src/oauth/credential-store.ts";

// 2026-09-25, first Mac: `comvenio login` connected, but the keychain entry stayed empty —
// `security add-generic-password -w` prompted on the terminal instead of reading the pipe.

/** Stands in for macOS `security`, including the line limit that `-i` enforces. */
function fakeSecurity() {
  const items = new Map<string, string>();
  const fail = (): never => { throw Object.assign(new Error("security failed"), { status: 1 }); };
  const run = (program: string, args: string[], options?: { input?: string }) => {
    expect(program).toBe("security");
    const account = String(args[args.indexOf("-a") + 1]);
    if (args[0] === "-i") {
      const line = String(options?.input);
      if (Buffer.byteLength(line) > 4096) fail();
      const match = /^add-generic-password -U -s \S+ -a (\S+) -w (.*)\n$/.exec(line) ?? fail();
      items.set(String(match[1]), JSON.parse(String(match[2])));
      return "";
    }
    if (args[0] === "find-generic-password") return items.get(account) ?? fail();
    if (args[0] === "delete-generic-password") return items.delete(account) ? "" : fail();
    return fail();
  };
  return { items, run };
}
const credentials = (tokenLength: number) => JSON.stringify({
  accessToken: "a".repeat(tokenLength), refreshToken: "r".repeat(tokenLength), accessExpiresAt: 1_900_000_000,
});

test("keeps short credentials in one keychain entry, never in argv", () => {
  const security = fakeSecurity(), value = credentials(64);
  macosCredentialCommand("write", value, "default", security.run);
  expect([...security.items.keys()]).toEqual(["default"]);
  expect(macosCredentialCommand("read", undefined, "default", security.run)).toBe(value);
});

test("splits credentials beyond the line limit and reads them back whole", () => {
  const security = fakeSecurity(), value = credentials(8_192);
  macosCredentialCommand("write", value, "default", security.run);
  expect(security.items.size).toBeGreaterThan(2);
  expect(security.items.get("default")).toMatch(/^comvenio-parts-v1:\d+:[a-f0-9]{64}$/);
  expect(macosCredentialCommand("read", undefined, "default", security.run)).toBe(value);
});

test("drops parts that shorter credentials no longer need; delete leaves nothing", () => {
  const security = fakeSecurity();
  macosCredentialCommand("write", credentials(8_192), "default", security.run);
  macosCredentialCommand("write", credentials(64), "default", security.run);
  expect([...security.items.keys()]).toEqual(["default"]);
  macosCredentialCommand("delete", undefined, "default", security.run);
  expect(security.items.size).toBe(0);
  expect(macosCredentialCommand("read", undefined, "default", security.run)).toBe("");
});

test("refuses parts that do not match their head", () => {
  const security = fakeSecurity();
  macosCredentialCommand("write", credentials(8_192), "default", security.run);
  security.items.set("default.1", Buffer.from("tampered").toString("base64"));
  expect(() => macosCredentialCommand("read", undefined, "default", security.run)).toThrow("passen nicht zusammen");
});

test("real macOS keychain roundtrip holds large credentials", () => {
  if (process.platform !== "darwin") return;
  const account = `test-${randomBytes(8).toString("hex")}`, value = credentials(8_192);
  try {
    macosCredentialCommand("write", value, account);
    expect(macosCredentialCommand("read", undefined, account) === value).toBe(true);
  } finally {
    macosCredentialCommand("delete", undefined, account);
  }
  expect(macosCredentialCommand("read", undefined, account)).toBe("");
});
