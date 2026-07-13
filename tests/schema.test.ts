import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "src", "schema", `${name}.json`), "utf8"));

describe("homepage schema", () => {
  const homepage = schema("homepage");

  test("mirrors all homepage vocabularies", () => {
    expect(homepage.widget_count).toBe(70);
    expect(homepage.widget_kinds).toContain("event_hub_embed");
    expect(homepage.widget_kinds).toContain("legal_notice");
    expect(homepage.widgets.legal_notice.config).toContainEqual({ name: "club_name", required: true });
    expect(homepage.widgets.news.config).toContainEqual({
      name: "layout",
      values: ["editorial", "grid", "compact", "magazine"],
    });
    expect(homepage.widgets.news.config).toContainEqual({ name: "detail_label" });
    expect(homepage.widgets.fupa_widget.config).toContainEqual({ name: "widgetId", required: true });
    expect(homepage.widgets.fupa_widget.config).toContainEqual({ name: "hrefLabel" });
    expect(homepage.interaction_contract.required_public_widgets).toEqual([]);
    expect(homepage.widgets.legal_notice.status).toBe("legacy_optional");
    expect(homepage.public_shell_contract.configurable).toBe(false);
    expect(homepage.public_shell_contract.imprint_route).toBe("/impressum");
    expect(homepage.public_shell_contract.availability_rule).toContain("404");
    expect(homepage.public_shell_contract.footer_links).toEqual({
      imprint: "/impressum",
      privacy: "https://www.comvenio.app/datenschutz",
      terms: "https://www.comvenio.app/agb",
      powered_by: "https://www.comvenio.app",
    });
    expect(homepage.interaction_contract.public_detail_routes.event).toContain("/event/");
    expect(homepage.templates).toContain("flex");
    expect(homepage.vocabulary_sync.missing_in_backend).toEqual([]);
    expect(homepage.vocabulary_sync.missing_in_prompt).toEqual([]);
    expect(homepage.preview_contract.no_live_write).toBe(true);
    expect(homepage.preview_contract.design_snapshot_version).toBe(1);
    expect(homepage.structure.tab.fields).toContain("navigation_group");
    expect(homepage.structure.tab.navigation_group_contract.max_length).toBe(100);
    expect(homepage.structure.tab.navigation_group_contract.scope).toContain("HomePreviewPage");
    expect(homepage.structure.tab.navigation_group_contract.example).toEqual({
      navigation_group: "Sport",
      child_slugs: ["fussball", "dart"],
    });
  });

  test("publishes all section layouts and styles", () => {
    expect(homepage.structure.section.layout_enum).toHaveLength(8);
    expect(homepage.structure.section.style_variant_enum).toHaveLength(7);
  });
});

describe("design schema", () => {
  const design = schema("design");

  test("publishes recipes, body surface and media focus", () => {
    expect(design.look_recipes).toHaveLength(5);
    expect(design.config.look_recipe_id.values).toContain("sport-editorial");
    expect(design.config.bodySurface.values).toEqual(["light", "dark"]);
    expect(design.config.media.focus.default).toEqual({ x: 50, y: 50 });
    expect(design.config.public_header.layout).toEqual({
      values: ["navigation", "brand-left"],
      default: "navigation",
    });
    expect(design.config.public_header.surface.values).toEqual(["light", "dark", "brand"]);
    expect(design.config.public_header.density.default).toBe("comfortable");
    expect(design.config.public_header.sticky.default).toBe(true);
    expect(design.config.public_header.clear).toBe("comvenio club design --clear-header");
    expect(design.design_settings_fields.public_header).toBeUndefined();
    expect(design.source).toContain("AI-docs/concepts/club/homepage-generator/12-public-header-action-contract.md");
  });
});

describe("event schema", () => {
  const event = schema("event");

  test("publishes template and recurrence contracts", () => {
    expect(event.enums.series_type).toEqual(["RECURRING", "YEARLY_TEMPLATE"]);
    expect(event.templates.commands).toContain("instantiate");
    expect(event.series.commands).toContain("materialize");
    expect(event.series.defaults.recurring.frequency).toBe("weekly");
  });
});

describe("cross-domain schema coverage", () => {
  test("publishes an offline contract for every registered coverage domain", async () => {
    const coverage = schema("coverage");
    const root = join(import.meta.dir, "..");
    const child = Bun.spawn([process.execPath, "run", "src/index.ts", "schema"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();

    expect(await child.exited).toBe(0);
    expect(error).toBe("");
    const index = JSON.parse(output);
    for (const domain of coverage.domains) {
      expect(index.domains).toContain(domain.id);
    }
  });

  test("publishes detailed contracts for the expanded admin workflows", () => {
    expect(schema("meeting").domain).toBe("meeting");
    expect(schema("data").domain).toBe("data");
    expect(schema("team").domain).toBe("team");
    expect(schema("object").domain).toBe("object");
    expect(schema("ingredient").domain).toBe("ingredient");
    expect(schema("ingredient-category").domain).toBe("ingredient-category");
    expect(schema("shopping").domain).toBe("shopping");
    expect(schema("member").commands.family).toContain("add");
    expect(schema("member").commands.membership_period).toContain("update");
    expect(schema("task").commands.task).toContain("bulk");
    expect(schema("task").commands.assignment).toContain("delete");
    expect(schema("task").commands.checklist).toContain("reorder");
  });

  test("keeps coverage status aligned with implemented and backend-blocked workflows", () => {
    const domains = Object.fromEntries(schema("coverage").domains.map((domain: any) => [domain.id, domain]));

    expect(domains.club.status).toBe("covered");
    expect(domains.member.status).toBe("covered");
    expect(domains.task.status).toBe("covered");
    expect(domains.tournament.status).toBe("covered");
    expect(domains.sponsor.status).toBe("core-partial");
    expect(domains.sponsor.gaps[0]).toContain("marketing-service");
  });
});
