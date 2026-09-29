import { describe, expect, test } from "bun:test";

import { K7_ACTION_DEFINITIONS, K7_ACTION_SCHEMAS } from "../src/tools/identity-club-member-team-role/index.ts";

const clubId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";
const threadId = "33333333-3333-4333-8333-333333333333";
const channelId = "44444444-4444-4444-8444-444444444444";

describe("Forum read access over OAuth (cai.club.13/14, Feature 55e553b2 K3)", () => {
  test("both actions only read from the message-service with club.read", () => {
    for (const id of ["cai.club.13.forum_board_list", "cai.club.14.forum_thread_list"] as const) {
      const definition = K7_ACTION_DEFINITIONS[id];
      expect(definition.risk_class).toBe("read");
      expect(definition.required_scopes).toEqual(["club.read"]);
      expect(definition.backend_routes[0]).toMatchObject({ method: "GET", service: "message" });
    }
    expect(K7_ACTION_DEFINITIONS["cai.club.14.forum_thread_list"].backend_routes[0]?.normalized_path_template).toBe("/forum/threads");
  });

  test("the thread list shows the channel archive markers", () => {
    const [row] = K7_ACTION_SCHEMAS["cai.club.14.forum_thread_list"].output.parse([{
      id: threadId, board_id: boardId, channel_id: channelId, title: "Sommerfest", visibility: "private",
      status: "archived", is_locked: true, linked_context_type: "event", linked_context_id: channelId,
      transferred_from_channel_id: channelId, transferred_from_context_type: "event", reply_count: 2,
      last_reply_at: "2026-09-20T10:00:00Z", created_at: "2026-09-29T03:00:00Z", body: "not exposed", view_count: 4,
    }]) as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ status: "archived", transferred_from_channel_id: channelId });
    expect(row).not.toHaveProperty("body");
  });

  test("the thread list input is strict and bounded", () => {
    const schema = K7_ACTION_SCHEMAS["cai.club.14.forum_thread_list"].input;
    expect(schema.parse({ club_id: clubId, board_id: boardId })).toMatchObject({ limit: 50, offset: 0 });
    expect(() => schema.parse({ club_id: clubId, board_id: boardId, limit: 500 })).toThrow();
    expect(() => schema.parse({ club_id: clubId, board_id: boardId, unknown: 1 })).toThrow();
  });

  test("the board list reads the archive board", () => {
    const [board] = K7_ACTION_SCHEMAS["cai.club.13.forum_board_list"].output.parse([{
      id: boardId, name: "Archiv: Veranstaltungen & Buchungen", visibility: "members", is_locked: true,
      thread_count: 1, linked_context_type: "channel_archive", children: [],
    }]) as Array<Record<string, unknown>>;
    expect(board?.linked_context_type).toBe("channel_archive");
  });
});
