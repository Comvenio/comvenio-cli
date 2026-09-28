import { describe, expect, test } from "bun:test";

import { INDEX, search, withinTwoEdits } from "@comvenio/kundendoku";
import type { RequestContext } from "@comvenio/connector-contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { answerHelp, HELP_TOOL_NAME, helpResourceUri, registerHelpTool } from "../src/help-tool.ts";
import { PublicToolSubset } from "../src/public/subset.ts";
import { createRuntimeAccessPolicy, publishedRuntimeCatalog } from "../src/runtime-tools.ts";
import type { ToolSecurityScheme } from "../src/tool-security-schemes.ts";

// No subject, no club, no scopes: an anonymous connection.
const anonymous: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "mcp",
  provider: null,
  subject_id: null,
  oauth_grant_id: null,
  club_id: null,
  department_id: null,
  scopes: [],
  capability_version: null,
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

async function connected() {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const advertised = new Map<string, readonly ToolSecurityScheme[]>();
  registerHelpTool({
    server,
    context: anonymous,
    advertised_security_schemes: advertised,
    with_security_metadata: (schemes) => ({ securitySchemes: schemes }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, advertised };
}

describe("comvenio_hilfe (05-ki-zugang)", () => {
  test("TC-01: without sign-in the tool is allowed, visible and returns an article", async () => {
    for (const scope of ["personal_productivity_v1", "full_connector_v1"] as const) {
      const decision = createRuntimeAccessPolicy("production", scope).classify({
        jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: HELP_TOOL_NAME, arguments: { operation: "suche" } },
      });
      expect(decision.anonymous_allowed, scope).toBe(true);
      expect(publishedRuntimeCatalog("production", scope).tool_names, scope).toContain(HELP_TOOL_NAME);
    }
    const { client, advertised } = await connected();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain(HELP_TOOL_NAME);
    expect(advertised.get(HELP_TOOL_NAME)).toEqual([{ type: "noauth" }]);
    const result = await client.callTool({ name: HELP_TOOL_NAME, arguments: { operation: "artikel", id: "zonen" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: "zonen", lang: "de" });
  });

  test("TC-02: fehler SCOPE_REQUIRED lang en returns the English error article", () => {
    const result = answerHelp(anonymous, { operation: "fehler", code: "SCOPE_REQUIRED", lang: "en" });
    expect(result.structuredContent).toMatchObject({ id: "fehler/scope-required", lang: "en" });
    expect(String((result.structuredContent as { markdown: string }).markdown)).toContain("## Solution");
    expect(Object.keys(result.structuredContent!).sort()).toEqual(["id", "lang", "markdown", "related", "title"]);
  });

  test("TC-03: every index id is listed as a resource in both languages and readable", async () => {
    const { client } = await connected();
    const uris = new Set((await client.listResources()).resources.map((resource) => resource.uri));
    for (const entry of INDEX) {
      for (const lang of ["de", "en"] as const) {
        const uri = helpResourceUri(lang, entry.id);
        expect(uris.has(uri), uri).toBe(true);
      }
    }
    const read = await client.readResource({ uri: helpResourceUri("en", "fehler/outcome-unknown") });
    expect(read.contents[0]).toMatchObject({ mimeType: "text/markdown" });
    expect(String((read.contents[0] as { text: string }).text)).toContain("## Solution");
  });

  test("TC-04: an unknown id is NOT_FOUND with the nearest hits", () => {
    const result = answerHelp(anonymous, { operation: "artikel", id: "zonne" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "NOT_FOUND" });
    const matches = (result.structuredContent as { matches: Array<{ id: string }> }).matches.map((hit) => hit.id);
    expect(matches).toContain("zonen");
  });

  test("an empty search returns the overview of all articles", () => {
    const result = answerHelp(anonymous, { operation: "suche" });
    expect((result.structuredContent as { results: unknown[] }).results).toHaveLength(INDEX.length);
  });

  test("fuzzy search stays correct and cheap for anonymous callers", () => {
    expect(withinTwoEdits("zonen", "zonne")).toBe(true);
    expect(withinTwoEdits("zonen", "zonen")).toBe(true);
    expect(withinTwoEdits("zonen", "zxxxn")).toBe(false);
    expect(withinTwoEdits("buchung", "buchungsregeln")).toBe(false);
    expect(search("zonne", "de").map((entry) => entry.id)).toContain("zonen");
    // The review's worst case: 300 calls with 200 characters, plus many short words.
    const started = performance.now();
    for (let call = 0; call < 300; call += 1) {
      search("x".repeat(200), "de");
      search(Array.from({ length: 50 }, (_, word) => `w${word}zq`).join(" "), "de");
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("the static public list can never open a protected tool", () => {
    expect(() => new PublicToolSubset({
      public_tools: [],
      protected_tools: [{ tool_name: "cv_member_write", required_scopes: ["member.write"] }],
      static_public_tools: ["cv_member_write"],
    })).toThrow("nicht als öffentliches Tool");
    const policy = createRuntimeAccessPolicy("production", "full_connector_v1");
    const protectedCall = policy.classify({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cv_whoami_read", arguments: {} },
    });
    expect(protectedCall.anonymous_allowed).toBe(false);
  });
});
