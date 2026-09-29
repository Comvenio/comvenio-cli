import { describe, expect, test } from "bun:test";
import cac from "cac";

import {
  buildClubAgentConverseArguments,
  CLUB_AGENT_TOOL,
  formatChatResponse,
  parseClubAgentAnswer,
  registerAgentCommands,
  resolveAgentChatMessage,
  runAgentChat,
  sessionLostHint,
} from "../src/commands/agent.ts";
import { removedCommandError, removedTopLevelCommand } from "../src/commands/removed.ts";
import { exitCodeFor, toPublicError } from "../src/errors.ts";
import { CliConnectorClient } from "../src/mcp/client.ts";

// `comvenio agent chat` over the connector (Geräte-Token-Abbau K2, D-GTA-03):
// OAuth on the /cli channel, tools/call cv_club_agent_converse, no device token.

const ENDPOINT = "https://mcp.comvenio.app/cli";
const ACCESS_TOKEN = "oauth-access-token";
const SESSION_ID = "12121212-1212-4212-8212-121212121212";
const APPROVAL_ID = "0b2c3d4e-1234-4abc-8def-0123456789ab";
const RUN_ID = "56565656-5656-4565-8565-565656565656";
const APPROVAL_URL = `https://comvenio.app/club/c1?agentSurface=member&approval=${APPROVAL_ID}`;

type Recorded = { url: string; authorization: string | null; method: string; params: Record<string, unknown> | undefined };

/** A connector over a fake fetch: records every request and answers per JSON-RPC method. */
function fakeConnector(answer: (method: string, params: Record<string, unknown> | undefined) => unknown) {
  const requests: Recorded[] = [];
  const client = new CliConnectorClient({
    endpoint: ENDPOINT,
    access_token: ACCESS_TOKEN,
    fetch: (async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string; method: string; params?: Record<string, unknown> };
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        method: body.method,
        params: body.params,
      });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: answer(body.method, body.params) });
    }) as typeof fetch,
  });
  return { client, requests };
}

const TOOL_LIST = { tools: [{ name: "cv_whoami_read" }, { name: CLUB_AGENT_TOOL }] };

function agentAnswer(structured: Record<string, unknown>) {
  return (method: string) => method === "tools/list"
    ? TOOL_LIST
    : { content: [{ type: "text", text: String(structured.response ?? "") }], structuredContent: structured };
}

describe("agent command is reachable (2026-09-24: 'agent chat <message>' never matched)", () => {
  test("`agent chat <words>` matches the registered command", () => {
    const cli = cac("comvenio");
    registerAgentCommands(cli);
    cli.parse(["bun", "comvenio", "agent", "chat", "Welche", "Events?", "--json"], { run: false });
    expect(cli.matchedCommandName).toBe("agent");
    expect(cli.args).toEqual(["chat", "Welche", "Events?"]);
    expect(cli.options.json).toBe(true);
  });

  test("the variadic words become one message", () => {
    expect(resolveAgentChatMessage("chat", ["Welche", "Events?"])).toBe("Welche Events?");
    expect(resolveAgentChatMessage("chat", ["Plane unser Sommerfest."])).toBe("Plane unser Sommerfest.");
  });

  test("an unknown action fails loudly instead of exiting silently", async () => {
    const cli = cac("comvenio");
    registerAgentCommands(cli);
    cli.parse(["bun", "comvenio", "agent", "plaudern", "hallo"], { run: false });
    await expect(cli.runMatchedCommand()).rejects.toThrow("Unbekannte agent-Aktion");
  });
});

describe("agent chat arguments", () => {
  test("carry only message and session — club and user come from the OAuth grant", () => {
    const args = buildClubAgentConverseArguments({ message: "  Plane unser Sommerfest.  ", sessionId: SESSION_ID });
    expect(args).toEqual({ message: "Plane unser Sommerfest.", session_id: SESSION_ID });
    expect(args).not.toHaveProperty("club_id");
    expect(args).not.toHaveProperty("user_id");
    expect(args).not.toHaveProperty("surface");
  });

  test("reject blank, oversized and invalid session input before any call", () => {
    expect(() => buildClubAgentConverseArguments({ message: " " })).toThrow("Nachricht");
    expect(() => buildClubAgentConverseArguments({ message: "x".repeat(4001) })).toThrow("4000");
    expect(() => buildClubAgentConverseArguments({ message: "Weiter", sessionId: "not-a-uuid" })).toThrow("UUID");
  });
});

