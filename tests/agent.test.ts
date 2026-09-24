import { describe, expect, test } from "bun:test";
import cac from "cac";

import {
  buildClubAgentChatPayload,
  registerAgentCommands,
  resolveAgentChatMessage,
} from "../src/commands/agent.ts";

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

describe("Club-Agent CLI contract", () => {
  test("binds the club and fixed conversation surface without accepting an actor", () => {
    const payload = buildClubAgentChatPayload({
      message: "  Plane unser Sommerfest.  ",
      clubId: "33333333-3333-4333-8333-333333333333",
      sessionId: "12121212-1212-4212-8212-121212121212",
    });

    expect(payload).toEqual({
      message: "Plane unser Sommerfest.",
      club_id: "33333333-3333-4333-8333-333333333333",
      context_type: "club_agent_dm",
      surface: "cli",
      session_id: "12121212-1212-4212-8212-121212121212",
    });
    expect(payload).not.toHaveProperty("user_id");
  });

  test("rejects blank, oversized and invalid session input before an API call", () => {
    expect(() => buildClubAgentChatPayload({
      message: " ",
      clubId: "33333333-3333-4333-8333-333333333333",
    })).toThrow("Nachricht");
    expect(() => buildClubAgentChatPayload({
      message: "x".repeat(4001),
      clubId: "33333333-3333-4333-8333-333333333333",
    })).toThrow("4000");
    expect(() => buildClubAgentChatPayload({
      message: "Weiter",
      clubId: "33333333-3333-4333-8333-333333333333",
      sessionId: "not-a-uuid",
    })).toThrow("UUID");
  });
});

import {
  approvalListState,
  decisionLinkText,
  formatApproval,
  formatChatResponse,
  resolveApprovalCommand,
  type AgentApproval,
} from "../src/commands/agent.ts";

const APPROVAL_ID = "0b2c3d4e-1234-4abc-8def-0123456789ab";
const approval = (overrides: Partial<AgentApproval> = {}): AgentApproval => ({
  id: APPROVAL_ID,
  capability_id: "event.set_status",
  capability_title: "Status ändern",
  arguments_summary: [{ label: "Status", value: "abgesagt" }],
  target_summary: "Sommerfest",
  source: "chat",
  source_title: "Chat mit dem Club Agent",
  mode: "click",
  created_at: "2026-09-24T08:00:00Z",
  expires_at: "2026-09-25T08:00:00Z",
  state: "open",
  can_decide: true,
  approval_url: `https://comvenio.app/club/c1?agentSurface=member&approval=${APPROVAL_ID}`,
  ...overrides,
});

describe("agent approval (Agent-Funktionen K1, CLI-16)", () => {
  test("`agent approval show <id>` reaches the same command", () => {
    const cli = cac("comvenio");
    registerAgentCommands(cli);
    cli.parse(["bun", "comvenio", "agent", "approval", "show", APPROVAL_ID], { run: false });
    expect(cli.matchedCommandName).toBe("agent");
    expect(cli.args).toEqual(["approval", "show", APPROVAL_ID]);
  });

  test("actions and ids are checked before any API call", () => {
    expect(resolveApprovalCommand(["list"])).toEqual({ action: "list" });
    expect(resolveApprovalCommand(["approve", APPROVAL_ID])).toEqual({ action: "approve", id: APPROVAL_ID });
    expect(() => resolveApprovalCommand(["decide", APPROVAL_ID])).toThrow("list, show, approve, reject");
    expect(() => resolveApprovalCommand(["show", "../../admin"])).toThrow("UUID");
    expect(() => resolveApprovalCommand(["list", APPROVAL_ID])).toThrow("--state");
    expect(approvalListState(undefined)).toBe("open");
    expect(() => approvalListState("mine")).toThrow("open, decided oder all");
  });

  test("approve and reject never decide — they print the direct link (D-AF-16)", () => {
    const text = decisionLinkText("approve", approval());
    expect(text).toContain("Web oder App");
    expect(text).toContain(`approval=${APPROVAL_ID}`);
    expect(decisionLinkText("reject", approval({ state: "approved" }))).toContain("bereits freigegeben");
  });

  test("show lists function, target, arguments and link", () => {
    const text = formatApproval(approval({ state: "approved", decision_kind: "human", decided_at: "2026-09-24T09:00:00Z", run: { state: "failed", error: "tool_failed" } }));
    expect(text).toContain("Status ändern (freigegeben)");
    expect(text).toContain("Ziel: Sommerfest");
    expect(text).toContain("Status: abgesagt");
    expect(text).toContain("Lauf: failed (tool_failed)");
  });

  test("the chat text shows the approval links of the turn", () => {
    const text = formatChatResponse({
      session_id: "s1",
      response: "Soll ich das Sommerfest absagen?",
      approval_refs: [{ approval_id: APPROVAL_ID, state: "open", approval_url: approval().approval_url }],
    });
    expect(text).toContain(`Freigabe (offen): ${approval().approval_url}`);
    expect(text.endsWith("Session: s1")).toBe(true);
  });
});
