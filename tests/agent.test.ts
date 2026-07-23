import { describe, expect, test } from "bun:test";

import { buildClubAgentChatPayload } from "../src/commands/agent.ts";

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