describe("TC-01: agent chat talks to cv_club_agent_converse on the /cli channel", () => {
  test("only the connector is called, with the OAuth token — never /chat with a device token", async () => {
    const { client, requests } = fakeConnector(agentAnswer({ session_id: SESSION_ID, response: "Am Samstag ist Heimspiel." }));
    const answer = await runAgentChat({ client, granted_scopes: ["club.read"], message: "Was steht an?" });

    expect(answer).toEqual({ session_id: SESSION_ID, response: "Am Samstag ist Heimspiel.", run_refs: [], approval_refs: [] });
    expect(requests.map((request) => request.method)).toEqual(["tools/list", "tools/call"]);
    for (const request of requests) {
      expect(request.url).toBe(ENDPOINT);
      expect(request.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(request.url).not.toContain("/chat");
      expect(request.authorization).not.toContain("cvn_");
    }
    expect(requests[1]!.params).toEqual({ name: CLUB_AGENT_TOOL, arguments: { message: "Was steht an?" } });
  });
});

describe("TC-02: run and approval references", () => {
  const structured = {
    session_id: SESSION_ID,
    response: "Die Wochenvorschau ist angelegt und wartet auf deine Freigabe.",
    run_refs: [{ run_id: RUN_ID, kind: "command_run", state: "awaiting_approval" }],
    approval_refs: [{ approval_id: APPROVAL_ID, state: "open", approval_url: APPROVAL_URL }],
  };

  test("--json carries run_refs and approval_refs with approval_url from the fields", async () => {
    const { client } = fakeConnector(agentAnswer(structured));
    const answer = await runAgentChat({ client, granted_scopes: ["club.read"], message: "Lege die Wochenvorschau an." });
    expect(answer).toEqual(structured);
  });

  test("the text names one line per approval link and per run, then the session", () => {
    const text = formatChatResponse(parseClubAgentAnswer({
      ...structured,
      run_refs: [...structured.run_refs, { run_id: "r2", kind: "plan_run", state: "completed" }],
    }));
    expect(text).toContain(`Freigabe (offen): ${APPROVAL_URL}`);
    expect(text).toContain(`Lauf Kommando ${RUN_ID}: awaiting_approval`);
    expect(text).toContain("Lauf Routine r2: completed");
    expect(text.endsWith(`Session: ${SESSION_ID}`)).toBe(true);
  });

  test("several approvals give one line each; an answer without text shows only the references (DC-8)", () => {
    const second = "https://comvenio.app/club/c1?agentSurface=member&approval=zwei";
    const text = formatChatResponse(parseClubAgentAnswer({
      session_id: SESSION_ID,
      response: "  ",
      approval_refs: [
        { approval_id: APPROVAL_ID, state: "open", approval_url: APPROVAL_URL },
        { approval_id: "zwei", state: "open", approval_url: second },
      ],
    }));
    expect(text.split("\n")).toEqual([
      `Freigabe (offen): ${APPROVAL_URL}`,
      `Freigabe (offen): ${second}`,
      `Session: ${SESSION_ID}`,
    ]);
  });

  test("an answer without reference fields still reads as empty lists", () => {
    expect(parseClubAgentAnswer({ session_id: SESSION_ID, response: "Hallo" }))
      .toEqual({ session_id: SESSION_ID, response: "Hallo", run_refs: [], approval_refs: [] });
  });
});

describe("TC-03/TC-04: sign-in and scope", () => {
  test("TC-03: without a browser sign-in agent chat ends with AUTH_REQUIRED and a non-zero exit", async () => {
    const { AuthError } = await import("../src/auth.ts");
    const error = new AuthError("Der Club-Agent braucht eine Anmeldung über den Browser.");
    expect(toPublicError(error, { lang: "de" }).code).toBe("AUTH_REQUIRED");
    expect(exitCodeFor(error)).not.toBe(0);
  });

  test("TC-04: without club.read agent chat names the missing scope and calls nothing", async () => {
    const { client, requests } = fakeConnector(agentAnswer({ session_id: SESSION_ID, response: "x" }));
    const failure = await runAgentChat({ client, granted_scopes: ["task.read"], message: "Hallo" }).catch((error: unknown) => error);
    const rendered = toPublicError(failure, { lang: "de", granted_scopes: ["task.read"] });
    expect(rendered.code).toBe("SCOPE_REQUIRED");
    expect(rendered.cause).toContain("club.read");
    expect(exitCodeFor(failure)).not.toBe(0);
    expect(requests).toHaveLength(0);
  });

  test("a club without the club agent on this sign-in answers CLUB_AGENT_NOT_READY", async () => {
    const { client, requests } = fakeConnector(() => ({ tools: [{ name: "cv_whoami_read" }] }));
    const failure = await runAgentChat({ client, granted_scopes: ["club.read"], message: "Hallo" }).catch((error: unknown) => error);
    expect(toPublicError(failure, { lang: "de" }).code).toBe("CLUB_AGENT_NOT_READY");
    expect(requests.map((request) => request.method)).toEqual(["tools/list"]);
  });

  test("a connector error of the tool keeps its public code (e.g. UPSTREAM_TIMEOUT)", async () => {
    const { client } = fakeConnector((method) => method === "tools/list" ? TOOL_LIST : {
      isError: true,
      content: [{ type: "text", text: "Fehler UPSTREAM_TIMEOUT" }],
      structuredContent: { error: "upstream_timeout", code: "UPSTREAM_TIMEOUT" },
    });
    const failure = await runAgentChat({ client, granted_scopes: ["club.read"], message: "Hallo" }).catch((error: unknown) => error);
    expect(toPublicError(failure, { lang: "de" }).code).toBe("UPSTREAM_TIMEOUT");
  });
});

describe("TC-06: --session continues the conversation", () => {
  test("the session id travels to the tool and comes back", async () => {
    const { client, requests } = fakeConnector(agentAnswer({ session_id: SESSION_ID, response: "Gerne, weiter geht's." }));
    const answer = await runAgentChat({ client, granted_scopes: ["club.read"], message: "Und am Sonntag?", sessionId: SESSION_ID });
    expect(requests[1]!.params).toEqual({ name: CLUB_AGENT_TOOL, arguments: { message: "Und am Sonntag?", session_id: SESSION_ID } });
    expect(answer.session_id).toBe(SESSION_ID);
    expect(sessionLostHint(SESSION_ID, answer)).toBeNull();
  });

  test("a new session instead of the requested one is said, not hidden", () => {
    const hint = sessionLostHint(SESSION_ID, { session_id: RUN_ID, response: "x", run_refs: [], approval_refs: [] });
    expect(hint).toContain(`Session ${SESSION_ID}`);
    expect(hint).toContain(RUN_ID);
  });
});

describe("TC-05: removed commands name the place in the web app", () => {
  test("`agent approval list` ends with USAGE_ERROR and names „Mein Agent“", async () => {
    const cli = cac("comvenio");
    registerAgentCommands(cli);
    cli.parse(["bun", "comvenio", "agent", "approval", "list"], { run: false });
    const failure = await cli.runMatchedCommand().catch((error: unknown) => error);
    const rendered = toPublicError(failure, { lang: "de" });
    expect(rendered.code).toBe("USAGE_ERROR");
    expect(rendered.detail).toContain("„Mein Agent“");
    expect(rendered.detail).toContain("„Braucht dich“");
    expect(exitCodeFor(failure)).not.toBe(0);
  });

  test("`function list` and `automation list` are not registered and point to the web app", () => {
    const cli = cac("comvenio");
    registerAgentCommands(cli);
    for (const [argv, place] of [
      [["function", "list"], "„Fähigkeiten & Routinen“"],
      [["automation", "list"], "„Meine Automatisierungen“"],
    ] as const) {
      cli.parse(["bun", "comvenio", ...argv], { run: false });
      expect(cli.matchedCommand).toBeUndefined();
      const removed = removedTopLevelCommand(cli.args);
      expect(removed).toBe(argv[0]);
      const failure = removedCommandError(removed!);
      const rendered = toPublicError(failure, { lang: "de" });
      expect(rendered.code).toBe("USAGE_ERROR");
      expect(rendered.detail).toContain(place);
      expect(exitCodeFor(failure)).not.toBe(0);
    }
    expect(removedTopLevelCommand(["agent", "chat"])).toBeNull();
  });
});
