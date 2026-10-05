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

  describe("font roles and the club font register (homepage-generator 18)", () => {
    const fontId = "3f2b6c1e-8a4d-4f7b-9c2e-1d5a6b7c8d9e";
    const schema = K7_ACTION_SCHEMAS["cai.club.05.design"].input;
    const write = (designSettings: Record<string, unknown>) =>
      schema.safeParse({ club_id: clubId, design_settings: designSettings });

    test("TC-01: a platform heading font and a system body font are accepted", () => {
      const result = write({
        tokens: {
          type: {
            heading: { family: "Merriweather", source: "plattform", weight: 700 },
            body: { family: "sans-serif", source: "system" },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    test("TC-08: a club font needs a font_id, a platform family must not be source verein", () => {
      expect(write({ tokens: { type: { heading: { family: "Jaga Serif", source: "verein" } } } }).success).toBe(false);
      expect(write({ tokens: { type: { heading: { family: "Lato", source: "verein", font_id: fontId } } } }).success).toBe(false);
      expect(write({
        fonts: [{ id: fontId, family: "Jaga Serif", format: "ttf", lizenz: "OFL 1.1" }],
        tokens: { type: { heading: { family: "Jaga Serif", source: "verein", font_id: fontId } } },
      }).success).toBe(true);
    });

    test("families, sources, weights and roles outside the contract are refused", () => {
      expect(write({ tokens: { type: { heading: { family: "Georgia", source: "system" } } } }).success).toBe(false);
      expect(write({ tokens: { type: { heading: { family: "Comic Sans", source: "plattform" } } } }).success).toBe(false);
      expect(write({ tokens: { type: { heading: { family: "Lato", source: "plattform", weight: 450 } } } }).success).toBe(false);
      expect(write({ tokens: { type: { heading: { family: "Lato", source: "plattform", font_id: fontId } } } }).success).toBe(false);
      expect(write({ tokens: { type: { title: { family: "Lato", source: "plattform" } } } }).success).toBe(false);
    });

    test("the register holds at most two fonts with id, family, format and licence", () => {
      const font = { id: fontId, family: "Jaga Serif", format: "woff2", lizenz: "OFL 1.1" };
      expect(write({ fonts: [font] }).success).toBe(true);
      expect(write({ fonts: [font, { ...font, id: "4f2b6c1e-8a4d-4f7b-9c2e-1d5a6b7c8d9e" }, { ...font, id: "5f2b6c1e-8a4d-4f7b-9c2e-1d5a6b7c8d9e" }] }).success).toBe(false);
      expect(write({ fonts: [{ ...font, format: "otf" }] }).success).toBe(false);
      expect(write({ fonts: [{ ...font, lizenz: "" }] }).success).toBe(false);
      expect(write({ fonts: [{ ...font, id: "../../etc" }] }).success).toBe(false);
    });

    test("review R1: a stored weight null reads as not set; duplicate register ids are refused", () => {
      const redacted = redactClubSettings({
        design_settings: { tokens: { type: { body: { family: "Lato", source: "plattform", weight: null } } } },
      }) as Record<string, any>;
      const parsed = K7_ACTION_SCHEMAS["cai.club.03.settings"].output.parse(redacted) as Record<string, any>;
      expect(parsed.design_settings.tokens.type.body).toEqual({ family: "Lato", source: "plattform" });
      const font = { id: fontId, family: "Jaga Serif", format: "ttf", lizenz: "OFL 1.1" };
      expect(write({ fonts: [font, { ...font, family: "Jaga Sans" }] }).success).toBe(false);
    });

    test("DC-8: a role whose club font is not registered is named in font_hinweise", () => {
      const redacted = redactClubSettings({
        design_settings: {
          tokens: { type: { heading: { family: "Jaga Serif", source: "verein", font_id: fontId } } },
          fonts: [],
        },
      }) as Record<string, any>;
      const parsed = K7_ACTION_SCHEMAS["cai.club.03.settings"].output.parse(redacted) as Record<string, any>;
      expect(parsed.design_settings.font_hinweise).toEqual([
        { rolle: "heading", font_id: fontId, hinweis: "Schrift nicht im Register: Web und App zeigen die Rückfallschrift." },
      ]);
    });

    test("a read returns the font roles and the register, nothing else", () => {
      const redacted = redactClubSettings({
        design_settings: {
          tokens: {
            type: {
              heading: { family: "Jaga Serif", source: "verein", font_id: fontId, weight: 700, css: "x" },
              caption: { family: "Lato", source: "plattform" },
            },
          },
          fonts: [{ id: fontId, family: "Jaga Serif", format: "ttf", lizenz: "OFL 1.1", storage_key: "s3://x" }],
        },
      }) as Record<string, any>;
      const parsed = K7_ACTION_SCHEMAS["cai.club.03.settings"].output.parse(redacted) as Record<string, any>;
      expect(parsed.design_settings.tokens.type).toEqual({
        heading: { family: "Jaga Serif", source: "verein", font_id: fontId, weight: 700 },
      });
      expect(parsed.design_settings.fonts).toEqual([{ id: fontId, family: "Jaga Serif", format: "ttf", lizenz: "OFL 1.1" }]);
      expect(parsed.design_settings.font_hinweise).toBeUndefined();
    });
  });
});
