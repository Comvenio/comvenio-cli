// Findings from the production test of machine grants (2026-09-29):
// whoami printed "? <?>", a hidden whoami tool and an unreachable connector
// ended as UNKNOWN_ERROR.
import { describe, expect, test } from "bun:test";

import { userLine } from "../src/commands/whoami.ts";
import { toPublicError } from "../src/errors.ts";
import { CliConnectorClient, connectionNeverOpened } from "../src/mcp/client.ts";

const ENDPOINT = "https://mcp.comvenio.app/cli";

function client(fetchImpl: typeof fetch): CliConnectorClient {
  return new CliConnectorClient({ endpoint: ENDPOINT, access_token: "token", fetch: fetchImpl });
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}

describe("whoami user line", () => {
  test("names the person when the answer carries name or e-mail", () => {
    expect(userLine({ name: "Anna Muster", userId: "u1", email: "anna@club.test", machineGrant: false }))
      .toBe("Anna Muster <anna@club.test>");
  });

  test("never prints placeholders: a machine grant acts for the person who created it", () => {
    const line = userLine({ name: null, userId: null, email: null, machineGrant: true });
    expect(line).toContain("Maschinen-Grant");
    expect(line).not.toContain("?");
  });

  test("an OAuth sign-in without personal data says so", () => {
    const line = userLine({ name: null, userId: null, email: null, machineGrant: false });
    expect(line).toContain("OAuth");
    expect(line).not.toContain("?");
  });
});

describe("hidden whoami tool", () => {
  test("a grant without club.read gets SCOPE_REQUIRED with the machine-grant hint", async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const { id } = JSON.parse(String(init?.body)) as { id: string };
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "MCP error -32602: Tool cv_whoami_read not found" },
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const error = await failure(() => client(fetchImpl).whoami());
    const rendered = toPublicError(error, { lang: "de", machine_grant: true });

    expect(rendered.code).toBe("SCOPE_REQUIRED");
    expect(JSON.stringify(rendered)).toContain("club.read");
  });
});

describe("unreachable connector", () => {
  test("a DNS failure is UPSTREAM_UNAVAILABLE, not UNKNOWN_ERROR", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("getaddrinfo ENOTFOUND mcpdev.comvenio.app");
    }) as unknown as typeof fetch;

    const error = await failure(() => client(fetchImpl).whoami());
    expect(toPublicError(error, { lang: "de" }).code).toBe("UPSTREAM_UNAVAILABLE");
  });

  test("only a connection that never opened counts; a timeout after sending does not", () => {
    expect(connectionNeverOpened(Object.assign(new Error("Unable to connect"), { code: "ConnectionRefused" }))).toBe(true);
    expect(connectionNeverOpened(new TypeError("getaddrinfo EAI_AGAIN api.comvenio.app"))).toBe(true);
    expect(connectionNeverOpened(new DOMException("The operation timed out.", "TimeoutError"))).toBe(false);
    expect(connectionNeverOpened("ENOTFOUND")).toBe(false);
  });
});
