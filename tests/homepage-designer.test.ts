// Homepage designer in the CLI (Lastenheft homepage-generator/17-designer-struktur, Sub-File 06).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpError } from "../src/http.ts";
import { baum, dokument, pruefeGeruest, pruefeReiter, type BaumKnoten, type GeruestBefund } from "../src/homepage/geruest.ts";
import { convert, HomepageAbbruch, liveAlsBulk, slotGet, slotSet, tree, type HomepageClient } from "../src/homepage/befehle.ts";
import { wandleGeruestUm, type BulkTab } from "../src/homepage/umwandeln.ts";
import { katalogAenderung } from "../src/commands/club.ts";
import { strukturBefunde } from "../src/verify/geruest-befunde.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

// ── TC-11: the rules mirror the service fixtures ─────────────────────────────

const schluessel = (b: Partial<GeruestBefund>) => JSON.stringify([b.klasse, b.regel, b.schwere, b.slot ?? null, b.widget_id ?? null]);

describe("R1–R6 mirror club-service (TC-11)", () => {
  const dateien = readdirSync(join(FIXTURES, "geruest_regeln")).filter((f) => f.endsWith(".json")).sort();
  test("fixtures present", () => expect(dateien.length).toBeGreaterThanOrEqual(10));
  for (const datei of dateien) {
    test(datei, () => {
      const fall = JSON.parse(readFileSync(join(FIXTURES, "geruest_regeln", datei), "utf8"));
      const ist: GeruestBefund[] =
        fall.art === "reiter"
          ? pruefeReiter(fall.gerueste.map((g: { widget_id: string; html: string }) => [g.widget_id, g.html]))
          : pruefeGeruest(fall.html, fall.slots, fall.styles);
      expect(ist.map(schluessel).sort()).toEqual(fall.erwartet.map(schluessel).sort());
      for (const e of fall.erwartet as GeruestBefund[]) {
        if (e.zeile !== undefined) expect(ist.some((b) => schluessel(b) === schluessel(e) && b.zeile === e.zeile)).toBe(true);
      }
    });
  }
});

// ── TC-01/02: the designer's tree (TC-CC-17-01 fixture) ──────────────────────

type Kurz = [string, string, string, string | null, Kurz[]];
const kurz = (k: BaumKnoten): Kurz => [k.art, k.pfad, k.name, k.art === "bereich" || k.art === "sektion" ? null : k.kuerzel ?? null, k.kinder.map(kurz)];

describe("homepage tree", () => {
  test("TC-01 same tree as the designer (shared fixture)", () => {
    const fall = JSON.parse(readFileSync(join(FIXTURES, "baum", "zwei-sektionen.json"), "utf8"));
    const b = baum(fall.tab, fall.sections, fall.widgets);
    expect(b.kinder.map(kurz)).toEqual(fall.erwartet);
    const kicker = b.kinder[0].kinder[0];
    expect(kicker.adresse).toBe("start/hero-kicker");
  });

  for (const datei of readdirSync(join(FIXTURES, "baum")).filter((f) => f.endsWith(".json")).sort()) {
    test(`TC-CC-17-01 ${datei}`, () => {
      const fall = JSON.parse(readFileSync(join(FIXTURES, "baum", datei), "utf8"));
      expect(baum(fall.tab, fall.sections, fall.widgets).kinder.map(kurz)).toEqual(fall.erwartet);
    });
  }

  test("TC-02 legacy slots as '<kind> · Position n'", () => {
    const b = baum({ id: "t", slug: "alt" }, [{ id: "s", sort_order: 0 }], [
      { id: "w", kind: "custom_html", section_id: "s", config: { html: '<section aria-label="S"><h2>fest</h2><div data-widget-slot="news"></div></section>' } },
    ]);
    const widget = b.kinder[0].kinder[0];
    expect(widget.altformat).toBe(true);
    expect(widget.kinder[0].kinder[0].name).toBe("news · Position 1");
  });
});

// ── TC-03/04/05: slot get / set against a stub client ────────────────────────

function stub(opts: { patch?: (path: string, body: unknown) => unknown } = {}) {
  const fall = JSON.parse(readFileSync(join(FIXTURES, "baum", "zwei-sektionen.json"), "utf8"));
  const aufrufe: { methode: string; path: string; body?: unknown }[] = [];
  const client: HomepageClient = {
    async get<T>(_service: string, path: string): Promise<T> {
      aufrufe.push({ methode: "GET", path });
      if (path.endsWith("/tabs")) return [{ ...fall.tab, position: 0 }] as T;
      if (path.endsWith("/sections")) return fall.sections as T;
      if (path.endsWith("/widgets")) return fall.widgets as T;
      if (path.endsWith("/settings")) return { design_settings: { styles: [] } } as T;
      throw new Error(`unerwartet ${path}`);
    },
    async patch<T>(_service: string, path: string, body?: unknown): Promise<T> {
      aufrufe.push({ methode: "PATCH", path, body });
      return (opts.patch ? opts.patch(path, body) : { id: "w1", version: 4 }) as T;
    },
  };
  return { client, aufrufe };
}

