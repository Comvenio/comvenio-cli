import { z } from "zod";

import { K12_HOMEPAGE_REGISTRY, K12_SCHEMA_DOMAINS } from "./schema-registry.ts";
import type { K12ActionId, K12ActionSchemaContract } from "./types.ts";

const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(200);
const text = z.string().max(200_000);
const isoDateTime = z.string().datetime({ offset: true });
const pagination = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100_000).default(0) } as const;
const contextType = z.enum(["none", "club", "department", "event", "object", "task", "news", "paper", "newsletter", "tournament", "protocol", "agenda_item", "agenda_item_note", "protocol_entry", "user_avatar", "message_attachment", "feedback", "certificate", "certificate_template", "letter", "event_sponsor", "advertiser", "sponsorship_product", "sponsorship_assignment"]);
const httpsUrl = z.string().url().max(2_000).refine((value) => value.startsWith("https://"), "Nur HTTPS-URLs sind erlaubt.");
const externalHttpsUrl = httpsUrl.refine((value) => {
  const host = new URL(value).hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^(?:127|10|0)\./u.test(host) || /^169\.254\./u.test(host) || /^192\.168\./u.test(host)) return false;
  const match = host.match(/^172\.(\d{1,3})\./u);
  return !match || Number(match[1]) < 16 || Number(match[1]) > 31;
}, "Lokale, private oder Link-Local-Ziele sind nicht erlaubt.");
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(512) }).strict();
const base = { club_id: uuid, department_id: uuid.nullable().optional(), confirmation: confirmation.optional() } as const;
const single = <S extends z.ZodRawShape>(shape: S) => z.object({ ...base, ...shape }).strict();
const grouped = <S extends z.ZodRawShape>(operation: string, shape: S) => z.object({ ...base, operation: z.literal(operation), ...shape }).strict();
const union = <T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>(items: T) => z.discriminatedUnion("operation", items as never);
const contract = (input: z.ZodType): K12ActionSchemaContract => ({ input, output: z.json() });

