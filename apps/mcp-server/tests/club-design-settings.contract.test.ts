import { describe, expect, test } from "bun:test";

import { redactClubSettings } from "../src/tools/identity-club-member-team-role/privacy.ts";
import { K7_ACTION_SCHEMAS } from "../src/tools/identity-club-member-team-role/schemas.ts";

const clubId = "11111111-1111-4111-8111-111111111111";

// Shape club-service returns for a club whose homepage was redesigned (2026-09-28):
// the read failed with „keine freigegebene Antwortform“ and hid nav/on_nav.
const stored = {
  organization_type: "sports_club",
  design_settings: {
    homepage_theme: "modern",
    homepage_template: "flex",
    primary_color: "#12306E",
    logo_url: "https://cdn.example.org/wappen.png",
    sidebar_style: "slide",
    sidebar_color_mode: "dark",
    custom_template_config: { font_pair: "grotesk-serif", spacing: "normal", unknown_extension: true },
    tokens: {
      palette: { surface: "#FFFFFF", ink: "#16202E", accent: "#2457D6", on_accent: "#FFFFFF", nav: "#12306E", on_nav: "#FFFFFF" },
      radius: { sm: 4, md: 8 },
      spacing_scale: 1,
      type_scale: 1.1,
      shadow_level: 2,
    },
    styles: [{ id: "internal" }],
  },
};

describe("club design settings contract", () => {
  test("a read keeps every palette role, numeric tokens and free design names", () => {
    const redacted = redactClubSettings(stored) as Record<string, any>;
    const parsed = K7_ACTION_SCHEMAS["cai.club.03.settings"].output.parse(redacted) as Record<string, any>;
    const design = parsed.design_settings;
    expect(design.sidebar_color_mode).toBe("dark");
    expect(design.tokens.palette.nav).toBe("#12306E");
    expect(design.tokens.palette.on_nav).toBe("#FFFFFF");
    expect(design.tokens.radius).toEqual({ sm: 4, md: 8 });
    expect(design.custom_template_config.font_pair).toBe("grotesk-serif");
    expect(design.logo_url).toBe("https://cdn.example.org/wappen.png");
    // Only the picked fields leave the connector.
    expect(design.styles).toBeUndefined();
    expect(design.custom_template_config.unknown_extension).toBeUndefined();
  });

  test("a palette value that is not hex is dropped, not passed on", () => {
    const redacted = redactClubSettings({
      design_settings: { tokens: { palette: { nav: "url(javascript:x)", on_nav: "#FFFFFF" } } },
    }) as Record<string, any>;
    expect(redacted.design_settings.tokens.palette).toEqual({ on_nav: "#FFFFFF" });
  });

  test("a design write accepts the modes and tokens the web writes", () => {
    const input = K7_ACTION_SCHEMAS["cai.club.05.design"].input.parse({
      club_id: clubId,
      design_settings: {
        sidebar_color_mode: "light",
        tokens: { palette: { nav: "#12306E", on_nav: "#FFFFFF" }, shadow_level: 1 },
      },
    }) as Record<string, any>;
    expect(input.design_settings.sidebar_color_mode).toBe("light");
  });

  test("a design write still rejects unknown modes and malformed tokens", () => {
    const schema = K7_ACTION_SCHEMAS["cai.club.05.design"].input;
    expect(() => schema.parse({ club_id: clubId, design_settings: { sidebar_color_mode: "rainbow" } })).toThrow();
    expect(() => schema.parse({ club_id: clubId, design_settings: { tokens: { palette: { nav: "blue" } } } })).toThrow();
    expect(() => schema.parse({ club_id: clubId, design_settings: { tokens: { shadow_level: 7 } } })).toThrow();
  });
});