describe("homepage slot", () => {
  test("TC-03 get returns entry, widget and version; unknown name is exit 3", async () => {
    const { client } = stub();
    const stand = await slotGet(client, "c", "start/hero-titel");
    expect(stand).toMatchObject({ widget_id: "w1", version: 3, name: "hero-titel", entry: { kind: "heading" } });
    const fehler = await slotGet(client, "c", "start/gibt-es-nicht").catch((e) => e);
    expect(fehler).toBeInstanceOf(HomepageAbbruch);
    expect((fehler as HomepageAbbruch).exitCode).toBe(3);
    expect((fehler as HomepageAbbruch).code).toBe("slot_not_found");
    const reiter = await slotGet(client, "c", "weg/hero-titel").catch((e) => e);
    expect((reiter as HomepageAbbruch).code).toBe("tab_not_found");
  });

  test("TC-04 set sends the version it read; 409 is exit 4 with live_version", async () => {
    const { client, aufrufe } = stub();
    const r = await slotSet(client, "c", "start/hero-titel", { kind: "heading", config: { text: "Neu" } });
    expect(r.geschrieben).toBe(true);
    const patch = aufrufe.find((a) => a.methode === "PATCH")!;
    expect(patch.path).toBe("/home-config/c/widgets/w1/slots/hero-titel");
    expect(patch.body).toEqual({ expected_version: 3, entry: { kind: "heading", config: { text: "Neu" } } });

    const konflikt = stub({ patch: () => { throw new HttpError(409, JSON.stringify({ detail: { code: "widget_changed", live_version: 5 } }), "u"); } });
    const e = await slotSet(konflikt.client, "c", "start/hero-titel", { kind: "heading", config: { text: "x" } }).catch((x) => x);
    expect((e as HomepageAbbruch).exitCode).toBe(4);
    expect((e as HomepageAbbruch).message).toContain("5");
  });

  test("TC-05 dry run writes nothing and shows the findings", async () => {
    const { client, aufrufe } = stub();
    const r = await slotSet(client, "c", "start/hero-knopf", { kind: "link", config: { label: "x", href: "/" } }, { trockenlauf: true });
    expect(r.geschrieben).toBe(false);
    expect(aufrufe.some((a) => a.methode === "PATCH")).toBe(false);
    // hero-knopf is an <a>: no link_slot_not_anchor. As a heading on a <p> it would be clean too.
    const falsch = await slotSet(client, "c", "start/hero-kicker", { kind: "link", config: { label: "x", href: "/" } }, { trockenlauf: true });
    expect(falsch.befunde.map((b) => b.klasse)).toContain("link_slot_not_anchor");
  });

  test("tree loads every tab", async () => {
    const { client } = stub();
    const baeume = await tree(client, "c");
    expect(baeume.length).toBe(1);
    expect(baeume[0].name).toBe("Start");
  });
});

// ── TC-06…TC-10, TC-13: convert ──────────────────────────────────────────────

function umwandeln(html: string, styles?: Parameters<typeof wandleGeruestUm>[3]["styles"]) {
  return wandleGeruestUm(html, {}, new Set<string>(), { styles });
}