function safeRichHtml(value: string): boolean {
  if (/<\s*script|javascript\s*:|data\s*:\s*text\/html|\son[a-z]+\s*=/iu.test(value)) return false;
  const iframes = [...value.matchAll(/<iframe[^>]+src=["']([^"']+)["']/giu)].map((match) => match[1]!);
  return iframes.every((url) => /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+(?:\?[^"']*)?$/u.test(url));
}
const richHtml = text.refine(safeRichHtml, "Aktive Skripte, Event-Handler und nicht freigegebene Iframes sind nicht erlaubt.");
const safeString = z.string().max(10_000).refine((value) => !/(?:[A-Za-z]:\\|file:\/\/|\/home\/|\/Users\/)/u.test(value), "Lokale Dateipfade sind nicht erlaubt.");

const widgetKinds = K12_HOMEPAGE_REGISTRY.widget_kinds as [string, ...string[]];
const widgetFields = Object.fromEntries(Object.values(K12_HOMEPAGE_REGISTRY.widgets).flatMap((entry) => entry.config.map((field) => [field.name, z.json().optional()]))) as z.ZodRawShape;
/**
 * Die Widget-Config bleibt eine GESCHLOSSENE Menge.
 *
 * Am 2026-08-29 stand hier kurzzeitig ein `catchall`: Die Feldliste entsteht
 * aus `homepage_system.py` — einem LLM-Prompt — ueber einen Textparser, und
 * was dort fehlt, ist nicht "verboten", sondern "nicht aufgeschrieben". 19
 * gelesene Felder waren so gesperrt. Der Gedanke war, nur noch zu melden.
 *
 * **Der Vertragstest TC-06 steht dagegen**
 * (`packages/connector-contracts/tests/actions.contract.test.ts:1291`): Er
 * verlangt, dass `config: { arbitrary_payload: "secret" }` abgelehnt wird.
 *
 * *Genau und nicht mehr* — die Praezisierung stammt aus der zweiten
 * Fremdpruefung, die eine erste Fassung dieses Kommentars als zu weit
 * zurueckwies. Der Test prueft EINEN Aufruf. Er verlangt NICHT, dass jeder
 * unbekannte Schluessel abgelehnt wird, nicht eine geschlossene Menge je
 * Widget-Art, und nicht, dass die Ablehnung gerade aus der Geschlossenheit
 * folgt. Die Pfad-, Skript- und SSRF-Zusicherungen daneben sind eigene,
 * unabhaengige Erwartungen im selben `test()`-Block.
 *
 * Die geschlossene Menge ist damit eine **Entscheidung** (Tom, 2026-08-29),
 * nicht ein Zwang aus dem Test: Ein MCP-Agent soll keine beliebigen Schluessel
 * in eine Struktur schreiben koennen, die gespeichert und gerendert wird. Wer
 * sie halten will, braucht dafuer einen eigenen Vertragstest — den gibt es
 * bisher nicht.
 *
 * **Die richtige Antwort auf die 19 Felder ist deshalb, sie einzutragen** —
 * nicht, die Sperre zu oeffnen. `gen-schema` meldet sie seit dem 2026-08-29
 * beim Erzeugen (`code_fields_not_in_schema`), damit die Liste nicht wieder
 * hinter dem Code zurueckbleibt.
 *
 * Offen und bewusst nicht hier entschieden: Sobald der MCP Screenshots
 * zurueckgeben kann, verlagert sich die Kontrolle auf den Blick aufs Ergebnis
 * — dann ist diese Sperre neu abzuwaegen. Bis dahin ist sie der einzige Boden.
 */
const widgetFieldsByKind = new Map(Object.entries(K12_HOMEPAGE_REGISTRY.widgets).map(([kind, entry]) => [kind, new Set(entry.config.map((field) => field.name))]));
const widgetConfig = z.object(widgetFields).strict();
// Named slots of a custom_html skeleton (17-designer-struktur 02 §4.3) get the same closed field set per kind as a
// standalone widget; mirrors sanitize_slot_entry in club-service (name pattern, entry keys, no nested custom_html).
const SLOT_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const SLOT_ENTRY_KEYS = new Set(["kind", "config", "style"]);
const MAX_SLOTS = 200;
// community-hub 15: the building blocks of the template "vereinsseite" are bound to their club
// through config.club_id (club-service community_page.py _template_sections, 10 §18). Only a
// club page may carry it, and only the club of the sign-in (handlers.ts assertOwnClubPage).
const CLUB_BOUND_KINDS = new Set(["description", "events_list", "news"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function checkFields(kind: string, config: Record<string, unknown>, ctx: z.RefinementCtx, path: (string | number)[], clubBound = false): void {
  const allowed = widgetFieldsByKind.get(kind) ?? new Set<string>();
  for (const key of Object.keys(config)) {
    if (clubBound && key === "club_id" && CLUB_BOUND_KINDS.has(kind)) {
      if (typeof config[key] !== "string" || !UUID_PATTERN.test(config[key] as string)) ctx.addIssue({ code: "custom", path: [...path, key], message: "club_id muss eine Vereins-ID sein." });
      continue;
    }
    if (!allowed.has(key)) ctx.addIssue({ code: "custom", path: [...path, key], message: `Das Feld ist für ${kind} nicht freigegeben.` });
  }
}
function checkSlots(slots: unknown, ctx: z.RefinementCtx, clubBound = false): void {
  const path = ["config", "slots"];
  if (slots === null || typeof slots !== "object" || Array.isArray(slots)) { ctx.addIssue({ code: "custom", path, message: "config.slots muss ein Objekt sein." }); return; }
  const entries = Object.entries(slots as Record<string, unknown>);
  if (entries.length > MAX_SLOTS) ctx.addIssue({ code: "custom", path, message: `config.slots: höchstens ${MAX_SLOTS} Einträge.` });
  for (const [name, entry] of entries) {
    const at = [...path, name];
    if (!SLOT_NAME.test(name)) ctx.addIssue({ code: "custom", path: at, message: "Slot-Name ungültig (a-z, 0-9, Bindestrich; max. 63)." });
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) { ctx.addIssue({ code: "custom", path: at, message: "Slot-Eintrag muss ein Objekt sein." }); continue; }
    const e = entry as Record<string, unknown>;
    for (const key of Object.keys(e)) if (!SLOT_ENTRY_KEYS.has(key)) ctx.addIssue({ code: "custom", path: [...at, key], message: "Unbekanntes Feld im Slot-Eintrag." });
    const kind = typeof e.kind === "string" ? e.kind : "";
    if (kind === "custom_html" || !widgetFieldsByKind.has(kind)) { ctx.addIssue({ code: "custom", path: [...at, "kind"], message: `Unbekannte oder unzulässige Slot-Art '${kind}'.` }); continue; }
    if (e.style !== undefined && e.style !== null && (typeof e.style !== "string" || !SLOT_NAME.test(e.style))) ctx.addIssue({ code: "custom", path: [...at, "style"], message: "style ist keine gültige Stil-Kennung." });
    const config = e.config ?? {};
    if (config === null || typeof config !== "object" || Array.isArray(config)) { ctx.addIssue({ code: "custom", path: [...at, "config"], message: "config muss ein Objekt sein." }); continue; }
    checkFields(kind, config as Record<string, unknown>, ctx, [...at, "config"], clubBound);
  }
}
const homepageWidgetShape = z.object({ kind: z.enum(widgetKinds), title: z.string().max(200).nullable().optional(), config: widgetConfig.default({}), slot_index: z.number().int().min(0).max(100).default(0) }).strict();
const checkWidgetWith = (clubBound: boolean) => (value: { kind: string; config: Record<string, unknown> }, ctx: z.RefinementCtx): void => {
  checkFields(value.kind, value.config, ctx, ["config"], clubBound);
  if (value.kind === "custom_html" && value.config.slots !== undefined) checkSlots(value.config.slots, ctx, clubBound);
  const serialized = JSON.stringify(value.config);
  if (/(?:[A-Za-z]:\\|file:\/\/|javascript\s*:|<\s*script|\son[a-z]+\s*=)/iu.test(serialized)) ctx.addIssue({ code: "custom", path: ["config"], message: "Lokale Pfade oder aktive Inhalte sind nicht erlaubt." });
};
const checkWidget = checkWidgetWith(false);
const homepageWidget = homepageWidgetShape.superRefine(checkWidget);
const homepageSectionShape = z.object({
  layout: z.enum(["full", "two-col", "three-col", "four-col", "sidebar-left", "sidebar-right", "asymmetric-left", "asymmetric-right"]).default("full"),
  style_variant: z.enum(["default", "primary", "dark", "subtle", "gradient", "glass", "image"]).default("default"),
  sort_order: z.number().int().min(0).max(10_000).default(0), title: z.string().max(200).nullable().optional(), is_visible: z.boolean().default(true), bg_image_url: httpsUrl.nullable().optional(),
});
const homepageSection = homepageSectionShape.extend({ widgets: z.array(homepageWidget).max(100).default([]) }).strict();
const homepageTab = z.object({
  label: z.string().trim().min(1).max(100), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(100), icon: z.string().max(100).nullable().optional(), navigation_group: z.string().trim().max(100).nullable().optional(), position: z.number().int().min(0).max(10_000).default(0), visibility_scope: z.enum(["public", "member", "department"]).default("public"), department_id: uuid.nullable().optional(), sections: z.array(homepageSection).max(50).default([]),
}).strict().refine((tab) => tab.visibility_scope === "department" ? Boolean(tab.department_id) : tab.department_id === undefined || tab.department_id === null, "Abteilungs-ID und Sichtbarkeit müssen zusammenpassen.");
const homepage = { tabs: z.array(homepageTab).min(1).max(30), clear_existing: z.boolean().default(false) } as const;
// A community page has no departments (community-hub 01 D-43); the service rejects them too.
const communityTab = homepageTab.refine((tab) => tab.visibility_scope !== "department", "Eine Community-Seite kennt keine Abteilungs-Sichtbarkeit.");
const community = { community_id: uuid } as const;
const communityPage = { ...community, tabs: z.array(communityTab).min(1).max(30), clear_existing: z.boolean().default(false) } as const;
// Version of every general tab the preview planned with (12 §4.3); apply sends exactly these.
const expectedVersions = z.record(uuid, z.number().int().min(1)).refine((value) => Object.keys(value).length <= 100, "Höchstens 100 Tab-Versionen.");
const designSettings = z.record(z.string().max(100), z.json()).refine((value) => JSON.stringify(value).length <= 200_000, "design_settings ist zu groß.");
// A club page as the service's per-tab publish takes it (community-hub 15 §4.4,
// club_home_publish.py PublishSection): kept sections and widgets carry their id.
const clubPageWidget = homepageWidgetShape.extend({ id: uuid.optional(), config: z.object({ ...widgetFields, club_id: z.json().optional() }).strict().default({}) }).strict().superRefine(checkWidgetWith(true));
const clubPageSection = homepageSectionShape.extend({ id: uuid.optional(), spalten_breiten: z.array(z.number().int().min(20).max(100)).min(2).max(4).optional(), widgets: z.array(clubPageWidget).max(100).default([]) }).strict();
// The versions of every live section and widget of the tab, as cai.community.06.club_page show returns them.
const publishBase = z.object({ sections: z.record(uuid, z.number().int().min(1)).default({}), widgets: z.record(uuid, z.number().int().min(1)).default({}) }).strict()
  .refine((value) => Object.keys(value.sections).length + Object.keys(value.widgets).length <= 500, "Höchstens 500 Versionen in base.");
const screenshot = { preview_id: uuid, viewports: z.array(z.enum(["desktop", "mobile"])).min(1).max(2).default(["desktop", "mobile"]), tab_slug: z.string().trim().max(100).nullable().optional(), settle_ms: z.number().int().min(0).max(10_000).default(1_500) } as const;

const verifyOptions = { viewports: z.array(z.enum(["desktop", "mobile"])).min(1).max(2).default(["desktop", "mobile"]), audit: z.boolean().default(true), wait_ms: z.number().int().min(0).max(10_000).default(1_500) } as const;
const fileReference = { source_file_id: uuid, filename: safeString.max(255), content_type: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/iu), expected_size: z.number().int().min(1).max(209_715_200) } as const;
const fileChange = z.object({ context_type: contextType.nullable().optional(), context_id: uuid.nullable().optional(), sub_context_id: uuid.nullable().optional(), context_label: z.string().max(500).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0);
const folderRight = z.object({ folder_id: uuid, subject_type: z.enum(["user", "group"]), subject_id: uuid, can_read: z.boolean().default(true), can_write: z.boolean().default(false) }).strict();
const paper = z.object({ title: short, description: z.string().max(2_000).nullable().optional(), document_type: z.enum(["protokoll", "flyer", "anleitung", "zeitung", "bericht", "speisekarte", "sonstiges"]), context_type: z.enum(["event", "object", "task", "supply", "custom"]), context_id: uuid, file_id: uuid, published_at: isoDateTime.nullable().optional() }).strict();

const referenceType = z.enum(["none", "event", "tournament", "task", "meeting", "object", "external_url"]);
const newsFields = {
  title: short, content: richHtml, teaser: z.string().max(2_000).nullable().optional(), cover_image_file_id: uuid.nullable().optional(), category_id: uuid.nullable().optional(), club_department_id: uuid.nullable().optional(), visibility_scope: z.enum(["public", "member", "department"]).default("member"), is_pinned: z.boolean().default(false), reference_id: uuid.nullable().optional(), reference_type: referenceType.default("none"), reference_url: httpsUrl.nullable().optional(), reference_label: z.string().max(200).nullable().optional(), design_source: z.enum(["webapp", "cli"]).default("cli"),
} as const;
const news = z.object(newsFields).strict().refine((value) => value.visibility_scope === "department" ? Boolean(value.club_department_id) : true).refine((value) => value.reference_type === "external_url" ? Boolean(value.reference_url) : true);
const newsChanges = z.object({ title: short.optional(), content: richHtml.optional(), teaser: z.string().max(2_000).nullable().optional(), cover_image_file_id: uuid.nullable().optional(), category_id: uuid.nullable().optional(), club_department_id: uuid.nullable().optional(), visibility_scope: z.enum(["public", "member", "department"]).optional(), is_pinned: z.boolean().optional(), reference_id: uuid.nullable().optional(), reference_type: referenceType.optional(), reference_url: httpsUrl.nullable().optional(), reference_label: z.string().max(200).nullable().optional(), design_source: z.enum(["webapp", "cli"]).optional() }).strict().refine((value) => Object.keys(value).length > 0);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const remoteAsset = uuid;
const videoInput = z.union([
  grouped("render", { template: z.literal("slideshow"), params: z.object({ brandColor: hex, logo_file_id: remoteAsset.optional(), title: short, subtitle: z.string().max(300).optional(), image_file_ids: z.array(remoteAsset).min(2).max(100), overlays: z.array(z.string().max(300)).max(100).optional(), duration_per_image: z.number().int().min(2).max(10).default(4) }).strict(), duration_seconds: z.number().int().min(3).max(600).optional() }),
  grouped("render", { template: z.literal("result"), params: z.object({ brandColor: hex, logo_file_id: remoteAsset.optional(), home_team: short, away_team: short, home_score: z.number().int().min(0).max(999), away_score: z.number().int().min(0).max(999), competition: z.string().max(200).optional(), scorers: z.array(z.string().max(200)).max(100).optional(), date: z.string().date().optional() }).strict(), duration_seconds: z.number().int().min(3).max(600).optional() }),
  grouped("render", { template: z.literal("teaser"), params: z.object({ brandColor: hex, logo_file_id: remoteAsset.optional(), title: short, date: z.string().date(), location: z.string().max(300).optional(), cta_text: z.string().max(200).optional(), background_file_id: remoteAsset.optional() }).strict(), duration_seconds: z.number().int().min(3).max(600).optional() }),
  grouped("render", { template: z.literal("highlight"), params: z.object({ brandColor: hex, logo_file_id: remoteAsset.optional(), title: short, subtitle: z.string().max(300).optional(), hero_file_id: remoteAsset.optional(), sponsor_file_ids: z.array(remoteAsset).max(20).optional(), note_text: z.string().max(1_000).optional() }).strict(), duration_seconds: z.number().int().min(3).max(600).optional() }),
  grouped("render_and_upload", { template: z.enum(["slideshow", "result", "teaser", "highlight"]), render_request_id: uuid, context_type: contextType.default("news"), context_id: uuid.optional(), visibility: z.enum(["private", "public"]).default("private") }),
]);

export const K12_ACTION_SCHEMAS: Readonly<Record<K12ActionId, K12ActionSchemaContract>> = Object.freeze({
  "cai.homepage.01.preview": contract(single({ ...homepage })),
  "cai.homepage.02.apply": contract(single({ ...homepage })),
  // Kein `tabs` im Eingang: Gerendert wird eine BEREITS gespeicherte Vorschau.
  // Wer eine neue braucht, legt sie mit cai.homepage.01.preview an — sonst
  // gaebe es zwei Wege, dieselbe Struktur zu uebergeben, und einer davon
  // liefe an der 30-Minuten-Gueltigkeit vorbei.
  "cai.homepage.04.screenshot": contract(single({ preview_id: uuid, viewports: z.array(z.enum(["desktop", "mobile"])).min(1).max(2).default(["desktop", "mobile"]), tab_slug: z.string().trim().max(100).nullable().optional(), settle_ms: z.number().int().min(0).max(10_000).default(1_500) })),
  "cai.homepage.03.show": contract(union([grouped("private", {}), grouped("public", {})])),
  // Keine Eingabe außer club_id/department_id (D-DOK-17): die Action liest
  // immer die aktuelle Live-Struktur, eine Datei- oder tabs-Eingabe gibt es
  // nicht — sonst gäbe es zwei Wege, dieselbe Struktur zu übergeben.
  "cai.homepage.05.convert": contract(single({})),
  "cai.community.01.show": contract(union([grouped("private", { ...community }), grouped("public", { ...community })])),
  "cai.community.02.preview": contract(single({ ...communityPage, design_settings: designSettings.optional(), ttl_hours: z.number().int().min(1).max(24).optional() })),
  // Ohne expected_versions haengt der Bulk an; Ersetzen verlangt die Versionen
  // aus der Antwort von cai.community.02.preview (14 DC-5, DC-8).
  "cai.community.03.apply": contract(single({ ...communityPage, expected_versions: expectedVersions.default({}) })),
  "cai.community.04.screenshot": contract(single({ ...community, ...screenshot })),
  "cai.community.05.design": contract(union([grouped("show", { ...community }), grouped("update", { ...community, design_settings: designSettings, expected_design_version: z.number().int().min(1) })])),
  // The club is always the one of the sign-in (club_id from the runtime); the
  // versions for publish come from show and are never read again silently (15 DC-5).
  "cai.community.06.club_page": contract(union([
    grouped("show", { ...community }),
    grouped("create", { ...community, label: z.string().trim().min(1).max(60), visibility_scope: z.enum(["public", "member"]).default("public"), template: z.enum(["vereinsseite", "none"]).default("vereinsseite") }),
    grouped("publish", { ...community, tab_id: uuid, expected_tab_version: z.number().int().min(1), base: publishBase, sections: z.array(clubPageSection).max(50) }),
  ])),
  "cai.schema.01.list_domains": contract(single({})),
  "cai.schema.02.show_domain_schema": contract(single({ domain: z.enum(K12_SCHEMA_DOMAINS) })),
  "cai.verify.01.url": contract(single({ target_url: externalHttpsUrl, ...verifyOptions })),
  "cai.verify.02.event": contract(single({ event_id: uuid, child_event_id: uuid.optional(), area_id: uuid.optional(), ...verifyOptions })),
  "cai.verify.03.menu": contract(single({ menu_id: uuid, print_view: z.boolean().default(false), ...verifyOptions })),
  "cai.verify.04.homepage": contract(union([grouped("live", { ...verifyOptions }), grouped("preview", { tabs: homepage.tabs, ...verifyOptions })])),
  "cai.verify.05.news": contract(single({ news_id: uuid, ...verifyOptions })),
  "cai.verify.06.certificate": contract(single({ honor_id: uuid, ...verifyOptions })),
  "cai.data.01.list": contract(single({ context_type: contextType, context_id: uuid, sub_context_id: uuid.optional(), include_deleted: z.boolean().default(false), ...pagination })),
  "cai.data.02.show": contract(single({ file_id: uuid })),
  "cai.data.03.update": contract(single({ file_id: uuid, changes: fileChange })),
  "cai.data.04.url": contract(single({ file_id: uuid })),
  "cai.data.05.download": contract(single({ file_id: uuid, preferred_name: safeString.max(255).optional() })),
  "cai.data.06.upload": contract(single({ ...fileReference, context_type: contextType, context_id: uuid.optional(), sub_context_id: uuid.optional(), context_label: z.string().max(500).optional(), visibility: z.enum(["private", "public"]).default("private") })),
  "cai.data.07.delete": contract(union([grouped("soft_delete", { file_id: uuid }), grouped("hard_delete", { file_id: uuid })])),
  "cai.data.08.restore": contract(single({ file_id: uuid })),
  "cai.data.09.move": contract(single({ file_id: uuid, target_folder_id: uuid.nullable() })),
  "cai.data.10.visibility": contract(union([grouped("private", { file_id: uuid }), grouped("public", { file_id: uuid })])),
  "cai.data.11.stats": contract(single({})),
  "cai.data.12.empty_trash": contract(single({ folder_id: uuid.nullable().optional() })),
  "cai.data.13.area_media": contract(single({ area_ids: z.array(uuid).min(1).max(100), label: z.enum(["title_picture", "flyer"]).optional() })),
  "cai.data.14.area_shares": contract(single({ file_id: uuid })),
  "cai.data.15.area_share_add": contract(single({ file_id: uuid, area_ids: z.array(uuid).min(1).max(100) })),
  "cai.data.16.area_share_remove": contract(single({ file_id: uuid, area_id: uuid })),
  "cai.data.17.children": contract(single({ parent_id: uuid.nullable().optional(), include_deleted: z.boolean().default(false), ...pagination })),
  "cai.data.18.search": contract(single({ folder_id: uuid.nullable().optional(), query: z.string().trim().min(1).max(200), recursive: z.boolean().default(true), ...pagination })),
  "cai.data.19.breadcrumb": contract(single({ folder_id: uuid })),
  "cai.data.20.folder_create": contract(single({ parent_id: uuid.nullable().optional(), name: short.max(255), is_protected: z.boolean().default(false) })),
  "cai.data.21.folder_rename": contract(single({ folder_id: uuid, new_name: short.max(255) })),
  "cai.data.22.folder_move": contract(single({ folder_id: uuid, new_parent_id: uuid.nullable() })),
  "cai.data.23.folder_protect": contract(single({ folder_id: uuid, protect: z.boolean() })),
  "cai.data.24.folder_delete": contract(single({ folder_id: uuid, recursive: z.boolean().default(true) })),
  "cai.data.25.folder_restore": contract(single({ folder_id: uuid, recursive: z.boolean().default(true) })),
  "cai.data.26.folder_rights": contract(single({ folder_id: uuid })),
  "cai.data.27.folder_right_add": contract(single({ right: folderRight })),
  "cai.data.28.folder_right_bulk": contract(single({ rights: z.array(folderRight).min(1).max(100) })),
  "cai.data.29.folder_right_delete": contract(single({ right_id: uuid })),
  "cai.data.30.papers": contract(single({ context_type: z.enum(["event", "object", "task", "supply", "custom"]).optional(), context_id: uuid.optional(), document_type: z.enum(["protokoll", "flyer", "anleitung", "zeitung", "bericht", "speisekarte", "sonstiges"]).optional(), ...pagination }).refine((value) => Boolean(value.context_type) === Boolean(value.context_id), "Kontexttyp und Kontext-ID müssen gemeinsam gesetzt werden.")),
  "cai.data.31.paper_show": contract(single({ paper_id: uuid })),
  "cai.data.32.paper_add": contract(single({ paper })),
  "cai.data.33.paper_update": contract(single({ paper_id: uuid, paper })),
  "cai.data.34.paper_delete": contract(single({ paper_id: uuid })),
  "cai.data.35.export_members_bookings": contract(union([grouped("members", { format: z.enum(["csv", "xlsx"]).default("csv") }), grouped("bookings", { format: z.enum(["csv", "xlsx"]).default("csv") })])),
  "cai.news.01.list": contract(union([grouped("private", { ...pagination }), grouped("public", { ...pagination })])),
  "cai.news.02.show": contract(union([grouped("private", { news_id: uuid }), grouped("public", { news_id: uuid })])),
  "cai.news.03.create": contract(union([grouped("draft", { news }), grouped("publish", { news })])),
  "cai.news.04.update": contract(single({ news_id: uuid, changes: newsChanges })),
  "cai.news.05.delete": contract(single({ news_id: uuid })),
  "cai.news.06.apply": contract(union([grouped("draft", { news }), grouped("publish", { news })])),
  "cai.news.07.preview": contract(single({ title: short, content: richHtml, teaser: z.string().max(2_000).nullable().optional(), cover_file_id: uuid.optional(), author_name: z.string().max(200).optional(), club_name: z.string().max(200).optional() })),
  "cai.news.08.publish": contract(single({ news_id: uuid })),
  "cai.news.09.video_slideshow_result_teaser": contract(videoInput),
});
