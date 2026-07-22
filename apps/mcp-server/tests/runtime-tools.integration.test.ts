import { describe, expect, test } from "bun:test";

import { projectPublicWidgetModel } from "../src/runtime-tools.ts";

const clubId = "33333333-3333-4333-8333-333333333333";

describe("production public widget tool results", () => {
  test("projects minimized public events into the event calendar widget contract", () => {
    const model = projectPublicWidgetModel("public_events", {
      club_id: clubId,
      from: "2026-07-21T00:00:00+02:00",
      to: "2026-07-28T00:00:00+02:00",
    }, [{
      id: "77777777-7777-4777-8777-777777777777",
      title: "Sommerfest",
      summary: "Für alle",
      start: "2026-07-21T17:00:00+02:00",
      end: "2026-07-21T22:00:00+02:00",
      timezone: "Europe/Berlin",
      location: "Vereinsheim",
      is_public: true,
      cover_url: null,
    }, {
      id: "88888888-8888-4888-8888-888888888888",
      title: "Termin ohne Zeit",
      summary: null,
      start: null,
      end: null,
      timezone: "Europe/Berlin",
      location: null,
      is_public: true,
      cover_url: null,
    }]);

    expect(model).toMatchObject({
      widget: "event_calendar",
      club: { club_id: clubId, timezone: "Europe/Berlin" },
      data: { events: [expect.objectContaining({ title: "Sommerfest" })] },
      actions: [],
    });
    expect(JSON.stringify(model)).not.toContain("Termin ohne Zeit");
  });

  test("projects minimized public news into the provider-neutral news widget contract", () => {
    const model = projectPublicWidgetModel("public_news", { club_id: clubId }, [{
      id: "99999999-9999-4999-8999-999999999999",
      title: "Jugendturnier",
      summary: "Öffentlicher Rückblick",
      sanitized_html: null,
      hero_url: null,
      published_at: "2026-07-18T10:00:00+02:00",
      author_display_name: null,
    }]);

    expect(model).toMatchObject({
      widget: "news",
      club: { club_id: clubId, timezone: "Europe/Berlin" },
      data: { filter: "public", articles: [expect.objectContaining({ title: "Jugendturnier" })] },
      actions: [],
    });
  });

  test("does not attach a widget model where the tool lacks a club binding", () => {
    expect(projectPublicWidgetModel("public_news_detail", {
      news_id: "99999999-9999-4999-8999-999999999999",
    }, {
      id: "99999999-9999-4999-8999-999999999999",
      title: "Jugendturnier",
      summary: "Öffentlicher Rückblick",
      sanitized_html: null,
      hero_url: null,
      published_at: "2026-07-18T10:00:00+02:00",
      author_display_name: null,
    })).toBeNull();
  });
});