describe("homepage convert", () => {
  test("TC-06 a heading with <br> becomes the element itself", () => {
    const r = umwandeln('<section class="jaga-hero" aria-label="Start"><h1>Mit ruhiger Hand.<br>Mitten im Dorf.</h1></section>');
    expect(r.html).toBe('<section class="jaga-hero" aria-label="Start"><h1 data-slot="hero-titel"></h1></section>');
    expect(r.slots["hero-titel"]).toEqual({ kind: "heading", config: { text: "Mit ruhiger Hand.\nMitten im Dorf." } });
  });

  test("TC-07 a link keeps its classes without catalog and moves them into the style with it", () => {
    const html = '<section class="jaga-hero" aria-label="Start"><a class="jaga-button gold" href="?tab=gruendungsfest">Gründungsfest 2027</a></section>';
    const ohne = umwandeln(html);
    const knopf = dokument(ohne.html).querySelector('[data-slot="hero-knopf"]')!;
    expect(knopf.tagName).toBe("A");
    expect(knopf.getAttribute("class")).toBe("jaga-button gold");
    expect(knopf.hasAttribute("href")).toBe(false);
    expect(knopf.innerHTML).toBe("");
    expect(ohne.slots["hero-knopf"]).toEqual({ kind: "link", config: { label: "Gründungsfest 2027", href: "?tab=gruendungsfest", new_tab: false } });
    const mit = umwandeln(html, [{ id: "knopf-gold", label: "Knopf gold", class: "jaga-button gold", fuer: ["link"] }]);
    expect(mit.html).toContain('<a data-slot="hero-knopf"></a>');
    expect(mit.slots["hero-knopf"].style).toBe("knopf-gold");
    expect(mit.verschoben).toBe(1);
  });

  test("TC-08 a legacy inline slot gets a name from its area", () => {
    const r = umwandeln('<section class="jaga-section paper" aria-label="Neues"><div data-widget-slot="news" data-widget-config="{&quot;limit&quot;:3}"></div></section>');
    expect(r.html).toBe('<section class="jaga-section paper" aria-label="Neues"><div data-slot="section-news"></div></section>');
    expect(r.slots["section-news"]).toEqual({ kind: "news", config: { limit: 3 } });
  });

  test("TC-09 mixed content: the span becomes a slot, loose text stays and is reported", () => {
    const r = umwandeln('<section class="jaga-abend" aria-label="Abend"><div class="jaga-date"><span>Jeden Freitag</span>19:30 Uhr</div></section>');
    expect(r.html).toBe('<section class="jaga-abend" aria-label="Abend"><div class="jaga-date"><span data-slot="abend-text"></span>19:30 Uhr</div></section>');
    expect(r.slots["abend-text"]).toEqual({ kind: "text", config: { content: "Jeden Freitag" } });
    expect(r.offene.map((o) => o.text)).toEqual(["19:30 Uhr"]);
  });

  test("TC-10 a second run changes nothing", () => {
    const erst = umwandeln('<section class="jaga-hero"><h2>Titel</h2><p>Ein <strong>Absatz</strong>.</p></section>');
    const zweit = wandleGeruestUm(erst.html, erst.slots, new Set(Object.keys(erst.slots)));
    expect(zweit.html).toBe(erst.html);
    expect(zweit.slots).toEqual(erst.slots);
    expect(zweit.umgewandelt).toBe(0);
    expect(zweit.offene).toEqual([]);
    // Step 4: an unnamed section got the text of its first heading.
    expect(erst.html).toContain('aria-label="Titel"');
  });

  test("TC-13 names stay unique across the skeletons of a tab", () => {
    const tab: BulkTab = {
      label: "Start", slug: "start",
      sections: [
        { widgets: [{ kind: "custom_html", config: { html: '<section class="jaga-karte"><h3>Eins</h3></section>' } }] },
        { widgets: [{ kind: "custom_html", config: { html: '<section class="jaga-karte"><h3>Zwei</h3></section>' } }] },
      ],
    };
    const { home } = convert({ tabs: [tab] });
    const namen = home.tabs[0].sections.flatMap((s) => s.widgets.flatMap((w) => Object.keys((w.config.slots as object) ?? {})));
    expect(namen).toEqual(["karte-titel", "karte-titel-2"]);
  });

  test("images and tables are reported, the file is written anyway", () => {
    const r = umwandeln('<section aria-label="Galerie"><img src="https://x/a.png"><table><tr><td>Zelle</td></tr></table></section>');
    expect(r.offene.map((o) => o.grund)).toEqual(["Bild im Gerüst (img)", "Text in einer Tabelle"]);
  });

  test("a tab without skeleton is skipped with a note", () => {
    const e = convert({ tabs: [{ label: "L", slug: "l", sections: [{ widgets: [{ kind: "news", config: {} }] }] }] });
    expect(e.berichte).toEqual([{ tab: "l", uebersprungen: "kein custom_html-Gerüst" }]);
  });
});

// ── TC-12: club design names catalog changes ─────────────────────────────────

describe("club design catalog", () => {
  test("TC-12 names count, new and removed entries", () => {
    const a = katalogAenderung(
      { styles: [{ id: "alt" }, { id: "bleibt" }] },
      { styles: [{ id: "bleibt" }, { id: "neu" }], area_templates: [{ id: "karte" }] },
    );
    expect(a).toEqual([
      { feld: "styles", anzahl: 2, neu: ["neu"], entfernt: ["alt"] },
      { feld: "area_templates", anzahl: 1, neu: ["karte"], entfernt: [] },
    ]);
  });
});

// ── verify homepage: R1–R6 before any browser ────────────────────────────────

describe("verify homepage structure", () => {
  test("reports errors of new-format skeletons with the tab", () => {
    const befunde = strukturBefunde([
      { slug: "start", sections: [{ widgets: [{ kind: "custom_html", config: { html: '<div><h1 data-slot="t"></h1><p>fest</p></div>', slots: { t: { kind: "heading", config: {} } } } }] }] },
    ]);
    expect(befunde.some((b) => b.klasse === "fixed_text_in_skeleton" && b.schwere === "fehler" && b.tab === "start")).toBe(true);
  });
});


// ── homepage export: the full live structure for the backup (07 §4.1) ──────────

describe("homepage export", () => {
  test("liveAlsBulk keeps tabs, sections in order and every widget with its config", async () => {
    const { client } = stub();
    const { tabs, hinweise } = await liveAlsBulk(client, "c");
    expect(hinweise).toEqual([]);
    expect(tabs.map((t) => t.slug)).toEqual(["start"]);
    expect(tabs[0].sections.map((s) => [s.layout, s.title, s.sort_order])).toEqual([["full", null, 0], ["two-col", "Termine", 1]]);
    expect(tabs[0].sections[1].widgets.map((w) => [w.kind, w.slot_index])).toEqual([["events_list", 0], ["image", 1]]);
    expect(tabs[0].sections[0].widgets[0].config.slots).toBeDefined();
  });
});
