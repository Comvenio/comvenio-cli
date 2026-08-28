import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "src", "schema", `${name}.json`), "utf8"));

describe("homepage schema", () => {
  const homepage = schema("homepage");

  test("mirrors all homepage vocabularies", () => {
    expect(homepage.widget_count).toBe(71);
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

  test("keeps coverage status aligned with implemented workflows", () => {
    const domains = Object.fromEntries(schema("coverage").domains.map((domain: any) => [domain.id, domain]));

    expect(domains.club.status).toBe("covered");
    expect(domains.member.status).toBe("covered");
    expect(domains.task.status).toBe("covered");
    expect(domains.tournament.status).toBe("covered");
    expect(domains["ingredient-category"].status).toBe("covered");
    expect(domains.shopping.status).toBe("covered");
    expect(domains.sponsor.status).toBe("covered");
    expect(domains.sponsor.gaps).toEqual([]);
  });
});

describe("homepage config sync", () => {
  const homepage = schema("homepage");

  // Die Widget-KINDS haben seit jeher eine Sync-Pruefung (vocabulary_sync).
  // Die FELDER hatten keine — und dort sass die Drift. Gefunden am 2026-08-27
  // an `ticker`, dessen dokumentierte Felder background_color/text_color das
  // Widget nirgends liest.
  test("the check actually ran", () => {
    // Ohne diese Zusicherung waere die Suite gruen, wenn die Pruefung gar
    // nichts ansieht — die teuerste Art von gruen.
    expect(homepage.config_sync.widgets_checked).toBeGreaterThan(50);
    expect(homepage.config_sync.fields_checked).toBeGreaterThan(200);
  });

  test("the counters match the per-widget hints", () => {
    const mitHinweis = Object.values(homepage.widgets as Record<string, any>)
      .filter((w) => Array.isArray(w.config_not_read_by_widget));
    const felder = mitHinweis.reduce(
      (n: number, w: any) => n + w.config_not_read_by_widget.length,
      0,
    );

    expect(homepage.config_sync.widgets_with_unread_fields).toBe(mitHinweis.length);
    expect(homepage.config_sync.unread_fields).toBe(felder);
  });

  test("an empty hint is dropped rather than written", () => {
    for (const [kind, widget] of Object.entries(homepage.widgets as Record<string, any>)) {
      if (widget.config_not_read_by_widget !== undefined) {
        expect(widget.config_not_read_by_widget.length, kind).toBeGreaterThan(0);
      }
    }
  });

  test("every flagged field is one the schema itself documents", () => {
    // Gegenprobe: Ein Hinweis auf ein Feld, das gar nicht im config steht,
    // waere ein Parserfehler — der Leser suchte dann nach einem Phantom.
    for (const [kind, widget] of Object.entries(homepage.widgets as Record<string, any>)) {
      const flagged: string[] = widget.config_not_read_by_widget ?? [];
      const documented = (widget.config ?? []).map((f: any) => f.name);
      for (const name of flagged) {
        expect(documented, `${kind}.${name}`).toContain(name);
      }
    }
  });
});

describe("homepage value sets", () => {
  const homepage = schema("homepage");

  // Die zweite Haelfte der Drift: Der Feldname stimmt, die Wertemenge nicht.
  // `stats` dokumentierte layout: card|bold|minimal, das Widget kennt
  // grid|horizontal|bento — kein einziger Wert traf, und wer einen setzt,
  // bekommt wortlos den Default. config_not_read_by_widget sieht das nicht:
  // Es vergleicht Namen.
  test("the value check actually ran", () => {
    // Ohne diese Zusicherung waere die Suite gruen, wenn die Pruefung keine
    // einzige Wertemenge ansieht.
    expect(typeof homepage.config_sync.widgets_with_wrong_values).toBe("number");
    expect(typeof homepage.config_sync.wrong_values).toBe("number");
    expect(homepage.config_sync.value_sets_checked).toBeGreaterThan(20);
  });

  test("it says how much it could NOT see", () => {
    // Eine Null bei wrong_values liest sich wie eine Entwarnung fuer alle
    // Wertemengen. Sie gilt aber nur fuer die, die lesbar waren — also muss
    // die andere Zahl danebenstehen. Am 2026-08-28 waren 15 von 76 nicht
    // lesbar; alle wurden von Hand geprueft und waren korrekt.
    expect(typeof homepage.config_sync.value_sets_unreadable).toBe("number");

    const mitWerten = Object.values(homepage.widgets as Record<string, any>)
      .flatMap((w) => (w.config ?? []) as any[])
      .filter((f) => Array.isArray(f.values)).length;

    // Jede dokumentierte Wertemenge ist entweder geprueft oder als unlesbar
    // gezaehlt — eine dritte Kategorie gaebe es nur als stille Luecke.
    expect(homepage.config_sync.value_sets_checked + homepage.config_sync.value_sets_unreadable)
      .toBe(mitWerten);
  });

  test("the counters match the per-widget findings", () => {
    const mitBefund = Object.values(homepage.widgets as Record<string, any>)
      .filter((w) => Array.isArray(w.config_values_not_in_widget));
    const werte = mitBefund.reduce(
      (n: number, w: any) =>
        n + w.config_values_not_in_widget.reduce((m: number, f: any) => m + f.unknown.length, 0),
      0,
    );

    expect(homepage.config_sync.widgets_with_wrong_values).toBe(mitBefund.length);
    expect(homepage.config_sync.wrong_values).toBe(werte);
  });

  test("an empty finding is dropped rather than written", () => {
    for (const [kind, widget] of Object.entries(homepage.widgets as Record<string, any>)) {
      if (widget.config_values_not_in_widget === undefined) continue;
      expect(widget.config_values_not_in_widget.length, kind).toBeGreaterThan(0);
      for (const f of widget.config_values_not_in_widget) {
        expect(f.unknown.length, `${kind}.${f.field}`).toBeGreaterThan(0);
      }
    }
  });

  test("every flagged value belongs to a field the schema documents with values", () => {
    // Gegenprobe: Ein Befund an einem Feld ohne dokumentierte Werte waere ein
    // Parserfehler — der Leser suchte dann nach einem Phantom.
    for (const [kind, widget] of Object.entries(homepage.widgets as Record<string, any>)) {
      for (const f of widget.config_values_not_in_widget ?? []) {
        const feld = (widget.config ?? []).find((c: any) => c.name === f.field);
        expect(feld, `${kind}.${f.field}`).toBeTruthy();
        expect(Array.isArray(feld.values), `${kind}.${f.field}`).toBe(true);
        for (const wert of f.unknown) {
          expect(feld.values, `${kind}.${f.field}`).toContain(wert);
        }
      }
    }
  });
});
